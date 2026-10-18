(() => {
  'use strict';

  const THEME_KEYS = [
    'theme-zen-dark', 'theme-sweet-romance', 'theme-neo-trad',
    'theme-luxury-glass', 'theme-clean-ios'
  ];
  let lobby = null;
  let sheetBackdrop = null;
  let topbar = null;

  function safeCall(name, ...args) {
    const fn = window[name];
    if (typeof fn !== 'function') return false;
    try { return fn(...args); } catch (error) {
      console.warn(`[sky ui] ${name}`, error?.message || error);
      return false;
    }
  }

  function elevateLegacyModal(id) {
    const modal = document.getElementById(id);
    if (modal) modal.style.setProperty('z-index', '100040', 'important');
  }

  function clearLegacyThemeState() {
    try {
      localStorage.removeItem('gomoku_active_theme');
      sessionStorage.removeItem('gomoku_active_theme');
    } catch (_) {}
    if (!document.body) return;
    THEME_KEYS.forEach(key => document.body.classList.remove(key));
  }

  function setActivePage(page) {
    const allowed = ['game', 'friends', 'records', 'me'];
    const next = allowed.includes(page) ? page : 'game';
    lobby?.querySelectorAll('[data-sky-page]').forEach(section => {
      const active = section.dataset.skyPage === next;
      section.hidden = !active;
      section.setAttribute('aria-hidden', String(!active));
    });
    lobby?.querySelectorAll('[data-sky-nav]').forEach(button => {
      if (button.dataset.skyNav === next) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
    if (lobby) lobby.dataset.activePage = next;
    refreshCurrentGameEntry();
    const pages = document.getElementById('skyLobbyPages');
    if (pages) pages.scrollTop = 0;
    if (next === 'records') {
      safeCall('updateHistoryCountUI');
      safeCall('updateLadderBadgeUI');
    }
    if (next === 'me') {
      const version = document.getElementById('appVersionDisplay');
      if (version && window.GOMOKU_VERSION_DISPLAY) version.textContent = window.GOMOKU_VERSION_DISPLAY;
      refreshProfileCard();
    }
    if (next === 'friends') {
      const render = () => {
        window.GomokuSocial?.renderLobbyRoster?.();
        window.GomokuSocial?.start?.();
      };
      if (window.GomokuSocial) render();
      else if (typeof window.ensureGomokuFeature === 'function') {
        window.ensureGomokuFeature('social').then(render).catch(error => console.warn('[sky friends preview]', error?.message || error));
      }
    }
  }

  function refreshProfileCard() {
    const nameNode = document.getElementById('skyProfileName');
    const detailNode = document.getElementById('skyProfileDetail');
    const avatarNode = document.getElementById('skyProfileAvatar');
    if (!nameNode || !detailNode || !avatarNode) return;
    let username = '';
    let nickname = '';
    let avatar = '';
    let uid = '';
    let token = '';
    try {
      username = localStorage.getItem('gomoku_user_username') || '';
      nickname = localStorage.getItem('gomoku_p1Name') || '';
      avatar = localStorage.getItem('gomoku_p1Avatar') || '';
      uid = localStorage.getItem('gomoku_user_uid') || '';
      token = localStorage.getItem('gomoku_user_token') || '';
    } catch (_) {}
    const loggedIn = Boolean(username.trim() && uid.trim() && token.trim());
    const name = nickname.trim() || username.trim() || '游客棋手';
    nameNode.textContent = name;
    detailNode.textContent = loggedIn ? '账号已连接 · 棋局与棋友同步中' : '游客棋手 · 对局记录保存在本机';
    const profileAction = lobby?.querySelector('.sky-profile-card [data-sky-action]');
    if (profileAction) {
      profileAction.dataset.skyAction = loggedIn ? 'profile' : 'login';
      profileAction.innerHTML = loggedIn ? '资料 <span>→</span>' : '登录账号 <span>→</span>';
      profileAction.setAttribute('aria-label', loggedIn ? '打开个人资料' : '打开账号登录');
    }
    const imageKey = avatar === 'anime_boy' || avatar === 'img/avatar_boy.png' || avatar === 'img/anime_avatar_boy.jpg'
      ? 'boy'
      : avatar === 'anime_girl' || avatar === 'img/avatar_girl.png' || avatar === 'img/anime_avatar_girl.jpg'
        ? 'girl' : '';
    const paintAvatar = () => {
      const source = imageKey === 'boy' ? window.ANIME_AVATAR_BOY : imageKey === 'girl' ? window.ANIME_AVATAR_GIRL : '';
      avatarNode.replaceChildren();
      if (source) {
        const image = document.createElement('img');
        image.src = source;
        image.alt = imageKey === 'boy' ? '男生头像' : '女生头像';
        avatarNode.appendChild(image);
      } else {
        avatarNode.textContent = Array.from(name)[0] || '棋';
      }
    };
    paintAvatar();
    if (imageKey && !window.ANIME_AVATAR_BOY && typeof window.ensureGomokuResource === 'function') {
      window.ensureGomokuResource('avatars').then(paintAvatar).catch(() => {});
    }
  }
  window.refreshSkyProfileCard = refreshProfileCard;

  function refreshCurrentGameEntry() {
    const card = document.getElementById('skyCurrentGame');
    if (!card) return false;
    let summary = null;
    try { summary = window.getCurrentGameSummary?.() || null; } catch (_) {}
    if (!summary || !['ai', 'pvp', 'online'].includes(summary.gameMode)) {
      card.hidden = true;
      return false;
    }
    const mode = summary.gameMode === 'online' ? '联机对局'
      : summary.gameMode === 'pvp' ? '双人同屏' : 'AI 对战';
    const title = document.getElementById('skyCurrentGameTitle');
    const detail = document.getElementById('skyCurrentGameDetail');
    if (title) title.textContent = Number(summary.moveCount) > 0
      ? `${mode} · 已走 ${Number(summary.moveCount)} 手` : `${mode} · 等待恢复`;
    if (detail) detail.textContent = summary.gameMode === 'online'
      ? '棋盘进度已保存在本设备，继续时尝试重新连接房间'
      : '本账号的对局进度已保存在此设备';
    const resume = card.querySelector('[data-sky-action="resume-game"]');
    if (resume) resume.innerHTML = summary.gameMode === 'online'
      ? '恢复联机 <b aria-hidden="true">→</b>'
      : '继续对局 <b aria-hidden="true">→</b>';
    card.hidden = false;
    return true;
  }
  window.refreshSkyCurrentGameEntry = refreshCurrentGameEntry;

  function lobbyMarkup() {
    return `
      <header class="sky-lobby-top">
        <div class="sky-brand">
          <span><strong>五子棋云屿晴光</strong><small>云上活棋谱</small></span>
        </div>
      </header>
      <div class="sky-lobby-pages" id="skyLobbyPages">
        <main class="sky-lobby-main sky-page-game" data-sky-page="game" aria-label="游戏">
          <section class="sky-lobby-copy" aria-labelledby="skyLobbyTitle">
            <div class="sky-lobby-kicker">经典五子棋 <span>·</span> 随时开局</div>
            <h1 id="skyLobbyTitle">下一手，<br>和<span class="sky-lobby-title-accent">谁</span>下？</h1>
            <p>和 AI 练棋，匹配在线棋手，或邀请好友一起落子。</p>
          </section>
          <div class="sky-board-bay" aria-label="标准五子棋棋盘预览">
            <div class="sky-board-halo" aria-hidden="true"></div>
            <canvas class="sky-preview-board" id="skyHomeBoardPreview" width="380" height="380" role="img" aria-label="天空棋台预览，使用与实际对局相同的草坪棋盘和黑白棋石">标准五子棋棋盘预览</canvas>
          </div>
          <article class="sky-current-game" id="skyCurrentGame" aria-label="继续进行中的对局" hidden>
            <span class="sky-current-game-mark" aria-hidden="true">↻</span>
            <span class="sky-current-game-copy"><small>进行中的对局</small><strong id="skyCurrentGameTitle">AI 对战</strong><span id="skyCurrentGameDetail">本账号的对局进度已保存在此设备</span></span>
            <button type="button" data-sky-action="resume-game">继续对局 <b aria-hidden="true">→</b></button>
          </article>
          <aside class="sky-route-list" aria-label="对局入口">
            <button class="sky-route-button" type="button" data-sky-action="ai">
              <span class="sky-route-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="3.5"/><path d="M12 1.5v3M22.5 12h-3M12 22.5v-3M1.5 12h3"/></svg></span><span><strong>AI 对战</strong><small>离线也能随时开局</small></span><span class="sky-route-arrow">↗</span>
            </button>
            <button class="sky-route-button" type="button" data-sky-action="match">
              <span class="sky-route-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="8" cy="8" r="5.3"/><circle cx="16" cy="16" r="5.3"/><path d="M8 2.7v10.6M2.7 8h10.6M16 10.7v10.6m-5.3-5.3h10.6"/></svg></span><span><strong>匹配对决</strong><small>寻找在线棋手即时开局</small></span><span class="sky-route-arrow">↗</span>
            </button>
            <button class="sky-route-button" type="button" data-sky-action="friend-play">
              <span class="sky-route-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="8.5" cy="7.5" r="3.5"/><path d="M2.8 20c.5-3.6 2.5-5.4 5.7-5.4 3.1 0 5.1 1.8 5.6 5.4M17.5 7v7m-3.5-3.5h7"/></svg></span><span><strong>跟好友玩</strong><small>邀好友或加入房间</small></span><span class="sky-route-arrow">↗</span>
            </button>
          </aside>
        </main>

        <section class="sky-tab-page sky-friends-page" data-sky-page="friends" aria-label="好友" aria-hidden="true" hidden>
          <header class="sky-page-heading">
            <small class="sky-page-eyebrow">棋友云桥 <span>／</span> FRIENDS</small>
            <h1>好棋，和棋友一起下。</h1>
            <p>好友、邀战、最近对手与聊天，集中在这一个入口。</p>
          </header>
          <section class="sky-friend-roster-panel" aria-labelledby="skyFriendRosterTitle">
            <div class="sky-panel-heading"><span><small>棋友名册</small><strong id="skyFriendRosterTitle">我的好友</strong></span><span class="sky-friend-count" id="skyFriendCount">同步中</span></div>
            <div id="skyFriendRoster" aria-live="polite"><div class="sky-friend-roster-empty">正在准备好友列表…</div></div>
            <button type="button" class="sky-inline-link" data-sky-action="friend-center">管理好友与申请 <span>→</span></button>
          </section>
          <div class="sky-page-section-head"><span>在线对局</span><small>房间与匹配沿用原有联机流程</small></div>
          <div class="sky-page-grid sky-friend-actions">
            <button class="sky-entry-card" type="button" data-sky-action="create-room"><span class="sky-entry-icon">⌂</span><span><b>创建好友房间</b><small>生成房间号，邀请好友加入</small></span><i>↗</i></button>
            <button class="sky-entry-card" type="button" data-sky-action="join-room"><span class="sky-entry-icon">↗</span><span><b>加入房间</b><small>输入好友分享的房间号</small></span><i>↗</i></button>
            <button class="sky-entry-card" type="button" data-sky-action="match"><span class="sky-entry-icon">◎</span><span><b>全服快速匹配</b><small>寻找实力相近的在线棋手</small></span><i>↗</i></button>
            <button class="sky-entry-card" type="button" data-sky-action="world-chat"><span class="sky-entry-icon">☁</span><span><b>世界聊天</b><small>进入棋友大厅交流</small></span><i>↗</i></button>
          </div>
          <p class="sky-page-footnote">好友中心还保留申请、最近对手、黑名单、在线状态和隐私设置。</p>
        </section>

        <section class="sky-tab-page sky-records-page" data-sky-page="records" aria-label="棋谱" aria-hidden="true" hidden>
          <header class="sky-page-heading">
            <small class="sky-page-eyebrow">棋谱与战绩 <span>／</span> RECORDS</small>
            <h1>每一手，都留下来。</h1>
            <p>看胜负、步数与完整复盘；登录后同步云端战绩。</p>
          </header>
          <div class="sky-record-summary">
            <div class="sky-record-summary-label">我的对局档案</div>
            <div class="sky-record-stats">
              <div><strong id="historyStatCount">0 局战绩</strong><span>历史对局</span></div>
              <div><strong id="myLadderBadge">1000 分</strong><span>天梯积分</span></div>
              <span class="sky-record-seal" aria-hidden="true">棋</span>
            </div>
            <div class="sky-record-summary-note">本机记录随时可看；正式账号登录后可同步云端战报。</div>
          </div>
          <div class="sky-page-grid sky-record-actions">
            <button class="sky-entry-card sky-entry-featured" type="button" data-sky-action="history"><span class="sky-entry-icon">⌁</span><span><b>全部棋谱</b><small>按对局查看战报与逐手复盘</small></span><i>→</i></button>
            <button class="sky-entry-card" type="button" data-sky-action="leaderboard"><span class="sky-entry-icon">♔</span><span><b>全服天梯榜</b><small>查看排名与当前积分</small></span><i>↗</i></button>
          </div>
          <div class="sky-record-note"><span class="sky-record-note-stone"></span><span><b>每场标准对局都有记录</b><small>AI、匹配与好友对局均保留完整历史走法。</small></span></div>
        </section>

        <section class="sky-tab-page sky-me-page" data-sky-page="me" aria-label="我的" aria-hidden="true" hidden>
          <header class="sky-page-heading">
            <small class="sky-page-eyebrow">我的棋岛 <span>／</span> ACCOUNT</small>
            <h1>把棋岛，调成自己的样子。</h1>
            <p>账号、显示、活动、反馈与版本更新，分别在这里管理。</p>
          </header>
          <article class="sky-profile-card">
            <div class="sky-profile-avatar" id="skyProfileAvatar" aria-hidden="true">棋</div>
            <div class="sky-profile-copy"><small>当前棋手</small><strong id="skyProfileName">游客棋手</strong><span id="skyProfileDetail">对局记录保存在本机</span></div>
            <button type="button" data-sky-action="login">登录账号 <span>→</span></button>
          </article>
          <article class="sky-me-update">
            <div class="sky-update-mark" aria-hidden="true">↻</div>
            <div class="sky-update-copy"><small>应用版本</small><strong id="appVersionDisplay">检查更新</strong><span>点此连接官方版本服务</span></div>
            <button type="button" data-sky-action="update" aria-label="检查更新">检查更新 <b>→</b></button>
          </article>
          <div class="sky-page-grid sky-me-actions">
            <button class="sky-entry-card" type="button" data-sky-action="account"><span class="sky-entry-icon">○</span><span><b>个人资料与账号</b><small>昵称、头像、登录与战绩绑定</small></span><i>↗</i></button>
            <button class="sky-entry-card" type="button" data-sky-action="settings"><span class="sky-entry-icon">⚙</span><span><b>设置</b><small>背景音乐、对局音效与棋盘画质</small></span><i>↗</i></button>
            <button class="sky-entry-card" type="button" data-sky-action="activity"><span class="sky-entry-icon">✳</span><span><b>活动与签到</b><small>查看已有活动和签到记录</small></span><i>↗</i></button>
            <button class="sky-entry-card" type="button" data-sky-action="feedback"><span class="sky-entry-icon">↗</span><span><b>意见反馈</b><small>提交问题或改进建议</small></span><i>↗</i></button>
          </div>
        </section>
      </div>
      <nav class="sky-lobby-nav" aria-label="一级导航">
        <button type="button" data-sky-nav="game" aria-current="page"><span aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M4 4.5h16v15H4zM4 9.5h16M9.5 4.5v15M14.5 4.5v15M4 14.5h16"/></svg></span>游戏</button>
        <button type="button" data-sky-nav="friends"><span aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.2"/><path d="M3.5 19c.4-3.1 2.4-4.8 5.5-4.8s5.1 1.7 5.5 4.8M16 5.2a3.1 3.1 0 0 1 0 5.8M17 14.4c2.1.7 3.3 2.2 3.6 4.6"/></svg></span>好友</button>
        <button type="button" data-sky-nav="records"><span aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 3.5h14v17H5zM8 7h8M8 11h8M8 15h5"/><path d="M3 6v15h14"/></svg></span>棋谱</button>
        <button type="button" data-sky-nav="me"><span aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="3.5"/><path d="M4.5 20c.6-4 3.1-6 7.5-6s6.9 2 7.5 6"/></svg></span>我的</button>
      </nav>`;
  }

  function buildLobby() {
    lobby = document.createElement('section');
    lobby.id = 'skyLobby';
    lobby.className = 'sky-lobby';
    lobby.setAttribute('aria-label', '五子棋云屿晴光大厅');
    lobby.innerHTML = lobbyMarkup();
    document.body.appendChild(lobby);

    lobby.addEventListener('click', event => {
      const action = event.target.closest('[data-sky-action]')?.dataset.skyAction;
      if (action) runAction(action);
      const nav = event.target.closest('[data-sky-nav]')?.dataset.skyNav;
      if (nav) runNav(nav);
    });
    setActivePage('game');
  }

  function bindHomeBoardPreview() {
    const canvas = document.getElementById('skyHomeBoardPreview');
    if (!canvas) return;
    const draw = () => {
      const renderer = window.GomokuBoardPreview;
      if (renderer && typeof renderer.draw === 'function') renderer.draw(canvas);
    };
    window.addEventListener('gomoku-board-preview-ready', draw);
    if (window.GomokuBoardPreview) draw();
    if (typeof ResizeObserver === 'function') {
      const observer = new ResizeObserver(draw);
      observer.observe(canvas);
    } else {
      window.addEventListener('resize', draw, { passive: true });
    }
  }

  function buildTopbar() {
    topbar = document.createElement('header');
    topbar.className = 'sky-game-topbar';
    topbar.innerHTML = `
      <button type="button" data-game-action="lobby">← 棋岛</button>
      <div class="sky-game-title">
        <strong>五子棋云屿晴光</strong>
        <div style="display:flex;align-items:center;justify-content:center;gap:6px;margin-top:3px">
          <small style="margin:0">云海对局</small>
          <button type="button" data-game-action="history" aria-label="打开棋谱" style="min-height:22px;padding:3px 7px;border-radius:8px;font-size:9px">📜 棋谱</button>
        </div>
      </div>
      <button type="button" id="skyCardsToggle" data-game-action="more" aria-controls="cardSlotsArea" aria-expanded="false" aria-label="展开卡牌区">🃏 卡牌</button>`;
    const header = document.querySelector('.header-area');
    if (header) {
      header.before(topbar);
    } else document.body.prepend(topbar);
    topbar.addEventListener('click', event => {
      const action = event.target.closest('[data-game-action]')?.dataset.gameAction;
      if (action === 'lobby') showLobby();
      if (action === 'more') setCardsOpen(!document.body.classList.contains('sky-cards-open'));
      if (action === 'history') {
        elevateLegacyModal('historyModal');
        safeCall('openHistoryModal');
      }
    });
  }

  function setCardsOpen(open) {
    const next = Boolean(open);
    document.body.classList.toggle('sky-cards-open', next);
    const toggle = document.getElementById('skyCardsToggle');
    if (toggle) {
      toggle.setAttribute('aria-expanded', String(next));
      toggle.setAttribute('aria-label', next ? '收起卡牌区' : '展开卡牌区');
    }
    const cardArea = document.querySelector('.card-area-wrapper');
    if (!cardArea) return;
    // Keep the legacy card renderer intact while making the new bottom drawer
    // deterministic even during CSS hot reloads or WebView stylesheet races.
    cardArea.style.opacity = next ? '1' : '0';
    cardArea.style.visibility = next ? 'visible' : 'hidden';
    cardArea.style.pointerEvents = next ? 'auto' : 'none';
    cardArea.style.transform = next ? 'translate(-50%, 0)' : 'translate(-50%, 20px)';
  }

  function buildSheet() {
    sheetBackdrop = document.createElement('div');
    sheetBackdrop.id = 'skySheetBackdrop';
    sheetBackdrop.className = 'sky-sheet-backdrop';
    sheetBackdrop.setAttribute('aria-hidden', 'true');
    sheetBackdrop.innerHTML = '<section class="sky-sheet" role="dialog" aria-modal="true"><div class="sky-sheet-grip"></div><div id="skySheetBody"></div></section>';
    document.body.appendChild(sheetBackdrop);
    sheetBackdrop.addEventListener('click', event => {
      if (event.target === sheetBackdrop) closeSheet();
      const action = event.target.closest('[data-sheet-action]')?.dataset.sheetAction;
      if (action) runSheetAction(action);
    });
  }

  function openSheet(title, subtitle, options) {
    const body = document.getElementById('skySheetBody');
    if (!body) return;
    body.innerHTML = `<h2>${title}</h2><p>${subtitle}</p><div class="sky-sheet-options">${options.map(option => `
      <button class="sky-sheet-option" type="button" data-sheet-action="${option.action}">
        <span aria-hidden="true">${option.icon}</span><span><b>${option.title}</b><small>${option.detail}</small></span><span>›</span>
      </button>`).join('')}</div>`;
    sheetBackdrop.classList.add('show');
    sheetBackdrop.setAttribute('aria-hidden', 'false');
    body.querySelector('button')?.focus({ preventScroll: true });
  }

  function closeSheet() {
    sheetBackdrop?.classList.remove('show');
    sheetBackdrop?.setAttribute('aria-hidden', 'true');
  }

  function openFriendPlaySheet() {
    openSheet('跟好友玩', '邀请好友开局，也可以加入朋友分享的房间。', [
      { action: 'friend-center', icon: '♧', title: '从好友列表邀战', detail: '选择在线好友，直接发起对局邀请' },
      { action: 'online', icon: '＋', title: '创建好友房间', detail: '生成房间号，再发给好友加入' },
      { action: 'join', icon: '↗', title: '加入好友房间', detail: '输入好友分享的房间号' }
    ]);
  }

  function openMeSheet() {
    setActivePage('me');
  }

  function showGame() {
    closeSheet();
    lobby.hidden = true;
    document.body.classList.remove('sky-lobby-open');
    document.body.classList.add('sky-game-open');
    setCardsOpen(true);
    window.setTimeout(() => window.dispatchEvent(new Event('resize')), 40);
  }

  function showLobby() {
    setCardsOpen(false);
    document.body.classList.remove('sky-game-open');
    document.body.classList.add('sky-lobby-open');
    if (lobby) lobby.hidden = false;
    refreshCurrentGameEntry();
  }

  function startStandardMode(mode) {
    if (mode !== 'online' && typeof window.cancelQuickMatch === 'function') {
      try { void window.cancelQuickMatch(); } catch (_) {}
    }
    document.body.classList.add('sky-mode-loading');
    const result = safeCall('setMode', mode);
    Promise.resolve(result).finally(() => {
      document.body.classList.remove('sky-mode-loading');
      showGame();
    });
    return true;
  }

  function enterStandardMode(mode) {
    closeSheet();
    const hasActiveRoom = mode !== 'online' && (
      window.hasActiveOnlineRoom?.() === true ||
      window.getCurrentGameSummary?.()?.gameMode === 'online'
    );
    if (hasActiveRoom) {
      if (typeof window.showCustomConfirm !== 'function' || typeof window.leaveOnlineRoom !== 'function') {
        window.showGameNotice?.('当前好友房间仍在进行，请先退出房间后再开始其他对局。', true);
        return false;
      }
      window.showCustomConfirm(
        `开始${mode === 'ai' ? 'AI 对战' : '双人同屏'}会退出当前好友房间，并通知对方。是否继续？`,
        () => {
          window.leaveOnlineRoom(true);
          startStandardMode(mode);
        },
        null,
        { title: '结束当前好友对局？', icon: '🚪', okText: '退出并开始', cancelText: '留在房间' }
      );
      return false;
    }
    return startStandardMode(mode);
  }

  function openFriends(tab = 'friends') {
    closeSheet();
    Promise.resolve(window.openFriendsModal?.()).then(() => {
      if (tab !== 'friends') window.GomokuSocial?.switchTab?.(tab);
    }).catch(error => console.warn('[sky friends]', error?.message || error));
  }

  function runAction(action) {
    if (action === 'ai') enterStandardMode('ai');
    else if (action === 'friend-play') openFriendPlaySheet();
    else if (action === 'friends' || action === 'friend-center') openFriends();
    else if (action === 'friend-requests') openFriends('requests');
    else if (action === 'create-room') runSheetAction('online');
    else if (action === 'join-room') runSheetAction('join');
    else if (action === 'match') runSheetAction('match');
    else if (action === 'resume-game') {
      closeSheet();
      if (!safeCall('resumeSavedGame')) refreshCurrentGameEntry();
    }
    else if (action === 'world-chat') {
      closeSheet();
      const openWorldChat = window.GomokuWorldChat?.open;
      if (typeof openWorldChat === 'function') {
        Promise.resolve(openWorldChat()).catch(error => console.warn('[sky world chat]', error?.message || error));
      } else {
        safeCall('showGameNotice', '世界聊天正在准备，请稍后重试', true);
      }
    }
    else if (action === 'history') safeCall('openHistoryModal');
    else if (action === 'leaderboard') safeCall('openLeaderboardModal');
    else if (action === 'login') {
      closeSheet();
      safeCall('openAuthModal', 'login');
    }
    else if (action === 'account') {
      const loggedIn = Boolean(localStorage.getItem('gomoku_user_username') && localStorage.getItem('gomoku_user_uid') && localStorage.getItem('gomoku_user_token'));
      if (loggedIn) runSheetAction('profile');
      else {
        closeSheet();
        safeCall('openAuthModal', 'login');
      }
    }
    else if (action === 'profile') runSheetAction('profile');
    else if (action === 'activity') runSheetAction('activity');
    else if (action === 'settings') runSheetAction('settings');
    else if (action === 'feedback') runSheetAction('feedback');
    else if (action === 'update') safeCall('checkAppUpdate', true);
  }

  function runNav(nav) {
    setActivePage(nav);
  }

  function runSheetAction(action) {
    if (action === 'ai') {
      enterStandardMode('ai');
    } else if (action === 'match') {
      closeSheet();
      safeCall('openOnlineModal', 'match');
    } else if (action === 'friend-center') {
      openFriends();
    } else if (action === 'online') {
      closeSheet();
      safeCall('openOnlineModal', 'create');
    } else if (action === 'join') {
      closeSheet();
      safeCall('openOnlineModal', 'join');
    } else if (action === 'records') {
      closeSheet();
      setActivePage('records');
    } else if (action === 'profile') {
      closeSheet();
      elevateLegacyModal('profileModal');
      safeCall('openProfileModal', 1);
    } else if (action === 'activity') {
      closeSheet();
      elevateLegacyModal('gameActivityModal');
      safeCall('openGameActivity');
    } else if (action === 'settings') {
      closeSheet();
      elevateLegacyModal('themeModal');
      safeCall('openGameSettings');
    } else if (action === 'feedback') {
      closeSheet();
      elevateLegacyModal('feedbackModal');
      safeCall('openFeedbackModal');
    }
  }

  function simplifySettings() {
    const card = document.querySelector('#themeModal .online-modal-card');
    if (!card) return;
    card.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:12px">
        <div><div class="undo-title" style="text-align:left;margin:0">游戏设置</div><div style="margin-top:3px;color:#64748b;font-size:10px;font-weight:800">音乐、音效与棋盘画质</div></div>
        <button type="button" class="btn-chat-tool" onclick="closeThemeModal()" aria-label="关闭设置">✕</button>
      </div>
      <div class="sky-only-settings-note"><strong>晴空浮岛 · 云海棋台</strong><br>声音和画质在这里统一调整，棋盘继续使用官方视觉。</div>
      <div style="margin-top:12px;padding:10px;border:1px solid rgba(70,109,75,.18);border-radius:14px;background:linear-gradient(135deg,#f2faf7,#f5f8f0);text-align:left">
        <div style="font-size:12px;font-weight:900;color:#466d4b;margin-bottom:7px">🎵 云海主题音乐</div>
        <label for="gameMusicEnabled" style="display:flex;align-items:center;gap:7px;color:#334155;font-size:11px;font-weight:800;cursor:pointer">
          <input id="gameMusicEnabled" type="checkbox" onchange="setGameMusicEnabled(this.checked)" style="width:16px;height:16px;accent-color:#466d4b">
          播放云海轻音乐
        </label>
        <label for="gameMusicVolume" style="display:flex;align-items:center;gap:8px;margin-top:8px;color:#64748b;font-size:10.5px;font-weight:800">
          <span style="white-space:nowrap">音乐音量</span>
          <input id="gameMusicVolume" type="range" min="0" max="100" step="1" value="38" oninput="setGameMusicVolume(this.value)" aria-label="背景音乐音量" style="flex:1;min-width:0;accent-color:#466d4b">
          <output id="gameMusicVolumeValue" for="gameMusicVolume" style="width:34px;text-align:right;color:#466d4b">38%</output>
        </label>
        <div style="margin-top:5px;color:#82958a;font-size:9.5px;line-height:1.4;font-weight:700">五声音阶与轻柔回响；首次触摸后播放，切到后台自动暂停。</div>
      </div>
      <div style="margin-top:10px;padding:10px;border:1px solid rgba(33,58,74,.12);border-radius:14px;background:#fff;text-align:left">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:7px">
          <div style="font-size:12px;font-weight:900;color:#213a4a">🔊 对局音效</div>
          <button type="button" class="btn-chat-tool" onclick="previewGameSound()" style="padding:5px 8px;font-size:10px">试听落子音</button>
        </div>
        <label for="gameSoundEnabled" style="display:flex;align-items:center;gap:7px;color:#334155;font-size:11px;font-weight:800;cursor:pointer">
          <input id="gameSoundEnabled" type="checkbox" onchange="setGameSoundEnabled(this.checked)" style="width:16px;height:16px;accent-color:#466d4b">
          落子、提示与胜负音效
        </label>
        <label for="gameSoundVolume" style="display:flex;align-items:center;gap:8px;margin-top:8px;color:#64748b;font-size:10.5px;font-weight:800">
          <span style="white-space:nowrap">音效音量</span>
          <input id="gameSoundVolume" type="range" min="0" max="100" step="1" value="62" oninput="setGameSoundVolume(this.value)" aria-label="游戏音效音量" style="flex:1;min-width:0;accent-color:#466d4b">
          <output id="gameSoundVolumeValue" for="gameSoundVolume" style="width:34px;text-align:right;color:#466d4b">62%</output>
        </label>
      </div>
      <div style="margin-top:12px;padding:10px;border:1px solid rgba(33,58,74,.14);border-radius:14px;background:#fff;text-align:left">
        <div style="font-size:12px;font-weight:900;color:#213a4a;margin-bottom:7px">棋盘画质</div>
        <div style="display:flex;gap:6px" id="graphicsQualityButtons">
          <button class="btn-chat-tool" data-quality="auto" onclick="setGraphicsQuality('auto')" style="flex:1">自动</button>
          <button class="btn-chat-tool" data-quality="high" onclick="setGraphicsQuality('high')" style="flex:1">高清</button>
          <button class="btn-chat-tool" data-quality="smooth" onclick="setGraphicsQuality('smooth')" style="flex:1">流畅</button>
        </div>
        <div id="graphicsQualityHint" style="font-size:10px;color:#64748b;font-weight:700;margin-top:6px">自动根据设备性能选择清晰度</div>
      </div>
      <button class="btn-chat-tool" style="margin-top:14px;width:100%;padding:9px" onclick="closeThemeModal()">完成</button>`;
    window.syncGameMusicControls?.();
    window.syncGameSoundControls?.();
    if (typeof window.updateGraphicsQualityUI === 'function') window.updateGraphicsQualityUI();
  }

  function resumePendingMatchOnLaunch() {
    let hasPendingMatch = false;
    try { hasPendingMatch = Boolean(localStorage.getItem('gomoku_pending_match_v1')); } catch (_) {}
    if (!hasPendingMatch || typeof window.ensureGomokuFeature !== 'function') return;

    window.setTimeout(() => {
      window.ensureGomokuFeature('online').then(() => {
        if (typeof window.resumePendingQuickMatch === 'function') {
          return window.resumePendingQuickMatch();
        }
        throw new Error('匹配恢复模块未注册');
      }).catch(error => console.warn('[sky match resume]', error?.message || error));
    }, 0);
  }

  function init() {
    clearLegacyThemeState();
    simplifySettings();
    buildTopbar();
    buildLobby();
    bindHomeBoardPreview();
    buildSheet();
    document.body.classList.add('sky-lobby-open');

    // Android 返回键优先关闭当前层；标准棋局逻辑仍交给原处理器。
    const originalAndroidBack = window.handleAndroidBack;
    window.handleAndroidBack = function() {
      if (sheetBackdrop?.classList.contains('show')) {
        closeSheet();
        return true;
      }
      if (typeof originalAndroidBack === 'function' && originalAndroidBack()) return true;
      if (document.body.classList.contains('sky-game-open')) {
        showLobby();
        return true;
      }
      return false;
    };

    resumePendingMatchOnLaunch();
  }

  window.SkyIslandUI = Object.freeze({
    showLobby,
    showGame,
    enterMode: enterStandardMode,
    closeSheet,
    isLobbyOpen: () => Boolean(lobby && !lobby.hidden)
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
