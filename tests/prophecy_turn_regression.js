const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const appSource = fs.readFileSync(path.join(root, 'js/app.js'), 'utf8');
const onlineSource = fs.readFileSync(path.join(root, 'js/online.js'), 'utf8');
const replaySource = fs.readFileSync(path.join(root, 'js/replay.js'), 'utf8');

function between(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `missing source section: ${start}`);
  return source.slice(from, to).trim();
}

const actualGameCode = [
  between(appSource, '    function cloneSkillCardState(', '    // 旧版存档可能仍带有已退役卡牌。'),
  between(appSource, '    function normalizeSkillCardState(', '    function saveUndoSnapshot('),
  between(appSource, '    function saveUndoSnapshot(', '    const cvs = document.getElementById('),
  between(appSource, '    function getAiColor() {', '    function getLocalPlayerColor() {'),
  between(appSource, '    function isProphecied(', '    function drawRandomThreeCards('),
  between(appSource, '    function makeMove(r, c, p, fromRemote = false) {', '    function getBoardPointFromPointer('),
  between(appSource, '    function restoreSnapshot(snap) {', '    function doUndo() {'),
  between(appSource, '    function doUndo() {', '    const undoModal = document.getElementById(')
].join('\n');

const actualOnlineConstantsCode = [
  between(onlineSource, '    const RELIABLE_ONLINE_MESSAGE_TYPES = new Set([', '    const MIRRORED_ONLINE_MESSAGE_TYPES = new Set(['),
  between(onlineSource, '    const ONLINE_MESSAGE_TYPES = new Set([', '    const P2P_SIGNAL_TYPES = new Set(')
].join('\n');
const actualOnlineSendMethod = between(onlineSource, '      send(data, preferredTransport = \'\') {', '      on(event, fn) {');
const actualSnapshotValidatorCode = between(onlineSource, '    function validateIncomingSnapshot(data) {', '    function validateIncomingUndoState(data) {');
const actualFullSnapshotCode = between(onlineSource, '    function sendFullStateSnapshot() {', '    function sendPendingOnlineRestartTransaction(');
const actualOnlineMoveBranch = between(onlineSource, "        if (data.type === 'move') {", "        } else if (data.type === 'chat') {");
const actualStateSnapshotBranch = between(onlineSource, "        if (data.type === 'state_snapshot') {", "        if (data.type === 'move') {");

const actualOnlineDigestCode = between(
  appSource,
  '    function getOnlineStateDigest(state = {}) {',
  '    function settleRemoteSkillResult('
);
const actualReplayCode = between(
  replaySource,
  '    function applyMainReplayStep(step) {',
  '    function onMainReplaySlider(val) {'
);

let generatedId = 0;
function makeGameContext(overrides = {}) {
  const elements = new Map();
  const resyncReasons = [];
  const document = {
    hidden: false,
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, { textContent: '', value: '', style: {}, classList: { add() {}, remove() {} } });
      return elements.get(id);
    },
    querySelectorAll() { return []; }
  };
  const context = vm.createContext({
    console,
    Date,
    Math,
    JSON,
    Buffer,
    TextEncoder,
    setTimeout() { return ++generatedId; },
    clearTimeout() {},
    clearInterval() {},
    window: {},
    document,
    elements,
    EMPTY: 0,
    BLACK: 1,
    WHITE: 2,
    board: Array.from({ length: 15 }, () => Array(15).fill(0)),
    history: [],
    turn: 1,
    gameMode: 'pvp',
    myOnlineColor: 1,
    aiPlayerColor: 1,
    isOver: false,
    isReplayMode: false,
    gameWinnerColor: 0,
    gameResultIsDraw: false,
    winningLine: null,
    prophecyPoint: null,
    hasExtraMove: false,
    consecutiveMovesLeft: 0,
    opponentFreeMove: false,
    opponentSkillsUsedCount: 0,
    opponentReforgeUsed: false,
    currentDrawnCards: [],
    cardUsedStatus: [false, false, false],
    undoStack: [],
    activeVFX: [],
    vfxRAF: null,
    vfxLastRenderAt: 0,
    aiTurnSeq: 0,
    pendingRecordCommitted: false,
    activeSkill: null,
    currentRoomCode: '123456',
    onlineSessionId: 'prophecy-test-session',
    onlineRoundId: 'prophecy-test-round',
    p1Name: 'Black',
    p2Name: 'White',
    p1Avatar: 'anime_boy',
    p2Avatar: 'anime_girl',
    SKILL_CARD_POOL: [],
    MAX_OPPONENT_SKILLS_PER_HAND: 3,
    MAX_ONLINE_PAYLOAD_BYTES: 60 * 1024,
    onlineReliableOutbox: new Map(),
    getNetworkAvatarValue: value => value,
    normalizeNetworkName: value => typeof value === 'string' ? value : 'Opponent',
    getOnlinePayloadByteLength: value => Buffer.byteLength(String(value), 'utf8'),
    generateSecureId(length, prefix = '') { return `${prefix}${'a'.repeat(length * 2)}`; },
    isSafeNetworkAvatar: () => true,
    MAX_NETWORK_PROFILE_NAME_CHARS: 64,
    MAX_ONLINE_MESSAGES_PER_SECOND: 80,
    requestOnlineResync(reason) { resyncReasons.push(reason); },
    resyncReasons,
    draw() {},
    updateUI() {},
    updatePlayerHeaderUI() {},
    persistGameState() {},
    saveUndoSnapshot: undefined,
    playMoveSound() {},
    triggerStoneDropVFX() {},
    triggerSkillVFX() {},
    playSkillSound() {},
    triggerBoardShake() {},
    showSkillBanner() {},
    showGameNotice() {},
    checkWin() { return false; },
    isBoardFull() { return false; },
    scheduleAiMoveAfterPaint() { this.scheduledAiMoves = (this.scheduledAiMoves || 0) + 1; },
    invalidatePendingAiTurn() {},
    cancelPendingGameResultModal() {},
    closeGameResultModal() {},
    cancelCanvasFrame() {},
    triggerUndoVFX() {},
    cancelActiveSkill() {},
    renderCardSlots() {},
    onReconnectSuccess() {},
    scheduledAiMoves: 0,
    ...overrides
  });

  vm.runInContext(actualGameCode, context);
  vm.runInContext(actualOnlineDigestCode, context);
  return context;
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function installOnlineHarness(context, role, packets) {
  if (!context.__onlineHarnessInstalled) {
    vm.runInContext(actualOnlineConstantsCode + actualSnapshotValidatorCode + actualFullSnapshotCode, context);
    // The send method is a class method in production. Keep its real envelope,
    // stateVersion, reliability, and allowlist logic while replacing only I/O.
    vm.runInContext(`globalThis.ProphecyOnlineHarness = class ProphecyOnlineHarness { ${actualOnlineSendMethod} };`, context);
    context.__onlineHarnessInstalled = true;
  }

  const connection = new context.ProphecyOnlineHarness();
  connection.open = true;
  connection.closed = false;
  connection.sessionId = 'prophecy-test-session';
  connection.role = role;
  connection.roomCode = '123456';
  connection._transmitMessage = message => {
    packets.push(plain(message));
    return true;
  };
  connection._scheduleReliableRetry = () => {};
  context.conn = connection;
}

function primeProphecyPair(casterColor) {
  const victimColor = casterColor === 1 ? 2 : 1;
  const hostColor = 1;
  const caster = makeGameContext({ gameMode: 'online', myOnlineColor: casterColor, turn: casterColor });
  const victim = makeGameContext({ gameMode: 'online', myOnlineColor: victimColor, turn: casterColor });
  const casterPackets = [];
  const victimPackets = [];
  installOnlineHarness(caster, casterColor === hostColor ? 'host' : 'client', casterPackets);
  installOnlineHarness(victim, victimColor === hostColor ? 'host' : 'client', victimPackets);

  for (const side of [caster, victim]) {
    side.saveUndoSnapshot('skill', { skillId: 'prophecy_block', player: casterColor });
    side.prophecyPoint = { r: 7, c: 8, by: casterColor };
    side.cardUsedStatus = [true, false, false];
  }
  return { caster, victim, casterPackets, victimPackets, casterColor, victimColor };
}

function attachIncomingMove(context) {
  vm.runInContext(
    `globalThis.receiveProphecyMove = function(data) {\n${actualOnlineMoveBranch}\n        }\n        };`,
    context
  );
  vm.runInContext(
    `globalThis.receiveProphecySnapshot = function(data) {\n      const adoptingHostRound = false;\n${actualStateSnapshotBranch}\n    };`,
    context
  );
}

function assertSameGameState(left, right, label) {
  assert.equal(JSON.stringify(plain({ board: left.board, history: left.history, turn: left.turn, prophecyPoint: left.prophecyPoint })),
    JSON.stringify(plain({ board: right.board, history: right.history, turn: right.turn, prophecyPoint: right.prophecyPoint })),
    label);
}

// A non-hit by the caster leaves the marker in place; an opponent miss consumes
// it and places a normal stone.
{
  const casterMove = makeGameContext({ turn: 1, prophecyPoint: { r: 7, c: 8, by: 1 } });
  casterMove.makeMove(7, 7, 1);
  assert.deepEqual(plain(casterMove.prophecyPoint), { r: 7, c: 8, by: 1 }, 'caster placement must preserve its own marker');
  assert.equal(casterMove.board[7][7], 1);

  const opponentMiss = makeGameContext({ turn: 2, prophecyPoint: { r: 7, c: 8, by: 1 } });
  opponentMiss.makeMove(6, 8, 2);
  assert.equal(opponentMiss.prophecyPoint, null, 'an opponent miss consumes the prediction');
  assert.equal(opponentMiss.board[6][8], 2);
}

// An ordinary hit appends one no-stone action and consumes the victim's turn.
{
  const hit = makeGameContext({ turn: 2, prophecyPoint: { r: 7, c: 8, by: 1 } });
  hit.makeMove(7, 8, 2);
  assert.equal(hit.board[7][8], 0, 'the blocked target stays empty');
  assert.equal(hit.turn, 1, 'the blocked opportunity ends the victim turn');
  assert.equal(hit.prophecyPoint, null, 'the prediction is consumed');
  assert.equal(hit.history.length, 1);
  assert.deepEqual(plain(hit.history[0]), {
    action: 'prophecy_blocked', r: -1, c: -1, p: 2, targetR: 7, targetC: 8
  });
  assert.equal(hit.undoStack.at(-1).prophecyPoint.r, 7, 'the undo snapshot keeps the marker before consumption');
  assert.equal(hit.undoStack.at(-1).turn, 2, 'the undo snapshot keeps the victim turn');
}

// Both local AI colors must yield back to the human after the AI is blocked.
for (const aiPlayerColor of [1, 2]) {
  const aiColor = aiPlayerColor === 1 ? 2 : 1;
  const humanColor = aiPlayerColor;
  const aiHit = makeGameContext({
    gameMode: 'ai', aiPlayerColor, turn: aiColor,
    prophecyPoint: { r: 7, c: 8, by: humanColor }
  });
  aiHit.makeMove(7, 8, aiColor);
  assert.equal(aiHit.turn, humanColor, `AI ${aiPlayerColor === 1 ? 'black' : 'white'} must yield after a hit`);
  assert.equal(aiHit.board[7][8], 0);
  assert.equal(aiHit.scheduledAiMoves, 0, 'the blocked AI must not search for another point');
}

// A real online move send and receive pass both a normal move and a prophecy
// hit through the production protocol checks. The hit consumes one history step
// on each peer without placing a stone.
for (const casterColor of [1, 2]) {
  const pair = primeProphecyPair(casterColor);
  const { caster, victim, casterPackets, victimPackets, victimColor } = pair;
  attachIncomingMove(caster);
  attachIncomingMove(victim);

  caster.makeMove(7, 7, casterColor);
  assert.equal(casterPackets.length, 1);
  assert.equal(casterPackets[0].type, 'move');
  assert.equal(casterPackets[0].step, 1);
  assert.equal(casterPackets[0].stateVersion, 1);
  victim.receiveProphecyMove(casterPackets.shift());
  assertSameGameState(caster, victim, 'normal move must leave both prophecy states aligned');
  assert.deepEqual(plain(victim.prophecyPoint), { r: 7, c: 8, by: casterColor });

  victim.makeMove(7, 8, victimColor);
  assert.equal(victimPackets.length, 1);
  const blockedPacket = victimPackets.shift();
  assert.equal(blockedPacket.type, 'move');
  assert.equal(blockedPacket.step, 2, 'blocked opportunities occupy a protocol step');
  assert.equal(blockedPacket.stateVersion, 2, 'stateVersion counts the blocked history action');
  caster.receiveProphecyMove(blockedPacket);
  assertSameGameState(caster, victim, 'both peers must apply the same blocked action');
  assert.equal(caster.turn, casterColor);
  assert.equal(caster.board[7][8], 0);
  assert.equal(caster.history.length, 2);
  assert.equal(caster.history[1].action, 'prophecy_blocked');

  // The action remains legal in the normal reconnect snapshot contract and the
  // digest detects any mismatch between the two replayable histories.
  const host = casterColor === 1 ? caster : victim;
  const client = host === caster ? victim : caster;
  const hostPackets = host === caster ? casterPackets : victimPackets;
  host.sendFullStateSnapshot();
  assert.equal(hostPackets.length, 1);
  const snapshotPacket = hostPackets.shift();
  assert.equal(snapshotPacket.type, 'state_snapshot');
  assert.equal(snapshotPacket.stateVersion, 2);
  assert.equal(snapshotPacket.history[1].action, 'prophecy_blocked');
  assert.equal(client.validateIncomingSnapshot(snapshotPacket), true, 'snapshot validator must accept the action');
  assert.equal(client.isIncomingStateDigestValid(snapshotPacket), true, 'snapshot digest must cover the blocked action');

  // Reconnect recovery applies the real authoritative snapshot branch after a
  // client loses its local board/history, including the no-stone event.
  client.board = Array.from({ length: 15 }, () => Array(15).fill(0));
  client.history = [];
  client.turn = 1;
  client.receiveProphecySnapshot(snapshotPacket);
  assertSameGameState(host, client, 'authoritative snapshot must restore the blocked action and turn');

  // A duplicate/out-of-order move is rejected without changing either side.
  const before = JSON.stringify(plain({ board: client.board, history: client.history, turn: client.turn }));
  client.receiveProphecyMove({ ...blockedPacket, step: 2, stateVersion: 2 });
  assert.equal(JSON.stringify(plain({ board: client.board, history: client.history, turn: client.turn })), before);
  assert.ok(client.resyncReasons.length > 0, 'an already-applied step requests normal online reconciliation');

  // The production undo stack restores the still-unconsumed pre-hit marker and
  // turn on both endpoints; the blocked event itself is removed from history.
  assert.equal(caster.doUndo(), true);
  assert.equal(victim.doUndo(), true);
  assertSameGameState(caster, victim, 'undo must restore the same pre-hit state on both peers');
  assert.equal(caster.turn, victimColor);
  assert.deepEqual(plain(caster.prophecyPoint), { r: 7, c: 8, by: casterColor });
  assert.equal(caster.history.length, 1);
  assert.equal(caster.board[7][8], 0);
}

// Both blocked and ordinary actions consume exactly one available bonus move
// through the existing tail logic; they do not skip or duplicate the bonus.
for (const bonus of ['hasExtraMove', 'opponentFreeMove', 'consecutiveMovesLeft']) {
  const blockedBonus = makeGameContext({
    turn: 2,
    prophecyPoint: { r: 7, c: 8, by: 1 },
    hasExtraMove: bonus === 'hasExtraMove',
    opponentFreeMove: bonus === 'opponentFreeMove',
    consecutiveMovesLeft: bonus === 'consecutiveMovesLeft' ? 2 : 0
  });
  blockedBonus.makeMove(7, 8, 2);
  assert.equal(blockedBonus.turn, 2, `${bonus} keeps the current turn while one opportunity is consumed`);
  if (bonus === 'consecutiveMovesLeft') assert.equal(blockedBonus.consecutiveMovesLeft, 1);
  else assert.equal(blockedBonus[bonus], false);

  const ordinaryBonus = makeGameContext({
    turn: 1,
    hasExtraMove: bonus === 'hasExtraMove',
    opponentFreeMove: bonus === 'opponentFreeMove',
    consecutiveMovesLeft: bonus === 'consecutiveMovesLeft' ? 2 : 0
  });
  ordinaryBonus.makeMove(7, 7, 1);
  assert.equal(ordinaryBonus.turn, 1, `${bonus} retains the existing ordinary-move behavior`);
  if (bonus === 'consecutiveMovesLeft') assert.equal(ordinaryBonus.consecutiveMovesLeft, 1);
  else assert.equal(ordinaryBonus[bonus], false);
}

// Replay extraction keeps a blocked action as a no-op history event and shows
// its target in the step label, then continues with the following real stone.
{
  const elements = new Map();
  const replay = vm.createContext({
    BLACK: 1, WHITE: 2, EMPTY: 0,
    board: Array.from({ length: 15 }, () => Array(15).fill(0)),
    history: [], replayAllMoves: [
      { action: 'prophecy_blocked', r: -1, c: -1, p: 2, targetR: 7, targetC: 8 },
      { r: 6, c: 8, p: 1 }
    ],
    replayStepIndex: 0,
    document: { getElementById(id) { if (!elements.has(id)) elements.set(id, { textContent: '', value: '', style: {} }); return elements.get(id); } },
    draw() {}
  });
  vm.runInContext(actualReplayCode, replay);
  replay.applyMainReplayStep(1);
  assert.equal(replay.board[7][8], 0);
  assert.equal(replay.history.length, 1);
  assert.equal(replay.history[0].action, 'prophecy_blocked');
  assert.match(elements.get('replayTurnLabel').textContent, /预言封锁/);
  assert.match(elements.get('replayTurnLabel').textContent, /8, 9/);
  replay.applyMainReplayStep(2);
  assert.equal(replay.board[6][8], 1, 'later real moves remain replayable after a blocked action');
  assert.equal(replay.history.length, 2);
  replay.applyMainReplayStep(0);
  assert.equal(replay.history.length, 0, 'jumping to the beginning clears replay actions');
}

console.log('PASS: prophecy hit consumes one turn step, syncs both online peers, remains undoable/replayable, and preserves AI/bonus-turn behavior');
