/**
 * 五子棋移动端快速 AI 内核。
 *
 * 这是给 Web Worker/Wasm 适配层使用的扁平棋盘实现：
 * - Uint8Array 保存 225 个格子，避免搜索过程中复制二维数组；
 * - 黑子、白子和占用状态分别维护 Uint32Array 位图；
 * - 置换表使用双 32 位 Zobrist 哈希和数字键，减少字符串分配；
 * - 评估使用预计算的三进制局部棋型表，避免频繁创建字符串。
 *
 * 页面仍保留 js/ai.js 作为兼容回退；该文件只在 Worker 中执行，不改变对局数据格式。
 */
(function exposeFastAi(root) {
  'use strict';

  const SCORE = Object.freeze({
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
  const DIRECTIONS = Object.freeze([
    [0, 1],
    [1, 0],
    [1, 1],
    [1, -1]
  ]);
  const LOCAL_LINE_LENGTH = 11;
  const LOCAL_LINE_CODE_COUNT = 177147; // 3^11
  const EMPTY = 0;
  const BLACK = 1;
  const WHITE = 2;
  const MAX_TACTICAL_CANDIDATES = 64;
  const MAX_GLOBAL_STRATEGIC_CANDIDATES = 8;
  const DEFAULT_THREAT_PLY = 10;
  const MATE_DISTANCE = 32;
  const lineStatsCache = new Map();
  const linesCache = new Map();

  const now = () => (typeof performance !== 'undefined' && performance.now)
    ? performance.now()
    : Date.now();

  function isValid(size, r, c) {
    return r >= 0 && r < size && c >= 0 && c < size;
  }

  function patternMatches(values, pattern) {
    if (pattern.length > values.length) return false;
    for (let start = 0; start <= values.length - pattern.length; start++) {
      let matched = true;
      for (let i = 0; i < pattern.length; i++) {
        if (values[start + i] !== pattern[i]) {
          matched = false;
          break;
        }
      }
      if (matched) return true;
    }
    return false;
  }

  function buildLocalLineStats() {
    const stats = {
      five: new Uint8Array(LOCAL_LINE_CODE_COUNT),
      openFour: new Uint8Array(LOCAL_LINE_CODE_COUNT),
      four: new Uint8Array(LOCAL_LINE_CODE_COUNT),
      openThree: new Uint8Array(LOCAL_LINE_CODE_COUNT),
      brokenThree: new Uint8Array(LOCAL_LINE_CODE_COUNT),
      openTwo: new Uint8Array(LOCAL_LINE_CODE_COUNT)
    };
    const values = new Uint8Array(LOCAL_LINE_LENGTH);
    const fourPatterns = [
      [0, 1, 1, 1, 1, 2],
      [2, 1, 1, 1, 1, 0],
      [1, 0, 1, 1, 1],
      [1, 1, 0, 1, 1],
      [1, 1, 1, 0, 1]
    ];
    const openThreePatterns = [
      [0, 1, 1, 1, 0],
      [0, 1, 0, 1, 1, 0],
      [0, 1, 1, 0, 1, 0]
    ];
    const brokenThreePatterns = [
      [0, 0, 1, 1, 1, 0, 0],
      [0, 0, 1, 0, 1, 1, 0],
      [0, 1, 1, 0, 1, 0, 0],
      [0, 1, 0, 1, 1, 0, 0]
    ];

    for (let code = 0; code < LOCAL_LINE_CODE_COUNT; code++) {
      let value = code;
      let longestRun = 0;
      let run = 0;
      for (let i = LOCAL_LINE_LENGTH - 1; i >= 0; i--) {
        values[i] = value % 3;
        value = Math.floor(value / 3);
      }
      for (let i = 0; i < values.length; i++) {
        if (values[i] === 1) {
          run++;
          if (run > longestRun) longestRun = run;
        } else {
          run = 0;
        }
      }
      stats.five[code] = longestRun >= 5 ? 1 : 0;
      stats.openFour[code] = patternMatches(values, [0, 1, 1, 1, 1, 0]) ? 1 : 0;
      let four = 0;
      for (const pattern of fourPatterns) if (patternMatches(values, pattern)) four++;
      stats.four[code] = four > 255 ? 255 : four;
      let openThree = 0;
      for (const pattern of openThreePatterns) if (patternMatches(values, pattern)) openThree++;
      stats.openThree[code] = openThree > 255 ? 255 : openThree;
      let brokenThree = 0;
      for (const pattern of brokenThreePatterns) if (patternMatches(values, pattern)) brokenThree++;
      stats.brokenThree[code] = brokenThree > 255 ? 255 : brokenThree;
      stats.openTwo[code] = patternMatches(values, [0, 1, 1, 0]) ? 1 : 0;
    }
    return stats;
  }

  function getLocalLineStats(size) {
    if (!lineStatsCache.has(size)) lineStatsCache.set(size, buildLocalLineStats());
    return lineStatsCache.get(size);
  }

  function createBoardLines(size) {
    if (linesCache.has(size)) return linesCache.get(size);
    const lines = [];
    const addLine = (cells) => { if (cells.length >= 5) lines.push(cells); };

    for (let r = 0; r < size; r++) {
      const row = [];
      for (let c = 0; c < size; c++) row.push(r * size + c);
      addLine(row);
    }
    for (let c = 0; c < size; c++) {
      const column = [];
      for (let r = 0; r < size; r++) column.push(r * size + c);
      addLine(column);
    }
    for (let start = 0; start < size; start++) {
      const downRight = [];
      for (let r = 0, c = start; r < size && c < size; r++, c++) downRight.push(r * size + c);
      addLine(downRight);
    }
    for (let start = 1; start < size; start++) {
      const downRight = [];
      for (let r = start, c = 0; r < size && c < size; r++, c++) downRight.push(r * size + c);
      addLine(downRight);
    }
    for (let start = 0; start < size; start++) {
      const downLeft = [];
      for (let r = 0, c = start; r < size && c >= 0; r++, c--) downLeft.push(r * size + c);
      addLine(downLeft);
    }
    for (let start = 1; start < size; start++) {
      const downLeft = [];
      for (let r = start, c = size - 1; r < size && c >= 0; r++, c--) downLeft.push(r * size + c);
      addLine(downLeft);
    }
    linesCache.set(size, lines);
    return lines;
  }

  function nextRandom(seedState) {
    let seed = seedState.value >>> 0;
    seed = Math.imul(seed ^ (seed >>> 16), 0x21f0aaad);
    seed = Math.imul(seed ^ (seed >>> 15), 0x735a2d97);
    seedState.value = seed >>> 0;
    return (seed ^ (seed >>> 15)) >>> 0;
  }

  class FastPosition {
    constructor(boardInput, size, zobristA, zobristB) {
      this.size = size;
      this.cellCount = size * size;
      this.board = new Uint8Array(this.cellCount);
      const wordCount = Math.ceil(this.cellCount / 32);
      this.occupiedBits = new Uint32Array(wordCount);
      this.blackBits = new Uint32Array(wordCount);
      this.whiteBits = new Uint32Array(wordCount);
      this.zobristA = zobristA;
      this.zobristB = zobristB;
      this.hashA = 0;
      this.hashB = 0;
      this.stones = 0;

      if (boardInput instanceof Uint8Array || ArrayBuffer.isView(boardInput)) {
        for (let i = 0; i < this.cellCount; i++) this.putInitial(i, Number(boardInput[i]) || EMPTY);
      } else if (Array.isArray(boardInput)) {
        for (let r = 0; r < size; r++) {
          const row = Array.isArray(boardInput[r]) ? boardInput[r] : [];
          for (let c = 0; c < size; c++) this.putInitial(r * size + c, Number(row[c]) || EMPTY);
        }
      }
    }

    putInitial(index, color) {
      if (color !== BLACK && color !== WHITE) return;
      this.board[index] = color;
      FastPosition.setBit(this.occupiedBits, index);
      FastPosition.setBit(color === BLACK ? this.blackBits : this.whiteBits, index);
      this.hashA = (this.hashA ^ this.zobristA[index * 3 + color]) >>> 0;
      this.hashB = (this.hashB ^ this.zobristB[index * 3 + color]) >>> 0;
      this.stones++;
    }

    static setBit(bits, index) {
      bits[index >>> 5] |= (1 << (index & 31));
    }

    static clearBit(bits, index) {
      bits[index >>> 5] &= ~(1 << (index & 31));
    }

    static hasBit(bits, index) {
      return (bits[index >>> 5] & (1 << (index & 31))) !== 0;
    }

    isEmpty(index) {
      return !FastPosition.hasBit(this.occupiedBits, index);
    }

    put(index, color) {
      if (!this.isEmpty(index) || (color !== BLACK && color !== WHITE)) return false;
      this.board[index] = color;
      FastPosition.setBit(this.occupiedBits, index);
      FastPosition.setBit(color === BLACK ? this.blackBits : this.whiteBits, index);
      this.hashA = (this.hashA ^ this.zobristA[index * 3 + color]) >>> 0;
      this.hashB = (this.hashB ^ this.zobristB[index * 3 + color]) >>> 0;
      this.stones++;
      return true;
    }

    remove(index, color) {
      if (this.board[index] !== color) return false;
      this.board[index] = EMPTY;
      FastPosition.clearBit(this.occupiedBits, index);
      FastPosition.clearBit(color === BLACK ? this.blackBits : this.whiteBits, index);
      this.hashA = (this.hashA ^ this.zobristA[index * 3 + color]) >>> 0;
      this.hashB = (this.hashB ^ this.zobristB[index * 3 + color]) >>> 0;
      this.stones--;
      return true;
    }
  }

  class GomokuFastAI {
    static ensureZobrist(size) {
      if (this.zobristSize === size && this.zobristA && this.zobristB) return;
      const length = size * size * 3;
      const tableA = new Uint32Array(length);
      const tableB = new Uint32Array(length);
      const state = { value: 0x9e3779b9 };
      for (let i = 0; i < length; i++) {
        tableA[i] = nextRandom(state);
        tableB[i] = nextRandom(state);
      }
      this.zobristSize = size;
      this.zobristA = tableA;
      this.zobristB = tableB;
    }

    static getBestMove(boardInput, aiColor = WHITE, difficulty = 'master', enableFoul = false, forbiddenPoints = [], options = {}) {
      const size = Number(options.size) > 4 ? Number(options.size) : 15;
      this.ensureZobrist(size);
      const position = new FastPosition(boardInput, size, this.zobristA, this.zobristB);
      const opponent = aiColor === BLACK ? WHITE : BLACK;
      const budgetMs = Number(options.budgetMs) > 0 ? Number(options.budgetMs) : 520;
      const startedAt = now();
      const deadline = startedAt + budgetMs;
      const forbidden = new Uint8Array(size * size);
      for (const point of Array.isArray(forbiddenPoints) ? forbiddenPoints : []) {
        const r = Number(point && point.r);
        const c = Number(point && point.c);
        if (Number.isInteger(r) && Number.isInteger(c) && isValid(size, r, c)) forbidden[r * size + c] = 1;
      }

      const rootLimit = Number(options.rootLimit) > 0 ? Number(options.rootLimit) : 22;
      const candidateLimit = Number(options.candidateLimit) > 0
        ? Number(options.candidateLimit)
        : Math.max(64, rootLimit * 3);
      const legal = this.getCandidateMoves(position, aiColor, enableFoul, forbidden, candidateLimit);
      if (!legal.length) return this.findFirstEmpty(position, forbidden);
      if (position.stones === 0) return this.toMove(this.centerIndex(size));

      // 1. 直接成五：必须扫描完整的候选池，不能让排序截断漏掉唯一杀点。
      const ownWins = this.getWinningMoves(position, aiColor, enableFoul, position.cellCount, forbidden);
      if (ownWins.length) return this.toMove(ownWins[0].index);

      // 2. 对方只有一个立即胜点时强制封堵；若对方有多个胜点，
      // 不再盲目返回第一个封堵点，而是交给后续搜索选择反击价值最高的着法。
      const opponentWins = this.getWinningMoves(position, opponent, enableFoul, position.cellCount, forbidden);
      if (opponentWins.length === 1) {
        const block = opponentWins[0];
        if (!forbidden[block.index] && !this.isForbiddenMove(position, block.index, aiColor, forbidden)) {
          return this.toMove(block.index);
        }
      }

      if (difficulty === 'master' || difficulty === 'hard' || difficulty === 'ultimate') {
        // 3. 在普通搜索前做一次有限威胁空间证明：双杀点、单杀点后再杀，
        // 这些局面不应该交给静态评分猜测。
        const forcing = this.findThreatSpaceMove(
          position,
          aiColor,
          legal,
          enableFoul,
          forbidden,
          {
            deadline,
            maxPly: Number(options.threatPly) > 0 ? Number(options.threatPly) : DEFAULT_THREAT_PLY
          }
        );
        if (forcing) return this.toMove(forcing.index);
      }
      if (difficulty === 'easy') return this.toMove(this.pickGreedy(position, aiColor, legal, 1.0).index);
      if (difficulty === 'medium') return this.toMove(this.pickGreedy(position, aiColor, legal, 1.05).index);

      // 4. 大师模式：更宽的候选池 + 迭代加深 + 威胁延伸。
      // 时间预算由页面按设备传入；这里的默认值只用于独立 Node/Worker 调用。
      const maxDepth = Number(options.maxDepth) > 0 ? Number(options.maxDepth) : 7;
      const rootCandidates = this.getRootCandidates(
        position,
        aiColor,
        opponent,
        legal,
        enableFoul,
        forbidden,
        rootLimit,
        candidateLimit
      );
      const context = {
        aiColor,
        opponent,
        enableFoul,
        forbidden,
        deadline,
        table: new Map(),
        nodes: 0,
        completedDepth: 0,
        rootMove: null,
        killers: [],
        history: new Map()
      };
      let best = rootCandidates[0];
      let bestScore = -Infinity;
      for (let depth = 1; depth <= maxDepth; depth++) {
        // 每一轮迭代都重新分配战术叶节点预算，避免浅层搜索耗尽预算后，
        // 深层反而退化成没有直接杀点识别的纯静态评分。
        context.tacticalLeaves = 0;
        const orderedRoot = this.orderMoves(rootCandidates, context, 0, context.rootMove);
        const result = this.searchRoot(position, orderedRoot, depth, context);
        if (result.aborted) break;
        if (result.move) {
          best = result.move;
          bestScore = result.score;
          context.rootMove = result.move.index;
        }
        context.completedDepth = depth;
        if (result.score >= SCORE.WIN - 1000) break;
      }
      return {
        ...this.toMove(best.index),
        score: Number.isFinite(bestScore) ? bestScore : (Number.isFinite(best.score) ? best.score : 0),
        nodes: context.nodes,
        depth: context.completedDepth,
        elapsedMs: Math.round(now() - startedAt)
      };
    }

    static centerIndex(size) {
      const center = Math.floor(size / 2);
      return center * size + center;
    }

    static toMove(index) {
      return { r: Math.floor(index / this.zobristSize), c: index % this.zobristSize };
    }

    static findFirstEmpty(position, forbidden) {
      for (let index = 0; index < position.cellCount; index++) {
        if (position.isEmpty(index) && !forbidden[index]) return this.toMove(index);
      }
      return null;
    }

    static isNearStone(position, index, radius = 2) {
      const r = Math.floor(index / position.size);
      const c = index % position.size;
      for (let dr = -radius; dr <= radius; dr++) {
        for (let dc = -radius; dc <= radius; dc++) {
          if (dr === 0 && dc === 0) continue;
          const nr = r + dr;
          const nc = c + dc;
          if (isValid(position.size, nr, nc) && !position.isEmpty(nr * position.size + nc)) return true;
        }
      }
      return false;
    }

    static positionValue(r, c, size) {
      const center = (size - 1) / 2;
      return Math.max(0, size * 2 - Math.abs(r - center) - Math.abs(c - center));
    }

    static getGlobalStrategicMoves(position, color, opponent, enableFoul = false, forbidden = null, limit = MAX_GLOBAL_STRATEGIC_CANDIDATES) {
      const center = Math.floor(position.size / 2);
      const points = [];
      const seen = new Set();
      const addPoint = (r, c) => {
        if (!isValid(position.size, r, c)) return;
        const index = r * position.size + c;
        if (seen.has(index) || !position.isEmpty(index) || (forbidden && forbidden[index])) return;
        if (enableFoul && this.isForbiddenMove(position, index, color, forbidden)) return;
        seen.add(index);
        points.push({ index, r, c, score: this.positionValue(r, c, position.size) });
      };

      // 固定的中心环和稀疏全盘锚点，让安静局面不会永远被限制在已有棋子两格内。
      addPoint(center, center);
      for (const offset of [2, 3, 5, 7]) {
        addPoint(center - offset, center);
        addPoint(center + offset, center);
        addPoint(center, center - offset);
        addPoint(center, center + offset);
        addPoint(center - offset, center - offset);
        addPoint(center - offset, center + offset);
        addPoint(center + offset, center - offset);
        addPoint(center + offset, center + offset);
      }
      const step = Math.max(2, Math.floor(position.size / 4));
      for (let r = 1; r < position.size; r += step) {
        for (let c = 1; c < position.size; c += step) addPoint(r, c);
      }

      points.sort((a, b) => b.score - a.score || a.r - b.r || a.c - b.c);
      return points.slice(0, Math.max(1, Number(limit) || MAX_GLOBAL_STRATEGIC_CANDIDATES)).map(point => {
        const own = this.analyzeMove(position, point.index, color);
        const opp = this.analyzeMove(position, point.index, opponent);
        return {
          index: point.index,
          r: point.r,
          c: point.c,
          own,
          opp,
          tactical: Boolean(own.five || opp.five || own.openFour || opp.openFour || own.four || opp.four || own.openThree || opp.openThree || own.brokenThree || opp.brokenThree),
          score: this.moveOrderingScore(own, opp) + point.score
        };
      });
    }

    static getCandidateMoves(position, color, enableFoul = false, forbidden = null, limit = 24) {
      if (position.stones === 0) {
        const center = this.centerIndex(position.size);
        return (!forbidden || !forbidden[center]) ? [{ index: center, score: 0 }] : [];
      }
      const raw = [];
      const opponent = color === BLACK ? WHITE : BLACK;
      const center = Math.floor(position.size / 2);
      const nearRadius = position.stones <= 12 ? 3 : 2;
      for (let index = 0; index < position.cellCount; index++) {
        const r = Math.floor(index / position.size);
        const c = index % position.size;
        // 开局若对手落在角落，单纯的“邻近两格”候选会把中心战略完全裁掉；
        // 前四手同时保留中心 7×7，普通局面则扩大到三格邻域。
        const openingAnchor = position.stones <= 4 && Math.abs(r - center) <= 3 && Math.abs(c - center) <= 3;
        if (!position.isEmpty(index) || (forbidden && forbidden[index]) ||
          (!openingAnchor && !this.isNearStone(position, index, nearRadius))) continue;
        if (enableFoul && this.isForbiddenMove(position, index, color, forbidden)) continue;
        const own = this.analyzeMove(position, index, color);
        const opp = this.analyzeMove(position, index, opponent);
        const tactical = own.five || opp.five || own.openFour || opp.openFour ||
          own.four || opp.four || own.openThree || opp.openThree ||
          own.brokenThree || opp.brokenThree ||
          (own.four && own.openThree) || (opp.four && opp.openThree);
        raw.push({
          index,
          r,
          c,
          own,
          opp,
          tactical: Boolean(tactical),
          score: this.moveOrderingScore(own, opp) + this.positionValue(r, c, position.size)
        });
      }
      if (!raw.length) {
        for (let index = 0; index < position.cellCount; index++) {
          if (position.isEmpty(index) && (!forbidden || !forbidden[index]) && (!enableFoul || !this.isForbiddenMove(position, index, color, forbidden))) {
            const r = Math.floor(index / position.size);
            const c = index % position.size;
            raw.push({ index, r, c, own: null, opp: null, tactical: false, score: this.positionValue(r, c, position.size) });
          }
        }
      }
      raw.sort((a, b) => b.score - a.score || Number(b.tactical) - Number(a.tactical) || a.r - b.r || a.c - b.c);

      // 截断只用于控制普通搜索分支数；所有直接杀点、必防点和明显双威胁
      // 都必须保留，否则“看起来很快”的 AI 会在唯一防守点之外随便落子。
      const requested = Math.max(1, Number(limit) || 24);
      const selected = raw.slice(0, requested);
      const selectedIndexes = new Set(selected.map(move => move.index));
      let tacticalCount = 0;
      for (const move of raw) {
        if (!move.tactical || selectedIndexes.has(move.index)) continue;
        selected.push(move);
        selectedIndexes.add(move.index);
        tacticalCount++;
        if (tacticalCount >= MAX_TACTICAL_CANDIDATES) break;
      }

      const globalLimit = position.stones <= 8
        ? MAX_GLOBAL_STRATEGIC_CANDIDATES
        : Math.max(3, Math.floor(MAX_GLOBAL_STRATEGIC_CANDIDATES / 2));
      for (const move of this.getGlobalStrategicMoves(position, color, opponent, enableFoul, forbidden, globalLimit)) {
        if (selectedIndexes.has(move.index)) continue;
        selected.push(move);
        selectedIndexes.add(move.index);
      }
      return selected;
    }

    static getRootCandidates(position, color, opponent, legal, enableFoul = false, forbidden = null, rootLimit = 22, candidateLimit = 64) {
      const selected = new Map();
      const add = (index, source = null) => {
        if (!Number.isInteger(index) || index < 0 || index >= position.cellCount || !position.isEmpty(index)) return;
        if (forbidden && forbidden[index]) return;
        if (enableFoul && this.isForbiddenMove(position, index, color, forbidden)) return;
        if (selected.has(index)) return;
        const r = Math.floor(index / position.size);
        const c = index % position.size;
        const own = this.analyzeMove(position, index, color);
        const opp = this.analyzeMove(position, index, opponent);
        selected.set(index, {
          index,
          r,
          c,
          own,
          opp,
          tactical: Boolean(own.five || opp.five || own.openFour || opp.openFour || own.four || opp.four || own.openThree || opp.openThree || own.brokenThree || opp.brokenThree),
          score: source && Number.isFinite(source.score)
            ? source.score
            : this.moveOrderingScore(own, opp) + this.positionValue(r, c, position.size)
        });
      };

      for (const move of (legal || []).slice(0, Math.max(1, Number(rootLimit) || 22))) add(move.index, move);

      // 这些着法即使在排序末尾，也必须进入根搜索：多重必防点不能只取第一个，
      // 明显双杀/冲四也不能因为 rootLimit 太小而被裁掉。
      const tacticalPool = this.getCandidateMoves(
        position,
        color,
        enableFoul,
        forbidden,
        Math.max(Number(candidateLimit) || 64, MAX_TACTICAL_CANDIDATES)
      );
      for (const move of tacticalPool) {
        if (move.tactical) add(move.index, move);
      }
      const opponentWins = this.getWinningMoves(position, opponent, enableFoul, position.cellCount, forbidden);
      for (const move of opponentWins) add(move.index, move);

      const result = Array.from(selected.values());
      result.sort((a, b) => Number(b.tactical) - Number(a.tactical) || b.score - a.score || a.r - b.r || a.c - b.c);
      return result.length ? result : (legal && legal[0] ? [legal[0]] : []);
    }

    static isForbiddenMove(position, index, color, forbidden) {
      if (forbidden && forbidden[index]) return true;
      if (color !== BLACK) return false;
      if (!position.put(index, color)) return true;
      const exactFive = this.hasFive(position, index, color) && !this.hasOverline(position, index, color);
      const overline = this.hasOverline(position, index, color);
      position.remove(index, color);
      if (overline) return true;
      if (exactFive) return false;
      const pattern = this.analyzeMove(position, index, color);
      return pattern.four >= 2 || pattern.openThree >= 2;
    }

    static moveOrderingScore(own, opp) {
      if (own.five) return SCORE.WIN;
      if (opp.five) return SCORE.WIN * 0.92;
      if (own.openFour) return SCORE.OPEN_FOUR;
      if (opp.openFour) return SCORE.OPEN_FOUR * 0.9;
      if (own.four >= 2) return SCORE.FOUR * 7;
      if (opp.four >= 2) return SCORE.FOUR * 6.5;
      if (own.four && own.openThree) return SCORE.FOUR * 5;
      if (opp.four && opp.openThree) return SCORE.FOUR * 4.5;
      if (own.openThree >= 2) return SCORE.DOUBLE_THREE;
      if (opp.openThree >= 2) return SCORE.DOUBLE_THREE * 0.92;
      return own.score * 1.18 + opp.score * 1.08;
    }

    static lineCode(position, index, color, dr, dc) {
      const r = Math.floor(index / position.size);
      const c = index % position.size;
      let code = 0;
      for (let offset = -5; offset <= 5; offset++) {
        const nr = r + offset * dr;
        const nc = c + offset * dc;
        let value = 2;
        if (offset === 0) value = 1;
        else if (isValid(position.size, nr, nc)) {
          const cell = position.board[nr * position.size + nc];
          value = cell === EMPTY ? 0 : (cell === color ? 1 : 2);
        }
        code = code * 3 + value;
      }
      return code;
    }

    static analyzeMove(position, index, color) {
      if (index < 0 || index >= position.cellCount || !position.isEmpty(index)) {
        return { five: 0, openFour: 0, four: 0, openThree: 0, brokenThree: 0, openTwo: 0, score: -Infinity };
      }
      const stats = getLocalLineStats(position.size);
      let five = 0;
      let openFour = 0;
      let four = 0;
      let openThree = 0;
      let brokenThree = 0;
      let openTwo = 0;
      for (const [dr, dc] of DIRECTIONS) {
        const code = this.lineCode(position, index, color, dr, dc);
        five += stats.five[code];
        openFour += stats.openFour[code];
        four += stats.four[code];
        openThree += stats.openThree[code];
        brokenThree += stats.brokenThree[code];
        openTwo += stats.openTwo[code];
      }
      const score = five ? SCORE.WIN :
        openFour ? SCORE.OPEN_FOUR :
        four >= 2 ? SCORE.FOUR * 7 :
        four && openThree ? SCORE.FOUR * 5 :
        openThree >= 2 ? SCORE.DOUBLE_THREE :
        four ? SCORE.FOUR :
        openThree ? SCORE.OPEN_THREE :
        brokenThree ? SCORE.BROKEN_THREE :
        openTwo ? SCORE.OPEN_TWO : SCORE.ONE;
      return { five, openFour, four, openThree, brokenThree, openTwo, score };
    }

    static countDirection(position, index, dr, dc, color) {
      let r = Math.floor(index / position.size) + dr;
      let c = index % position.size + dc;
      let count = 0;
      while (isValid(position.size, r, c) && position.board[r * position.size + c] === color) {
        count++;
        r += dr;
        c += dc;
      }
      return count;
    }

    static hasFive(position, index, color) {
      for (const [dr, dc] of DIRECTIONS) {
        const count = 1 + this.countDirection(position, index, dr, dc, color) + this.countDirection(position, index, -dr, -dc, color);
        if (count >= 5) return true;
      }
      return false;
    }

    static hasOverline(position, index, color) {
      for (const [dr, dc] of DIRECTIONS) {
        const count = 1 + this.countDirection(position, index, dr, dc, color) + this.countDirection(position, index, -dr, -dc, color);
        if (count > 5) return true;
      }
      return false;
    }

    static isWinningMove(position, index, color) {
      if (!position.put(index, color)) return false;
      const won = this.hasFive(position, index, color);
      position.remove(index, color);
      return won;
    }

    static getWinningMoves(position, color, enableFoul = false, limit = 64, forbidden = null) {
      const candidates = this.getCandidateMoves(position, color, enableFoul, forbidden, limit);
      return candidates.filter(move => this.isWinningMove(position, move.index, color));
    }

    static findDoubleThreat(position, color, candidates, enableFoul, forbidden = null) {
      return this.findThreatSpaceMove(position, color, candidates, enableFoul, forbidden, { maxPly: 4 });
    }

    /**
     * 强制着法候选只保留会制造真实威胁的点；候选池本身仍由
     * getCandidateMoves 负责扩大和排序，避免威胁搜索变成全盘暴力枚举。
     */
    static getForcingCandidates(position, color, enableFoul = false, forbidden = null, limit = MAX_TACTICAL_CANDIDATES) {
      const requested = Math.max(MAX_TACTICAL_CANDIDATES, Number(limit) || MAX_TACTICAL_CANDIDATES);
      const candidates = this.getCandidateMoves(position, color, enableFoul, forbidden, requested);
      return candidates
        .filter(move => move && move.tactical)
        .sort((a, b) => b.score - a.score || a.r - b.r || a.c - b.c)
        .slice(0, MAX_TACTICAL_CANDIDATES);
    }

    static findForcingMove(position, color, candidates, enableFoul, forbidden = null) {
      return this.findThreatSpaceMove(position, color, candidates, enableFoul, forbidden, { maxPly: 4 });
    }

    /**
     * 递归威胁空间搜索：
     *   - 冲四/断四等着法若制造两个直接胜点，立即判定为双杀；
     *   - 若只有一个胜点，对手必须走唯一应手，再递归检查下一轮强制着；
     *   - 对手在应手前已有直接胜点时，该进攻线无效；
     *   - 超时只返回 unknown，绝不把未证明的猜测当成必胜。
     */
    static findThreatSpaceMove(position, color, candidates, enableFoul, forbidden = null, options = {}) {
      const deadline = Number.isFinite(Number(options.deadline))
        ? Number(options.deadline)
        : (Number(options.budgetMs) > 0 ? now() + Number(options.budgetMs) : Infinity);
      const maxPly = Math.max(1, Number(options.maxPly) || DEFAULT_THREAT_PLY);
      const rootMap = new Map();
      const addRoot = (move) => {
        if (!move || !Number.isInteger(move.index) || rootMap.has(move.index)) return;
        if (!position.isEmpty(move.index) || (forbidden && forbidden[move.index])) return;
        if (enableFoul && this.isForbiddenMove(position, move.index, color, forbidden)) return;
        const own = this.analyzeMove(position, move.index, color);
        const opponent = color === BLACK ? WHITE : BLACK;
        const opp = this.analyzeMove(position, move.index, opponent);
        const normalized = {
          index: move.index,
          r: Math.floor(move.index / position.size),
          c: move.index % position.size,
          own,
          opp,
          tactical: Boolean(own.five || opp.five || own.openFour || opp.openFour || own.four || opp.four || own.openThree || opp.openThree || own.brokenThree || opp.brokenThree),
          score: Number.isFinite(move.score) ? move.score : this.moveOrderingScore(own, opp)
        };
        if (normalized.tactical) rootMap.set(normalized.index, normalized);
      };
      for (const move of candidates || []) addRoot(move);
      for (const move of this.getForcingCandidates(position, color, enableFoul, forbidden, MAX_TACTICAL_CANDIDATES)) addRoot(move);

      const context = {
        deadline,
        table: new Map(),
        rootCandidates: Array.from(rootMap.values())
      };
      const result = this.searchThreatSpace(position, color, maxPly, enableFoul, forbidden, context, 0);
      return result.status === 'win' ? result.move : null;
    }

    static searchThreatSpace(position, attacker, remainingPly, enableFoul, forbidden, context, ply) {
      if (Number.isFinite(context.deadline) && now() >= context.deadline) return { status: 'unknown', move: null };
      if (remainingPly <= 0) return { status: 'fail', move: null };

      const key = (
        position.hashA ^
        Math.imul(position.hashB, 0x9e3779b1) ^
        Math.imul(attacker, 0x85ebca6b) ^
        Math.imul(remainingPly, 0xc2b2ae35)
      ) >>> 0;
      const cached = context.table.get(key);
      if (cached && cached.hashA === position.hashA && cached.hashB === position.hashB &&
        cached.attacker === attacker && cached.remainingPly === remainingPly) {
        return { status: cached.status, move: cached.move || null };
      }

      const immediateWins = this.getWinningMoves(position, attacker, enableFoul, position.cellCount, forbidden);
      if (immediateWins.length) {
        return { status: 'win', move: immediateWins[0] };
      }

      const defender = attacker === BLACK ? WHITE : BLACK;
      const candidates = ply === 0 && context.rootCandidates && context.rootCandidates.length
        ? context.rootCandidates
        : this.getForcingCandidates(position, attacker, enableFoul, forbidden, MAX_TACTICAL_CANDIDATES);
      let sawUnknown = false;
      for (const move of candidates) {
        if (Number.isFinite(context.deadline) && now() >= context.deadline) {
          sawUnknown = true;
          break;
        }
        if (!position.put(move.index, attacker)) continue;

        let branchStatus = 'fail';
        if (this.hasFive(position, move.index, attacker)) {
          branchStatus = 'win';
        } else {
          // 对手当前回合能直接获胜时，可以抢先结束这条“进攻线”。
          const opponentWins = this.getWinningMoves(position, defender, enableFoul, position.cellCount, forbidden);
          if (!opponentWins.length) {
            const ownWins = this.getWinningMoves(position, attacker, enableFoul, position.cellCount, forbidden);
            if (ownWins.length >= 2) {
              branchStatus = 'win';
            } else if (ownWins.length === 1) {
              const blockIndex = ownWins[0].index;
              const blockForbidden = (forbidden && forbidden[blockIndex]) ||
                (enableFoul && this.isForbiddenMove(position, blockIndex, defender, forbidden));
              if (blockForbidden || !position.isEmpty(blockIndex)) {
                branchStatus = 'win';
              } else if (remainingPly >= 3 && position.put(blockIndex, defender)) {
                const child = this.searchThreatSpace(
                  position,
                  attacker,
                  remainingPly - 2,
                  enableFoul,
                  forbidden,
                  context,
                  ply + 2
                );
                position.remove(blockIndex, defender);
                if (child.status === 'win') branchStatus = 'win';
                else if (child.status === 'unknown') sawUnknown = true;
              }
            }
          }
        }
        position.remove(move.index, attacker);

        if (branchStatus === 'win') {
          const result = { status: 'win', move };
          context.table.set(key, {
            hashA: position.hashA,
            hashB: position.hashB,
            attacker,
            remainingPly,
            status: 'win',
            move
          });
          return result;
        }
      }

      const status = sawUnknown ? 'unknown' : 'fail';
      if (status === 'fail') {
        context.table.set(key, {
          hashA: position.hashA,
          hashB: position.hashB,
          attacker,
          remainingPly,
          status: 'fail',
          move: null
        });
      }
      return { status, move: null };
    }

    static pickGreedy(position, color, candidates, attackWeight = 1.1) {
      let best = candidates[0];
      let bestScore = -Infinity;
      const opponent = color === BLACK ? WHITE : BLACK;
      for (const move of candidates) {
        const own = this.analyzeMove(position, move.index, color);
        const opp = this.analyzeMove(position, move.index, opponent);
        const score = own.score * attackWeight + opp.score;
        if (score > bestScore) {
          bestScore = score;
          best = move;
        }
      }
      return best;
    }

    static evaluateBoard(position, aiColor, opponent) {
      let aiScore = 0;
      let opponentScore = 0;
      for (const line of createBoardLines(position.size)) {
        aiScore += this.evaluateLine(position.board, line, aiColor);
        opponentScore += this.evaluateLine(position.board, line, opponent);
      }
      let positionScore = 0;
      for (let index = 0; index < position.cellCount; index++) {
        const cell = position.board[index];
        if (cell === EMPTY) continue;
        const r = Math.floor(index / position.size);
        const c = index % position.size;
        positionScore += cell === aiColor
          ? this.positionValue(r, c, position.size)
          : -this.positionValue(r, c, position.size);
      }
      return aiScore - opponentScore * 1.12 + positionScore;
    }

    static evaluateLine(board, line, color) {
      let score = 0;
      for (let i = 0; i < line.length;) {
        if (board[line[i]] !== color) {
          i++;
          continue;
        }
        const start = i;
        while (i < line.length && board[line[i]] === color) i++;
        const length = i - start;
        const openLeft = start > 0 && board[line[start - 1]] === EMPTY;
        const openRight = i < line.length && board[line[i]] === EMPTY;
        const openEnds = (openLeft ? 1 : 0) + (openRight ? 1 : 0);
        if (length >= 5) score += SCORE.WIN;
        else if (length === 4) score += openEnds === 2 ? SCORE.OPEN_FOUR : openEnds ? SCORE.FOUR : 0;
        else if (length === 3) score += openEnds === 2 ? SCORE.OPEN_THREE : openEnds ? SCORE.BROKEN_THREE : 0;
        else if (length === 2) score += openEnds === 2 ? SCORE.OPEN_TWO : openEnds ? SCORE.TWO : 0;
        else if (length === 1 && openEnds === 2) score += SCORE.ONE;
      }

      // 连续棋型之外，专门补偿“断四/断三”。只看连续段会把
      // 1 1 0 1 1 误判成几个普通棋子，导致大师 AI 在关键杀点前贪图假活三。
      // 这里仅给非连续窗口加分，避免与上面的连续棋型重复计分。
      const opponent = color === BLACK ? WHITE : BLACK;
      for (let start = 0; start <= line.length - 5; start++) {
        let ownCount = 0;
        let opponentCount = 0;
        let emptyCount = 0;
        let longestRun = 0;
        let run = 0;
        for (let offset = 0; offset < 5; offset++) {
          const cell = board[line[start + offset]];
          if (cell === color) {
            ownCount++;
            run++;
            if (run > longestRun) longestRun = run;
          } else {
            run = 0;
            if (cell === opponent) opponentCount++;
            else emptyCount++;
          }
        }
        if (opponentCount) continue;
        if (ownCount === 4 && emptyCount === 1 && longestRun < 4) {
          score += SCORE.FOUR * 0.78;
        } else if (ownCount === 3 && emptyCount === 2 && longestRun < 3) {
          score += SCORE.BROKEN_THREE * 0.9;
        } else if (ownCount === 2 && emptyCount === 3 && longestRun < 2) {
          score += SCORE.TWO * 0.55;
        }
      }
      return score;
    }

    static orderMoves(candidates, context, ply = 0, preferredIndex = null) {
      const killers = context && context.killers && context.killers[ply]
        ? context.killers[ply]
        : [];
      const history = context && context.history ? context.history : null;
      return (candidates || []).slice().sort((a, b) => {
        const priority = (move) => {
          if (!move) return -Infinity;
          let value = Number(move.score) || 0;
          if (move.index === preferredIndex) value += SCORE.WIN * 2;
          if (context && ply === 0 && move.index === context.rootMove) value += SCORE.WIN;
          if (killers[0] === move.index) value += SCORE.OPEN_FOUR;
          else if (killers[1] === move.index) value += SCORE.FOUR;
          if (history) value += (history.get(move.index) || 0);
          if (move.own && move.own.five) value += SCORE.WIN;
          if (move.opp && move.opp.five) value += SCORE.WIN * 0.96;
          return value;
        };
        return priority(b) - priority(a) || a.r - b.r || a.c - b.c;
      });
    }

    static evaluateLeaf(position, turnColor, context, ply) {
      const base = this.evaluateBoard(position, context.aiColor, context.opponent);
      // 叶节点做有限战术延伸：静态评分看不出“下一手就能赢”，
      // 这是普通 Alpha-Beta 在五子棋中最容易出现的假优势来源。
      context.tacticalLeaves = (context.tacticalLeaves || 0) + 1;
      if (context.tacticalLeaves > (context.tacticalLeafLimit || 1800)) return base;

      const currentWins = this.getWinningMoves(
        position,
        turnColor,
        context.enableFoul,
        position.cellCount,
        context.forbidden
      );
      const mate = SCORE.WIN - ply * MATE_DISTANCE;
      if (currentWins.length) return turnColor === context.aiColor ? mate : -mate;

      const otherColor = turnColor === BLACK ? WHITE : BLACK;
      const otherWins = this.getWinningMoves(
        position,
        otherColor,
        context.enableFoul,
        position.cellCount,
        context.forbidden
      );
      if (otherWins.length >= 2) return otherColor === context.aiColor ? mate : -mate;
      if (otherWins.length === 1) {
        const threat = SCORE.FOUR * 0.92;
        return base + (otherColor === context.aiColor ? threat : -threat);
      }
      return base;
    }

    static searchRoot(position, candidates, depth, context) {
      let bestMove = null;
      let bestScore = -Infinity;
      let alpha = -Infinity;
      for (const move of candidates) {
        if (now() >= context.deadline) return { aborted: true };
        if (!position.put(move.index, context.aiColor)) continue;
        let score;
        if (this.hasFive(position, move.index, context.aiColor)) {
          score = SCORE.WIN - MATE_DISTANCE;
        } else {
          const child = this.search(position, depth - 1, alpha, Infinity, context.opponent, context, 1);
          if (child.aborted) {
            position.remove(move.index, context.aiColor);
            return child;
          }
          score = child.score;
        }
        position.remove(move.index, context.aiColor);
        if (score > bestScore) {
          bestScore = score;
          bestMove = move;
        }
        alpha = Math.max(alpha, bestScore);
      }
      return { move: bestMove, score: bestScore, aborted: false };
    }

    static search(position, depth, alpha, beta, turnColor, context, ply) {
      context.nodes++;
      if (now() >= context.deadline) return { score: 0, aborted: true };
      if (depth <= 0) return { score: this.evaluateLeaf(position, turnColor, context, ply), aborted: false };

      const alphaStart = alpha;
      const betaStart = beta;

      const key = (
        position.hashA ^
        Math.imul(position.hashB, 0x9e3779b1) ^
        Math.imul(turnColor, 0x85ebca6b)
      ) >>> 0;
      const cached = context.table.get(key);
      if (cached && cached.hashA === position.hashA && cached.hashB === position.hashB && cached.turn === turnColor && cached.depth >= depth) {
        if (!cached.bound || cached.bound === 'EXACT') {
          return { score: cached.score, move: cached.move, aborted: false };
        }
        if (cached.bound === 'LOWER') alpha = Math.max(alpha, cached.score);
        else if (cached.bound === 'UPPER') beta = Math.min(beta, cached.score);
        if (alpha >= beta) return { score: cached.score, move: cached.move, aborted: false };
      }

      const maximizing = turnColor === context.aiColor;
      const candidates = this.getCandidateMoves(
        position,
        turnColor,
        context.enableFoul,
        context.forbidden,
        depth >= 4 ? 12 : depth >= 2 ? 18 : 24
      );
      const orderedCandidates = this.orderMoves(candidates, context, ply, cached && cached.move ? cached.move.index : null);
      if (!orderedCandidates.length) return { score: 0, aborted: false };
      let bestScore = maximizing ? -Infinity : Infinity;
      let bestMove = null;
      let cutoff = false;
      for (const move of orderedCandidates) {
        if (now() >= context.deadline) return { score: 0, aborted: true };
        if (!position.put(move.index, turnColor)) continue;
        let score;
        if (this.hasFive(position, move.index, turnColor)) {
          score = maximizing ? SCORE.WIN - ply * MATE_DISTANCE : -SCORE.WIN + ply * MATE_DISTANCE;
        } else {
          const child = this.search(position, depth - 1, alpha, beta, turnColor === BLACK ? WHITE : BLACK, context, ply + 1);
          if (child.aborted) {
            position.remove(move.index, turnColor);
            return child;
          }
          score = child.score;
        }
        position.remove(move.index, turnColor);
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
      const bound = bestScore <= alphaStart
        ? 'UPPER'
        : bestScore >= betaStart
          ? 'LOWER'
          : 'EXACT';
      const previous = context.table.get(key);
      if (!previous || previous.depth <= depth) {
        context.table.set(key, {
          hashA: position.hashA,
          hashB: position.hashB,
          turn: turnColor,
          depth,
          score: bestScore,
          move: bestMove,
          bound
        });
      }
      if (cutoff && bestMove) {
        const killers = context.killers[ply] || [];
        if (killers[0] !== bestMove.index) {
          context.killers[ply] = [bestMove.index, killers[0]].filter(index => Number.isInteger(index)).slice(0, 2);
        }
        context.history.set(
          bestMove.index,
          (context.history.get(bestMove.index) || 0) + depth * depth * 64
        );
      }
      return { score: bestScore, move: bestMove, aborted: false };
    }
  }

  if (root) root.GomokuFastAI = GomokuFastAI;
  if (typeof window !== 'undefined') window.GomokuFastAI = GomokuFastAI;
  if (typeof module !== 'undefined' && module.exports) module.exports = { GomokuFastAI };
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this));
