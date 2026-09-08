(function () {
  'use strict';

  const MESSAGE_LIMIT = 500;
  const SOCKET_RETRY_DELAYS = [0, 1000, 2000, 4000, 8000, 12000];
  const state = {
    started: false,
    stopping: false,
    friends: [],
    requests: [],
    recent: [],
    blocks: [],
    searchResult: null,
    currentChat: null,
    messages: [],
    chatOldestId: 0,
    chatHasMore: false,
    chatLoading: false,
    pendingInvites: new Map(),
    socket: null,
    socketConnecting: false,
    socketRetry: 0,
    socketRetryTimer: null,
    socketPingTimer: null,
    refreshTimer: null,
    ticketOrigin: '',
    refreshPromise: null
  };

  function byId(id) {
    return document.getElementById(id);
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

  function avatarGlyph(person) {
    const value = String(person && person.avatar || '👤');
    if (/^[\p{Extended_Pictographic}\p{Emoji_Component}\uFE0F\u200D]{1,16}$/u.test(value)) return value;
    return '👤';
  }

  function button(action, label, extra, tone) {
    const color = tone === 'danger' ? '#dc2626' : tone === 'primary' ? '#0369a1' : '#475569';
    return `<button type="button" data-social-action="${attr(action)}" ${extra || ''} style="border:1px solid #cbd5e1;border-radius:8px;background:#fff;color:${color};padding:5px 8px;font-weight:800;cursor:pointer">${escapeHtml(label)}</button>`;
  }

  function emptyMarkup(text) {
    return `<div style="padding:18px 8px;text-align:center;color:#64748b;font-size:13px">${escapeHtml(text)}</div>`;
  }

  function personHeading(person, suffix) {
    const username = person && person.username ? ` @${person.username}` : '';
    return `<div style="min-width:0;flex:1"><div style="font-weight:900;color:#1e293b;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(avatarGlyph(person))} ${escapeHtml(displayName(person))}</div><div style="font-size:11px;color:#64748b;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(username)}${suffix ? ` · ${escapeHtml(suffix)}` : ''}</div></div>`;
  }

  function card(content) {
    return `<div style="display:flex;align-items:center;gap:8px;padding:9px 4px;border-bottom:1px solid rgba(148,163,184,.28)">${content}</div>`;
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
      return card(
        personHeading(friend, online + unread) +
        `<div style="display:flex;gap:4px;flex-wrap:wrap;justify-content:flex-end">` +
        button('chat', '私聊', id, 'primary') +
        button('invite', '邀战', id, 'primary') +
        button('delete-friend', '删除', id) +
        button('block', '拉黑', id, 'danger') +
        `</div>`
      );
    }).join('');
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
    const selected = ['friends', 'requests', 'recent', 'blocks'].includes(name) ? name : 'friends';
    const roots = {
      friends: byId('socialFriendsList'),
      requests: byId('socialRequestsList'),
      recent: byId('socialRecentList'),
      blocks: byId('socialBlocksList')
    };
    Object.entries(roots).forEach(([key, root]) => {
      if (root) root.style.display = key === selected ? '' : 'none';
    });
    document.querySelectorAll('#friendsModal [data-social-tab]').forEach(tab => {
      tab.classList.toggle('active', tab.dataset.socialTab === selected);
    });
  }

  function updateUnreadBadge() {
    const badge = byId('socialUnreadBadge');
    if (!badge) return;
    const total = state.friends.reduce((sum, friend) => sum + (Number(friend.unread) || 0), 0) + state.requests.filter(item => item.direction === 'incoming').length + state.pendingInvites.size;
    badge.textContent = total > 99 ? '99+' : String(total || '');
    badge.style.display = total > 0 ? '' : 'none';
    badge.setAttribute('aria-label', total > 0 ? `${total} 条好友动态` : '没有好友动态');
  }

  function renderAll() {
    renderFriends();
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
    state.refreshPromise = Promise.all([
      api('/api/friends'),
      api('/api/recent-opponents'),
      api('/api/blocks')
    ]).then(([friendsResult, recentResult, blocksResult]) => {
      const social = friendsResult.data || {};
      state.friends = Array.isArray(social.friends) ? social.friends : [];
      state.requests = Array.isArray(social.requests) ? social.requests : [];
      state.recent = Array.isArray(recentResult.data) ? recentResult.data : [];
      state.blocks = Array.isArray(blocksResult.data) ? blocksResult.data : [];
      const syncedInvites = Array.isArray(social.invites) ? social.invites
        : (Array.isArray(social.pendingInvites) ? social.pendingInvites : null);
      if (syncedInvites) {
        const now = Date.now();
        state.pendingInvites = new Map(syncedInvites
          .filter(invite => invite && invite.inviteId && Number(invite.expiresAt) > now && /^\d{6}$/.test(String(invite.roomCode || '')))
          .map(invite => [String(invite.inviteId), invite]));
      }
      syncSettings(social);
      renderAll();
      return true;
    }).catch(error => {
      if (!quiet) notice(error.message || '好友列表加载失败', true);
      return false;
    }).finally(() => {
      state.refreshPromise = null;
    });
    return state.refreshPromise;
  }

  async function search() {
    if (!requireAccount()) return;
    const input = byId('socialSearchInput');
    const username = String(input && input.value || '').trim();
    if (!username || username.length > 32) {
      notice('请输入对方完整账号名', true);
      return;
    }
    try {
      const result = await api(makeQuery('/api/friends/search', { username }));
      state.searchResult = result.data || null;
      renderSearch();
    } catch (error) {
      state.searchResult = null;
      renderSearch();
      notice(error.message || '未找到可添加的账号', true);
    }
  }

  async function sendFriendRequest(username) {
    if (!requireAccount()) return;
    const targetUsername = String(username || state.searchResult?.username || '').trim();
    if (!targetUsername) return notice('缺少对方账号名', true);
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
    state.currentChat = null;
    state.messages = [];
    state.chatOldestId = 0;
    state.chatHasMore = false;
    state.chatLoading = false;
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
      ? `<div style="text-align:center;margin:2px 0 6px">${button('load-older-messages', state.chatLoading ? '正在加载…' : '加载更早消息', state.chatLoading ? 'disabled' : '')}</div>`
      : '';
    root.innerHTML = older + state.messages.map(message => {
      const mine = String(message.sender_uid) === myUid;
      const time = message.created_at ? new Date(Number(message.created_at)).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
      return `<div style="display:flex;justify-content:${mine ? 'flex-end' : 'flex-start'};margin:7px 0"><div style="max-width:82%;padding:7px 10px;border-radius:${mine ? '12px 12px 3px 12px' : '12px 12px 12px 3px'};background:${mine ? '#dbeafe' : '#f1f5f9'};color:#1e293b;word-break:break-word;white-space:pre-wrap"><div>${escapeHtml(message.body || '')}</div><div style="font-size:9px;color:#94a3b8;text-align:right;margin-top:2px">${escapeHtml(time)}</div></div></div>`;
    }).join('');
    if (scrollToBottom !== false) root.scrollTop = root.scrollHeight;
  }

  async function loadChat(options) {
    if (!state.currentChat || state.chatLoading) return;
    const older = options && options.older === true;
    if (older && !state.chatHasMore) return;
    const chatUid = String(state.currentChat.uid);
    const root = byId('socialChatMessages');
    const previousHeight = root ? root.scrollHeight : 0;
    state.chatLoading = true;
    if (older) renderMessages(false);
    try {
      const params = { friendUid: chatUid, limit: 50 };
      if (older && state.chatOldestId > 0) params.before = state.chatOldestId;
      const result = await api(makeQuery('/api/messages', params));
      if (!state.currentChat || String(state.currentChat.uid) !== chatUid) return;
      const page = Array.isArray(result.data) ? result.data : [];
      const known = new Set(state.messages.map(message => String(message.id)));
      const uniquePage = page.filter(message => message && !known.has(String(message.id)));
      state.messages = older ? uniquePage.concat(state.messages) : uniquePage;
      state.chatOldestId = state.messages.reduce((min, message) => {
        const id = Number(message.id) || 0;
        return id > 0 && (min === 0 || id < min) ? id : min;
      }, 0);
      state.chatHasMore = page.length >= 50;
      state.chatLoading = false;
      renderMessages(!older);
      if (older && root) root.scrollTop = Math.max(0, root.scrollHeight - previousHeight);
      const lastId = state.messages.reduce((max, message) => Math.max(max, Number(message.id) || 0), 0);
      if (!older && lastId) {
        await api('/api/messages/read', { method: 'POST', body: JSON.stringify({ friendUid: chatUid, lastMessageId: lastId }) });
        const friend = state.friends.find(item => String(item.uid) === chatUid);
        if (friend) friend.unread = 0;
        renderFriends();
        updateUnreadBadge();
      }
    } catch (error) {
      notice(error.message || '聊天记录加载失败', true);
      state.chatLoading = false;
      if (older && state.currentChat && String(state.currentChat.uid) === chatUid) renderMessages(false);
    } finally {
      state.chatLoading = false;
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
    if (response === 'accepted' && isBusyInGame()) {
      notice('你正在联机对局中，已向好友回复忙碌', true);
      response = 'busy';
    }
    try {
      const result = await api(`/api/game-invites/${encodeURIComponent(inviteId)}/respond`, {
        method: 'POST', body: JSON.stringify({ response })
      });
      state.pendingInvites.delete(String(inviteId));
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
      notice(error.message || '邀战处理失败', true);
    }
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

  function socketUrl(origin, ticket) {
    const url = new URL('/api/social/socket', origin);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
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
    try {
      const result = await api('/api/social/socket-ticket', { method: 'POST' });
      if (!state.started || state.stopping) return;
      const origin = result.response && result.response.url ? new URL(result.response.url).origin : (typeof activeApiHost !== 'undefined' ? activeApiHost : '');
      const ticket = String(result.data?.ticket || '');
      if (!origin || !/^[A-Fa-f0-9]{48}$/.test(ticket)) throw new Error('好友连接票据无效');
      state.ticketOrigin = origin;
      const socket = new WebSocket(socketUrl(origin, ticket));
      state.socket = socket;
      socket.onopen = () => {
        if (state.socket !== socket) return;
        state.socketRetry = 0;
        setConnectionStatus('好友状态已实时连接', true);
        state.socketPingTimer = setInterval(() => {
          if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'ping', sentAt: Date.now() }));
        }, 20000);
      };
      socket.onmessage = event => handleSocketMessage(event.data);
      socket.onerror = () => {};
      socket.onclose = () => {
        if (state.socket === socket) state.socket = null;
        if (state.socketPingTimer) clearInterval(state.socketPingTimer);
        state.socketPingTimer = null;
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
      state.pendingInvites.set(String(event.inviteId), event);
      renderRequests();
      updateUnreadBadge();
      notice('⚔️ 收到好友邀战，请在好友申请页处理', false);
      return;
    }
    if (event.kind === 'game_invite_response') {
      const labels = { accepted: '好友接受了邀战，正在进入房间', rejected: '好友拒绝了邀战', busy: '好友正在忙碌' };
      notice(labels[event.response] || '好友已处理邀战', event.response !== 'accepted');
      return;
    }
    if (event.kind === 'message' && state.currentChat && String(state.currentChat.uid) === String(event.fromUid)) {
      loadChat();
    }
    refresh({ quiet: true });
  }

  async function open() {
    if (!requireAccount()) return false;
    const modal = byId('friendsModal');
    if (modal) modal.classList.add('show');
    switchTab('friends');
    start();
    await refresh();
    return true;
  }

  function close() {
    const modal = byId('friendsModal');
    if (modal) modal.classList.remove('show');
  }

  function onActionClick(event) {
    const target = event.target.closest('[data-social-action]');
    if (!target) return;
    const action = target.dataset.socialAction;
    const targetUid = target.dataset.uid || '';
    const username = target.dataset.username || '';
    const requestId = target.dataset.requestId || '';
    const inviteId = target.dataset.inviteId || '';
    const roomCode = target.dataset.roomCode || '';
    if (action === 'search') search();
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
  }

  function bindDom() {
    const friendsModal = byId('friendsModal');
    const chatModal = byId('socialChatModal');
    for (const root of [friendsModal, chatModal]) {
      if (root && !root.dataset.socialBound) {
        root.dataset.socialBound = '1';
        // 弹窗卡片自身会 stopPropagation，动态列表按钮必须在捕获阶段委托，
        // 否则申请、私聊、邀战、删除和拉黑按钮都会看得到但点不动。
        root.addEventListener('click', onActionClick, true);
      }
    }
    const searchInput = byId('socialSearchInput');
    if (searchInput && !searchInput.dataset.socialBound) {
      searchInput.dataset.socialBound = '1';
      searchInput.maxLength = 32;
      searchInput.addEventListener('keydown', event => {
        if (event.key === 'Enter') { event.preventDefault(); search(); }
      });
    }
    const chatInput = byId('socialChatInput');
    if (chatInput && !chatInput.dataset.socialBound) {
      chatInput.dataset.socialBound = '1';
      chatInput.maxLength = MESSAGE_LIMIT;
      // 主页面保留了无脚本时的内联回退；模块加载后由这里统一接管，避免重复发送，
      // 并确保中文输入法组合状态下按回车不会误发消息。
      chatInput.removeAttribute('onkeydown');
      chatInput.addEventListener('keydown', event => {
        if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
          event.preventDefault();
          sendMessage();
        }
      });
    }
    for (const id of ['socialPresenceHidden', 'socialMetricsEnabled']) {
      const control = byId(id);
      if (control && !control.dataset.socialBound) {
        control.dataset.socialBound = '1';
        control.removeAttribute('onchange');
        control.addEventListener('change', saveSettings);
      }
    }
    ensureChatControls();
  }

  function onVisibilityChange() {
    if (!state.started || document.hidden) return;
    refresh({ quiet: true });
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
    state.searchResult = null;
    state.pendingInvites.clear();
    closeChat();
    close();
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
    recordOpponent,
    saveSettings,
    resume
  });
})();
