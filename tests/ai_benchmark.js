const { GomokuAI } = require('../js/ai');
const { GomokuFastAI } = require('../js/ai_fast');

function emptyBoard() {
  return Array.from({ length: 15 }, () => Array(15).fill(0));
}

function buildPosition(moves) {
  const board = emptyBoard();
  for (const [r, c, color] of moves) board[r][c] = color;
  return board;
}

const positions = [
  {
    name: 'opening',
    board: buildPosition([
      [7, 7, 1], [7, 8, 2], [8, 8, 1], [6, 7, 2],
      [8, 7, 1], [6, 8, 2], [6, 6, 1], [8, 9, 2]
    ])
  },
  {
    name: 'tactical',
    board: buildPosition([
      [7, 3, 2], [6, 3, 1], [7, 4, 2], [6, 4, 1],
      [7, 5, 2], [6, 5, 1], [7, 6, 2], [5, 5, 1],
      [8, 8, 2], [5, 7, 1], [9, 9, 2]
    ])
  },
  {
    name: 'quiet',
    board: buildPosition([
      [7, 7, 1], [7, 8, 2], [8, 8, 1], [6, 7, 2]
    ])
  }
];

function measure(label, fn, runs = 3) {
  const samples = [];
  let last = null;
  for (let i = 0; i < runs; i++) {
    const start = performance.now();
    last = fn();
    samples.push(performance.now() - start);
  }
  const sorted = samples.slice().sort((a, b) => a - b);
  return {
    label,
    samplesMs: samples.map(value => Math.round(value * 10) / 10),
    medianMs: Math.round(sorted[Math.floor(sorted.length / 2)] * 10) / 10,
    move: last ? { r: last.r, c: last.c } : null,
    nodes: Number(last && last.nodes) || 0,
    depth: Number(last && last.depth) || 0
  };
}

const output = [];
for (const position of positions) {
  output.push(measure(`legacy-${position.name}`, () => GomokuAI.getBestMove(
    position.board.map(row => row.slice()), 2, 'master', false, []
  )));
  output.push(measure(`fast-${position.name}`, () => GomokuFastAI.getBestMove(
    position.board, 2, 'master', false, [], {
      budgetMs: 520,
      maxDepth: 7,
      rootLimit: 20,
      candidateLimit: 72
    }
  )));
}

console.log(JSON.stringify({ node: process.version, results: output }, null, 2));
