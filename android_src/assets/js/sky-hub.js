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
          <span class="sky-brand-mark" aria-hidden="true">●</span>
          <span><strong>天空棋岛</strong><small>云上活棋谱</small></span>
        </div>
        <button class="sky-bulletin" type="button" data-sky-action="bulletin" aria-label="打开今日岛讯">
          <span aria-hidden="true">☁</span><span>今日岛讯：第一条残局航线已开放</span>
        </button>
      </header>
      <main class="sky-lobby-main">
        <section class="sky-lobby-copy" aria-labelledby="skyLobbyTitle">
          <div class="sky-lobby-kicker">一手一岛 · 每局都有目的地</div>
          <h1 id="skyLobbyTitle">让下一手<br>唤醒整座岛</h1>
          <p>从高张力残局开始，沿着七座棋台穿过云层。标准五子棋仍是规则，变化来自每一盘真正值得思考的棋形。</p>
          <button class="sky-primary-action" type="button" data-sky-action="expedition">
            <span><b id="skyContinueLabel">开始远征</b><small id="skyExpeditionProgress">新航线 · 从云隙初光开始</small></span>
            <span class="sky-primary-arrow" aria-hidden="true">→</span>
          </button>
        </section>
        <div class="sky-hero-island" aria-hidden="true">
          <div class="sky-hero-grid">
            <i class="sky-hero-stone black s1"></i><i class="sky-hero-stone white s2"></i>
            <i class="sky-hero-stone black s3"></i><i class="sky-hero-stone white s4"></i>
            <i class="sky-hero-stone black s5"></i><i class="sky-hero-breath"></i>
          </div>
        </div>
        <aside class="sky-route-list" aria-label="对局入口">
          <button class="sky-route-button" type="button" data-sky-action="quick">
            <span class="sky-route-icon">●</span><span><strong>快速对局</strong><small>AI、同屏或全服匹配</small></span><span>›</span>
          </button>
          <button class="sky-route-button" type="button" data-sky-action="friends">
            <span class="sky-route-icon">∞</span><span><strong>好友云桥</strong><small>邀战、房间码与私聊</small></span><span>›</span>
          </button>
          <button class="sky-route-button" type="button" data-sky-action="lab">
            <span class="sky-route-icon">✚</span><span><strong>实验风场</strong><small>十字棋实验规则</small></span><span>›</span>
          </button>
        </aside>
      </main>
      <nav class="sky-lobby-nav" aria-label="一级导航">
        <button type="button" data-sky-nav="game" aria-current="page"><span>●</span>游戏</button>
        <button type="button" data-sky-nav="friends"><span>∞</span>好友</button>
        <button type="button" data-sky-nav="records"><span>⌁</span>棋谱</button>
        <button type="button" data-sky-nav="me"><span>○</span>我的</button>
      </nav>`;
  }

  function buildLobby() {
    lobby = document.createElement('section');
    lobby.id = 'skyLobby';
    lobby.className = 'sky-lobby';
    lobby.setAttribute('aria-label', '天空棋岛大厅');
    lobby.innerHTML = lobbyMarkup();
    document.body.appendChild(lobby);

    lobby.addEventListener('click', event => {
      const action = event.target.closest('[data-sky-action]')?.dataset.skyAction;
      if (action) runAction(action);
      const nav = event.target.closest('[data-sky-nav]')?.dataset.skyNav;
      if (nav) runNav(nav);
    });
    refreshProgress();
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
    window.setTimeout(() => window.dispatchEvent(new Event('resize')), 40);
  }

  function showLobby() {
    setCardsOpen(false);
    document.body.classList.remove('sky-game-open');
    document.body.classList.add('sky-lobby-open');
    if (lobby) lobby.hidden = false;
    refreshProgress();
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
    else if (action === 'friends') openFriends();
    else if (action === 'lab') openLabSheet();
    else if (action === 'bulletin') openBulletin();
  }

  function runNav(nav) {
    if (nav === 'game') return;
    if (nav === 'friends') openFriends();
    if (nav === 'records') runSheetAction('records');
    if (nav === 'me') openMeSheet();
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
      elevateLegacyModal('historyModal');
      safeCall('openHistoryModal');
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
