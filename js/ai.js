/**
 * 五子棋智能 AI 对弈引擎 (Gomoku AI Engine)
 * 支持三种难度模式：简单 (Easy)、中等 (Medium)、大师 (Master - Minimax with Alpha-Beta Pruning)
 */

const SHAPE_SCORE = {
  WIN: 1000000,
  FIVE: 100000,
  OPEN_FOUR: 10000,
  BLOCKED_FOUR: 1200,
  OPEN_THREE: 1000,
  BLOCKED_THREE: 150,
  OPEN_TWO: 100,
  BLOCKED_TWO: 15,
  ONE: 2
};

class GomokuAI {
  /**
   * 计算最佳落子点
   */
  static getBestMove(board, aiColor, difficulty = 'medium', enableFoul = false) {
    const oppColor = aiColor === BLACK ? WHITE : BLACK;
    const candidates = this.getCandidateMoves(board);

    // 如果棋盘为空，首手落天元 (7, 7)
    if (candidates.length === 0) {
      return { r: 7, c: 7 };
    }

    // 只有 1 个候选点
    if (candidates.length === 1) {
      return candidates[0];
    }

    if (difficulty === 'easy') {
      return this.getEasyMove(board, aiColor, oppColor, candidates, enableFoul);
    } else if (difficulty === 'medium') {
      return this.getMediumMove(board, aiColor, oppColor, candidates, enableFoul);
    } else {
      return this.getMasterMove(board, aiColor, oppColor, candidates, enableFoul);
    }
  }

  /**
   * 简单难度：贪心启发式评估，少量随机扰动
   */
  static getEasyMove(board, aiColor, oppColor, candidates, enableFoul) {
    let bestScore = -Infinity;
    let bestMoves = [];

    for (const move of candidates) {
      const { r, c } = move;

      // 禁手过滤
      if (aiColor === BLACK && enableFoul && GomokuRule.checkBlackFoul(board, r, c)) {
        continue;
      }

      // 评估自身进攻得分与防守得分
      const attackScore = this.evaluatePoint(board, r, c, aiColor);
      const defenseScore = this.evaluatePoint(board, r, c, oppColor);
      const totalScore = attackScore * 1.0 + defenseScore * 0.75 + Math.random() * 20;

      if (totalScore > bestScore) {
        bestScore = totalScore;
        bestMoves = [move];
      } else if (Math.abs(totalScore - bestScore) < 5) {
        bestMoves.push(move);
      }
    }

    return bestMoves[Math.floor(Math.random() * bestMoves.length)] || candidates[0];
  }

  /**
   * 中等难度：综合攻防权衡，对必胜/必堵棋型绝对响应
   */
  static getMediumMove(board, aiColor, oppColor, candidates, enableFoul) {
    let bestScore = -Infinity;
    let bestMove = candidates[0];

    for (const move of candidates) {
      const { r, c } = move;

      if (aiColor === BLACK && enableFoul && GomokuRule.checkBlackFoul(board, r, c)) {
        continue;
      }

      const myScore = this.evaluatePoint(board, r, c, aiColor);
      const oppScore = this.evaluatePoint(board, r, c, oppColor);

      // 如果我方能直接连五获胜，直接下！
      if (myScore >= SHAPE_SCORE.FIVE) {
        return move;
      }

      // 如果对方下一步能连五，必须抢先封堵！
      if (oppScore >= SHAPE_SCORE.FIVE) {
        return move;
      }

      // 攻防综合得分
      let total = myScore * 1.1 + oppScore * 1.0;

      if (total > bestScore) {
        bestScore = total;
        bestMove = move;
      }
    }

    return bestMove;
  }

  /**
   * 大师难度：Minimax 深度博弈搜索 + Alpha-Beta 剪枝
   */
  static getMasterMove(board, aiColor, oppColor, candidates, enableFoul) {
    // 快速检查立即获胜或必须防守点
    for (const move of candidates) {
      if (aiColor === BLACK && enableFoul && GomokuRule.checkBlackFoul(board, move.r, move.c)) continue;
      const myScore = this.evaluatePoint(board, move.r, move.c, aiColor);
      if (myScore >= SHAPE_SCORE.FIVE) return move;
    }

    for (const move of candidates) {
      const oppScore = this.evaluatePoint(board, move.r, move.c, oppColor);
      if (oppScore >= SHAPE_SCORE.FIVE) {
        if (aiColor === BLACK && enableFoul && GomokuRule.checkBlackFoul(board, move.r, move.c)) continue;
        return move;
      }
    }

    // 候选点评分排序，截取前 12 个最具价值的落子点进行深入搜索
    const rankedCandidates = this.rankCandidateMoves(board, candidates, aiColor, oppColor, enableFoul).slice(0, 12);

    let bestScore = -Infinity;
    let bestMove = rankedCandidates[0];
    const searchDepth = 4; // 4 层前瞻预测

    for (const move of rankedCandidates) {
      const { r, c } = move;
      board[r][c] = aiColor;

      const score = this.minimax(
        board,
        searchDepth - 1,
        -Infinity,
        Infinity,
        false,
        aiColor,
        oppColor,
        enableFoul
      );

      board[r][c] = EMPTY;

      if (score > bestScore) {
        bestScore = score;
        bestMove = move;
      }
    }

    return bestMove || candidates[0];
  }

  /**
   * Minimax 递归搜索函数
   */
  static minimax(board, depth, alpha, beta, isMaximizing, aiColor, oppColor, enableFoul) {
    const currentColor = isMaximizing ? aiColor : oppColor;
    const previousColor = isMaximizing ? oppColor : aiColor;

    // 终止条件：到达最大深度
    if (depth === 0) {
      return this.evaluateWholeBoard(board, aiColor, oppColor);
    }

    const allCandidates = this.getCandidateMoves(board);
    if (allCandidates.length === 0) return 0;

    const candidates = this.rankCandidateMoves(board, allCandidates, currentColor, previousColor, enableFoul).slice(0, 8);

    if (isMaximizing) {
      let maxEval = -Infinity;
      for (const { r, c } of candidates) {
        if (aiColor === BLACK && enableFoul && GomokuRule.checkBlackFoul(board, r, c)) continue;

        // 若当前点能获胜
        const ptScore = this.evaluatePoint(board, r, c, aiColor);
        if (ptScore >= SHAPE_SCORE.FIVE) return SHAPE_SCORE.WIN + depth * 1000;

        board[r][c] = aiColor;
        const evaluation = this.minimax(board, depth - 1, alpha, beta, false, aiColor, oppColor, enableFoul);
        board[r][c] = EMPTY;

        maxEval = Math.max(maxEval, evaluation);
        alpha = Math.max(alpha, evaluation);
        if (beta <= alpha) break; // Beta 剪枝
      }
      return maxEval === -Infinity ? this.evaluateWholeBoard(board, aiColor, oppColor) : maxEval;
    } else {
      let minEval = Infinity;
      for (const { r, c } of candidates) {
        if (oppColor === BLACK && enableFoul && GomokuRule.checkBlackFoul(board, r, c)) continue;

        const ptScore = this.evaluatePoint(board, r, c, oppColor);
        if (ptScore >= SHAPE_SCORE.FIVE) return -SHAPE_SCORE.WIN - depth * 1000;

        board[r][c] = oppColor;
        const evaluation = this.minimax(board, depth - 1, alpha, beta, true, aiColor, oppColor, enableFoul);
        board[r][c] = EMPTY;

        minEval = Math.min(minEval, evaluation);
        beta = Math.min(beta, evaluation);
        if (beta <= alpha) break; // Alpha 剪枝
      }
      return minEval === Infinity ? this.evaluateWholeBoard(board, aiColor, oppColor) : minEval;
    }
  }

  /**
   * 整盘局面评估函数
   */
  static evaluateWholeBoard(board, aiColor, oppColor) {
    let myTotal = 0;
    let oppTotal = 0;

    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        if (board[r][c] === aiColor) {
          myTotal += this.evaluatePoint(board, r, c, aiColor);
        } else if (board[r][c] === oppColor) {
          oppTotal += this.evaluatePoint(board, r, c, oppColor);
        }
      }
    }

    return myTotal - oppTotal * 1.15;
  }

  /**
   * 候选点排序：综合攻防价值启发式排序
   */
  static rankCandidateMoves(board, candidates, playerColor, oppColor, enableFoul) {
    const scored = candidates.map(move => {
      const { r, c } = move;
      if (playerColor === BLACK && enableFoul && GomokuRule.checkBlackFoul(board, r, c)) {
        return { ...move, score: -999999 };
      }
      const myScore = this.evaluatePoint(board, r, c, playerColor);
      const oppScore = this.evaluatePoint(board, r, c, oppColor);
      return { ...move, score: myScore * 1.1 + oppScore * 1.0 };
    });

    return scored.sort((a, b) => b.score - a.score);
  }

  /**
   * 搜索已有棋子周围 2 格以内的邻近空位作为候选点（大幅缩减搜索空间）
   */
  static getCandidateMoves(board) {
    const visited = Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(false));
    const candidates = [];
    let hasAnyPiece = false;

    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        if (board[r][c] !== EMPTY) {
          hasAnyPiece = true;
          // 扫描周围 2 格距离
          for (let dr = -2; dr <= 2; dr++) {
            for (let dc = -2; dc <= 2; dc++) {
              const nr = r + dr;
              const nc = c + dc;
              if (GomokuRule.isValidCoord(nr, nc) && board[nr][nc] === EMPTY && !visited[nr][nc]) {
                visited[nr][nc] = true;
                candidates.push({ r: nr, c: nc });
              }
            }
          }
        }
      }
    }

    if (!hasAnyPiece) {
      return [{ r: 7, c: 7 }];
    }

    return candidates;
  }

  /**
   * 单点价值评估（4个方向特征匹配）
   */
  static evaluatePoint(board, r, c, color) {
    let totalScore = 0;

    for (const [dr, dc] of DIRECTIONS) {
      totalScore += this.evaluateDirection(board, r, c, dr, dc, color);
    }

    return totalScore;
  }

  /**
   * 单方向棋型评分
   */
  static evaluateDirection(board, r, c, dr, dc, color) {
    let count = 1; // 假定在此落子
    let blockSides = 0; // 被阻挡的端数 (0: 活, 1: 冲/眠, 2: 死)

    // 正向扫描
    let step = 1;
    while (true) {
      const nr = r + step * dr;
      const nc = c + step * dc;
      if (!GomokuRule.isValidCoord(nr, nc)) {
        blockSides++;
        break;
      }
      if (board[nr][nc] === color) {
        count++;
        step++;
      } else if (board[nr][nc] === EMPTY) {
        break; // 开放端
      } else {
        blockSides++; // 对方棋子阻挡
        break;
      }
    }

    // 反向扫描
    step = 1;
    while (true) {
      const nr = r - step * dr;
      const nc = c - step * dc;
      if (!GomokuRule.isValidCoord(nr, nc)) {
        blockSides++;
        break;
      }
      if (board[nr][nc] === color) {
        count++;
        step++;
      } else if (board[nr][nc] === EMPTY) {
        break;
      } else {
        blockSides++;
        break;
      }
    }

    // 两端皆死则无价值
    if (blockSides === 2 && count < 5) return 0;

    // 棋型对应分值映射
    if (count >= 5) return SHAPE_SCORE.FIVE;
    if (count === 4) {
      return blockSides === 0 ? SHAPE_SCORE.OPEN_FOUR : SHAPE_SCORE.BLOCKED_FOUR;
    }
    if (count === 3) {
      return blockSides === 0 ? SHAPE_SCORE.OPEN_THREE : SHAPE_SCORE.BLOCKED_THREE;
    }
    if (count === 2) {
      return blockSides === 0 ? SHAPE_SCORE.OPEN_TWO : SHAPE_SCORE.BLOCKED_TWO;
    }
    if (count === 1) {
      return blockSides === 0 ? SHAPE_SCORE.ONE : 0;
    }

    return 0;
  }
}

window.GomokuAI = GomokuAI;
