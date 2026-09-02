/**
 * 五子棋游戏入口、联机通信与 UI 事件绑定 (Main Entry & Network Event Handlers)
 */
document.addEventListener('DOMContentLoaded', () => {
  // 1. 初始化渲染器、游戏引擎与网络管理器
  const boardRenderer = new GomokuBoard('boardCanvas');
  const game = new GomokuGame(boardRenderer);
  const network = new PeerNetwork();

  // 2. 获取 UI 节点引用
  const dom = {
    // 玩家卡片
    blackCard: document.getElementById('blackPlayerCard'),
    whiteCard: document.getElementById('whitePlayerCard'),
    blackTime: document.getElementById('blackTime'),
    whiteTime: document.getElementById('whiteTime'),
    blackRole: document.getElementById('blackRole'),
    whiteRole: document.getElementById('whiteRole'),
    
    // 状态统计
    stepCount: document.getElementById('stepCount'),
    matchStatus: document.getElementById('matchStatus'),
    playerWinsCount: document.getElementById('playerWinsCount'),
    aiWinsCount: document.getElementById('aiWinsCount'),
    drawsCount: document.getElementById('drawsCount'),

    // 控制按钮
    btnRestart: document.getElementById('btnRestart'),
    btnUndo: document.getElementById('btnUndo'),
    btnHint: document.getElementById('btnHint'),
    btnSurrender: document.getElementById('btnSurrender'),

    // 设置选项
    selectMode: document.getElementById('selectMode'),
    selectDifficulty: document.getElementById('selectDifficulty'),
    difficultyRow: document.getElementById('difficultyRow'),
    selectFirstHand: document.getElementById('selectFirstHand'),
    firstHandRow: document.getElementById('firstHandRow'),
    toggleFoul: document.getElementById('toggleFoul'),
    toggleSound: document.getElementById('toggleSound'),

    // 联机专属卡片
    onlineCard: document.getElementById('onlineCard'),
    statusDot: document.getElementById('statusDot'),
    onlineStatusText: document.getElementById('onlineStatusText'),
    btnCreateRoom: document.getElementById('btnCreateRoom'),
    btnCopyRoomCode: document.getElementById('btnCopyRoomCode'),
    roomCodeDisplay: document.getElementById('roomCodeDisplay'),
    currentRoomCode: document.getElementById('currentRoomCode'),
    joinRoomInput: document.getElementById('joinRoomInput'),
    btnJoinRoom: document.getElementById('btnJoinRoom'),
    chatEmojis: document.querySelectorAll('.emoji-btn'),

    // 模态弹窗
    gameOverModal: document.getElementById('gameOverModal'),
    modalTitle: document.getElementById('modalTitle'),
    modalDesc: document.getElementById('modalDesc'),
    modalIcon: document.getElementById('modalIcon'),
    modalBtnRestart: document.getElementById('modalBtnRestart'),
    modalBtnClose: document.getElementById('modalBtnClose'),
    overlayTip: document.getElementById('overlayTip'),
    boardWrapper: document.querySelector('.board-wrapper')
  };

  // 3. 界面状态同步回调
  game.onStateChange = (state) => {
    // 切换卡片高亮
    if (state.currentTurn === BLACK) {
      dom.blackCard.classList.add('active');
      dom.whiteCard.classList.remove('active');
    } else {
      dom.blackCard.classList.remove('active');
      dom.whiteCard.classList.add('active');
    }

    // 计时与步数
    dom.blackTime.textContent = state.blackTime;
    dom.whiteTime.textContent = state.whiteTime;
    dom.stepCount.textContent = state.moveCount;

    // 悔棋按钮状态
    dom.btnUndo.disabled = !state.canUndo;

    // 战绩显示
    dom.playerWinsCount.textContent = state.stats.playerWins;
    dom.aiWinsCount.textContent = state.stats.aiWins;
    dom.drawsCount.textContent = state.stats.draws;
  };

  // 4. 对局结束回调
  game.onGameOver = (result) => {
    let title = '';
    let icon = '🏆';

    if (result.winner === 0) {
      title = '势均力敌，和棋！';
      icon = '🤝';
    } else if (game.mode === 'pve') {
      if (result.winner === game.playerColor) {
        title = '恭喜！您获得了胜利！';
        icon = '🎉';
      } else {
        title = '很遗憾，AI 棋高一招！';
        icon = '🤖';
      }
    } else if (game.mode === 'online') {
      if (result.winner === game.playerColor) {
        title = '胜利！您击败了对手！';
        icon = '🎉';
      } else {
        title = '对局结束，对手获胜！';
        icon = '⚔️';
      }
    } else {
      title = `${result.winner === BLACK ? '黑方' : '白方'} 胜出！`;
      icon = '👑';
    }

    dom.modalTitle.textContent = title;
    dom.modalDesc.textContent = result.reason;
    dom.modalIcon.textContent = icon;
    dom.gameOverModal.classList.add('show');
  };

  // 5. 联机落子发送回调
  game.onOnlineMove = (moveData) => {
    network.send('MOVE', moveData);
  };

  // 6. 网络状态与消息监听
  network.onStatusChange = (status, text) => {
    dom.onlineStatusText.textContent = text;
    dom.statusDot.className = 'status-dot';

    if (status === 'connected') {
      dom.statusDot.classList.add('connected');
      showTip('🎉 联机成功，对局已就绪！');
      if (network.isHost) {
        // 房主作为黑先手
        game.playerColor = BLACK;
        dom.blackRole.textContent = '我 (房主)';
        dom.whiteRole.textContent = '对手';
        // 同步房主规则给客机
        network.send('SYNC_INIT', { enableFoul: game.enableFoul });
      } else {
        game.playerColor = WHITE;
        dom.blackRole.textContent = '对手 (房主)';
        dom.whiteRole.textContent = '我';
      }
      game.reset();
    } else if (status === 'waiting') {
      dom.statusDot.classList.add('waiting');
    } else if (status === 'connecting') {
      dom.statusDot.classList.add('waiting');
    }
  };

  network.onMessage = (data) => {
    const { type, payload } = data;

    if (type === 'SYNC_INIT') {
      game.enableFoul = payload.enableFoul;
      dom.toggleFoul.checked = payload.enableFoul;
    } else if (type === 'MOVE') {
      game.handleRemoteMove(payload.r, payload.c, payload.player, payload.foul);
    } else if (type === 'RESTART_REQ') {
      if (confirm('对手请求重新开始一局，是否同意？')) {
        network.send('RESTART_RES', { agreed: true });
        dom.gameOverModal.classList.remove('show');
        game.reset();
        showTip('已重新开局！');
      } else {
        network.send('RESTART_RES', { agreed: false });
      }
    } else if (type === 'RESTART_RES') {
      if (payload.agreed) {
        dom.gameOverModal.classList.remove('show');
        game.reset();
        showTip('对手已同意重开，新对局开始！');
      } else {
        showTip('对手拒绝了重新开局请求。');
      }
    } else if (type === 'UNDO_REQ') {
      if (confirm('对手申请悔棋一步，是否同意？')) {
        network.send('UNDO_RES', { agreed: true });
        game.undo();
        showTip('已同意对手悔棋');
      } else {
        network.send('UNDO_RES', { agreed: false });
      }
    } else if (type === 'UNDO_RES') {
      if (payload.agreed) {
        game.undo();
        showTip('对手已同意悔棋！');
      } else {
        showTip('对手拒绝了悔棋申请。');
      }
    } else if (type === 'SURRENDER') {
      game.surrender(payload.player);
      showTip('对手认输了！');
    } else if (type === 'CHAT') {
      showChatBubble(payload.emoji, false);
    }
  };

  // 7. 棋盘鼠标与触控事件
  const canvas = document.getElementById('boardCanvas');

  function getEventCoord(e) {
    if (e.touches && e.touches.length > 0) {
      return { clientX: e.touches[0].clientX, clientY: e.touches[0].clientY };
    }
    return { clientX: e.clientX, clientY: e.clientY };
  }

  // 鼠标移动悬浮指引
  canvas.addEventListener('mousemove', (e) => {
    if (game.isGameOver) return;
    if (game.mode === 'online' && game.currentTurn !== game.playerColor) {
      boardRenderer.setHover(null);
      return;
    }
    const coord = boardRenderer.getGridCoord(e.clientX, e.clientY);
    boardRenderer.setHover(coord);
  });

  canvas.addEventListener('mouseleave', () => {
    boardRenderer.setHover(null);
  });

  // 点击落子
  canvas.addEventListener('click', (e) => {
    window.soundEffects.init();
    const coord = boardRenderer.getGridCoord(e.clientX, e.clientY);
    if (coord) {
      game.handleCellClick(coord.r, coord.c);
    }
  });

  // 移动端触摸落子
  canvas.addEventListener('touchstart', (e) => {
    window.soundEffects.init();
    const pos = getEventCoord(e);
    const coord = boardRenderer.getGridCoord(pos.clientX, pos.clientY);
    if (coord) {
      boardRenderer.setHover(coord);
    }
  }, { passive: true });

  canvas.addEventListener('touchend', (e) => {
    if (e.changedTouches && e.changedTouches.length > 0) {
      const pos = { clientX: e.changedTouches[0].clientX, clientY: e.changedTouches[0].clientY };
      const coord = boardRenderer.getGridCoord(pos.clientX, pos.clientY);
      if (coord) {
        game.handleCellClick(coord.r, coord.c);
      }
    }
  }, { passive: true });

  // 8. 控制面板事件绑定
  // 新开局
  dom.btnRestart.addEventListener('click', () => {
    if (game.mode === 'online') {
      if (!network.isConnected) {
        showTip('当前未连接对手');
        return;
      }
      network.send('RESTART_REQ');
      showTip('已向对手发送重新开始请求...');
      return;
    }
    dom.gameOverModal.classList.remove('show');
    game.reset();
    showTip('新对局已开始！');
  });

  // 悔棋
  dom.btnUndo.addEventListener('click', () => {
    if (game.mode === 'online') {
      if (!network.isConnected) return;
      network.send('UNDO_REQ');
      showTip('已向对手发送悔棋申请，等待回应...');
      return;
    }
    if (game.undo()) {
      showTip('已悔棋一步');
    }
  });

  // AI 提示
  dom.btnHint.addEventListener('click', () => {
    const hint = game.requestHint();
    if (hint) {
      showTip(`AI 推荐落子点：${String.fromCharCode(65 + hint.c)}${15 - hint.r}`);
    }
  });

  // 认输
  dom.btnSurrender.addEventListener('click', () => {
    if (game.isGameOver) return;
    if (confirm('确定要认输吗？')) {
      if (game.mode === 'online' && network.isConnected) {
        network.send('SURRENDER', { player: game.playerColor });
      }
      game.surrender(game.currentTurn);
    }
  });

  // 模式切换 (人机 / 双人 / 联机)
  dom.selectMode.addEventListener('change', (e) => {
    const mode = e.target.value;
    game.mode = mode;

    if (mode === 'pve') {
      dom.difficultyRow.style.display = 'flex';
      dom.firstHandRow.style.display = 'flex';
      dom.onlineCard.style.display = 'none';
      dom.btnHint.style.display = 'inline-flex';
      dom.blackRole.textContent = game.playerColor === BLACK ? '玩家' : 'AI 电脑';
      dom.whiteRole.textContent = game.playerColor === WHITE ? '玩家' : 'AI 电脑';
      network.cleanup();
      game.reset();
    } else if (mode === 'pvp') {
      dom.difficultyRow.style.display = 'none';
      dom.firstHandRow.style.display = 'none';
      dom.onlineCard.style.display = 'none';
      dom.btnHint.style.display = 'inline-flex';
      dom.blackRole.textContent = '黑方 (先手)';
      dom.whiteRole.textContent = '白方 (后手)';
      network.cleanup();
      game.reset();
    } else if (mode === 'online') {
      dom.difficultyRow.style.display = 'none';
      dom.firstHandRow.style.display = 'none';
      dom.onlineCard.style.display = 'flex';
      dom.btnHint.style.display = 'none'; // 联机竞技禁用 AI 提示
      dom.blackRole.textContent = '黑方';
      dom.whiteRole.textContent = '白方';
      // 自动创建房间
      const code = network.createRoom();
      dom.currentRoomCode.textContent = code;
      dom.roomCodeDisplay.style.display = 'flex';
    }
  });

  // 联机创建房间按钮
  dom.btnCreateRoom.addEventListener('click', () => {
    const code = network.createRoom();
    dom.currentRoomCode.textContent = code;
    dom.roomCodeDisplay.style.display = 'flex';
    showTip(`新房间创建成功: ${code}`);
  });

  // 复制房间号
  dom.btnCopyRoomCode.addEventListener('click', () => {
    const code = dom.currentRoomCode.textContent;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(code).then(() => {
        showTip(`房间号 ${code} 已复制到剪贴板！`);
      });
    } else {
      showTip(`房间号: ${code}`);
    }
  });

  // 加入房间
  dom.btnJoinRoom.addEventListener('click', () => {
    const code = dom.joinRoomInput.value.trim().toUpperCase();
    if (!code || code.length < 4) {
      showTip('请输入正确的房间号！');
      return;
    }
    network.joinRoom(code);
  });

  // 快捷表情点击
  dom.chatEmojis.forEach(btn => {
    btn.addEventListener('click', () => {
      const emoji = btn.dataset.emoji || btn.textContent;
      if (game.mode === 'online' && network.isConnected) {
        network.send('CHAT', { emoji });
      }
      showChatBubble(emoji, true);
    });
  });

  // 难度切换
  dom.selectDifficulty.addEventListener('change', (e) => {
    game.difficulty = e.target.value;
    showTip(`AI 难度已切换为：${e.target.options[e.target.selectedIndex].text}`);
  });

  // 先手/后手切换
  dom.selectFirstHand.addEventListener('change', (e) => {
    const isBlack = e.target.value === 'black';
    game.playerColor = isBlack ? BLACK : WHITE;
    dom.blackRole.textContent = isBlack ? '玩家' : 'AI 电脑';
    dom.whiteRole.textContent = isBlack ? 'AI 电脑' : '玩家';
    game.reset();
  });

  // 禁手开关
  dom.toggleFoul.addEventListener('change', (e) => {
    game.enableFoul = e.target.checked;
    showTip(`禁手规则已${game.enableFoul ? '开启 (黑棋禁三三/四四/长连)' : '关闭'}`);
    if (game.mode === 'online' && network.isConnected && network.isHost) {
      network.send('SYNC_INIT', { enableFoul: game.enableFoul });
    }
  });

  // 音效开关
  dom.toggleSound.addEventListener('change', (e) => {
    window.soundEffects.toggleSound(e.target.checked);
  });

  // 弹窗重开按钮
  dom.modalBtnRestart.addEventListener('click', () => {
    dom.gameOverModal.classList.remove('show');
    if (game.mode === 'online' && network.isConnected) {
      network.send('RESTART_REQ');
      showTip('已向对手发送重开请求...');
    } else {
      game.reset();
    }
  });

  dom.modalBtnClose.addEventListener('click', () => {
    dom.gameOverModal.classList.remove('show');
  });

  // 快捷键支持
  window.addEventListener('keydown', (e) => {
    if (e.key === 'z' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      dom.btnUndo.click();
    } else if (e.key.toLowerCase() === 'h' && game.mode !== 'online') {
      game.requestHint();
    } else if (e.key.toLowerCase() === 'r') {
      dom.btnRestart.click();
    }
  });

  // 浮层提示信息
  let tipTimer = null;
  function showTip(text) {
    if (!dom.overlayTip) return;
    dom.overlayTip.textContent = text;
    dom.overlayTip.classList.add('show');
    clearTimeout(tipTimer);
    tipTimer = setTimeout(() => {
      dom.overlayTip.classList.remove('show');
    }, 2500);
  }

  // 表情气泡展示
  function showChatBubble(text, isSelf = true) {
    const bubble = document.createElement('div');
    bubble.className = 'chat-bubble';
    bubble.textContent = `${isSelf ? '我: ' : '对手: '}${text}`;
    bubble.style.top = isSelf ? '70%' : '20%';
    bubble.style.left = isSelf ? '60%' : '30%';

    dom.boardWrapper.appendChild(bubble);
    setTimeout(() => {
      bubble.remove();
    }, 2500);
  }

  // 初始界面渲染
  game.updateUI();
});
