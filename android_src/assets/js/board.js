/**
 * 五子棋 Canvas 高清棋盘与棋子渲染引擎
 * 支持高分屏 (Retina DPR) 适配、玉石立体光泽棋子、光标悬停虚影与获胜连线发光
 */
class GomokuBoard {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    this.ctx = this.canvas.getContext('2d');
    this.size = BOARD_SIZE; // 15
    this.padding = 32; // 棋盘边距
    this.gridSize = 0; // 单格大小
    this.pieceRadius = 0; // 棋子半径
    
    this.hoverCoord = null; // 当前鼠标悬停的交叉点 {r, c}
    this.lastMove = null; // 最后一手 {r, c}
    this.winningLine = null; // 胜利五子连线 [[r, c], ...]
    this.hintMove = null; // AI 提示落子点 {r, c}
    this.currentTurn = BLACK; // 用于虚影预览
    this.boardState = []; // 棋盘状态

    this.dpr = window.devicePixelRatio || 1;
    this.initCanvasSize();
    window.addEventListener('resize', () => this.handleResize());
  }

  initCanvasSize() {
    // 基础尺寸 560x560，响应式自动调整
    const containerWidth = Math.min(window.innerWidth - 48, 560);
    const displaySize = Math.max(340, Math.min(containerWidth, 580));

    this.canvas.style.width = `${displaySize}px`;
    this.canvas.style.height = `${displaySize}px`;

    this.canvas.width = displaySize * this.dpr;
    this.canvas.height = displaySize * this.dpr;
    this.ctx.scale(this.dpr, this.dpr);

    this.displaySize = displaySize;
    this.padding = displaySize * 0.06;
    this.gridSize = (displaySize - 2 * this.padding) / (this.size - 1);
    this.pieceRadius = this.gridSize * 0.44;
  }

  handleResize() {
    this.initCanvasSize();
    this.render();
  }

  /**
   * 坐标转换：屏幕像素坐标 -> 棋盘行列坐标
   */
  getGridCoord(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;

    const col = Math.round((x - this.padding) / this.gridSize);
    const row = Math.round((y - this.padding) / this.gridSize);

    if (row >= 0 && row < this.size && col >= 0 && col < this.size) {
      // 容差检测：点击点距离交叉点的欧氏距离必须在合理阈值内
      const centerX = this.padding + col * this.gridSize;
      const centerY = this.padding + row * this.gridSize;
      const dist = Math.hypot(x - centerX, y - centerY);
      if (dist <= this.gridSize * 0.48) {
        return { r: row, c: col };
      }
    }
    return null;
  }

  /**
   * 更新棋盘数据并重绘
   */
  update(boardState, currentTurn, lastMove = null, winningLine = null, hintMove = null) {
    this.boardState = boardState;
    this.currentTurn = currentTurn;
    this.lastMove = lastMove;
    this.winningLine = winningLine;
    this.hintMove = hintMove;
    this.render();
  }

  /**
   * 设置鼠标悬浮点
   */
  setHover(coord) {
    this.hoverCoord = coord;
    this.render();
  }

  /**
   * 主渲染入口
   */
  render() {
    this.ctx.clearRect(0, 0, this.displaySize, this.displaySize);

    // 1. 绘制棋盘网格背景与木质边框
    this.drawBoardGrid();

    // 2. 绘制星位 (天元及四个角星)
    this.drawStarPoints();

    // 3. 绘制棋盘坐标标尺（字母 A-O, 数字 1-15）
    this.drawCoordinates();

    // 4. 绘制所有已落棋子
    this.drawPieces();

    // 5. 绘制最后一手高亮标记
    if (this.lastMove) {
      this.drawLastMoveMark(this.lastMove.r, this.lastMove.c);
    }

    // 6. 绘制 AI 提示落子点
    if (this.hintMove) {
      this.drawHintMark(this.hintMove.r, this.hintMove.c);
    }

    // 7. 绘制鼠标悬停虚影与十字准星
    if (this.hoverCoord && !this.winningLine) {
      const { r, c } = this.hoverCoord;
      if (this.boardState[r] && this.boardState[r][c] === EMPTY) {
        this.drawHoverGuide(r, c);
      }
    }

    // 8. 绘制胜利五子连线发光特效
    if (this.winningLine && this.winningLine.length >= 5) {
      this.drawWinningLine(this.winningLine);
    }
  }

  /**
   * 绘制 15x15 棋盘网格
   */
  drawBoardGrid() {
    const ctx = this.ctx;
    ctx.save();

    // 外边框稍粗
    ctx.lineWidth = 1.8;
    ctx.strokeStyle = '#5c3a21';
    ctx.strokeRect(
      this.padding,
      this.padding,
      (this.size - 1) * this.gridSize,
      (this.size - 1) * this.gridSize
    );

    // 内部网格线
    ctx.lineWidth = 1.0;
    ctx.strokeStyle = '#7c4d29';

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
   * 绘制星位 (天元及四个角星)
   */
  drawStarPoints() {
    const ctx = this.ctx;
    // 标准 15 路五子棋星位：(3,3), (3,11), (7,7 - 天元), (11,3), (11,11)
    const starCoords = [
      [3, 3], [3, 11], [7, 7], [11, 3], [11, 11]
    ];

    ctx.save();
    ctx.fillStyle = '#5c3a21';
    for (const [r, c] of starCoords) {
      const x = this.padding + c * this.gridSize;
      const y = this.padding + r * this.gridSize;
      ctx.beginPath();
      ctx.arc(x, y, this.gridSize * 0.1, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  /**
   * 绘制棋盘四周边线坐标（A-O，1-15）
   */
  drawCoordinates() {
    const ctx = this.ctx;
    ctx.save();
    ctx.font = `600 ${Math.max(10, this.gridSize * 0.26)}px monospace`;
    ctx.fillStyle = '#8b5a2b';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const letters = 'ABCDEFGHIJKLMNO';

    for (let i = 0; i < this.size; i++) {
      const pos = this.padding + i * this.gridSize;
      // 顶部字母
      ctx.fillText(letters[i], pos, this.padding * 0.45);
      // 底部字母
      ctx.fillText(letters[i], pos, this.displaySize - this.padding * 0.45);

      // 左侧数字 (15-1)
      ctx.fillText(`${15 - i}`, this.padding * 0.45, pos);
      // 右侧数字 (15-1)
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
          this.drawSinglePiece(x, y, piece);
        }
      }
    }
  }

  /**
   * 绘制单颗带有立体光泽与投影质感的棋子
   */
  drawSinglePiece(x, y, colorType, opacity = 1.0) {
    const ctx = this.ctx;
    const r = this.pieceRadius;

    ctx.save();
    ctx.globalAlpha = opacity;

    // 1. 棋子外阴影 (Drop Shadow)
    ctx.beginPath();
    ctx.arc(x + r * 0.12, y + r * 0.15, r * 0.96, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.filter = 'blur(3px)';
    ctx.fill();
    ctx.filter = 'none';

    // 2. 棋子主体径向渐变
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);

    if (colorType === BLACK) {
      // 黑子：黑曜石深邃立体质感
      const grad = ctx.createRadialGradient(
        x - r * 0.3, y - r * 0.35, r * 0.05,
        x, y, r
      );
      grad.addColorStop(0, '#5a5a5a');
      grad.addColorStop(0.35, '#262626');
      grad.addColorStop(0.85, '#111111');
      grad.addColorStop(1, '#000000');
      ctx.fillStyle = grad;
      ctx.fill();

      // 细腻边缘暗线
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
      ctx.stroke();
    } else {
      // 白子：汉白玉晶莹剔透质感
      const grad = ctx.createRadialGradient(
        x - r * 0.3, y - r * 0.35, r * 0.05,
        x, y, r
      );
      grad.addColorStop(0, '#ffffff');
      grad.addColorStop(0.55, '#f4f4f5');
      grad.addColorStop(0.85, '#d4d4d8');
      grad.addColorStop(1, '#a1a1aa');
      ctx.fillStyle = grad;
      ctx.fill();

      // 浅色质感边框
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.2)';
      ctx.stroke();
    }

    ctx.restore();
  }

  /**
   * 绘制鼠标悬停虚影与十字准星
   */
  drawHoverGuide(r, c) {
    const x = this.padding + c * this.gridSize;
    const y = this.padding + r * this.gridSize;
    const ctx = this.ctx;

    ctx.save();

    // 1. 半透明虚影棋子
    this.drawSinglePiece(x, y, this.currentTurn, 0.45);

    // 2. 四角对焦瞄准标记
    ctx.strokeStyle = this.currentTurn === BLACK ? 'rgba(0,0,0,0.8)' : 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 2;
    const d = this.pieceRadius * 1.1;
    const len = this.gridSize * 0.2;

    // 左上
    ctx.beginPath();
    ctx.moveTo(x - d, y - d + len); ctx.lineTo(x - d, y - d); ctx.lineTo(x - d + len, y - d);
    // 右上
    ctx.moveTo(x + d - len, y - d); ctx.lineTo(x + d, y - d); ctx.lineTo(x + d, y - d + len);
    // 左下
    ctx.moveTo(x - d, y + d - len); ctx.lineTo(x - d, y + d); ctx.lineTo(x - d + len, y + d);
    // 右下
    ctx.moveTo(x + d - len, y + d); ctx.lineTo(x + d, y + d); ctx.lineTo(x + d, y + d - len);
    ctx.stroke();

    ctx.restore();
  }

  /**
   * 最后一手落子标记 (小圆点/红圈)
   */
  drawLastMoveMark(r, c) {
    const x = this.padding + c * this.gridSize;
    const y = this.padding + r * this.gridSize;
    const piece = this.boardState[r][c];
    const ctx = this.ctx;

    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, this.pieceRadius * 0.25, 0, Math.PI * 2);
    ctx.fillStyle = piece === BLACK ? '#ef4444' : '#dc2626';
    ctx.shadowColor = '#ef4444';
    ctx.shadowBlur = 6;
    ctx.fill();
    ctx.restore();
  }

  /**
   * AI 提示落子点标记 (金色光圈与呼吸标记)
   */
  drawHintMark(r, c) {
    const x = this.padding + c * this.gridSize;
    const y = this.padding + r * this.gridSize;
    const ctx = this.ctx;

    ctx.save();
    // 金色脉冲光环
    ctx.beginPath();
    ctx.arc(x, y, this.pieceRadius * 0.8, 0, Math.PI * 2);
    ctx.strokeStyle = '#fbbf24';
    ctx.lineWidth = 3;
    ctx.setLineDash([4, 4]);
    ctx.shadowColor = '#fbbf24';
    ctx.shadowBlur = 10;
    ctx.stroke();

    // 中心微标
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#fbbf24';
    ctx.fill();
    ctx.restore();
  }

  /**
   * 获胜五子发光连线动画
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

    ctx.lineWidth = 5;
    ctx.strokeStyle = '#22c55e';
    ctx.lineCap = 'round';
    ctx.shadowColor = '#22c55e';
    ctx.shadowBlur = 15;
    ctx.stroke();

    // 2. 获胜各子发光光环
    for (const [r, c] of line) {
      const px = this.padding + c * this.gridSize;
      const py = this.padding + r * this.gridSize;

      ctx.beginPath();
      ctx.arc(px, py, this.pieceRadius * 0.9, 0, Math.PI * 2);
      ctx.strokeStyle = '#4ade80';
      ctx.lineWidth = 3;
      ctx.stroke();
    }

    ctx.restore();
  }
}

window.GomokuBoard = GomokuBoard;
