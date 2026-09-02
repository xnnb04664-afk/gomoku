const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT_DIR = __dirname;
const OUTPUT_FILE = path.join(ROOT_DIR, '五子棋大师_单文件版.html');

console.log('>>> 正在打包所有代码为单个独立 HTML 文件...');

function fetchPeerJS() {
  return new Promise((resolve) => {
    const url = 'https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js';
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', (err) => {
      console.warn('无法在线获取 PeerJS，将使用 CDN 引用兜底:', err.message);
      resolve('');
    });
  });
}

async function bundle() {
  const cssContent = fs.readFileSync(path.join(ROOT_DIR, 'css', 'style.css'), 'utf8');
  const audioJs = fs.readFileSync(path.join(ROOT_DIR, 'js', 'audio.js'), 'utf8');
  const ruleJs = fs.readFileSync(path.join(ROOT_DIR, 'js', 'rule.js'), 'utf8');
  const aiJs = fs.readFileSync(path.join(ROOT_DIR, 'js', 'ai.js'), 'utf8');
  const networkJs = fs.readFileSync(path.join(ROOT_DIR, 'js', 'network.js'), 'utf8');
  const boardJs = fs.readFileSync(path.join(ROOT_DIR, 'js', 'board.js'), 'utf8');
  const gameJs = fs.readFileSync(path.join(ROOT_DIR, 'js', 'game.js'), 'utf8');
  const mainJs = fs.readFileSync(path.join(ROOT_DIR, 'js', 'main.js'), 'utf8');

  console.log('>>> 正在嵌入 PeerJS 通信库...');
  const peerJsContent = await fetchPeerJS();

  const singleHtml = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>五子棋大师 - Gomoku Master (单文件全功能版)</title>
  <style>
${cssContent}
  </style>
  ${peerJsContent ? `<script>\n${peerJsContent}\n</script>` : `<script src="https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js"></script>`}
</head>
<body>

  <div class="app-container">
    
    <!-- 左侧/上方控制与状态面板 -->
    <aside class="sidebar">
      
      <!-- 游戏标题 -->
      <div class="panel-card game-title">
        <h1><span>♟️</span> 五子棋大师</h1>
        <div class="subtitle">Gomoku Master · 智能对弈 & 在线联机</div>
      </div>

      <!-- 对弈双方状态 -->
      <div class="panel-card">
        <div class="players-status">
          
          <!-- 黑方 -->
          <div class="player-card active" id="blackPlayerCard">
            <div class="player-avatar black-piece">
              <span class="turn-indicator"></span>
            </div>
            <div class="player-name">黑方</div>
            <div class="player-role" id="blackRole">玩家</div>
            <div class="player-time" id="blackTime">00:00</div>
          </div>

          <div class="vs-badge">VS</div>

          <!-- 白方 -->
          <div class="player-card" id="whitePlayerCard">
            <div class="player-avatar white-piece">
              <span class="turn-indicator"></span>
            </div>
            <div class="player-name">白方</div>
            <div class="player-role" id="whiteRole">AI 电脑</div>
            <div class="player-time" id="whiteTime">00:00</div>
          </div>

        </div>

        <!-- 当前对局数据 -->
        <div class="match-info-bar">
          <div class="info-item">
            <span class="label">已走步数</span>
            <span class="value" id="stepCount">0</span>
          </div>
          <div class="info-item">
            <span class="label">当前棋盘</span>
            <span class="value" id="ruleType">15×15 路</span>
          </div>
        </div>
      </div>

      <!-- 联机专属房间控制卡片 (在选择联机模式时展示) -->
      <div class="panel-card online-panel" id="onlineCard">
        <div class="online-status-badge">
          <span class="status-dot" id="statusDot"></span>
          <span id="onlineStatusText">等待创建或加入房间</span>
        </div>

        <div class="room-code-display" id="roomCodeDisplay" style="display: none;">
          <span>我的房间号:</span>
          <span class="code" id="currentRoomCode">------</span>
          <button class="btn" id="btnCopyRoomCode" style="padding: 3px 8px; font-size: 11px;">复制</button>
        </div>

        <div class="room-actions">
          <button class="btn btn-primary" id="btnCreateRoom">
            <span>🏠</span> 创建新房间
          </button>
          
          <div class="room-input-group">
            <input type="text" id="joinRoomInput" class="room-input" placeholder="输入 6 位房间码" maxlength="6">
            <button class="btn" id="btnJoinRoom">加入</button>
          </div>
        </div>

        <!-- 快捷互动表情 -->
        <div>
          <div style="font-size: 11px; color: var(--text-sub); margin-bottom: 4px;">快捷对局互动:</div>
          <div class="chat-emojis">
            <button class="emoji-btn" data-emoji="🔥 好棋！">🔥</button>
            <button class="emoji-btn" data-emoji="🤔 思考中...">🤔</button>
            <button class="emoji-btn" data-emoji="🤝 承让承让！">🤝</button>
            <button class="emoji-btn" data-emoji="😅 大意了！">😅</button>
            <button class="emoji-btn" data-emoji="👏 精彩！">👏</button>
          </div>
        </div>
      </div>

      <!-- 游戏控制按钮群 -->
      <div class="panel-card">
        <div class="control-grid">
          <button class="btn btn-primary" id="btnRestart">
            <span>🔄</span> 开始新对局
          </button>
          <button class="btn" id="btnUndo" disabled title="快捷键: Ctrl+Z">
            <span>↩️</span> 悔棋一步
          </button>
          <button class="btn" id="btnHint" title="快捷键: H">
            <span>💡</span> AI 支招
          </button>
          <button class="btn btn-danger" id="btnSurrender" style="grid-column: span 2;">
            <span>🏳️</span> 认输本局
          </button>
        </div>
      </div>

      <!-- 对局设置选项 -->
      <div class="panel-card">
        <div class="setting-row">
          <span class="setting-label">对战模式</span>
          <div class="setting-control">
            <select id="selectMode">
              <option value="pve" selected>人机对弈 (PvE)</option>
              <option value="pvp">双人同屏 (PvP)</option>
              <option value="online">在线双人联机 (Online)</option>
            </select>
          </div>
        </div>

        <div class="setting-row" id="difficultyRow">
          <span class="setting-label">AI 难度</span>
          <div class="setting-control">
            <select id="selectDifficulty">
              <option value="easy">休闲入门</option>
              <option value="medium" selected>进阶高手</option>
              <option value="master">挑战大师 (Alpha-Beta)</option>
            </select>
          </div>
        </div>

        <div class="setting-row" id="firstHandRow">
          <span class="setting-label">玩家执子</span>
          <div class="setting-control">
            <select id="selectFirstHand">
              <option value="black">黑子 (先手执黑)</option>
              <option value="white">白子 (后手执白)</option>
            </select>
          </div>
        </div>

        <div class="setting-row">
          <span class="setting-label">黑棋禁手 (三三/四四/长连)</span>
          <label class="switch">
            <input type="checkbox" id="toggleFoul">
            <span class="slider"></span>
          </label>
        </div>

        <div class="setting-row">
          <span class="setting-label">对弈音效 (Web Audio)</span>
          <label class="switch">
            <input type="checkbox" id="toggleSound" checked>
            <span class="slider"></span>
          </label>
        </div>
      </div>

      <!-- 战绩统计 -->
      <div class="panel-card">
        <div style="font-size: 12px; color: var(--text-sub); margin-bottom: 4px;">历史战绩统计</div>
        <div class="stats-badge-group">
          <div class="stat-box">
            <div class="count" id="playerWinsCount">0</div>
            <div class="desc">玩家胜</div>
          </div>
          <div class="stat-box">
            <div class="count" id="aiWinsCount">0</div>
            <div class="desc">AI 胜</div>
          </div>
          <div class="stat-box">
            <div class="count" id="drawsCount">0</div>
            <div class="desc">和棋</div>
          </div>
        </div>
      </div>

    </aside>

    <!-- 中间主棋盘 -->
    <main class="board-wrapper">
      <div class="board-container">
        <!-- 浮动提示条 -->
        <div class="board-overlay-status" id="overlayTip">提示信息</div>
        <!-- 棋盘画布 -->
        <canvas id="boardCanvas"></canvas>
      </div>
    </main>

  </div>

  <!-- 游戏结束模态弹窗 -->
  <div class="modal-backdrop" id="gameOverModal">
    <div class="modal-card">
      <div class="modal-icon" id="modalIcon">🏆</div>
      <h2 class="modal-title" id="modalTitle">获胜！</h2>
      <p class="modal-desc" id="modalDesc">达成五子连珠，获得胜利！</p>
      <div class="modal-actions">
        <button class="btn btn-primary" id="modalBtnRestart">再来一局</button>
        <button class="btn" id="modalBtnClose">查看复盘</button>
      </div>
    </div>
  </div>

  <!-- 内嵌全部逻辑脚本 (单文件自包含) -->
  <script>
// --- 1. Audio Manager ---
${audioJs}

// --- 2. Rule & Foul Checker ---
${ruleJs}

// --- 3. AI Engine ---
${aiJs}

// --- 4. WebRTC Network Manager ---
${networkJs}

// --- 5. Board Canvas Renderer ---
${boardJs}

// --- 6. Game State Machine ---
${gameJs}

// --- 7. Main UI Handlers ---
${mainJs}
  </script>
</body>
</html>
`;

  fs.writeFileSync(OUTPUT_FILE, singleHtml, 'utf8');
  const stats = fs.statSync(OUTPUT_FILE);
  const sizeKB = (stats.size / 1024).toFixed(1);

  console.log('=================================================');
  console.log('🎉 单文件版打包成功！');
  console.log(`📁 文件路径: ${OUTPUT_FILE}`);
  console.log(`📦 文件大小: ${sizeKB} KB`);
  console.log('=================================================');
}

bundle();
