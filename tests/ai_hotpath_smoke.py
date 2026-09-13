"""Smoke checks for the cached AI geometry hot path.

The test deliberately compares the cached line index table with the old
coordinate calculation for several board sizes.  It then exercises both the
flat Worker input shape and the normal bounded search path.
"""

from pathlib import Path
import json
import subprocess
import sys


ROOT = Path(__file__).resolve().parents[1]

NODE_CHECK = r'''
const assert = require('node:assert/strict');
const { GomokuFastAI } = require('./js/ai_fast');

const DIRECTIONS = [[0, 1], [1, 0], [1, 1], [1, -1]];
const LOCAL_LINE_LENGTH = 11;

function referenceLineCode(board, size, index, color, dr, dc) {
  const r = Math.floor(index / size);
  const c = index % size;
  let code = 0;
  for (let offset = -5; offset <= 5; offset++) {
    const nr = r + offset * dr;
    const nc = c + offset * dc;
    let value = 2;
    if (offset === 0) value = 1;
    else if (nr >= 0 && nr < size && nc >= 0 && nc < size) {
      const cell = board[nr * size + nc];
      value = cell === 0 ? 0 : (cell === color ? 1 : 2);
    }
    code = code * 3 + value;
  }
  return code;
}

function makeGeometry(size) {
  const count = size * size;
  const lineIndexes = new Int32Array(count * DIRECTIONS.length * LOCAL_LINE_LENGTH);
  lineIndexes.fill(-1);
  for (let index = 0; index < count; index++) {
    const r = Math.floor(index / size);
    const c = index % size;
    for (let direction = 0; direction < DIRECTIONS.length; direction++) {
      const [dr, dc] = DIRECTIONS[direction];
      const base = (index * DIRECTIONS.length + direction) * LOCAL_LINE_LENGTH;
      for (let offset = -5; offset <= 5; offset++) {
        if (offset === 0) continue;
        const nr = r + offset * dr;
        const nc = c + offset * dc;
        if (nr >= 0 && nr < size && nc >= 0 && nc < size) {
          lineIndexes[base + offset + 5] = nr * size + nc;
        }
      }
    }
  }
  return { lineIndexes };
}

let seed = 0x12345678;
function randomByte() {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed;
}

let lineChecks = 0;
for (const size of [5, 9, 15]) {
  const geometry = makeGeometry(size);
  const count = size * size;
  for (let sample = 0; sample < 18; sample++) {
    const board = new Uint8Array(count);
    for (let index = 0; index < count; index++) {
      const value = randomByte() % 5;
      board[index] = value < 2 ? value + 1 : 0;
    }
    for (let index = 0; index < count; index++) {
      for (let direction = 0; direction < DIRECTIONS.length; direction++) {
        const position = {
          size,
          cellCount: count,
          board,
          geometry,
          isEmpty(candidate) { return this.board[candidate] === 0; }
        };
        const actual = GomokuFastAI.lineCodeByDirection(position, index, 1, direction);
        const expected = referenceLineCode(board, size, index, 1, ...DIRECTIONS[direction]);
        assert.equal(actual, expected, `line code mismatch size=${size} index=${index} direction=${direction}`);
        lineChecks++;
      }
    }
  }
}

const quiet = Array.from({ length: 15 }, () => Array(15).fill(0));
for (const [r, c, color] of [[7, 7, 1], [7, 8, 2], [8, 8, 1], [6, 7, 2]]) quiet[r][c] = color;
const flat = Uint8Array.from(quiet.flat());
const started = performance.now();
const result = GomokuFastAI.getBestMove(flat, 2, 'master', false, [], {
  size: 15,
  budgetMs: 80,
  maxDepth: 3,
  rootLimit: 14,
  candidateLimit: 48,
  threatPly: 6
});
const elapsedMs = Math.round(performance.now() - started);
assert.ok(result && result.r >= 0 && result.r < 15 && result.c >= 0 && result.c < 15);
assert.equal(flat[result.r * 15 + result.c], 0);
assert.ok(Number(result.nodes) > 0);

console.log(JSON.stringify({
  pass: true,
  lineChecks,
  flatBoard: true,
  move: { r: result.r, c: result.c },
  nodes: Number(result.nodes) || 0,
  depth: Number(result.depth) || 0,
  elapsedMs
}));
'''


def main() -> int:
    completed = subprocess.run(
        ["node", "-e", NODE_CHECK],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    if completed.stdout:
        print(completed.stdout, end="")
    if completed.returncode:
        if completed.stderr:
            print(completed.stderr, file=sys.stderr, end="")
        return completed.returncode
    payload = json.loads(completed.stdout.strip().splitlines()[-1])
    if not payload.get("pass") or payload.get("lineChecks", 0) < 3000:
        print(f"unexpected AI hotpath result: {payload}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
