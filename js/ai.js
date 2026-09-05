/**
 * 五子棋强力 AI 引擎
 *
 * 设计目标：
 * - 先处理必胜、必防和双重威胁，再进入搜索；
 * - 使用棋型评估，而不是只看棋盘位置分；
 * - Alpha-Beta + 置换表 + 迭代加深，在移动端限制单步计算时间；
 * - 支持禁手规则与技能产生的 forbiddenPoints；
 * - 全程确定性落子，避免同一局面随机走出弱着。
 */

const GOMOKU_AI_SCORE = Object.freeze({
  WIN: 100000000,
  OPEN_FOUR: 12000000,
  FOUR: 1800000,
  DOUBLE_THREE: 650000,
  OPEN_THREE: 85000,
  BROKEN_THREE: 18000,
  OPEN_TWO: 1800,
  TWO: 220,
  ONE: 12
});

const GOMOKU_AI_DIRECTIONS = [
  [0, 1],
  [1, 0],
  [1, 1],
  [1, -1]
];

class GomokuAI {
  static getBestMove(board, aiColor, difficulty = 'master', enableFoul = false, forbiddenPoints = []) {
    const size = this.getBoardSize(board);
    const opponent = this.getOpponent(aiColor);
    const forbidden = new Set((forbiddenPoints || []).map(p => `${p.r},${p.c}`));
    const legal = this.getCandidateMoves(board, aiColor, enableFoul, forbidden, 64);

    if (!legal.length) return this.findFirstEmpty(board);
    if (this.countStones(board) === 0) return this.centerMove(size);

    // 1. 直接成五优先级最高。完整扫描候选池，避免唯一杀点被排序截断。
    const ownWins = this.getWinningMoves(board, aiColor, enableFoul, size * size, forbidden);
    if (ownWins.length) return ownWins[0];

    // 2. 对手有立即胜点时必须封堵；若有多个胜点，后续搜索会尽量反攻。
    const opponentWins = this.getWinningMoves(board, opponent, enableFoul, size * size, forbidden);
    if (opponentWins.length === 1) {
      const block = opponentWins[0];
      if (!this.isForbiddenMove(board, block.r, block.c, aiColor, enableFoul, forbidden)) return block;
    }

    // 3. 抢先制造双重威胁，通常比单纯的局面评分更强。
    if (difficulty === 'master' || difficulty === 'hard') {
      const forcing = this.findDoubleThreat(board, aiColor, legal, enableFoul, forbidden);
      if (forcing) return forcing;
    }

    if (difficulty === 'easy') return this.pickGreedy(board, aiColor, legal, enableFoul);
    if (difficulty === 'medium') return this.pickGreedy(board, aiColor, legal, enableFoul, 1.05);

    // 4. 大师模式：迭代加深。只采用完整跑完的一层，超时不会返回半截搜索结果。
    const mobile = typeof navigator !== 'undefined' && /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent || '');
    const budgetMs = mobile ? 260 : 420;
    const maxDepth = mobile ? 5 : 6;
    const rootCandidates = legal.slice(0, mobile ? 14 : 18);
    const deadline = this.now() + budgetMs;
    const context = {
      aiColor,
      opponent,
      enableFoul,
      forbidden,
      deadline,
      table: new Map(),
      nodes: 0
    };
    const rootHash = this.hashBoard(board);
    context.rootHashA = rootHash.a;
    context.rootHashB = rootHash.b;

    let best = rootCandidates[0];
    for (let depth = 1; depth <= maxDepth; depth++) {
      const result = this.searchRoot(board, rootCandidates, depth, context);
      if (result.aborted) break;
      if (result.move) best = result.move;
      if (result.score >= GOMOKU_AI_SCORE.WIN - 1000) break;
    }

    return best || legal[0];
  }

  static getBoardSize(board) {
    return Array.isArray(board) && board.length > 0 ? board.length : 15;
  }

  static getEmpty() {
    return typeof EMPTY === 'undefined' ? 0 : EMPTY;
  }

  static getBlack() {
    return typeof BLACK === 'undefined' ? 1 : BLACK;
  }

  static getOpponent(color) {
    return color === this.getBlack() ? 2 : this.getBlack();
  }

  static now() {
    return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
  }

  static centerMove(size) {
    const center = Math.floor(size / 2);
    return { r: center, c: center };
  }

  static findFirstEmpty(board) {
    const empty = this.getEmpty();
    for (let r = 0; r < board.length; r++) {
      for (let c = 0; c < board[r].length; c++) {
        if (board[r][c] === empty) return { r, c };
      }
    }
    return null;
  }

  static countStones(board) {
    const empty = this.getEmpty();
    let count = 0;
    for (const row of board) {
      for (const cell of row) if (cell !== empty) count++;
    }
    return count;
  }

  static isValid(board, r, c) {
    return r >= 0 && r < board.length && c >= 0 && c < board[r].length;
  }

  static isForbiddenMove(board, r, c, color, enableFoul, forbidden) {
    if (forbidden && forbidden.has(`${r},${c}`)) return true;
    if (!enableFoul || color !== this.getBlack()) return false;

    const empty = this.getEmpty();
    if (board[r][c] !== empty) return true;
    board[r][c] = color;
    const hasExactFive = this.hasFive(board, r, c, color) && !this.hasOverline(board, r, c, color);
    const overline = this.hasOverline(board, r, c, color);
    board[r][c] = empty;
    // 传统禁手规则中，正好成五优先于三三/四四；长连仍然判禁。
    if (overline) return true;
    if (hasExactFive) return false;

    const pattern = this.analyzeMove(board, r, c, color);
    return pattern.four >= 2 || pattern.openThree >= 2;
  }

  static getCandidateMoves(board, color, enableFoul = false, forbidden = new Set(), limit = 24) {
    const empty = this.getEmpty();
    const size = this.getBoardSize(board);
    const stones = this.countStones(board);
    const center = Math.floor(size / 2);
    if (!stones) return [this.centerMove(size)];

    const raw = [];
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (board[r][c] !== empty || this.isForbiddenMove(board, r, c, color, enableFoul, forbidden)) continue;
        const openingAnchor = stones <= 2 && Math.abs(r - center) <= 2 && Math.abs(c - center) <= 2;
        if (!openingAnchor && !this.isNearStone(board, r, c, 2)) continue;
        const own = this.analyzeMove(board, r, c, color);
        const opp = this.analyzeMove(board, r, c, this.getOpponent(color));
        const position = this.positionValue(r, c, size);
        raw.push({ r, c, score: this.moveOrderingScore(own, opp) + position });
      }
    }

    if (!raw.length) {
      for (let r = 0; r < size; r++) {
        for (let c = 0; c < size; c++) {
          if (board[r][c] === empty && !this.isForbiddenMove(board, r, c, color, enableFoul, forbidden)) {
            raw.push({ r, c, score: this.positionValue(r, c, size) });
          }
        }
      }
    }

    raw.sort((a, b) => b.score - a.score || a.r - b.r || a.c - b.c);
    return raw.slice(0, limit);
  }

  static isNearStone(board, r, c, radius) {
    const empty = this.getEmpty();
    for (let dr = -radius; dr <= radius; dr++) {
      for (let dc = -radius; dc <= radius; dc++) {
        if (dr === 0 && dc === 0) continue;
        const nr = r + dr;
        const nc = c + dc;
        if (this.isValid(board, nr, nc) && board[nr][nc] !== empty) return true;
      }
    }
    return false;
  }

  static positionValue(r, c, size) {
    const center = (size - 1) / 2;
    const distance = Math.abs(r - center) + Math.abs(c - center);
    return Math.max(0, size * 2 - distance);
  }

  static moveOrderingScore(own, opp) {
    if (own.five) return GOMOKU_AI_SCORE.WIN;
    if (opp.five) return GOMOKU_AI_SCORE.WIN * 0.92;
    if (own.openFour) return GOMOKU_AI_SCORE.OPEN_FOUR;
    if (opp.openFour) return GOMOKU_AI_SCORE.OPEN_FOUR * 0.9;
    if (own.four >= 2) return GOMOKU_AI_SCORE.FOUR * 7;
    if (opp.four >= 2) return GOMOKU_AI_SCORE.FOUR * 6.5;
    if (own.four && own.openThree) return GOMOKU_AI_SCORE.FOUR * 5;
    if (opp.four && opp.openThree) return GOMOKU_AI_SCORE.FOUR * 4.5;
    if (own.openThree >= 2) return GOMOKU_AI_SCORE.DOUBLE_THREE;
    if (opp.openThree >= 2) return GOMOKU_AI_SCORE.DOUBLE_THREE * 0.92;
    return own.score * 1.18 + opp.score * 1.08;
  }

  static analyzeMove(board, r, c, color) {
    const empty = this.getEmpty();
    if (!this.isValid(board, r, c) || board[r][c] !== empty) {
      return { five: 0, openFour: 0, four: 0, openThree: 0, brokenThree: 0, openTwo: 0, score: -Infinity };
    }

    let five = 0;
    let openFour = 0;
    let four = 0;
    let openThree = 0;
    let brokenThree = 0;
    let openTwo = 0;

    for (const [dr, dc] of GOMOKU_AI_DIRECTIONS) {
      const line = this.getPatternLine(board, r, c, color, dr, dc);
      if (line.includes('11111')) five++;
      if (line.includes('011110')) openFour++;
      if (line.includes('011112') || line.includes('211110') || line.includes('10111') || line.includes('11011') || line.includes('11101')) four++;
      if (line.includes('01110') || line.includes('010110') || line.includes('011010')) openThree++;
      if (line.includes('0011100') || line.includes('0010110') || line.includes('0110100') || line.includes('0101100')) brokenThree++;
      if (line.includes('0110')) openTwo++;
    }

    const score = five ? GOMOKU_AI_SCORE.WIN :
      openFour ? GOMOKU_AI_SCORE.OPEN_FOUR :
      four >= 2 ? GOMOKU_AI_SCORE.FOUR * 7 :
      four && openThree ? GOMOKU_AI_SCORE.FOUR * 5 :
      openThree >= 2 ? GOMOKU_AI_SCORE.DOUBLE_THREE :
      four ? GOMOKU_AI_SCORE.FOUR :
      openThree ? GOMOKU_AI_SCORE.OPEN_THREE :
      brokenThree ? GOMOKU_AI_SCORE.BROKEN_THREE :
      openTwo ? GOMOKU_AI_SCORE.OPEN_TWO : GOMOKU_AI_SCORE.ONE;

    return { five, openFour, four, openThree, brokenThree, openTwo, score };
  }

  static getPatternLine(board, r, c, color, dr, dc) {
    const empty = this.getEmpty();
    let line = '';
    for (let i = -5; i <= 5; i++) {
      const nr = r + i * dr;
      const nc = c + i * dc;
      if (i === 0) {
        line += '1';
      } else if (!this.isValid(board, nr, nc)) {
        line += '2';
      } else if (board[nr][nc] === color) {
        line += '1';
      } else if (board[nr][nc] === empty) {
        line += '0';
      } else {
        line += '2';
      }
    }
    return line;
  }

  static hasFive(board, r, c, color) {
    for (const [dr, dc] of GOMOKU_AI_DIRECTIONS) {
      let count = 1;
      count += this.countDirection(board, r, c, dr, dc, color);
      count += this.countDirection(board, r, c, -dr, -dc, color);
      if (count >= 5) return true;
    }
    return false;
  }

  static hasOverline(board, r, c, color) {
    for (const [dr, dc] of GOMOKU_AI_DIRECTIONS) {
      let count = 1;
      count += this.countDirection(board, r, c, dr, dc, color);
      count += this.countDirection(board, r, c, -dr, -dc, color);
      if (count > 5) return true;
    }
    return false;
  }

  static countDirection(board, r, c, dr, dc, color) {
    let count = 0;
    let nr = r + dr;
    let nc = c + dc;
    while (this.isValid(board, nr, nc) && board[nr][nc] === color) {
      count++;
      nr += dr;
      nc += dc;
    }
    return count;
  }

  static isWinningMove(board, r, c, color) {
    const empty = this.getEmpty();
    if (!this.isValid(board, r, c) || board[r][c] !== empty) return false;
    board[r][c] = color;
    const won = this.hasFive(board, r, c, color);
    board[r][c] = empty;
    return won;
  }

  static getWinningMoves(board, color, enableFoul = false, limit = 40, forbidden = new Set()) {
    const candidates = this.getCandidateMoves(board, color, enableFoul, forbidden, limit);
    return candidates.filter(move => this.isWinningMove(board, move.r, move.c, color));
  }

  static findDoubleThreat(board, color, candidates, enableFoul, forbidden = new Set()) {
    const empty = this.getEmpty();
    const opponent = this.getOpponent(color);
    for (const move of candidates) {
      const pattern = this.analyzeMove(board, move.r, move.c, color);
      if (!(pattern.five || pattern.four || pattern.openThree >= 2 || pattern.brokenThree >= 2)) continue;
      if (this.isForbiddenMove(board, move.r, move.c, color, enableFoul, forbidden)) continue;
      board[move.r][move.c] = color;
      const opponentWins = this.getWinningMoves(board, opponent, enableFoul, this.getBoardSize(board) ** 2, forbidden);
      if (!opponentWins.length) {
        const wins = this.getWinningMoves(board, color, enableFoul, this.getBoardSize(board) ** 2, forbidden);
        if (wins.length >= 2) {
          board[move.r][move.c] = empty;
          return move;
        }
        if (wins.length === 1) {
          const block = wins[0];
          board[block.r][block.c] = opponent;
          const followUp = this.getWinningMoves(board, color, enableFoul, this.getBoardSize(board) ** 2, forbidden);
          const counter = this.getWinningMoves(board, opponent, enableFoul, this.getBoardSize(board) ** 2, forbidden);
          board[block.r][block.c] = empty;
          if (followUp.length && !counter.length) {
            board[move.r][move.c] = empty;
            return move;
          }
        }
      }
      board[move.r][move.c] = empty;
    }
    return null;
  }

  static pickGreedy(board, color, candidates, enableFoul, attackWeight = 1.1) {
    let best = candidates[0];
    let bestScore = -Infinity;
    const opponent = this.getOpponent(color);
    for (const move of candidates) {
      const own = this.analyzeMove(board, move.r, move.c, color);
      const opp = this.analyzeMove(board, move.r, move.c, opponent);
      const score = own.score * attackWeight + opp.score;
      if (score > bestScore) {
        bestScore = score;
        best = move;
      }
    }
    return best;
  }

  static evaluateBoard(board, aiColor, opponent) {
    let aiScore = 0;
    let opponentScore = 0;
    const size = this.getBoardSize(board);
    for (const [dr, dc] of GOMOKU_AI_DIRECTIONS) {
      for (let r = 0; r < size; r++) {
        for (let c = 0; c < size; c++) {
          if (this.isValid(board, r - dr, c - dc)) continue;
          const line = [];
          let nr = r;
          let nc = c;
          while (this.isValid(board, nr, nc)) {
            line.push(board[nr][nc]);
            nr += dr;
            nc += dc;
          }
          aiScore += this.evaluateLine(line, aiColor);
          opponentScore += this.evaluateLine(line, opponent);
        }
      }
    }

    let position = 0;
    const empty = this.getEmpty();
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (board[r][c] === aiColor) position += this.positionValue(r, c, size);
        else if (board[r][c] !== empty) position -= this.positionValue(r, c, size);
      }
    }
    return aiScore - opponentScore * 1.12 + position;
  }

  static evaluateLine(line, color) {
    const empty = this.getEmpty();
    let score = 0;
    for (let i = 0; i < line.length;) {
      if (line[i] !== color) {
        i++;
        continue;
      }
      let end = i;
      while (end < line.length && line[end] === color) end++;
      const length = end - i;
      const openLeft = i > 0 && line[i - 1] === empty;
      const openRight = end < line.length && line[end] === empty;
      const openEnds = (openLeft ? 1 : 0) + (openRight ? 1 : 0);
      if (length >= 5) score += GOMOKU_AI_SCORE.WIN;
      else if (length === 4) score += openEnds === 2 ? GOMOKU_AI_SCORE.OPEN_FOUR : openEnds ? GOMOKU_AI_SCORE.FOUR : 0;
      else if (length === 3) score += openEnds === 2 ? GOMOKU_AI_SCORE.OPEN_THREE : openEnds ? GOMOKU_AI_SCORE.BROKEN_THREE : 0;
      else if (length === 2) score += openEnds === 2 ? GOMOKU_AI_SCORE.OPEN_TWO : openEnds ? GOMOKU_AI_SCORE.TWO : 0;
      else if (length === 1 && openEnds === 2) score += GOMOKU_AI_SCORE.ONE;
      i = end;
    }
    return score;
  }

  // 用两路 32 位 Zobrist 哈希替代每个搜索节点拼接整盘字符串，显著减少移动端 GC 和置换表键分配。
  // 搜索仍保留完整棋盘校验逻辑；双哈希只用于置换表索引，碰撞概率足够低且不会改变对局数据格式。
  static ensureZobrist(size) {
    if (this.zobristSize === size && this.zobristA && this.zobristB) return;
    const length = size * size * 3;
    const tableA = new Uint32Array(length);
    const tableB = new Uint32Array(length);
    let seed = 0x9e3779b9;
    const nextRandom = () => {
      seed = Math.imul(seed ^ (seed >>> 16), 0x21f0aaad);
      seed = Math.imul(seed ^ (seed >>> 15), 0x735a2d97);
      return (seed ^ (seed >>> 15)) >>> 0;
    };
    for (let i = 0; i < length; i++) {
      tableA[i] = nextRandom();
      tableB[i] = nextRandom();
    }
    this.zobristSize = size;
    this.zobristA = tableA;
    this.zobristB = tableB;
  }

  static hashBoard(board) {
    const size = this.getBoardSize(board);
    this.ensureZobrist(size);
    const black = this.getBlack();
    const opponent = this.getOpponent(black);
    const empty = this.getEmpty();
    let hashA = 0;
    let hashB = 0;
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        const cell = board[r][c];
        if (cell === empty || (cell !== black && cell !== opponent)) continue;
        const index = (r * size + c) * 3 + cell;
        hashA ^= this.zobristA[index];
        hashB ^= this.zobristB[index];
      }
    }
    return { a: hashA >>> 0, b: hashB >>> 0 };
  }

  static hashKey(hashA, hashB, turnColor, depth) {
    return `${hashA >>> 0}:${hashB >>> 0}:${turnColor}:${depth}`;
  }

  static searchRoot(board, candidates, depth, context) {
    let bestMove = null;
    let bestScore = -Infinity;
    let alpha = -Infinity;
    const beta = Infinity;
    const empty = this.getEmpty();
    const size = this.getBoardSize(board);

    for (const move of candidates) {
      if (this.now() >= context.deadline) return { aborted: true };
      board[move.r][move.c] = context.aiColor;
      const hashIndex = (move.r * size + move.c) * 3 + context.aiColor;
      const childHashA = context.rootHashA ^ this.zobristA[hashIndex];
      const childHashB = context.rootHashB ^ this.zobristB[hashIndex];
      let score;
      if (this.isWinningMoveAfterPlacement(board, move.r, move.c, context.aiColor)) {
        score = GOMOKU_AI_SCORE.WIN;
      } else {
        const child = this.search(board, depth - 1, alpha, beta, context.opponent, context, 1, childHashA, childHashB);
        if (child.aborted) {
          board[move.r][move.c] = empty;
          return child;
        }
        score = child.score;
      }
      board[move.r][move.c] = empty;
      if (score > bestScore) {
        bestScore = score;
        bestMove = move;
      }
      alpha = Math.max(alpha, bestScore);
    }
    return { move: bestMove, score: bestScore, aborted: false };
  }

  static search(board, depth, alpha, beta, turnColor, context, ply, hashA, hashB) {
    context.nodes++;
    if (this.now() >= context.deadline) return { score: 0, aborted: true };
    if (depth <= 0) return { score: this.evaluateBoard(board, context.aiColor, context.opponent), aborted: false };

    if (hashA === undefined || hashB === undefined) {
      const fallbackHash = this.hashBoard(board);
      hashA = fallbackHash.a;
      hashB = fallbackHash.b;
    }
    const key = this.hashKey(hashA, hashB, turnColor, depth);
    const cached = context.table.get(key);
    if (cached && cached.depth >= depth) return { score: cached.score, aborted: false };

    const maximizing = turnColor === context.aiColor;
    const candidates = this.getCandidateMoves(board, turnColor, context.enableFoul, context.forbidden, depth >= 3 ? 10 : 14);
    if (!candidates.length) return { score: 0, aborted: false };
    const empty = this.getEmpty();
    const size = this.getBoardSize(board);
    let bestScore = maximizing ? -Infinity : Infinity;
    let bestMove = null;
    let cutoff = false;

    for (const move of candidates) {
      if (this.now() >= context.deadline) return { score: 0, aborted: true };
      board[move.r][move.c] = turnColor;
      const hashIndex = (move.r * size + move.c) * 3 + turnColor;
      const childHashA = hashA ^ this.zobristA[hashIndex];
      const childHashB = hashB ^ this.zobristB[hashIndex];
      let score;
      if (this.isWinningMoveAfterPlacement(board, move.r, move.c, turnColor)) {
        score = maximizing ? GOMOKU_AI_SCORE.WIN - ply : -GOMOKU_AI_SCORE.WIN + ply;
      } else {
        const child = this.search(board, depth - 1, alpha, beta, this.getOpponent(turnColor), context, ply + 1, childHashA, childHashB);
        if (child.aborted) {
          board[move.r][move.c] = empty;
          return child;
        }
        score = child.score;
      }
      board[move.r][move.c] = empty;

      if (maximizing) {
        if (score > bestScore) {
          bestScore = score;
          bestMove = move;
        }
        alpha = Math.max(alpha, bestScore);
      } else {
        if (score < bestScore) {
          bestScore = score;
          bestMove = move;
        }
        beta = Math.min(beta, bestScore);
      }
      if (beta <= alpha) {
        cutoff = true;
        break;
      }
    }

    if (!cutoff) context.table.set(key, { depth, score: bestScore, move: bestMove });
    return { score: bestScore, move: bestMove, aborted: false };
  }

  static isWinningMoveAfterPlacement(board, r, c, color) {
    return this.hasFive(board, r, c, color);
  }
}

if (typeof window !== 'undefined') window.GomokuAI = GomokuAI;
if (typeof module !== 'undefined' && module.exports) module.exports = { GomokuAI };
