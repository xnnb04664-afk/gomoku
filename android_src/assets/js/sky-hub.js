(() => {
  'use strict';

  const THEME_KEYS = [
    'theme-zen-dark', 'theme-sweet-romance', 'theme-neo-trad',
    'theme-luxury-glass', 'theme-clean-ios'
  ];
  const PROGRESS_KEY = 'gomoku_expedition_progress_v1';
  const DEFAULT_EXPEDITION_LEVEL_TOTAL = 48;
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

  function expeditionLevelTotal() {
    try {
      const total = Number(window.GomokuExpedition?.levels?.length);
      if (Number.isFinite(total) && total > 0) return total;
    } catch (_) {}
    return DEFAULT_EXPEDITION_LEVEL_TOTAL;
  }

  function getProgress() {
    try {
      const value = JSON.parse(localStorage.getItem(PROGRESS_KEY) || '{}');
      const total = expeditionLevelTotal();
      const completed = Math.min(total, Array.isArray(value.completed) ? value.completed.length : 0);
      const storedCurrent = Number(value.current) || 0;
      const current = Math.max(1, Math.min(total, storedCurrent > completed ? storedCurrent : completed + 1));
      return { completed, current };
    } catch (_) {
      return { completed: 0, current: 1 };
    }
  }

  function refreshProgress() {
    const progress = getProgress();
    const total = expeditionLevelTotal();
    const label = document.getElementById('skyExpeditionProgress');
    if (label) label.textContent = progress.completed >= total
      ? `${total} 座棋台已全部点亮 · 重温第 ${total} 关`
      : progress.completed
      ? `已点亮 ${progress.completed} / ${total} 座棋台 · 继续第 ${progress.current} 关`
      : '新航线 · 从云隙初光开始';
    const action = document.getElementById('skyContinueLabel');
    if (action) action.textContent = progress.completed ? '继续远征' : '开始远征';
  }

  function parseRecordsArray(value) {
    if (Array.isArray(value)) return value;
    if (typeof value !== 'string' || !value.trim()) return [];
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      return [];
    }
  }

  function recordsStorageKey() {
    try {
      if (typeof getHistoryStorageKey === 'function') return getHistoryStorageKey();
    } catch (_) {}
    try {
      return (typeof currentUserUid !== 'undefined' && currentUserUid)
        ? `gomoku_history_${currentUserUid}`
        : 'gomoku_game_history_guest';
    } catch (_) {
      return 'gomoku_game_history_guest';
    }
  }

  function getRecordsList() {
    try {
      const value = JSON.parse(localStorage.getItem(recordsStorageKey()) || '[]');
      return Array.isArray(value) ? value : [];
    } catch (_) {
      return [];
    }
  }

  function escapeRecordsHTML(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[character]));
  }

  function recordMoveCount(item) {
    const explicit = Number(item?.moves);
    if (Number.isFinite(explicit)) return Math.max(0, Math.min(512, Math.round(explicit)));
    return parseRecordsArray(item?.movesData).filter(move => move && Number.isFinite(Number(move.r)) && Number.isFinite(Number(move.c))).length;
  }

  function recordFlag(value) {
    return value === true || value === 1 || value === '1' || value === 'true';
  }

  function recordStatus(item) {
    if (recordFlag(item?.isDraw)) return { label: '和棋', icon: '◎', className: 'is-draw' };
    if (recordFlag(item?.isWin)) return { label: '胜利', icon: '✦', className: 'is-win' };
    return { label: '惜败', icon: '×', className: 'is-loss' };
  }

  function recordModeLabel(mode) {
    if (mode === 'online') return '全服联机';
    if (mode === 'pvp') return '同屏对战';
    if (mode === 'cross') return '十字棋实验';
    return '大师 AI';
  }

  function recordDateLabel(item) {
    const date = String(item?.date || '').trim();
    const time = String(item?.time || '').trim();
    return [date, time].filter(Boolean).join(' · ') || '刚刚完成';
  }

  function recordStoneEntries(item) {
    const board = parseRecordsArray(item?.boardData);
    const stones = [];
    if (board.length >= 15) {
      for (let r = 0; r < 15; r += 1) {
        const row = Array.isArray(board[r]) ? board[r] : [];
        for (let c = 0; c < 15; c += 1) {
          const piece = Number(row[c]);
          if (piece === 1 || piece === 2) stones.push({ r, c, p: piece });
        }
      }
    }
    const moves = parseRecordsArray(item?.movesData).filter(move => (
      move && Number.isFinite(Number(move.r)) && Number.isFinite(Number(move.c)) &&
      Number(move.r) >= 0 && Number(move.r) < 15 && Number(move.c) >= 0 && Number(move.c) < 15 &&
      (Number(move.p) === 1 || Number(move.p) === 2)
    ));
    if (!stones.length) {
      const occupied = new Map();
      moves.forEach(move => occupied.set(`${Number(move.r)}:${Number(move.c)}`, {
        r: Number(move.r), c: Number(move.c), p: Number(move.p)
      }));
      stones.push(...occupied.values());
    }
    const last = moves.length ? moves[moves.length - 1] : stones[stones.length - 1];
    const lastKey = last ? `${Number(last.r)}:${Number(last.c)}` : '';
    return { stones, lastKey };
  }

  function renderRecordsBoard(item) {
    const { stones, lastKey } = recordStoneEntries(item || {});
    const decorative = !item && [
      { r: 7, c: 7, p: 1 }, { r: 7, c: 8, p: 2 },
      { r: 8, c: 8, p: 1 }, { r: 6, c: 8, p: 2 }
    ];
    const visibleStones = stones.length ? stones : decorative;
    const stoneMarkup = visibleStones.map(stone => {
      const row = Math.max(0, Math.min(14, Number(stone.r) || 0));
      const col = Math.max(0, Math.min(14, Number(stone.c) || 0));
      const isLast = lastKey === `${row}:${col}`;
      const left = (7 + col * (86 / 14)).toFixed(3);
      const top = (7 + row * (86 / 14)).toFixed(3);
      return `<i class="sky-records-stone ${Number(stone.p) === 2 ? 'is-white' : 'is-black'}${isLast ? ' is-last' : ''}" style="left:${left}%;top:${top}%" aria-hidden="true"></i>`;
    }).join('');
    const label = item ? `VS ${escapeRecordsHTML(item.oppName || '对手')} 的终局棋形` : '等待第一局棋谱落点';
    return `<div class="sky-records-board" role="img" aria-label="${label}"><div class="sky-records-board-grid" aria-hidden="true"></div>${stoneMarkup}<span class="sky-records-board-corner sky-records-board-corner-tl">A</span><span class="sky-records-board-corner sky-records-board-corner-br">15</span></div>`;
  }

  function recordsTimelineMarkup(item) {
    const moves = recordMoveCount(item);
    if (!moves) return '<div class="sky-records-route is-empty"><span class="sky-records-route-line"></span><span class="sky-records-route-point is-active">·</span><small>第一手落下后，航线会在这里留下光点</small></div>';
    const points = [...new Set([1, Math.max(1, Math.round(moves * .25)), Math.max(1, Math.round(moves * .55)), moves])];
    const pointMarkup = points.map((point, index) => `<span class="sky-records-route-point${index === points.length - 1 ? ' is-active' : ''}" style="left:${points.length === 1 ? 100 : (index / (points.length - 1)) * 100}%"><b>${String(point).padStart(2, '0')}</b></span>`).join('');
    return `<div class="sky-records-route"><span class="sky-records-route-line"><i style="width:100%"></i></span>${pointMarkup}<small>第 01 手出发 · 第 ${String(moves).padStart(2, '0')} 手收束 · 点击记录可进入逐手复盘</small></div>`;
  }

  function renderRecordsWorkspace() {
    const list = getRecordsList();
    const latest = list[0] || null;
    const wins = list.filter(item => recordFlag(item?.isWin) && !recordFlag(item?.isDraw)).length;
    const draws = list.filter(item => recordFlag(item?.isDraw)).length;
    const losses = Math.max(0, list.length - wins - draws);
    const totalMoves = list.reduce((sum, item) => sum + recordMoveCount(item), 0);
    const averageMoves = list.length ? Math.round(totalMoves / list.length) : 0;
    const winRate = list.length ? Math.round((wins / list.length) * 100) : 0;
    const status = latest ? recordStatus(latest) : null;
    const opponent = latest ? escapeRecordsHTML(latest.oppName || '对手') : '';
    const latestMoves = latest ? recordMoveCount(latest) : 0;
    const recentMarkup = list.slice(0, 5).map((item, index) => {
      const itemStatus = recordStatus(item);
      return `<button class="sky-record-item" type="button" data-record-index="${index}" aria-label="打开与 ${escapeRecordsHTML(item.oppName || '对手')} 的棋谱复盘">
        <span class="sky-record-item-status ${itemStatus.className}"><b>${itemStatus.icon}</b><small>${itemStatus.label}</small></span>
        <span class="sky-record-item-main"><strong>VS ${escapeRecordsHTML(item.oppName || '对手')}</strong><small>${recordModeLabel(item.mode)} · ${escapeRecordsHTML(recordDateLabel(item))} · ${recordMoveCount(item)} 手</small></span>
        <span class="sky-record-item-arrow" aria-hidden="true">↗</span>
      </button>`;
    }).join('');
    const listBlock = list.length
      ? `<div class="sky-records-log-list">${recentMarkup}</div>`
      : `<div class="sky-records-empty-log"><span>⌁</span><strong>还没有棋谱航线</strong><small>完成一盘对局后，结果和每一步都会自动停靠在这里。</small><button class="sky-records-inline-action" type="button" data-sky-action="quick">开启第一局 <b>↗</b></button></div>`;
    const latestAction = latest
      ? `<button class="sky-records-primary-action" type="button" data-record-index="0"><span>进入逐手复盘</span><b>↗</b></button>`
      : `<button class="sky-records-primary-action" type="button" data-sky-action="quick"><span>开启第一局对弈</span><b>↗</b></button>`;
    const latestSecondary = `<button class="sky-records-secondary-action" type="button" data-nav-action="records-history"><span>打开完整战报</span><b>⌁</b></button>`;
    return `
      <div class="sky-nav-page sky-nav-page-records sky-space-page">
        <div class="sky-space-heading">
          <div><span class="sky-nav-eyebrow">RECORDS / 活棋谱</span><h1>每一手，都有回声</h1><p>把每一盘棋保存成一条可回看的航线。胜负、转折和最后一手，都在这里重新亮起。</p></div>
          <span class="sky-space-glyph sky-glyph-line" aria-hidden="true">⌁</span>
        </div>
        <section class="sky-records-overview" aria-label="棋谱统计">
          <div class="sky-records-section-label"><span>LOGBOOK / 棋岛航海日志</span><b>${list.length ? `最近 ${list.length} 局` : '等待首局'}</b></div>
          <div class="sky-records-metrics">
            <div><small>总对局</small><strong>${list.length}</strong><span>最近 30 局</span></div>
            <div><small>胜率</small><strong>${winRate}<em>%</em></strong><span>${wins} 胜 · ${losses} 负 · ${draws} 和</span></div>
            <div><small>平均手数</small><strong>${averageMoves || '—'}</strong><span>${list.length ? '每局落子' : '尚无数据'}</span></div>
            <div><small>棋谱状态</small><strong class="sky-records-metric-signal">${list.length ? '已归档' : '待点亮'}</strong><span>${list.length ? '可随时复盘' : '离线也会保存'}</span></div>
          </div>
        </section>
        <section class="sky-records-hero${latest ? '' : ' is-empty'}" aria-label="最近一局棋谱">
          <div class="sky-records-board-column">
            <div class="sky-records-board-topline"><span>${latest ? 'FINAL POSITION / 终局棋形' : 'NEXT ECHO / 下一颗星点'}</span><b>${latest ? `${latestMoves} 手` : '15 × 15'}</b></div>
            ${renderRecordsBoard(latest)}
            <div class="sky-records-board-note"><span class="sky-records-last-dot"></span>${latest ? '金色光点标记最后一手' : '黑方先行 · 棋台等待落子'}</div>
          </div>
          <div class="sky-records-latest-copy">
            <span class="sky-space-kicker">LATEST ECHO / 最近回声</span>
            <div class="sky-records-result-line">${status ? `<span class="sky-records-status ${status.className}">${status.icon} ${status.label}</span>` : '<span class="sky-records-status is-pending">○ 尚未开局</span>'}<small>${latest ? escapeRecordsHTML(recordDateLabel(latest)) : '你的第一盘棋会从这里开始'}</small></div>
            <h2>${latest ? `VS ${opponent}` : '让第一颗棋子落下'}</h2>
            <p>${latest ? `${recordModeLabel(latest.mode)} · ${latestMoves} 手收束。把终局倒带，看看哪一次转折改变了整条航线。` : '完成一盘对局后，这里会出现真实棋形、对手信息和可拖动的逐手复盘。'}</p>
            <div class="sky-records-meta-grid"><span><small>对局模式</small><b>${latest ? recordModeLabel(latest.mode) : '等待选择'}</b></span><span><small>回放能力</small><b>${latest && parseRecordsArray(latest.movesData).length ? '完整走法谱' : '完成后可用'}</b></span></div>
            <div class="sky-records-actions">${latestAction}${latestSecondary}</div>
          </div>
        </section>
        ${recordsTimelineMarkup(latest)}
        <section class="sky-records-log" aria-label="近期棋谱">
          <div class="sky-records-section-label"><span>RECENT ROUTES / 近期航线</span><button type="button" data-nav-action="records-history">查看全部 ${list.length ? `(${list.length})` : ''} <b>↗</b></button></div>
          ${listBlock}
        </section>
        <div class="sky-space-command-line"><button type="button" data-nav-action="records-history"><span>⌁</span><b>对局历史</b><small>打开完整战报与清理管理</small></button><button type="button" data-nav-action="records-rank"><span>✦</span><b>棋力排行</b><small>看看你在棋岛的位置</small></button><button type="button" data-nav-action="records-expedition"><span>☼</span><b>远征进度</b><small>${expeditionLevelTotal()} 座棋台的点亮记录</small></button></div>
        <div class="sky-nav-footnote"><span class="sky-nav-dot sky-nav-dot-sun"></span>本地最多保存 30 局；正式账号登录后会同步到云端。</div>
      </div>`;
  }

  function lobbyMarkup() {
    return `
      <header class="sky-lobby-top">
        <div class="sky-brand">
          <span class="sky-brand-mark" aria-hidden="true"><i></i></span>
          <span><strong>天空棋岛</strong><small>晴空浮岛 · 草坪棋台</small></span>
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
              <div class="sky-preview-coordinate sky-preview-coordinate-top">15 × 15 · 五子连珠</div>
              <div class="sky-preview-coordinate sky-preview-coordinate-bottom">黑白之间，自有天地</div>
            </div>
            <div class="sky-board-caption"><span>等待第一手</span><small>棋台中央 · 黑方先行</small></div>
          </section>
          <section class="sky-command-deck">
            <div class="sky-command-copy">
              <div class="sky-lobby-kicker">天空棋岛 · 随时来一局</div>
              <h1 id="skyLobbyTitle">落一子，<br><em>赴一场云上对弈。</em></h1>
              <p>与 AI 切磋，和好友对弈，<br class="sky-copy-break">或独自解开一座座残局。</p>
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
            <span class="sky-broadcast-preview">聊聊棋局，也聊聊今天。</span><strong>打开 →</strong>
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
      const recordIndex = event.target.closest('[data-record-index]')?.dataset.recordIndex;
      if (recordIndex !== undefined) {
        runRecordsReplay(recordIndex);
        return;
      }
      const action = event.target.closest('[data-sky-action]')?.dataset.skyAction;
      if (action) runAction(action);
      const nav = event.target.closest('[data-sky-nav]')?.dataset.skyNav;
      if (nav) runNav(nav);
    });
    // The lobby markup already ships with the game tab selected. Avoid a
    // second full navigation pass during cold start; later tab switches still
    // use setActiveNav so their state remains fully deterministic.
    activeNav = 'game';
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
    if (nav === 'records') return renderRecordsWorkspace();
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
    if (gameHome) {
      const showGameHome = next === 'game';
      // The MuMu WebView can keep a stale composited layer when a large
      // workspace is switched only through the hidden attribute. Set an
      // explicit display value as well so the old board is really removed.
      gameHome.hidden = !showGameHome;
      gameHome.style.display = showGameHome ? '' : 'none';
    }
    if (navWorkspace) {
      const showWorkspace = next !== 'game';
      navWorkspace.hidden = !showWorkspace;
      navWorkspace.style.display = showWorkspace ? '' : 'none';
      navWorkspace.dataset.screen = next;
      try {
        navWorkspace.innerHTML = showWorkspace ? navWorkspaceMarkup(next) : '';
      } catch (error) {
        // Keep navigation usable even if an optional data source is not ready
        // on a cold WebView startup; the page can be refreshed in place later.
        console.warn('[sky ui] workspace render', error?.message || error);
        navWorkspace.innerHTML = showWorkspace
          ? '<div class="sky-nav-page sky-space-page"><div class="sky-space-heading"><div><span class="sky-nav-eyebrow">SKY ISLAND / 棋岛</span><h1>棋岛正在整理航线</h1><p>页面资源正在准备中，请稍后再点一次这个导航。</p></div></div></div>'
          : '';
      }
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

  function refreshRecordsWorkspace() {
    if (activeNav !== 'records' || !navWorkspace || navWorkspace.hidden) return;
    const scrollTop = navWorkspace.scrollTop;
    navWorkspace.innerHTML = renderRecordsWorkspace();
    navWorkspace.scrollTop = scrollTop;
  }

  function runRecordsReplay(index) {
    const numericIndex = Number(index);
    if (!Number.isInteger(numericIndex) || numericIndex < 0) return;
    closeSheet();
    showGame();
    window.setTimeout(() => safeCall('openReplayModalByIndex', numericIndex), 90);
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
    openSheet('今天，和谁下一局？', '选一种喜欢的方式，黑白之间见分晓。', [
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
      { action: 'expedition', icon: '☀', title: '残局航线开放', detail: `${expeditionLevelTotal()} 座棋台已就绪，进度只保存在本机` },
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
    // Warm the board immediately after the lobby has been mounted. The game
    // path still calls ensureBoardSurface synchronously as a safety net, but
    // this keeps the first real tap from paying the full canvas setup cost.
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
    window.addEventListener('gomoku:history-updated', refreshRecordsWorkspace);

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
