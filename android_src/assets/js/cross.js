(() => {
  'use strict';

  const SIZE = 19;
  const CENTER = Math.floor(SIZE / 2);
  const EMPTY = 0;
  const BLACK = 1;
  const WHITE = 2;
  const CELL = 34;
  const BOARD_PX = SIZE * CELL;
  const MIN_ZOOM = 0.72;
  const MAX_ZOOM = 2.6;
  const ZOOM_STEP = 0.14;
  const DIRECTIONS = [[0, 1], [1, 0]];
  const CARD_POOL = [
    { id: 'cross_hint', icon: '🧭', name: '队友提示', desc: '标出当前回合值得考虑的落点' },
    { id: 'cross_block', icon: '🧱', name: '十字封锁', desc: '封住一个空位，本回合计作一次行动' },
    { id: 'cross_extra', icon: '⚡', name: '加走一手', desc: '本回合额外获得一次落子机会' },
    { id: 'cross_swap', icon: '🔄', name: '轴心换色', desc: '交换场上双方棋子颜色' },
    { id: 'cross_blast', icon: '💥', name: '小型干扰', desc: '清除目标周围最多三颗棋子' }
  ];

  const state = {
    open: false,
    board: [],
    blocked: new Set(),
    history: [],
    turn: BLACK,
    actionsLeft: 2,
    over: false,
    winner: EMPTY,
    winningLine: [],
    zoom: 1,
    panX: 0,
    panY: 0,
    baseScale: 1,
    viewportW: 0,
    viewportH: 0,
    cards: { [BLACK]: [], [WHITE]: [] },
    usedCards: { [BLACK]: new Set(), [WHITE]: new Set() },
    pendingCard: null,
    hint: null,
    hintTimer: null,
    pulseTimer: null,
    pointer: null,
    lastMove: null,
    reducedMotion: false
  };

  let root = null;
  let canvas = null;
  let ctx = null;
  let resizeObserver = null;

  function freshBoard() {
    return Array.from({ length: SIZE }, () => Array(SIZE).fill(EMPTY));
  }

  function isPlayable(row, col) {
    return row >= 0 && row < SIZE && col >= 0 && col < SIZE &&
      (Math.abs(row - CENTER) <= 1 || Math.abs(col - CENTER) <= 1);
  }

  function key(row, col) {
    return `${row},${col}`;
  }

  function colorName(player) {
    return player === BLACK ? '黑方' : '白方';
  }

  function announce(message, warning = false) {
    try {
      if (typeof window.showGameNotice === 'function') window.showGameNotice(message, warning);
    } catch (_) {}
  }

  function ensureUi() {
    if (root) return;
    const style = document.createElement('style');
    style.id = 'gomokuCrossStyles';
    style.textContent = `
      #crossChessModal { position:fixed; inset:0; z-index:100020; display:none; align-items:center; justify-content:center; padding:12px; background:rgba(8,15,32,.72); backdrop-filter:blur(8px); }
      #crossChessModal.show { display:flex; }
      .cross-shell { width:min(980px,100%); max-height:96vh; overflow:auto; border:1.5px solid #0f766e; border-radius:24px; background:linear-gradient(145deg,#f7fffb,#ecfeff 55%,#fff7ed); box-shadow:0 25px 80px rgba(0,0,0,.3); color:#102a2a; padding:16px; }
      .cross-head { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; margin-bottom:10px; }
      .cross-kicker { color:#0f766e; font-size:10px; font-weight:900; letter-spacing:.16em; text-transform:uppercase; }
      .cross-title { margin:2px 0 3px; font-size:22px; line-height:1.1; font-weight:950; }
      .cross-subtitle { margin:0; color:#486363; font-size:11px; line-height:1.5; font-weight:700; }
      .cross-close { border:1px solid #99f6e4; background:#fff; color:#115e59; border-radius:10px; padding:7px 10px; font-size:12px; font-weight:900; cursor:pointer; }
      .cross-layout { display:grid; grid-template-columns:minmax(0,1fr) 235px; gap:12px; align-items:start; }
      .cross-board-frame { position:relative; min-height:300px; aspect-ratio:1; overflow:hidden; border-radius:18px; border:2px solid #0f766e; background:#0f3c43; box-shadow:inset 0 0 0 6px rgba(255,255,255,.16),0 8px 20px rgba(15,118,110,.18); touch-action:none; }
      .cross-board-frame canvas { display:block; width:100%; height:100%; touch-action:none; cursor:grab; }
      .cross-board-frame canvas:active { cursor:grabbing; }
      .cross-side { display:flex; flex-direction:column; gap:8px; }
      .cross-status { border-radius:13px; padding:10px; background:#ffffffc9; border:1px solid #a7f3d0; font-size:12px; font-weight:900; line-height:1.45; }
      .cross-status small { display:block; margin-top:4px; color:#64748b; font-size:10px; line-height:1.45; }
      .cross-tools { display:grid; grid-template-columns:repeat(3,1fr); gap:6px; }
      .cross-tool, .cross-card { border:1px solid #99f6e4; background:#fff; color:#115e59; border-radius:10px; min-height:34px; padding:5px 4px; font-size:11px; font-weight:900; cursor:pointer; }
      .cross-tool:active, .cross-card:active { transform:translateY(1px); }
      .cross-tool[disabled], .cross-card[disabled] { opacity:.42; cursor:not-allowed; }
      .cross-cards { display:grid; gap:6px; }
      .cross-card { text-align:left; display:flex; gap:6px; align-items:center; min-height:45px; }
      .cross-card strong { display:block; font-size:11px; }
      .cross-card span { display:block; color:#64748b; font-size:9px; line-height:1.25; font-weight:700; margin-top:2px; }
      .cross-card.active { border-color:#f59e0b; background:#fffbeb; box-shadow:0 0 0 2px #fde68a; }
      .cross-legend { padding:8px 9px; border-radius:11px; background:#ecfeff; color:#155e75; font-size:10px; line-height:1.45; font-weight:800; }
      .cross-experimental { display:inline-flex; align-items:center; gap:4px; padding:3px 7px; border-radius:99px; background:#fef3c7; color:#92400e; font-size:10px; font-weight:900; }
      @media (max-width:760px) { .cross-shell { padding:11px; border-radius:18px; } .cross-layout { grid-template-columns:1fr; } .cross-side { display:grid; grid-template-columns:1fr 1fr; } .cross-status, .cross-legend { grid-column:1/-1; } .cross-cards { grid-column:1/-1; grid-template-columns:repeat(2,1fr); } .cross-title { font-size:18px; } }
      @media (prefers-reduced-motion:reduce) { .cross-board-frame, .cross-tool, .cross-card { transition:none!important; } }
    `;
    document.head.appendChild(style);
    root = document.createElement('div');
    root.id = 'crossChessModal';
    root.innerHTML = `
      <div class="cross-shell" role="dialog" aria-modal="true" aria-labelledby="crossChessTitle">
        <div class="cross-head">
          <div>
            <div class="cross-kicker">experimental board / 十字轴变体</div>
            <h2 class="cross-title" id="crossChessTitle">十字棋 <span class="cross-experimental">实验功能</span></h2>
            <p class="cross-subtitle">十字轴横/竖连成 10 子获胜 · 每方每回合连续下 2 次 · 双人同屏</p>
          </div>
          <button class="cross-close" type="button" data-cross-action="close">关闭</button>
        </div>
        <div class="cross-layout">
          <div class="cross-board-frame" id="crossChessFrame"><canvas id="crossChessCanvas" aria-label="十字棋棋盘"></canvas></div>
          <aside class="cross-side">
            <div class="cross-status" id="crossChessStatus">黑方行动 · 还可落 2 子<small>拖动棋盘移动视角；滚轮或缩放按钮调整棋盘大小。</small></div>
            <div class="cross-tools">
              <button class="cross-tool" type="button" data-cross-action="zoom-out">－ 缩小</button>
              <button class="cross-tool" type="button" data-cross-action="zoom-reset">适配</button>
              <button class="cross-tool" type="button" data-cross-action="zoom-in">＋ 放大</button>
              <button class="cross-tool" type="button" data-cross-action="hint">🧭 提示下哪</button>
              <button class="cross-tool" type="button" data-cross-action="reset">🔄 重开</button>
              <button class="cross-tool" type="button" data-cross-action="mode">双人同屏</button>
            </div>
            <div class="cross-cards" id="crossChessCards"></div>
            <div class="cross-legend">🧭 提示只做落点建议，不替队友下棋。对手落子后镜头会自动转到最新落点；干扰牌仅在本实验棋局内生效。</div>
          </aside>
        </div>
      </div>`;
    document.body.appendChild(root);
    canvas = root.querySelector('#crossChessCanvas');
    ctx = canvas.getContext('2d');
    root.addEventListener('click', handleAction);
    canvas.addEventListener('pointerdown', onPointerDown, { passive: false });
    canvas.addEventListener('pointermove', onPointerMove, { passive: false });
    canvas.addEventListener('pointerup', onPointerUp, { passive: false });
    canvas.addEventListener('pointercancel', onPointerUp, { passive: false });
    canvas.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('resize', resizeCanvas, { passive: true });
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(resizeCanvas);
      resizeObserver.observe(root.querySelector('#crossChessFrame'));
    }
    state.reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
  }

  function resetState() {
    state.board = freshBoard();
    state.blocked = new Set();
    state.history = [];
    state.turn = BLACK;
    state.actionsLeft = 2;
    state.over = false;
    state.winner = EMPTY;
    state.winningLine = [];
    state.zoom = 1;
    state.panX = 0;
    state.panY = 0;
    state.cards = {
      [BLACK]: drawCards(),
      [WHITE]: drawCards()
    };
    state.usedCards = { [BLACK]: new Set(), [WHITE]: new Set() };
    state.pendingCard = null;
    state.hint = null;
    state.lastMove = null;
    if (state.hintTimer) clearTimeout(state.hintTimer);
    state.hintTimer = null;
    renderCards();
    resizeCanvas();
    updateStatus();
    draw();
  }

  function drawCards() {
    const shuffled = CARD_POOL.slice().sort(() => Math.random() - 0.5);
    return shuffled.slice(0, 3).map(card => ({ ...card }));
  }

  function currentCard(cardId) {
    return state.cards[state.turn].find(card => card.id === cardId) || null;
  }

  function updateStatus() {
    const status = root?.querySelector('#crossChessStatus');
    if (!status) return;
    if (state.over) {
      status.firstChild.textContent = `${colorName(state.winner)}完成十字十连，获胜！`;
      status.querySelector('small').textContent = '点击“重开”体验下一局实验规则。';
      return;
    }
    const pending = state.pendingCard ? ` · ${state.pendingCard.name}待选点` : '';
    status.firstChild.textContent = `${colorName(state.turn)}行动 · 还可落 ${state.actionsLeft} 子${pending}`;
    status.querySelector('small').textContent = '两次落子后换边；拖动棋盘移动视角，滚轮或按钮调整缩放。';
  }

  function renderCards() {
    const wrap = root?.querySelector('#crossChessCards');
    if (!wrap) return;
    const used = state.usedCards[state.turn];
    wrap.innerHTML = state.cards[state.turn].map(card => {
      const disabled = used.has(card.id) || (state.over ? true : false);
      return `<button class="cross-card${state.pendingCard?.id === card.id ? ' active' : ''}" type="button" data-cross-card="${card.id}" ${disabled ? 'disabled' : ''}>
        <b>${card.icon}</b><span><strong>${card.name}${used.has(card.id) ? ' · 已用' : ''}</strong>${card.desc}</span>
      </button>`;
    }).join('');
  }

  function handleAction(event) {
    const actionEl = event.target.closest('[data-cross-action]');
    if (actionEl) {
      const action = actionEl.dataset.crossAction;
      if (action === 'close') close();
      else if (action === 'zoom-out') setZoom(state.zoom - ZOOM_STEP);
      else if (action === 'zoom-in') setZoom(state.zoom + ZOOM_STEP);
      else if (action === 'zoom-reset') resetView();
      else if (action === 'hint') suggestHint();
      else if (action === 'reset') resetState();
      else if (action === 'mode') announce('👥 当前实验模式为双人同屏，黑白双方轮流各下两次。', false);
      return;
    }
    const cardEl = event.target.closest('[data-cross-card]');
    if (cardEl) activateCard(cardEl.dataset.crossCard);
  }

  function resizeCanvas() {
    if (!canvas || !root?.classList.contains('show')) return;
    const frame = root.querySelector('#crossChessFrame');
    if (!frame) return;
    const rect = frame.getBoundingClientRect();
    state.viewportW = Math.max(1, rect.width);
    state.viewportH = Math.max(1, rect.height);
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    canvas.width = Math.round(state.viewportW * dpr);
    canvas.height = Math.round(state.viewportH * dpr);
    canvas.style.width = `${state.viewportW}px`;
    canvas.style.height = `${state.viewportH}px`;
    state.baseScale = Math.min(state.viewportW / BOARD_PX, state.viewportH / BOARD_PX) * 0.92;
    draw();
  }

  function transform() {
    const scaled = state.baseScale * state.zoom;
    const originX = state.viewportW / 2 - (BOARD_PX * scaled) / 2 + state.panX;
    const originY = state.viewportH / 2 - (BOARD_PX * scaled) / 2 + state.panY;
    return { scaled, originX, originY };
  }

  function clampPan() {
    const { scaled } = transform();
    const slackX = Math.max(40, state.viewportW * 0.44);
    const slackY = Math.max(40, state.viewportH * 0.44);
    const maxPanX = Math.max(slackX, (BOARD_PX * scaled - state.viewportW) / 2 + slackX);
    const maxPanY = Math.max(slackY, (BOARD_PX * scaled - state.viewportH) / 2 + slackY);
    state.panX = Math.max(-maxPanX, Math.min(maxPanX, state.panX));
    state.panY = Math.max(-maxPanY, Math.min(maxPanY, state.panY));
  }

  function setZoom(value, focus = null) {
    const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Number(value) || 1));
    state.zoom = Math.round(next * 100) / 100;
    if (!focus) clampPan();
    else focusCell(focus.row, focus.col, false);
    draw();
  }

  function resetView() {
    state.zoom = 1;
    state.panX = 0;
    state.panY = 0;
    draw();
  }

  function focusCell(row, col, announceMove = true) {
    if (!Number.isInteger(row) || !Number.isInteger(col)) return;
    const scaled = state.baseScale * state.zoom;
    state.panX = ((col + 0.5) * CELL - BOARD_PX / 2) * -scaled;
    state.panY = ((row + 0.5) * CELL - BOARD_PX / 2) * -scaled;
    clampPan();
    if (announceMove) announce(`👀 视角已转到${colorName(state.board[row]?.[col])}的最新落点`, false);
    draw();
  }

  function onPointerDown(event) {
    if (!state.open) return;
    event.preventDefault();
    canvas.setPointerCapture?.(event.pointerId);
    state.pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false, panX: state.panX, panY: state.panY };
  }

  function onPointerMove(event) {
    if (!state.pointer || state.pointer.id !== event.pointerId) return;
    event.preventDefault();
    const dx = event.clientX - state.pointer.x;
    const dy = event.clientY - state.pointer.y;
    if (Math.abs(dx) + Math.abs(dy) > 6) state.pointer.moved = true;
    if (state.pointer.moved) {
      state.panX = state.pointer.panX + dx;
      state.panY = state.pointer.panY + dy;
      clampPan();
      draw();
    }
  }

  function onPointerUp(event) {
    if (!state.pointer || state.pointer.id !== event.pointerId) return;
    event.preventDefault();
    const pointer = state.pointer;
    state.pointer = null;
    if (pointer.moved) return;
    const rect = canvas.getBoundingClientRect();
    const point = screenToCell(event.clientX - rect.left, event.clientY - rect.top);
    if (point) handleCell(point.row, point.col);
  }

  function onWheel(event) {
    event.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const cursorX = event.clientX - rect.left;
    const cursorY = event.clientY - rect.top;
    const before = screenToLogical(cursorX, cursorY);
    const next = state.zoom + (event.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP);
    setZoom(next);
    const after = transform();
    state.panX += cursorX - (after.originX + before.x * after.scaled);
    state.panY += cursorY - (after.originY + before.y * after.scaled);
    clampPan();
    draw();
  }

  function screenToLogical(x, y) {
    const { scaled, originX, originY } = transform();
    return { x: (x - originX) / scaled, y: (y - originY) / scaled };
  }

  function screenToCell(x, y) {
    const point = screenToLogical(x, y);
    const col = Math.floor(point.x / CELL);
    const row = Math.floor(point.y / CELL);
    if (row < 0 || row >= SIZE || col < 0 || col >= SIZE) return null;
    return { row, col };
  }

  function activateCard(cardId) {
    if (state.over || state.usedCards[state.turn].has(cardId)) return;
    const card = currentCard(cardId);
    if (!card) return;
    if (card.id === 'cross_hint') {
      useCard(card);
      suggestHint();
      return;
    }
    if (card.id === 'cross_extra') {
      useCard(card);
      state.actionsLeft += 1;
      updateStatus();
      draw();
      announce('⚡ 加走一手已生效，本回合多一次落子。', false);
      return;
    }
    if (card.id === 'cross_swap') {
      useCard(card);
      for (let row = 0; row < SIZE; row++) for (let col = 0; col < SIZE; col++) {
        if (state.board[row][col] === BLACK) state.board[row][col] = WHITE;
        else if (state.board[row][col] === WHITE) state.board[row][col] = BLACK;
      }
      state.history.push({ type: 'card', id: card.id, player: state.turn });
      updateStatus();
      draw();
      announce('🔄 轴心换色已生效，场上棋子颜色全部交换。', false);
      return;
    }
    state.pendingCard = card;
    renderCards();
    updateStatus();
    draw();
    announce(`${card.icon} ${card.name}已准备，请在十字轴上选择目标。`, false);
  }

  function useCard(card) {
    state.usedCards[state.turn].add(card.id);
    state.pendingCard = null;
    renderCards();
  }

  function handleCell(row, col) {
    if (state.over) return;
    if (!isPlayable(row, col)) {
      announce('💡 十字棋只能落在十字轴区域。', true);
      return;
    }
    if (state.pendingCard) {
      resolveCardAt(row, col, state.pendingCard);
      return;
    }
    if (state.blocked.has(key(row, col))) {
      announce('🧱 这个位置暂时被封锁了。', true);
      return;
    }
    if (state.board[row][col] !== EMPTY) {
      announce('💡 这个位置已经有棋子了。', true);
      return;
    }
    placeStone(row, col, state.turn);
  }

  function resolveCardAt(row, col, card) {
    if (card.id === 'cross_block') {
      if (state.board[row][col] !== EMPTY || state.blocked.has(key(row, col))) {
        announce('🧱 只能封锁空位。', true);
        return;
      }
      useCard(card);
      state.blocked.add(key(row, col));
      state.history.push({ type: 'card', id: card.id, row, col, player: state.turn });
      consumeAction();
      announce(`🧱 已封锁 (${row + 1}, ${col + 1})，计作一次行动。`, false);
      return;
    }
    if (card.id === 'cross_blast') {
      if (state.board[row][col] === EMPTY) {
        announce('💥 小型干扰需要点中已有棋子。', true);
        return;
      }
      useCard(card);
      let cleared = 0;
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        const rr = row + dr, cc = col + dc;
        if (rr >= 0 && rr < SIZE && cc >= 0 && cc < SIZE && state.board[rr][cc] !== EMPTY && cleared < 3) {
          state.board[rr][cc] = EMPTY;
          cleared++;
        }
      }
      state.history.push({ type: 'card', id: card.id, row, col, player: state.turn, cleared });
      state.actionsLeft = Math.max(0, state.actionsLeft - 1);
      if (state.actionsLeft === 0) switchTurn();
      else updateStatus();
      draw();
      announce(`💥 小型干扰清除了 ${cleared} 颗棋子。`, false);
    }
  }

  function placeStone(row, col, player) {
    state.board[row][col] = player;
    state.history.push({ row, col, player });
    state.lastMove = { row, col, player };
    state.hint = null;
    if (hasWon(row, col, player)) {
      state.over = true;
      state.winner = player;
      state.winningLine = winningLine(row, col, player);
      updateStatus();
      draw();
      announce(`🏆 ${colorName(player)}完成十子连线，实验棋局结束！`, false);
      return;
    }
    consumeAction();
    // 双人同屏时镜头始终跟随最新落点；换边后的第一颗子就是对手视角的焦点。
    focusCell(row, col, true);
  }

  function consumeAction() {
    state.actionsLeft -= 1;
    if (state.actionsLeft <= 0) switchTurn();
    else updateStatus();
    renderCards();
    draw();
  }

  function switchTurn() {
    state.turn = state.turn === BLACK ? WHITE : BLACK;
    state.actionsLeft = 2;
    state.pendingCard = null;
    state.hint = null;
    renderCards();
    updateStatus();
  }

  function countDirection(row, col, player, dr, dc) {
    const cells = [];
    for (let sign of [1, -1]) {
      let step = sign === 1 ? 0 : 1;
      while (true) {
        const rr = row + (step + (sign === 1 ? 1 : 0)) * dr * sign;
        const cc = col + (step + (sign === 1 ? 1 : 0)) * dc * sign;
        if (!isPlayable(rr, cc) || state.board[rr][cc] !== player) break;
        cells.push({ row: rr, col: cc });
        step++;
      }
    }
    return cells;
  }

  function winningLine(row, col, player) {
    for (const [dr, dc] of DIRECTIONS) {
      const cells = [{ row, col }, ...countDirection(row, col, player, dr, dc)];
      if (cells.length >= 10) return cells.slice(0, 10);
    }
    return [];
  }

  function hasWon(row, col, player) {
    return winningLine(row, col, player).length >= 10;
  }

  function candidateScore(row, col, player) {
    let score = 0;
    for (const [dr, dc] of DIRECTIONS) {
      let line = 1;
      for (const sign of [1, -1]) {
        for (let step = 1; step < 10; step++) {
          const rr = row + dr * step * sign, cc = col + dc * step * sign;
          if (!isPlayable(rr, cc) || state.board[rr][cc] !== player) break;
          line++;
        }
      }
      score += line * line * 10;
    }
    const distance = Math.abs(row - CENTER) + Math.abs(col - CENTER);
    return score + Math.max(0, 30 - distance);
  }

  function suggestHint() {
    if (state.over) return;
    let best = null;
    let bestScore = -1;
    for (let row = 0; row < SIZE; row++) for (let col = 0; col < SIZE; col++) {
      if (!isPlayable(row, col) || state.board[row][col] !== EMPTY || state.blocked.has(key(row, col))) continue;
      const attack = candidateScore(row, col, state.turn);
      const defense = candidateScore(row, col, state.turn === BLACK ? WHITE : BLACK) * 0.72;
      const score = attack + defense;
      if (score > bestScore) { bestScore = score; best = { row, col }; }
    }
    if (!best) {
      announce('🧭 暂时没有可提示的十字轴空位。', true);
      return;
    }
    state.hint = best;
    if (state.hintTimer) clearTimeout(state.hintTimer);
    state.hintTimer = setTimeout(() => { state.hint = null; draw(); }, state.reducedMotion ? 2500 : 5000);
    focusCell(best.row, best.col, false);
    draw();
    announce(`🧭 建议${colorName(state.turn)}考虑 (${best.row + 1}, ${best.col + 1})，仅供队友参考。`, false);
  }

  function draw() {
    if (!ctx || !canvas || !state.open) return;
    const dpr = canvas.width / Math.max(1, state.viewportW);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, state.viewportW, state.viewportH);
    const { scaled, originX, originY } = transform();
    ctx.save();
    ctx.translate(originX, originY);
    ctx.scale(scaled, scaled);
    ctx.fillStyle = '#d8b276';
    ctx.fillRect(0, 0, BOARD_PX, BOARD_PX);
    // 十字棋盘的非十字区域以深色压暗，视觉上清楚表达可落子区域。
    ctx.fillStyle = 'rgba(15, 118, 110, .24)';
    for (let row = 0; row < SIZE; row++) for (let col = 0; col < SIZE; col++) {
      if (!isPlayable(row, col)) ctx.fillRect(col * CELL, row * CELL, CELL, CELL);
    }
    ctx.strokeStyle = 'rgba(74, 40, 16, .42)';
    ctx.lineWidth = 1.2;
    for (let i = 0; i <= SIZE; i++) {
      ctx.beginPath(); ctx.moveTo(i * CELL, 0); ctx.lineTo(i * CELL, BOARD_PX); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i * CELL); ctx.lineTo(BOARD_PX, i * CELL); ctx.stroke();
    }
    ctx.fillStyle = 'rgba(15,118,110,.2)';
    ctx.fillRect(0, (CENTER - 1) * CELL, BOARD_PX, 3 * CELL);
    ctx.fillRect((CENTER - 1) * CELL, 0, 3 * CELL, BOARD_PX);
    ctx.strokeStyle = 'rgba(15, 118, 110, .7)';
    ctx.lineWidth = 2.5;
    ctx.strokeRect((CENTER - 1) * CELL, 0, 3 * CELL, BOARD_PX);
    ctx.strokeRect(0, (CENTER - 1) * CELL, BOARD_PX, 3 * CELL);
    for (const blockedKey of state.blocked) {
      const [row, col] = blockedKey.split(',').map(Number);
      ctx.save();
      ctx.fillStyle = 'rgba(239,68,68,.25)';
      ctx.fillRect(col * CELL + 3, row * CELL + 3, CELL - 6, CELL - 6);
      ctx.strokeStyle = '#ef4444'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(col * CELL + 8, row * CELL + 8); ctx.lineTo((col + 1) * CELL - 8, (row + 1) * CELL - 8); ctx.stroke();
      ctx.beginPath(); ctx.moveTo((col + 1) * CELL - 8, row * CELL + 8); ctx.lineTo(col * CELL + 8, (row + 1) * CELL - 8); ctx.stroke();
      ctx.restore();
    }
    for (let row = 0; row < SIZE; row++) for (let col = 0; col < SIZE; col++) {
      const player = state.board[row][col];
      if (!player) continue;
      const x = (col + 0.5) * CELL, y = (row + 0.5) * CELL;
      const radius = CELL * 0.39;
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,.28)'; ctx.shadowBlur = 4; ctx.shadowOffsetY = 2;
      ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2);
      const gradient = ctx.createRadialGradient(x - radius * .35, y - radius * .4, radius * .2, x, y, radius);
      if (player === BLACK) { gradient.addColorStop(0, '#475569'); gradient.addColorStop(1, '#020617'); }
      else { gradient.addColorStop(0, '#ffffff'); gradient.addColorStop(1, '#cbd5e1'); }
      ctx.fillStyle = gradient; ctx.fill();
      ctx.strokeStyle = player === BLACK ? '#0f172a' : '#64748b'; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.restore();
    }
    if (state.lastMove) {
      const x = (state.lastMove.col + .5) * CELL, y = (state.lastMove.row + .5) * CELL;
      ctx.save(); ctx.strokeStyle = '#ef4444'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(x, y, CELL * .48, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
    }
    if (state.hint) {
      const x = (state.hint.col + .5) * CELL, y = (state.hint.row + .5) * CELL;
      const pulse = state.reducedMotion ? .5 : (Math.sin(Date.now() / 180) + 1) / 2;
      ctx.save(); ctx.strokeStyle = `rgba(245,158,11,${.55 + pulse * .4})`; ctx.lineWidth = 3; ctx.setLineDash([5, 4]); ctx.beginPath(); ctx.arc(x, y, CELL * (.46 + pulse * .12), 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]); ctx.font = `${CELL * .34}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#92400e'; ctx.fillText('🧭', x, y); ctx.restore();
    }
    if (state.winningLine.length >= 10) {
      ctx.save(); ctx.strokeStyle = '#f59e0b'; ctx.shadowColor = '#fef3c7'; ctx.shadowBlur = 10; ctx.lineWidth = 5; ctx.lineCap = 'round';
      const first = state.winningLine[0], last = state.winningLine[state.winningLine.length - 1];
      ctx.beginPath(); ctx.moveTo((first.col + .5) * CELL, (first.row + .5) * CELL); ctx.lineTo((last.col + .5) * CELL, (last.row + .5) * CELL); ctx.stroke(); ctx.restore();
    }
    ctx.restore();
    if (state.hint && !state.reducedMotion) {
      if (!state.pulseTimer) state.pulseTimer = requestAnimationFrame(() => { state.pulseTimer = null; draw(); });
    }
  }

  function open() {
    ensureUi();
    state.open = true;
    root.classList.add('show');
    if (!state.board.length) resetState();
    resizeCanvas();
    root.querySelector('.cross-close')?.focus();
    return true;
  }

  function close() {
    state.open = false;
    root?.classList.remove('show');
    state.pointer = null;
    if (state.pulseTimer) cancelAnimationFrame(state.pulseTimer);
    state.pulseTimer = null;
  }

  function startNewGame() {
    if (!root) ensureUi();
    resetState();
  }

  window.GomokuCross = Object.freeze({ open, close, reset: startNewGame, suggestHint, setZoom });
  window.openCrossChess = open;
  window.closeCrossChess = close;
  window.__GOMOKU_CROSS_READY__ = true;
})();
