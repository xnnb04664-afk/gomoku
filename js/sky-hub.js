(() => {
  'use strict';

  const THEME_KEYS = [
    'theme-zen-dark', 'theme-sweet-romance', 'theme-neo-trad',
    'theme-luxury-glass', 'theme-clean-ios'
  ];
  const PROGRESS_KEY = 'gomoku_expedition_progress_v1';
  let lobby = null;
  let sheetBackdrop = null;
  let topbar = null;
  let navWorkspace = null;
  let activeNav = 'game';

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

  function getProgress() {
    try {
      const value = JSON.parse(localStorage.getItem(PROGRESS_KEY) || '{}');
      const completed = Array.isArray(value.completed) ? value.completed.length : 0;
      const current = Math.max(1, Math.min(7, Number(value.current) || completed + 1));
      return { completed, current };
    } catch (_) {
      return { completed: 0, current: 1 };
    }
  }

  function refreshProgress() {
    const progress = getProgress();
    const label = document.getElementById('skyExpeditionProgress');
    if (label) label.textContent = progress.completed
      ? `已点亮 ${progress.completed} / 7 座棋台 · 继续第 ${progress.current} 关`
      : '新航线 · 从云隙初光开始';
    const action = document.getElementById('skyContinueLabel');
    if (action) action.textContent = progress.completed ? '继续远征' : '开始远征';
  }

  function lobbyMarkup() {
    return `
      <header class="sky-lobby-top">
        <div class="sky-brand">
          <span class="sky-brand-mark" aria-hidden="true"><i></i></span>
          <span><strong>天空棋岛</strong><small>夕照云海 · 黑曜棋台</small></span>
        </div>
        <nav class="sky-lobby-nav" aria-label="天空航标">
          <button type="button" data-sky-nav="game" aria-current="page"><span aria-hidden="true">⌂</span><b>对局</b></button>
          <button type="button" data-sky-nav="friends"><span aria-hidden="true">∞</span><b>好友</b></button>
          <button type="button" data-sky-nav="records"><span aria-hidden="true">⌁</span><b>棋谱</b></button>
          <button type="button" data-sky-nav="me"><span aria-hidden="true">○</span><b>我的</b></button>
        </nav>
        <div class="sky-lobby-tools">
          <button class="sky-bulletin sky-broadcast-trigger" type="button" data-sky-action="chat" aria-label="打开世界聊天">
            <span aria-hidden="true">◌</span><span>云层广播</span><em id="skyWorldUnread" hidden>0</em>
          </button>
          <button class="sky-bulletin sky-bulletin-secondary" type="button" data-sky-action="bulletin" aria-label="打开今日岛讯">
            <span aria-hidden="true">☼</span><span>今日岛讯</span>
          </button>
        </div>
      </header>
      <div class="sky-lobby-stage">
        <main id="skyGameHome" class="sky-lobby-main sky-cockpit-main" data-sky-screen="game">
          <div class="sky-cockpit-ribbon">
            <span class="sky-status-signal"><i></i> 棋台已就位</span>
            <span>标准局 · 15 × 15</span>
            <span class="sky-cockpit-index">LIVE BOARD / 01</span>
          </div>
          <section class="sky-board-bay" aria-labelledby="skyLobbyTitle">
            <div class="sky-board-halo" aria-hidden="true"></div>
            <div class="sky-route-orbit" aria-hidden="true"><i class="node node-a"></i><i class="node node-b"></i><i class="node node-c"></i><span></span></div>
            <div class="sky-preview-board" role="img" aria-label="天空棋台预览，黑白棋石正在等待第一手">
              <div class="sky-preview-surface">
                <div class="sky-preview-grid" aria-hidden="true"></div>
                <i class="sky-preview-stone black p1"></i><i class="sky-preview-stone white p2"></i>
                <i class="sky-preview-stone black p3"></i><i class="sky-preview-stone white p4"></i>
                <i class="sky-preview-stone black p5"></i><i class="sky-preview-cursor"></i>
              </div>
              <div class="sky-preview-coordinate sky-preview-coordinate-top">A · B · C · D · E · F · G</div>
              <div class="sky-preview-coordinate sky-preview-coordinate-bottom">落子后，航线会亮起来</div>
            </div>
            <div class="sky-board-caption"><span>等待第一手</span><small>棋台中央 · 黑方先行</small></div>
          </section>
          <section class="sky-command-deck">
            <div class="sky-command-copy">
              <div class="sky-lobby-kicker">一手一岛 · 每局都有目的地</div>
              <h1 id="skyLobbyTitle">让下一手<br><em>唤醒整座岛</em></h1>
              <p>先落下一颗棋子，再让航线告诉你下一步往哪里走。</p>
            </div>
            <div class="sky-command-actions">
              <button class="sky-primary-action sky-primary-live" type="button" data-sky-action="quick">
                <span><b>开始对局</b><small>本地 AI · 双人同屏 · 好友联机</small></span>
                <span class="sky-primary-arrow" aria-hidden="true">↗</span>
              </button>
              <div class="sky-mode-rail" aria-label="其他玩法">
                <button type="button" data-sky-action="friends"><span>∞</span>好友云桥</button>
                <button type="button" data-sky-action="lab"><span>✚</span>十字棋实验</button>
                <button type="button" data-sky-action="expedition"><span>☼</span><b id="skyContinueLabel">开始远征</b></button>
              </div>
            </div>
          </section>
          <button class="sky-broadcast-strip" type="button" data-sky-action="chat" aria-label="打开世界聊天">
            <span class="sky-broadcast-mark" aria-hidden="true">◌</span>
            <span><b>云层广播</b><small>世界聊天 · 看看棋友此刻在说什么</small></span>
            <span class="sky-broadcast-preview">“下一手，交给风。”</span><strong>打开 →</strong>
          </button>
          <div class="sky-lobby-footline"><span id="skyExpeditionProgress">新航线 · 从云隙初光开始</span><span>不联网也能随时开始</span></div>
        </main>
      <section id="skyNavWorkspace" class="sky-nav-workspace" data-sky-screen="workspace" aria-live="polite" hidden></section>
      </div>
      `;
  }

  function buildLobby() {
    lobby = document.createElement('section');
    lobby.id = 'skyLobby';
    lobby.className = 'sky-lobby';
    lobby.setAttribute('aria-label', '天空棋岛大厅');
    lobby.innerHTML = lobbyMarkup();
    document.body.appendChild(lobby);
    navWorkspace = lobby.querySelector('#skyNavWorkspace');

    lobby.addEventListener('click', event => {
      const navAction = event.target.closest('[data-nav-action]')?.dataset.navAction;
      if (navAction) {
        runNavAction(navAction);
        return;
      }
      const action = event.target.closest('[data-sky-action]')?.dataset.skyAction;
      if (action) runAction(action);
      const nav = event.target.closest('[data-sky-nav]')?.dataset.skyNav;
      if (nav) runNav(nav);
    });
    setActiveNav('game');
    refreshProgress();
  }

  function navWorkspaceMarkup(nav) {
    if (nav === 'friends') return `
      <div class="sky-nav-page sky-nav-page-friends sky-space-page">
        <div class="sky-space-heading">
          <div><span class="sky-nav-eyebrow">FRIENDS / 云桥</span><h1>棋友在云上相逢</h1><p>把一盘棋递过云层。在线节点会亮起，邀请、房间码和世界聊天都从同一条航线出发。</p></div>
          <span class="sky-space-glyph" aria-hidden="true">∞</span>
        </div>
        <section class="sky-island-network" aria-label="好友云桥预览">
          <div class="sky-network-map" aria-hidden="true"><i class="network-line line-one"></i><i class="network-line line-two"></i><i class="network-node node-home">你</i><i class="network-node node-online">星舟</i><i class="network-node node-away">南风</i><i class="network-node node-chat">◌</i></div>
          <div class="sky-network-copy"><span class="sky-space-kicker">TODAY / 云桥在线</span><strong>今天，和谁下一手？</strong><small>连接按需建立，不会打断离线对局。</small><button class="sky-nav-primary" type="button" data-nav-action="friends-open"><span>打开好友云桥</span><b aria-hidden="true">↗</b></button></div>
        </section>
        <div class="sky-space-command-line"><button type="button" data-nav-action="friends-room"><span>↗</span><b>创建棋局</b><small>发出一张云上邀请</small></button><button type="button" data-nav-action="friends-match"><span>↯</span><b>快速找对手</b><small>现在就开一盘标准局</small></button><button type="button" data-nav-action="friends-chat"><span>◌</span><b>云端消息</b><small>查看棋友留下的话</small></button></div>
        <div class="sky-nav-footnote"><span class="sky-nav-dot"></span>好友服务按需连接 · 世界聊天需要正式账号发送消息。</div>
      </div>`;
    if (nav === 'records') return `
      <div class="sky-nav-page sky-nav-page-records sky-space-page">
        <div class="sky-space-heading"><div><span class="sky-nav-eyebrow">RECORDS / 活棋谱</span><h1>每一手，都有回声</h1><p>把对局变成一条可回看的航线：棋盘留在中央，转折留在时间线上。</p></div><span class="sky-space-glyph sky-glyph-line" aria-hidden="true">⌁</span></div>
        <section class="sky-replay-console" aria-label="棋谱回放预览"><div class="sky-replay-board"><span class="replay-stone rs-1"></span><span class="replay-stone rs-2"></span><span class="replay-stone rs-3"></span><span class="replay-stone rs-4"></span></div><div class="sky-replay-copy"><span class="sky-space-kicker">LATEST ECHO / 最近回声</span><strong>暂无新的远征回声</strong><small>先完成一盘对局，第一颗棋谱星点就会亮起。</small><button class="sky-nav-primary sky-nav-primary-light" type="button" data-nav-action="records-history"><span>查看全部棋谱</span><b aria-hidden="true">↗</b></button></div></section>
        <div class="sky-timeline"><span class="timeline-fill"></span><i>01</i><i>04</i><i>08</i><i>15</i><b>落子时间线 · 拖动后回到任意一手</b></div>
        <div class="sky-space-command-line"><button type="button" data-nav-action="records-history"><span>⌁</span><b>对局历史</b><small>复盘每一处转折</small></button><button type="button" data-nav-action="records-rank"><span>✦</span><b>棋力排行</b><small>看看你在棋岛的位置</small></button><button type="button" data-nav-action="records-expedition"><span>☼</span><b>远征进度</b><small>七座棋台的点亮记录</small></button></div>
        <div class="sky-nav-footnote"><span class="sky-nav-dot sky-nav-dot-sun"></span>只记录结果，不打断你正在进行的棋局。</div>
      </div>`;
    return `
      <div class="sky-nav-page sky-nav-page-me sky-space-page">
        <div class="sky-space-heading"><div><span class="sky-nav-eyebrow">MY ISLAND / 我的</span><h1>把棋岛调成你的样子</h1><p>从昵称到画质，从活动到反馈，这里是你的航海日志，也是所有偏好的停靠点。</p></div><span class="sky-space-glyph sky-avatar-glyph" aria-hidden="true">小能</span></div>
        <section class="sky-captain-plaque"><div class="sky-captain-avatar">小</div><div><span class="sky-space-kicker">CURRENT CAPTAIN / 当前旅人</span><strong>小能</strong><small>晴空棋岛 · 离线也能继续远征</small></div><button class="sky-nav-primary" type="button" data-nav-action="me-profile"><span>查看资料</span><b aria-hidden="true">↗</b></button></section>
        <div class="sky-island-readout"><span>远征</span><b>00</b><span>棋谱</span><b>00</b><span>棋友</span><b>离线</b></div>
        <div class="sky-space-command-line"><button type="button" data-nav-action="me-activity"><span>☼</span><b>活动与签到</b><small>查看金币与活动记录</small></button><button type="button" data-nav-action="me-settings"><span>≡</span><b>显示与声音</b><small>统一的官方晴空视觉</small></button><button type="button" data-nav-action="me-feedback"><span>↗</span><b>提交反馈</b><small>告诉我们下一站想去哪里</small></button></div>
        <div class="sky-nav-footnote"><span class="sky-nav-dot sky-nav-dot-moss"></span>你的设置保存在本机，换设备时可随时重新调整。</div>
      </div>`;
  }

  function setActiveNav(nav) {
    const next = ['game', 'friends', 'records', 'me'].includes(nav) ? nav : 'game';
    activeNav = next;
    const gameHome = lobby?.querySelector('#skyGameHome');
    if (gameHome) gameHome.hidden = next !== 'game';
    if (navWorkspace) {
      navWorkspace.hidden = next === 'game';
      navWorkspace.dataset.screen = next;
      navWorkspace.innerHTML = next === 'game' ? '' : navWorkspaceMarkup(next);
      // Each workspace page is a new scroll context.  Without resetting it,
      // switching away from a scrolled page leaves the next page clipped at
      // the same offset (especially visible on the mobile WebView).
      navWorkspace.scrollTop = 0;
    }
    lobby?.querySelectorAll('[data-sky-nav]').forEach(button => {
      const selected = button.dataset.skyNav === next;
      if (selected) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
  }

  function runNavAction(action) {
    if (action === 'friends-open') {
      openFriends();
    } else if (action === 'friends-chat') {
      closeSheet();
      if (window.GomokuWorldChat?.open) window.GomokuWorldChat.open();
      else openFriends();
    } else if (action === 'friends-room') {
      showGame();
      safeCall('openOnlineModal', 'create');
    } else if (action === 'friends-match') {
      showGame();
      safeCall('openOnlineModal', 'match');
    } else if (action === 'records-history') {
      closeSheet();
      elevateLegacyModal('historyModal');
      safeCall('openHistoryModal');
    } else if (action === 'records-rank') {
      closeSheet();
      elevateLegacyModal('leaderboardModal');
      safeCall('openLeaderboardModal');
    } else if (action === 'records-expedition') {
      closeSheet();
      window.openSkyExpedition?.();
    } else if (action === 'me-profile' || action === 'me-activity' || action === 'me-settings' || action === 'me-feedback') {
      runSheetAction(action.slice(3));
    }
  }

  function buildTopbar() {
    topbar = document.createElement('header');
    topbar.className = 'sky-game-topbar';
    topbar.innerHTML = `
      <button type="button" data-game-action="lobby">← 棋岛</button>
      <div class="sky-game-title"><strong>晴空主棋台</strong><small>标准 15 × 15 · 落子成五</small></div>
      <button type="button" data-game-action="more">棋术</button>`;
    const header = document.querySelector('.header-area');
    if (header) header.before(topbar); else document.body.prepend(topbar);
    topbar.addEventListener('click', event => {
      const action = event.target.closest('[data-game-action]')?.dataset.gameAction;
      if (action === 'lobby') showLobby();
      if (action === 'more') setCardsOpen(!document.body.classList.contains('sky-cards-open'));
    });
  }

  function setCardsOpen(open) {
    const next = Boolean(open);
    document.body.classList.toggle('sky-cards-open', next);
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

  function openQuickSheet() {
    openSheet('选择一条对局航线', '所有模式仍使用同一张15×15棋盘；网络连接会在需要时自动建立。', [
      { action: 'ai', icon: '●', title: '与大师 AI 对弈', detail: '本地运行，离线也能开始' },
      { action: 'match', icon: '↯', title: '全服快速匹配', detail: '寻找水平相近的在线棋友' },
      { action: 'pvp', icon: '◐', title: '双人同屏', detail: '一台设备，黑白双方轮流落子' }
    ]);
  }

  function openLabSheet() {
    openSheet('实验风场', '实验模式拥有独立规则，不会改变标准五子棋与天梯记录。', [
      { action: 'cross', icon: '✚', title: '十字棋', detail: '十字轴十连 · 每回合连续行动两次' }
    ]);
  }

  function openBulletin() {
    openSheet('今日岛讯', '内容只在你主动打开时出现，不会遮挡正在进行的棋局。', [
      { action: 'expedition', icon: '☀', title: '残局航线开放', detail: '七座棋台已就绪，进度只保存在本机' },
      { action: 'records', icon: '⌁', title: '棋谱仍在原处', detail: '标准AI与联机历史不会被远征短局覆盖' }
    ]);
  }

  function openMeSheet() {
    openSheet('我的棋岛', '账号、活动和设置集中在这里，不再占据棋盘周围。', [
      { action: 'profile', icon: '○', title: '个人资料', detail: '昵称、头像与账号状态' },
      { action: 'activity', icon: '☀', title: '活动与签到', detail: '查看现有金币与活动记录' },
      { action: 'settings', icon: '≡', title: '显示与声音', detail: '官方晴空视觉、画质与偏好' },
      { action: 'feedback', icon: '↗', title: '提交反馈', detail: '告诉我们哪一步还不够顺手' }
    ]);
  }

  function showGame() {
    closeSheet();
    lobby.hidden = true;
    document.body.classList.remove('sky-lobby-open');
    document.body.classList.add('sky-game-open');
    if (typeof window.__gomokuEnsureBoardReady === 'function') {
      window.__gomokuEnsureBoardReady();
    }
    window.setTimeout(() => window.dispatchEvent(new Event('resize')), 40);
  }

  function showLobby() {
    setCardsOpen(false);
    document.body.classList.remove('sky-game-open');
    document.body.classList.add('sky-lobby-open');
    if (lobby) lobby.hidden = false;
    setActiveNav('game');
    refreshProgress();
  }

  function warmBoardSurface() {
    const warm = () => {
      if (document.body.classList.contains('sky-game-open')) return;
      if (typeof window.__gomokuEnsureBoardReady === 'function') {
        window.__gomokuEnsureBoardReady();
      }
    };
    // 用零延迟任务排在大厅挂载之后，确保棋盘预热不阻塞大厅 DOM 构建，
    // 同时比 requestIdleCallback 更稳定地覆盖低端 WebView 的忙碌首屏。
    window.setTimeout(warm, 0);
  }

  function enterStandardMode(mode) {
    closeSheet();
    document.body.classList.add('sky-mode-loading');
    const result = safeCall('setMode', mode);
    Promise.resolve(result).finally(() => {
      document.body.classList.remove('sky-mode-loading');
      showGame();
    });
  }

  function openFriends() {
    closeSheet();
    Promise.resolve(window.openFriendsModal?.()).catch(error => console.warn('[sky friends]', error?.message || error));
  }

  function runAction(action) {
    if (action === 'expedition') {
      closeSheet();
      Promise.resolve(window.openSkyExpedition?.()).catch(error => console.warn('[sky expedition]', error?.message || error));
    } else if (action === 'quick') openQuickSheet();
    else if (action === 'friends') setActiveNav('friends');
    else if (action === 'chat') {
      closeSheet();
      if (window.GomokuWorldChat?.open) window.GomokuWorldChat.open();
      else openFriends();
    }
    else if (action === 'lab') openLabSheet();
    else if (action === 'bulletin') openBulletin();
  }

  function runNav(nav) {
    setActiveNav(nav);
  }

  function runSheetAction(action) {
    if (action === 'ai') {
      enterStandardMode('ai');
    } else if (action === 'pvp') {
      enterStandardMode('pvp');
    } else if (action === 'match') {
      showGame();
      safeCall('openOnlineModal', 'match');
    } else if (action === 'online') {
      showGame();
      safeCall('openOnlineModal', 'create');
    } else if (action === 'cross') {
      showGame();
      safeCall('openCrossChess');
    } else if (action === 'expedition') {
      closeSheet();
      window.openSkyExpedition?.();
    } else if (action === 'records') {
      closeSheet();
      setActiveNav('records');
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
        <div><div class="undo-title" style="text-align:left;margin:0">显示与声音</div><div style="margin-top:3px;color:#64748b;font-size:10px;font-weight:800">统一使用官方晴空浮岛草坪视觉</div></div>
        <button type="button" class="btn-chat-tool" onclick="closeThemeModal()" aria-label="关闭设置">✕</button>
      </div>
      <div class="sky-only-settings-note"><strong>唯一官方视觉</strong><br>云纸、深天蓝、岛屿苔绿与黑白棋石组成同一个世界。视觉会随棋局状态变化，不再提供多主题换肤。</div>
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
  }

  function init() {
    clearLegacyThemeState();
    simplifySettings();
    buildTopbar();
    buildLobby();
    buildSheet();
    document.body.classList.add('sky-lobby-open');
    // 启动大厅先响应导航；随后在空闲帧预热标准棋盘，让用户点“快速对局”
    // 时无需再等待 Canvas 首次建图。
    warmBoardSurface();
    window.addEventListener('gomoku:expedition-progress', refreshProgress);

    // Android 返回键优先关闭当前层；标准棋局逻辑仍交给原处理器。
    const originalAndroidBack = window.handleAndroidBack;
    window.handleAndroidBack = function() {
      if (window.GomokuExpedition?.isOpen?.()) {
        window.GomokuExpedition.close();
        return true;
      }
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
  }

  window.SkyIslandUI = Object.freeze({
    showLobby,
    showGame,
    closeSheet,
    openBulletin,
    refreshProgress,
    isLobbyOpen: () => Boolean(lobby && !lobby.hidden)
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
