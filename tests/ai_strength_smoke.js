const assert = require('node:assert/strict');
const { GomokuFastAI } = require('../js/ai_fast');

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

for (const test of tests) {
  console.log(JSON.stringify(test));
  assert.equal(test.ok, true, `${test.name} failed: ${JSON.stringify(test)}`);
}

console.log(`AI strength smoke passed: ${tests.length} tactical/search cases`);
