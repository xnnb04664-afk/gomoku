const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { GomokuFastAI } = require('../js/ai_fast');
require('./ai_latency_smoke');

const SIZE = 15;

function emptyBoard() {
  return Array.from({ length: SIZE }, () => Array(SIZE).fill(0));
}

function makeBoard(moves) {
  const board = emptyBoard();
  for (const [r, c, color] of moves) board[r][c] = color;
  return board;
}

function isValid(r, c) {
  return r >= 0 && r < SIZE && c >= 0 && c < SIZE;
}

function hasFive(board, r, c, color) {
  for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
    let count = 1;
    for (const sign of [-1, 1]) {
      let nr = r + dr * sign;
      let nc = c + dc * sign;
      while (isValid(nr, nc) && board[nr][nc] === color) {
        count++;
        nr += dr * sign;
        nc += dc * sign;
      }
    }
    if (count >= 5) return true;
  }
  return false;
}

function winningMoves(board, color) {
  const result = [];
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (board[r][c] !== 0) continue;
      board[r][c] = color;
      if (hasFive(board, r, c, color)) result.push({ r, c });
      board[r][c] = 0;
    }
  }
  return result;
}

function moveIs(move, allowed) {
  return allowed.some(([r, c]) => move && move.r === r && move.c === c);
}

function searchOptions() {
  return { budgetMs: 520, maxDepth: 7, rootLimit: 20, candidateLimit: 72 };
}

const tests = [];

{
  const board = makeBoard([
    [7, 3, 2], [7, 4, 2], [7, 5, 2], [7, 6, 2]
  ]);
  const move = GomokuFastAI.getBestMove(board, 2, 'master', false, [], searchOptions());
  tests.push({ name: 'direct win', ok: moveIs(move, [[7, 2], [7, 7]]), move });
}

{
  const board = makeBoard([
    [7, 2, 2],
    [7, 3, 1], [7, 4, 1], [7, 5, 1], [7, 6, 1]
  ]);
  const move = GomokuFastAI.getBestMove(board, 2, 'master', false, [], searchOptions());
  tests.push({ name: 'single threat block', ok: move && move.r === 7 && move.c === 7, move });
}

{
  const board = makeBoard([
    [7, 7, 2], [7, 8, 2], [7, 9, 2], [6, 8, 2], [8, 8, 2]
  ]);
  const move = GomokuFastAI.getBestMove(board, 2, 'master', false, [], searchOptions());
  const after = board.map(row => row.slice());
  after[move.r][move.c] = 2;
  const wins = winningMoves(after, 2);
  tests.push({ name: 'double threat', ok: wins.length >= 2, move, winningReplies: wins.length });
}

{
  const board = makeBoard([[0, 0, 1]]);
  const move = GomokuFastAI.getBestMove(board, 2, 'master', false, [], searchOptions());
  tests.push({ name: 'corner opening returns to central fight', ok: move && move.r >= 5 && move.r <= 9 && move.c >= 5 && move.c <= 9, move });
}

{
  const board = makeBoard([
    [7, 3, 2], [7, 4, 2], [7, 5, 2], [7, 6, 2]
  ]);
  const move = GomokuFastAI.getBestMove(board, 2, 'master', false, [{ r: 7, c: 7 }], searchOptions());
  tests.push({ name: 'forbidden kill point is respected', ok: move && move.r === 7 && move.c === 2, move });
}

{
  const board = makeBoard([
    [7, 7, 1], [7, 8, 2], [8, 8, 1], [6, 7, 2]
  ]);
  const move = GomokuFastAI.getBestMove(board, 2, 'master', false, [], searchOptions());
  tests.push({ name: 'quiet position completes bounded search', ok: move && Number(move.nodes) > 0 && Number(move.depth) >= 2, move });
}

{
  const board = makeBoard([
    [7, 3, 2], [7, 4, 2], [7, 6, 2], [7, 7, 2],
    [6, 5, 1], [8, 5, 1]
  ]);
  const move = GomokuFastAI.getBestMove(board, 2, 'master', false, [], searchOptions());
  tests.push({ name: 'broken four is completed', ok: move && move.r === 7 && move.c === 5, move });
}

{
  const board = makeBoard([
    [7, 5, 2], [7, 6, 2], [7, 8, 2],
    [6, 6, 1], [8, 8, 1]
  ]);
  const move = GomokuFastAI.getBestMove(board, 2, 'master', false, [], searchOptions());
  const after = board.map(row => row.slice());
  if (move) after[move.r][move.c] = 2;
  const wins = move ? winningMoves(after, 2) : [];
  tests.push({ name: 'continuous four forcing move', ok: wins.length >= 2, move, winningReplies: wins.length });
}

{
  const board = makeBoard([
    [7, 3, 1], [7, 4, 1], [7, 5, 1], [7, 6, 1]
  ]);
  const originalSearchRoot = GomokuFastAI.searchRoot;
  let rootIndexes = [];
  GomokuFastAI.searchRoot = (position, candidates, depth, context) => {
    if (depth === 1 && rootIndexes.length === 0) rootIndexes = candidates.map(candidate => candidate.index);
    return { move: candidates[0] || null, score: 0, aborted: false };
  };
  let move;
  try {
    move = GomokuFastAI.getBestMove(board, 2, 'master', false, [], {
      budgetMs: 250,
      maxDepth: 1,
      rootLimit: 1,
      candidateLimit: 1
    });
  } finally {
    GomokuFastAI.searchRoot = originalSearchRoot;
  }
  const leftBlock = 7 * SIZE + 2;
  const rightBlock = 7 * SIZE + 7;
  tests.push({
    name: 'root keeps every multiple forced defense',
    ok: rootIndexes.includes(leftBlock) && rootIndexes.includes(rightBlock),
    move,
    rootIndexes: rootIndexes.filter(index => index === leftBlock || index === rightBlock)
  });
}

{
  const board = makeBoard([[0, 0, 1], [1, 1, 2]]);
  const move = GomokuFastAI.getBestMove(board, 2, 'master', false, [], searchOptions());
  tests.push({ name: 'edge and corner position stays legal', ok: move && move.r >= 0 && move.r < SIZE && move.c >= 0 && move.c < SIZE && board[move.r][move.c] === 0, move });
}

{
  const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');
  const start = source.indexOf('async function smartAiMove');
  const end = source.indexOf('// 显式挂到 window', start);
  const body = start >= 0 && end > start ? source.slice(start, end) : '';
  const routingStart = source.indexOf('async function requestBestAiMove(');
  const routingEnd = source.indexOf('function requestFastAiMove(', routingStart);
  const routingBody = routingStart >= 0 && routingEnd > routingStart ? source.slice(routingStart, routingEnd) : '';
  const forbiddenCalls = /handleCardClick|cardUsedStatus|currentDrawnCards|undoStack|skill_|destiny_|conn\.send/;
  tests.push({
    name: 'smart AI has no card side effects',
    ok: Boolean(body) && body.includes('requestBestAiMove') && body.includes('makeMove') &&
      routingBody.includes('requestNativeAiMove') && routingBody.includes('requestFastAiMove') &&
      !forbiddenCalls.test(body + routingBody),
    bodyLength: body.length
  });
}

async function checkNativeRouting() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');
  const start = source.indexOf('async function requestBestAiMove(');
  const end = source.indexOf('function requestFastAiMove(', start);
  assert.ok(start >= 0 && end > start, 'AI routing function must be present');
  const routingBody = source.slice(start, end);
  const board = makeBoard([[7, 7, 1]]);
  const forbidden = [{ r: 7, c: 8 }];
  const nativeMove = { r: 6, c: 7 };
  const workerMove = { r: 8, c: 7 };
  const scenarios = [
    { name: 'native legal move avoids Worker', native: nativeMove, worker: workerMove, nativeCalls: 1, workerCalls: 0, expected: nativeMove },
    { name: 'native rejection falls back to Worker', nativeError: true, worker: workerMove, nativeCalls: 1, workerCalls: 1, expected: workerMove },
    { name: 'native forbidden move falls back to Worker', native: forbidden[0], worker: workerMove, nativeCalls: 1, workerCalls: 1, expected: workerMove },
    { name: 'browser without native bridge uses Worker', noBridge: true, worker: workerMove, nativeCalls: 0, workerCalls: 1, expected: workerMove },
    { name: 'illegal Worker move is rejected', noBridge: true, worker: { r: 7, c: 7 }, nativeCalls: 0, workerCalls: 1, rejects: true }
  ];
  for (const scenario of scenarios) {
    let nativeCalls = 0, workerCalls = 0;
    const route = vm.runInNewContext(`(${routingBody})`, {
      window: scenario.noBridge ? {} : { AndroidNativeApp: { requestNativeAiMove() {} } },
      console: { warn() {} },
      requestNativeAiMove: async (receivedBoard, receivedForbidden) => {
        nativeCalls++;
        assert.equal(receivedBoard, board);
        assert.equal(receivedForbidden, forbidden);
        if (scenario.nativeError) throw new Error('native unavailable');
        return scenario.native;
      },
      requestFastAiMove: async (receivedBoard, receivedForbidden) => {
        workerCalls++;
        assert.equal(receivedBoard, board);
        assert.equal(receivedForbidden, forbidden);
        return scenario.worker;
      },
      isLegalAiMove: (move, receivedBoard, receivedForbidden) => move &&
        Number.isInteger(move.r) && Number.isInteger(move.c) && isValid(move.r, move.c) &&
        receivedBoard[move.r][move.c] === 0 &&
        !receivedForbidden.some(point => point.r === move.r && point.c === move.c)
    });
    if (scenario.rejects) await assert.rejects(route(board, forbidden), /Worker/);
    else assert.equal(await route(board, forbidden), scenario.expected);
    tests.push({ name: scenario.name, ok: nativeCalls === scenario.nativeCalls && workerCalls === scenario.workerCalls, nativeCalls, workerCalls });
  }
}

checkNativeRouting().then(() => {
  for (const test of tests) {
    console.log(JSON.stringify(test));
    assert.equal(test.ok, true, `${test.name} failed: ${JSON.stringify(test)}`);
  }
  console.log(`AI strength smoke passed: ${tests.length} tactical/search/routing cases`);
}).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
