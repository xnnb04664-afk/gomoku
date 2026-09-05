const assert = require('node:assert/strict');
const { GomokuFastAI } = require('../js/ai_fast');

const SIZE = 15;
const EMPTY = 0;
const BLACK = 1;
const WHITE = 2;
const DIRECTIONS = [[0, 1], [1, 0], [1, 1], [1, -1]];

const OPENINGS = [
  [[7, 7], [7, 8], [8, 8], [6, 7], [6, 9], [8, 6]],
  [[0, 0], [1, 1], [0, 2], [2, 1], [3, 3], [1, 3]],
  [[7, 7], [6, 8], [8, 6], [7, 9], [5, 7], [9, 5]]
];

function emptyBoard() {
  return Array.from({ length: SIZE }, () => Array(SIZE).fill(EMPTY));
}

function opposite(color) {
  return color === BLACK ? WHITE : BLACK;
}

function hasFive(board, r, c, color) {
  for (const [dr, dc] of DIRECTIONS) {
    let count = 1;
    for (const sign of [-1, 1]) {
      let nr = r + dr * sign;
      let nc = c + dc * sign;
      while (nr >= 0 && nr < SIZE && nc >= 0 && nc < SIZE && board[nr][nc] === color) {
        count++;
        nr += dr * sign;
        nc += dc * sign;
      }
    }
    if (count >= 5) return true;
  }
  return false;
}

function runGame(opening, firstColor, gameIndex) {
  const board = emptyBoard();
  const moves = [];
  const skillActions = [];
  const skillMessages = [];
  let turn = firstColor;
  let winner = 0;

  for (const [r, c] of opening) {
    assert.equal(board[r][c], EMPTY, `opening overwrites a stone in game ${gameIndex}`);
    board[r][c] = turn;
    moves.push({ type: 'move', r, c, color: turn });
    assert.equal(hasFive(board, r, c, turn), false, `opening unexpectedly ended game ${gameIndex}`);
    turn = opposite(turn);
  }

  const searchOptions = {
    // 自对弈是回归烟测，使用低预算快速完成多局；生产 Worker 预算由页面单独传入。
    budgetMs: 28,
    maxDepth: 4,
    rootLimit: 12,
    candidateLimit: 48,
    threatPly: 6,
    size: SIZE
  };
  const maxMoves = SIZE * SIZE;

  for (let ply = moves.length; ply < maxMoves; ply++) {
    const request = {
      board: board.map(row => row.slice()),
      aiColor: turn,
      difficulty: 'master',
      enableFoul: false,
      forbiddenPoints: [],
      options: { ...searchOptions }
    };
    assert.deepEqual(
      Object.keys(request).filter(key => /card|skill|destiny/i.test(key)),
      [],
      `AI self-play request contains card state in game ${gameIndex}`
    );

    const move = GomokuFastAI.getBestMove(
      request.board,
      request.aiColor,
      request.difficulty,
      request.enableFoul,
      request.forbiddenPoints,
      request.options
    );
    assert.ok(move && Number.isInteger(move.r) && Number.isInteger(move.c), `AI returned no move in game ${gameIndex}`);
    assert.ok(move.r >= 0 && move.r < SIZE && move.c >= 0 && move.c < SIZE, `AI returned an illegal coordinate in game ${gameIndex}`);
    assert.equal(board[move.r][move.c], EMPTY, `AI overwrote a stone in game ${gameIndex}`);

    board[move.r][move.c] = turn;
    moves.push({ type: 'move', r: move.r, c: move.c, color: turn });
    assert.equal(
      Object.keys(moves[moves.length - 1]).some(key => /card|skill|destiny/i.test(key)),
      false,
      `self-play move contains a skill field in game ${gameIndex}`
    );
    assert.deepEqual(skillActions, [], `self-play emitted a skill action in game ${gameIndex}`);
    assert.deepEqual(skillMessages, [], `self-play emitted a skill message in game ${gameIndex}`);

    if (hasFive(board, move.r, move.c, turn)) {
      winner = turn;
      break;
    }
    turn = opposite(turn);
  }

  const occupied = board.reduce((sum, row) => sum + row.filter(cell => cell !== EMPTY).length, 0);
  const draw = !winner && occupied === SIZE * SIZE;
  assert.ok(winner || draw, `self-play game ${gameIndex} did not terminate`);
  return { gameIndex, firstColor, winner, draw, moves: moves.length, occupied, skillActions, skillMessages };
}

const results = [];
let gameIndex = 0;
for (const opening of OPENINGS) {
  results.push(runGame(opening, BLACK, ++gameIndex));
  results.push(runGame(opening, WHITE, ++gameIndex));
}

for (const result of results) {
  assert.equal(result.skillActions.length, 0);
  assert.equal(result.skillMessages.length, 0);
  console.log(JSON.stringify(result));
}
console.log(`AI self-play passed: ${results.length} games`);
