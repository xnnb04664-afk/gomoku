const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'js/app.js'), 'utf8');
function between(text, start, end) {
  const a = text.indexOf(start), b = text.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, `missing source section: ${start}`);
  return text.slice(a, b);
}
const setup = between(source, '    let nativeAiWarmUpRequested = false;', '    function disposeAiWorker(');
const showGame = between(fs.readFileSync(path.join(root, 'js/sky-hub.js'), 'utf8'), '  function showGame() {', '  function showLobby() {');
const setMode = between(fs.readFileSync(path.join(root, 'js/online.js'), 'utf8'), '    function setMode(mode, silent = false) {', 'window.resumePendingQuickMatch =');
const makeMove = between(source, '    function makeMove(r, c, p, fromRemote = false) {', '    function getBoardPointFromPointer(');
function fixture(bridge = { warmUpNativeAi() { return true; } }) {
  let id = 0;
  const timers = new Map(), frames = [], classes = new Set(), events = [];
  const context = vm.createContext({
    window: { AndroidNativeApp: bridge, setTimeout() {}, dispatchEvent() {} },
    document: { hidden: false, body: { classList: { add(v) { classes.add(v); }, remove(v) { classes.delete(v); }, contains(v) { return classes.has(v); } } } },
    setTimeout(fn, ms) { timers.set(++id, { fn, ms }); return id; }, clearTimeout(key) { timers.delete(key); },
    gameMode: 'ai', isReplayMode: false, aiTurnSeq: 0, smartAiMove() { events.push('ai'); },
    closeSheet() {}, lobby: {}, setCardsOpen() {},
    updatePlayerHeaderUI() {}, resetBoardOnly() {}, showGameNotice() {},
    board: Array.from({ length: 15 }, () => Array(15).fill(0)), history: [],
    EMPTY: 0, BLACK: 1, WHITE: 2, turn: 1, isOver: false, getAiColor() { return 2; },
    isProphecied() { return false; }, prophecyPoint: null,
    saveUndoSnapshot() {}, playMoveSound() {}, triggerStoneDropVFX() {}, draw() { events.push('draw'); },
    checkWin() { return false; }, isBoardFull() { return false; },
    opponentFreeMove: false, consecutiveMovesLeft: 0, hasExtraMove: false,
    updateUI() {}, persistGameState() {}, triggerSkillVFX() {}, playSkillSound() {}, triggerBoardShake() {}, showSkillBanner() {},
  });
  context.window.requestAnimationFrame = fn => { frames.push(fn); return frames.length; };
  vm.runInContext(setup + showGame + setMode + makeMove, context);
  return { context, timers, frames, classes, events, run: code => vm.runInContext(code, context) };
}

let warmups = 0;
const f = fixture({ warmUpNativeAi() { warmups++; return true; } });
assert.equal(warmups, 0, 'initial ai mode on the lobby must not warm up');
f.run('gameMode = "pvp"; showGame();');
assert.equal(warmups, 0, 'pvp entry must not warm up');
f.run('setMode("ai"); showGame(); showGame(); setMode("pvp"); setMode("ai");');
assert.equal(warmups, 1, 'visible AI entry and repeated mode switching warm only once');
for (const bridge of [undefined, {}, { warmUpNativeAi() { throw new Error('old bridge'); } }]) {
  const old = fixture(bridge);
  assert.doesNotThrow(() => old.run('showGame(); setMode("ai");'));
}
let attempts = 0;
const retry = fixture({ warmUpNativeAi() { return ++attempts > 1; } });
retry.run('showGame(); showGame(); showGame();');
assert.equal(attempts, 2, 'a refused bridge request can retry, an accepted request cannot');

const normal = fixture();
normal.run('makeMove(7, 7, BLACK);');
assert.deepEqual(normal.events, ['draw'], 'AI search must yield after the human stone is drawn');
assert.equal(normal.frames.length, 1);
normal.frames.shift()();
assert.deepEqual([...normal.timers.values()].map(t => t.ms), [0], 'normal RAF path has no fixed thinking delay');
[...normal.timers.values()][0].fn();
assert.deepEqual(normal.events, ['draw', 'ai']);

const lostFrame = fixture();
lostFrame.run('makeMove(7, 7, BLACK);');
[...lostFrame.timers.values()][0].fn();
lostFrame.frames.shift()();
[...lostFrame.timers.values()].forEach(t => t.fn());
assert.equal(lostFrame.events.filter(e => e === 'ai').length, 1, 'a delayed RAF and timer submit once');
const hidden = fixture();
hidden.run('document.hidden = true; makeMove(7, 7, BLACK);');
assert.equal(hidden.frames.length, 0);
assert.equal([...hidden.timers.values()][0].ms, 0, 'hidden page cannot depend on RAF');
const stale = fixture();
stale.run('makeMove(7, 7, BLACK); aiTurnSeq++;');
stale.frames.shift()();
[...stale.timers.values()].forEach(t => t.fn());
assert.deepEqual(stale.events, ['draw'], 'restart or replay invalidates the scheduled search');
const skill = fixture();
skill.context.isProphecied = () => true;
skill.run('makeMove(7, 7, WHITE);');
assert.equal(skill.context.turn, 1, 'prophecy consumes the AI opportunity and returns the turn to the human');
assert.equal(skill.context.board[7][7], 0, 'the blocked stone must not be placed');
assert.equal(skill.timers.size, 0, 'prophecy must not schedule an AI retry');
assert.equal(skill.frames.length, 0);

const callback = between(source, '    window.__gomokuNativeAiResult =', '    function requestNativeAiMove(');
for (const engine of ['cpp', 'java', undefined, 'unrecognized']) {
  const pending = new Map();
  let move;
  pending.set('request', { timeoutId: 1, startedAt: Date.now() - 150, resolve(value) { move = value; }, reject(error) { throw error; } });
  const scope = { window: {}, nativeAiPending: pending, clearTimeout() {} };
  vm.runInNewContext(callback, scope);
  scope.window.__gomokuNativeAiResult('request', JSON.stringify({ ok: true, r: 7, c: 8, engine, elapsedMs: 110, queueMs: 9, searchMs: 110, totalMs: 121 }));
  assert.equal(move.r, 7);
  assert.equal(scope.window.gomokuLastAiStats.engine, engine === 'cpp' || engine === 'java' ? engine : 'native-unknown');
  assert.equal(scope.window.gomokuLastAiStats.native, true);
  assert.equal(scope.window.gomokuLastAiStats.queueMs, 9);
  assert.equal(scope.window.gomokuLastAiStats.totalMs, 121);
  assert.ok(scope.window.gomokuLastAiStats.roundTripMs >= 150);
}
const legacyPending = new Map();
let legacyMove;
legacyPending.set('legacy', {
  timeoutId: 1,
  startedAt: Date.now() - 150,
  resolve(value) { legacyMove = value; },
  reject(error) { throw error; }
});
const legacyScope = { window: {}, nativeAiPending: legacyPending, clearTimeout() {} };
vm.runInNewContext(callback, legacyScope);
legacyScope.window.__gomokuNativeAiResult('legacy', JSON.stringify({ ok: true, r: 7, c: 8, elapsedMs: 110 }));
assert.equal(legacyMove.r, 7);
assert.equal(legacyMove.c, 8);
assert.equal(legacyScope.window.gomokuLastAiStats.engine, 'native-unknown');
assert.equal(legacyScope.window.gomokuLastAiStats.searchMs, 110);
assert.equal(legacyScope.window.gomokuLastAiStats.queueMs, 0);
assert.equal(legacyScope.window.gomokuLastAiStats.totalMs, 110);
assert.ok(Number.isFinite(legacyScope.window.gomokuLastAiStats.roundTripMs));
const workerFunction = between(source, '    function getAiWorker() {', '    function flattenAiBoard(');
const workerScope = {
  aiWorker: null, aiWorkerBlobUrl: '', aiWorkerPending: new Map(), window: {},
  Worker: function () {}, document: { getElementById() { return null; } }, clearTimeout() {},
};
vm.runInNewContext(workerFunction, workerScope);
workerScope.getAiWorker();
workerScope.aiWorkerPending.set(1, { timeoutId: 1, resolve() {}, reject(error) { throw error; } });
workerScope.aiWorker.onmessage({ data: { requestId: 1, ok: true, move: { r: 1, c: 2 }, elapsedMs: 12, nodes: 10, depth: 3 } });
assert.equal(workerScope.window.gomokuLastAiStats.engine, 'worker');
console.log('AI latency smoke passed: actual entry hooks, scheduling, skill delay, stale turns, and native/worker diagnostics');
