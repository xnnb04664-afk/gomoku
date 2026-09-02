/**
 * 五子棋规则判定与棋型检测器 (Gomoku Rule & Foul Checker)
 */
const BOARD_SIZE = 15;
const EMPTY = 0;
const BLACK = 1;
const WHITE = 2;

const DIRECTIONS = [
  [0, 1],   // 水平向右
  [1, 0],   // 垂直向下
  [1, 1],   // 主对角线 (左上到右下)
  [1, -1]   // 副对角线 (右上到左下)
];

class GomokuRule {
  /**
   * 检查给定位置落子后是否达成五连胜利
   * @param {Array<Array<number>>} board 15x15 棋盘
   * @param {number} r 行坐标 (0-14)
   * @param {number} c 列坐标 (0-14)
   * @param {number} player 玩家 (1: 黑, 2: 白)
   * @param {boolean} enableFoul 是否启用禁手
   * @returns {Object|null} 胜利信息或 null
   */
  static checkWin(board, r, c, player, enableFoul = false) {
    if (!this.isValidCoord(r, c) || board[r][c] !== player) return null;

    // 若黑棋开启禁手且存在长连禁手，在 checkFoul 中处理，但若正好是五连，检查是否有五连
    for (const [dr, dc] of DIRECTIONS) {
      const line = this.getContinuousLine(board, r, c, dr, dc, player);
      const count = line.length;

      if (player === BLACK && enableFoul) {
        // 禁手规则下，黑棋必须正好是五连，超过 5 算长连禁手（负）
        if (count === 5) {
          return { won: true, winner: player, line };
        }
      } else {
        // 无禁手或白棋：5 连及以上均算获胜
        if (count >= 5) {
          return { won: true, winner: player, line: line.slice(0, 5) };
        }
      }
    }
    return null;
  }

  /**
   * 检查棋盘是否已满（和棋）
   */
  static checkDraw(board) {
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        if (board[r][c] === EMPTY) return false;
      }
    }
    return true;
  }

  /**
   * 坐标有效性检查
   */
  static isValidCoord(r, c) {
    return r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE;
  }

  /**
   * 获取指定方向上包含 (r, c) 的连续同色棋子坐标数组
   */
  static getContinuousLine(board, r, c, dr, dc, player) {
    const line = [[r, c]];

    // 正向延伸
    let cr = r + dr;
    let cc = c + dc;
    while (this.isValidCoord(cr, cc) && board[cr][cc] === player) {
      line.push([cr, cc]);
      cr += dr;
      cc += dc;
    }

    // 反向延伸
    cr = r - dr;
    cc = c - dc;
    while (this.isValidCoord(cr, cc) && board[cr][cc] === player) {
      line.unshift([cr, cc]);
      cr -= dr;
      cc -= dc;
    }

    return line;
  }

  /**
   * 黑棋禁手综合判定（长连、四四、三三）
   * @param {Array<Array<number>>} board 
   * @param {number} r 
   * @param {number} c 
   * @returns {Object|null} 禁手类型 { isFoul: true, type: 'overline'|'doubleFour'|'doubleThree', msg: string }
   */
  static checkBlackFoul(board, r, c) {
    // 假设在此落子
    board[r][c] = BLACK;

    // 1. 检查是否成五：如果成五连（且非长连），则五连胜优先于四四/三三禁手
    let hasExactFive = false;
    let hasOverline = false;

    for (const [dr, dc] of DIRECTIONS) {
      const line = this.getContinuousLine(board, r, c, dr, dc, BLACK);
      if (line.length === 5) {
        hasExactFive = true;
      } else if (line.length > 5) {
        hasOverline = true;
      }
    }

    // 长连禁手（六子及以上）
    if (hasOverline) {
      board[r][c] = EMPTY;
      return { isFoul: true, type: 'overline', msg: '黑方长连禁手（超过5子连珠）判负！' };
    }

    // 如果正好成五连，直接获胜，不算四四或三三禁手
    if (hasExactFive) {
      board[r][c] = EMPTY;
      return null;
    }

    // 2. 检查四四禁手与三三禁手
    let fourCount = 0;
    let threeCount = 0;

    for (const [dr, dc] of DIRECTIONS) {
      const pattern = this.analyzeLinePattern(board, r, c, dr, dc, BLACK);
      if (pattern.fours > 0) {
        fourCount += pattern.fours;
      }
      if (pattern.openThrees > 0) {
        threeCount += pattern.openThrees;
      }
    }

    board[r][c] = EMPTY; // 还原

    if (fourCount >= 2) {
      return { isFoul: true, type: 'doubleFour', msg: '黑方四四禁手（同时形成两个或以上四）判负！' };
    }

    if (threeCount >= 2) {
      return { isFoul: true, type: 'doubleThree', msg: '黑方三三禁手（同时形成两个或以上活三）判负！' };
    }

    return null;
  }

  /**
   * 分析指定点在某一方向上线段的局部棋型（用于禁手分析）
   */
  static analyzeLinePattern(board, r, c, dr, dc, player) {
    let fours = 0;
    let openThrees = 0;

    // 提取以 (r, c) 为中心前后 4 步的序列，共 9 格
    const seq = [];
    const positions = [];
    for (let i = -4; i <= 4; i++) {
      const nr = r + i * dr;
      const nc = c + i * dc;
      if (this.isValidCoord(nr, nc)) {
        seq.push(board[nr][nc]);
        positions.push([nr, nc]);
      } else {
        seq.push(-1); // 边界外
        positions.push(null);
      }
    }

    // 检查在这个方向是否能形成活四或冲四
    // 简化但标准的检测：落子点所在的连续棋子群
    const centerIdx = 4;
    // 检查在 5 格窗口中是否有 4 颗黑子与 1 个空位
    for (let start = 0; start <= 4; start++) {
      let pCount = 0;
      let emptyIdx = -1;
      let valid = true;

      for (let offset = 0; offset < 5; offset++) {
        const val = seq[start + offset];
        if (val === player) {
          pCount++;
        } else if (val === EMPTY) {
          if (emptyIdx === -1) emptyIdx = start + offset;
          else { valid = false; break; } // 多于一个空位
        } else {
          valid = false;
          break; // 遇到对方棋子或边界
        }
      }

      // 如果正好 4 颗子且包含中心落子
      if (valid && pCount === 4 && (start <= centerIdx && centerIdx < start + 5)) {
        fours++;
      }
    }

    // 检查是否能构成活三 (两端畅通的活三)
    // 常见活三模式：01110, 010110, 011010
    const strSeq = seq.map(v => (v === -1 ? 'X' : (v === EMPTY ? '0' : (v === BLACK ? '1' : '2')))).join('');
    
    // 经典活三正则
    const openThreePatterns = [
      /01110/g,
      /010110/g,
      /011010/g
    ];

    for (const pat of openThreePatterns) {
      let match;
      while ((match = pat.exec(strSeq)) !== null) {
        const matchStart = match.index;
        const matchEnd = matchStart + match[0].length;
        if (centerIdx >= matchStart && centerIdx < matchEnd) {
          openThrees++;
        }
      }
    }

    return { fours: Math.min(fours, 2), openThrees: Math.min(openThrees, 1) };
  }
}

window.GomokuRule = GomokuRule;
