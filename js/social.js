(function () {
  'use strict';

  const MESSAGE_LIMIT = 500;
  const CHAT_REFRESH_INTERVAL_MS = 4000;
  const SEARCH_DEBOUNCE_MS = 320;
  const SEARCH_CACHE_TTL_MS = 15000;
  const SOCKET_RETRY_DELAYS = [0, 1000, 2000, 4000, 8000, 12000];
  const FIXED_COUPLE_AFFINITY = Object.freeze({ level: 521, points: 1314, fixed: true });
  const state = {
    started: false,
    stopping: false,
    friends: [],
    affinity: new Map(),
    requests: [],
    recent: [],
    blocks: [],
    searchResult: null,
    currentChat: null,
    messages: [],
    chatOldestId: 0,
    chatHasMore: false,
    chatLoading: false,
    chatLoadingOlder: false,
    chatRefreshPending: false,
    chatRefreshTimer: null,
    chatGeneration: 0,
    pendingInvites: new Map(),
    dismissedInviteIds: new Set(),
    inviteActionsPending: new Set(),
    socket: null,
    socketConnecting: false,
    socketRetry: 0,
    socketRetryTimer: null,
    socketPingTimer: null,
    refreshTimer: null,
    ticketOrigin: '',
    refreshPromise: null,
    searchTimer: null,
    searchController: null,
    searchGeneration: 0,
    searchPromise: null,
    searchPendingUsername: '',
    searchUsername: '',
    searchAt: 0,
    pendingRequests: new Set(),
    lastUnreadTotal: 0,
    lastNotifiedMessageId: '',
    lastMessageSoundAt: 0,
    hasUnreadSnapshot: false,
    lastNotifiedUnreadTotal: 0,
    dom: Object.create(null),
    domListeners: null,
    profileReturnFocus: null,
    lifecycle: 0
  };

  function byId(id) {
    const cached = state.dom[id];
    if (cached && cached.isConnected !== false) return cached;
    const element = document.getElementById(id);
    state.dom[id] = element || null;
    return element;
  }

  function cacheDom() {
    const ids = [
      'friendsModal', 'socialChatModal', 'socialConnectionStatus', 'socialSearchInput',
      'socialSearchResult', 'socialFriendsList', 'socialAffinityList', 'socialRequestsList', 'socialRecentList',
      'socialBlocksList', 'socialPresenceHidden', 'socialMetricsEnabled',
      'socialChatInput', 'socialChatMessages', 'socialChatTitle', 'socialInviteModal', 'socialInviteContent'
    ];
    ids.forEach(byId);
    const modal = state.dom.friendsModal;
    state.dom.socialTabs = modal ? Array.from(modal.querySelectorAll('[data-social-tab]')) : [];
    return state.dom;
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function attr(value) {
    return escapeHtml(value);
  }

  function notice(message, warning) {
    if (typeof showGameNotice === 'function') showGameNotice(String(message || ''), warning !== false);
  }

  function playSocialSound(kind) {
    try {
      if (typeof window.playGomokuSocialSoundEffect === 'function') {
        window.playGomokuSocialSoundEffect(kind);
      }
    } catch (_) {}
  }

  function isRegistered() {
    try {
      return typeof hasRegisteredAccountSession === 'function' && hasRegisteredAccountSession();
    } catch (_) {
      return false;
    }
  }

  function uid() {
    try {
      return typeof currentUserUid !== 'undefined' ? String(currentUserUid || '') : '';
    } catch (_) {
      return localStorage.getItem('gomoku_user_uid') || '';
    }
  }

  function requireAccount() {
    if (isRegistered()) return true;
    notice('🔑 好友功能需要先登录正式账号', true);
    if (typeof openAuthModal === 'function') openAuthModal('login');
    return false;
  }

  function makeQuery(path, params) {
    const query = new URLSearchParams(params || {});
    const separator = String(path).includes('?') ? '&' : '?';
    return String(path) + (query.toString() ? separator + query.toString() : '');
  }

  async function api(path, options) {
    if (typeof safeApiFetch !== 'function') throw new Error('网络服务尚未加载');
    const request = { ...(options || {}) };
    const method = String(request.method || 'GET').toUpperCase();
    // 社交账号数据只在 ECS 主库写入；Cloudflare 是独立数据库，不能作为这些
    // GET 的透明回退，否则刚发出的私聊/好友/邀战会读到另一套库里的旧状态。
    request.primaryOnly = true;
    let endpoint = path;
    if (method === 'GET') {
      endpoint = makeQuery(path, { uid: uid() });
    } else {
      let body = {};
      if (request.body) {
        try { body = JSON.parse(request.body); } catch (_) {}
      }
      request.headers = { 'Content-Type': 'application/json', ...(request.headers || {}) };
      request.body = JSON.stringify({ ...body, uid: uid() });
    }
    const response = await safeApiFetch(endpoint, request);
    let payload = null;
    try { payload = await response.json(); } catch (_) {}
    if (!response.ok || !payload || payload.code !== 0) {
      const error = new Error(payload && payload.msg ? payload.msg : `请求失败 (${response.status})`);
      error.status = response.status;
      if (response.status === 401) {
        stop();
        notice('🔑 登录状态已失效，请重新登录', true);
      }
      throw error;
    }
    return { data: payload.data, response };
  }

  function displayName(person) {
    return String(person && (person.nickname || person.username || person.uid) || '棋友').slice(0, 32);
  }

  function isFixedCoupleAccount(...people) {
    return people.filter(Boolean).some(person =>
      person.fixed === true || person.relationshipType === 'couple' || person.relationship === 'couple'
    );
  }

  function affinityFor(person, fallback) {
    const affinity = fallback || null;
    if (!isFixedCoupleAccount(person, affinity)) return affinity;
    return { ...affinity, ...person, ...FIXED_COUPLE_AFFINITY };
  }

  function affinityEntriesForDisplay() {
    const entries = new Map();
    state.affinity.forEach((item, friendUid) => {
      const friend = state.friends.find(person => String(person.uid || '') === String(friendUid));
      const person = { ...item, ...(friend || {}), uid: String(friendUid) };
      entries.set(String(friendUid), affinityFor(person, item));
    });
    state.friends.forEach(friend => {
      const friendUid = String(friend && friend.uid || '');
      if (friendUid && isFixedCoupleAccount(friend) && !entries.has(friendUid)) {
        entries.set(friendUid, { ...friend, uid: friendUid, ...FIXED_COUPLE_AFFINITY });
      }
    });
    return Array.from(entries.values()).map(person => affinityFor(person, person));
  }

  function renderAffinitySummary() {
    const panel = byId('socialAffinitySummary');
    if (!panel) return;
    const entries = affinityEntriesForDisplay();
    const totalPoints = entries.reduce((sum, item) => sum + Math.max(0, Number(item.points) || 0), 0);
    const bestLevel = entries.length ? Math.max(...entries.map(item => Number(item.level) || 1)) : 0;
    const hasFixedCouple = entries.some(item => item.fixed === true);
    const headline = entries.length
      ? `${entries.length} 位好友 · ${totalPoints.toLocaleString()} 总亲密度 · 最高 Lv.${bestLevel}`
      : '和好友开始私聊后，这里会记录你们的亲密进度';
    const rule = hasFixedCouple
      ? '已配置的情侣亲密度固定为 Lv.521、亲密度 1314；其他好友每 100 点升 1 级。'
      : '每条成功私聊 +1 点 · 每 100 点升 1 级 · 最高 Lv.100';
    panel.innerHTML = `<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;"><strong style="font-size:12px;color:#9d174d;">💞 好感度系统</strong><span style="font-size:10.5px;font-weight:800;color:#64748b;">${headline}</span></div><div style="margin-top:4px;display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;"><span style="color:#64748b;font-size:10px;font-weight:700;">${rule}</span><button type="button" onclick="GomokuSocial.switchTab('affinity')" style="border:0;background:transparent;color:#be185d;padding:2px 0;font-size:10px;font-weight:900;cursor:pointer;">查看等级 ›</button></div>`;
  }

  function avatarImageKey(person) {
    const avatar = String(person && person.avatar || '');
    if (avatar === 'anime_boy' || avatar === 'img/avatar_boy.png' || avatar === 'img/anime_avatar_boy.jpg') return 'boy';
    if (avatar === 'anime_girl' || avatar === 'img/avatar_girl.png' || avatar === 'img/anime_avatar_girl.jpg') return 'girl';
    return '';
  }

  function avatarMarkup(person, size) {
    const avatarSize = Math.max(24, Math.min(120, Number(size) || 30));
    const key = avatarImageKey(person);
    const source = key === 'boy' ? window.ANIME_AVATAR_BOY : key === 'girl' ? window.ANIME_AVATAR_GIRL : '';
    if (typeof source === 'string' && source) {
      const border = key === 'boy' ? '#93c5fd' : '#f9a8d4';
      return `<img src="${attr(source)}" alt="${key === 'boy' ? '男生头像' : '女生头像'}" style="width:${avatarSize}px;height:${avatarSize}px;flex:none;border-radius:50%;object-fit:cover;border:2px solid ${border};background:#fff;" />`;
    }
    const iconSize = Math.round(avatarSize * 0.68);
    return `<span role="img" aria-label="默认头像" style="display:grid;place-items:center;width:${avatarSize}px;height:${avatarSize}px;flex:none;border-radius:50%;color:#668174;background:#edf3ed;"><svg viewBox="0 0 24 24" aria-hidden="true" style="display:block;width:${iconSize}px;height:${iconSize}px;"><circle cx="12" cy="8" r="4" fill="currentColor"/><path d="M4 21c.5-4.4 3.4-7 8-7s7.5 2.6 8 7" fill="currentColor"/></svg></span>`;
  }

  async function ensureAvatarAssets() {
    if (typeof window.ANIME_AVATAR_BOY === 'string' && typeof window.ANIME_AVATAR_GIRL === 'string') return true;
    if (typeof window.ensureGomokuResource !== 'function') return false;
    try {
      await window.ensureGomokuResource('avatars');
      return typeof window.ANIME_AVATAR_BOY === 'string' && typeof window.ANIME_AVATAR_GIRL === 'string';
    } catch (error) {
      console.warn('好友头像资源加载失败，将使用默认头像:', error);
      return false;
    }
  }

  function isCoupleFriend(person) {
    if (person && person.relationshipType === 'couple') return true;
    const uid = String(person && person.uid || '');
    return Boolean(uid && state.friends.some(friend => String(friend.uid || '') === uid && friend.relationshipType === 'couple'));
  }

  function coupleBadge(person) {
    return isCoupleFriend(person)
      ? '<img class="sky-social-couple-badge" src="img/social/couple-badge.png" alt="情侣关系" title="你们已绑定为情侣" draggable="false" />'
      : '';
  }

  function button(action, label, extra, tone) {
    const color = tone === 'danger' ? '#dc2626' : tone === 'primary' ? '#0369a1' : '#475569';
    return `<button type="button" data-social-action="${attr(action)}" ${extra || ''} style="border:1px solid #cbd5e1;border-radius:8px;background:#fff;color:${color};padding:5px 8px;font-weight:800;cursor:pointer">${escapeHtml(label)}</button>`;
  }

  function emptyMarkup(text) {
    return `<div style="padding:18px 8px;text-align:center;color:#64748b;font-size:13px">${escapeHtml(text)}</div>`;
  }

  function personHeading(person, suffix, options) {
    const username = person && person.username ? ` @${person.username}` : '';
    const personUid = String(person && person.uid || '');
    const avatar = options && options.profile && personUid
      ? `<button type="button" class="sky-social-avatar-trigger" data-social-action="profile" data-uid="${attr(personUid)}" aria-label="查看 ${attr(displayName(person))} 的资料" title="查看个人资料">${avatarMarkup(person)}</button>`
      : avatarMarkup(person);
    return `<div class="sky-social-person-heading" style="min-width:0;flex:1"><div style="display:flex;align-items:center;gap:7px;min-width:0;font-weight:900;color:#1e293b">${avatar}<span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(displayName(person))}</span>${coupleBadge(person)}</div><div style="font-size:11px;color:#64748b;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(username)}${suffix ? ` · ${escapeHtml(suffix)}` : ''}</div></div>`;
  }

  function ensureProfileModal() {
    let modal = byId('socialProfileModal');
    if (modal) return modal;
    modal = document.createElement('div');
    modal.id = 'socialProfileModal';
    modal.className = 'sky-social-profile-backdrop';
    modal.setAttribute('aria-hidden', 'true');
    document.body.appendChild(modal);
    modal.addEventListener('click', onProfileModalClick);
    state.dom.socialProfileModal = modal;
    return modal;
  }

  function openProfile(friendUid, opener) {
    const targetUid = String(friendUid || '');
    const person = state.friends.find(friend => String(friend && friend.uid || '') === targetUid);
    if (!person) {
      notice('好友资料暂不可用，请刷新好友列表后重试', true);
      return false;
    }
    const modal = ensureProfileModal();
    if (!modal.classList.contains('show')) {
      state.profileReturnFocus = opener && typeof opener.focus === 'function'
        ? opener
        : (document.activeElement && typeof document.activeElement.focus === 'function' ? document.activeElement : null);
    }
    const bond = affinityFor(person, state.affinity.get(targetUid));
    const hasBond = Boolean(bond);
    const level = hasBond ? Number(bond.level) || 1 : 0;
    const points = hasBond ? Number(bond.points) || 0 : 0;
    const presence = person.presenceHidden ? '在线状态已隐藏' : (person.online ? '当前在线' : '当前离线');
    const relationship = isCoupleFriend(person) ? '情侣棋友' : '好友';
    const accountName = person.username ? `@${person.username}` : '已添加的棋友';
    const score = Math.max(0, Number(person.score) || 1000);
    const bondLevel = hasBond ? `Lv.${level}` : '未开始';
    const bondPoints = hasBond ? points.toLocaleString() : '—';
    modal.innerHTML = `
      <section class="sky-social-profile-card" role="dialog" aria-modal="true" aria-labelledby="socialProfileName">
        <button type="button" class="sky-social-profile-close" data-profile-close aria-label="关闭个人资料">×</button>
        <div class="sky-social-profile-identity">
          <div class="sky-social-profile-avatar">${avatarMarkup(person, 82)}</div>
          <div class="sky-social-profile-names">
            <span class="sky-social-profile-kicker">晴空棋岛 · 棋友资料</span>
            <h2 id="socialProfileName">${escapeHtml(displayName(person))}</h2>
            <p>${escapeHtml(accountName)}</p>
            <span class="sky-social-profile-relation">${escapeHtml(relationship)} · ${escapeHtml(presence)}</span>
          </div>
        </div>
        <div class="sky-social-profile-stats" aria-label="棋友信息">
          <div><small>棋力积分</small><strong>${score.toLocaleString()}</strong></div>
          <div><small>亲密等级</small><strong>${escapeHtml(bondLevel)}</strong></div>
          <div><small>亲密度</small><strong>${escapeHtml(bondPoints)}</strong></div>
        </div>
        ${bond && bond.fixed ? '<p class="sky-social-profile-note">情侣亲密信息固定为 Lv.521 · 1314</p>' : ''}
        <div class="sky-social-profile-actions">
          <button type="button" data-social-action="chat" data-uid="${attr(targetUid)}">私聊</button>
          <button type="button" data-social-action="invite" data-uid="${attr(targetUid)}">邀请对战</button>
        </div>
      </section>`;
    modal.classList.add('show');
    modal.setAttribute('aria-hidden', 'false');
    const closeButton = modal.querySelector('[data-profile-close]');
    if (closeButton) closeButton.focus();
    return true;
  }

  function closeProfile(restoreFocus) {
    const modal = byId('socialProfileModal');
    if (!modal) return;
    modal.classList.remove('show');
    modal.setAttribute('aria-hidden', 'true');
    const opener = state.profileReturnFocus;
    state.profileReturnFocus = null;
    if (restoreFocus !== false && opener && opener.isConnected && typeof opener.focus === 'function') opener.focus();
  }

  function onProfileModalClick(event) {
    const modal = state.dom.socialProfileModal;
    if (!modal) return;
    if (event.target === modal || event.target.closest('[data-profile-close]')) {
      closeProfile();
      return;
    }
    if (event.target.closest('[data-social-action]')) {
      closeProfile();
      onActionClick(event);
    }
  }

  function onProfileModalKeyDown(event) {
    const modal = state.dom.socialProfileModal;
    if (!modal || !modal.classList.contains('show')) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeProfile();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = Array.from(modal.querySelectorAll(
      'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )).filter(element => element.getClientRects().length > 0);
    if (!focusable.length) {
      event.preventDefault();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !modal.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !modal.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  }

  function card(content) {
    return `<div style="display:flex;align-items:center;gap:8px;padding:9px 4px;border-bottom:1px solid rgba(148,163,184,.28)">${content}</div>`;
  }

  function renderLobbyRoster() {
    const root = byId('skyFriendRoster');
    if (!root) return;
    const count = byId('skyFriendCount');
    if (!isRegistered()) {
      if (count) count.textContent = '登录后同步';
      root.innerHTML = '<div class="sky-friend-roster-empty"><span aria-hidden="true">♙</span><b>登录后显示你的棋友</b><small>好友头像、在线状态和情侣标记会自动同步。</small><button type="button" data-sky-action="profile">登录账号 <span>→</span></button></div>';
      return;
    }
    if (count) count.textContent = `${state.friends.length} 位棋友`;
    if (!state.friends.length) {
      root.innerHTML = '<div class="sky-friend-roster-empty"><span aria-hidden="true">☁</span><b>棋友还没有到齐</b><small>搜索好友账号，邀请熟悉的人来一局。</small><button type="button" data-sky-action="friend-center">查找好友 <span>→</span></button></div>';
      return;
    }
    root.innerHTML = state.friends.slice(0, 4).map(friend => {
      const online = friend.presenceHidden ? '状态已隐藏' : (friend.online ? '在线' : '离线');
      const bond = affinityFor(friend, state.affinity.get(String(friend.uid)));
      const level = bond ? (bond.fixed ? Number(bond.level) : Math.max(1, Math.min(100, Number(bond.level) || 1))) : 0;
      const points = bond ? (bond.fixed ? Number(bond.points) : Math.max(0, Math.min(10000, Number(bond.points) || 0))) : 0;
      const bondMarkup = bond ? `<span class="sky-friend-bond">💞 Lv.${level} · ${points}</span>` : '';
      const unread = Number(friend.unread) > 0 ? ` · ${Math.min(99, Number(friend.unread))} 条未读` : '';
      return `<button type="button" class="sky-friend-preview-row" data-sky-friend-preview data-uid="${attr(friend.uid)}" aria-label="与 ${attr(displayName(friend))} 私聊">
        <span class="sky-friend-preview-avatar">${avatarMarkup(friend)}</span>
        <span class="sky-friend-preview-copy"><strong>${escapeHtml(displayName(friend))}</strong><small><i class="${friend.online ? 'is-online' : ''}"></i>${escapeHtml(online + unread)}</small></span>
        <span class="sky-friend-preview-badges">${coupleBadge(friend)}${bondMarkup}</span><span class="sky-friend-preview-arrow" aria-hidden="true">›</span>
      </button>`;
    }).join('');
    if (!window.ANIME_AVATAR_BOY || !window.ANIME_AVATAR_GIRL) {
      void ensureAvatarAssets().then(loaded => {
        if (loaded && root.isConnected) renderLobbyRoster();
      });
    }
  }

  function onLobbyRosterClick(event) {
    const friend = event.target?.closest?.('[data-sky-friend-preview]');
    if (!friend) return;
    const uid = friend.dataset.uid;
    if (uid) void openChat(uid);
  }

  function renderFriends() {
    const root = byId('socialFriendsList');
    if (!root) return;
    if (!state.friends.length) {
      root.innerHTML = emptyMarkup('还没有好友，输入完整账号名查找吧');
      return;
    }
    root.innerHTML = state.friends.map(friend => {
      const online = friend.presenceHidden ? '状态已隐藏' : (friend.online ? '在线' : '离线');
      const unread = Number(friend.unread) > 0 ? ` · ${Math.min(99, Number(friend.unread))}${Number(friend.unread) > 99 ? '+' : ''} 条未读` : '';
      const id = `data-uid="${attr(friend.uid)}"`;
      const bond = affinityFor(friend, state.affinity.get(String(friend.uid)));
      const bondBadge = bond
        ? `<span class="sky-social-friend-bond" title="打开亲密度详情">💞 Lv.${bond.level} · ${Number(bond.points).toLocaleString()}</span>`
        : '';
      return `<div class="sky-social-friend-row"><div class="sky-social-friend-summary">${personHeading(friend, online + unread, { profile: true })}${bondBadge}</div>` +
        `<div class="sky-social-friend-actions">` +
        button('chat', '私聊', id, 'primary') +
        button('invite', '邀战', id, 'primary') +
        button('delete-friend', '删除', id) +
        button('block', '拉黑', id, 'danger') +
        `</div></div>`;
    }).join('');
  }

  function renderAffinity() {
    const root = byId('socialAffinityList');
    if (!root) return;
    const entries = affinityEntriesForDisplay()
      .sort((left, right) => right.points - left.points || displayName(left).localeCompare(displayName(right), 'zh-CN'));
    const hasFixedCouple = entries.some(friend => friend.fixed === true);
    const rulesText = hasFixedCouple
      ? '已配置的情侣亲密度固定为 1314（Lv.521），不会随私聊变化。'
      : '每条成功发送的好友私聊 +1 点，双方共同累计；每 100 点升 1 级，最高 Lv.100。';
    const rules = `<div style="margin-bottom:8px;padding:9px 10px;border:1px solid #fbcfe8;border-radius:11px;background:linear-gradient(135deg,#fff7fb,#fff);color:#9d174d;font-size:11px;font-weight:800;line-height:1.5;">${rulesText}</div>`;
    if (!entries.length) {
      root.innerHTML = rules + emptyMarkup(state.friends.length ? '和好友成功发送私聊后，好感度会从 0 点开始累计。' : '先添加一位好友，再通过私聊开始累计好感度。');
      return;
    }
    root.innerHTML = rules + entries.map(friend => {
      const fixed = friend.fixed === true;
      const level = fixed ? Number(friend.level) : Math.max(1, Math.min(100, Number(friend.level) || 1));
      const points = fixed ? Number(friend.points) : Math.max(0, Math.min(10000, Number(friend.points) || 0));
      const maxed = !fixed && level >= 100;
      const current = fixed || maxed ? 100 : points % 100;
      const remaining = maxed ? 0 : 100 - current;
      return `<div style="padding:10px 8px;border-bottom:1px solid rgba(148,163,184,.24);"><div style="display:flex;align-items:center;gap:8px;">${personHeading(friend, `Lv.${level} · ${points.toLocaleString()} 点`)}<strong style="flex:none;color:#be185d;font-size:11px;">${fixed ? '🔒 已固定' : (maxed ? '满级' : `还差 ${remaining} 点`)}</strong></div><div style="height:7px;margin:7px 0 0;border-radius:999px;background:#f1f5f9;overflow:hidden;"><span style="display:block;width:${current}%;height:100%;border-radius:inherit;background:linear-gradient(90deg,#f472b6,#db2777);"></span></div><div style="margin-top:4px;color:#94a3b8;font-size:10px;font-weight:700;">${fixed ? '情侣亲密度固定为 1314（Lv.521）' : (maxed ? '已达到当前最高等级' : `距离 Lv.${level + 1}：${current} / 100`)}</div></div>`;
    }).join('');
  }

  function setAffinity(items) {
    const next = new Map();
    (Array.isArray(items) ? items : []).forEach(item => {
      const friendUid = String(item && item.uid || '');
      if (!friendUid) return;
      if (isFixedCoupleAccount(item)) {
        next.set(friendUid, { ...item, uid: friendUid, ...FIXED_COUPLE_AFFINITY });
        return;
      }
      const points = Math.max(0, Math.min(10000, Number(item.points) || 0));
      next.set(friendUid, { ...item, uid: friendUid, points, level: Math.max(1, Math.min(100, Number(item.level) || 1)) });
    });
    state.affinity = next;
    renderFriends();
    renderAffinity();
    renderAffinitySummary();
    return true;
  }

  function renderRequests() {
    const root = byId('socialRequestsList');
    if (!root) return;
    const now = Date.now();
    for (const [inviteId, invite] of state.pendingInvites.entries()) {
      if (Number(invite.expiresAt) > 0 && Number(invite.expiresAt) <= now) state.pendingInvites.delete(inviteId);
    }
    const requestMarkup = state.requests.map(request => {
      const id = `data-request-id="${attr(request.id)}" data-uid="${attr(request.uid)}"`;
      const actions = request.direction === 'incoming'
        ? button('request-accept', '同意', id, 'primary') + button('request-reject', '拒绝', id, 'danger')
        : button('request-cancel', '取消申请', id);
      return card(personHeading(request, request.direction === 'incoming' ? '申请加你为好友' : '等待对方同意') + `<div style="display:flex;gap:4px">${actions}</div>`);
    }).join('');
    const inviteMarkup = Array.from(state.pendingInvites.values()).map(invite => {
      const extra = `data-invite-id="${attr(invite.inviteId)}" data-room-code="${attr(invite.roomCode)}"`;
      const person = state.friends.find(item => String(item.uid) === String(invite.fromUid)) || { uid: invite.fromUid, nickname: '好友' };
      return card(personHeading(person, '向你发起实时对战') + `<div style="display:flex;gap:4px;flex-wrap:wrap;justify-content:flex-end">${button('invite-accept', '接受', extra, 'primary')}${button('invite-reject', '拒绝', extra, 'danger')}${button('invite-busy', '忙碌', extra)}</div>`);
    }).join('');
    root.innerHTML = inviteMarkup + requestMarkup || emptyMarkup('暂无新的好友申请或邀战');
    renderIncomingInviteDialog();
  }

  function getVisibleInvite() {
    const now = Date.now();
    for (const [inviteId, invite] of state.pendingInvites.entries()) {
      if (!invite || (Number(invite.expiresAt) > 0 && Number(invite.expiresAt) <= now)) {
        state.pendingInvites.delete(inviteId);
        state.dismissedInviteIds.delete(inviteId);
        state.inviteActionsPending.delete(inviteId);
        continue;
      }
      if (!state.dismissedInviteIds.has(inviteId)) return { inviteId, invite };
    }
    return null;
  }

  function renderIncomingInviteDialog() {
    const modal = byId('socialInviteModal');
    const content = byId('socialInviteContent');
    if (!modal || !content) return;
    const entry = getVisibleInvite();
    if (!entry) {
      modal.classList.remove('show');
      modal.setAttribute('aria-hidden', 'true');
      content.replaceChildren();
      return;
    }
    const { inviteId, invite } = entry;
    const person = state.friends.find(item => String(item.uid) === String(invite.fromUid)) || invite;
    const actionPending = state.inviteActionsPending.has(inviteId);
    const roomCode = String(invite.roomCode || '');
    const extra = `data-invite-id="${attr(inviteId)}" data-room-code="${attr(roomCode)}"`;
    content.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;">
        <div><div style="color:#54715b;font-size:12px;font-weight:900;letter-spacing:.08em;">晴空棋岛 · 好友邀战</div><h2 id="socialInviteTitle" style="margin:5px 0 0;color:#1d3543;font-size:24px;line-height:1.2;">来下一局吗？</h2></div>
        <button type="button" data-social-action="invite-dismiss" aria-label="稍后处理" style="width:34px;height:34px;flex:none;border:1px solid #d7e0db;border-radius:50%;background:#fff;color:#405b4c;font-size:19px;font-weight:900;">×</button>
      </div>
      <div style="display:flex;align-items:center;gap:10px;margin:18px 0 14px;padding:12px;border:1px solid #d5e2d9;border-radius:16px;background:linear-gradient(135deg,#f8fbf8,#edf5f0);">
        ${avatarMarkup(person)}
        <div style="min-width:0;flex:1;"><strong style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#1d3543;font-size:16px;">${escapeHtml(displayName(person))}</strong><small style="color:#647b6c;font-weight:800;">邀请你加入好友房间</small></div>
      </div>
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 12px;border-radius:12px;background:#f8f2df;color:#5b472a;"><span style="font-size:12px;font-weight:800;">房间号</span><strong style="font-size:22px;letter-spacing:.16em;">${escapeHtml(roomCode)}</strong></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:16px;">
        <button type="button" data-social-action="invite-accept" ${extra} ${actionPending ? 'disabled' : ''} style="grid-column:1/-1;border:0;border-radius:13px;padding:12px 14px;background:linear-gradient(135deg,#6f9275,#496b57);color:white;font-size:15px;font-weight:900;box-shadow:0 4px 0 #34533f;opacity:${actionPending ? '.65' : '1'};">${actionPending ? '正在处理…' : '接受并加入'}</button>
        <button type="button" data-social-action="invite-reject" ${extra} ${actionPending ? 'disabled' : ''} style="border:1px solid #d4ddd7;border-radius:11px;padding:10px;background:#fff;color:#405b4c;font-weight:900;">拒绝</button>
        <button type="button" data-social-action="invite-busy" ${extra} ${actionPending ? 'disabled' : ''} style="border:1px solid #d4ddd7;border-radius:11px;padding:10px;background:#fff;color:#64748b;font-weight:900;">稍后再约</button>
      </div>
      <small style="display:block;margin-top:12px;text-align:center;color:#829087;font-weight:700;">邀战两分钟内有效，接受后自动进入棋局</small>`;
    modal.classList.add('show');
    modal.setAttribute('aria-hidden', 'false');
  }

  function renderRecent() {
    const root = byId('socialRecentList');
    if (!root) return;
    if (!state.recent.length) {
      root.innerHTML = emptyMarkup('完成实名联机对局后，对手会出现在这里');
      return;
    }
    const friendIds = new Set(state.friends.map(item => String(item.uid)));
    root.innerHTML = state.recent.map(person => {
      const id = `data-uid="${attr(person.uid)}" data-username="${attr(person.username || '')}"`;
      const when = person.last_played_at ? new Date(Number(person.last_played_at)).toLocaleDateString() : '';
      const count = Number(person.games_count) || 1;
      const add = friendIds.has(String(person.uid)) ? button('chat', '私聊', id, 'primary') : button('request', '加好友', id, 'primary');
      return card(personHeading(person, `${count} 局${when ? ' · ' + when : ''}`) + `<div style="display:flex;gap:4px">${add}${button('block', '拉黑', id, 'danger')}</div>`);
    }).join('');
  }

  function renderBlocks() {
    const root = byId('socialBlocksList');
    if (!root) return;
    if (!state.blocks.length) {
      root.innerHTML = emptyMarkup('黑名单为空');
      return;
    }
    root.innerHTML = state.blocks.map(person => card(
      personHeading(person, '已拉黑') + button('unblock', '解除拉黑', `data-uid="${attr(person.uid)}"`)
    )).join('');
  }

  function renderSearch() {
    const root = byId('socialSearchResult');
    if (!root) return;
    const person = state.searchResult;
    if (!person) {
      root.innerHTML = '';
      root.style.display = 'none';
      return;
    }
    const extra = `data-uid="${attr(person.uid)}" data-username="${attr(person.username || '')}" data-request-id="${attr(person.requestId || '')}"`;
    let action = button('request', '申请好友', extra, 'primary');
    if (person.relationship === 'friend') action = button('chat', '发消息', extra, 'primary');
    if (person.relationship === 'outgoing') action = '<span style="font-size:12px;color:#64748b">申请已发送</span>';
    if (person.relationship === 'incoming') action = button('request-accept', '同意申请', extra, 'primary');
    root.innerHTML = card(personHeading(person, `${Number(person.score) || 1000} 分`) + action);
    root.style.display = '';
  }

  function switchTab(name) {
    const selected = ['friends', 'affinity', 'requests', 'recent', 'blocks'].includes(name) ? name : 'friends';
    cacheDom();
    const roots = {
      friends: byId('socialFriendsList'),
      affinity: byId('socialAffinityList'),
      requests: byId('socialRequestsList'),
      recent: byId('socialRecentList'),
      blocks: byId('socialBlocksList')
    };
    Object.entries(roots).forEach(([key, root]) => {
      if (root) root.style.display = key === selected ? '' : 'none';
    });
    state.dom.socialTabs.forEach(tab => {
      tab.classList.toggle('active', tab.dataset.socialTab === selected);
    });
  }

  function updateUnreadBadge() {
    const friendTotal = state.friends.reduce((sum, friend) => sum + (Number(friend.unread) || 0), 0) + state.requests.filter(item => item.direction === 'incoming').length + state.pendingInvites.size;
    const shared = window.GomokuSocialUnreadState || (window.GomokuSocialUnreadState = { world: 0, announcements: 0 });
    // 让世界频道/公告的统一刷新知道好友基数，避免它们刷新时重复叠加或覆盖好友未读。
    shared.friends = Math.max(0, friendTotal);
    const worldTotal = Math.max(0, Number(shared.world) || 0);
    const announcementTotal = Math.max(0, Number(shared.announcements) || 0);
    const total = Math.min(999, friendTotal + worldTotal + announcementTotal);
    const text = total > 99 ? '99+' : String(total || '');
    const label = total > 0
      ? `${total} 条${worldTotal > 0 || announcementTotal > 0 ? '社交' : '好友'}动态`
      : '没有好友动态';
    ['socialUnreadBadge', 'gameFriendsUnreadBadge', 'gameDockUnreadBadge'].forEach(id => {
      const badge = byId(id);
      if (!badge) return;
      badge.dataset.socialUnreadBase = String(friendTotal);
      badge.dataset.socialUnreadRendered = String(total);
      badge.dataset.socialUnreadWorld = String(worldTotal);
      badge.dataset.socialUnreadAnnouncements = String(announcementTotal);
      badge.textContent = text;
      badge.style.display = total > 0 ? 'inline-flex' : 'none';
      badge.setAttribute('aria-hidden', String(total <= 0));
      badge.setAttribute('aria-label', label);
      badge.setAttribute('title', label);
    });
    const friendsButton = byId('btnGameFriends');
    if (friendsButton) {
      const baseLabel = friendsButton.querySelector('#gameFriendsButtonLabel')?.textContent || '👥 好友';
      friendsButton.setAttribute('aria-label', total > 0 ? `${baseLabel}，${label}` : `${baseLabel}，打开好友、私聊与亲密关系`);
    }
    const fab = byId('gameSocialDockFab');
    if (fab) {
      const fabLabel = total > 0 ? `展开八个游戏功能按钮，${label}` : '展开八个游戏功能按钮';
      fab.setAttribute('aria-label', fabLabel);
      fab.setAttribute('title', fabLabel);
    }
    state.lastUnreadTotal = total;
    try {
      if (typeof window.GomokuSocialUnreadRefresh === 'function') window.GomokuSocialUnreadRefresh();
    } catch (_) {}
  }

  function requestNotificationPermission() {
    try {
      if (typeof AndroidNativeApp !== 'undefined' && typeof AndroidNativeApp.requestSocialNotificationPermission === 'function') {
        AndroidNativeApp.requestSocialNotificationPermission();
      }
    } catch (_) {}
    try {
      if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
        const result = Notification.requestPermission();
        if (result && typeof result.catch === 'function') result.catch(() => {});
      }
    } catch (_) {}
  }

  function notifyIncomingMessage(event) {
    const fromUid = String(event?.fromUid || '');
    const messageId = String(event?.messageId || '');
    if (state.currentChat && fromUid && String(state.currentChat.uid) === fromUid) return;
    if (messageId && state.lastNotifiedMessageId === messageId) return;
    if (messageId) state.lastNotifiedMessageId = messageId;
    const now = Date.now();
    if (now - state.lastMessageSoundAt >= 1000) {
      playSocialSound('message');
      state.lastMessageSoundAt = now;
    }
    const title = '五子棋 · 好友消息';
    const body = '你有新的好友消息，打开游戏查看';
    try {
      if (typeof AndroidNativeApp !== 'undefined' && typeof AndroidNativeApp.showSocialNotification === 'function') {
        AndroidNativeApp.showSocialNotification();
      }
    } catch (_) {}
    try {
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted' && document.hidden) {
        const notification = new Notification(title, { body, tag: `gomoku-social-message-${messageId || 'new'}` });
        notification.onclick = () => {
          try { window.focus(); } catch (_) {}
          try { window.openFriendsModal(); } catch (_) {}
          notification.close();
        };
      }
    } catch (_) {}
  }

  function notifyUnreadSnapshot(total, previousTotal) {
    const current = Math.max(0, Number(total) || 0);
    const previous = Math.max(0, Number(previousTotal) || 0);
    if (!state.hasUnreadSnapshot) {
      state.hasUnreadSnapshot = true;
      state.lastNotifiedUnreadTotal = current;
      if (current > 0) notifyIncomingMessage({ kind: 'message', fromUid: '', messageId: `unread-${uid()}-${current}-${Date.now()}` });
      return;
    }
    if (current < state.lastNotifiedUnreadTotal) state.lastNotifiedUnreadTotal = current;
    if (current <= previous || current <= state.lastNotifiedUnreadTotal) return;
    state.lastNotifiedUnreadTotal = current;
    notifyIncomingMessage({ kind: 'message', fromUid: '', messageId: `unread-${uid()}-${current}-${Date.now()}` });
  }

  function renderAll() {
    renderFriends();
    renderLobbyRoster();
    renderAffinity();
    renderAffinitySummary();
    renderRequests();
    renderRecent();
    renderBlocks();
    renderSearch();
    updateUnreadBadge();
  }

  function syncSettings(data) {
    const presence = byId('socialPresenceHidden');
    const metrics = byId('socialMetricsEnabled');
    if (presence) presence.checked = data.presenceHidden === true;
    if (metrics) metrics.checked = data.metricsEnabled !== false;
    try { localStorage.setItem('gomoku_metrics_enabled', data.metricsEnabled === false ? '0' : '1'); } catch (_) {}
  }

  async function refresh(options) {
    if (!isRegistered()) return false;
    if (state.refreshPromise) return state.refreshPromise;
    const quiet = options && options.quiet;
    const lifecycle = state.lifecycle;
    const previousUnreadTotal = state.lastUnreadTotal;
    const request = Promise.all([
      api('/api/friends'),
      api('/api/recent-opponents'),
      api('/api/blocks')
    ]).then(([friendsResult, recentResult, blocksResult]) => {
      if (lifecycle !== state.lifecycle || state.stopping || !state.started) return false;
      const social = friendsResult.data || {};
      const previousInviteIds = new Set(state.pendingInvites.keys());
      const previousIncomingRequestIds = new Set(state.requests
        .filter(request => request.direction === 'incoming')
        .map(request => String(request.id)));
      state.friends = Array.isArray(social.friends) ? social.friends : [];
      state.requests = Array.isArray(social.requests) ? social.requests : [];
      state.recent = Array.isArray(recentResult.data) ? recentResult.data : [];
      state.blocks = Array.isArray(blocksResult.data) ? blocksResult.data : [];
      const syncedInvites = Array.isArray(social.invites) ? social.invites
        : (Array.isArray(social.pendingInvites) ? social.pendingInvites : null);
      let receivedInvite = false;
      if (syncedInvites) {
        const now = Date.now();
        const nextInvites = new Map(syncedInvites
          .filter(invite => invite && invite.inviteId && Number(invite.expiresAt) > now && /^\d{6}$/.test(String(invite.roomCode || '')))
          .map(invite => [String(invite.inviteId), invite]));
        receivedInvite = Array.from(nextInvites.keys()).some(inviteId => !previousInviteIds.has(inviteId));
        state.pendingInvites = nextInvites;
        for (const inviteId of state.dismissedInviteIds) {
          if (!state.pendingInvites.has(inviteId)) state.dismissedInviteIds.delete(inviteId);
        }
        if (receivedInvite) playSocialSound('invite');
      }
      const receivedFriendRequest = state.requests.some(request => request.direction === 'incoming'
        && !previousIncomingRequestIds.has(String(request.id)));
      if (!receivedInvite && receivedFriendRequest) playSocialSound('friendRequest');
      syncSettings(social);
      renderAll();
      notifyUnreadSnapshot(state.lastUnreadTotal, previousUnreadTotal);
      return true;
    }).catch(error => {
      if (!quiet) notice(error.message || '好友列表加载失败', true);
      return false;
    });
    state.refreshPromise = request;
    request.then(() => {
      if (state.refreshPromise === request) state.refreshPromise = null;
    }, () => {
      if (state.refreshPromise === request) state.refreshPromise = null;
    });
    return request;
  }

  function invalidateSearch() {
    state.searchGeneration += 1;
    if (state.searchTimer) clearTimeout(state.searchTimer);
    state.searchTimer = null;
    if (state.searchController) {
      try { state.searchController.abort(); } catch (_) {}
    }
    state.searchController = null;
    state.searchPromise = null;
    state.searchPendingUsername = '';
    return state.searchGeneration;
  }

  function clearSearchResult() {
    state.searchResult = null;
    state.searchUsername = '';
    state.searchAt = 0;
    renderSearch();
  }

  function executeSearch(username, generation, quiet) {
    const query = String(username || '').trim();
    if (!query || query.length > 32) return Promise.resolve(false);
    if (generation !== state.searchGeneration) return Promise.resolve(false);
    if (state.searchPromise && state.searchPendingUsername === query) return state.searchPromise;
    if (state.searchUsername === query && state.searchAt > 0 && Date.now() - state.searchAt < SEARCH_CACHE_TTL_MS) {
      renderSearch();
      return Promise.resolve(Boolean(state.searchResult));
    }

    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    state.searchController = controller;
    state.searchPendingUsername = query;
    const request = api(makeQuery('/api/friends/search', { username: query }), controller ? { signal: controller.signal } : undefined)
      .then(result => {
        // safeApiFetch 的旧版实现不一定接收 signal，因此还要用 generation
        // 做结果隔离，避免慢请求覆盖用户刚输入的新账号名。
        if (generation !== state.searchGeneration || controller?.signal.aborted) return false;
        state.searchResult = result.data || null;
        state.searchUsername = query;
        state.searchAt = Date.now();
        renderSearch();
        return Boolean(state.searchResult);
      })
      .catch(error => {
        if (generation !== state.searchGeneration || controller?.signal.aborted) return false;
        state.searchResult = null;
        state.searchUsername = query;
        state.searchAt = Date.now();
        renderSearch();
        if (!quiet) notice(error.message || '未找到可添加的账号', true);
        return false;
      });
    state.searchPromise = request;
    request.then(() => {
      if (state.searchPromise === request) {
        state.searchPromise = null;
        state.searchPendingUsername = '';
        state.searchController = null;
      }
    }, () => {
      if (state.searchPromise === request) {
        state.searchPromise = null;
        state.searchPendingUsername = '';
        state.searchController = null;
      }
    });
    return request;
  }

  function scheduleSearch() {
    if (!isRegistered()) {
      invalidateSearch();
      clearSearchResult();
      return;
    }
    const input = byId('socialSearchInput');
    const username = String(input && input.value || '').trim();
    const generation = invalidateSearch();
    if (state.searchUsername !== username) clearSearchResult();
    if (!username || username.length > 32 || username.length < 2) return;
    state.searchTimer = setTimeout(() => {
      state.searchTimer = null;
      executeSearch(username, generation, true);
    }, SEARCH_DEBOUNCE_MS);
  }

  async function search() {
    if (!requireAccount()) return false;
    const input = byId('socialSearchInput');
    const username = String(input && input.value || '').trim();
    const generation = invalidateSearch();
    if (!username || username.length > 32) {
      clearSearchResult();
      notice('请输入对方完整账号名', true);
      return false;
    }
    return executeSearch(username, generation, false);
  }

  async function sendFriendRequest(username) {
    if (!requireAccount()) return;
    const targetUsername = String(username || state.searchResult?.username || '').trim();
    if (!targetUsername) return notice('缺少对方账号名', true);
    if (state.pendingRequests.has(targetUsername)) return;
    state.pendingRequests.add(targetUsername);
    try {
      const result = await api('/api/friends/requests', {
        method: 'POST', body: JSON.stringify({ targetUsername })
      });
      notice(result.data?.accepted ? '🎉 已自动成为好友' : '📨 好友申请已发送', false);
      await refresh({ quiet: true });
      if (state.searchResult && state.searchResult.username === targetUsername) {
        state.searchResult.relationship = result.data?.accepted ? 'friend' : 'outgoing';
        state.searchResult.requestId = result.data?.requestId || state.searchResult.requestId;
        renderSearch();
      }
    } catch (error) {
      notice(error.message, true);
    } finally {
      state.pendingRequests.delete(targetUsername);
    }
  }

  async function requestAction(requestId, action) {
    if (!requestId || !['accept', 'reject', 'cancel'].includes(action)) return;
    try {
      await api(`/api/friends/requests/${encodeURIComponent(requestId)}/${action}`, { method: 'POST' });
      notice(action === 'accept' ? '🎉 已成为好友' : action === 'cancel' ? '已取消好友申请' : '已拒绝好友申请', false);
      state.searchResult = null;
      await refresh({ quiet: true });
    } catch (error) {
      notice(error.message, true);
    }
  }

  function confirmAction(message, options) {
    return new Promise(resolve => {
      if (typeof showCustomConfirm === 'function') {
        showCustomConfirm(message, () => resolve(true), () => resolve(false), options || {});
      } else {
        resolve(false);
      }
    });
  }

  async function deleteFriend(friendUid) {
    const friend = state.friends.find(item => String(item.uid) === String(friendUid));
    if (!await confirmAction(`确定删除好友【${displayName(friend)}】吗？`, { title: '删除好友', icon: '👋' })) return;
    try {
      await api(`/api/friends/${encodeURIComponent(friendUid)}`, { method: 'DELETE' });
      if (state.currentChat && String(state.currentChat.uid) === String(friendUid)) closeChat();
      notice('好友已删除', false);
      await refresh({ quiet: true });
    } catch (error) { notice(error.message, true); }
  }

  async function blockUser(friendUid) {
    const person = [...state.friends, ...state.recent].find(item => String(item.uid) === String(friendUid));
    if (!await confirmAction(`拉黑【${displayName(person)}】后将解除好友关系，并阻止私聊和邀战。`, { title: '加入黑名单', icon: '🚫', okText: '确认拉黑' })) return;
    try {
      await api('/api/blocks', { method: 'POST', body: JSON.stringify({ targetUid: friendUid }) });
      if (state.currentChat && String(state.currentChat.uid) === String(friendUid)) closeChat();
      notice('已加入黑名单', false);
      await refresh({ quiet: true });
    } catch (error) { notice(error.message, true); }
  }

  async function unblockUser(friendUid) {
    try {
      await api('/api/blocks', { method: 'DELETE', body: JSON.stringify({ targetUid: friendUid }) });
      notice('已解除拉黑；好友关系不会自动恢复', false);
      await refresh({ quiet: true });
    } catch (error) { notice(error.message, true); }
  }

  function closeChat() {
    const modal = byId('socialChatModal');
    if (modal) modal.classList.remove('show');
    if (state.chatRefreshTimer) clearInterval(state.chatRefreshTimer);
    state.chatRefreshTimer = null;
    state.chatGeneration += 1;
    state.chatRefreshPending = false;
    state.currentChat = null;
    state.messages = [];
    state.chatOldestId = 0;
    state.chatHasMore = false;
    state.chatLoading = false;
    state.chatLoadingOlder = false;
  }

  function renderMessages(scrollToBottom) {
    const root = byId('socialChatMessages');
    if (!root) return;
    if (!state.messages.length) {
      root.innerHTML = emptyMarkup('还没有消息，来打个招呼吧');
      return;
    }
    const myUid = uid();
    const older = state.chatHasMore
      ? `<div style="text-align:center;margin:2px 0 6px">${button('load-older-messages', state.chatLoadingOlder ? '正在加载…' : '加载更早消息', state.chatLoadingOlder ? 'disabled' : '')}</div>`
      : '';
    root.innerHTML = older + state.messages.map(message => {
      const mine = String(message.sender_uid) === myUid;
      const time = message.created_at ? new Date(Number(message.created_at)).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
      return `<div style="display:flex;justify-content:${mine ? 'flex-end' : 'flex-start'};margin:7px 0"><div style="max-width:82%;padding:7px 10px;border-radius:${mine ? '12px 12px 3px 12px' : '12px 12px 12px 3px'};background:${mine ? '#dbeafe' : '#f1f5f9'};color:#1e293b;word-break:break-word;white-space:pre-wrap"><div>${escapeHtml(message.body || '')}</div><div style="font-size:9px;color:#94a3b8;text-align:right;margin-top:2px">${escapeHtml(time)}</div></div></div>`;
    }).join('');
    if (scrollToBottom !== false) root.scrollTop = root.scrollHeight;
  }

  function latestChatMessageId(messages) {
    return (messages || state.messages).reduce((max, message) => Math.max(max, Number(message && message.id) || 0), 0);
  }

  function mergeChatMessages(existing, incoming) {
    const byId = new Map();
    for (const message of [...(existing || []), ...(incoming || [])]) {
      if (message && Number(message.id) > 0) byId.set(String(message.id), message);
    }
    return Array.from(byId.values()).sort((left, right) => Number(left.id) - Number(right.id));
  }

  function stopChatRefresh() {
    if (state.chatRefreshTimer) clearInterval(state.chatRefreshTimer);
    state.chatRefreshTimer = null;
  }

  function startChatRefresh() {
    stopChatRefresh();
    state.chatRefreshTimer = setInterval(() => {
      const modal = byId('socialChatModal');
      if (!state.currentChat || !modal || !modal.classList.contains('show') || document.hidden) return;
      loadChat({ incremental: true, quiet: true });
    }, CHAT_REFRESH_INTERVAL_MS);
  }

  async function loadChat(options) {
    if (!state.currentChat) return false;
    const config = options || {};
    const older = config.older === true;
    const incremental = config.incremental === true;
    if (state.chatLoading) {
      if (!older) state.chatRefreshPending = true;
      return false;
    }
    if (older && !state.chatHasMore) return;
    const chatUid = String(state.currentChat.uid);
    const generation = state.chatGeneration;
    const root = byId('socialChatMessages');
    const previousHeight = root ? root.scrollHeight : 0;
    const wasAtBottom = !root || root.scrollHeight - root.scrollTop - root.clientHeight < 48;
    state.chatLoading = true;
    state.chatLoadingOlder = older;
    if (older) renderMessages(false);
    try {
      const params = { friendUid: chatUid, limit: 50 };
      if (older && state.chatOldestId > 0) params.before = state.chatOldestId;
      if (incremental) params.after = latestChatMessageId();
      const result = await api(makeQuery('/api/messages', params));
      if (generation !== state.chatGeneration || !state.currentChat || String(state.currentChat.uid) !== chatUid) return false;
      const page = Array.isArray(result.data) ? result.data : [];
      if (older) state.messages = mergeChatMessages(page, state.messages);
      else if (incremental) state.messages = mergeChatMessages(state.messages, page);
      else state.messages = page;
      state.chatOldestId = state.messages.reduce((min, message) => {
        const id = Number(message.id) || 0;
        return id > 0 && (min === 0 || id < min) ? id : min;
      }, 0);
      if (!incremental) state.chatHasMore = page.length >= 50;
      state.chatLoadingOlder = false;
      if (!incremental || page.length > 0) renderMessages(older ? false : (!incremental || wasAtBottom));
      if (older && root) root.scrollTop = Math.max(0, root.scrollHeight - previousHeight);
      const lastId = state.messages.reduce((max, message) => Math.max(max, Number(message.id) || 0), 0);
      if (!older && page.length > 0 && lastId) {
        const friend = state.friends.find(item => String(item.uid) === chatUid);
        if (friend) friend.unread = 0;
        renderFriends();
        updateUnreadBadge();
        api('/api/messages/read', { method: 'POST', body: JSON.stringify({ friendUid: chatUid, lastMessageId: lastId }) })
          .catch(() => { if (generation === state.chatGeneration) refresh({ quiet: true }); });
      }
      return true;
    } catch (error) {
      if (generation === state.chatGeneration) {
        if (!config.quiet) notice(error.message || '聊天记录加载失败', true);
        state.chatLoadingOlder = false;
        if (older && state.currentChat && String(state.currentChat.uid) === chatUid) renderMessages(false);
      }
      return false;
    } finally {
      if (generation === state.chatGeneration) {
        state.chatLoading = false;
        state.chatLoadingOlder = false;
        if (state.chatRefreshPending) {
          state.chatRefreshPending = false;
          setTimeout(() => {
            if (generation === state.chatGeneration && state.currentChat && String(state.currentChat.uid) === chatUid) {
              loadChat({ incremental: true, quiet: true });
            }
          }, 0);
        }
      }
    }
  }

  function ensureChatControls() {
    const input = byId('socialChatInput');
    const modal = byId('socialChatModal');
    if (!input || !modal) return;
    input.maxLength = MESSAGE_LIMIT;
    if (!modal.querySelector('[data-social-generated-quick]')) {
      const quick = document.createElement('div');
      quick.setAttribute('data-social-generated-quick', '1');
      quick.style.cssText = 'display:flex;gap:5px;flex-wrap:wrap;margin:6px 0 2px';
      quick.innerHTML = ['你好！', '来一局？', '精彩对局！'].map(text =>
        button('quick-message', text, `data-text="${attr(text)}"`)
      ).join('');
      input.parentNode && input.parentNode.parentNode && input.parentNode.parentNode.insertBefore(quick, input.parentNode);
    }
    if (!modal.querySelector('[data-social-generated-toolbar]') &&
        !modal.querySelector('[data-social-action="send-message"]') &&
        !modal.querySelector('[onclick*="sendMessage"]')) {
      const toolbar = document.createElement('div');
      toolbar.setAttribute('data-social-generated-toolbar', '1');
      toolbar.style.cssText = 'display:flex;gap:6px;justify-content:flex-end;margin-top:6px';
      toolbar.innerHTML = button('clear-chat', '清空我的记录', '', 'danger') + button('send-message', '发送', '', 'primary');
      input.parentNode && input.parentNode.appendChild(toolbar);
    }
  }

  async function openChat(friend) {
    if (!requireAccount()) return;
    const friendUid = typeof friend === 'object' ? friend.uid : friend;
    const record = typeof friend === 'object' ? friend : state.friends.find(item => String(item.uid) === String(friendUid));
    if (!friendUid || !record) return notice('好友资料不存在，请刷新后重试', true);
    stopChatRefresh();
    state.chatGeneration += 1;
    state.chatRefreshPending = false;
    state.chatLoading = false;
    state.chatLoadingOlder = false;
    state.currentChat = record;
    state.messages = [];
    state.chatOldestId = 0;
    state.chatHasMore = false;
    state.chatLoading = false;
    const title = byId('socialChatTitle');
    if (title) title.textContent = `与 ${displayName(record)} 私聊`;
    const modal = byId('socialChatModal');
    if (modal) modal.classList.add('show');
    ensureChatControls();
    renderMessages();
    startChatRefresh();
    await loadChat();
    const input = byId('socialChatInput');
    if (input) input.focus();
  }

  function newClientMessageId() {
    try {
      const bytes = new Uint8Array(12);
      crypto.getRandomValues(bytes);
      return 'msg_' + Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
    } catch (_) {
      return 'msg_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
    }
  }

  async function sendMessage(text) {
    if (!state.currentChat) return;
    const input = byId('socialChatInput');
    const value = String(text == null ? (input && input.value || '') : text).trim();
    if (!value) return;
    // 与 HTML maxlength 和后端 String.slice 的 UTF-16 计数保持一致，避免表情消息被服务端静默截断。
    if (value.length > MESSAGE_LIMIT) {
      notice(`消息最多 ${MESSAGE_LIMIT} 个字符`, true);
      return;
    }
    if (input) input.disabled = true;
    try {
      const result = await api('/api/messages', {
        method: 'POST',
        body: JSON.stringify({ receiverUid: state.currentChat.uid, text: value, clientMessageId: newClientMessageId() })
      });
      if (input) input.value = '';
      if (result.data) state.messages.push(result.data);
      renderMessages();
      if (typeof window.scheduleGameAffinityRefresh === 'function') {
        window.scheduleGameAffinityRefresh();
      }
    } catch (error) {
      notice(error.message || '消息发送失败', true);
    } finally {
      if (input) { input.disabled = false; input.focus(); }
    }
  }

  async function clearChat() {
    if (!state.currentChat) return;
    if (!await confirmAction('只会清空你这一侧看到的聊天记录，对方的记录不受影响。', { title: '清空聊天', icon: '🗑️', okText: '清空我的记录' })) return;
    try {
      await api('/api/messages/clear', { method: 'POST', body: JSON.stringify({ friendUid: state.currentChat.uid }) });
      state.messages = [];
      state.chatOldestId = 0;
      state.chatHasMore = false;
      renderMessages();
      notice('已清空你的聊天记录', false);
    } catch (error) { notice(error.message, true); }
  }

  async function inviteFriend(friendUid) {
    if (!requireAccount()) return;
    try {
      if (typeof window.ensureGomokuFeature === 'function') await window.ensureGomokuFeature('online');
      if (typeof activeOnlineGuestUid !== 'undefined' && activeOnlineGuestUid) {
        notice('当前已有对手在房间中，暂时不能发起新的邀战', true);
        return;
      }
      if (typeof initHostPeer !== 'function') throw new Error('联机房间功能尚未加载');
      await initHostPeer(null, false);
      const roomCode = typeof currentRoomCode !== 'undefined' ? String(currentRoomCode || '') : '';
      if (!/^\d{6}$/.test(roomCode)) throw new Error('房间尚未准备好，请稍后重试');
      await api('/api/game-invites', { method: 'POST', body: JSON.stringify({ friendUid, roomCode }) });
      notice(`⚔️ 邀战已发送，房间码 ${roomCode}`, false);
      const modal = byId('friendsModal');
      if (modal) modal.classList.remove('show');
      if (typeof openOnlineModal === 'function') openOnlineModal('create');
    } catch (error) {
      notice(error.message || '邀战发送失败', true);
    }
  }

  function isBusyInGame() {
    try {
      return typeof gameMode !== 'undefined' && gameMode === 'online' && typeof activeOnlineGuestUid !== 'undefined' && Boolean(activeOnlineGuestUid);
    } catch (_) {
      return false;
    }
  }

  async function respondInvite(inviteId, response, roomCode) {
    if (!['accepted', 'rejected', 'busy'].includes(response)) return;
    const normalizedInviteId = String(inviteId || '');
    if (!normalizedInviteId || state.inviteActionsPending.has(normalizedInviteId)) return;
    if (response === 'accepted' && isBusyInGame()) {
      notice('你正在联机对局中，已向好友回复忙碌', true);
      response = 'busy';
    }
    state.inviteActionsPending.add(normalizedInviteId);
    renderIncomingInviteDialog();
    try {
      const result = await api(`/api/game-invites/${encodeURIComponent(normalizedInviteId)}/respond`, {
        method: 'POST', body: JSON.stringify({ response })
      });
      state.pendingInvites.delete(normalizedInviteId);
      state.dismissedInviteIds.add(normalizedInviteId);
      state.inviteActionsPending.delete(normalizedInviteId);
      renderRequests();
      updateUnreadBadge();
      if (response === 'accepted') {
        if (typeof window.ensureGomokuFeature === 'function') await window.ensureGomokuFeature('online');
        const code = String(result.data?.roomCode || roomCode || '');
        if (!/^\d{6}$/.test(code)) throw new Error('邀战房间码无效');
        const friendsModal = byId('friendsModal');
        if (friendsModal) friendsModal.classList.remove('show');
        if (typeof joinOnlineRoom !== 'function') throw new Error('联机加入功能尚未加载');
        await joinOnlineRoom(code);
      } else {
        notice(response === 'busy' ? '已回复：正在忙碌' : '已拒绝邀战', false);
      }
    } catch (error) {
      state.inviteActionsPending.delete(normalizedInviteId);
      renderIncomingInviteDialog();
      notice(error.message || '邀战处理失败', true);
    }
  }

  function dismissInvite() {
    const entry = getVisibleInvite();
    if (!entry) return;
    state.dismissedInviteIds.add(entry.inviteId);
    renderIncomingInviteDialog();
  }

  async function recordOpponent(opponentUid) {
    if (!isRegistered() || !opponentUid || String(opponentUid) === uid()) return false;
    try {
      await api('/api/recent-opponents', { method: 'POST', body: JSON.stringify({ opponentUid: String(opponentUid) }) });
      return true;
    } catch (_) {
      return false;
    }
  }

  async function saveSettings() {
    if (!isRegistered()) return;
    const presenceHidden = Boolean(byId('socialPresenceHidden')?.checked);
    const metricsEnabled = byId('socialMetricsEnabled')?.checked !== false;
    try {
      await api('/api/social/settings', { method: 'POST', body: JSON.stringify({ presenceHidden, metricsEnabled }) });
      try { localStorage.setItem('gomoku_metrics_enabled', metricsEnabled ? '1' : '0'); } catch (_) {}
      notice('好友隐私设置已保存', false);
      await refresh({ quiet: true });
    } catch (error) { notice(error.message, true); }
  }

  function socketUrl(ticketResponseUrl, ticket) {
    const routing = window.GomokuBackendRouting;
    const responseUrl = String(ticketResponseUrl || '');
    const host = (routing && responseUrl && routing.getHostForUrl(responseUrl))
      || (routing && routing.getActiveHost())
      || (typeof activeApiHost !== 'undefined' ? activeApiHost : '');
    const routedUrl = routing && host ? routing.socketUrl('/api/social/socket', host) : '';
    const url = new URL(routedUrl || '/api/social/socket', routedUrl ? undefined : (responseUrl || host));
    url.searchParams.set('ticket', ticket);
    return url.href;
  }

  function clearSocketTimers() {
    if (state.socketRetryTimer) clearTimeout(state.socketRetryTimer);
    if (state.socketPingTimer) clearInterval(state.socketPingTimer);
    state.socketRetryTimer = null;
    state.socketPingTimer = null;
  }

  function setConnectionStatus(text, connected) {
    const status = byId('socialConnectionStatus');
    if (!status) return;
    status.textContent = text;
    status.style.color = connected ? '#059669' : '#64748b';
  }

  function scheduleSocketReconnect() {
    if (!state.started || state.stopping || !isRegistered()) return;
    if (state.socketRetryTimer) return;
    const index = Math.min(state.socketRetry, SOCKET_RETRY_DELAYS.length - 1);
    const delay = SOCKET_RETRY_DELAYS[index];
    state.socketRetry += 1;
    setConnectionStatus('好友实时连接正在恢复…', false);
    state.socketRetryTimer = setTimeout(() => {
      state.socketRetryTimer = null;
      connectSocket();
    }, delay);
  }

  async function connectSocket() {
    if (!state.started || state.stopping || !isRegistered()) return;
    if (state.socketConnecting) return;
    if (state.socket && (state.socket.readyState === WebSocket.OPEN || state.socket.readyState === WebSocket.CONNECTING)) return;
    state.socketConnecting = true;
    let ticketResponseUrl = '';
    try {
      const result = await api('/api/social/socket-ticket', { method: 'POST' });
      if (!state.started || state.stopping) return;
      ticketResponseUrl = result.response && result.response.url ? result.response.url : '';
      const routing = window.GomokuBackendRouting;
      const origin = (routing && ticketResponseUrl && routing.getHostForUrl(ticketResponseUrl))
        || (typeof activeApiHost !== 'undefined' ? activeApiHost : '');
      const ticket = String(result.data?.ticket || '');
      if (!origin || !/^[A-Fa-f0-9]{48}$/.test(ticket)) throw new Error('好友连接票据无效');
      state.ticketOrigin = origin;
      const socket = new WebSocket(socketUrl(ticketResponseUrl, ticket));
      state.socket = socket;
      socket.onopen = () => {
        if (state.socket !== socket) return;
        state.socketRetry = 0;
        setConnectionStatus('好友状态已实时连接', true);
        if (state.currentChat) loadChat({ incremental: true, quiet: true });
        state.socketPingTimer = setInterval(() => {
          if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'ping', sentAt: Date.now() }));
        }, 20000);
      };
      socket.onmessage = event => handleSocketMessage(event.data);
      socket.onerror = () => {};
      socket.onclose = event => {
        if (state.socket === socket) state.socket = null;
        if (state.socketPingTimer) clearInterval(state.socketPingTimer);
        state.socketPingTimer = null;
        const intentionalClose = state.stopping || Number(event?.code) === 1000 || Number(event?.code) === 1001;
        if (!intentionalClose && ticketResponseUrl) window.GomokuBackendRouting?.markFailureForUrl(ticketResponseUrl);
        if (state.stopping) return;
        setConnectionStatus('好友实时连接已断开，正在重连…', false);
        scheduleSocketReconnect();
      };
    } catch (_) {
      setConnectionStatus('好友实时连接暂不可用，列表仍可使用', false);
      scheduleSocketReconnect();
    } finally {
      state.socketConnecting = false;
    }
  }

  function handleSocketMessage(raw) {
    let message = null;
    try { message = JSON.parse(String(raw || '')); } catch (_) { return; }
    if (!message || message.type !== 'social_event' || !message.event) return;
    const event = message.event;
    if (event.kind === 'game_invite' && event.inviteId && /^\d{6}$/.test(String(event.roomCode || ''))) {
      const inviteId = String(event.inviteId);
      if (Number(event.expiresAt) > 0 && Number(event.expiresAt) <= Date.now()) return;
      const isNewInvite = !state.pendingInvites.has(inviteId);
      if (isNewInvite) {
        state.pendingInvites.set(inviteId, { ...event, __receivedAt: Date.now() });
        playSocialSound('invite');
      }
      renderRequests();
      updateUnreadBadge();
      if (document.hidden && isNewInvite) notifyIncomingInvite(event);
      return;
    }
    if (event.kind === 'game_invite_response') {
      const labels = { accepted: '好友接受了邀战，正在进入房间', rejected: '好友拒绝了邀战', busy: '好友正在忙碌' };
      notice(labels[event.response] || '好友已处理邀战', event.response !== 'accepted');
      return;
    }
    if (event.kind === 'message' && state.currentChat && String(state.currentChat.uid) === String(event.fromUid)) {
      loadChat({ incremental: true, quiet: true });
    }
    if (event.kind === 'message') {
      notifyIncomingMessage(event);
      if (typeof window.scheduleGameAffinityRefresh === 'function') window.scheduleGameAffinityRefresh();
    }
    refresh({ quiet: true });
  }

  function notifyIncomingInvite(invite) {
    const inviteId = String(invite?.inviteId || '');
    const friend = state.friends.find(item => String(item.uid) === String(invite?.fromUid)) || invite;
    const title = '五子棋 · 收到好友邀战';
    const body = `${displayName(friend)} 邀请你加入房间 ${String(invite?.roomCode || '')}`;
    try {
      if (typeof AndroidNativeApp !== 'undefined' && typeof AndroidNativeApp.showSocialNotification === 'function') {
        AndroidNativeApp.showSocialNotification();
      }
    } catch (_) {}
    try {
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        const notification = new Notification(title, { body, tag: `gomoku-social-invite-${inviteId || 'new'}` });
        notification.onclick = () => {
          try { window.focus(); } catch (_) {}
          renderIncomingInviteDialog();
          notification.close();
        };
      }
    } catch (_) {}
  }

  async function open() {
    if (!requireAccount()) return false;
    state.affinity.clear();
    requestNotificationPermission();
    const modal = byId('friendsModal');
    if (modal) modal.classList.add('show');
    switchTab('friends');
    await ensureAvatarAssets();
    start();
    await refresh();
    return true;
  }

  function close() {
    const modal = byId('friendsModal');
    if (modal) modal.classList.remove('show');
    closeProfile(false);
  }

  function onActionClick(event) {
    const target = event.target && typeof event.target.closest === 'function'
      ? event.target.closest('[data-social-action]') : null;
    if (!target) return;
    const action = target.dataset.socialAction;
    const targetUid = target.dataset.uid || '';
    const username = target.dataset.username || '';
    const requestId = target.dataset.requestId || '';
    const inviteId = target.dataset.inviteId || '';
    const roomCode = target.dataset.roomCode || '';
    if (action === 'search') search();
    else if (action === 'profile') openProfile(targetUid, target);
    else if (action === 'request') sendFriendRequest(username);
    else if (action === 'request-accept') requestAction(requestId, 'accept');
    else if (action === 'request-reject') requestAction(requestId, 'reject');
    else if (action === 'request-cancel') requestAction(requestId, 'cancel');
    else if (action === 'chat') openChat(targetUid);
    else if (action === 'invite') inviteFriend(targetUid);
    else if (action === 'delete-friend') deleteFriend(targetUid);
    else if (action === 'block') blockUser(targetUid);
    else if (action === 'unblock') unblockUser(targetUid);
    else if (action === 'send-message') sendMessage();
    else if (action === 'quick-message') sendMessage(target.dataset.text || '');
    else if (action === 'clear-chat') clearChat();
    else if (action === 'load-older-messages') loadChat({ older: true });
    else if (action === 'close-chat') closeChat();
    else if (action === 'invite-accept') respondInvite(inviteId, 'accepted', roomCode);
    else if (action === 'invite-reject') respondInvite(inviteId, 'rejected', roomCode);
    else if (action === 'invite-busy') respondInvite(inviteId, 'busy', roomCode);
    else if (action === 'invite-dismiss') dismissInvite();
  }

  function onSearchKeyDown(event) {
    if (event.key === 'Enter') {
      event.preventDefault();
      search();
    }
  }

  function onSearchInput() {
    scheduleSearch();
  }

  function onChatKeyDown(event) {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      sendMessage();
    }
  }

  function onSettingsChange() {
    saveSettings();
  }

  function bindDom() {
    cacheDom();
    if (state.domListeners) {
      ensureChatControls();
      return;
    }
    const friendsModal = state.dom.friendsModal;
    ensureProfileModal();
    document.addEventListener('keydown', onProfileModalKeyDown);
    const chatModal = state.dom.socialChatModal;
    const inviteModal = state.dom.socialInviteModal;
    const searchInput = state.dom.socialSearchInput;
    const chatInput = state.dom.socialChatInput;
    const presence = state.dom.socialPresenceHidden;
    const metrics = state.dom.socialMetricsEnabled;
    const lobbyRoster = byId('skyFriendRoster');
    const listeners = state.domListeners = { friendsModal, chatModal, inviteModal, searchInput, chatInput, presence, metrics, lobbyRoster };
    for (const root of [friendsModal, chatModal, inviteModal]) {
      if (root) {
        root.dataset.socialBound = '1';
        // 弹窗卡片自身会 stopPropagation，动态列表按钮必须在捕获阶段委托，
        // 否则申请、私聊、邀战、删除和拉黑按钮都会看得到但点不动。
        root.addEventListener('click', root === inviteModal ? onInviteModalClick : onActionClick, true);
      }
    }
    if (lobbyRoster) lobbyRoster.addEventListener('click', onLobbyRosterClick, true);
    if (searchInput) {
      searchInput.dataset.socialBound = '1';
      searchInput.maxLength = 32;
      searchInput.addEventListener('keydown', onSearchKeyDown);
      searchInput.addEventListener('input', onSearchInput);
    }
    if (chatInput) {
      chatInput.dataset.socialBound = '1';
      chatInput.maxLength = MESSAGE_LIMIT;
      // 主页面保留了无脚本时的内联回退；模块加载后由这里统一接管，避免重复发送，
      // 并确保中文输入法组合状态下按回车不会误发消息。
      chatInput.removeAttribute('onkeydown');
      chatInput.addEventListener('keydown', onChatKeyDown);
    }
    for (const control of [presence, metrics]) {
      if (control) {
        control.dataset.socialBound = '1';
        control.removeAttribute('onchange');
        control.addEventListener('change', onSettingsChange);
      }
    }
    ensureChatControls();
  }

  function unbindDom() {
    const listeners = state.domListeners;
    if (!listeners) return;
    for (const root of [listeners.friendsModal, listeners.chatModal, listeners.inviteModal]) {
      if (root) {
        root.removeEventListener('click', root === listeners.inviteModal ? onInviteModalClick : onActionClick, true);
        delete root.dataset.socialBound;
      }
    }
    if (listeners.lobbyRoster) listeners.lobbyRoster.removeEventListener('click', onLobbyRosterClick, true);
    if (listeners.searchInput) {
      listeners.searchInput.removeEventListener('keydown', onSearchKeyDown);
      listeners.searchInput.removeEventListener('input', onSearchInput);
      delete listeners.searchInput.dataset.socialBound;
    }
    if (listeners.chatInput) {
      listeners.chatInput.removeEventListener('keydown', onChatKeyDown);
      delete listeners.chatInput.dataset.socialBound;
    }
    for (const control of [listeners.presence, listeners.metrics]) {
      if (control) {
        control.removeEventListener('change', onSettingsChange);
        delete control.dataset.socialBound;
      }
    }
    state.domListeners = null;
    document.removeEventListener('keydown', onProfileModalKeyDown);
    closeProfile(false);
  }

  function onInviteModalClick(event) {
    if (event.target === state.dom.socialInviteModal) {
      dismissInvite();
      return;
    }
    onActionClick(event);
  }

  function onVisibilityChange() {
    if (!state.started || document.hidden) return;
    refresh({ quiet: true });
    if (state.currentChat) loadChat({ incremental: true, quiet: true });
    connectSocket();
  }

  function start() {
    if (!isRegistered()) return;
    bindDom();
    if (state.started) {
      connectSocket();
      return;
    }
    state.started = true;
    state.stopping = false;
    document.addEventListener('visibilitychange', onVisibilityChange);
    state.refreshTimer = setInterval(() => {
      if (!isRegistered()) {
        stop();
        return;
      }
      if (!document.hidden) refresh({ quiet: true });
    }, 30000);
    refresh({ quiet: true });
    connectSocket();
  }

  function resume() {
    if (!isRegistered()) return;
    if (!state.started) {
      start();
      return;
    }
    state.stopping = false;
    refresh({ quiet: true });
    connectSocket();
  }

  function stop() {
    state.stopping = true;
    state.started = false;
    state.lifecycle += 1;
    invalidateSearch();
    clearSocketTimers();
    if (state.refreshTimer) clearInterval(state.refreshTimer);
    state.refreshTimer = null;
    document.removeEventListener('visibilitychange', onVisibilityChange);
    if (state.socket) {
      try { state.socket.close(1000, 'client-stop'); } catch (_) {}
    }
    state.socket = null;
    state.socketConnecting = false;
    state.socketRetry = 0;
    state.friends = [];
    state.requests = [];
    state.recent = [];
    state.blocks = [];
    state.affinity.clear();
    state.searchResult = null;
    state.searchUsername = '';
    state.searchAt = 0;
    state.pendingRequests.clear();
    state.pendingInvites.clear();
    state.dismissedInviteIds.clear();
    state.inviteActionsPending.clear();
    state.lastUnreadTotal = 0;
    state.lastNotifiedMessageId = '';
    state.lastMessageSoundAt = 0;
    state.hasUnreadSnapshot = false;
    state.lastNotifiedUnreadTotal = 0;
    unbindDom();
    closeChat();
    close();
    renderIncomingInviteDialog();
    renderAll();
  }

  window.GomokuSocial = Object.freeze({
    open,
    close,
    start,
    stop,
    refresh,
    search,
    switchTab,
    openChat,
    closeChat,
    sendMessage,
    clearChat,
    sendFriendRequest,
    inviteFriend,
    respondInvite,
    dismissInvite,
    recordOpponent,
    saveSettings,
    setAffinity,
    resume,
    renderLobbyRoster
  });
})();
