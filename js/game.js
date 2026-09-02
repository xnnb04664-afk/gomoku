/**
 * 五子棋游戏核心状态机与流程控制 (Gomoku Game State Controller)
 */
class GomokuGame {
  constructor(boardRenderer) {
    this.boardRenderer = boardRenderer;

    // 基础配置
    this.mode = 'pve'; // 'pve' (人机) | 'pvp' (双人本地) | 'online' (双人联机)
    this.difficulty = 'medium'; // 'easy' | 'medium' | 'master'
    this.enableFoul = false; // 是否启用禁手
    this.playerColor = BLACK; // 人机/联机模式下本地玩家执子 (BLACK / WHITE)

    // 运行状态
    this.board = [];
    this.currentTurn = BLACK;
    this.isGameOver = false;
    this.history = []; // 落子历史 [{r, c, player}]
    this.winningInfo = null;
    this.hintMove = null;

    // 计时器相关
    this.timer = null;
    this.blackTime = 0; // 秒
    this.whiteTime = 0; // 秒
    this.moveCount = 0;

    // 统计数据
    this.stats = this.loadStats();

    // 回调通知
    this.onStateChange = null;
    this.onGameOver = null;
    this.onOnlineMove = null; // (move: { r, c, player }) => void

    this.reset();
  }

  /**
   * 重置/新开一局游戏
   */
  reset() {
    this.stopTimer();
    this.board = Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(EMPTY));
    this.currentTurn = BLACK;
    this.isGameOver = false;
    this.history = [];
    this.winningInfo = null;
    this.hintMove = null;
    this.blackTime = 0;
    this.whiteTime = 0;
    this.moveCount = 0;

    this.startTimer();
    this.updateUI();

    // 如果是人机模式且 AI 执黑，AI 先手走第一步 (天元)
    if (this.mode === 'pve' && this.playerColor === WHITE) {
      setTimeout(() => this.makeAIMove(), 400);
    }
  }

  /**
   * 本地玩家尝试落子
   */
  handleCellClick(r, c) {
    if (this.isGameOver) return false;

    // 人机模式下非玩家回合不可落子
    if (this.mode === 'pve' && this.currentTurn !== this.playerColor) {
      return false;
    }

    // 联机模式下非自己回合不可落子
    if (this.mode === 'online' && this.currentTurn !== this.playerColor) {
      return false;
    }

    if (!GomokuRule.isValidCoord(r, c) || this.board[r][c] !== EMPTY) {
      return false;
    }

    // 禁手检测 (黑棋且开启禁手)
    if (this.currentTurn === BLACK && this.enableFoul) {
      const foul = GomokuRule.checkBlackFoul(this.board, r, c);
      if (foul && foul.isFoul) {
        window.soundEffects.playAlertSound();
        this.board[r][c] = BLACK;
        this.history.push({ r, c, player: BLACK });
        this.isGameOver = true;
        this.stopTimer();
        this.updateUI();

        if (this.mode === 'online' && this.onOnlineMove) {
          this.onOnlineMove({ r, c, player: BLACK, foul: true });
        }

        if (this.onGameOver) {
          this.onGameOver({
            winner: WHITE,
            reason: foul.msg,
            isFoul: true
          });
        }
        return true;
      }
    }

    const player = this.currentTurn;
    // 执行本地落子
    this.executeMove(r, c, player);

    // 联机模式下发送落子给对手
    if (this.mode === 'online' && this.onOnlineMove) {
      this.onOnlineMove({ r, c, player });
    }

    // 人机模式下触发 AI
    if (!this.isGameOver && this.mode === 'pve' && this.currentTurn !== this.playerColor) {
      setTimeout(() => this.makeAIMove(), 250);
    }

    return true;
  }

  /**
   * 处理对手通过网络发来的落子
   */
  handleRemoteMove(r, c, player, foul = false) {
    if (this.isGameOver) return;
    if (!GomokuRule.isValidCoord(r, c) || this.board[r][c] !== EMPTY) return;

    if (foul) {
      window.soundEffects.playAlertSound();
      this.board[r][c] = player;
      this.history.push({ r, c, player });
      this.isGameOver = true;
      this.stopTimer();
      this.updateUI();

      if (this.onGameOver) {
        this.onGameOver({
          winner: player === BLACK ? WHITE : BLACK,
          reason: '对手触发禁手判负！',
          isFoul: true
        });
      }
      return;
    }

    this.executeMove(r, c, player);
  }

  /**
   * 执行落子逻辑
   */
  executeMove(r, c, player) {
    this.board[r][c] = player;
    this.history.push({ r, c, player });
    this.moveCount++;
    this.hintMove = null; // 清除提示

    window.soundEffects.playPieceSound();

    // 胜负判定
    const winResult = GomokuRule.checkWin(this.board, r, c, player, this.enableFoul);
    if (winResult && winResult.won) {
      this.isGameOver = true;
      this.winningInfo = winResult;
      this.stopTimer();
      this.updateStats(winResult.winner);
      window.soundEffects.playWinSound();

      this.updateUI();
      if (this.onGameOver) {
        this.onGameOver({
          winner: winResult.winner,
          reason: `${winResult.winner === BLACK ? '黑方' : '白方'}达成五子连珠，获得胜利！`,
          line: winResult.line
        });
      }
      return;
    }

    // 和棋判定
    if (GomokuRule.checkDraw(this.board)) {
      this.isGameOver = true;
      this.stopTimer();
      this.updateStats(0);
      this.updateUI();
      if (this.onGameOver) {
        this.onGameOver({ winner: 0, reason: '棋盘已满，双方握手言和！' });
      }
      return;
    }

    // 切换回合
    this.currentTurn = this.currentTurn === BLACK ? WHITE : BLACK;
    this.updateUI();
  }

  /**
   * AI 落子执行
   */
  makeAIMove() {
    if (this.isGameOver) return;

    const aiColor = this.currentTurn;
    const move = GomokuAI.getBestMove(this.board, aiColor, this.difficulty, this.enableFoul);

    if (move && GomokuRule.isValidCoord(move.r, move.c)) {
      this.executeMove(move.r, move.c, aiColor);
    }
  }

  /**
   * 悔棋 (Undo)
   */
  undo() {
    if (this.history.length === 0 || this.isGameOver) return false;

    window.soundEffects.playUndoSound();

    if (this.mode === 'pve') {
      // 人机模式下若轮到人类，需回退两手（AI手 + 玩家手）
      if (this.history.length >= 2) {
        const last1 = this.history.pop();
        const last2 = this.history.pop();
        this.board[last1.r][last1.c] = EMPTY;
        this.board[last2.r][last2.c] = EMPTY;
        this.moveCount -= 2;
      } else if (this.history.length === 1 && this.currentTurn !== this.playerColor) {
        const last = this.history.pop();
        this.board[last.r][last.c] = EMPTY;
        this.moveCount -= 1;
        this.currentTurn = this.playerColor;
      }
    } else {
      // 双人/联机模式回退一步
      const last = this.history.pop();
      this.board[last.r][last.c] = EMPTY;
      this.moveCount -= 1;
      this.currentTurn = last.player;
    }

    this.hintMove = null;
    this.winningInfo = null;
    this.updateUI();
    return true;
  }

  /**
   * 获取落子提示 (Hint)
   */
  requestHint() {
    if (this.isGameOver) return null;

    window.soundEffects.playHintSound();
    const bestMove = GomokuAI.getBestMove(this.board, this.currentTurn, 'master', this.enableFoul);
    this.hintMove = bestMove;
    this.updateUI();
    return bestMove;
  }

  /**
   * 认输
   */
  surrender(player) {
    if (this.isGameOver) return;

    this.isGameOver = true;
    this.stopTimer();
    const winner = player === BLACK ? WHITE : BLACK;
    this.updateStats(winner);
    window.soundEffects.playLoseSound();
    this.updateUI();

    if (this.onGameOver) {
      this.onGameOver({
        winner,
        reason: `${player === BLACK ? '黑方' : '白方'}主动认输！`
      });
    }
  }

  /**
   * 计时器流转
   */
  startTimer() {
    this.stopTimer();
    this.timer = setInterval(() => {
      if (this.isGameOver) return;
      if (this.currentTurn === BLACK) {
        this.blackTime++;
      } else {
        this.whiteTime++;
      }
      if (this.onStateChange) {
        this.onStateChange(this.getPublicState());
      }
    }, 1000);
  }

  stopTimer() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * 更新界面与 Canvas
   */
  updateUI() {
    const lastMove = this.history.length > 0 ? this.history[this.history.length - 1] : null;
    const winningLine = this.winningInfo ? this.winningInfo.line : null;

    this.boardRenderer.update(
      this.board,
      this.currentTurn,
      lastMove,
      winningLine,
      this.hintMove
    );

    if (this.onStateChange) {
      this.onStateChange(this.getPublicState());
    }
  }

  getPublicState() {
    return {
      currentTurn: this.currentTurn,
      isGameOver: this.isGameOver,
      mode: this.mode,
      difficulty: this.difficulty,
      playerColor: this.playerColor,
      moveCount: this.moveCount,
      blackTime: this.formatTime(this.blackTime),
      whiteTime: this.formatTime(this.whiteTime),
      canUndo: this.history.length > 0 && !this.isGameOver,
      stats: this.stats
    };
  }

  formatTime(seconds) {
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = (seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  }

  loadStats() {
    try {
      const saved = localStorage.getItem('gomoku_game_stats');
      if (saved) return JSON.parse(saved);
    } catch (e) {}
    return { playerWins: 0, aiWins: 0, draws: 0, totalMatches: 0 };
  }

  updateStats(winner) {
    this.stats.totalMatches++;
    if (this.mode === 'pve') {
      if (winner === this.playerColor) {
        this.stats.playerWins++;
      } else if (winner !== 0) {
        this.stats.aiWins++;
      } else {
        this.stats.draws++;
      }
    } else {
      if (winner === BLACK) this.stats.playerWins++;
      else if (winner === WHITE) this.stats.aiWins++;
      else this.stats.draws++;
    }
    try {
      localStorage.setItem('gomoku_game_stats', JSON.stringify(this.stats));
    } catch (e) {}
  }
}

window.GomokuGame = GomokuGame;
