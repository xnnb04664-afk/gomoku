/**
 * 五子棋 Canvas 高清棋盘与软萌治愈系棋子渲染引擎
 * 支持高分屏 (Retina DPR)、果冻高光棋子、多套可爱萌系主题（奶油甜品/萌宠喵汪/草莓奶冻）
 */
class GomokuBoard {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    this.ctx = this.canvas.getContext('2d');
    this.size = BOARD_SIZE; // 15
    this.padding = 32;
    this.gridSize = 0;
    this.pieceRadius = 0;
    
    this.theme = 'macaron'; // 'macaron' (奶油甜品) | 'pet' (软萌喵汪) | 'strawberry' (草莓奶冻)
    this.hoverCoord = null;
    this.lastMove = null;
    this.winningLine = null;
    this.hintMove = null;
    this.currentTurn = BLACK;
    this.boardState = [];

    this.dpr = window.devicePixelRatio || 1;
    this.initCanvasSize();
    window.addEventListener('resize', () => this.handleResize());
  }

  setTheme(newTheme) {
    this.theme = newTheme;
    this.render();
  }

  initCanvasSize() {
    const containerWidth = Math.min(window.innerWidth - 48, 560);
    const displaySize = Math.max(340, Math.min(containerWidth, 580));

    this.canvas.style.width = `${displaySize}px`;
    this.canvas.style.height = `${displaySize}px`;

    this.canvas.width = displaySize * this.dpr;
    this.canvas.height = displaySize * this.dpr;
    this.ctx.scale(this.dpr, this.dpr);

    this.displaySize = displaySize;
    this.padding = displaySize * 0.065;
    this.gridSize = (displaySize - 2 * this.padding) / (this.size - 1);
    this.pieceRadius = this.gridSize * 0.44;
  }

  handleResize() {
    this.initCanvasSize();
    this.render();
  }

  getGridCoord(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;

    const col = Math.round((x - this.padding) / this.gridSize);
    const row = Math.round((y - this.padding) / this.gridSize);

    if (row >= 0 && row < this.size && col >= 0 && col < this.size) {
      const centerX = this.padding + col * this.gridSize;
      const centerY = this.padding + row * this.gridSize;
      const dist = Math.hypot(x - centerX, y - centerY);
      if (dist <= this.gridSize * 0.48) {
        return { r: row, c: col };
      }
    }
    return null;
  }

  update(boardState, currentTurn, lastMove = null, winningLine = null, hintMove = null) {
    this.boardState = boardState;
    this.currentTurn = currentTurn;
    this.lastMove = lastMove;
    this.winningLine = winningLine;
    this.hintMove = hintMove;
    this.render();
  }

  setHover(coord) {
    this.hoverCoord = coord;
    this.render();
  }

  render() {
    this.ctx.clearRect(0, 0, this.displaySize, this.displaySize);

    // 1. 绘制温润奶油棋盘与暖棕网格
    this.drawBoardGrid();

    // 2. 绘制可爱星位小梅花
    this.drawStarPoints();

    // 3. 绘制温和坐标标尺
    this.drawCoordinates();

    // 4. 绘制所有已落软萌棋子
    this.drawPieces();

    // 5. 绘制最后一手小红心/爱心标记
    if (this.lastMove) {
      this.drawLastMoveMark(this.lastMove.r, this.lastMove.c);
    }

    // 6. 绘制 AI 提示落子点 (发光小星星)
    if (this.hintMove) {
      this.drawHintMark(this.hintMove.r, this.hintMove.c);
    }

    // 7. 绘制鼠标悬停虚影与萌系瞄准环
    if (this.hoverCoord && !this.winningLine) {
      const { r, c } = this.hoverCoord;
      if (this.boardState[r] && this.boardState[r][c] === EMPTY) {
        this.drawHoverGuide(r, c);
      }
    }

    // 8. 绘制胜利五子彩虹连线
    if (this.winningLine && this.winningLine.length >= 5) {
      this.drawWinningLine(this.winningLine);
    }
  }

  /**
   * 绘制温润奶油色棋盘网格
   */
  drawBoardGrid() {
    const ctx = this.ctx;
    ctx.save();

    // 棋盘背景底色 (极浅奶油卡纸色)
    ctx.fillStyle = '#fffdf9';
    ctx.beginPath();
    ctx.roundRect(4, 4, this.displaySize - 8, this.displaySize - 8, 14);
    ctx.fill();

    // 柔和外边框
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#dfb892';
    ctx.strokeRect(
      this.padding,
      this.padding,
      (this.size - 1) * this.gridSize,
      (this.size - 1) * this.gridSize
    );

    // 内部温润暖棕网格线
    ctx.lineWidth = 1.1;
    ctx.strokeStyle = '#e6c8a8';

    for (let i = 0; i < this.size; i++) {
      const pos = this.padding + i * this.gridSize;

      // 横线
      ctx.beginPath();
      ctx.moveTo(this.padding, pos);
      ctx.lineTo(this.padding + (this.size - 1) * this.gridSize, pos);
      ctx.stroke();

      // 竖线
      ctx.beginPath();
      ctx.moveTo(pos, this.padding);
      ctx.lineTo(pos, this.padding + (this.size - 1) * this.gridSize);
      ctx.stroke();
    }

    ctx.restore();
  }

  /**
   * 绘制星位 (可爱的暖棕小花瓣圆点)
   */
  drawStarPoints() {
    const ctx = this.ctx;
    const starCoords = [
      [3, 3], [3, 11], [7, 7], [11, 3], [11, 11]
    ];

    ctx.save();
    ctx.fillStyle = '#d49b6a';
    for (const [r, c] of starCoords) {
      const x = this.padding + c * this.gridSize;
      const y = this.padding + r * this.gridSize;
      ctx.beginPath();
      ctx.arc(x, y, this.gridSize * 0.09, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  /**
   * 绘制温和可爱的坐标标尺
   */
  drawCoordinates() {
    const ctx = this.ctx;
    ctx.save();
    ctx.font = `700 ${Math.max(10, this.gridSize * 0.26)}px -apple-system, sans-serif`;
    ctx.fillStyle = '#bcaaa4';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const letters = 'ABCDEFGHIJKLMNO';

    for (let i = 0; i < this.size; i++) {
      const pos = this.padding + i * this.gridSize;
      ctx.fillText(letters[i], pos, this.padding * 0.45);
      ctx.fillText(letters[i], pos, this.displaySize - this.padding * 0.45);
      ctx.fillText(`${15 - i}`, this.padding * 0.45, pos);
      ctx.fillText(`${15 - i}`, this.displaySize - this.padding * 0.45, pos);
    }
    ctx.restore();
  }

  /**
   * 绘制所有棋子
   */
  drawPieces() {
    for (let r = 0; r < this.size; r++) {
      for (let c = 0; c < this.size; c++) {
        const piece = this.boardState[r] ? this.boardState[r][c] : EMPTY;
        if (piece !== EMPTY) {
          const x = this.padding + c * this.gridSize;
          const y = this.padding + r * this.gridSize;
          this.drawSingleCutePiece(x, y, piece);
        }
      }
    }
  }

  /**
   * 绘制单颗可爱治愈风棋子 (支持多种萌系主题)
   */
  drawSingleCutePiece(x, y, colorType, opacity = 1.0) {
    const ctx = this.ctx;
    const r = this.pieceRadius;

    ctx.save();
    ctx.globalAlpha = opacity;

    // 1. 软乎乎的云朵软阴影 (Soft Ambient Shadow)
    ctx.beginPath();
    ctx.arc(x + r * 0.08, y + r * 0.16, r * 0.94, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(160, 100, 60, 0.22)';
    ctx.filter = 'blur(4px)';
    ctx.fill();
    ctx.filter = 'none';

    // 2. 棋子主体
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);

    if (colorType === BLACK) {
      if (this.theme === 'strawberry') {
        // 草莓黑巧
        const grad = ctx.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.1, x, y, r);
        grad.addColorStop(0, '#e84393');
        grad.addColorStop(0.5, '#6c1538');
        grad.addColorStop(1, '#2c0617');
        ctx.fillStyle = grad;
      } else {
        // 经典黑巧布朗尼 (深邃温润的黑巧色)
        const grad = ctx.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.1, x, y, r);
        grad.addColorStop(0, '#795548');
        grad.addColorStop(0.45, '#3e2723');
        grad.addColorStop(1, '#1b100c');
        ctx.fillStyle = grad;
      }
      ctx.fill();

      // 柔和白边轮廓
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
      ctx.stroke();

      // 如果是萌宠主题，绘制小猫咪粉萌肉垫
      if (this.theme === 'pet') {
        this.drawCatPaw(x, y, r, '#ff9999');
      }

    } else {
      if (this.theme === 'strawberry') {
        // 草莓白巧雪糕
        const grad = ctx.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.1, x, y, r);
        grad.addColorStop(0, '#ffffff');
        grad.addColorStop(0.6, '#ffeaa7');
        grad.addColorStop(1, '#ffccd5');
        ctx.fillStyle = grad;
      } else {
        // 香草雪媚娘 (纯净透亮的奶油白)
        const grad = ctx.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.1, x, y, r);
        grad.addColorStop(0, '#ffffff');
        grad.addColorStop(0.65, '#fef6ee');
        grad.addColorStop(1, '#f8dac5');
        ctx.fillStyle = grad;
      }
      ctx.fill();

      // 浅蜜桃边框
      ctx.lineWidth = 1.4;
      ctx.strokeStyle = 'rgba(255, 170, 130, 0.4)';
      ctx.stroke();

      // 如果是萌宠主题，绘制柴犬萌萌肉垫
      if (this.theme === 'pet') {
        this.drawDogPaw(x, y, r, '#e17055');
      }
    }

    // 3. 水滴果冻晶莹高光 (Cute Water Gloss Highlight)
    if (this.theme !== 'pet') {
      ctx.beginPath();
      ctx.ellipse(x - r * 0.32, y - r * 0.36, r * 0.35, r * 0.2, Math.PI / 4, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.65)';
      ctx.fill();

      // 副高光小圆点
      ctx.beginPath();
      ctx.arc(x - r * 0.15, y - r * 0.52, r * 0.1, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
      ctx.fill();
    }

    ctx.restore();
  }

  /**
   * 绘制萌萌猫爪肉垫
   */
  drawCatPaw(x, y, r, pawColor) {
    const ctx = this.ctx;
    ctx.save();
    ctx.fillStyle = pawColor;

    // 主肉垫
    ctx.beginPath();
    ctx.ellipse(x, y + r * 0.12, r * 0.38, r * 0.3, 0, 0, Math.PI * 2);
    ctx.fill();

    // 4个小脚趾肉垫
    const toes = [
      { dx: -r * 0.35, dy: -r * 0.18, rad: r * 0.13 },
      { dx: -r * 0.12, dy: -r * 0.35, rad: r * 0.14 },
      { dx: r * 0.12, dy: -r * 0.35, rad: r * 0.14 },
      { dx: r * 0.35, dy: -r * 0.18, rad: r * 0.13 }
    ];

    for (const toe of toes) {
      ctx.beginPath();
      ctx.arc(x + toe.dx, y + toe.dy, toe.rad, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  /**
   * 绘制软萌汪汪肉垫
   */
  drawDogPaw(x, y, r, pawColor) {
    const ctx = this.ctx;
    ctx.save();
    ctx.fillStyle = pawColor;

    // 主掌印 (倒三角爱心感)
    ctx.beginPath();
    ctx.ellipse(x, y + r * 0.15, r * 0.4, r * 0.32, 0, 0, Math.PI * 2);
    ctx.fill();

    // 4个脚趾
    const toes = [
      { dx: -r * 0.32, dy: -r * 0.2, rad: r * 0.14 },
      { dx: -r * 0.11, dy: -r * 0.38, rad: r * 0.15 },
      { dx: r * 0.11, dy: -r * 0.38, rad: r * 0.15 },
      { dx: r * 0.32, dy: -r * 0.2, rad: r * 0.14 }
    ];

    for (const toe of toes) {
      ctx.beginPath();
      ctx.arc(x + toe.dx, y + toe.dy, toe.rad, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  /**
   * 绘制鼠标悬停虚影与萌系瞄准光环
   */
  drawHoverGuide(r, c) {
    const x = this.padding + c * this.gridSize;
    const y = this.padding + r * this.gridSize;
    const ctx = this.ctx;

    ctx.save();

    // 半透明萌系虚影
    this.drawSingleCutePiece(x, y, this.currentTurn, 0.45);

    // 可爱花瓣准星
    ctx.strokeStyle = '#ff9f43';
    ctx.lineWidth = 2.5;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.arc(x, y, this.pieceRadius * 1.08, 0, Math.PI * 2);
    ctx.stroke();

    ctx.restore();
  }

  /**
   * 最后一手落子标记 (可爱小红心 / 萌萌小圆圈)
   */
  drawLastMoveMark(r, c) {
    const x = this.padding + c * this.gridSize;
    const y = this.padding + r * this.gridSize;
    const ctx = this.ctx;

    ctx.save();
    // 绘制小爱心 ❤️
    ctx.fillStyle = '#ff4757';
    ctx.shadowColor = '#ff6b81';
    ctx.shadowBlur = 8;
    
    ctx.font = `${Math.round(this.pieceRadius * 0.7)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('❤️', x, y + 1);

    ctx.restore();
  }

  /**
   * AI 提示落子点标记 (治愈小星星 ⭐)
   */
  drawHintMark(r, c) {
    const x = this.padding + c * this.gridSize;
    const y = this.padding + r * this.gridSize;
    const ctx = this.ctx;

    ctx.save();
    // 脉冲光环
    ctx.beginPath();
    ctx.arc(x, y, this.pieceRadius * 0.9, 0, Math.PI * 2);
    ctx.strokeStyle = '#ff9f43';
    ctx.lineWidth = 3;
    ctx.setLineDash([5, 4]);
    ctx.shadowColor = '#ffa502';
    ctx.shadowBlur = 12;
    ctx.stroke();

    // 中心小星星
    ctx.font = `${Math.round(this.pieceRadius * 0.8)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('⭐', x, y);

    ctx.restore();
  }

  /**
   * 获胜五子梦幻发光彩虹连线
   */
  drawWinningLine(line) {
    const ctx = this.ctx;
    ctx.save();

    // 1. 发光连接线
    ctx.beginPath();
    const startX = this.padding + line[0][1] * this.gridSize;
    const startY = this.padding + line[0][0] * this.gridSize;
    ctx.moveTo(startX, startY);

    for (let i = 1; i < line.length; i++) {
      const px = this.padding + line[i][1] * this.gridSize;
      const py = this.padding + line[i][0] * this.gridSize;
      ctx.lineTo(px, py);
    }

    ctx.lineWidth = 6;
    ctx.strokeStyle = '#ff9f43';
    ctx.lineCap = 'round';
    ctx.shadowColor = '#ff6b6b';
    ctx.shadowBlur = 18;
    ctx.stroke();

    // 2. 各子周围小太阳/发光光环
    for (const [r, c] of line) {
      const px = this.padding + c * this.gridSize;
      const py = this.padding + r * this.gridSize;

      ctx.beginPath();
      ctx.arc(px, py, this.pieceRadius * 1.05, 0, Math.PI * 2);
      ctx.strokeStyle = '#ff4757';
      ctx.lineWidth = 3.5;
      ctx.stroke();
    }

    ctx.restore();
  }
}

window.GomokuBoard = GomokuBoard;
