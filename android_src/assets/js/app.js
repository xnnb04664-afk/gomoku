    function openThemeModal() {
      document.getElementById('themeModal').classList.add('show');
    }
    function closeThemeModal() {
      document.getElementById('themeModal').classList.remove('show');
    }

    // 🐾 手绘果冻风通用确认弹窗 (彻底消灭所有浏览器的“此页面显示”系统原生弹窗)
    let customConfirmCallback = null;
    function showCustomConfirm(text, onOk, onCancel, options = {}) {
      const modal = document.getElementById('customConfirmModal');
      if (!modal) {
        if (onOk) onOk();
        return;
      }
      document.getElementById('customConfirmText').textContent = text;
      document.getElementById('customConfirmTitle').textContent = options.title || '操作确认';
      document.getElementById('customConfirmIcon').textContent = options.icon || '🐾';
      const okBtn = document.getElementById('btnConfirmOk');
      if (okBtn) okBtn.textContent = options.okText || '确定';
      const cancelBtn = document.getElementById('btnConfirmCancel');
      if (cancelBtn) cancelBtn.textContent = options.cancelText || '取消';
      customConfirmCallback = { onOk, onCancel };
      modal.classList.add('show');
    }

    function closeCustomConfirm(result) {
      const modal = document.getElementById('customConfirmModal');
      if (modal) modal.classList.remove('show');
      if (result && customConfirmCallback && customConfirmCallback.onOk) {
        customConfirmCallback.onOk();
      } else if (!result && customConfirmCallback && customConfirmCallback.onCancel) {
        customConfirmCallback.onCancel();
      }
      customConfirmCallback = null;
    }

    // 🛡️ 全局拦截 window.confirm，彻底杜绝系统丑陋白色阻塞对话框
    window.confirm = function(msg) {
      showCustomConfirm(msg, () => {});
      return false;
    };

    const CURRENT_VERSION_TAG = 'v1.0.127';
    // 仅用于界面显示：内部补丁号按十位折叠到界面中间段。
    // 例如内部版本 v1.0.118 显示为 v1.1.8、v1.0.125 显示为 v1.2.5；
    // 更新比较仍使用 CURRENT_VERSION_TAG。
    function formatDisplayVersionTag(tag) {
      const value = String(tag || '').trim();
      const match = value.match(/^v?(\d+)\.(\d+)\.(\d+)$/);
      if (!match) return value;
      const major = Number(match[1]);
      const minor = Number(match[2]);
      const patch = Number(match[3]);
      if (!Number.isFinite(major) || !Number.isFinite(minor) || !Number.isFinite(patch) || patch < 100) {
        return `v${match[1]}.${match[2]}.${match[3]}`;
      }
      return `v${major}.${Math.max(0, Math.floor(patch / 10) - 10)}.${patch % 10}`;
    }
    const DISPLAY_VERSION_TAG = formatDisplayVersionTag(CURRENT_VERSION_TAG);
    const BOARD_SIZE = 15;
    const EMPTY = 0, BLACK = 1, WHITE = 2;
    let board = Array.from({length: 15}, () => Array(15).fill(0));
    let turn = BLACK;
    let history = [];
    let isOver = false;
    let gameWinnerColor = 0;
    let resultModalTimer = null;
    let resultModalGeneration = 0;
    let soundEnabled = true;

    // 自定义玩家昵称与头像
    let p1Name = localStorage.getItem('gomoku_p1Name') || '小能';
    let p1Avatar = localStorage.getItem('gomoku_p1Avatar') || '👦';
    let p2Name = localStorage.getItem('gomoku_p2Name') || '零碎小土豆';
    let p2Avatar = localStorage.getItem('gomoku_p2Avatar') || '👧';

    let editingPlayer = 1;
    let selectedAvatarData = p1Avatar;

    // 默认初始模式: 'ai' (人机对弈)
    let gameMode = 'ai';
    let myOnlineColor = BLACK;
    let peer = null;
    let conn = null;
    let myRoomId = '';
    let onlineRoundId = '';
    // 联机状态由 online.js 驱动，但这些值参与首屏状态恢复/持久化，必须先存在于核心作用域。
    let currentRoomCode = '';
    let onlineSessionId = '';
    let onlineJoinTicket = '';
    let onlineTransportGeneration = 0;
    let p2pChannel = null;
    let activeOnlineGuestUid = '';
    let activeOnlineOpponentUid = '';
    let lastActiveRoomCode = '';
    let onlineHeartbeatTimer = null;
    const pendingOnlinePings = new Map();
    let pendingOnlineUndoId = '';
    let activeOnlineUndoId = '';
    let pendingOnlineRestartId = '';
    let activeOnlineRestartId = '';

    // ==========================================
    // 🃏 干扰牌技能卡池系统 (每次随机抽取3张)
    // ==========================================
    const SKILL_CARD_POOL = [
      {
        id: 'destiny_dice',
        name: '命运神抽',
        sweetName: '心跳大轮盘 🎲',
        icon: '🎲',
        sweetIcon: '🎲',
        desc: '掷骰子！根据1~6点数随机爆发惊天离谱效果',
        sweetDesc: '摇出你的命运！大凶空军还是天命掀桌？~',
        needTarget: false
      },
      {
        id: 'identity_swap',
        name: '身份互换',
        sweetName: '你变我我变你 🔄',
        icon: '🔄',
        sweetIcon: '🔄',
        desc: '将场上所有棋子颜色互换，黑变白、白变黑',
        sweetDesc: '你的变我的，我的变你的！全盘颜色大互换~',
        needTarget: false
      },
      {
        id: 'double_move',
        name: '双星连珠',
        sweetName: '爱的抱抱 🎁',
        icon: '⚡',
        sweetIcon: '🎁',
        desc: '本回合获得额外落子机会',
        sweetDesc: '奖励本回合可以连续落两子~',
        needTarget: false
      },
      {
        id: 'remove_stone',
        name: '虚空陨石',
        sweetName: '奶茶暴击 🧋',
        icon: '💥',
        sweetIcon: '🧋',
        desc: '抹除对方一颗未成势的孤子',
        sweetDesc: '请喝奶茶！拿掉宝贝一颗孤子~',
        needTarget: true,
        targetType: 'enemy_stone'
      },
      {
        id: 'shift_stone',
        name: '移星换斗',
        sweetName: '偷心盗贼 💘',
        icon: '🌟',
        sweetIcon: '💘',
        desc: '将己方一子平移到相邻空格',
        sweetDesc: '把己方一子平移到相邻空格~',
        needTarget: true,
        targetType: 'shift'
      },
      {
        id: 'prophecy_block',
        name: '预言封锁',
        sweetName: '我猜我猜猜猜 🔮',
        icon: '🔮',
        sweetIcon: '🔮',
        desc: '预言对手下一步落点，命中则撤销该落子并返还对手回合',
        sweetDesc: '宝贝，我早就猜到啦！命中就帮你悔一步哦~',
        needTarget: true,
        targetType: 'empty'
      },
      {
        id: 'swap_color',
        name: '偷天换日',
        sweetName: '偏偏偏心 👑',
        icon: '🎭',
        sweetIcon: '👑',
        desc: '策反对方1颗棋子化为己用',
        sweetDesc: '这颗归我啦！偷换对方一颗棋子~',
        needTarget: true,
        targetType: 'enemy_stone'
      },
      {
        id: 'swap_positions',
        name: '移形换影',
        sweetName: '灵魂互换 💫',
        icon: '💫',
        sweetIcon: '💫',
        desc: '选己方1子与敌方1子互换位置',
        sweetDesc: '大换位！选己方1子与对方1子互换~',
        needTarget: true,
        targetType: 'two_stones'
      },
      {
        id: 'reforge_cards',
        name: '天降神抽',
        sweetName: '天降锦囊 🃏',
        icon: '🃏',
        sweetIcon: '🃏',
        desc: '神迹刷新！重置全部手牌(含已使用牌)，获得3张全新可用神技',
        sweetDesc: '奇迹大转盘！全部3张卡牌统统复活换新~',
        needTarget: false
      },
      {
        id: 'mega_bomb',
        name: '乾坤大乱 💣',
        sweetName: '掀翻棋盘 💣',
        icon: '💣',
        sweetIcon: '💣',
        desc: '引爆大炸弹！将场上所有棋子全部随机打乱重排',
        sweetDesc: '大招掀桌！把场上所有棋子全部随机洗牌打乱~',
        needTarget: false
      }
    ];

    let currentDrawnCards = []; // [card, card, card]
    let cardUsedStatus = [false, false, false];
    let activeSkill = null; // { slotIdx, skill, step, srcR, srcC }
    // 联机技能额度由 online.js 校验，但状态必须属于首屏棋局核心，保证本地 AI/复盘也可安全访问。
    const MAX_OPPONENT_SKILLS_PER_HAND = 3;
    let opponentSkillsUsedCount = 0;
    let opponentReforgeUsed = false;
    let prophecyPoint = null; // { r, c } 预言封锁目标点（对手下一步命中则撤销）
    let hasExtraMove = false; // 双星连珠额外落子状态
    let consecutiveMovesLeft = 0; // 连击落子计数器 (命运神抽狂暴连击等)
    let opponentFreeMove = false; // 命运神抽点数1: 对手免费补落一子状态
    let undoStack = []; // 包含棋盘 + 干扰牌 + 技能状态的高精度撤销快照栈

    function cloneSkillCardState(cards) {
      if (!Array.isArray(cards)) return [];
      return cards.map(card => (card && typeof card === 'object') ? { ...card } : card);
    }

    function saveUndoSnapshot(type, metadata = {}) {
      const snap = {
        type: type, // 'move' | 'skill'
        board: board.map(row => [...row]),
        history: history.map(h => ({ ...h })),
        turn: turn,
        currentDrawnCards: cloneSkillCardState(currentDrawnCards),
        cardUsedStatus: [...cardUsedStatus],
        prophecyPoint: prophecyPoint ? { ...prophecyPoint } : null,
        hasExtraMove: hasExtraMove,
        consecutiveMovesLeft: consecutiveMovesLeft,
        opponentFreeMove: opponentFreeMove,
        opponentSkillsUsedCount: opponentSkillsUsedCount,
        opponentReforgeUsed: opponentReforgeUsed,
        winningLine: winningLine ? winningLine.map(point => ({ ...point })) : null,
        isOver: isOver,
        isDraw: gameResultIsDraw,
        ...metadata
      };
      undoStack.push(snap);
      if (undoStack.length > 50) undoStack.shift();
      return snap;
    }

    const cvs = document.getElementById('cvs');
    let ctx = cvs.getContext('2d');
    const islandWrapper = document.getElementById('islandWrapper');

    let cWidth = 380, cHeight = 380, paddingX = 16, paddingY = 16, gridX = 23, gridY = 23, radius = 10;
    let graphicsQuality = (() => {
      try {
        const saved = localStorage.getItem('gomoku_graphics_quality_v1');
        return ['auto', 'high', 'smooth'].includes(saved) ? saved : 'auto';
      } catch (_) { return 'auto'; }
    })();

    function getAutoGraphicsTier() {
      const memory = Number(navigator.deviceMemory || 0);
      const cores = Number(navigator.hardwareConcurrency || 0);
      const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
      if (connection?.saveData || (memory > 0 && memory <= 3) || (cores > 0 && cores <= 4)) return 'smooth';
      if ((memory >= 8 || memory === 0) && cores >= 8) return 'high';
      return 'standard';
    }

    function getEffectiveGraphicsTier() {
      return graphicsQuality === 'auto' ? getAutoGraphicsTier() : graphicsQuality;
    }

    function getEffectiveCanvasDpr() {
      const tier = getEffectiveGraphicsTier();
      const cap = tier === 'high' ? 2.5 : (tier === 'smooth' ? 1.5 : 2);
      return Math.max(1, Math.min(window.devicePixelRatio || 1, cap));
    }

    function updateGraphicsQualityUI() {
      const effective = getEffectiveGraphicsTier();
      document.body.classList.toggle('low-spec-mode', effective === 'smooth');
      document.querySelectorAll('[data-quality]').forEach(button => {
        const active = button.dataset.quality === graphicsQuality;
        button.style.background = active ? '#0284c7' : '#f1f5f9';
        button.style.color = active ? '#fff' : '#475569';
      });
      const hint = document.getElementById('graphicsQualityHint');
      if (hint) hint.textContent = graphicsQuality === 'auto'
        ? `自动档当前：${effective === 'high' ? '高清' : (effective === 'smooth' ? '流畅' : '标准')} · ${getEffectiveCanvasDpr()}×`
        : `${graphicsQuality === 'high' ? '高清' : '流畅'}档 · ${getEffectiveCanvasDpr()}×`;
    }

    function setGraphicsQuality(value) {
      if (!['auto', 'high', 'smooth'].includes(value)) return;
      graphicsQuality = value;
      try { localStorage.setItem('gomoku_graphics_quality_v1', value); } catch (_) {}
      updateGraphicsQualityUI();
      ensureBoardSurface();
      showGameNotice(`⚡ 已切换到${value === 'auto' ? '自动画质' : (value === 'high' ? '高清画质' : '流畅画质')}`, false);
    }

    let dpr = getEffectiveCanvasDpr();

    function getNowTime() {
      const d = new Date();
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      const hh = String(d.getHours()).padStart(2, '0');
      const mm = String(d.getMinutes()).padStart(2, '0');
      return `${y}-${m}-${day} ${hh}:${mm}`;
    }

    let p1ChatTimer = null;
    let p2ChatTimer = null;
    const MAX_CHAT_HISTORY = 100;
    const MAX_CHAT_MESSAGE_CHARS = 500;
    let chatHistory = [
      { sender: 1, name: p1Name, avatar: p1Avatar, text: '你好呀~ 晴空草坪见！🌿', time: getNowTime() }
    ];

    function resetChatHistoryForRoom() {
      if (p1ChatTimer) clearTimeout(p1ChatTimer);
      if (p2ChatTimer) clearTimeout(p2ChatTimer);
      p1ChatTimer = null;
      p2ChatTimer = null;
      chatHistory = [
        { sender: 1, name: p1Name, avatar: p1Avatar, text: '你好呀~ 晴空草坪见！🌿', time: getNowTime() }
      ];
      const p1Bubble = document.getElementById('p1ChatBubble');
      const p2Bubble = document.getElementById('p2ChatBubble');
      if (p1Bubble) p1Bubble.classList.remove('show');
      if (p2Bubble) p2Bubble.classList.remove('show');
      renderChatHistory();
    }

    function escapeHtml(value) {
      return String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
      }[ch]));
    }

    const MAX_NETWORK_PROFILE_NAME_CHARS = 32;
    const MAX_NETWORK_AVATAR_CHARS = 12000;

    function normalizeNetworkName(value, fallback = '') {
      if (typeof value !== 'string') return fallback;
      const normalized = value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, MAX_NETWORK_PROFILE_NAME_CHARS);
      return normalized || fallback;
    }

    function isSafeNetworkAvatar(value) {
      if (typeof value !== 'string' || value.length > MAX_NETWORK_AVATAR_CHARS) return false;
      // 短文本/Emoji 只会作为转义后的文本渲染；长值必须通过头像来源校验。
      return value.length <= 64 || !!getSafeAvatarSource(value);
    }

    function getSafeAvatarSource(avatar) {
      if (avatar === "anime_boy" || avatar === "img/avatar_boy.png" || avatar === "img/anime_avatar_boy.jpg") {
        avatar = window.ANIME_AVATAR_BOY;
      } else if (avatar === "anime_girl" || avatar === "img/avatar_girl.png" || avatar === "img/anime_avatar_girl.jpg") {
        avatar = window.ANIME_AVATAR_GIRL;
      }
      if (typeof avatar !== "string") return null;
      if (avatar === "img/anime_avatar_boy.jpg" || avatar === "img/anime_avatar_girl.jpg") return avatar;
      if (avatar.startsWith("data:image/")) {
        if (avatar.length > 150000 || !/^data:image\/(?:png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=\s]+$/i.test(avatar)) return null;
        return avatar;
      }
      if (avatar.startsWith("https://")) {
        try {
          const parsed = new URL(avatar);
          if (parsed.protocol === "https:" && !parsed.username && !parsed.password && parsed.hostname && parsed.href.length <= 300) return parsed.href;
        } catch (_) {}
      }
      return null;
    }

    function renderAvatarElement(avatar, size = null) {
      const src = getSafeAvatarSource(avatar);
      if (src) {
        const sStyle = size ? `width:${size}px; height:${size}px;` : "width:100%; height:100%;";
        return `<img src="${escapeHtml(src)}" alt="avatar" style="${sStyle} border-radius:50%; object-fit:cover; display:block;" />`;
      }
      const label = String(avatar == null ? '👦' : avatar).slice(0, 32);
      return `<span style="display:inline-block; line-height:1; font-size:${size ? Math.round(size * 0.75) : 22}px;">${escapeHtml(label)}</span>`;
    }

    function updatePlayerHeaderUI() {
      const btnLeave = document.getElementById("btnLeaveRoom");
      const btnOnline = document.getElementById("btnOnline");
      const topRoomBar = document.getElementById("onlineRoomTopBar");
      const topRoomCode = document.getElementById("onlineRoomCodeLabel");

      if (gameMode === "online") {
        if (btnLeave) btnLeave.style.display = "flex";
        if (btnOnline) btnOnline.style.display = "none";
        if (topRoomBar) topRoomBar.style.display = "flex";
        if (topRoomCode) topRoomCode.textContent = currentRoomCode || "对战中";
      } else {
        if (btnLeave) btnLeave.style.display = "none";
        if (btnOnline) btnOnline.style.display = "flex";
        if (topRoomBar) topRoomBar.style.display = "none";
      }
      const isNarrow = typeof window !== 'undefined' && window.innerWidth <= 380;
      let p1ColorTag = isNarrow ? ' (●黑)' : ' (●黑子)';
      let p2ColorTag = isNarrow ? ' (○白)' : ' (○白子)';
      let p2DisplayName = p2Name;

      if (gameMode === 'ai') {
        p1ColorTag = isNarrow ? ' (●黑)' : ' (●黑子)';
        p2ColorTag = isNarrow ? ' (○白)' : ' (○白子)';
        p2DisplayName = '大师AI';
        document.getElementById('p2AvatarIcon').innerHTML = '🤖';
      } else if (gameMode === 'online') {
        // 联机对战：黑白子明确展示，且绝不显示“房主”，双方直接呈现真实昵称！
        if (myOnlineColor === BLACK) {
          p1ColorTag = isNarrow ? ' (●黑)' : ' (●黑子)';
          p2ColorTag = isNarrow ? ' (○白)' : ' (○白子)';
        } else {
          p1ColorTag = isNarrow ? ' (○白)' : ' (○白子)';
          p2ColorTag = isNarrow ? ' (●黑)' : ' (●黑子)';
        }
        p2DisplayName = (p2Name && p2Name.trim()) ? p2Name : '好友';
        document.getElementById('p2AvatarIcon').innerHTML = renderAvatarElement(p2Avatar);
      } else {
        // 双人同屏 pvp
        p1ColorTag = isNarrow ? ' (●黑)' : ' (●黑子)';
        p2ColorTag = isNarrow ? ' (○白)' : ' (○白子)';
        p2DisplayName = p2Name;
        document.getElementById('p2AvatarIcon').innerHTML = renderAvatarElement(p2Avatar);
      }

      if (typeof window.updateOnlineNetworkUI === 'function') window.updateOnlineNetworkUI();

      const scoreSuffix = hasRegisteredAccountSession() ? (isNarrow ? ` · ${currentUserScore}` : ` · ${currentUserScore}分`) : '';
      const fullP1Text = p1Name + p1ColorTag + scoreSuffix;
      const p1Label = document.getElementById('p1NameLabel');
      if (p1Label) {
        p1Label.textContent = fullP1Text;
        p1Label.title = p1Name + (myOnlineColor === WHITE ? ' (○白子)' : ' (●黑子)') + (hasRegisteredAccountSession() ? ` · ${currentUserScore}分` : '');
      }
      document.getElementById('p1AvatarIcon').innerHTML = renderAvatarElement(p1Avatar);
      const p2Label = document.getElementById('p2NameLabel');
      if (p2Label) {
        const fullP2Text = p2DisplayName + p2ColorTag;
        p2Label.textContent = fullP2Text;
        p2Label.title = p2DisplayName + (myOnlineColor === WHITE ? ' (●黑子)' : ' (○白子)');
      }
    }

    function setOnlineColor(color) {
      if (color === WHITE || color === 'white' || color === 'WHITE') {
        myOnlineColor = WHITE;
      } else if (color === BLACK || color === 'black' || color === 'BLACK') {
        myOnlineColor = BLACK;
      }
      return myOnlineColor;
    }

    // 🎯 根据棋子颜色准确获取玩家名称（适配联机执白、联机执黑、人机及同屏模式）
    function getPlayerNameByColor(color) {
      if (gameMode === 'online') {
        if (color === myOnlineColor) {
          return p1Name || '我';
        } else {
          return (p2Name && p2Name.trim()) ? p2Name : '好友';
        }
      } else if (gameMode === 'ai') {
        return color === BLACK ? (p1Name || '玩家') : '大师AI';
      } else {
        // 双人同屏 pvp
        return color === BLACK ? (p1Name || '黑方') : (p2Name || '白方');
      }
    }

    function renderChatHistory() {
      const box = document.getElementById('chatHistoryBox');
      if (box) {
        box.innerHTML = chatHistory.map(msg => `
          <div class="msg-row ${msg.sender === 1 ? 'right' : 'left'}">
            <div class="msg-avatar">${renderAvatarElement(msg.avatar)}</div>
            <div class="msg-body">
              <div class="msg-info">${escapeHtml(msg.name)} · ${escapeHtml(msg.time)}</div>
              <div class="msg-text">${escapeHtml(msg.text)}</div>
            </div>
          </div>
        `).join('');
        box.scrollTop = box.scrollHeight;
      }

      // 💬 常驻聊天框独占单行展示最新 3 条对局消息 (每条独占一行，绝不重叠挤压)
      const mainContent = document.getElementById('mainChatContent');
      if (!mainContent) return;
      if (!chatHistory || chatHistory.length === 0) {
        mainContent.innerHTML = `
          <div class="main-chat-line" style="color:#8c7b75; font-size:12px; justify-content:center; height:100%;">
            <span>💬 暂无对局消息，点击即可畅聊~</span>
          </div>
        `;
      } else {
        const recent3 = chatHistory.slice(-3);
        mainContent.innerHTML = recent3.map(m => `
          <div class="main-chat-line">
            <span class="${m.sender === 1 ? 'chat-tag-me' : 'chat-tag-other'}">${m.sender === 1 ? '我方' : '对方'}</span>
            <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:1; font-weight:900;">${escapeHtml(m.text)}</span>
          </div>
        `).join('');
      }
    }

    function showBubble(player, text) {
      playPopSound();
      if (player === 1) {
        const bubble = document.getElementById('p1ChatBubble');
        bubble.textContent = text;
        bubble.classList.remove('show');
        void bubble.offsetWidth;
        bubble.classList.add('show');
        clearTimeout(p1ChatTimer);
        p1ChatTimer = setTimeout(() => bubble.classList.remove('show'), 5000);
      } else {
        const bubble = document.getElementById('p2ChatBubble');
        bubble.textContent = text;
        bubble.classList.remove('show');
        void bubble.offsetWidth;
        bubble.classList.add('show');
        clearTimeout(p2ChatTimer);
        p2ChatTimer = setTimeout(() => bubble.classList.remove('show'), 5000);
      }
    }

    function addMessage(sender, text) {
      const normalizedText = String(text == null ? '' : text).trim().slice(0, MAX_CHAT_MESSAGE_CHARS);
      if (!normalizedText) return;
      const name = sender === 1 ? p1Name : (gameMode === 'ai' ? '大师AI' : p2Name);
      const avatar = sender === 1 ? p1Avatar : (gameMode === 'ai' ? '🤖' : p2Avatar);
      chatHistory.push({ sender, name, avatar, text: normalizedText, time: getNowTime() });
      if (chatHistory.length > MAX_CHAT_HISTORY) {
        chatHistory.splice(0, chatHistory.length - MAX_CHAT_HISTORY);
      }
      renderChatHistory();
      showBubble(sender, normalizedText);

      if (gameMode === 'online' && conn && conn.open && sender === 1) {
        // 对方已经有本地档案，聊天报文不重复携带头像，降低 MQTT/P2P 负载。
        conn.send({ type: 'chat', text: normalizedText });
      }
    }

    function sendChat(msg) {
      if (!msg || !msg.trim()) return;
      if (gameMode === 'online' && (!conn || !conn.open)) {
        showGameNotice("⚠️ 联机连接未就绪或已中断，聊天未能送达对方", true);
      }
      addMessage(1, msg.trim());
      const input = document.getElementById('chatInput');
      input.value = '';
      input.focus();
    }

    // --- 📷 玩家相册照片上传与自动压缩为 Base64 ---
    function triggerPhotoUpload() {
      document.getElementById('avatarFileInput').click();
    }

    function handlePhotoUpload(event) {
      const file = event.target.files && event.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          if (file.type && file.type.includes('svg')) {
            showGameNotice('🛡️ 为防止脚本注入，暂不支持 SVG 格式图片，请选用 JPG/PNG 图片~', true);
            return;
          }
          const offCanvas = document.createElement('canvas');
          offCanvas.width = 160;
          offCanvas.height = 160;
          const offCtx = offCanvas.getContext('2d');
          offCtx.imageSmoothingEnabled = true;
          offCtx.imageSmoothingQuality = 'high';

          const minDim = Math.min(img.width, img.height);
          const sx = (img.width - minDim) / 2;
          const sy = (img.height - minDim) / 2;

          offCtx.drawImage(img, sx, sy, minDim, minDim, 0, 0, 160, 160);
          const compressedBase64 = offCanvas.toDataURL('image/jpeg', 0.88);

          selectedAvatarData = compressedBase64;
          const prevEl = document.getElementById('bigAvatarPreview');
          if (prevEl) {
            prevEl.innerHTML = renderAvatarElement(compressedBase64);
          }
          document.querySelectorAll('.avatar-opt, .anime-avatar-card').forEach(el => el.classList.remove('selected'));
          _applyAvatarChange(compressedBase64);
          showGameNotice("🎉 真实照片头像设置成功！已实时生效~");
        };
        img.src = e.target.result;
      };
      reader.readAsDataURL(file);
      event.target.value = '';
    }

    // --- 自定义昵称与相册头像弹窗交互 ---

    function initAnimeThumbnails() {
      const apply = () => {
        const b = document.getElementById('animeImgBoy');
        const g = document.getElementById('animeImgGirl');
        if (b && window.ANIME_AVATAR_BOY) b.src = window.ANIME_AVATAR_BOY;
        if (g && window.ANIME_AVATAR_GIRL) g.src = window.ANIME_AVATAR_GIRL;
      };
      if (window.ANIME_AVATAR_BOY && window.ANIME_AVATAR_GIRL) {
        apply();
        return Promise.resolve(true);
      }
      if (typeof window.ensureGomokuResource === 'function') {
        return window.ensureGomokuResource('avatars').then(() => {
          apply();
          return true;
        }).catch(() => false);
      }
      apply();
      return Promise.resolve(false);
    }

    function openProfileModal(player = 1) {
      updateAccountUI();
      // 无论我方执黑还是执白，在本地屏幕上：
      // p1 永远是我方（可随时修改），p2 永远是对方（AI或好友）
      if (player === 2) {
        if (gameMode === 'online') {
          showGameNotice('🔒 联机中只能修改自己的昵称与头像哦~', true);
          return;
        }
        if (gameMode === 'ai') {
          showGameNotice('🤖 大师AI 为智能电脑，无法修改档案哦~', true);
          return;
        }
      }
      editingPlayer = 1;
      const currentName = p1Name;
      selectedAvatarData = p1Avatar;

      const titleEl = document.getElementById('profileModalTitle');
      if (titleEl) titleEl.textContent = '👤 自定义我的昵称与头像';
      const syncTip = document.getElementById('profileSyncTip');
      if (syncTip) {
        if (hasRegisteredAccountSession()) {
          syncTip.innerHTML = `✅ <span style="color:#15803d;">已登录正式账号 (${escapeHtml(currentUsername || p1Name)})</span> · 修改后登录账号与全服天梯将同步变更`;
        } else {
          syncTip.innerHTML = `⚠️ <span style="color:#d97706;">当前为游客模式 (未登录)</span> · 修改仅在本地生效，登录正式账号后方可上天梯榜`;
        }
      }
      const inputEl = document.getElementById('inputProfileName');
      if (inputEl) inputEl.value = currentName;
      const prevEl = document.getElementById('bigAvatarPreview');
      if (prevEl) {
        prevEl.innerHTML = renderAvatarElement(selectedAvatarData);
      }

      const opts = document.querySelectorAll('.avatar-opt');
      opts.forEach(el => {
        el.classList.toggle('selected', el.textContent.trim() === selectedAvatarData);
      });

      const boyVal = window.ANIME_AVATAR_BOY;
      const girlVal = window.ANIME_AVATAR_GIRL;
      const boyCard = document.getElementById('animeCardBoy');
      const girlCard = document.getElementById('animeCardGirl');
      if (boyCard) boyCard.classList.toggle('selected', selectedAvatarData === boyVal || selectedAvatarData === 'anime_boy' || selectedAvatarData === 'img/avatar_boy.png');
      if (girlCard) girlCard.classList.toggle('selected', selectedAvatarData === girlVal || selectedAvatarData === 'anime_girl' || selectedAvatarData === 'img/avatar_girl.png');

      // ✨ 实时预览：昵称输入框每次按键都立即更新 UI + 联机同步
      if (inputEl) {
        inputEl.oninput = () => {
          const val = inputEl.value.trim();
          if (!val) return;
          p1Name = val;
          localStorage.setItem('gomoku_p1Name', p1Name);
          updatePlayerHeaderUI();
          if (gameMode === 'online' && conn && conn.open) {
            conn.send({ type: 'profile_sync', name: p1Name, avatar: getNetworkAvatarValue(selectedAvatarData) });
          }
        };
      }

      const modalEl = document.getElementById('profileModal');
      if (modalEl) modalEl.classList.add('show');
      // 打开个人资料后再加载大体积动漫头像数据，不影响首屏进入棋盘。
      void initAnimeThumbnails();
    }

    // 选 Emoji 头像 → 立即更新预览 + 保存 + 同步

        const RANDOM_NICK_PREFIXES = ["逍遥", "灵动", "悠然", "天元", "太极", "青云", "星月", "清风", "傲雪", "弈心", "落子", "指尖", "妙手", "执白", "弈仙", "玄武", "朱雀", "白虎", "青龙", "昆仑"];
    const RANDOM_NICK_SUFFIXES = ["弈客", "先锋", "棋王", "行者", "少侠", "剑客", "棋神", "大师", "隐士", "居士", "仙友", "棋圣", "游侠", "国手", "棋尊", "神童", "棋痴", "高足"];
    const RANDOM_DEFAULT_AVATARS = ["👦", "👧", "🐱", "🐶", "🦊", "🐼", "🦁", "🐯", "🦄", "🐲", "🧙‍♂️", "🥷", "👑", "🐧", "🐰", "🦉", "🦋"];

    function getRandomDefaultNickname() {
      const p = RANDOM_NICK_PREFIXES[Math.floor(Math.random() * RANDOM_NICK_PREFIXES.length)];
      const s = RANDOM_NICK_SUFFIXES[Math.floor(Math.random() * RANDOM_NICK_SUFFIXES.length)];
      const n = Math.floor(10 + Math.random() * 90);
      return p + s + "_" + n;
    }

    function getRandomDefaultAvatar() {
      return RANDOM_DEFAULT_AVATARS[Math.floor(Math.random() * RANDOM_DEFAULT_AVATARS.length)];
    }

    function randomizeProfileNameAndAvatar() {
      const newName = getRandomDefaultNickname();
      const newAvatar = getRandomDefaultAvatar();
      p1Name = newName;
      p1Avatar = newAvatar;
      selectedAvatarData = newAvatar;
      localStorage.setItem('gomoku_p1Name', p1Name);
      localStorage.setItem('gomoku_p1Avatar', p1Avatar);

      const inputEl = document.getElementById('inputProfileName');
      if (inputEl) inputEl.value = newName;
      const prevEl = document.getElementById('bigAvatarPreview');
      if (prevEl) prevEl.innerHTML = renderAvatarElement(newAvatar);
      document.querySelectorAll('.avatar-opt, .anime-avatar-card').forEach(el => {
        el.classList.toggle('selected', el.textContent.trim() === newAvatar);
      });
      updatePlayerHeaderUI();
      if (gameMode === 'online' && conn && conn.open) {
        conn.send({ type: 'profile_sync', name: p1Name, avatar: getNetworkAvatarValue(selectedAvatarData) });
      }
      showGameNotice(`🎲 已为您随机分配昵称【${newName}】与头像 ${newAvatar}`);
    }

    function selectAvatar(elem, char) {
      selectedAvatarData = char;
      document.querySelectorAll('.avatar-opt, .anime-avatar-card').forEach(el => el.classList.remove('selected'));
      elem.classList.add('selected');
      const prevEl = document.getElementById('bigAvatarPreview');
      if (prevEl) {
        prevEl.innerHTML = renderAvatarElement(char);
      }
      _applyAvatarChange(char);
      showGameNotice('✨ 头像已更换！');
    }

    // 选图片头像 → 立即更新预览 + 保存 + 同步
    function selectImgAvatar(elem, dataUrl) {
      if (!dataUrl) dataUrl = (elem && elem.id === 'animeCardGirl') ? window.ANIME_AVATAR_GIRL : window.ANIME_AVATAR_BOY;
      selectedAvatarData = dataUrl;
      document.querySelectorAll('.avatar-opt, .anime-avatar-card').forEach(el => el.classList.remove('selected'));
      elem.classList.add('selected');
      const prevEl = document.getElementById('bigAvatarPreview');
      if (prevEl) {
        prevEl.innerHTML = renderAvatarElement(dataUrl);
      }
      _applyAvatarChange(dataUrl);
      showGameNotice('✨ 头像已更换！');
    }

    // 公共：应用头像变更到本地存储 + UI + 联机同步
    function _applyAvatarChange(avatarData) {
      const inputEl = document.getElementById('inputProfileName');
      const curName = (inputEl ? inputEl.value.trim() : '') || p1Name;
      p1Avatar = avatarData;
      selectedAvatarData = avatarData;
      localStorage.setItem('gomoku_p1Avatar', p1Avatar);
      updatePlayerHeaderUI();
      // 联机实时同步头像给对方
      if (gameMode === 'online' && conn && conn.open) {
        conn.send({ type: 'profile_sync', name: curName, avatar: getNetworkAvatarValue(avatarData) });
      }
    }

    function getAvatarSyncValue(avatar) {
      if (avatar === 'anime_boy' || avatar === 'img/avatar_boy.png') return 'anime_boy';
      if (avatar === 'anime_girl' || avatar === 'img/avatar_girl.png') return 'anime_girl';
      if (typeof window.ANIME_AVATAR_BOY === 'string' && avatar === window.ANIME_AVATAR_BOY) return 'anime_boy';
      if (typeof window.ANIME_AVATAR_GIRL === 'string' && avatar === window.ANIME_AVATAR_GIRL) return 'anime_girl';
      return avatar;
    }

    function getNetworkAvatarValue(avatar) {
      const value = getAvatarSyncValue(avatar);
      return isSafeNetworkAvatar(value) ? value : '👦';
    }

    async function saveProfile() {
      const nameInput = document.getElementById('inputProfileName').value.trim();
      if (!nameInput) return showGameNotice('⚠️ 账号昵称不能为空哦！', true);

      if (editingPlayer === 1) {
        const hasRegisteredAccount = hasRegisteredAccountSession();
        const prevP1Name = p1Name;
        const prevUsername = currentUsername;
        const prevP1Avatar = p1Avatar;

        p1Name = nameInput;
        p1Avatar = selectedAvatarData;

        // 🌟 同步到云端数据库：修改 username 和 nickname
        if (hasRegisteredAccount) {
          try {
            const res = await safeApiFetch('/api/user/update_profile', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                uid: currentUserUid,
                token: currentUserToken,
                nickname: p1Name,
                avatar: getAvatarSyncValue(p1Avatar)
              })
            });
            const data = await res.json();
            if (data && data.code === 0) {
              console.log('[saveProfile] 账号名与天梯榜已同步:', p1Name);
              localStorage.setItem('gomoku_p1Name', p1Name);
              localStorage.setItem('gomoku_p1Avatar', p1Avatar);
              currentUsername = p1Name;
              localStorage.setItem('gomoku_user_username', currentUsername);
              if (typeof AndroidNativeApp !== "undefined" && AndroidNativeApp.saveUserLogin) {
                try { AndroidNativeApp.saveUserLogin(currentUserUid, currentUsername, currentUserToken, p1Name, p1Avatar); } catch(e) {}
              }
              if (data.data) {
                applyUserData(data.data);
              }
              if (Array.isArray(cachedLeaderboard)) {
                cachedLeaderboard.forEach(item => {
                  if (currentUserUid && String(item.uid) === String(currentUserUid)) {
                    item.name = p1Name;
                    item.avatar = p1Avatar;
                  }
                });
              }
              updatePlayerHeaderUI();
              updateAccountUI();
              leaderboardLoadedAt = 0;
              fetchGlobalLeaderboard(false);
              showGameNotice('🎉 保存成功！账号与昵称已应用并同步至全服天梯！', false);
            } else {
              // 服务器拒绝（如名称已占用）
              p1Name = prevP1Name;
              currentUsername = prevUsername;
              p1Avatar = prevP1Avatar;
              selectedAvatarData = prevP1Avatar;
              const inputEl = document.getElementById('inputProfileName');
              if (inputEl) inputEl.value = prevP1Name;
              const prevEl = document.getElementById('bigAvatarPreview');
              if (prevEl) prevEl.innerHTML = renderAvatarElement(prevP1Avatar);
              updatePlayerHeaderUI();
              updateAccountUI();
              showGameNotice('⚠️ 修改未生效: ' + (data && data.msg ? data.msg : '该名称已被占用或校验失败'), true);
              return;
            }
          } catch(e) {
            console.warn('[saveProfile sync error]', e);
            // 离线/网络故障兜底：先保留在本地，提醒用户稍后联网同步
            localStorage.setItem('gomoku_p1Name', p1Name);
            localStorage.setItem('gomoku_p1Avatar', p1Avatar);
            updatePlayerHeaderUI();
            updateAccountUI();
            showGameNotice('⚠️ 网络离线，修改已暂存本地，联网后将自动同步天梯', true);
          }
        } else {
          // 游客模式
          localStorage.setItem('gomoku_p1Name', p1Name);
          localStorage.setItem('gomoku_p1Avatar', p1Avatar);
          updatePlayerHeaderUI();
          updateAccountUI();
          showGameNotice('💾 游客昵称已保存在本地。登录正式账号即可同步至全服天梯榜！', false);
        }
      } else {
        p2Name = nameInput;
        p2Avatar = selectedAvatarData;
        localStorage.setItem('gomoku_p2Name', p2Name);
        localStorage.setItem('gomoku_p2Avatar', p2Avatar);
        updatePlayerHeaderUI();
        updateAccountUI();
        showGameNotice('💾 对手设置已保存在本地', false);
      }

      // 保存时再做一次完整同步（确保对方数据最终一致）
      if (gameMode === 'online' && conn && conn.open && editingPlayer === 1) {
        conn.send({ type: 'profile_sync', name: p1Name, avatar: getNetworkAvatarValue(p1Avatar) });
      }
    }

    function closeProfileModal() {
      // 清除实时监听器，防止泄漏
      const nameInput = document.getElementById('inputProfileName');
      if (nameInput) nameInput.oninput = null;
      document.getElementById('profileModal').classList.remove('show');
    }

    function buildChatExportText() {
      let txt = `===================================\n🌿 五子棋·晴空对决 对局聊天记录\n⏰ 导出时间: ${getNowTime()}\n===================================\n\n`;
      chatHistory.forEach(item => { txt += `[${item.time}] ${item.name}: ${item.text}\n`; });
      return txt + `\n===================================\n`;
    }

    async function exportChatTxt() {
      if (chatHistory.length === 0) {
        showGameNotice("暂无聊天记录可导出哦~", true);
        return false;
      }

      const txt = buildChatExportText();
      const fileName = `五子棋聊天记录_${Date.now()}.txt`;

      // Android WebView 对 blob: 下载链接没有稳定的 DownloadListener 回调，交给系统保存文档可确保手机真正落盘。
      if (window.AndroidNativeApp && typeof window.AndroidNativeApp.exportChatText === 'function') {
        try {
          if (window.AndroidNativeApp.exportChatText(txt, fileName)) {
            showGameNotice("📄 已打开系统保存位置，请选择下载文件夹保存 TXT", false);
            return true;
          }
        } catch (error) {
          console.warn('[chat export native bridge]', error);
        }
      }

      // 支持 Web Share 的移动浏览器直接弹出分享面板，分享的是实际 TXT 文件而不是 blob 地址。
      try {
        const file = new File([txt], fileName, { type: 'text/plain' });
        const shareData = { title: '五子棋对局聊天记录', files: [file] };
        if (navigator.share && (!navigator.canShare || navigator.canShare(shareData))) {
          await navigator.share(shareData);
          showGameNotice("🎉 聊天记录已导出，可在分享面板中保存 TXT", false);
          return true;
        }
      } catch (error) {
        // 用户主动关闭分享面板时不再弹出错误；其他情况继续走浏览器下载兜底。
        if (error && error.name === 'AbortError') return false;
        console.warn('[chat export share fallback]', error);
      }

      // 桌面浏览器及旧版 WebView 的兼容兜底：延迟释放 URL，避免点击后文件还未被读取就失效。
      try {
        const blob = new Blob([txt], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        a.rel = 'noopener';
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 2000);
        showGameNotice("🎉 聊天记录已导出为 TXT", false);
        return true;
      } catch (error) {
        console.error('[chat export failed]', error);
        showGameNotice("⚠️ 当前设备无法保存 TXT，请检查文件权限后重试", true);
        return false;
      }
    }

    function copyChatHistory() {
      if (chatHistory.length === 0) return alert("暂无聊天记录可复制~");
      let txt = `【五子棋对局聊天记录】\n`;
      chatHistory.forEach(item => { txt += `[${item.time}] ${item.name}: ${item.text}\n`; });
      navigator.clipboard ? navigator.clipboard.writeText(txt).then(() => alert("📋 聊天记录已复制！")) : alert("📋 已复制！");
    }

    function openChatDrawer() {
      renderChatHistory();
      document.getElementById('chatBackdrop').classList.add('show');
      setTimeout(() => document.getElementById('chatInput').focus(), 150);
    }
    function closeChatDrawer() {
      document.getElementById('chatBackdrop').classList.remove('show');
      document.getElementById('chatInput').value = '';
    }

    // ==========================================
    // ==========================================
    // ==========================================
    // 🧠 五子棋终极算力·九段大师级 抗干扰纯棋力 God-Tier AI 引擎
    // ==========================================
    // 纯棋力坚守原则：AI 严守五子棋传统棋规，绝不施放任何超自然卡牌，仅凭超神算力与厚势大局观制胜！
    // 核心抗干扰特性：
    // 1. 🕸️ 超饱和立体交叉攻势：专精构筑「双冲四 / 四三杀 / 活三双活二 / 三路活二网」多核心立体阵型，
    //    哪怕玩家使用一张抹除或策反炸掉其中一颗子，其余暗线依然多路成杀，单张卡牌根本防不胜防！
    // 2. 🛡️ 八卦日字格金刚联防 (Knight-Move Bagua Defense)：引入传统五子棋日字马步拓扑互保，
    //    网状结构天然克制穿透与策反，具备极强抗破坏抗干扰容灾弹性！
    // 3. ⚡ 破阵极速自愈 (Rapid Disruption Healing)：棋盘受损时秒级识别断点并以最高权值修复或反攻！
    // 4. 🔮 预言封锁免疫规避：遇玩家预言禁手秒切次选杀手步，化解对手战术！
    // 5. 🎯 VCF + VCT 5 步深度连攻算杀：连续逼将强制应手，让玩家疲于防守难以反扑！

    const POS_WEIGHT = [
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0],
      [0, 1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 1, 0],
      [0, 1, 2, 3, 3, 3, 3, 3, 3, 3, 3, 3, 2, 1, 0],
      [0, 1, 2, 3, 4, 4, 4, 4, 4, 4, 4, 3, 2, 1, 0],
      [0, 1, 2, 3, 4, 5, 5, 5, 5, 5, 4, 3, 2, 1, 0],
      [0, 1, 2, 3, 4, 5, 6, 6, 6, 5, 4, 3, 2, 1, 0],
      [0, 1, 2, 3, 4, 5, 6, 8, 6, 5, 4, 3, 2, 1, 0],
      [0, 1, 2, 3, 4, 5, 6, 6, 6, 5, 4, 3, 2, 1, 0],
      [0, 1, 2, 3, 4, 5, 5, 5, 5, 5, 4, 3, 2, 1, 0],
      [0, 1, 2, 3, 4, 4, 4, 4, 4, 4, 4, 3, 2, 1, 0],
      [0, 1, 2, 3, 3, 3, 3, 3, 3, 3, 3, 3, 2, 1, 0],
      [0, 1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 1, 0],
      [0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
    ];

    const KNIGHT_DIRS = [
      [-2, -1], [-2, 1], [-1, -2], [-1, 2],
      [1, -2], [1, 2], [2, -1], [2, 1]
    ];

    // 🚀 【C++级别极致性能】定型数组位运算棋型哈希置换表 (Zero-GC / 0内存分配)
    // 9个交点，每点2位 (00: 空, 01: 己方, 10: 敌方/边界)，共 2^18 = 262,144 种空间
    let BITWISE_PATTERN_TABLE = null;
    function ensureBitwisePatternTable() {
      if (BITWISE_PATTERN_TABLE) return BITWISE_PATTERN_TABLE;
      BITWISE_PATTERN_TABLE = new Uint8Array(262144);
      for (let key = 0; key < 262144; key++) {
        let s = '';
        for (let pos = 8; pos >= 0; pos--) {
          const val = (key >> (pos * 2)) & 3;
          if (val === 1) s += '1';
          else if (val === 0) s += '0';
          else s += '2';
        }
        let res = 0;
        if (s.includes('11111')) res = 1;
        else if (s.includes('011110')) res = 2;
        else if (s.includes('211110') || s.includes('011112') || s.includes('10111') || s.includes('11011') || s.includes('11101')) res = 3;
        else if (s.includes('01110') || s.includes('010110') || s.includes('011010')) res = 4;
        else if (s.includes('211100') || s.includes('001112') || s.includes('210110') || s.includes('011012') || s.includes('211010') || s.includes('010112') || s.includes('10011') || s.includes('11001') || s.includes('10101') || s.includes('2011102')) res = 5;
        else if (s.includes('001100') || s.includes('010100') || s.includes('001010') || s.includes('010010')) res = 6;
        else if (s.includes('211000') || s.includes('000112') || s.includes('210100') || s.includes('001012') || s.includes('201010') || s.includes('010102') || s.includes('10001')) res = 7;
        BITWISE_PATTERN_TABLE[key] = res;
      }
      return BITWISE_PATTERN_TABLE;
    }

    function countPointPatterns(boardState, r, c, color) {
      ensureBitwisePatternTable();
      const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];
      let five = 0, flex4 = 0, block4 = 0, flex3 = 0, block3 = 0, flex2 = 0, block2 = 0;

      for (let d = 0; d < 4; d++) {
        const dr = dirs[d][0], dc = dirs[d][1];
        let key = 0;
        for (let i = -4; i <= 4; i++) {
          const nr = r + i * dr, nc = c + i * dc;
          let val = 2;
          if (nr >= 0 && nr < 15 && nc >= 0 && nc < 15) {
            const cell = (i === 0) ? color : boardState[nr][nc];
            val = (cell === color) ? 1 : (cell === EMPTY ? 0 : 2);
          }
          key = (key << 2) | val;
        }
        const type = BITWISE_PATTERN_TABLE[key];
        if (type === 1) five++;
        else if (type === 2) flex4++;
        else if (type === 3) block4++;
        else if (type === 4) flex3++;
        else if (type === 5) block3++;
        else if (type === 6) flex2++;
        else if (type === 7) block2++;
      }

      return { five, flex4, block4, flex3, block3, flex2, block2 };
    }

    // 🛡️ 抗干扰超立体复合形态加权
    function evaluateMoveScore(pat) {
      if (pat.five > 0) return 10000000;
      if (pat.flex4 > 0) return 2500000;
      if (pat.block4 >= 2) return 1800000;
      if (pat.block4 > 0 && pat.flex3 > 0) return 1600000;
      if (pat.flex3 >= 2) return 1200000;

      // ⚡ 极强抗干扰复合结构：活三带双活二 或 冲四带双活二
      if (pat.flex3 > 0 && pat.flex2 >= 2) return 800000;
      if (pat.block4 > 0 && pat.flex2 >= 2) return 750000;
      if (pat.flex2 >= 3) return 400000; // 三路活二交叉立体网

      let score = 0;
      if (pat.block4 > 0) score += 150000 * pat.block4;
      if (pat.flex3 > 0) score += 90000 * pat.flex3;
      if (pat.block3 > 0 && pat.flex2 > 0) score += 35000;
      if (pat.block3 > 0) score += 8000 * pat.block3;
      if (pat.flex2 >= 2) score += 15000;
      if (pat.flex2 > 0) score += 4000 * pat.flex2;
      if (pat.block2 > 0) score += 400 * pat.block2;
      return score;
    }

    // 八卦马步抗干扰网格互保强度
    function getBaguaDefenseBonus(boardState, r, c, color) {
      let knightConnections = 0;
      for (const [kr, kc] of KNIGHT_DIRS) {
        const nr = r + kr, nc = c + kc;
        if (nr >= 0 && nr < 15 && nc >= 0 && nc < 15 && boardState[nr][nc] === color) {
          knightConnections++;
        }
      }
      return knightConnections >= 2 ? 1600 : (knightConnections === 1 ? 550 : 0);
    }

    function getPointScore(boardState, r, c, aiColor) {
      const oppColor = aiColor === BLACK ? WHITE : BLACK;

      const myPat = countPointPatterns(boardState, r, c, aiColor);
      const myScore = evaluateMoveScore(myPat);

      const oppPat = countPointPatterns(boardState, r, c, oppColor);
      const oppScore = evaluateMoveScore(oppPat);

      if (myPat.five > 0) return 20000000;
      if (oppPat.five > 0) return 18000000;
      if (myPat.flex4 > 0) return 15000000;
      if (oppPat.flex4 > 0) return 13000000;
      if ((myPat.block4 >= 2) || (myPat.block4 > 0 && myPat.flex3 > 0)) return 11000000;
      if ((oppPat.block4 >= 2) || (oppPat.block4 > 0 && oppPat.flex3 > 0)) return 9800000;
      if (myPat.flex3 >= 2) return 8500000;
      if (oppPat.flex3 >= 2) return 7500000;
      if (myPat.block4 > 0) return 5500000 + myScore;
      if (oppPat.block4 > 0) return 5000000 + oppScore;
      // ⚔️ 攻防权重全面激进升级：鼓励主动进攻做棋，摆脱过度被动防守
      if (myPat.flex3 > 0) return 4500000 + myScore * 1.4;
      if (oppPat.flex3 > 0) return 3000000 + oppScore * 0.95;

      const baguaBonus = getBaguaDefenseBonus(boardState, r, c, aiColor);
      const posVal = POS_WEIGHT[r][c] * 18;
      return myScore * 1.6 + oppScore * 0.85 + posVal + baguaBonus;
    }

    function getCandidateMoves(boardState, aiColor, maxCandidates = 16) {
      const list = [];
      for (let r = 0; r < 15; r++) {
        for (let c = 0; c < 15; c++) {
          if (boardState[r][c] !== EMPTY) continue;

          let near = false;
          for (let dr = -2; dr <= 2 && !near; dr++) {
            for (let dc = -2; dc <= 2 && !near; dc++) {
              const nr = r + dr, nc = c + dc;
              if (nr >= 0 && nr < 15 && nc >= 0 && nc < 15 && boardState[nr][nc] !== EMPTY) {
                near = true;
              }
            }
          }
          if (!near) continue;

          const score = getPointScore(boardState, r, c, aiColor);
          list.push({ r, c, score });
        }
      }

      list.sort((a, b) => b.score - a.score);
      return list.slice(0, maxCandidates);
    }

    // =========================================================================
    // 👑 【无敌神级大师人机 AI 引擎】(C级定型数组 + 10步VCF算杀 + Alpha-Beta极值博弈)
    // =========================================================================

    // 🚀 10 步连续冲四绝杀深度算杀 (VCF: Victory by Continuous Four)
    function searchVCF(boardState, color, depth = 10) {
      if (depth <= 0) return null;
      const opp = color === BLACK ? WHITE : BLACK;

      for (let r = 0; r < 15; r++) {
        for (let c = 0; c < 15; c++) {
          if (boardState[r][c] !== EMPTY) continue;
          const pat = countPointPatterns(boardState, r, c, color);
          if (pat.five > 0 || pat.flex4 > 0) return { r, c };

          if (pat.block4 > 0) {
            boardState[r][c] = color;
            let defR = -1, defC = -1;
            for (let dr = 0; dr < 15; dr++) {
              for (let dc = 0; dc < 15; dc++) {
                if (boardState[dr][dc] === EMPTY) {
                  const checkPat = countPointPatterns(boardState, dr, dc, color);
                  if (checkPat.five > 0) { defR = dr; defC = dc; break; }
                }
              }
              if (defR !== -1) break;
            }

            let canWin = false;
            if (defR !== -1) {
              boardState[defR][defC] = opp;
              const next = searchVCF(boardState, color, depth - 1);
              boardState[defR][defC] = EMPTY;
              if (next) canWin = true;
            }
            boardState[r][c] = EMPTY;
            if (canWin) return { r, c };
          }
        }
      }
      return null;
    }

    // 🚀 6 步做杀逼杀推演 (VCT: 极速精剪枝版)
    function searchVCT(boardState, color, depth = 6) {
      if (depth <= 0) return null;
      const opp = color === BLACK ? WHITE : BLACK;
      const threats = [];

      for (let r = 0; r < 15; r++) {
        for (let c = 0; c < 15; c++) {
          if (boardState[r][c] !== EMPTY) continue;
          const pat = countPointPatterns(boardState, r, c, color);
          if (pat.five > 0 || pat.flex4 > 0 || (pat.block4 > 0 && pat.flex3 > 0) || pat.flex3 >= 2) {
            return { r, c };
          }
          if (pat.flex3 > 0) {
            threats.push({ r, c });
          }
        }
      }

      for (let m of threats.slice(0, 4)) {
        boardState[m.r][m.c] = color;
        const oppMoves = getCandidateMoves(boardState, opp, 2);
        let allDefeated = oppMoves.length > 0;
        for (let oppM of oppMoves) {
          boardState[oppM.r][oppM.c] = opp;
          const nextThreat = searchVCT(boardState, color, depth - 1);
          boardState[oppM.r][oppM.c] = EMPTY;
          if (!nextThreat) {
            allDefeated = false;
            break;
          }
        }
        boardState[m.r][m.c] = EMPTY;
        if (allDefeated) return { r: m.r, c: m.c };
      }
      return null;
    }

    // 🚀 负极大值 Alpha-Beta 剪枝深度前瞻搜索
    function minimaxAlphaBeta(boardState, depth, alpha, beta, isMaximizing, aiColor) {
      const oppColor = aiColor === BLACK ? WHITE : BLACK;
      if (depth === 0) {
        let totalScore = 0;
        for (let r = 0; r < 15; r++) {
          for (let c = 0; c < 15; c++) {
            if (boardState[r][c] === aiColor) totalScore += POS_WEIGHT[r][c] * 12;
            else if (boardState[r][c] === oppColor) totalScore -= POS_WEIGHT[r][c] * 12;
          }
        }
        return { score: totalScore };
      }

      const currentColor = isMaximizing ? aiColor : oppColor;
      const candidates = getCandidateMoves(boardState, currentColor, 6);
      if (candidates.length === 0) return { score: 0 };

      if (candidates[0].score >= 20000000) {
        return { score: isMaximizing ? 99999999 : -99999999, move: candidates[0] };
      }

      let bestMove = candidates[0];

      if (isMaximizing) {
        let maxEval = -Infinity;
        for (let m of candidates) {
          boardState[m.r][m.c] = aiColor;
          const evalRes = minimaxAlphaBeta(boardState, depth - 1, alpha, beta, false, aiColor);
          boardState[m.r][m.c] = EMPTY;
          if (evalRes.score > maxEval) {
            maxEval = evalRes.score;
            bestMove = m;
          }
          alpha = Math.max(alpha, evalRes.score);
          if (beta <= alpha) break;
        }
        return { score: maxEval, move: bestMove };
      } else {
        let minEval = Infinity;
        for (let m of candidates) {
          boardState[m.r][m.c] = oppColor;
          const evalRes = minimaxAlphaBeta(boardState, depth - 1, alpha, beta, true, aiColor);
          boardState[m.r][m.c] = EMPTY;
          if (evalRes.score < minEval) {
            minEval = evalRes.score;
            bestMove = m;
          }
          beta = Math.min(beta, evalRes.score);
          if (beta <= alpha) break;
        }
        return { score: minEval, move: bestMove };
      }
    }

    // 🚀 移动端 AI Worker 管理器：搜索在后台线程执行，主线程只负责一次性提交局面和接收结果。
    let aiWorker = null;
    let aiWorkerBlobUrl = '';
    let aiWorkerRequestSeq = 0;
    let aiTurnSeq = 0;
    let aiWorkerPending = new Map();
    let aiThinking = false;

    function disposeAiWorker(reason = 'AI Worker 已停止') {
      for (const pending of aiWorkerPending.values()) {
        clearTimeout(pending.timeoutId);
        try { pending.reject(new Error(reason)); } catch (_) {}
      }
      aiWorkerPending.clear();
      if (aiWorker) {
        try { aiWorker.terminate(); } catch (_) {}
      }
      aiWorker = null;
      if (aiWorkerBlobUrl) {
        try { URL.revokeObjectURL(aiWorkerBlobUrl); } catch (_) {}
        aiWorkerBlobUrl = '';
      }
    }

    function getAiWorker() {
      if (aiWorker) return aiWorker;
      if (typeof Worker !== 'function') return null;
      try {
        const sourceNode = document.getElementById('gomokuAiWorkerSource');
        const inlineSource = sourceNode && sourceNode.textContent ? sourceNode.textContent.trim() : '';
        if (inlineSource && typeof Blob === 'function' && typeof URL !== 'undefined' && URL.createObjectURL) {
          aiWorkerBlobUrl = URL.createObjectURL(new Blob([inlineSource], { type: 'text/javascript' }));
          aiWorker = new Worker(aiWorkerBlobUrl);
        } else {
          aiWorker = new Worker('js/ai_worker.js');
        }
        aiWorker.onmessage = (event) => {
          const data = event && event.data ? event.data : {};
          const pending = aiWorkerPending.get(data.requestId);
          if (!pending) return;
          aiWorkerPending.delete(data.requestId);
          clearTimeout(pending.timeoutId);
          if (data.ok && data.move && Number.isInteger(data.move.r) && Number.isInteger(data.move.c)) {
            window.gomokuLastAiStats = {
              elapsedMs: Number(data.elapsedMs) || 0,
              nodes: Number(data.nodes) || 0,
              depth: Number(data.depth) || 0
            };
            pending.resolve({ r: data.move.r, c: data.move.c });
          } else {
            pending.reject(new Error(data.error || 'AI Worker 计算失败'));
          }
        };
        aiWorker.onerror = (event) => {
          console.warn('[AI Worker] 后台计算线程异常:', event && event.message ? event.message : 'unknown error');
          disposeAiWorker('AI Worker 异常退出');
        };
        return aiWorker;
      } catch (error) {
        console.warn('[AI Worker] 创建失败，将使用兼容回退:', error);
        disposeAiWorker('AI Worker 创建失败');
        return null;
      }
    }

    function flattenAiBoard(boardState) {
      const size = 15;
      const flat = new Uint8Array(size * size);
      for (let r = 0; r < size; r++) {
        const row = Array.isArray(boardState[r]) ? boardState[r] : [];
        for (let c = 0; c < size; c++) flat[r * size + c] = Number(row[c]) || 0;
      }
      return flat;
    }

    function requestFastAiMove(boardState, forbiddenPoints = []) {
      const worker = getAiWorker();
      if (!worker) return Promise.reject(new Error('当前环境不支持 AI Worker'));
      const flat = flattenAiBoard(boardState);
      const requestId = ++aiWorkerRequestSeq;
      const mobile = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent || '');
      return new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          if (!aiWorkerPending.has(requestId)) return;
          aiWorkerPending.delete(requestId);
          disposeAiWorker('AI Worker 计算超时');
          reject(new Error('AI Worker 计算超时'));
        }, mobile ? 9000 : 12000);
        aiWorkerPending.set(requestId, { resolve, reject, timeoutId });
        try {
          worker.postMessage({
            type: 'best_move',
            requestId,
            size: 15,
            board: flat,
            aiColor: WHITE,
            difficulty: 'master',
            enableFoul: false,
            forbiddenPoints: Array.isArray(forbiddenPoints) ? forbiddenPoints.slice(0, 64) : [],
            // 大师 AI 只在 Worker 中增加预算，主线程不会被搜索阻塞；
            // 立即成五/必防/强制威胁仍会在引擎内部即时返回。
            budgetMs: mobile ? 520 : 900,
            maxDepth: mobile ? 7 : 9,
            rootLimit: mobile ? 20 : 26,
            candidateLimit: mobile ? 72 : 96,
            threatPly: mobile ? 6 : 8
          }, [flat.buffer]);
        } catch (error) {
          aiWorkerPending.delete(requestId);
          clearTimeout(timeoutId);
          reject(error);
        }
      });
    }

    async function getFastAiFallback(boardState, forbiddenPoints = []) {
      if (!window.GomokuFastAI || typeof window.GomokuFastAI.getBestMove !== 'function') {
        if (typeof window.ensureGomokuResource === 'function') await window.ensureGomokuResource('aiFast');
      }
      if (!window.GomokuFastAI || typeof window.GomokuFastAI.getBestMove !== 'function') return null;
      const mobile = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent || '');
      return window.GomokuFastAI.getBestMove(
        boardState,
        WHITE,
        'master',
        false,
        Array.isArray(forbiddenPoints) ? forbiddenPoints : [],
        {
          size: 15,
          budgetMs: mobile ? 150 : 240,
          maxDepth: mobile ? 4 : 5,
          rootLimit: mobile ? 12 : 16,
          candidateLimit: mobile ? 56 : 72,
          threatPly: mobile ? 6 : 8
        }
      );
    }

    // 🚀 最强大师人机主落子决策函数
    async function smartAiMove(forbiddenPoints = []) {
      if (isOver || gameMode !== 'ai' || turn !== WHITE || aiThinking) return;
      const turnId = ++aiTurnSeq;
      aiThinking = true;
      updateUI();
      const boardSnapshot = board.map(row => row.slice());
      let bestMove = null;
      try {
        bestMove = await requestFastAiMove(boardSnapshot, forbiddenPoints);
      } catch (workerError) {
        console.warn('[AI Worker] 使用同引擎低预算回退:', workerError && workerError.message ? workerError.message : workerError);
        try {
          bestMove = await getFastAiFallback(boardSnapshot, forbiddenPoints);
          if (!bestMove && (!window.GomokuAI || typeof window.GomokuAI.getBestMove !== 'function') &&
              typeof window.ensureGomokuResource === 'function') {
            try { await window.ensureGomokuResource('aiCore'); } catch (_) {}
          }
          if (!bestMove && window.GomokuAI && window.GomokuAI.getBestMove) {
            bestMove = window.GomokuAI.getBestMove(boardSnapshot, WHITE, 'master', false, forbiddenPoints);
          }
          if (!bestMove) bestMove = { r: 7, c: 7 };
        } catch (fallbackError) {
          console.error('[AI fallback] 计算失败:', fallbackError);
          bestMove = { r: 7, c: 7 };
        }
      } finally {
        if (turnId === aiTurnSeq) {
          aiThinking = false;
          updateUI();
        }
      }

      if (turnId !== aiTurnSeq || isOver || gameMode !== 'ai' || turn !== WHITE) return;
      if (bestMove && board[bestMove.r] && board[bestMove.r][bestMove.c] === EMPTY) {
        makeMove(bestMove.r, bestMove.c, WHITE);
      }
    }

    // 显式挂到 window，便于本地性能基准与兼容壳调用；不暴露任何凭据或内部棋局身份信息。
    window.requestFastAiMove = requestFastAiMove;

    function isProphecied(r, c, p) {
      if (!prophecyPoint) return false;
      // 施法者本人落子时，绝对不触发封锁拦截
      if (prophecyPoint.by && p === prophecyPoint.by) return false;
      return prophecyPoint.r === r && prophecyPoint.c === c;
    }

    function drawRandomThreeCards() {
      const shuffled = [...SKILL_CARD_POOL].sort(() => Math.random() - 0.5);
      currentDrawnCards = shuffled.slice(0, 3);
      cardUsedStatus = [false, false, false];
      activeSkill = null;
      prophecyPoint = null;
      hasExtraMove = false;
      consecutiveMovesLeft = 0;
      opponentFreeMove = false;
      cancelActiveSkill();
      renderCardSlots();
    }

    function renderCardSlots() {
      const area = document.getElementById('cardSlotsArea');
      if (!area) return;
      area.innerHTML = currentDrawnCards.map((card, idx) => {
        const isUsed = cardUsedStatus[idx];
        const isCasting = activeSkill && activeSkill.slotIdx === idx;
        const icon = card.icon;
        const name = card.name;
        const desc = card.desc;
        const disabled = isUsed ? ' disabled' : '';
        const accessibleLabel = isUsed ? `${name}（已使用）` : `${name}：${desc}`;
        return `
          <button type="button" class="card-slot ${isUsed ? 'used' : ''} ${isCasting ? 'casting' : ''}"
               onclick="handleCardClick(${idx})"
               title="${escapeHtml(desc)}"
               aria-label="${escapeHtml(accessibleLabel)}"${disabled}>
            <span class="card-slot-header">
              <span class="slot-icon" aria-hidden="true">${escapeHtml(icon)}</span>
              <span class="slot-title">${escapeHtml(name)}</span>
            </span>
            <span class="slot-sub">${isUsed ? '已使用' : escapeHtml(desc)}</span>
          </button>
        `;
      }).join('');
    }

    // 🔍 智能检测对方场上是否有三连（活三/眠三）或四连（活四/冲四）
    function findEnemyThreeOrFour(enemyColor) {
      const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];
      for (let r = 0; r < 15; r++) {
        for (let c = 0; c < 15; c++) {
          if (board[r][c] !== enemyColor) continue;
          for (const [dr, dc] of dirs) {
            const pr = r - dr, pc = c - dc;
            if (pr >= 0 && pr < 15 && pc >= 0 && pc < 15 && board[pr][pc] === enemyColor) continue;
            const stones = [{ r, c }];
            let nr = r + dr, nc = c + dc;
            while (nr >= 0 && nr < 15 && nc >= 0 && nc < 15 && board[nr][nc] === enemyColor) {
              stones.push({ r: nr, c: nc });
              nr += dr; nc += dc;
            }
            if (stones.length >= 3) {
              return stones;
            }
          }
        }
      }
      return null;
    }

    // 🎲 命运神抽：掷骰子动画与结算
    function executeDestinyDice(slotIdx, card) {
      markCardUsed(slotIdx);
      playSkillSound('dice');

      const diceIcons = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
      let rollCount = 0;
      const rollTimer = setInterval(() => {
        const tempPoint = Math.floor(Math.random() * 6) + 1;
        showSkillBanner(diceIcons[tempPoint - 1], '🎲 命运神抽摇骰中...', `命运指针正在疯狂旋转... 点数 [${tempPoint}]`, true);
        rollCount++;
        if (rollCount > 8) {
          clearInterval(rollTimer);
          finalizeDestinyRoll(slotIdx, card);
        }
      }, 110);
    }

    function finalizeDestinyRoll(slotIdx, card) {
      const point = Math.floor(Math.random() * 6) + 1;
      const myColor = (gameMode === 'online') ? myOnlineColor : turn;
      const enemyColor = myColor === BLACK ? WHITE : BLACK;

      if (point === 1) {
        // 💀 掷出 1（大凶·空军）：这回合直接空过，不仅不能下子，还必须让对手在任意空格免费补下 1 子
        showSkillBanner('💀', `🎲 投出点数 1：【大凶·空军】！`, '本回合直接空过！对手获得免费补下 1 子！');
        triggerBoardShake();
        playSkillSound('boom');

        if (gameMode === 'ai') {
          // 电脑白子立刻免费补下一子并接管正常回合
          setTimeout(() => {
            const empties = [];
            for (let i = 0; i < 15; i++) for (let j = 0; j < 15; j++) if (board[i][j] === EMPTY) empties.push({ r: i, c: j });
            if (empties.length > 0) {
              // 优先选中央或靠近已有棋子的空位
              const pick = empties[Math.floor(Math.random() * empties.length)];
              board[pick.r][pick.c] = WHITE;
              history.push({ r: pick.r, c: pick.c, p: WHITE });
              triggerStoneDropVFX(pick.r, pick.c, WHITE);
              playPopSound();
              draw();
              showGameNotice("🤖 大师AI 免费补子成功！继续执行正常回合！", true);
              if (checkWin(pick.r, pick.c, WHITE)) {
                triggerGameEnd(WHITE, '大师AI 免费补下 1 子，达成五子连珠绝杀！');
                return;
              }
              turn = WHITE;
              updateUI();
              setTimeout(smartAiMove, 650);
            }
          }, 850);
        } else if (gameMode === 'pvp') {
          opponentFreeMove = true;
          turn = enemyColor;
          updateUI();
          showGameNotice(`💀 空过生效！轮到对手【${getPlayerNameByColor(turn)}】免费补子并接管回合！`, true);
        } else if (gameMode === 'online') {
          turn = enemyColor;
          updateUI();
          if (conn && conn.open) {
            conn.send({ type: 'destiny_point_1' });
          }
        }
      } else if (point === 2) {
        // 🙈 掷出 2（偷梁换柱）：闭上眼，让对手替你盲选棋盘上你的 1 颗子，移到最近的空格里
        const myStones = [];
        for (let r = 0; r < 15; r++) {
          for (let c = 0; c < 15; c++) {
            if (board[r][c] === myColor) myStones.push({ r, c });
          }
        }
        if (myStones.length === 0) {
          showSkillBanner('🙈', `🎲 投出点数 2：【偷梁换柱】！`, '棋盘尚无己方棋子，偷梁换柱落空~');
          return;
        }
        const pick = myStones[Math.floor(Math.random() * myStones.length)];
        const sR = pick.r, sC = pick.c;

        let bestDist = Infinity;
        let bestTarget = null;
        for (let r = 0; r < 15; r++) {
          for (let c = 0; c < 15; c++) {
            if (board[r][c] === EMPTY) {
              const dist = (r - sR) * (r - sR) + (c - sC) * (c - sC);
              if (dist < bestDist) {
                bestDist = dist;
                bestTarget = { r, c };
              }
            }
          }
        }

        if (bestTarget) {
          board[sR][sC] = EMPTY;
          board[bestTarget.r][bestTarget.c] = myColor;
          history.push({
            action: 'shift_stone',
            type: 'skill_shift_stone',
            fromR: sR,
            fromC: sC,
            toR: bestTarget.r,
            toC: bestTarget.c,
            r: bestTarget.r,
            c: bestTarget.c,
            p: myColor,
            desc: '偷梁换柱'
          });
          triggerSkillVFX('shift_stone', bestTarget.r, bestTarget.c, sR, sC);
          playSkillSound('magic');
          showSkillBanner('🙈', `🎲 投出点数 2：【偷梁换柱】！`, `对手盲选了位于 (${sR+1},${sC+1}) 的棋子，平移至 (${bestTarget.r+1},${bestTarget.c+1})！`);
          draw(); updateUI(); persistGameState();
          if (gameMode === 'online' && conn && conn.open) {
            conn.send({ type: 'destiny_point_2', fromR: sR, fromC: sC, toR: bestTarget.r, toC: bestTarget.c });
          }
          if (checkWin(bestTarget.r, bestTarget.c, myColor)) {
            triggerGameEnd(myColor);
          }
        }
      } else if (point === 3) {
        // 💥 掷出 3（精准爆破）：直接拿掉对方场上任意 1 颗棋子
        let enemyCount = 0;
        for (let r = 0; r < 15; r++) for (let c = 0; c < 15; c++) if (board[r][c] === enemyColor) enemyCount++;
        if (enemyCount === 0) {
          showSkillBanner('💥', `🎲 投出点数 3：【精准爆破】！`, '对方场上暂无棋子，精准爆破落空~');
          return;
        }
        showSkillBanner('💥', `🎲 投出点数 3：【精准爆破】！`, '请在棋盘上点击对方任意 1 颗棋子将其抹除！');
        activeSkill = { slotIdx: -1, skill: { id: 'destiny_remove', name: '精准爆破' }, step: 1 };
        const bar = document.getElementById('skillPromptBar');
        const text = document.getElementById('skillPromptText');
        if (bar && text) {
          bar.style.display = 'flex';
          text.textContent = `💥【精准爆破】请点击对方场上任意 1 颗棋子！`;
        }
      } else if (point === 4) {
        // 🎭 掷出 4（绝地倒戈）：把对方场上任意 1 颗棋子，直接翻成你的颜色
        let enemyCount = 0;
        for (let r = 0; r < 15; r++) for (let c = 0; c < 15; c++) if (board[r][c] === enemyColor) enemyCount++;
        if (enemyCount === 0) {
          showSkillBanner('🎭', `🎲 投出点数 4：【绝地倒戈】！`, '对方场上暂无棋子，绝地倒戈落空~');
          return;
        }
        showSkillBanner('🎭', `🎲 投出点数 4：【绝地倒戈】！`, '请在棋盘上点击对方任意 1 颗棋子翻为己用！');
        activeSkill = { slotIdx: -1, skill: { id: 'destiny_convert', name: '绝地倒戈' }, step: 1 };
        const bar = document.getElementById('skillPromptBar');
        const text = document.getElementById('skillPromptText');
        if (bar && text) {
          bar.style.display = 'flex';
          text.textContent = `🎭【绝地倒戈】请点击对方任意 1 颗棋子翻为己用！`;
        }
      } else if (point === 5) {
        // ⚡ 掷出 5（疯狂暴击）：本回合允许你连续下 3 颗子！
        consecutiveMovesLeft = 2; // 当前子落完后还可连下 2 颗，一共 3 颗！
        showSkillBanner('⚡', `🎲 投出点数 5：【疯狂暴击】！`, '狂暴连击！本回合允许你连续落 3 颗子！');
        triggerBoardShake();
        playSkillSound('thunder');
      } else if (point === 6) {
        // 👑 掷出 6（天命降临·掀桌）：如果对方此时有“活三”或“成四”，直接全部作废移除；如果没有，你在棋盘上任意选一个未占用的 2×2 区域，全填上你的棋子
        const dangerLine = findEnemyThreeOrFour(enemyColor);
        if (dangerLine && dangerLine.length >= 3) {
          // 初始命运神抽快照之外，掀桌本身也是一次可撤销的棋盘变更。
          // 远端收到 destiny_wipe_danger 后会建立对应快照，保证双方撤销栈保持同长度。
          saveUndoSnapshot('skill', { slotIdx, skillId: 'destiny_wipe_danger', player: myColor });
          dangerLine.forEach(pos => {
            board[pos.r][pos.c] = EMPTY;
            triggerSkillVFX('remove_stone', pos.r, pos.c);
          });
          history.push({
            action: 'destiny_wipe_danger',
            type: 'destiny_wipe_danger',
            stones: dangerLine.map(s => ({ ...s })),
            r: -1,
            c: -1,
            p: myColor,
            desc: '天命掀桌'
          });
          draw(); updateUI(); persistGameState();
          triggerBoardShake(true);
          playSkillSound('boom');
          showSkillBanner('👑', `🎲 投出点数 6：【天命掀桌】！`, `掀翻杀机！对方 ${dangerLine.length} 颗杀线棋子已被全部作废抹除！`);
          if (gameMode === 'online' && conn && conn.open) {
            conn.send({ type: 'destiny_wipe_danger', stones: dangerLine });
          }
        } else {
          showSkillBanner('👑', `🎲 投出点数 6：【天命降临】！`, '对方无险情！请在棋盘上选一个未占用的 2×2 区域全填满！');
          activeSkill = { slotIdx: -1, skill: { id: 'destiny_2x2', name: '天命2×2' }, step: 1 };
          const bar = document.getElementById('skillPromptBar');
          const text = document.getElementById('skillPromptText');
          if (bar && text) {
            bar.style.display = 'flex';
            text.textContent = `👑【天命降临】请点击未占用的 2×2 区域左上角！`;
          }
        }
      }
    }

    function handleCardClick(idx) {
      if (isOver) return;
      if (cardUsedStatus[idx]) return;
      if (gameMode === 'online') {
        if (turn !== myOnlineColor) {
          return showGameNotice("⏳ 还没到您的回合，请在自己回合使用干扰牌！", false);
        }
        if (!conn || !conn.open) {
          return showGameNotice("⚠️ 联机连接未就绪或已中断，无法使用干扰牌！", true);
        }
      }
      if (gameMode === 'ai' && turn !== BLACK) {
        return showGameNotice("⏳ AI 正在思考中，请在自己的回合施展技能！", false);
      }

      if (activeSkill && activeSkill.slotIdx === idx) {
        cancelActiveSkill();
        return;
      }

      const card = currentDrawnCards[idx];
      const cardTitle = card.name;
      if (!card.needTarget) {
        if (card.id === 'destiny_dice') {
          saveUndoSnapshot('skill', { slotIdx: idx, skillId: 'destiny_dice', player: turn });
          if (gameMode === 'online' && conn && conn.open) {
            // 先广播一次“开始掷骰”，让对端建立同一个悔棋快照；点数结果报文只负责应用结果。
            conn.send({ type: 'skill_use', skillId: card.id, cardName: card.name });
          }
          executeDestinyDice(idx, card);
        } else if (card.id === 'double_move') {
          saveUndoSnapshot('skill', { slotIdx: idx, skillId: 'double_move', player: turn });
          hasExtraMove = true;
          markCardUsed(idx);
          triggerSkillVFX('double_move');
          triggerBoardShake();
          playSkillSound('thunder');
          showSkillBanner('⚡', `【${cardTitle}】发动！`, '神威连珠！本回合落子后可连续再落一子！');
          if (gameMode === 'online' && conn && conn.open) {
            conn.send({ type: 'skill_use', skillId: card.id, cardName: card.name });
          }
        } else if (card.id === 'reforge_cards') {
          saveUndoSnapshot('skill', { slotIdx: idx, skillId: 'reforge_cards', player: turn });
          // 排除天降神抽自身，从其他8大技能中随机洗牌抽出3张全新神技牌
          const pool = SKILL_CARD_POOL.filter(c => c.id !== 'reforge_cards');
          const shuffledPool = [...pool].sort(() => Math.random() - 0.5);

          // 核心机制：全场 3 个卡牌槽位（包括之前已使用变灰的干扰牌和自身）全部满血重铸并复活！
          for (let i = 0; i < 3; i++) {
            currentDrawnCards[i] = shuffledPool[i];
            cardUsedStatus[i] = false; // 刷新出来的全部神技牌立即可用！
          }
          renderCardSlots();
          triggerSkillVFX('reforge_cards');
          playSkillSound('dice');
          showSkillBanner('🃏', `【${cardTitle}】发动！`, '神迹降临！全场所有手牌（包含已使用的干扰牌）全部满血复活换新！');
          if (gameMode === 'online' && conn && conn.open) {
            conn.send({ type: 'skill_use', skillId: card.id, cardName: card.name });
          }
          persistGameState();
        } else if (card.id === 'identity_swap') {
          const placedStonesCount = history.filter(h => h && h.r >= 0).length;
          if (placedStonesCount === 0) return alert('🔄 棋盘上还没有棋子，无法互换身份！');
          saveUndoSnapshot('skill', { slotIdx: idx, skillId: 'identity_swap', player: turn });
          // 全盘颜色互换
          for (let r = 0; r < 15; r++) for (let c = 0; c < 15; c++) {
            if (board[r][c] === BLACK) board[r][c] = WHITE;
            else if (board[r][c] === WHITE) board[r][c] = BLACK;
          }
          // ⚠️ 修复历史记录开头颠倒问题：严禁倒退修改历史走法谱！
          // 追加一条【身份互换】事件记录，记录其发生的准确时刻与步数
          history.push({ action: 'identity_swap', type: 'skill_identity_swap', r: -1, c: -1, p: 0, desc: '身份互换' });
          markCardUsed(idx);
          triggerBoardShake();
          playSkillSound('warp');
          showSkillBanner('🔄', `【${cardTitle}】发动！`, '黑白颠倒！全场棋子身份互换！');
          draw();
          if (gameMode === 'online' && conn && conn.open) {
            conn.send({ type: 'skill_identity_swap' });
          }
          // 检查互换后是否有人赢棋（直接按棋盘实际棋子扫描判定）
          winningLine = null;
          let hasWinner = false;
          for (let r = 0; r < 15; r++) {
            for (let c = 0; c < 15; c++) {
              if (board[r][c] !== EMPTY && checkWin(r, c, board[r][c])) {
                triggerGameEnd(board[r][c], `身份互换后，【${getPlayerNameByColor(board[r][c])} (${board[r][c] === BLACK ? '黑子' : '白子'})】直接达成五子连珠获胜！`);
                hasWinner = true;
                break;
              }
            }
            if (hasWinner) break;
          }
          if (!hasWinner && isBoardFull()) {
            triggerGameDraw('身份互换后棋盘已无空位，双方本局和棋！');
          }
          updateUI(); persistGameState();
        } else if (card.id === 'mega_bomb') {
          const currentStones = [];
          for (let r = 0; r < 15; r++) {
            for (let c = 0; c < 15; c++) {
              if (board[r][c] !== EMPTY) {
                currentStones.push({ r, c, p: board[r][c] });
              }
            }
          }
          if (currentStones.length < 2) {
            return alert("💣 棋盘上棋子太少，无法引爆大炸弹！至少需要 2 颗棋子~");
          }
          saveUndoSnapshot('skill', { slotIdx: idx, skillId: 'mega_bomb', player: turn });
          markCardUsed(idx);

          // 收集全部棋子颜色并打乱全盘坐标
          const stoneColors = currentStones.map(s => s.p);
          const allCoords = [];
          for (let r = 0; r < 15; r++) {
            for (let c = 0; c < 15; c++) {
              allCoords.push({ r, c });
            }
          }
          for (let i = allCoords.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [allCoords[i], allCoords[j]] = [allCoords[j], allCoords[i]];
          }

          // 清空并重新分配
          for (let r = 0; r < 15; r++) {
            for (let c = 0; c < 15; c++) board[r][c] = EMPTY;
          }
          const newStones = [];
          for (let i = 0; i < stoneColors.length; i++) {
            const pos = allCoords[i];
            board[pos.r][pos.c] = stoneColors[i];
            newStones.push({ r: pos.r, c: pos.c, p: stoneColors[i] });
          }
          // 🚀 核心修复：历史记录采用追加动作事件记录，绝不可清空或篡改过往落子时序！
          history.push({
            action: 'mega_bomb',
            type: 'skill_mega_bomb',
            stones: newStones,
            prevStones: currentStones,
            r: -1,
            c: -1,
            p: turn,
            desc: '乾坤大乱'
          });

          triggerSkillVFX('mega_bomb');
          triggerBoardShake(true);
          playSkillSound('bomb');
          showSkillBanner('💣', `【${cardTitle}】引爆全场！`, '天翻地覆！棋盘上所有棋子被彻底随机打乱洗牌！');

          if (gameMode === 'online' && conn && conn.open) {
            conn.send({ type: 'skill_mega_bomb', stones: newStones });
          }

          // 检查洗牌后是否有玩家连珠获胜
          winningLine = null;
          let bombWinColor = null;
          for (const stone of newStones) {
            if (checkWin(stone.r, stone.c, stone.p)) {
              bombWinColor = stone.p;
              break;
            }
          }
          if (bombWinColor) {
            triggerGameEnd(bombWinColor, `炸弹洗牌后，【${getPlayerNameByColor(bombWinColor)} (${bombWinColor === BLACK ? '黑子' : '白子'})】意外凑成五子连珠获胜！`);
          } else if (isBoardFull()) {
            triggerGameDraw('炸弹洗牌后棋盘已无空位，双方本局和棋！');
          }

          draw(); updateUI(); persistGameState();
        }
      } else {
        activeSkill = { slotIdx: idx, skill: card, step: 1 };
        renderCardSlots();
        showSkillPrompt(card);
      }
    }

    function showSkillPrompt(card) {
      const bar = document.getElementById('skillPromptBar');
      const text = document.getElementById('skillPromptText');
      if (!bar || !text) return;
      bar.style.display = 'flex';
      if (card.id === 'prophecy_block') {
        text.textContent = `🔮 请在棋盘上点击一个空位，预言对手下一步将在此落子`;
        showSkillBanner('🔮', '【预言封锁】使用说明', '点击棋盘任意空格预言对手落点！若对手下一步落在该格，落子将被撤销且回合返还！');
      } else if (card.id === 'remove_stone') {
        text.textContent = `💥 请在棋盘上点击要抹除的对方孤子`;
        showSkillBanner('💥', '【虚空陨石】使用说明', '点击对方场上任意 1 颗孤子！将其从棋盘上彻底抹除蒸发！');
      } else if (card.id === 'shift_stone') {
        text.textContent = `🌟 第1步：点击己方一颗要平移的棋子`;
        showSkillBanner('🌟', '【移星换斗】使用说明', '第1步选择己方1颗棋子，第2步点击相邻8方向空格即可平移！');
      } else if (card.id === 'swap_color') {
        text.textContent = `🎭 请在棋盘上点击要策反的对方棋子`;
        showSkillBanner('🎭', '【偷天换日】使用说明', '点击对方场上任意 1 颗棋子！直接策反翻成你的颜色！');
      } else if (card.id === 'swap_positions') {
        text.textContent = `💫 第1步：点击己方一颗要互换位置的棋子`;
        showSkillBanner('💫', '【移形换影】使用说明', '第1步选己方1颗棋子，第2步选对方1颗棋子，双方位置瞬间对调！');
      } else if (card.id === 'destiny_remove') {
        text.textContent = `💥【精准爆破】请点击对方场上任意 1 颗棋子将其抹除！`;
        showSkillBanner('💥', '【精准爆破】使用说明', '点击对方场上任意 1 颗棋子将其直接抹除！');
      } else if (card.id === 'destiny_convert') {
        text.textContent = `🎭【绝地倒戈】请点击对方任意 1 颗棋子翻为己用！`;
        showSkillBanner('🎭', '【绝地倒戈】使用说明', '点击对方场上任意 1 颗棋子，直接翻成你的颜色！');
      } else if (card.id === 'destiny_2x2') {
        text.textContent = `👑【天命降临】请点击未占用的 2×2 区域左上角！`;
        showSkillBanner('👑', '【天命降临】使用说明', '点击任意未占用的 2×2 区域左上角，瞬间全填满你的 4 颗棋子！');
      }
    }

    function cancelActiveSkill() {
      activeSkill = null;
      const bar = document.getElementById('skillPromptBar');
      if (bar) bar.style.display = 'none';
      const banner = document.getElementById('skillBanner');
      if (banner) banner.classList.remove('show');
      renderCardSlots();
      draw();
    }

    function markCardUsed(idx) {
      cardUsedStatus[idx] = true;
      activeSkill = null;
      const bar = document.getElementById('skillPromptBar');
      if (bar) bar.style.display = 'none';
      renderCardSlots();
      draw();
    }

    function invalidAction(msg, row, col) {
      if (row !== undefined && col !== undefined) {
        triggerSkillVFX('invalid_click', row, col);
      }
      showGameNotice(msg, true);
    }

    function handleSkillClick(row, col) {
      if (!activeSkill) return;
      if (gameMode === 'online' && (!conn || !conn.open)) {
        return showGameNotice("⚠️ 联机连接未就绪或已中断，无法施放技能！", true);
      }
      const { slotIdx, skill } = activeSkill;
      const myColor = (gameMode === 'online') ? myOnlineColor : turn;
      const enemyColor = myColor === BLACK ? WHITE : BLACK;
      const skillName = skill.name;

      if (skill.id === 'prophecy_block') {
        if (board[row][col] !== EMPTY) {
          return invalidAction('🔮 预言封锁只能指向空白格子！', row, col);
        }
        saveUndoSnapshot('skill', { slotIdx, skillId: 'prophecy_block', player: myColor });
        prophecyPoint = { r: row, c: col, by: myColor };
        markCardUsed(slotIdx);
        triggerSkillVFX('freeze', row, col); // 复用冰花特效做视觉标记
        playSkillSound('magic');
        showSkillBanner('🔮', `【${skillName}】发动！`, `已预言 (${row+1}, ${col+1})，若对手落此处将当场抹杀撤销！`);
        if (gameMode === 'online' && conn && conn.open) {
          conn.send({ type: 'skill_prophecy', r: row, c: col, by: myColor });
        }
      } else if (skill.id === 'remove_stone') {
        if (board[row][col] !== enemyColor) {
          return invalidAction("💥 只能抹除对方的棋子！", row, col);
        }
        saveUndoSnapshot('skill', { slotIdx, skillId: 'remove_stone', player: myColor });
        board[row][col] = EMPTY;
        history.push({
          action: 'remove_stone',
          type: 'skill_remove_stone',
          r: row,
          c: col,
          p: enemyColor,
          by: myColor,
          desc: '虚空陨石'
        });
        markCardUsed(slotIdx);
        triggerSkillVFX('remove_stone', row, col);
        triggerBoardShake();
        playSkillSound('boom');
        showSkillBanner('💥', `【${skillName}】发动！`, `成功抹除对方位于 (${row+1}, ${col+1}) 的棋子！`);
        if (gameMode === 'online' && conn && conn.open) {
          conn.send({ type: 'skill_remove_stone', r: row, c: col });
        }
      } else if (skill.id === 'shift_stone') {
        if (activeSkill.step === 1) {
          if (board[row][col] !== myColor) {
            return invalidAction("🌟 请选择己方的棋子进行平移！", row, col);
          }
          activeSkill.step = 2;
          activeSkill.srcR = row;
          activeSkill.srcC = col;
          const text = document.getElementById('skillPromptText');
          if (text) text.textContent = `🌟 第2步：请点击相邻的空白位置 (八方向距离1)`;
          draw();
        } else if (activeSkill.step === 2) {
          if (board[row][col] !== EMPTY) {
            return invalidAction("🌟 目标点必须是空白位置！", row, col);
          }
          const dr = Math.abs(row - activeSkill.srcR);
          const dc = Math.abs(col - activeSkill.srcC);
          if (dr > 1 || dc > 1 || (dr === 0 && dc === 0)) {
            return invalidAction("🌟 只能平移到相邻的 8 个方向空格之一！", row, col);
          }
          saveUndoSnapshot('skill', { slotIdx, skillId: 'shift_stone', player: myColor });
          const sR = activeSkill.srcR, sC = activeSkill.srcC;
          board[sR][sC] = EMPTY;
          board[row][col] = myColor;
          history.push({
            action: 'shift_stone',
            type: 'skill_shift_stone',
            fromR: sR,
            fromC: sC,
            toR: row,
            toC: col,
            r: row,
            c: col,
            p: myColor,
            desc: '移星换斗'
          });
          markCardUsed(slotIdx);
          triggerSkillVFX('shift_stone', row, col, sR, sC);
          playSkillSound('magic');
          showSkillBanner('🌟', `【${skillName}】发动！`, `棋子平移至 (${row+1}, ${col+1})！`);
          if (gameMode === 'online' && conn && conn.open) {
            conn.send({ type: 'skill_shift_stone', fromR: sR, fromC: sC, toR: row, toC: col, p: myColor });
          }
          if (checkWin(row, col, myColor)) {
            triggerGameEnd(myColor);
          }
        }
      } else if (skill.id === 'swap_color') {
        if (board[row][col] !== enemyColor) {
          return invalidAction("🎭 偷天换日只能策反对方的棋子！", row, col);
        }
        saveUndoSnapshot('skill', { slotIdx, skillId: 'swap_color', player: myColor });
        board[row][col] = myColor;
        history.push({
          action: 'swap_color',
          type: 'skill_swap_color',
          r: row,
          c: col,
          fromP: enemyColor,
          p: myColor,
          desc: '偷天换日'
        });
        markCardUsed(slotIdx);
        triggerSkillVFX('swap_color', row, col);
        triggerBoardShake();
        playSkillSound('magic');
        showSkillBanner('🎭', `【${skillName}】发动！`, `成功策反对方位于 (${row+1}, ${col+1}) 的棋子！`);
        if (gameMode === 'online' && conn && conn.open) {
          conn.send({ type: 'skill_swap_color', r: row, c: col, p: myColor });
        }
        if (checkWin(row, col, myColor)) {
          triggerGameEnd(myColor);
        }
      } else if (skill.id === 'swap_positions') {
        if (activeSkill.step === 1) {
          if (board[row][col] !== myColor) {
            return invalidAction("💫 请选择己方的棋子！", row, col);
          }
          activeSkill.step = 2;
          activeSkill.srcR = row;
          activeSkill.srcC = col;
          const text = document.getElementById('skillPromptText');
          if (text) text.textContent = `💫 第2步：请点击敌方一颗要互换位置的棋子`;
          draw();
        } else if (activeSkill.step === 2) {
          if (board[row][col] !== enemyColor) {
            return invalidAction("💫 目标必须是对方的棋子！", row, col);
          }
          saveUndoSnapshot('skill', { slotIdx, skillId: 'swap_positions', player: myColor });
          const sR = activeSkill.srcR, sC = activeSkill.srcC;
          board[sR][sC] = enemyColor;
          board[row][col] = myColor;
          history.push({
            action: 'swap_positions',
            type: 'skill_swap_positions',
            r1: sR,
            c1: sC,
            p1: enemyColor,
            r2: row,
            c2: col,
            p2: myColor,
            desc: '移形换影'
          });
          markCardUsed(slotIdx);
          triggerSkillVFX('swap_positions', row, col, sR, sC);
          triggerBoardShake();
          playSkillSound('warp');
          showSkillBanner('💫', `【${skillName}】发动！`, `双方棋子位置瞬间对调！`);
          if (gameMode === 'online' && conn && conn.open) {
            conn.send({ type: 'skill_swap_positions', r1: sR, c1: sC, r2: row, c2: col });
          }
          if (checkWin(row, col, myColor)) {
            triggerGameEnd(myColor);
          }
        }
      } else if (skill.id === 'destiny_remove') {
        if (board[row][col] !== enemyColor) {
          return invalidAction('💥 请点击对方的一颗棋子！', row, col);
        }
        saveUndoSnapshot('skill', { slotIdx: activeSkill.slotIdx, skillId: 'destiny_remove', player: myColor });
        board[row][col] = EMPTY;
        history.push({
          action: 'remove_stone',
          type: 'skill_remove_stone',
          r: row,
          c: col,
          p: enemyColor,
          by: myColor,
          desc: '精准爆破'
        });
        cancelActiveSkill();
        triggerSkillVFX('remove_stone', row, col);
        playSkillSound('boom');
        triggerBoardShake();
        showSkillBanner('💥', '【精准爆破】发动！', `成功抹除对方位于 (${row+1}, ${col+1}) 的棋子！`);
        draw(); updateUI(); persistGameState();
        if (gameMode === 'online' && conn && conn.open) {
          conn.send({ type: 'skill_remove_stone', r: row, c: col });
        }
      } else if (skill.id === 'destiny_convert') {
        if (board[row][col] !== enemyColor) {
          return invalidAction('🎭 请点击对方的一颗棋子！', row, col);
        }
        saveUndoSnapshot('skill', { slotIdx: activeSkill.slotIdx, skillId: 'destiny_convert', player: myColor });
        board[row][col] = myColor;
        history.push({
          action: 'swap_color',
          type: 'skill_swap_color',
          r: row,
          c: col,
          fromP: enemyColor,
          p: myColor,
          desc: '绝地倒戈'
        });
        cancelActiveSkill();
        triggerSkillVFX('swap_color', row, col);
        playSkillSound('magic');
        triggerBoardShake();
        showSkillBanner('🎭', '【绝地倒戈】发动！', `成功将对方位于 (${row+1}, ${col+1}) 的棋子翻为己用！`);
        draw(); updateUI(); persistGameState();
        if (gameMode === 'online' && conn && conn.open) {
          conn.send({ type: 'skill_swap_color', r: row, c: col, p: myColor });
        }
        if (checkWin(row, col, myColor)) {
          triggerGameEnd(myColor);
        }
      } else if (skill.id === 'destiny_2x2') {
        if (row >= 14 || col >= 14) {
          return invalidAction('👑 2×2 区域超出棋盘边界，请往内部选点！', row, col);
        }
        const cells = [
          { r: row, c: col },
          { r: row + 1, c: col },
          { r: row, c: col + 1 },
          { r: row + 1, c: col + 1 }
        ];
        if (cells.some(pos => board[pos.r][pos.c] !== EMPTY)) {
          return invalidAction('👑 2×2 区域必须 4 个格子全为空！', row, col);
        }
        saveUndoSnapshot('skill', { slotIdx: activeSkill.slotIdx, skillId: 'destiny_2x2', player: myColor });
        cancelActiveSkill();
        cells.forEach(pos => {
          board[pos.r][pos.c] = myColor;
          history.push({ r: pos.r, c: pos.c, p: myColor });
          triggerStoneDropVFX(pos.r, pos.c, myColor);
        });
        triggerBoardShake();
        playSkillSound('victory');
        showSkillBanner('👑', '【天命降临】神域展开！', `2×2 区域瞬间天降 4 颗连星！`);
        draw(); updateUI(); persistGameState();
        if (gameMode === 'online' && conn && conn.open) {
          conn.send({ type: 'destiny_place_2x2', cells, p: myColor });
        }
        winningLine = null;
        let hasWinner = false;
        for (const pos of cells) {
          if (checkWin(pos.r, pos.c, myColor)) {
            triggerGameEnd(myColor, `天命神域助力【${getPlayerNameByColor(myColor)} (${myColor === BLACK ? '黑子' : '白子'})】五子连珠获胜！`);
            hasWinner = true;
            break;
          }
        }
        if (!hasWinner && isBoardFull()) {
          triggerGameDraw('天命降临后棋盘已无空位，双方本局和棋！');
        }
      }
    }


    // ==========================================
    // 联机模块在第一次进入联机/好友邀战时加载，避免约 5000 行网络状态机阻塞首屏。
    function ensureOnlineFeature() {
      return window.ensureGomokuFeature('online');
    }
    function openOnlineModal(tab = 'match') {
      const proxy = openOnlineModal;
      return ensureOnlineFeature().then(() => {
        if (window.openOnlineModal === proxy) throw new Error('联机模块加载后未注册');
        return window.openOnlineModal(tab);
      }).catch(error => showGameNotice(error.message || '联机模块加载失败', true));
    }
    function setMode(mode, silent = false) {
      const proxy = setMode;
      return ensureOnlineFeature().then(() => {
        if (window.setMode === proxy) throw new Error('模式模块加载后未注册');
        return window.setMode(mode, silent);
      }).catch(error => showGameNotice(error.message || '模式切换失败', true));
    }
    function triggerOnlineReconnect(reason = '网络波动') {
      const proxy = triggerOnlineReconnect;
      return ensureOnlineFeature().then(() => {
        if (window.triggerOnlineReconnect === proxy) return false;
        return window.triggerOnlineReconnect(reason);
      });
    }

    // ==========================================
    // 🟩 15x15 方格中央落子 渲染与几何计算
    // ==========================================
    function resizeBoard() {
      const isMobile = window.innerWidth <= 600;
      const screenW = window.innerWidth;
      // 手机端直接占满全屏宽度（保留极细 2px 边缘缓冲）
      const availW = isMobile ? (screenW - 2) : Math.min(islandWrapper.clientWidth || screenW, 580);
      const availH = islandWrapper.clientHeight || (window.innerHeight - 150);

      const maxSide = Math.min(availW, availH);
      cWidth = Math.floor(maxSide);
      cHeight = Math.floor(maxSide);

      dpr = getEffectiveCanvasDpr();
      cvs.width = Math.round(cWidth * dpr);
      cvs.height = Math.round(cHeight * dpr);
      cvs.style.width = cWidth + 'px';
      cvs.style.height = cHeight + 'px';

      if (ctx.resetTransform) ctx.resetTransform(); else ctx.setTransform(1,0,0,1,0,0);
      ctx.scale(dpr, dpr);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';

      // 手机端将内边距压缩到 2.2%（原 4.5%），棋盘网格扩展铺满 96% 屏幕宽！
      paddingX = cWidth * (isMobile ? 0.022 : 0.038);
      paddingY = cHeight * (isMobile ? 0.022 : 0.038);
      gridX = (cWidth - 2 * paddingX) / 15;
      gridY = (cHeight - 2 * paddingY) / 15;
      radius = gridX * 0.44; // 棋子饱满大号，触摸体验极佳
      invalidateBoardCache();
      // 冷启动先绘制一个轻量可见棋盘，丰富主题底盘移到首个交互帧后，
      // 让 gomoku_board_ready/交互标记对应真实可操作的棋盘而不是空白画布。
      const hasStones = board.some(row => Array.isArray(row) && row.some(value => value !== EMPTY));
      if (initialBoardFramePending && !hasStones && !isReplayMode) {
        drawFirstFrame();
        initialBoardFramePending = false;
        const raf = window.requestAnimationFrame || (fn => setTimeout(fn, 0));
        raf(() => setTimeout(() => draw(true), 0));
      } else {
        initialBoardFramePending = false;
        draw(true);
      }
    }

    const actx = new (window.AudioContext || window.webkitAudioContext)();
    window.addEventListener('pointerdown', () => {
      // 音频 Base64 仅在用户第一次操作后加载，避免冷启动解析 80KB 数据。
      if (typeof window.ensureGomokuResource === 'function') {
        void window.ensureGomokuResource('audio').catch(() => {});
      }
      if (actx && actx.state === 'suspended') {
        actx.resume().catch(() => {});
      }
    }, { once: true });
    function playPopSound() {
      if (!soundEnabled) return;
      if (actx.state === 'suspended') actx.resume();
      const t = actx.currentTime;
      const osc = actx.createOscillator(); const gain = actx.createGain();
      osc.type = 'sine'; osc.frequency.setValueAtTime(520, t);
      osc.frequency.exponentialRampToValueAtTime(1250, t + 0.035);
      osc.frequency.exponentialRampToValueAtTime(600, t + 0.08);
      gain.gain.setValueAtTime(0.5, t); gain.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
      osc.connect(gain); gain.connect(actx.destination);
      osc.start(t); osc.stop(t + 0.1);
    }

    // 🔔 治愈系 Q 弹提示音效 (水滴双音升调)
    function playNoticeSound() {
      if (!soundEnabled) return;
      try {
        if (actx.state === 'suspended') actx.resume();
        const t = actx.currentTime;
        const osc = actx.createOscillator(); const gain = actx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(620, t);
        osc.frequency.exponentialRampToValueAtTime(1180, t + 0.06);
        osc.frequency.exponentialRampToValueAtTime(840, t + 0.12);
        gain.gain.setValueAtTime(0.35, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
        osc.connect(gain); gain.connect(actx.destination);
        osc.start(t); osc.stop(t + 0.16);
      } catch (e) {}
    }

    // 🌟 游戏内治愈果冻气泡 HUD 提示控制器 (彻底替代浏览器原生 alert)
    let noticeTimer = null;
    function showGameNotice(message, isWarning = true) {
      const toast = document.getElementById('gameNoticeToast');
      const iconEl = document.getElementById('noticeIconBox');
      const textEl = document.getElementById('noticeTextBox');
      if (!toast || !textEl) return;

      let raw = String(message || '').trim();
      let icon = '🌟';

      // 智能识别前导 emoji，单独作为高亮弹性图标
      const emojiMatch = raw.match(/^(\p{Extended_Pictographic}|\p{Emoji}|[\uD800-\uDBFF][\uDC00-\uDFFF])/u);
      if (emojiMatch) {
        icon = emojiMatch[0];
        raw = raw.slice(emojiMatch[0].length).trim();
      } else {
        if (raw.includes('胜利') || raw.includes('恭喜') || raw.includes('成功') || raw.includes('已')) {
          icon = '🎉';
        } else if (raw.includes('请') || raw.includes('只能') || raw.includes('无法') || raw.includes('还没') || raw.includes('禁止')) {
          icon = '💡';
        }
      }

      if (iconEl) iconEl.textContent = icon;
      textEl.textContent = raw;

      // 播放清脆治愈提示音
      playNoticeSound();

      // 如果施法指引条存在，给予联动抖动反馈
      const promptBar = document.getElementById('skillPromptBar');
      if (promptBar && promptBar.style.display !== 'none') {
        promptBar.classList.remove('shake');
        void promptBar.offsetWidth;
        promptBar.classList.add('shake');
        setTimeout(() => promptBar.classList.remove('shake'), 450);
      }

      // 弹出并摇晃气泡
      toast.classList.remove('show', 'shake');
      void toast.offsetWidth;
      toast.classList.add('show');
      if (isWarning) {
        toast.classList.add('shake');
      }

      if (noticeTimer) clearTimeout(noticeTimer);
      noticeTimer = setTimeout(() => {
        hideGameNotice();
      }, 2200);
    }

    function hideGameNotice() {
      const toast = document.getElementById('gameNoticeToast');
      if (toast) {
        toast.classList.remove('show', 'shake');
      }
      if (noticeTimer) {
        clearTimeout(noticeTimer);
        noticeTimer = null;
      }
    }

    // 🚀 全局拦截并替换 window.alert，再无系统丑陋白色阻塞弹窗！
    window.alert = function(msg) {
      showGameNotice(msg);
    };

    // 🔊 干扰技能专属音效合成器（每张卡独立设计，乾坤大乱保持原爆炸音频）
    function playSkillSound(type) {
      if (!soundEnabled) return;
      try {
        if (actx.state === 'suspended') actx.resume();
        const t = actx.currentTime;

        if (type === 'bomb') {
          // 💣 乾坤大乱：双通道混合爆破音效 (原生 Web Audio 物理轰鸣 + 原版樱桃炸弹音频，彻底解决 APK 静音)
          try {
            // 通道 1：重低音空气震颤冲击波 (150Hz -> 30Hz 强力下潜)
            const subOsc = actx.createOscillator();
            const subGain = actx.createGain();
            subOsc.type = 'triangle';
            subOsc.frequency.setValueAtTime(150, t);
            subOsc.frequency.exponentialRampToValueAtTime(28, t + 0.65);
            subGain.gain.setValueAtTime(0.75, t);
            subGain.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
            subOsc.connect(subGain);
            subGain.connect(actx.destination);
            subOsc.start(t);
            subOsc.stop(t + 0.72);

            // 通道 2：炸药碎裂爆破白噪声
            const bufferSize = Math.floor(actx.sampleRate * 0.45);
            const noiseBuffer = actx.createBuffer(1, bufferSize, actx.sampleRate);
            const output = noiseBuffer.getChannelData(0);
            for (let i = 0; i < bufferSize; i++) output[i] = Math.random() * 2 - 1;
            const whiteNoise = actx.createBufferSource();
            whiteNoise.buffer = noiseBuffer;

            const filter = actx.createBiquadFilter();
            filter.type = 'lowpass';
            filter.frequency.setValueAtTime(850, t);
            filter.frequency.linearRampToValueAtTime(110, t + 0.45);

            const noiseGain = actx.createGain();
            noiseGain.gain.setValueAtTime(0.65, t);
            noiseGain.gain.exponentialRampToValueAtTime(0.001, t + 0.5);

            whiteNoise.connect(filter);
            filter.connect(noiseGain);
            noiseGain.connect(actx.destination);
            whiteNoise.start(t);
            whiteNoise.stop(t + 0.52);
          } catch(err) {
            console.warn('Web Audio physical bomb error:', err);
          }

          // 通道 3：同时唤醒持久化原版樱桃炸弹单例 (防 Android WebView GC 垃圾回收)
          if (window.CHERRY_BOMB_AUDIO_DATA) {
            try {
              if (!window._cherryBombAudio) {
                window._cherryBombAudio = new Audio(window.CHERRY_BOMB_AUDIO_DATA);
                window._cherryBombAudio.preload = 'auto';
              }
              window._cherryBombAudio.currentTime = 0;
              window._cherryBombAudio.play().catch(() => {});
            } catch(e) {}
          }
          return;

        } else if (type === 'victory') {
          // 👑 胜利方音效：大调上行和弦（C5→E5→G5→C6），明亮欢庆，凯旋感十足
          [523.25, 659.25, 783.99, 1046.5].forEach((freq, idx) => {
            const osc = actx.createOscillator(); const gain = actx.createGain();
            osc.type = 'triangle'; osc.frequency.setValueAtTime(freq, t + idx * 0.09);
            gain.gain.setValueAtTime(0.38, t + idx * 0.09);
            gain.gain.exponentialRampToValueAtTime(0.001, t + idx * 0.09 + 0.4);
            osc.connect(gain); gain.connect(actx.destination);
            osc.start(t + idx * 0.09); osc.stop(t + idx * 0.09 + 0.42);
          });

        } else if (type === 'defeat') {
          // 💔 失败方音效：小调下行哀叹和弦 (Eb4→D4→Db4→C4) + 幽默叹息滑音 (260Hz→85Hz)
          const notes = [
            { freq: 311.13, time: 0.00, dur: 0.13 },
            { freq: 293.66, time: 0.12, dur: 0.13 },
            { freq: 277.18, time: 0.24, dur: 0.15 },
            { freq: 261.63, time: 0.38, dur: 0.22 }
          ];
          notes.forEach(({ freq, time, dur }) => {
            const osc = actx.createOscillator(); const gain = actx.createGain();
            osc.type = 'sine'; osc.frequency.setValueAtTime(freq, t + time);
            gain.gain.setValueAtTime(0.35, t + time);
            gain.gain.exponentialRampToValueAtTime(0.001, t + time + dur);
            osc.connect(gain); gain.connect(actx.destination);
            osc.start(t + time); osc.stop(t + time + dur + 0.02);
          });
          const slideOsc = actx.createOscillator(); const slideGain = actx.createGain();
          slideOsc.type = 'triangle';
          slideOsc.frequency.setValueAtTime(260, t + 0.55);
          slideOsc.frequency.exponentialRampToValueAtTime(85, t + 1.15);
          slideGain.gain.setValueAtTime(0.001, t + 0.55);
          slideGain.gain.linearRampToValueAtTime(0.32, t + 0.62);
          slideGain.gain.exponentialRampToValueAtTime(0.001, t + 1.18);
          slideOsc.connect(slideGain); slideGain.connect(actx.destination);
          slideOsc.start(t + 0.55); slideOsc.stop(t + 1.2);

        } else if (type === 'rewind') {
          // ⏳ 时空倒流：正弦波快速从高音降到低音，像磁带倒带/时光倒转
          const osc = actx.createOscillator(); const gain = actx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(1800, t);
          osc.frequency.exponentialRampToValueAtTime(280, t + 0.45);
          gain.gain.setValueAtTime(0.0, t);
          gain.gain.linearRampToValueAtTime(0.5, t + 0.04);
          gain.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
          osc.connect(gain); gain.connect(actx.destination);
          osc.start(t); osc.stop(t + 0.52);
          // 叠加颤音感（LFO 效果）
          const lfo = actx.createOscillator(); const lfoGain = actx.createGain();
          lfo.type = 'sine'; lfo.frequency.setValueAtTime(18, t);
          lfoGain.gain.setValueAtTime(60, t);
          lfoGain.gain.exponentialRampToValueAtTime(1, t + 0.45);
          lfo.connect(lfoGain); lfoGain.connect(osc.frequency);
          lfo.start(t); lfo.stop(t + 0.52);

        } else if (type === 'ice') {
          // ❄️ 寒冰封禁：高频正弦上扫 + 多个短促冰晶碎裂音
          const osc = actx.createOscillator(); const gain = actx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(600, t);
          osc.frequency.exponentialRampToValueAtTime(3200, t + 0.18);
          gain.gain.setValueAtTime(0.35, t);
          gain.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
          osc.connect(gain); gain.connect(actx.destination);
          osc.start(t); osc.stop(t + 0.24);
          // 冰晶碎裂：3个高频短脉冲
          [0.08, 0.15, 0.22].forEach((dt, i) => {
            const c = actx.createOscillator(); const g = actx.createGain();
            c.type = 'triangle';
            c.frequency.setValueAtTime(2800 + i * 400, t + dt);
            g.gain.setValueAtTime(0.22, t + dt);
            g.gain.exponentialRampToValueAtTime(0.001, t + dt + 0.06);
            c.connect(g); g.connect(actx.destination);
            c.start(t + dt); c.stop(t + dt + 0.07);
          });

        } else if (type === 'thunder') {
          // ⚡ 双星连珠：充能爆发感——先快速低音上升积蓄，再一声清脆爆发
          // 积蓄音（低频锯齿上升）
          const charge = actx.createOscillator(); const cGain = actx.createGain();
          charge.type = 'sawtooth';
          charge.frequency.setValueAtTime(80, t);
          charge.frequency.exponentialRampToValueAtTime(520, t + 0.18);
          cGain.gain.setValueAtTime(0.3, t);
          cGain.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
          charge.connect(cGain); cGain.connect(actx.destination);
          charge.start(t); charge.stop(t + 0.21);
          // 爆发音（高频三角波短促清响）
          const burst = actx.createOscillator(); const bGain = actx.createGain();
          burst.type = 'triangle';
          burst.frequency.setValueAtTime(1400, t + 0.18);
          burst.frequency.exponentialRampToValueAtTime(600, t + 0.42);
          bGain.gain.setValueAtTime(0.55, t + 0.18);
          bGain.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
          burst.connect(bGain); bGain.connect(actx.destination);
          burst.start(t + 0.18); burst.stop(t + 0.46);

        } else if (type === 'boom') {
          // 💥 虚空陨石：重低音撞击+噪声冲击波，模拟陨石砸落
          // 撞击低频
          const osc = actx.createOscillator(); const gain = actx.createGain();
          osc.type = 'sawtooth';
          osc.frequency.setValueAtTime(180, t);
          osc.frequency.exponentialRampToValueAtTime(35, t + 0.3);
          gain.gain.setValueAtTime(0.85, t);
          gain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
          osc.connect(gain); gain.connect(actx.destination);
          osc.start(t); osc.stop(t + 0.36);
          // 噪声冲击（用白噪声模拟）
          const bufSize = actx.sampleRate * 0.25;
          const buf = actx.createBuffer(1, bufSize, actx.sampleRate);
          const data = buf.getChannelData(0);
          for (let i = 0; i < bufSize; i++) data[i] = (Math.random() * 2 - 1);
          const noise = actx.createBufferSource(); noise.buffer = buf;
          const nGain = actx.createGain();
          nGain.gain.setValueAtTime(0.4, t);
          nGain.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
          noise.connect(nGain); nGain.connect(actx.destination);
          noise.start(t); noise.stop(t + 0.26);

        } else if (type === 'magic') {
          // ✨ 移星换斗 / 迷雾遮天 / 偷天换日：魔法闪烁感
          // 三颗星星依次闪烁（不同频率的短促正弦音）
          [880, 1108, 1320].forEach((freq, i) => {
            const osc = actx.createOscillator(); const gain = actx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(freq, t + i * 0.08);
            osc.frequency.exponentialRampToValueAtTime(freq * 1.3, t + i * 0.08 + 0.1);
            gain.gain.setValueAtTime(0.28, t + i * 0.08);
            gain.gain.exponentialRampToValueAtTime(0.001, t + i * 0.08 + 0.18);
            osc.connect(gain); gain.connect(actx.destination);
            osc.start(t + i * 0.08); osc.stop(t + i * 0.08 + 0.2);
          });

        } else if (type === 'warp') {
          // 💫 移形换影：瞬移空间扭曲音——先快速上旋，瞬间切断，再从另一极出现
          const osc = actx.createOscillator(); const gain = actx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(300, t);
          osc.frequency.exponentialRampToValueAtTime(2200, t + 0.1);
          osc.frequency.setValueAtTime(180, t + 0.11); // 瞬间切断再出现
          osc.frequency.exponentialRampToValueAtTime(800, t + 0.32);
          gain.gain.setValueAtTime(0.5, t);
          gain.gain.setValueAtTime(0.5, t + 0.1);
          gain.gain.setValueAtTime(0.0, t + 0.11); // 瞬断
          gain.gain.linearRampToValueAtTime(0.45, t + 0.14);
          gain.gain.exponentialRampToValueAtTime(0.001, t + 0.38);
          osc.connect(gain); gain.connect(actx.destination);
          osc.start(t); osc.stop(t + 0.4);

        } else if (type === 'dice') {
          // 🎲 天降神抽：洗牌/卡片翻飞感——快速连打5个短促音像洗牌声 + 最后一个长音
          [660, 784, 880, 1046, 1318].forEach((freq, i) => {
            const osc = actx.createOscillator(); const gain = actx.createGain();
            osc.type = i < 4 ? 'triangle' : 'sine';
            osc.frequency.setValueAtTime(freq, t + i * 0.055);
            gain.gain.setValueAtTime(0.3, t + i * 0.055);
            gain.gain.exponentialRampToValueAtTime(0.001, t + i * 0.055 + (i < 4 ? 0.08 : 0.3));
            osc.connect(gain); gain.connect(actx.destination);
            osc.start(t + i * 0.055); osc.stop(t + i * 0.055 + (i < 4 ? 0.09 : 0.32));
          });

        } else {
          // 兜底通用音效（上滑魔法音）
          const osc = actx.createOscillator(); const gain = actx.createGain();
          osc.type = 'sine'; osc.frequency.setValueAtTime(620, t);
          osc.frequency.exponentialRampToValueAtTime(1600, t + 0.2);
          gain.gain.setValueAtTime(0.5, t); gain.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
          osc.connect(gain); gain.connect(actx.destination);
          osc.start(t); osc.stop(t + 0.3);
        }
      } catch(e) {}
    }
    // ══════════════════════════════════════════════════════════════════
    // 🌐 全球双通道极速连接器 (Cloudflare Pages 优先 + Workers 双重容灾)
    // ══════════════════════════════════════════════════════════════════
    const CLOUDFLARE_API_HOSTS = [
      "https://gomoku-api.pages.dev",
      "https://gomoku-backend.xnnb04664.workers.dev"
    ];
    const API_HOST_STORAGE_KEY = 'gomoku_api_host_v1';
    const API_HOST_HINT_AT_STORAGE_KEY = 'gomoku_api_host_hint_at_v1';
    const API_HOST_HINT_MAX_AGE_MS = 30 * 60 * 1000;
    const API_HOST_FAILURES_STORAGE_KEY = 'gomoku_api_host_failures_v1';
    const API_HOST_FAILURE_COOLDOWN_MS = 60 * 1000;
    const API_HOST_PROBE_TIMEOUT_MS = 2500;
    const API_LOGIN_PATH = '/api/auth/login';
    const API_PROBE_PATH = '/api/network/probe';

    function isAllowedApiHost(host) {
      return CLOUDFLARE_API_HOSTS.includes(host);
    }

    function readStoredApiHost() {
      try {
        const saved = localStorage.getItem(API_HOST_STORAGE_KEY) || '';
        const savedAt = Number(localStorage.getItem(API_HOST_HINT_AT_STORAGE_KEY) || 0);
        const isFresh = Number.isFinite(savedAt) && savedAt > 0 && Date.now() - savedAt < API_HOST_HINT_MAX_AGE_MS;
        return isFresh && isAllowedApiHost(saved) ? saved : '';
      } catch (_) {
        return '';
      }
    }

    function storeApiHost(host) {
      if (!isAllowedApiHost(host)) return;
      try {
        localStorage.setItem(API_HOST_STORAGE_KEY, host);
        localStorage.setItem(API_HOST_HINT_AT_STORAGE_KEY, String(Date.now()));
      } catch (_) {}
    }

    function readApiHostFailures() {
      const result = {};
      try {
        const saved = JSON.parse(localStorage.getItem(API_HOST_FAILURES_STORAGE_KEY) || '{}');
        const now = Date.now();
        for (const host of CLOUDFLARE_API_HOSTS) {
          const failedAt = Number(saved && saved[host]);
          if (Number.isFinite(failedAt) && failedAt > 0 && now - failedAt < API_HOST_FAILURE_COOLDOWN_MS) {
            result[host] = failedAt;
          }
        }
      } catch (_) {}
      return result;
    }

    const storedApiHost = readStoredApiHost();
    let apiHostFailures = readApiHostFailures();
    let activeApiHost = storedApiHost || CLOUDFLARE_API_HOSTS[0];
    let hasApiHostHint = Boolean(storedApiHost);
    let apiHostWarmPromise = null;
    let apiHostWarmAt = 0;

    function persistApiHostFailures() {
      try {
        const now = Date.now();
        const compact = {};
        for (const host of CLOUDFLARE_API_HOSTS) {
          const failedAt = Number(apiHostFailures[host]);
          if (Number.isFinite(failedAt) && failedAt > 0 && now - failedAt < API_HOST_FAILURE_COOLDOWN_MS) {
            compact[host] = failedAt;
          }
        }
        localStorage.setItem(API_HOST_FAILURES_STORAGE_KEY, JSON.stringify(compact));
      } catch (_) {}
    }

    function markApiHostFailure(host) {
      if (!isAllowedApiHost(host)) return;
      apiHostFailures[host] = Date.now();
      persistApiHostFailures();
    }

    function markApiHostSuccess(host) {
      if (!isAllowedApiHost(host)) return;
      delete apiHostFailures[host];
      activeApiHost = host;
      hasApiHostHint = true;
      storeApiHost(host);
      persistApiHostFailures();
    }

    function isApiHostCoolingDown(host) {
      const failedAt = Number(apiHostFailures[host]);
      return Number.isFinite(failedAt) && failedAt > 0 && Date.now() - failedAt < API_HOST_FAILURE_COOLDOWN_MS;
    }

    function getOrderedApiHosts() {
      // Pages 是当前正式入口；Worker 备用出口只在 Pages 失败或进入冷却时接管。
      // 不能仅凭 OPTIONS 谁先返回就把功能未完全配置的备用出口提升为默认，
      // 否则登录/匹配可能被导向一个“能预检、业务不完整”的节点。
      const primaryHost = CLOUDFLARE_API_HOSTS[0];
      const preferredHost = !isApiHostCoolingDown(primaryHost)
        ? primaryHost
        : (isAllowedApiHost(activeApiHost) && !isApiHostCoolingDown(activeApiHost) ? activeApiHost : '');
      const preferred = preferredHost ? [preferredHost] : [];
      const healthy = CLOUDFLARE_API_HOSTS.filter(host => !preferred.includes(host) && !isApiHostCoolingDown(host));
      const cooling = CLOUDFLARE_API_HOSTS.filter(host => isApiHostCoolingDown(host) && !preferred.includes(host));
      return [...preferred, ...healthy, ...cooling];
    }

    function isApiAbortError(error) {
      const message = String(error && error.message || '').toLowerCase();
      return Boolean(error && error.name === 'AbortError') || /abort|timeout|timed out/.test(message);
    }

    function getApiNetworkErrorMessage(error) {
      if (error && (error.code === 'API_TIMEOUT' || error.code === 'API_UNAVAILABLE')) {
        return error.message;
      }
      if (isApiAbortError(error)) return '官方服务响应超时，请检查手机网络后重试';
      return '网络连接失败，请检查手机网络后重试';
    }

    async function probeApiHost(host) {
      const samples = [];
      for (let attempt = 0; attempt < 2; attempt++) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), API_HOST_PROBE_TIMEOUT_MS);
        const startedAt = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
        try {
          const res = await fetch(host + API_PROBE_PATH, { method: 'GET', cache: 'no-store', signal: controller.signal });
          if (!res.ok) throw new Error('HTTP ' + res.status);
          try { await res.json(); } catch (_) {}
          const finishedAt = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
          samples.push(finishedAt - startedAt);
        } finally {
          clearTimeout(timer);
        }
      }
      samples.sort((a, b) => a - b);
      return { host, elapsed: samples[Math.floor(samples.length / 2)] };
    }

    // 登录弹窗打开时并行探测两个官方出口，只选择最快的一个；登录请求本身不会并发发送，避免重复刷新 Token。
    function warmApiHost(force = false) {
      const now = Date.now();
      if (!force && hasApiHostHint) return Promise.resolve(activeApiHost);
      if (apiHostWarmPromise) return apiHostWarmPromise;
      if (!force && apiHostWarmAt && now - apiHostWarmAt < 30 * 1000) {
        return Promise.resolve(activeApiHost);
      }

      apiHostWarmAt = now;
      const probePromises = CLOUDFLARE_API_HOSTS.map(host => probeApiHost(host));
      apiHostWarmPromise = Promise.allSettled(probePromises).then(results => {
        const successful = results.filter(item => item.status === 'fulfilled').map(item => item.value);
        successful.sort((a, b) => a.elapsed - b.elapsed);
        const winner = successful[0];
        if (!winner) return null;
        markApiHostSuccess(winner.host);
        return winner.host;
      }).finally(() => {
        apiHostWarmPromise = null;
      });
      return apiHostWarmPromise;
    }

    async function safeApiFetch(endpoint, options = {}) {
      let lastErr = null;
      const orderedHosts = getOrderedApiHosts();
      const parsedTimeout = Number(options.timeoutMs);
      const timeoutMs = Number.isFinite(parsedTimeout)
        ? Math.max(1500, Math.min(15000, parsedTimeout))
        : 7000;
      const requestOptions = { ...options };
      const anonymousRequest = requestOptions.anonymous === true;
      delete requestOptions.anonymous;
      delete requestOptions.timeoutMs;
      const endpointText = String(endpoint || '');
      let fixedEndpointUrl = null;
      if (/^https?:/i.test(endpointText)) {
        try {
          fixedEndpointUrl = new URL(endpointText);
        } catch (_) {
          throw new Error('官方 API 地址格式无效');
        }
        if (fixedEndpointUrl.protocol !== "https:" ||
            !isAllowedApiHost(fixedEndpointUrl.origin) ||
            fixedEndpointUrl.username || fixedEndpointUrl.password) {
          throw new Error('拒绝访问非官方 API 地址');
        }
      }
      const requestMethod = String(requestOptions.method || 'GET').toUpperCase();
      const isLoginRequest = requestMethod === 'POST' &&
        (fixedEndpointUrl ? fixedEndpointUrl.pathname : endpointText.split('?')[0]) === API_LOGIN_PATH;
      const attemptErrors = [];
      let lastServerResponse = null;

      for (const [hostIndex, host] of orderedHosts.entries()) {
        let timer = null;
        try {
          const controller = new AbortController();
          timer = setTimeout(() => controller.abort(), timeoutMs);
          const endpointUrl = fixedEndpointUrl || new URL(endpointText, host);
          if (endpointUrl.protocol !== "https:" || !isAllowedApiHost(endpointUrl.origin) || endpointUrl.username || endpointUrl.password) {
            throw new Error('拒绝访问非官方 API 地址');
          }
          const mergedHeaders = {
            ...(requestOptions.headers || {})
          };
          try {
            const sessionToken = (typeof currentUserToken !== 'undefined' && currentUserToken)
              || localStorage.getItem("gomoku_user_token") || "";
            const hasAuthorizationHeader = Object.keys(mergedHeaders).some(key => key.toLowerCase() === 'authorization');
            // 登录不携带旧会话，也不加自定义请求头，避免 Android WebView 额外发起 CORS 预检。
            if (!anonymousRequest && !isLoginRequest && sessionToken && !hasAuthorizationHeader) {
              mergedHeaders.Authorization = 'Bearer ' + sessionToken;
            }
          } catch (_) {}
          const res = await fetch(endpointUrl.href, {
            ...requestOptions,
            headers: mergedHeaders,
            signal: controller.signal
          });

          // 仅对服务端错误尝试备用出口；4xx 是业务响应，应原样交给调用方处理。
          if (res.status >= 500 && hostIndex < orderedHosts.length - 1) {
            lastServerResponse = res;
            markApiHostFailure(host);
            try { await res.body?.cancel(); } catch (_) {}
            lastErr = new Error(host + ' returned HTTP ' + res.status);
            continue;
          }
          if (res.status >= 500) {
            lastServerResponse = res;
            markApiHostFailure(host);
          } else {
            markApiHostSuccess(host);
          }
          return res;
        } catch(err) {
          lastErr = err;
          attemptErrors.push({ error: err, timedOut: isApiAbortError(err) });
          markApiHostFailure(host);
          console.warn('Host ' + host + ' failed: ' + (err && err.message || err) + ', trying fallback...');
        } finally {
          if (timer) clearTimeout(timer);
        }
      }
      if (lastServerResponse) return lastServerResponse;
      if (attemptErrors.length && attemptErrors.every(item => item.timedOut)) {
        const timeoutError = new Error('官方服务响应超时，请检查手机网络后重试');
        timeoutError.code = 'API_TIMEOUT';
        timeoutError.cause = lastErr;
        throw timeoutError;
      }
      const networkError = new Error('无法连接官方服务，请检查手机网络后重试');
      networkError.code = 'API_UNAVAILABLE';
      networkError.cause = lastErr;
      throw networkError;
    }

    // 匿名性能/线路指标：每次启动随机采样，不生成或保存设备标识，也不携带登录令牌。
    const GOMOKU_METRICS_SAMPLE_RATE = 0.25;
    const gomokuMetricsSampled = Math.random() < GOMOKU_METRICS_SAMPLE_RATE;
    let gomokuMetricsQueue = [];
    let gomokuMetricsFlushTimer = null;

    function areGomokuMetricsEnabled() {
      try { return localStorage.getItem('gomoku_metrics_enabled') !== '0'; }
      catch (_) { return true; }
    }

    function getGomokuMetricBucket(metric, value) {
      if (metric === 'reconnect_result') return value > 0 ? 'success' : 'failure';
      if (metric === 'network_rtt') {
        if (value <= 80) return 'fast';
        if (value <= 180) return 'normal';
        if (value <= 500) return 'slow';
        return 'very_slow';
      }
      if (value <= 1000) return 'fast';
      if (value <= 2000) return 'normal';
      if (value <= 4000) return 'slow';
      return 'very_slow';
    }

    function getGomokuMetricEndpoint() {
      return /pages\.dev$/i.test(activeApiHost) ? 'pages' : 'worker';
    }

    function getGomokuMetricPlatform() {
      if (typeof AndroidNativeApp !== 'undefined') return 'android';
      return /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent || '') ? 'mobile' : 'desktop';
    }

    async function flushGomokuMetrics() {
      if (gomokuMetricsFlushTimer) clearTimeout(gomokuMetricsFlushTimer);
      gomokuMetricsFlushTimer = null;
      if (!gomokuMetricsSampled || !areGomokuMetricsEnabled() || !gomokuMetricsQueue.length) {
        gomokuMetricsQueue = [];
        return;
      }
      const samples = gomokuMetricsQueue.splice(0, 20);
      try {
        const response = await safeApiFetch('/api/metrics', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            clientVersion: CURRENT_VERSION_TAG,
            platform: getGomokuMetricPlatform(),
            samples
          }),
          anonymous: true,
          keepalive: true,
          timeoutMs: 4500
        });
        if (!response.ok) throw new Error('HTTP ' + response.status);
      } catch (_) {
        // 匿名统计永远不能干扰游戏；失败样本不落盘、不重试到下一次启动。
      }
    }

    window.recordGomokuMetric = function(metric, value, details = {}) {
      if (!gomokuMetricsSampled || !areGomokuMetricsEnabled()) return false;
      const numericValue = Number(value);
      if (!Number.isFinite(numericValue) || numericValue < 0) return false;
      const route = ['direct', 'turn', 'websocket'].includes(details.route) ? details.route : '';
      const endpoint = ['pages', 'worker'].includes(details.endpoint) ? details.endpoint : getGomokuMetricEndpoint();
      const bucket = String(details.bucket || getGomokuMetricBucket(metric, numericValue));
      gomokuMetricsQueue.push({ metric: String(metric), value: numericValue, bucket, endpoint, route });
      if (gomokuMetricsQueue.length >= 10) void flushGomokuMetrics();
      else if (!gomokuMetricsFlushTimer) gomokuMetricsFlushTimer = setTimeout(flushGomokuMetrics, 2500);
      return true;
    };
    window.flushGomokuMetrics = flushGomokuMetrics;

    // API 出口测速只在打开登录弹窗或实际使用网络功能时触发，不占用冷启动网络与 CPU。

    // ══════════════════════════════════════════════════════════════════
    // 🛡️ 云端账号认证与永久免登持久化管理器 (Permanent Session & Native Sync)
    // ══════════════════════════════════════════════════════════════════
    let currentUserUid = localStorage.getItem('gomoku_user_uid') || '';
    let currentUserToken = localStorage.getItem('gomoku_user_token') || '';
    let currentUserRefreshToken = localStorage.getItem('gomoku_user_refresh_token') || '';
    let currentUserScore = parseInt(localStorage.getItem('gomoku_user_score') || '1000', 10);

    function updateLadderBadgeUI(score) {
      if (typeof score === 'number') currentUserScore = score;
      const badge = document.getElementById('myLadderBadge');
      if (badge) badge.textContent = `${currentUserScore} 分`;
      updatePlayerHeaderUI();
    }
    let currentUsername = localStorage.getItem('gomoku_user_username') || '';

    function hasRegisteredAccountSession() {
      return Boolean(
        currentUsername && currentUserUid && currentUserToken
        && !String(currentUserUid).startsWith('guest_')
      );
    }

    // 🛡️ 尝试从 Android 原生 SharedPreferences 读取免登双保险备份
    if ((!currentUsername || !currentUserUid || !currentUserToken || !currentUserRefreshToken) && typeof AndroidNativeApp !== 'undefined' && AndroidNativeApp.getUserLoginJson) {
      try {
        const nativeJson = AndroidNativeApp.getUserLoginJson();
        if (nativeJson) {
          const nativeUser = JSON.parse(nativeJson);
          if (nativeUser.username) {
            currentUsername = nativeUser.username;
            currentUserUid = nativeUser.uid || currentUserUid;
            currentUserToken = nativeUser.token || currentUserToken;
            currentUserRefreshToken = nativeUser.refreshToken || currentUserRefreshToken;
            localStorage.setItem('gomoku_user_uid', currentUserUid);
            localStorage.setItem('gomoku_user_token', currentUserToken);
            if (currentUserRefreshToken) localStorage.setItem('gomoku_user_refresh_token', currentUserRefreshToken);
            localStorage.setItem('gomoku_user_username', currentUsername);
            if (nativeUser.nickname) {
              p1Name = nativeUser.nickname;
              localStorage.setItem('gomoku_p1Name', p1Name);
            }
            if (nativeUser.avatar) {
              p1Avatar = nativeUser.avatar;
              localStorage.setItem('gomoku_p1Avatar', p1Avatar);
            }
          }
        }
      } catch(e) {}
    }

    async function refreshUserSession() {
      if (!currentUserUid || !currentUserRefreshToken || String(currentUserUid).startsWith('guest_')) return false;
      try {
        const res = await safeApiFetch('/api/auth/refresh_session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ uid: currentUserUid, refreshToken: currentUserRefreshToken }),
          timeoutMs: 7000
        });
        const json = await res.json();
        if (json && json.code === 0 && json.data) {
          applyUserData(json.data);
          return true;
        }
        if (json && json.code === 2) {
          console.warn('refresh_session token invalid:', json.msg);
        } else {
          console.warn('refresh_session temporarily unavailable:', json && json.msg);
        }
      } catch (e) {
        console.warn('refresh_session offline fallback, keep local session:', e);
      }
      return false;
    }

    async function initUserSession() {
      // 1. 若本地已保存正式账号或凭证：发起无感静默验证与 1 年超长自动续期
      if (currentUserUid && currentUserToken) {
        try {
          const res = await safeApiFetch(`/api/auth/verify_session`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              uid: currentUserUid,
              token: currentUserToken
            })
          });
          const json = await res.json();
          if (json && json.code === 0 && json.data) {
            // 云端验证成功，静默校准天梯积分与头像
            applyUserData(json.data);
            return;
          } else if (res.status === 401 || (json && json.code === 2)) {
            if (await refreshUserSession()) return;
            showGameNotice('⚠️ 登录状态已失效，请重新登录账号', true);
          } else if (json && json.code === 1) {
            // “用户不存在/缺少 uid”是服务端数据问题，不等同于凭证过期，避免误导用户。
            console.warn('verify_session account sync failed:', json.msg);
          }
        } catch (e) {
          console.warn('verify_session offline fallback, keep local session:', e);
          // 网络慢或离线时：百分之百保留本地登录态，绝对不清空账号！
          return;
        }
      }

      // 旧网页缓存或原生备份可能只有 Refresh Token，直接走无感换发。
      if (currentUserUid && currentUserRefreshToken && !currentUserToken) {
        if (await refreshUserSession()) return;
      }

      // 2. 游客模式：完全本地化，不创建数据库记录，不上天梯榜
      // 只有注册/登录的真实账号才和服务器交互
      if (!currentUserUid && !currentUsername) {
        // 从本地 localStorage 读取或生成游客昵称（纯本地，零服务器请求）
        let guestNick = localStorage.getItem('gomoku_guest_nickname');
        if (!guestNick) {
          const prefixes = ['逍遥','灵动','疾风','星月','青云','竹林','傲雪','听雨','落樱','幻影'];
          const suffixes = ['棋仙','弈客','少侠','神算','隐士','先锋','棋圣','奇才'];
          guestNick = prefixes[Math.floor(Math.random()*prefixes.length)] +
                      suffixes[Math.floor(Math.random()*suffixes.length)] +
                      '_' + Math.floor(10+Math.random()*90);
          localStorage.setItem('gomoku_guest_nickname', guestNick);
        }
        if (!p1Name || p1Name === '玩家1') {
          p1Name = guestNick;
          localStorage.setItem('gomoku_p1Name', p1Name);
        }
        updatePlayerHeaderUI();
        updateAccountUI();
      }
    }

    function applyUserData(data) {
      if (!data) return;
      if (typeof data.score === 'number') {
        const badge = document.getElementById('myLadderBadge');
        if (badge) badge.textContent = `${data.score} 分`;
      }
      if (data.uid) {
        currentUserUid = String(data.uid);
        localStorage.setItem("gomoku_user_uid", currentUserUid);
      } else if (data.uid === null) {
        currentUserUid = "";
        localStorage.removeItem("gomoku_user_uid");
      }
      if (data.token) {
        currentUserToken = String(data.token);
        localStorage.setItem("gomoku_user_token", currentUserToken);
      } else if (data.token === null) {
        currentUserToken = "";
        localStorage.removeItem("gomoku_user_token");
      }
      if (data.refreshToken) {
        currentUserRefreshToken = String(data.refreshToken);
        localStorage.setItem("gomoku_user_refresh_token", currentUserRefreshToken);
      } else if (data.refreshToken === null) {
        currentUserRefreshToken = "";
        localStorage.removeItem("gomoku_user_refresh_token");
      }
      if (typeof data.username === "string" && data.username.trim()) {
        currentUsername = data.username.trim();
        localStorage.setItem("gomoku_user_username", currentUsername);
      } else if (data.username === null) {
        // 明确传入 null 时才表示注销
        currentUsername = "";
        localStorage.removeItem("gomoku_user_username");
        if (typeof AndroidNativeApp !== "undefined" && AndroidNativeApp.clearUserLogin) {
          try { AndroidNativeApp.clearUserLogin(); } catch(e) {}
        }
      }

      // 恢复账号中持久化保存的头像与昵称
      if (data.avatar) {
        if (data.avatar === "anime_boy") p1Avatar = window.ANIME_AVATAR_BOY || "img/avatar_boy.png";
        else if (data.avatar === "anime_girl") p1Avatar = window.ANIME_AVATAR_GIRL || "img/avatar_girl.png";
        else p1Avatar = data.avatar;
        selectedAvatarData = p1Avatar;
        localStorage.setItem("gomoku_p1Avatar", p1Avatar);
      }
      if (data.nickname) {
        p1Name = data.nickname;
        localStorage.setItem("gomoku_p1Name", p1Name);
      }
      updatePlayerHeaderUI();
      updateAccountUI();
      updateHistoryCountUI();
      syncCloudHistory();

      // 双保险：写入 Android 原生持久化存储（不怕清缓存、不怕杀后台）
      if (currentUsername && typeof AndroidNativeApp !== "undefined" && AndroidNativeApp.saveUserLogin) {
        try {
          AndroidNativeApp.saveUserLogin(currentUserUid, currentUsername, currentUserToken, p1Name, p1Avatar);
        } catch(e) {}
      }
      if (currentUsername && currentUserRefreshToken && typeof AndroidNativeApp !== "undefined" && AndroidNativeApp.saveUserRefreshToken) {
        try { AndroidNativeApp.saveUserRefreshToken(currentUserRefreshToken); } catch(e) {}
      }

      // 同步天梯分与段位
      if (typeof data.score === "number") {
        currentUserScore = data.score;
        localStorage.setItem("gomoku_user_score", currentUserScore);
        updateLadderBadgeUI(currentUserScore);
      }

      updateAccountUI();
      if (hasRegisteredAccountSession() && typeof window.ensureGomokuFeature === 'function') {
        window.ensureGomokuFeature('social').then(() => window.GomokuSocial.start()).catch(() => {});
      }
    }

    function updateAccountUI() {
      const icon = document.getElementById('accountStatusIcon');
      const title = document.getElementById('accountStatusTitle');
      const uidBadge = document.getElementById('userUidBadge');
      const subText = document.getElementById('accountSubText');
      const btnAuth = document.getElementById('btnAuthAction');
      const btnChangePassword = document.getElementById('btnChangePasswordAction');

      if (uidBadge && currentUserUid) {
        uidBadge.textContent = `UID: ${currentUserUid} 📋`;
      }

      const btnLogout = document.getElementById("btnLogoutAction");
      if (hasRegisteredAccountSession()) {
        if (icon) icon.textContent = "✅";
        if (title) {
          title.innerHTML = `<span style="color:#0369a1; font-weight:900;">${escapeHtml(currentUsername)}</span> <span style="font-size:9.5px; color:#0284c7; background:#e0f2fe; padding:1px 4px; border-radius:4px; font-weight:800; border:1px solid #bae6fd; flex-shrink:0;">正式</span>`;
          title.title = `正式账号: ${currentUsername}`;
        }
        if (subText) {
          subText.textContent = "💡 战绩全服同步";
          subText.title = "战绩已在全服云端实时同步";
        }
        if (btnAuth) {
          btnAuth.textContent = "🔄 切换";
          btnAuth.onclick = () => openAuthModal("login");
        }
        if (btnChangePassword) {
          btnChangePassword.style.display = "inline-block";
        }
        if (btnLogout) {
          btnLogout.style.display = "inline-block";
        }
      } else {
        if (icon) icon.textContent = "👤";
        if (title) {
          title.textContent = "游客身份 (未绑定)";
          title.title = "游客身份 (未绑定)";
        }
        if (subText) {
          subText.textContent = "💡 注册绑定后战绩永不丢失";
          subText.title = "注册绑定账号密码，换手机重装不丢积分";
        }
        if (btnAuth) {
          btnAuth.textContent = "🔑 登录/注册";
          btnAuth.onclick = () => openAuthModal("login");
        }
        if (btnChangePassword) {
          btnChangePassword.style.display = "none";
        }
        if (btnLogout) {
          btnLogout.style.display = "none";
        }
      }
      updateHistoryCountUI();
    }

    function copyMyUid() {
      if (!currentUserUid) return;
      navigator.clipboard.writeText(currentUserUid).then(() => {
        showGameNotice(`📋 专属 UID [${currentUserUid}] 已复制到剪贴板！`, true);
      }).catch(() => {
        prompt('请复制您的专属 UID：', currentUserUid);
      });
    }


    let selectedSecurityQValue = '❤️ 你最喜欢的人是谁？';

    function toggleQDropdown(e) {
      if (e) e.stopPropagation();
      const menu = document.getElementById('qDropdownMenu');
      if (!menu) return;
      menu.style.display = (menu.style.display === 'none' || !menu.style.display) ? 'block' : 'none';
    }

    function pickSecurityQ(val) {
      selectedSecurityQValue = val;
      const display = document.getElementById('selectedQDisplay');
      const customRow = document.getElementById('customQInputRow');
      const menu = document.getElementById('qDropdownMenu');
      if (menu) menu.style.display = 'none';

      if (val === 'custom') {
        if (display) display.textContent = '✏️ [自定义] 自己出题...';
        if (customRow) customRow.style.display = 'block';
        const customInput = document.getElementById('regCustomSecurityQ');
        if (customInput) customInput.focus();
      } else {
        if (display) display.textContent = val;
        if (customRow) customRow.style.display = 'none';
      }
    }

    document.addEventListener('click', (e) => {
      const menu = document.getElementById('qDropdownMenu');
      if (menu && menu.style.display === 'block') {
        const trigger = document.getElementById('customQTrigger');
        if (trigger && !trigger.contains(e.target) && !menu.contains(e.target)) {
          menu.style.display = 'none';
        }
      }
    });

    function openAuthModal(tab = 'login') {
      const modal = document.getElementById('authModal');
      if (modal) {
        modal.classList.add('show');
        switchAuthTab(tab);
        // 提前探测官方出口，让用户填写账号密码的时间与网络探测并行。
        void warmApiHost();
      }
    }

    function closeAuthModal() {
      const modal = document.getElementById('authModal');
      if (modal) modal.classList.remove('show');
    }

    function openChangePasswordModal() {
      if (!hasRegisteredAccountSession()) {
        showGameNotice('请先登录正式账号，再修改登录密码', true);
        return;
      }
      closeProfileModal();
      const modal = document.getElementById('changePasswordModal');
      const errorEl = document.getElementById('changePasswordErrorMsg');
      if (errorEl) {
        errorEl.textContent = '';
        errorEl.style.display = 'none';
      }
      ['changeCurrentPassword', 'changeNewPassword', 'changeConfirmPassword'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
      });
      if (modal) {
        modal.classList.add('show');
        setTimeout(() => document.getElementById('changeCurrentPassword')?.focus(), 80);
      }
    }

    function closeChangePasswordModal(reopenProfile = true) {
      const modal = document.getElementById('changePasswordModal');
      if (modal) modal.classList.remove('show');
      ['changeCurrentPassword', 'changeNewPassword', 'changeConfirmPassword'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
      });
      if (reopenProfile && typeof openProfileModal === 'function') {
        openProfileModal();
      }
    }

    async function submitChangePassword() {
      const currentPassword = document.getElementById('changeCurrentPassword')?.value || '';
      const newPassword = document.getElementById('changeNewPassword')?.value || '';
      const confirmPassword = document.getElementById('changeConfirmPassword')?.value || '';
      const errorEl = document.getElementById('changePasswordErrorMsg');
      const btnSubmit = document.getElementById('btnChangePasswordSubmit');
      const showError = (message) => {
        if (errorEl) {
          errorEl.textContent = message;
          errorEl.style.display = 'block';
        }
      };

      if (!hasRegisteredAccountSession()) {
        showError('登录状态已失效，请重新登录');
        return;
      }
      if (!currentPassword) {
        showError('请输入当前密码');
        return;
      }
      if (!newPassword || newPassword.length < 6 || newPassword.length > 32) {
        showError('新密码长度须为 6~32 位');
        return;
      }
      if (newPassword !== confirmPassword) {
        showError('两次输入的新密码不一致');
        return;
      }
      if (currentPassword === newPassword) {
        showError('新密码不能与当前密码相同');
        return;
      }

      if (errorEl) errorEl.style.display = 'none';
      if (btnSubmit) {
        btnSubmit.disabled = true;
        btnSubmit.style.opacity = '0.75';
        btnSubmit.innerHTML = '<span>⏳ 正在安全修改...</span>';
      }

      try {
        const res = await safeApiFetch('/api/auth/change_password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            uid: currentUserUid,
            token: currentUserToken,
            currentPassword,
            newPassword
          })
        });
        const json = await res.json();
        if (json.code === 0 && json.data) {
          applyUserData(json.data);
          closeChangePasswordModal();
          showGameNotice('🔒 密码修改成功！当前登录凭证已刷新', true);
        } else {
          showError(json.msg || '密码修改失败，请稍后重试');
        }
      } catch (err) {
        showError(getApiNetworkErrorMessage(err));
      } finally {
        if (btnSubmit) {
          btnSubmit.disabled = false;
          btnSubmit.style.opacity = '1';
          btnSubmit.innerHTML = '🔐 保存新密码';
        }
      }
    }

    function switchAuthTab(tab) {
      ['login', 'register', 'reset'].forEach(t => {
        const btn = document.getElementById('tabAuth' + t.charAt(0).toUpperCase() + t.slice(1));
        const view = document.getElementById('viewAuth' + t.charAt(0).toUpperCase() + t.slice(1));
        if (btn) btn.classList.toggle('active', t === tab);
        if (view) view.style.display = (t === tab) ? 'block' : 'none';
      });
      // 隐藏所有报错条
      ['loginErrorMsg', 'regErrorMsg', 'resetErrorMsg'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
      });
      if (tab === 'login') {
        const uInput = document.getElementById('loginUsername');
        if (uInput && !uInput.value && currentUsername) {
          uInput.value = currentUsername;
        }
      } else if (tab === 'reset') {
        const r1 = document.getElementById('resetStep1');
        const r2 = document.getElementById('resetStep2');
        if (r1) r1.style.display = 'block';
        if (r2) r2.style.display = 'none';
        const rInput = document.getElementById('resetUsername');
        if (rInput && !rInput.value && currentUsername) {
          rInput.value = currentUsername;
        }
      }
    }

    async function submitLogin() {
      const u = (document.getElementById("loginUsername").value || "").trim();
      const p = (document.getElementById("loginPassword").value || "");
      const errEl = document.getElementById("loginErrorMsg");
      const btnSubmit = document.getElementById("btnLoginSubmit");

      if (!u || !p) {
        errEl.textContent = "请输入账号与密码";
        errEl.style.display = "block";
        return;
      }

      errEl.style.display = "none";
      if (btnSubmit) {
        btnSubmit.disabled = true;
        btnSubmit.style.opacity = "0.75";
        btnSubmit.innerHTML = "<span>⏳ 正在登录验证中...</span>";
      }

      try {
        await warmApiHost();
        const res = await safeApiFetch(`/api/auth/login`, {
          method: "POST",
          // 后端按 JSON 内容解析请求体；text/plain 属于 CORS 简单请求，避免手机 WebView 先等待一次预检。
          headers: { "Content-Type": "text/plain;charset=UTF-8" },
          body: JSON.stringify({ username: u, password: p }),
          cache: "no-store",
          timeoutMs: 6000
        });
        const json = await res.json();
        if (json.code === 0 && json.data) {
          applyUserData(json.data);
          p1Name = json.data.nickname || u;
          localStorage.setItem("gomoku_p1Name", p1Name);
          updatePlayerHeaderUI();
          updateAccountUI();
          updateHistoryCountUI();
          closeAuthModal();
          showGameNotice(`🎉 欢迎回来，棋士【${p1Name}】！已成功登录`, true);
        } else {
          errEl.textContent = json.msg || "登录失败，请检查账号或密码";
          errEl.style.display = "block";
        }
      } catch (err) {
        errEl.textContent = getApiNetworkErrorMessage(err);
        errEl.style.display = "block";
      } finally {
        if (btnSubmit) {
          btnSubmit.disabled = false;
          btnSubmit.style.opacity = "1";
          btnSubmit.innerHTML = "🚀 立即安全登录";
        }
      }
    }

    async function submitRegister() {
      const u = (document.getElementById('regUsername').value || '').trim();
      const p = (document.getElementById('regPassword').value || '');
      let q = selectedSecurityQValue;
      if (q === 'custom') {
        q = (document.getElementById('regCustomSecurityQ').value || '').trim();
        if (!q) {
          const errEl = document.getElementById('regErrorMsg');
          errEl.textContent = '请填写您自己编写的专属密保问题';
          errEl.style.display = 'block';
          return;
        }
      }
      const a = (document.getElementById('regSecurityA').value || '').trim();
      const errEl = document.getElementById('regErrorMsg');

      if (!u) {
        errEl.textContent = '请输入账号名称';
        errEl.style.display = 'block';
        return;
      }
      if (u.length > 32) {
        errEl.textContent = '账号名称长度最多 32 个字符';
        errEl.style.display = 'block';
        return;
      }
      if (!p || p.length < 6) {
        errEl.textContent = '密码长度至少 6 位';
        errEl.style.display = 'block';
        return;
      }
      if (!a) {
        errEl.textContent = '请填写密保答案，以便忘记密码时找回';
        errEl.style.display = 'block';
        return;
      }

      errEl.style.display = "none";
      const btnReg = document.getElementById("btnRegSubmit");
      if (btnReg) {
        btnReg.disabled = true;
        btnReg.style.opacity = "0.75";
        btnReg.innerHTML = "<span>⏳ 正在注册并绑定账号...</span>";
      }

      try {
        const res = await safeApiFetch(`/api/auth/register`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            username: u,
            password: p,
            nickname: p1Name || u,
            avatar: getAvatarSyncValue(p1Avatar || "👦"),
            uid: currentUserUid,
            token: currentUserToken,
            securityQuestion: q,
            securityAnswer: a
          })
        });
        const json = await res.json();
        if (json.code === 0 && json.data) {
          applyUserData(json.data);
          closeAuthModal();
          showGameNotice(`🎉 账号【${u}】注册并绑定成功！战绩积分终身保留`, true);
        } else {
          errEl.textContent = json.msg || "注册失败";
          errEl.style.display = "block";
        }
      } catch (err) {
        errEl.textContent = getApiNetworkErrorMessage(err);
        errEl.style.display = "block";
      } finally {
        if (btnReg) {
          btnReg.disabled = false;
          btnReg.style.opacity = "1";
          btnReg.innerHTML = "✨ 立即注册并永久绑定战绩";
        }
      }
    }

    async function fetchSecurityQuestion() {
      const u = (document.getElementById('resetUsername').value || '').trim();
      const errEl = document.getElementById('resetErrorMsg');

      if (!u) {
        errEl.textContent = '请输入要找回的账号';
        errEl.style.display = 'block';
        return;
      }

      errEl.style.display = 'none';
      try {
        const res = await safeApiFetch(`/api/auth/get_security_q`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: u })
        });
        const json = await res.json();
        if (json.code === 0 && json.data) {
          document.getElementById('displaySecurityQ').textContent = json.data.question;
          document.getElementById('resetStep1').style.display = 'none';
          document.getElementById('resetStep2').style.display = 'block';
        } else {
          errEl.textContent = json.msg || '查询账号失败';
          errEl.style.display = 'block';
        }
      } catch(e) {
        errEl.textContent = getApiNetworkErrorMessage(e);
        errEl.style.display = 'block';
      }
    }

    async function submitResetPassword() {
      const u = (document.getElementById('resetUsername').value || '').trim();
      const a = (document.getElementById('resetAnswer').value || '').trim();
      const np = (document.getElementById('resetNewPwd').value || '');
      const errEl = document.getElementById('resetErrorMsg');

      if (!a) {
        errEl.textContent = '请输入密保答案';
        errEl.style.display = 'block';
        return;
      }
      if (!np || np.length < 6) {
        errEl.textContent = '新密码长度至少 6 位';
        errEl.style.display = 'block';
        return;
      }

      errEl.style.display = 'none';
      try {
        const res = await safeApiFetch(`/api/auth/reset_password`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: u, securityAnswer: a, newPassword: np })
        });
        const json = await res.json();
        if (json.code === 0 && json.data) {
          applyUserData(json.data);
          closeAuthModal();
          showGameNotice(`🎉 密码已成功重置！已自动安全登录`, true);
        } else {
          errEl.textContent = json.msg || '重置密码失败';
          errEl.style.display = 'block';
        }
      } catch(e) {
        errEl.textContent = getApiNetworkErrorMessage(e);
        errEl.style.display = 'block';
      }
    }


    // ══════════════════════════════════════════════════════════════════
    // 🏆 Cloudflare Worker + D1 全服天梯排行榜与战绩同步系统
    // ══════════════════════════════════════════════════════════════════
    let isReportingMatch = false;

    function ensureAccountFeature() {
      return window.ensureGomokuFeature('account');
    }
    function openLeaderboardModal() {
      const proxy = openLeaderboardModal;
      return ensureAccountFeature().then(() => {
        if (window.openLeaderboardModal === proxy) throw new Error('排行榜模块加载后未注册');
        return window.openLeaderboardModal();
      }).catch(error => showGameNotice(error.message || '排行榜加载失败', true));
    }
    function openFeedbackModal() {
      const proxy = openFeedbackModal;
      return ensureAccountFeature().then(() => {
        if (window.openFeedbackModal === proxy) throw new Error('反馈模块加载后未注册');
        return window.openFeedbackModal();
      }).catch(error => showGameNotice(error.message || '反馈模块加载失败', true));
    }

    // 🏠 本地战绩存储（游客本地计数，登录后同步）
    function getLocalStats() {
      try {
        const raw = localStorage.getItem('gomoku_local_stats');
        const parsed = raw ? JSON.parse(raw) : {};
        return {
          wins: Number.isFinite(Number(parsed.wins)) ? Math.max(0, Number(parsed.wins)) : 0,
          losses: Number.isFinite(Number(parsed.losses)) ? Math.max(0, Number(parsed.losses)) : 0,
          draws: Number.isFinite(Number(parsed.draws)) ? Math.max(0, Number(parsed.draws)) : 0
        };
      } catch { return { wins: 0, losses: 0, draws: 0 }; }
    }
    function saveLocalStats(stats) {
      try { localStorage.setItem('gomoku_local_stats', JSON.stringify(stats)); } catch {}
    }
    function addLocalResult(isWin, isDraw = false) {
      const s = getLocalStats();
      if (isDraw) s.draws++;
      else if (isWin) s.wins++;
      else s.losses++;
      saveLocalStats(s);
      updateLocalStatsUI(s);
    }
    function rollbackLocalResult(isWin, isDraw = false) {
      const s = getLocalStats();
      if (isDraw) s.draws = Math.max(0, s.draws - 1);
      else if (isWin) s.wins = Math.max(0, s.wins - 1);
      else s.losses = Math.max(0, s.losses - 1);
      saveLocalStats(s);
      updateLocalStatsUI(s);
    }
    function updateLocalStatsUI(s) {
      s = s || getLocalStats();
      const el = document.getElementById('localStatsLabel');
      if (el) el.textContent = `本局战绩 胜${s.wins} 负${s.losses} 平${s.draws}`;
    }

    let activeMatchResultScore = null;
    let activeMatchStartingScore = null;

    async function reportMatchResult(isWin, isDraw = false) {
      isDraw = !!isDraw;
      if (isDraw) isWin = false;
      if (isReportingMatch) return;
      isReportingMatch = true;
      setTimeout(() => { isReportingMatch = false; }, 2000);

      // 🏠 游客：纯本地存储，不上天梯榜
      if (!hasRegisteredAccountSession()) {
        addLocalResult(isWin, isDraw);
        const s = getLocalStats();
        if (isDraw) {
          updateGameResultModalDrawStats(`本地战绩: ${s.wins} 胜 ${s.losses} 负 ${s.draws} 和`);
          showGameNotice(`🤝 本局和棋！本地战绩 ${s.wins}胜${s.losses}负${s.draws}和（登录账号可上天梯榜）`, false);
        } else {
          updateGameResultModalGuest(s);
          showGameNotice(isWin
            ? `🎉 本局胜利！本地战绩 ${s.wins}胜${s.losses}负（登录账号可上天梯榜）`
            : `💔 本局落败！本地战绩 ${s.wins}胜${s.losses}负（登录账号可上天梯榜）`, false);
        }
        return;
      }

      // ☁️ 登录账号：上报天梯榜
      activeMatchStartingScore = currentUserScore;
      activeMatchResultScore = null;
      try {
        const res = await safeApiFetch(`/api/report_game`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            uid: currentUserUid,
            token: currentUserToken,
            isWin: !!isWin,
            isDraw
          })
        });
        const data = await res.json();
        if (data && data.code === 0 && data.data) {
          const oldScore = (typeof data.data.oldScore === 'number') ? data.data.oldScore : activeMatchStartingScore;
          const newScore = data.data.newScore;
          const delta = typeof data.data.scoreDelta === 'number' ? data.data.scoreDelta : (isWin ? 25 : -15);

          currentUserScore = newScore;
          localStorage.setItem('gomoku_user_score', currentUserScore);
          updateLadderBadgeUI(currentUserScore);
          activeMatchResultScore = { isWin, oldScore, newScore, delta, data: data.data };
          if (isDraw) {
            updateGameResultModalDrawStats(`云端天梯战绩: ${data.data.wins || 0}胜/${data.data.total_games || 0}局 · 本局和棋，积分不变`);
          } else {
            updateGameResultModalScore(activeMatchResultScore);
          }

          const toastMsg = isDraw
            ? `🤝 本局和棋，积分不变（${newScore}分），已同步云端`
            : (isWin ? `🏆 天梯胜利！积分 +25 (${newScore}分)，已同步云端` : `💔 天梯惜败！积分 -15 (${newScore}分)，已同步云端`);
          showGameNotice(toastMsg, true);
          leaderboardLoadedAt = 0;
          setTimeout(() => fetchGlobalLeaderboard(false), 800);
        } else if (data && data.code === 403) {
          addLocalResult(isWin, isDraw);
          const s = getLocalStats();
          if (isDraw) updateGameResultModalDrawStats(`本地暂存: ${s.wins} 胜 ${s.losses} 负 ${s.draws} 和 · 登录已过期`);
          else updateGameResultModalGuest(s, '登录已过期，请重新登录同步天梯分');
          showGameNotice(isDraw ? '⚠️ 登录已过期，本局和棋已暂存本地' : '⚠️ 登录已过期，本局战绩暂存本地，请重新登录后同步', true);
        } else if (data && data.code === 429) {
          console.log('对局结算过于频繁，冷却中');
        }
      } catch (err) {
        addLocalResult(isWin, isDraw);
        if (isDraw) {
          const s = getLocalStats();
          updateGameResultModalDrawStats(`本地暂存: ${s.wins} 胜 ${s.losses} 负 ${s.draws} 和 · 云端稍后重试`);
        }
        console.warn("上报天梯战绩失败:", err);
      }
    }

    function escapeRankHTML(str) {
      if (!str) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }



    // 📜 对局战绩历史管理器 (以用户 UID 实行严格独立隔离存储，杜绝跨账号数据混用与刷分)
    function getHistoryStorageKey() {
      return (typeof currentUserUid !== "undefined" && currentUserUid) ? `gomoku_history_${currentUserUid}` : "gomoku_game_history_guest";
    }

    // 🏆 终局战报待确认缓存机制 (确认结果后才真正落库保存，悔棋继续对弈则作废不计入战绩)
    let pendingMatchRecord = null;
    let pendingRecordCommitted = false;

    function queuePendingMatchRecord(recordData) {
      pendingMatchRecord = recordData;
      pendingRecordCommitted = false;
    }

    function commitPendingMatchRecord() {
      if (!pendingMatchRecord) return;
      const rec = pendingMatchRecord;
      pendingMatchRecord = null;
      pendingRecordCommitted = true;

      // 1. 上报天梯积分与战绩
      if (rec.reportLadder && !rec.ladderReported) {
        rec.ladderReported = true;
        reportMatchResult(rec.isPlayerWin, rec.isDraw);
      }

      // 2. 写入对局战报与全走法谱历史记录（本地 + 云端 D1）
      recordGameHistory(rec);
    }

    function discardPendingMatchRecord() {
      pendingMatchRecord = null;
      pendingRecordCommitted = false;
    }

    function recordGameHistory(item) {
      try {
        const key = getHistoryStorageKey();
        let list = JSON.parse(localStorage.getItem(key) || "[]");
        list.unshift(item);
        if (list.length > 30) list = list.slice(0, 30);
        localStorage.setItem(key, JSON.stringify(list));
        updateHistoryCountUI();

        // ☁️ 实时异步备份到 Cloudflare D1 云端数据库（换机/重装永不丢战绩谱，仅限正式账号）
        if (hasRegisteredAccountSession()) {
          safeApiFetch('/api/history/record', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              uid: currentUserUid,
              ...item
            })
          }).catch(() => {});
        }
      } catch(e) {}
    }


    // 🏆 对局终局战报与积分变动弹窗控制器
    function showGameResultModal({ isPvp, isWin, isDraw, winnerName }) {
      const modal = document.getElementById('gameResultModal');
      if (!modal) return;

      const iconEl = document.getElementById('resultModalIcon');
      const titleEl = document.getElementById('resultModalTitle');
      const subEl = document.getElementById('resultModalSub');
      const scoreCard = document.getElementById('resultScoreCard');
      const guestCard = document.getElementById('resultGuestCard');
      const pvpCard = document.getElementById('resultPvpCard');
      const drawCard = document.getElementById('resultDrawCard');

      if (isDraw) {
        if (iconEl) iconEl.textContent = '🤝';
        if (titleEl) titleEl.textContent = '棋逢对手 · 和棋！';
        if (subEl) subEl.textContent = '棋盘已无空位且没有五连，双方本局势均力敌！';
        if (scoreCard) scoreCard.style.display = 'none';
        if (guestCard) guestCard.style.display = 'none';
        if (pvpCard) pvpCard.style.display = 'none';
        if (drawCard) drawCard.style.display = 'block';
        if (isPvp) {
          updateGameResultModalDrawStats('双人同屏娱乐局：和棋不计入天梯积分');
        } else if (hasRegisteredAccountSession()) {
          updateGameResultModalDrawStats('正在同步本局结果，和棋不改变天梯积分...');
        } else {
          const localStats = getLocalStats();
          updateGameResultModalDrawStats(`本地战绩: ${localStats.wins} 胜 ${localStats.losses} 负 ${localStats.draws} 和`);
        }
      } else if (isPvp) {
        if (iconEl) iconEl.textContent = '👑';
        if (titleEl) titleEl.textContent = '五子连珠 · 对局结束！';
        if (subEl) subEl.textContent = `恭喜【${winnerName}】达成五连珠，获得胜利！`;
        if (scoreCard) scoreCard.style.display = 'none';
        if (guestCard) guestCard.style.display = 'none';
        if (pvpCard) pvpCard.style.display = 'block';
        if (drawCard) drawCard.style.display = 'none';
      } else if (isWin) {
        if (iconEl) iconEl.textContent = '👑';
        if (titleEl) titleEl.textContent = '五子连珠 · 绝杀获胜！';
        if (subEl) subEl.textContent = `恭喜【${p1Name}】技高一筹，勇夺对局胜利！`;
        if (pvpCard) pvpCard.style.display = 'none';
        if (drawCard) drawCard.style.display = 'none';

        if (hasRegisteredAccountSession()) {
          if (scoreCard) {
            scoreCard.style.display = 'block';
            scoreCard.style.background = 'linear-gradient(135deg, #f0fdf4, #dcfce7)';
            scoreCard.style.borderColor = '#86efac';
          }
          if (guestCard) guestCard.style.display = 'none';
          if (activeMatchResultScore) {
            updateGameResultModalScore(activeMatchResultScore);
          } else {
            const baseScore = (typeof activeMatchStartingScore === 'number' && activeMatchStartingScore > 0) ? activeMatchStartingScore : currentUserScore;
            const deltaTag = document.getElementById('resultScoreDeltaTag');
            if (deltaTag) {
              deltaTag.textContent = '+25 分';
              deltaTag.style.color = '#15803d';
              deltaTag.style.background = '#bbf7d0';
            }
            const oldScoreEl = document.getElementById('resultOldScore');
            if (oldScoreEl) oldScoreEl.textContent = baseScore;
            const newScoreEl = document.getElementById('resultNewScore');
            if (newScoreEl) newScoreEl.textContent = (baseScore + 25) + ' 分';
            const statsSub = document.getElementById('resultStatsSub');
            if (statsSub) statsSub.textContent = '确认终局后将计入天梯积分 (悔棋继续则作废)';
          }
        } else {
          if (scoreCard) scoreCard.style.display = 'none';
          if (guestCard) guestCard.style.display = 'block';
        }
      } else {
        if (iconEl) iconEl.textContent = '💔';
        if (titleEl) titleEl.textContent = '棋局惜败 · 胜败常事！';
        if (subEl) subEl.textContent = `【${winnerName}】达成五连珠，再战一局必定逆袭！`;
        if (pvpCard) pvpCard.style.display = 'none';
        if (drawCard) drawCard.style.display = 'none';

        if (hasRegisteredAccountSession()) {
          if (scoreCard) {
            scoreCard.style.display = 'block';
            scoreCard.style.background = 'linear-gradient(135deg, #fff7ed, #ffedd5)';
            scoreCard.style.borderColor = '#fdba74';
          }
          if (guestCard) guestCard.style.display = 'none';
          if (activeMatchResultScore) {
            updateGameResultModalScore(activeMatchResultScore);
          } else {
            const baseScore = (typeof activeMatchStartingScore === 'number' && activeMatchStartingScore > 0) ? activeMatchStartingScore : currentUserScore;
            const deltaTag = document.getElementById('resultScoreDeltaTag');
            if (deltaTag) {
              deltaTag.textContent = '-15 分';
              deltaTag.style.color = '#c2410c';
              deltaTag.style.background = '#fed7aa';
            }
            const oldScoreEl = document.getElementById('resultOldScore');
            if (oldScoreEl) oldScoreEl.textContent = baseScore;
            const newScoreEl = document.getElementById('resultNewScore');
            if (newScoreEl) newScoreEl.textContent = Math.max(0, baseScore - 15) + ' 分';
            const statsSub = document.getElementById('resultStatsSub');
            if (statsSub) statsSub.textContent = '确认终局后将计入天梯积分 (悔棋继续则作废)';
          }
        } else {
          if (scoreCard) scoreCard.style.display = 'none';
          if (guestCard) guestCard.style.display = 'block';
        }
      }

      const leaveOnlineBtn = document.getElementById('btnResultLeaveOnline');
      if (leaveOnlineBtn) leaveOnlineBtn.style.display = (gameMode === 'online') ? 'block' : 'none';
      const addFriendBtn = document.getElementById('btnResultAddFriend');
      if (addFriendBtn) addFriendBtn.style.display = (gameMode === 'online' && hasRegisteredAccountSession() && activeOnlineOpponentUid) ? 'block' : 'none';

      const resultUndoBtn = document.getElementById('btnResultUndo');
      if (resultUndoBtn) {
        if (history.length === 0 && undoStack.length === 0) {
          resultUndoBtn.style.display = 'none';
        } else {
          resultUndoBtn.style.display = 'block';
          resultUndoBtn.textContent = (gameMode === 'online') ? '↩️ 申请悔棋继续' : '↩️ 悔棋一步继续';
        }
      }

      modal.style.display = 'flex';
      modal.classList.add('show');
    }

    function scheduleGameResultModal(options) {
      if (resultModalTimer) clearTimeout(resultModalTimer);
      const generation = ++resultModalGeneration;
      resultModalTimer = setTimeout(() => {
        resultModalTimer = null;
        if (generation !== resultModalGeneration || !isOver) return;
        showGameResultModal(options);
      }, 820);
    }

    function cancelPendingGameResultModal() {
      resultModalGeneration++;
      if (resultModalTimer) clearTimeout(resultModalTimer);
      resultModalTimer = null;
    }

    function updateGameResultModalScore({ isWin, oldScore, newScore, delta, data }) {
      const oldScoreEl = document.getElementById('resultOldScore');
      if (oldScoreEl) oldScoreEl.textContent = oldScore;
      const newScoreEl = document.getElementById('resultNewScore');
      if (newScoreEl) newScoreEl.textContent = newScore + ' 分';
      const deltaTag = document.getElementById('resultScoreDeltaTag');
      if (deltaTag) {
        deltaTag.textContent = (delta >= 0 ? `+${delta}` : delta) + ' 分';
        deltaTag.style.color = delta >= 0 ? '#15803d' : '#c2410c';
        deltaTag.style.background = delta >= 0 ? '#bbf7d0' : '#fed7aa';
      }
      const statsSub = document.getElementById('resultStatsSub');
      if (statsSub && data) {
        const total = data.total_games || 1;
        const wins = data.wins || 0;
        const rate = Math.round((wins / total) * 100);
        statsSub.textContent = `云端天梯战绩: ${wins}胜/${total}局 (胜率${rate}%) · 已实时入榜`;
      }
    }

    function updateGameResultModalGuest(stats, customTip) {
      const guestCard = document.getElementById('resultGuestCard');
      const statsText = document.getElementById('resultGuestStatsText');
      if (guestCard) guestCard.style.display = 'block';
      if (statsText && stats) {
        statsText.textContent = customTip || `当前本地战绩: ${stats.wins || 0} 胜 ${stats.losses || 0} 负`;
      }
    }

    function updateGameResultModalDrawStats(text) {
      const statsEl = document.getElementById('resultDrawStatsSub');
      if (statsEl && text) statsEl.textContent = text;
    }

    function closeGameResultModal() {
      // 仅关闭结果弹窗，不强制提前落库；让玩家可以在棋盘上自由复盘
      // 若玩家在复盘中选择悔棋，则丢弃待定战报；若玩家选择重开/打开历史/离开，则真正提交落库
      const modal = document.getElementById('gameResultModal');
      if (modal) {
        modal.style.display = 'none';
        modal.classList.remove('show');
      }
      // 关闭后清理条件卡片，避免下一局打开结算层时短暂残留上一局内容。
      activeMatchResultScore = null;
      ['resultScoreCard', 'resultGuestCard', 'resultPvpCard', 'resultDrawCard'].forEach(id => {
        const card = document.getElementById(id);
        if (card) card.style.display = 'none';
      });
    }

    function undoFromResultModal() {
      discardPendingMatchRecord();
      closeGameResultModal();
      const btnUndo = document.getElementById('btnUndo');
      if (btnUndo) btnUndo.click();
      showGameNotice("↩️ 已撤回终局落子继续对弈，本局结果作废不计入战绩！", false);
    }

    function restartGameFromResultModal() {
      commitPendingMatchRecord();
      closeGameResultModal();
      // 联机终局必须经过双方确认，不能让结果弹窗单方面清空本地棋盘。
      if (gameMode === 'online') {
        const restartButton = document.getElementById('btnRestart');
        if (restartButton) restartButton.click();
        return;
      }
      if (typeof resetBoardOnly === 'function') {
        resetBoardOnly();
      } else {
        location.reload();
      }
    }

    function openLeaderboardFromResultModal() {
      commitPendingMatchRecord();
      closeGameResultModal();
      openLeaderboardModal();
    }

    function updateHistoryCountUI() {
      try {
        const key = getHistoryStorageKey();
        const list = JSON.parse(localStorage.getItem(key) || "[]");
        const countEl = document.getElementById("historyStatCount");
        if (countEl) countEl.textContent = `${list.length} 局战绩`;
      } catch(e) {}
    }


// ═════════════════════════════════════════════════════════════════════════
    // 🎯 主棋盘专业复盘引擎 (点击查看棋局直接跳转主棋盘，大屏带手数动态推演)
    // ═════════════════════════════════════════════════════════════════════════
    let isReplayMode = false;
    let replaySavedState = null;
    let replayAllMoves = [];
    let replayStepIndex = 0;
    let replayAutoTimer = null;

    function ensureReplayFeature() {
      return window.ensureGomokuFeature('replay');
    }
    function openReplayModalByIndex(index) {
      const proxy = openReplayModalByIndex;
      return ensureReplayFeature().then(() => {
        if (window.openReplayModalByIndex === proxy) throw new Error('复盘模块加载后未注册');
        return window.openReplayModalByIndex(index);
      }).catch(error => showGameNotice(error.message || '复盘模块加载失败', true));
    }
    function openHistoryModal() {
      const proxy = openHistoryModal;
      return ensureReplayFeature().then(() => {
        if (window.openHistoryModal === proxy) throw new Error('战绩模块加载后未注册');
        return window.openHistoryModal();
      }).catch(error => showGameNotice(error.message || '战绩模块加载失败', true));
    }
    function syncCloudHistory() {
      const proxy = syncCloudHistory;
      return ensureReplayFeature().then(() => {
        if (window.syncCloudHistory === proxy) return false;
        return window.syncCloudHistory();
      }).catch(() => false);
    }

    function triggerGameDraw(customDrawReason = '') {
      if (isOver) return;
      isOver = true;
      gameWinnerColor = 0;
      gameResultIsDraw = true;
      winningLine = null;
      activeSkill = null;
      const skillPromptBar = document.getElementById('skillPromptBar');
      if (skillPromptBar) skillPromptBar.style.display = 'none';
      try { localStorage.removeItem('gomoku_active_online_room'); } catch(_) {}

      const drawReason = customDrawReason || '棋盘已无空位且没有五连，双方本局和棋！';
      showSkillBanner('🤝', '【棋逢对手】和棋！', drawReason, true);
      playPopSound();
      scheduleGameResultModal({ isPvp: gameMode === 'pvp', isWin: false, isDraw: true, winnerName: '' });

      const movesSnapshot = (history || []).map(step => {
        if (step.action || step.type || step.r === -1) return { ...step };
        return { r: step.r, c: step.c, p: step.p };
      });
      const boardSnapshot = (board || []).map(row => [...row]);

      // 存入待确认队列（等玩家点击确认、再战或关闭复盘时才真正落库；若悔棋则作废不计入对局）
      queuePendingMatchRecord({
        mode: gameMode,
        isWin: false,
        isDraw: true,
        winnerColor: 0,
        myColor: (gameMode === 'online' ? myOnlineColor : BLACK),
        oppName: (gameMode === 'ai' ? '大师AI' : (p2Name || '棋友')),
        oppAvatar: (gameMode === 'ai' ? '🤖' : (p2Avatar || '👧')),
        moves: history ? history.filter(h => h && h.r >= 0 && !h.action).length : 0,
        movesData: movesSnapshot,
        boardData: boardSnapshot,
        time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
        date: new Date().toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' }),
        reportLadder: (gameMode === 'online' || gameMode === 'ai'),
        isPlayerWin: false
      });

      // 和胜负结算一样，把终局状态落入会话存储，避免进程被系统回收后回到最后一步前的旧棋盘。
      draw();
      updateUI();
      persistGameState();
    }

    // 🏆 胜负终局统一结算与音效调度器 (严格区分胜利方与失败方的专属音效)
    function triggerGameEnd(winnerColor, customWinReason = '') {
      if (isOver) return;
      isOver = true;
      gameWinnerColor = winnerColor === BLACK || winnerColor === WHITE ? winnerColor : 0;
      gameResultIsDraw = false;
      activeSkill = null;
      const skillPromptBar = document.getElementById('skillPromptBar');
      if (skillPromptBar) skillPromptBar.style.display = 'none';
      try { localStorage.removeItem('gomoku_active_online_room'); } catch(_) {}

      let isPlayerWin = false;
      if (gameMode === 'online') {
        isPlayerWin = (winnerColor === myOnlineColor);
      } else if (gameMode === 'ai') {
        isPlayerWin = (winnerColor === BLACK);
      } else {
        // 双人同屏 pvp
        isPlayerWin = (winnerColor === BLACK);
      }

      const colorTag = (winnerColor === BLACK ? '黑子' : '白子');
      const winnerName = `${getPlayerNameByColor(winnerColor)} (${colorTag})`;

      if (gameMode === 'pvp') {
        // 先保留终局棋形与五连日线，再从底部给出结算。
        playSkillSound('victory');
        scheduleGameResultModal({ isPvp: true, winnerName });
      } else if (isPlayerWin) {
        // 胜利反馈集中在棋盘本身，避免彩纸和提示横幅争抢注意力。
        playSkillSound('victory');
        scheduleGameResultModal({ isWin: true, winnerName });
      } else {
        // 失败也保留棋形，不震屏、不用第二层横幅覆盖关键落点。
        playSkillSound('defeat');
        scheduleGameResultModal({ isWin: false, winnerName });
      }

      const movesSnapshot = (history || []).map(step => {
        if (step.action || step.type || step.r === -1) return { ...step };
        return { r: step.r, c: step.c, p: step.p };
      });
      const boardSnapshot = (board || []).map(row => [...row]);

      // 存入待确认队列（等玩家点击确认、再战或关闭复盘时才真正落库；若悔棋则作废不计入对局）
      queuePendingMatchRecord({
        mode: gameMode,
        isWin: (gameMode === 'pvp' ? true : isPlayerWin),
        isDraw: false,
        winnerColor: winnerColor,
        myColor: (gameMode === "online" ? myOnlineColor : BLACK),
        oppName: (gameMode === "ai" ? "大师AI" : (p2Name || "棋友")),
        oppAvatar: (gameMode === "ai" ? "🤖" : (p2Avatar || "👧")),
        moves: history ? history.filter(h => h && h.r >= 0 && !h.action).length : 0,
        movesData: movesSnapshot,
        boardData: boardSnapshot,
        time: new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }),
        date: new Date().toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" }),
        reportLadder: (gameMode === 'online' || gameMode === 'ai'),
        isPlayerWin: isPlayerWin
      });

      draw();
      updateUI();
      persistGameState();
    }

    // 🎴 炫酷干扰技能提示卡与震屏控制器 (等用户确认之后才消失！)
    let bannerTimer = null;
    function showSkillBanner(icon, title, sub, autoClose = false) {
      const banner = document.getElementById('skillBanner');
      const iconEl = document.getElementById('skillBannerIcon');
      const titleEl = document.getElementById('skillBannerTitle');
      const subEl = document.getElementById('skillBannerSub');
      const confirmBtn = document.getElementById('btnBannerConfirm');
      if (!banner) return;
      if (iconEl) iconEl.textContent = icon;
      if (titleEl) titleEl.textContent = title;
      if (subEl) subEl.textContent = sub;

      if (bannerTimer) {
        clearTimeout(bannerTimer);
        bannerTimer = null;
      }

      if (autoClose) {
        if (confirmBtn) confirmBtn.style.display = 'none';
        banner.classList.add('show');
        bannerTimer = setTimeout(() => {
          banner.classList.remove('show');
        }, 800);
      } else {
        // 🔥 等用户确认之后才消失！绝不自动关闭
        if (confirmBtn) confirmBtn.style.display = 'inline-block';
        banner.classList.add('show');
      }
    }

    function closeSkillBanner() {
      const banner = document.getElementById('skillBanner');
      if (banner) {
        banner.classList.remove('show');
      }
      if (bannerTimer) {
        clearTimeout(bannerTimer);
        bannerTimer = null;
      }
      playPopSound();
    }

    function triggerBoardShake(isMega = false) {
      const wrapper = document.getElementById('islandWrapper');
      if (!wrapper) return;
      wrapper.classList.remove('board-shake', 'board-shake-mega');
      void wrapper.offsetWidth;
      if (isMega) {
        wrapper.classList.add('board-shake-mega');
        setTimeout(() => wrapper.classList.remove('board-shake-mega'), 700);
      } else {
        wrapper.classList.add('board-shake');
        setTimeout(() => wrapper.classList.remove('board-shake'), 400);
      }
    }

    // 🎨 Canvas 实时高帧率粒子/特效渲染管线
    let activeVFX = [];
    let vfxRAF = null;

    function triggerStoneDropVFX(r, c, p) {
      const startTime = performance.now();
      const tx = paddingX + (c + 0.5) * gridX;
      const ty = paddingY + (r + 0.5) * gridY;
      const particles = [];
      for (let i = 0; i < 7; i++) {
        const angle = Math.random() * Math.PI * 2;
        const dist = 3 + Math.random() * 8;
        particles.push({
          x: tx + Math.cos(angle) * dist,
          y: ty + Math.sin(angle) * dist,
          vx: Math.cos(angle) * (0.4 + Math.random() * 0.8),
          vy: Math.sin(angle) * (0.4 + Math.random() * 0.8),
          size: 2.2 + Math.random() * 2.8,
          color: p === BLACK ? '#60a5fa' : '#fef08a',
          life: 380, birth: startTime
        });
      }
      activeVFX.push({
        type: 'stone_drop', tx, ty, p, particles, startTime, duration: 420
      });
      ensureVfxLoop();
    }

    function triggerVictoryVFX() {
      const startTime = performance.now();
      const particles = [];
      const colors = ['#f59e0b', '#ef4444', '#10b981', '#3b82f6', '#ec4899', '#8b5cf6', '#facc15'];
      for (let i = 0; i < 75; i++) {
        particles.push({
          x: paddingX + Math.random() * (cWidth - 2 * paddingX),
          y: paddingY - 10 - Math.random() * 60,
          vx: (Math.random() - 0.5) * 3,
          vy: 1.8 + Math.random() * 3.6,
          rot: Math.random() * Math.PI * 2,
          rotSpeed: (Math.random() - 0.5) * 0.12,
          sizeW: 6 + Math.random() * 7,
          sizeH: 4 + Math.random() * 5,
          color: colors[Math.floor(Math.random() * colors.length)],
          life: 1400 + Math.random() * 600,
          birth: startTime
        });
      }
      activeVFX.push({
        type: 'victory_confetti', particles, startTime, duration: 2000
      });
      ensureVfxLoop();
    }

    function triggerUndoVFX(r, c) {
      const startTime = performance.now();
      const tx = paddingX + (c + 0.5) * gridX;
      const ty = paddingY + (r + 0.5) * gridY;
      const particles = [];
      for (let i = 0; i < 14; i++) {
        const angle = (i / 14) * Math.PI * 2;
        particles.push({
          x: tx, y: ty,
          dist: radius * 1.8,
          angle: angle,
          rotSpeed: -0.09,
          size: 2.8,
          color: '#a855f7',
          life: 450, birth: startTime
        });
      }
      activeVFX.push({
        type: 'undo_vortex', tx, ty, particles, startTime, duration: 480
      });
      ensureVfxLoop();
    }

    function triggerRestartVFX() {
      const startTime = performance.now();
      const tx = cWidth / 2, ty = cHeight / 2;
      const particles = [];
      for (let i = 0; i < 28; i++) {
        const angle = (i / 28) * Math.PI * 2;
        const speed = 2.5 + Math.random() * 3.5;
        particles.push({
          x: tx, y: ty,
          vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
          size: 3 + Math.random() * 3.5,
          color: ['#facc15', '#60a5fa', '#34d399', '#f472b6'][Math.floor(Math.random() * 4)],
          life: 620, birth: startTime
        });
      }
      activeVFX.push({
        type: 'restart_wave', tx, ty, particles, startTime, duration: 680
      });
      ensureVfxLoop();
    }

    function triggerSkillVFX(type, targetR, targetC, srcR, srcC) {
      const startTime = performance.now();
      const tx = (targetR !== undefined) ? paddingX + (targetC + 0.5) * gridX : cWidth / 2;
      const ty = (targetR !== undefined) ? paddingY + (targetR + 0.5) * gridY : cHeight / 2;
      const sx = (srcR !== undefined) ? paddingX + (srcC + 0.5) * gridX : tx;
      const sy = (srcR !== undefined) ? paddingY + (srcR + 0.5) * gridY : ty;

      const particles = [];
      if (type === 'mega_bomb') {
        const cx = cWidth / 2, cy = cHeight / 2;
        for (let i = 0; i < 65; i++) {
          const angle = Math.random() * Math.PI * 2;
          const speed = 3.5 + Math.random() * 8.5;
          particles.push({
            x: cx, y: cy,
            vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
            size: 4 + Math.random() * 7,
            color: ['#ff4500', '#ff8c00', '#ffd700', '#ffffff', '#dc2626'][Math.floor(Math.random() * 5)],
            life: 850 + Math.random() * 200, birth: startTime
          });
        }
      } else if (type === 'remove_stone') {
        for (let i = 0; i < 26; i++) {
          const angle = Math.random() * Math.PI * 2;
          const speed = 2 + Math.random() * 5.5;
          particles.push({
            x: tx, y: ty,
            vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
            size: 3.5 + Math.random() * 5,
            color: ['#f97316', '#ef4444', '#facc15', '#ffffff'][Math.floor(Math.random() * 4)],
            life: 550, birth: startTime
          });
        }
      } else if (type === 'freeze') {
        for (let i = 0; i < 22; i++) {
          const angle = (i / 22) * Math.PI * 2;
          particles.push({
            x: tx, y: ty,
            vx: Math.cos(angle) * (1.8 + Math.random() * 2.5),
            vy: Math.sin(angle) * (1.8 + Math.random() * 2.5),
            size: 3 + Math.random() * 4,
            color: ['#38bdf8', '#bae6fd', '#ffffff', '#7dd3fc'][Math.floor(Math.random() * 4)],
            life: 600, birth: startTime
          });
        }
      } else if (type === 'double_move') {
        for (let i = 0; i < 32; i++) {
          particles.push({
            x: paddingX + Math.random() * (cWidth - 2 * paddingX),
            y: paddingY + Math.random() * (cHeight - 2 * paddingY),
            vx: (Math.random() - 0.5) * 4, vy: (Math.random() - 0.5) * 4,
            size: 3.5 + Math.random() * 4.5,
            color: '#facc15', life: 480, birth: startTime
          });
        }
      } else if (type === 'swap_color') {
        for (let i = 0; i < 24; i++) {
          const angle = (i / 24) * Math.PI * 2;
          particles.push({
            x: tx, y: ty, angle: angle,
            dist: 6 + Math.random() * 22,
            rotSpeed: (Math.random() > 0.5 ? 1 : -1) * (0.06 + Math.random() * 0.05),
            size: 3 + Math.random() * 3.5,
            color: i % 2 === 0 ? '#a855f7' : '#38bdf8',
            life: 700, birth: startTime
          });
        }
      } else if (type === 'swap_positions') {
        for (let i = 0; i < 28; i++) {
          const t = Math.random();
          particles.push({
            x: sx + (tx - sx) * t, y: sy + (ty - sy) * t,
            vx: (Math.random() - 0.5) * 2.5, vy: (Math.random() - 0.5) * 2.5,
            size: 3.5 + Math.random() * 4,
            color: ['#ec4899', '#8b5cf6', '#60a5fa'][Math.floor(Math.random() * 3)],
            life: 650, birth: startTime
          });
        }
      } else if (type === 'invalid_click') {
        for (let i = 0; i < 12; i++) {
          const angle = (i / 12) * Math.PI * 2;
          const speed = 1.2 + Math.random() * 2.2;
          particles.push({
            x: tx, y: ty,
            vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
            size: 3 + Math.random() * 2.5,
            color: ['#f43f5e', '#fb7185', '#fda4af'][Math.floor(Math.random() * 3)],
            life: 380, birth: startTime
          });
        }
      } else {
        for (let i = 0; i < 22; i++) {
          const angle = Math.random() * Math.PI * 2;
          const speed = 1.8 + Math.random() * 4.2;
          particles.push({
            x: tx, y: ty,
            vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
            size: 3 + Math.random() * 4,
            color: ['#facc15', '#ec4899', '#38bdf8', '#a855f7'][Math.floor(Math.random() * 4)],
            life: 580, birth: startTime
          });
        }
      }

      activeVFX.push({
        type, tx, ty, sx, sy,
        particles, startTime, duration: type === 'mega_bomb' ? 1000 : (type === 'invalid_click' ? 400 : 750)
      });

      ensureVfxLoop();
    }

    function ensureVfxLoop() {
      if (vfxRAF !== null || activeVFX.length === 0 || document.visibilityState === 'hidden') return;
      // 技能处理可能刚请求过普通棋盘帧；让 VFX 帧承载最新棋盘状态，避免
      // 同一刷新周期先画静态棋盘、再画一次带特效棋盘。
      cancelScheduledBoardDraw();
      vfxRAF = requestCanvasFrame(vfxAnimLoop);
    }

    function vfxAnimLoop(timestamp) {
      // 浏览器切到后台后 rAF 可能还有一个已入队回调；不在隐藏页面继续清屏、
      // 计算粒子或申请下一帧。visibilitychange/内存回收路径会负责清理特效。
      if (document.visibilityState === 'hidden') {
        vfxRAF = null;
        activeVFX = [];
        vfxLastRenderAt = 0;
        return;
      }

      const now = Number.isFinite(timestamp) ? timestamp : performance.now();
      activeVFX = activeVFX.filter(vfx => now - vfx.startTime < vfx.duration);
      const frameBudget = getCanvasFrameBudgetMs();
      const shouldRender = vfxLastRenderAt === 0 || now - vfxLastRenderAt >= frameBudget;
      if (shouldRender) {
        vfxLastRenderAt = now;
        canvasFrameStats.vfxRendered++;
        canvasFrameStats.lastVfxRenderAt = now;
        // VFX 帧同时承载棋盘状态贴图，直接复用 drawNow，避免 vfx rAF 与
        // 普通 draw() 的待执行帧重复绘制。
        drawNow();
      }

      if (activeVFX.length > 0) {
        vfxRAF = requestCanvasFrame(vfxAnimLoop);
      } else {
        vfxRAF = null;
        vfxLastRenderAt = 0;
        // 若上一帧刚好跨过结束时间，补一帧清掉已结束特效。
        if (!shouldRender) drawNow();
      }
    }

    function renderActiveVFX(ctx) {
      if (activeVFX.length === 0) return;
      const now = performance.now();
      ctx.save();
      for (const vfx of activeVFX) {
        const elapsed = now - vfx.startTime;
        const progress = Math.min(1, elapsed / vfx.duration);

        if (vfx.type === 'mega_bomb') {
          const cx = cWidth / 2, cy = cHeight / 2;
          const ringR = Math.min(cWidth, cHeight) * 0.7 * progress;
          ctx.beginPath(); ctx.arc(cx, cy, ringR, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(255, 87, 34, ${1 - progress})`;
          ctx.lineWidth = 14 * (1 - progress);
          ctx.stroke();

          if (progress < 0.35) {
            const flashAlpha = (1 - progress / 0.35) * 0.75;
            ctx.fillStyle = `rgba(255, 255, 255, ${flashAlpha})`;
            ctx.fillRect(0, 0, cWidth, cHeight);
          }
        }

        if (vfx.type === 'stone_drop') {
          const rippleR = radius * (0.8 + progress * 1.1);
          ctx.beginPath(); ctx.arc(vfx.tx, vfx.ty, rippleR, 0, Math.PI * 2);
          ctx.strokeStyle = vfx.p === BLACK ? `rgba(96, 165, 250, ${1 - progress})` : `rgba(244, 114, 182, ${1 - progress})`;
          ctx.lineWidth = 2.5 * (1 - progress);
          ctx.stroke();
        }

        if (vfx.type === 'restart_wave') {
          const waveR = Math.min(cWidth, cHeight) * 0.75 * progress;
          ctx.beginPath(); ctx.arc(vfx.tx, vfx.ty, waveR, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(250, 204, 21, ${1 - progress})`;
          ctx.lineWidth = 4 * (1 - progress);
          ctx.stroke();
        }

        if (vfx.type === 'undo_vortex') {
          const vortexR = radius * (1.8 * (1 - progress));
          ctx.beginPath(); ctx.arc(vfx.tx, vfx.ty, Math.max(1, vortexR), 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(168, 85, 247, ${1 - progress})`;
          ctx.lineWidth = 3; ctx.setLineDash([4, 3]);
          ctx.stroke();
        }

        if (vfx.type === 'invalid_click') {
          const r = radius * (0.6 + progress * 0.9);
          ctx.beginPath(); ctx.arc(vfx.tx, vfx.ty, r, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(244, 63, 94, ${1 - progress})`;
          ctx.lineWidth = 3.5 * (1 - progress);
          ctx.stroke();
        }

        if (vfx.type === 'victory_confetti') {
          for (const p of vfx.particles) {
            const pAge = now - p.birth;
            if (pAge < p.life) {
              const pProgress = pAge / p.life;
              p.y += p.vy * (16 / 16);
              p.x += Math.sin(pAge / 80) * 1.2;
              p.rot += p.rotSpeed;
              ctx.save();
              ctx.translate(p.x, p.y);
              ctx.rotate(p.rot);
              ctx.fillStyle = p.color;
              ctx.globalAlpha = Math.max(0, 1 - pProgress);
              ctx.fillRect(-p.sizeW / 2, -p.sizeH / 2, p.sizeW, p.sizeH);
              ctx.restore();
            }
          }
          continue;
        }

        if (vfx.type === 'remove_stone' || vfx.type === 'freeze' || vfx.type === 'double_move') {
          const ringRadius = radius * (1 + progress * 3.6);
          ctx.beginPath();
          ctx.arc(vfx.tx, vfx.ty, ringRadius, 0, Math.PI * 2);
          ctx.strokeStyle = vfx.type === 'freeze' ? `rgba(56, 189, 248, ${1 - progress})` : (vfx.type === 'double_move' ? `rgba(250, 204, 21, ${1 - progress})` : `rgba(239, 68, 68, ${1 - progress})`);
          ctx.lineWidth = 4 * (1 - progress);
          ctx.stroke();
        }

        if (vfx.type === 'swap_positions') {
          ctx.beginPath();
          ctx.moveTo(vfx.sx, vfx.sy);
          ctx.lineTo(vfx.tx, vfx.ty);
          ctx.strokeStyle = `rgba(168, 85, 247, ${1 - progress * 0.7})`;
          ctx.lineWidth = 5 * (1 - progress * 0.4);
          ctx.shadowColor = '#d946ef';
          ctx.shadowBlur = 15;
          ctx.stroke();
        }

        if (Array.isArray(vfx.particles)) {
          for (const p of vfx.particles) {
            const pAge = now - p.birth;
            if (pAge < p.life) {
              const pProgress = pAge / p.life;
              const alpha = 1 - pProgress;
              ctx.fillStyle = p.color;
              ctx.globalAlpha = Math.max(0, alpha);
              ctx.beginPath();
              let px = p.x, py = p.y;
              if (p.angle !== undefined) {
                p.angle += p.rotSpeed;
                px = vfx.tx + Math.cos(p.angle) * (p.dist + progress * 16);
                py = vfx.ty + Math.sin(p.angle) * (p.dist + progress * 16);
              } else {
                px = p.x + p.vx * (pAge / 16);
                py = p.y + p.vy * (pAge / 16);
              }
              ctx.arc(px, py, Math.max(1, p.size * (1 - pProgress * 0.6)), 0, Math.PI * 2);
              ctx.fill();
            }
          }
        }
      }
      ctx.restore();
    }

    // 🗺️ 棋盘标准坐标转换 (横轴 A-O, 纵轴 15-1，与标准围棋/五子棋记谱法完全一致)
    const COL_LABELS = ['A','B','C','D','E','F','G','H','I','J','K','L','M','N','O'];
    function getCoordName(r, c) {
      if (r < 0 || r >= 15 || c < 0 || c >= 15) return '';
      return `${COL_LABELS[c]}${15 - r}`;
    }

    function updateUI() {
      const bubble = document.getElementById('turnBubble');
      const p1Status = document.getElementById('p1Status');
      const p2Status = document.getElementById('p2Status');

      // 终局时不再沿用上一回合的“对手回合/落子中”提示，避免看起来像棋局又回到了旧状态。
      if (isOver) {
        const resultText = gameResultIsDraw ? '本局和棋' : '对局结束';
        if (p1Status) p1Status.textContent = gameResultIsDraw ? '和棋' : '已结束';
        if (p2Status) p2Status.textContent = gameResultIsDraw ? '和棋' : '已结束';
        if (bubble) {
          bubble.textContent = resultText;
          bubble.className = 'turn-bubble finished';
        }
        const c1 = document.getElementById('p1Card');
        const c2 = document.getElementById('p2Card');
        if (c1) c1.style.opacity = '0.9';
        if (c2) c2.style.opacity = '0.9';
        return;
      }

      // 判断当前是否属于左侧 p1 (本地玩家/黑方) 的回合
      const isP1Turn = (gameMode === 'online')
        ? (turn === myOnlineColor)
        : (turn === BLACK);

      if (isP1Turn) {
        if (p1Status) p1Status.textContent = '落子中';
        if (p2Status) p2Status.textContent = '等待';
        if (bubble) {
          bubble.textContent = (gameMode === 'pvp') ? '黑方回合' : '你的回合';
          bubble.className = 'turn-bubble';
        }
        const c1 = document.getElementById('p1Card');
        const c2 = document.getElementById('p2Card');
        if (c1) c1.style.opacity = '1';
        if (c2) c2.style.opacity = '0.75';
      } else {
        if (p1Status) p1Status.textContent = '等待';
        if (p2Status) p2Status.textContent = (gameMode === 'ai') ? '思考中' : '落子中';
        if (bubble) {
          bubble.textContent = (gameMode === 'pvp') ? '白方回合' : ((gameMode === 'ai') ? '思考中' : '对手回合');
          bubble.className = 'turn-bubble right';
        }
        const c1 = document.getElementById('p1Card');
        const c2 = document.getElementById('p2Card');
        if (c1) c1.style.opacity = '0.75';
        if (c2) c2.style.opacity = '1';
      }
    }

    // 产品只保留官方晴空浮岛草坪视觉。旧版本留下的 URL / 本地主题状态全部忽略并清理。
    let activeThemeKey = 'default';
    try {
      localStorage.removeItem('gomoku_active_theme');
      sessionStorage.removeItem('gomoku_active_theme');
    } catch(e){}

    function switchThemeSeamless() {
      activeThemeKey = 'default';
      closeThemeModal();
      invalidateBoardCache();
      draw(true);
      showGameNotice('当前使用官方晴空浮岛草坪视觉', false);
      updateUI();
    }

    // --- 1. 经典手绘晴空草坪棋盘 ---
    function drawHandmadeGrassBoard() {
      const bx = paddingX - 2, by = paddingY - 2;
      const bw = cWidth - 2 * bx, bh = cHeight - 2 * by;

      ctx.fillStyle = '#9aaab7'; ctx.strokeStyle = '#576574'; ctx.lineWidth = Math.max(1.2, cWidth * 0.004);
      const stoneCount = 7; const sW = (cWidth - 16) / stoneCount; const stoneH = Math.max(8, cHeight * 0.03);
      for (let i = 0; i < stoneCount; i++) {
        const sx = 8 + i * sW;
        ctx.beginPath(); ctx.roundRect(sx + 1, cHeight - stoneH - 3, sW - 2, stoneH, 4); ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.roundRect(sx + 1, 3, sW - 2, stoneH * 0.9, 4); ctx.fill(); ctx.stroke();
      }

      ctx.fillStyle = '#78c82e'; ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, 8); ctx.fill();

      for (let r = 0; r < 15; r++) {
        for (let c = 0; c < 15; c++) {
          const gx = paddingX + c * gridX, gy = paddingY + r * gridY;
          const isLight = (r + c) % 2 === 0;

          ctx.fillStyle = isLight ? '#8cd63e' : '#77c42b';
          ctx.fillRect(gx, gy, gridX, gridY);

          ctx.fillStyle = isLight ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.06)';
          ctx.fillRect(gx, gy, gridX, 1);
          ctx.fillRect(gx, gy, 1, gridY);

          ctx.strokeStyle = 'rgba(76, 139, 22, 0.25)';
          ctx.lineWidth = 0.5;
          ctx.strokeRect(gx, gy, gridX, gridY);
        }
      }
      drawGrassFringe(bx, by, bw, bh);
    }

    function drawGrassFringe(bx, by, bw, bh) {
      ctx.save();
      const countX = Math.round(cWidth / 10), countY = Math.round(cHeight / 10);
      drawEdgeTufts(bx, by, bx + bw, by, 0, -1, countX);
      drawEdgeTufts(bx, by + bh, bx + bw, by + bh, 0, 1, countX);
      drawEdgeTufts(bx, by, bx, by + bh, -1, 0, countY);
      drawEdgeTufts(bx + bw, by, bx + bw, by + bh, 1, 0, countY);
      ctx.restore();
    }

    function drawEdgeTufts(x1, y1, x2, y2, nx, ny, count) {
      const dx = (x2 - x1) / count, dy = (y2 - y1) / count, scale = cWidth / 380;
      ctx.fillStyle = '#4c8b16'; ctx.beginPath();
      for (let i = 0; i <= count; i++) {
        const cx = x1 + i * dx, cy = y1 + i * dy;
        const len = (7 + Math.sin(i * 1.8) * 3 + Math.cos(i * 3.4) * 2) * scale;
        ctx.lineTo(cx - dx * 0.5, cy - dy * 0.5);
        ctx.lineTo(cx + nx * len + (Math.sin(i * 2.5) * 2 * scale), cy + ny * len + (Math.cos(i * 2.5) * 2 * scale));
        ctx.lineTo(cx + dx * 0.5, cy + dy * 0.5);
      }
      ctx.fill();

      ctx.fillStyle = '#8cd63e'; ctx.beginPath();
      for (let i = 0; i <= count; i++) {
        const cx = x1 + (i + 0.3) * dx, cy = y1 + (i + 0.3) * dy;
        const len = (6 + Math.cos(i * 2.1) * 2.5) * scale;
        ctx.lineTo(cx - dx * 0.4, cy - dy * 0.4);
        ctx.lineTo(cx + nx * len, cy + ny * len);
        ctx.lineTo(cx + dx * 0.4, cy + dy * 0.4);
      }
      ctx.fill();
    }



    // --- 2. 草莓蜜桃恋爱版棋盘 (奶茶圆盘 + 💖爱心星位) ---
    function drawSweetRomanceBoard() {
      const bx = paddingX - 4, by = paddingY - 4;
      const bw = cWidth - 2 * bx, bh = cHeight - 2 * by;

      // 阴影与奶茶烤漆木盘
      ctx.save();
      ctx.shadowColor = 'rgba(255,117,140,0.3)'; ctx.shadowBlur = 18; ctx.shadowOffsetY = 8;
      const bg = ctx.createLinearGradient(bx, by, bx + bw, by + bh);
      bg.addColorStop(0, '#ebd5c8'); bg.addColorStop(0.5, '#debfae'); bg.addColorStop(1, '#cb9f88');
      ctx.fillStyle = bg;
      ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, 22); ctx.fill();
      ctx.restore();

      ctx.strokeStyle = 'rgba(255,255,255,0.45)'; ctx.lineWidth = 2;
      ctx.stroke();

      // 柔和玫瑰金网格线
      ctx.lineWidth = 1;
      for (let i = 0; i < 15; i++) {
        const x = paddingX + (i + 0.5) * gridX;
        const y = paddingY + (i + 0.5) * gridY;
        ctx.strokeStyle = 'rgba(120, 75, 70, 0.28)';
        ctx.beginPath(); ctx.moveTo(x, paddingY + 0.5 * gridY); ctx.lineTo(x, paddingY + 14.5 * gridY); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(paddingX + 0.5 * gridX, y); ctx.lineTo(paddingX + 14.5 * gridX, y); ctx.stroke();
      }

      // 💖 爱心星位
      const stars = [[3,3], [11,3], [7,7], [3,11], [11,11]];
      ctx.font = `${Math.round(gridX * 0.38)}px sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (const [r, c] of stars) {
        ctx.fillText('💖', paddingX + (c + 0.5) * gridX, paddingY + (r + 0.5) * gridY);
      }
    }

    // --- 3. 极简禅意暗黑版棋盘 ---
    function drawZenDarkBoard() {
      const bx = paddingX - 4, by = paddingY - 4;
      const bw = cWidth - 2 * bx, bh = cHeight - 2 * by;

      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.85)'; ctx.shadowBlur = 20; ctx.shadowOffsetY = 10;
      const bg = ctx.createLinearGradient(bx, by, bx + bw, by + bh);
      bg.addColorStop(0, '#1c1c21'); bg.addColorStop(1, '#111114');
      ctx.fillStyle = bg;
      ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, 14); ctx.fill();
      ctx.restore();

      ctx.strokeStyle = '#2d2d34'; ctx.lineWidth = 1.5; ctx.stroke();

      for (let i = 0; i < 15; i++) {
        const x = paddingX + (i + 0.5) * gridX;
        const y = paddingY + (i + 0.5) * gridY;
        ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 0.8;
        ctx.beginPath(); ctx.moveTo(x, paddingY + 0.5 * gridX); ctx.lineTo(x, paddingY + 14.5 * gridX); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(paddingX + 0.5 * gridX, y); ctx.lineTo(paddingX + 14.5 * gridX, y); ctx.stroke();
      }
      const stars = [[3,3], [11,3], [7,7], [3,11], [11,11]];
      ctx.fillStyle = '#71717a';
      for (const [r, c] of stars) {
        ctx.beginPath(); ctx.arc(paddingX + (c + 0.5) * gridX, paddingY + (r + 0.5) * gridY, 3, 0, Math.PI*2); ctx.fill();
      }
    }

    // --- 4. 新中式宣纸榧木版棋盘 ---
    function drawNeoTradBoard() {
      const bx = paddingX - 4, by = paddingY - 4;
      const bw = cWidth - 2 * bx, bh = cHeight - 2 * by;

      ctx.save();
      ctx.shadowColor = 'rgba(92,64,51,0.3)'; ctx.shadowBlur = 14; ctx.shadowOffsetY = 6;
      const bg = ctx.createLinearGradient(bx, by, bx + bw, by + bh);
      bg.addColorStop(0, '#dfc599'); bg.addColorStop(0.5, '#cfb17d'); bg.addColorStop(1, '#be9d68');
      ctx.fillStyle = bg;
      ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, 12); ctx.fill();
      ctx.restore();

      ctx.strokeStyle = '#8c7047'; ctx.lineWidth = 1.8; ctx.stroke();

      for (let i = 0; i < 15; i++) {
        const x = paddingX + (i + 0.5) * gridX;
        const y = paddingY + (i + 0.5) * gridY;
        ctx.strokeStyle = 'rgba(74, 59, 44, 0.45)'; ctx.lineWidth = 0.9;
        ctx.beginPath(); ctx.moveTo(x, paddingY + 0.5 * gridY); ctx.lineTo(x, paddingY + 14.5 * gridY); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(paddingX + 0.5 * gridX, y); ctx.lineTo(paddingX + 14.5 * gridX, y); ctx.stroke();
      }
      const stars = [[3,3], [11,3], [7,7], [3,11], [11,11]];
      ctx.fillStyle = '#c88942';
      for (const [r, c] of stars) {
        ctx.beginPath(); ctx.arc(paddingX + (c + 0.5) * gridX, paddingY + (r + 0.5) * gridY, 3.5, 0, Math.PI*2); ctx.fill();
      }
    }

    // --- 5. 现代奢华毛玻璃版棋盘 ---
    function drawLuxuryGlassBoard() {
      const bx = paddingX - 4, by = paddingY - 4;
      const bw = cWidth - 2 * bx, bh = cHeight - 2 * by;

      ctx.save();
      ctx.shadowColor = 'rgba(99,102,241,0.35)'; ctx.shadowBlur = 22; ctx.shadowOffsetY = 8;
      const bg = ctx.createLinearGradient(bx, by, bx + bw, by + bh);
      bg.addColorStop(0, '#151624'); bg.addColorStop(1, '#0c0d16');
      ctx.fillStyle = bg;
      ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, 18); ctx.fill();
      ctx.restore();

      ctx.strokeStyle = 'rgba(99, 102, 241, 0.4)'; ctx.lineWidth = 1.5; ctx.stroke();

      for (let i = 0; i < 15; i++) {
        const x = paddingX + (i + 0.5) * gridX;
        const y = paddingY + (i + 0.5) * gridY;
        ctx.strokeStyle = 'rgba(129, 140, 248, 0.22)'; ctx.lineWidth = 0.8;
        ctx.beginPath(); ctx.moveTo(x, paddingY + 0.5 * gridY); ctx.lineTo(x, paddingY + 14.5 * gridY); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(paddingX + 0.5 * gridX, y); ctx.lineTo(paddingX + 14.5 * gridX, y); ctx.stroke();
      }
      const stars = [[3,3], [11,3], [7,7], [3,11], [11,11]];
      ctx.font = `${Math.round(gridX * 0.32)}px sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (const [r, c] of stars) {
        ctx.fillText('✨', paddingX + (c + 0.5) * gridX, paddingY + (r + 0.5) * gridY);
      }
    }

    // --- 6. Clean iOS 极简暖白版棋盘 ---
    function drawCleanIosBoard() {
      const bx = paddingX - 4, by = paddingY - 4;
      const bw = cWidth - 2 * bx, bh = cHeight - 2 * by;

      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.12)'; ctx.shadowBlur = 18; ctx.shadowOffsetY = 6;
      const bg = ctx.createLinearGradient(bx, by, bx + bw, by + bh);
      bg.addColorStop(0, '#f9f6f0'); bg.addColorStop(1, '#ede6db');
      ctx.fillStyle = bg;
      ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, 20); ctx.fill();
      ctx.restore();

      ctx.strokeStyle = 'rgba(0,0,0,0.08)'; ctx.lineWidth = 1.5; ctx.stroke();

      for (let i = 0; i < 15; i++) {
        const x = paddingX + (i + 0.5) * gridX;
        const y = paddingY + (i + 0.5) * gridY;
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.14)'; ctx.lineWidth = 0.8;
        ctx.beginPath(); ctx.moveTo(x, paddingY + 0.5 * gridY); ctx.lineTo(x, paddingY + 14.5 * gridY); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(paddingX + 0.5 * gridX, y); ctx.lineTo(paddingX + 14.5 * gridX, y); ctx.stroke();
      }
      const stars = [[3,3], [11,3], [7,7], [3,11], [11,11]];
      ctx.fillStyle = '#8e8e93';
      for (const [r, c] of stars) {
        ctx.beginPath(); ctx.arc(paddingX + (c + 0.5) * gridX, paddingY + (r + 0.5) * gridY, 2.5, 0, Math.PI*2); ctx.fill();
      }
    }

    // --- 多材质棋子渲染器 (顶级3D球体光照、真实微柔阴影与瓷釉高光) ---
    function drawThemedStone(x, y, r, stoneColor, theme) {
      if (theme === 'sweet_romance') {
        // 🍬 浪漫樱粉：果冻水晶质感 + 柔和心动辉光
        ctx.save();
        ctx.shadowColor = stoneColor === BLACK ? 'rgba(244, 114, 182, 0.42)' : 'rgba(125, 180, 255, 0.38)';
        ctx.shadowBlur = r * 0.38;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = r * 0.18;

        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        const g = ctx.createRadialGradient(x - r * 0.32, y - r * 0.32, r * 0.08, x, y, r);
        if (stoneColor === BLACK) {
          g.addColorStop(0, '#ffa5ba');
          g.addColorStop(0.35, '#ff758c');
          g.addColorStop(0.75, '#e83e68');
          g.addColorStop(1, '#be185d');
        } else {
          g.addColorStop(0, '#ffffff');
          g.addColorStop(0.35, '#e0f2fe');
          g.addColorStop(0.75, '#bae6fd');
          g.addColorStop(1, '#7dd3fc');
        }
        ctx.fillStyle = g;
        ctx.fill();
        ctx.restore();

        // 珍珠果冻高光弧
        ctx.save();
        ctx.beginPath();
        ctx.ellipse(x - r * 0.28, y - r * 0.28, r * 0.42, r * 0.22, -Math.PI / 4, 0, Math.PI * 2);
        const glint = ctx.createLinearGradient(x - r * 0.45, y - r * 0.45, x, y);
        glint.addColorStop(0, 'rgba(255, 255, 255, 0.85)');
        glint.addColorStop(0.5, 'rgba(255, 255, 255, 0.25)');
        glint.addColorStop(1, 'rgba(255, 255, 255, 0)');
        ctx.fillStyle = glint;
        ctx.fill();
        ctx.restore();

        // 极细通透光润边缘
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.strokeStyle = stoneColor === BLACK ? 'rgba(255, 255, 255, 0.45)' : 'rgba(255, 255, 255, 0.8)';
        ctx.lineWidth = 0.9;
        ctx.stroke();

      } else if (theme === 'zen_dark') {
        // 🖤 幽冥暗境：黑曜石晶石与羊脂暖玉
        ctx.save();
        ctx.shadowColor = stoneColor === BLACK ? 'rgba(0, 0, 0, 0.85)' : 'rgba(0, 0, 0, 0.65)';
        ctx.shadowBlur = r * 0.42;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = r * 0.22;

        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.08, x, y, r);
        if (stoneColor === BLACK) {
          g.addColorStop(0, '#52525b');
          g.addColorStop(0.3, '#27272a');
          g.addColorStop(0.75, '#18181b');
          g.addColorStop(1, '#09090b');
        } else {
          g.addColorStop(0, '#ffffff');
          g.addColorStop(0.4, '#f4f4f5');
          g.addColorStop(0.8, '#e4e4e7');
          g.addColorStop(1, '#a1a1aa');
        }
        ctx.fillStyle = g;
        ctx.fill();
        ctx.restore();

        // 镜面高光弧
        ctx.save();
        ctx.beginPath();
        ctx.ellipse(x - r * 0.28, y - r * 0.28, r * 0.42, r * 0.22, -Math.PI / 4, 0, Math.PI * 2);
        const glint = ctx.createLinearGradient(x - r * 0.45, y - r * 0.45, x, y);
        glint.addColorStop(0, stoneColor === BLACK ? 'rgba(255, 255, 255, 0.4)' : 'rgba(255, 255, 255, 0.95)');
        glint.addColorStop(0.5, stoneColor === BLACK ? 'rgba(255, 255, 255, 0.1)' : 'rgba(255, 255, 255, 0.3)');
        glint.addColorStop(1, 'rgba(255, 255, 255, 0)');
        ctx.fillStyle = glint;
        ctx.fill();
        ctx.restore();

        // 边缘轮廓
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.strokeStyle = stoneColor === BLACK ? 'rgba(255, 255, 255, 0.16)' : 'rgba(255, 255, 255, 0.9)';
        ctx.lineWidth = 0.9;
        ctx.stroke();

      } else if (theme === 'neo_trad') {
        // 📜 新中式水墨榧木：古法徽墨石与和田白玉
        ctx.save();
        ctx.shadowColor = 'rgba(60, 42, 22, 0.35)';
        ctx.shadowBlur = r * 0.36;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = r * 0.18;

        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        const g = ctx.createRadialGradient(x - r * 0.32, y - r * 0.32, r * 0.08, x, y, r);
        if (stoneColor === BLACK) {
          g.addColorStop(0, '#42362b');
          g.addColorStop(0.35, '#241b14');
          g.addColorStop(0.75, '#120d09');
          g.addColorStop(1, '#050403');
        } else {
          g.addColorStop(0, '#ffffff');
          g.addColorStop(0.35, '#faf6ee');
          g.addColorStop(0.75, '#ede0c8');
          g.addColorStop(1, '#d5c39e');
        }
        ctx.fillStyle = g;
        ctx.fill();
        ctx.restore();

        // 温润包浆高光
        ctx.save();
        ctx.beginPath();
        ctx.ellipse(x - r * 0.28, y - r * 0.28, r * 0.4, r * 0.22, -Math.PI / 4, 0, Math.PI * 2);
        const glint = ctx.createLinearGradient(x - r * 0.45, y - r * 0.45, x, y);
        glint.addColorStop(0, stoneColor === BLACK ? 'rgba(235, 200, 150, 0.38)' : 'rgba(255, 255, 255, 0.9)');
        glint.addColorStop(0.5, stoneColor === BLACK ? 'rgba(235, 200, 150, 0.08)' : 'rgba(255, 255, 255, 0.25)');
        glint.addColorStop(1, 'rgba(255, 255, 255, 0)');
        ctx.fillStyle = glint;
        ctx.fill();
        ctx.restore();

        // 描金与牙白边缘
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.strokeStyle = stoneColor === BLACK ? 'rgba(217, 175, 110, 0.38)' : 'rgba(180, 150, 100, 0.25)';
        ctx.lineWidth = 0.9;
        ctx.stroke();

      } else if (theme === 'luxury_glass') {
        // ✨ 现代奢华毛玻璃：冷光星芒蓝宝石与幻彩蛋白石
        ctx.save();
        ctx.shadowColor = stoneColor === BLACK ? 'rgba(79, 70, 229, 0.45)' : 'rgba(129, 140, 248, 0.4)';
        ctx.shadowBlur = r * 0.44;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = r * 0.2;

        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        const g = ctx.createRadialGradient(x - r * 0.32, y - r * 0.32, r * 0.08, x, y, r);
        if (stoneColor === BLACK) {
          g.addColorStop(0, '#6366f1');
          g.addColorStop(0.35, '#3730a3');
          g.addColorStop(0.75, '#1e1b4b');
          g.addColorStop(1, '#090a14');
        } else {
          g.addColorStop(0, '#ffffff');
          g.addColorStop(0.4, '#e0e7ff');
          g.addColorStop(0.75, '#a5b4fc');
          g.addColorStop(1, '#6366f1');
        }
        ctx.fillStyle = g;
        ctx.fill();
        ctx.restore();

        // 水晶折射双高光
        ctx.save();
        ctx.beginPath();
        ctx.ellipse(x - r * 0.28, y - r * 0.28, r * 0.42, r * 0.22, -Math.PI / 4, 0, Math.PI * 2);
        const glint = ctx.createLinearGradient(x - r * 0.45, y - r * 0.45, x, y);
        glint.addColorStop(0, 'rgba(255, 255, 255, 0.85)');
        glint.addColorStop(0.5, 'rgba(255, 255, 255, 0.2)');
        glint.addColorStop(1, 'rgba(255, 255, 255, 0)');
        ctx.fillStyle = glint;
        ctx.fill();
        ctx.restore();

        // 纯净冷光边缘
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.strokeStyle = stoneColor === BLACK ? 'rgba(165, 180, 252, 0.45)' : 'rgba(255, 255, 255, 0.85)';
        ctx.lineWidth = 1;
        ctx.stroke();

      } else if (theme === 'clean_ios') {
        // 📱 Clean iOS 极简暖白：苹果深空灰与精密陶瓷白
        ctx.save();
        ctx.shadowColor = 'rgba(0, 0, 0, 0.22)';
        ctx.shadowBlur = r * 0.34;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = r * 0.18;

        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        const g = ctx.createRadialGradient(x - r * 0.32, y - r * 0.32, r * 0.08, x, y, r);
        if (stoneColor === BLACK) {
          g.addColorStop(0, '#48484a');
          g.addColorStop(0.35, '#2c2c2e');
          g.addColorStop(0.75, '#1c1c1e');
          g.addColorStop(1, '#0c0c0e');
        } else {
          g.addColorStop(0, '#ffffff');
          g.addColorStop(0.4, '#f8f8fa');
          g.addColorStop(0.8, '#e5e5ea');
          g.addColorStop(1, '#c7c7cc');
        }
        ctx.fillStyle = g;
        ctx.fill();
        ctx.restore();

        // 苹果极简微高光
        ctx.save();
        ctx.beginPath();
        ctx.ellipse(x - r * 0.28, y - r * 0.28, r * 0.38, r * 0.2, -Math.PI / 4, 0, Math.PI * 2);
        const glint = ctx.createLinearGradient(x - r * 0.45, y - r * 0.45, x, y);
        glint.addColorStop(0, stoneColor === BLACK ? 'rgba(255, 255, 255, 0.32)' : 'rgba(255, 255, 255, 0.9)');
        glint.addColorStop(0.5, stoneColor === BLACK ? 'rgba(255, 255, 255, 0.06)' : 'rgba(255, 255, 255, 0.2)');
        glint.addColorStop(1, 'rgba(255, 255, 255, 0)');
        ctx.fillStyle = glint;
        ctx.fill();
        ctx.restore();

        // 极细边缘
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.strokeStyle = stoneColor === BLACK ? 'rgba(255, 255, 255, 0.14)' : 'rgba(0, 0, 0, 0.1)';
        ctx.lineWidth = 0.8;
        ctx.stroke();

      } else {
        // 🌿 经典晴空浮岛草坪棋子：顶级高球云子质感 (深邃黑玉 / 纯净羊脂白玉)
        ctx.save();
        ctx.shadowColor = 'rgba(20, 48, 12, 0.38)';
        ctx.shadowBlur = r * 0.36;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = r * 0.18;

        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        const g = ctx.createRadialGradient(x - r * 0.32, y - r * 0.32, r * 0.08, x, y, r);
        if (stoneColor === BLACK) {
          // 深沉黑玉石，高光自然过渡到纯黑
          g.addColorStop(0, '#525e6f');
          g.addColorStop(0.28, '#272d37');
          g.addColorStop(0.72, '#11141a');
          g.addColorStop(1, '#05070a');
        } else {
          // 纯正羊脂温润白玉，告别脏粉色
          g.addColorStop(0, '#ffffff');
          g.addColorStop(0.35, '#f8fafc');
          g.addColorStop(0.75, '#e2e8f0');
          g.addColorStop(1, '#cbd5e1');
        }
        ctx.fillStyle = g;
        ctx.fill();
        ctx.restore();

        // 顶级瓷釉高光镜面弧
        ctx.save();
        ctx.beginPath();
        ctx.ellipse(x - r * 0.28, y - r * 0.28, r * 0.42, r * 0.22, -Math.PI / 4, 0, Math.PI * 2);
        const glint = ctx.createLinearGradient(x - r * 0.45, y - r * 0.45, x, y);
        glint.addColorStop(0, stoneColor === BLACK ? 'rgba(255, 255, 255, 0.42)' : 'rgba(255, 255, 255, 0.92)');
        glint.addColorStop(0.5, stoneColor === BLACK ? 'rgba(255, 255, 255, 0.1)' : 'rgba(255, 255, 255, 0.28)');
        glint.addColorStop(1, 'rgba(255, 255, 255, 0)');
        ctx.fillStyle = glint;
        ctx.fill();
        ctx.restore();

        // 底部环境微反光 (增加玉石通透厚重感)
        ctx.save();
        ctx.beginPath();
        ctx.arc(x, y, r - 0.5, Math.PI * 0.2, Math.PI * 0.8);
        ctx.strokeStyle = stoneColor === BLACK ? 'rgba(255, 255, 255, 0.1)' : 'rgba(255, 255, 255, 0.5)';
        ctx.lineWidth = 0.8;
        ctx.stroke();
        ctx.restore();

        // 极细外轮廓线 (取代原先粗糙的纯白大线圈，提供清晰微反差)
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.strokeStyle = stoneColor === BLACK ? 'rgba(255, 255, 255, 0.16)' : 'rgba(15, 23, 42, 0.15)';
        ctx.lineWidth = 0.85;
        ctx.stroke();
      }
    }

    // ⚡ Canvas 极速离屏位图缓存系统 (底盘与网格线单次预渲染，贴图提速10倍，稳定120Hz满帧)
    let cachedBoardCanvas = null;
    let cachedBoardKey = '';
    let cachedBoardW = 0;
    let cachedBoardH = 0;
    let cachedPiecesCanvas = null;
    let cachedPiecesKey = '';
    // 标准棋局的幽灵落子只存在于渲染层，不进入 board/history，也不会触及 P2P 状态。
    let boardPreviewPoint = null;
    let boardPointerId = null;

    // Canvas 绘制调度：游戏状态可能在同一事件循环内连续变化（例如技能牌同时
    // 触发多颗棋子特效），所有普通 draw() 请求只合并到下一帧执行一次。保留
    // draw(true) 作为 resize/主题切换等需要立即反映的同步路径，避免影响现有
    // 模块对 draw() 的调用约定。
    let boardDrawFrame = null;
    let boardDrawPending = false;
    let boardDrawLastAt = 0;
    let vfxLastRenderAt = 0;
    let initialBoardFramePending = true;
    const canvasFrameStats = {
      requested: 0,
      rendered: 0,
      coalesced: 0,
      vfxRendered: 0,
      lastRenderAt: 0,
      lastVfxRenderAt: 0
    };
    window.__gomokuCanvasFrameStats = canvasFrameStats;

    function requestCanvasFrame(callback) {
      const raf = window.requestAnimationFrame;
      if (typeof raf === 'function') return raf.call(window, callback);
      return setTimeout(() => callback(performance.now()), 16);
    }

    function cancelCanvasFrame(frame) {
      if (frame === null || frame === undefined) return;
      if (typeof window.cancelAnimationFrame === 'function') {
        try { window.cancelAnimationFrame(frame); return; } catch (_) {}
      }
      clearTimeout(frame);
    }

    function getCanvasFrameBudgetMs() {
      // 流畅档优先稳定触控与温度，把特效锁到约 30fps；标准/高清档仍跟随
      // 浏览器刷新率，不改变棋盘静态绘制的清晰度。
      return getEffectiveGraphicsTier() === 'smooth' ? 1000 / 30 : 1000 / 60;
    }

    function cancelScheduledBoardDraw() {
      if (boardDrawFrame !== null) {
        cancelCanvasFrame(boardDrawFrame);
        boardDrawFrame = null;
      }
    }

    function invalidateBoardCache() {
      cachedBoardKey = '';
      cachedPiecesKey = '';
    }

    function getCachedBoardBitmap() {
      const targetW = Math.round(cWidth * dpr);
      const targetH = Math.round(cHeight * dpr);
      if (cachedBoardCanvas && cachedBoardKey === activeThemeKey && cachedBoardW === targetW && cachedBoardH === targetH) {
        return cachedBoardCanvas;
      }
      if (!cachedBoardCanvas) {
        cachedBoardCanvas = document.createElement('canvas');
      }
      cachedBoardCanvas.width = targetW;
      cachedBoardCanvas.height = targetH;
      const bCtx = cachedBoardCanvas.getContext('2d');
      bCtx.imageSmoothingEnabled = true;
      bCtx.imageSmoothingQuality = 'high';
      if (bCtx.resetTransform) bCtx.resetTransform(); else bCtx.setTransform(1,0,0,1,0,0);
      bCtx.scale(dpr, dpr);

      const origCtx = ctx;
      ctx = bCtx;
      drawHandmadeGrassBoard();
      ctx = origCtx;

      cachedBoardKey = activeThemeKey;
      cachedBoardW = targetW;
      cachedBoardH = targetH;
      return cachedBoardCanvas;
    }

    // 棋子与复盘序号也做离屏缓存。动画帧只贴图，避免每帧重复创建 225 个渐变/阴影对象。
    function hashBoardVisual() {
      let hash = 2166136261;
      for (let r = 0; r < 15; r++) {
        const row = board[r] || [];
        for (let c = 0; c < 15; c++) {
          hash ^= ((row[c] == null ? EMPTY : row[c]) + 1) & 0xff;
          hash = Math.imul(hash, 16777619);
        }
      }
      return hash >>> 0;
    }

    function hashReplayVisual() {
      if (!isReplayMode || !Array.isArray(history) || history.length === 0) return 0;
      let hash = 2166136261;
      for (const item of history) {
        if (!item) continue;
        hash ^= ((Number(item.r) + 2) || 0) & 0xff;
        hash = Math.imul(hash, 16777619);
        hash ^= ((Number(item.c) + 2) || 0) & 0xff;
        hash = Math.imul(hash, 16777619);
        hash ^= (Number(item.p) || 0) & 0xff;
        hash = Math.imul(hash, 16777619);
        hash ^= (Number(item.moveNum) || 0) & 0xff;
        hash = Math.imul(hash, 16777619);
        const label = typeof item.action === 'string' ? item.action : (typeof item.type === 'string' ? item.type : '');
        hash ^= label.length & 0xff;
        hash = Math.imul(hash, 16777619);
      }
      return hash >>> 0;
    }

    function getCachedPiecesBitmap() {
      const hasPieces = board.some(row => Array.isArray(row) && row.some(value => value !== EMPTY));
      if (!hasPieces && !isReplayMode) return null;
      const targetW = Math.round(cWidth * dpr);
      const targetH = Math.round(cHeight * dpr);
      const key = `${activeThemeKey}|${targetW}|${targetH}|${dpr}|${radius}|${isReplayMode ? 1 : 0}|${hashBoardVisual()}|${hashReplayVisual()}`;
      if (cachedPiecesCanvas && cachedPiecesKey === key) return cachedPiecesCanvas;
      if (!cachedPiecesCanvas) cachedPiecesCanvas = document.createElement('canvas');
      cachedPiecesCanvas.width = targetW;
      cachedPiecesCanvas.height = targetH;
      const piecesCtx = cachedPiecesCanvas.getContext('2d');
      piecesCtx.imageSmoothingEnabled = true;
      piecesCtx.imageSmoothingQuality = 'high';
      if (piecesCtx.resetTransform) piecesCtx.resetTransform(); else piecesCtx.setTransform(1,0,0,1,0,0);
      piecesCtx.scale(dpr, dpr);
      piecesCtx.clearRect(0, 0, cWidth, cHeight);

      const originalCtx = ctx;
      ctx = piecesCtx;
      try {
        for (let r = 0; r < 15; r++) {
          for (let c = 0; c < 15; c++) {
            if (board[r][c] !== EMPTY) {
              const x = paddingX + (c + 0.5) * gridX;
              const y = paddingY + (r + 0.5) * gridY;
              drawThemedStone(x, y, radius, board[r][c], activeThemeKey);
            }
          }
        }

        if (isReplayMode && history && history.length > 0) {
          for (let i = 0; i < history.length; i++) {
            const st = history[i];
            if (!st || st.r < 0 || st.c < 0 || !board[st.r] || board[st.r][st.c] === EMPTY) continue;
            const sx = paddingX + (st.c + 0.5) * gridX;
            const sy = paddingY + (st.r + 0.5) * gridY;
            piecesCtx.font = `bold ${Math.round(radius * 0.95)}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
            piecesCtx.textAlign = 'center';
            piecesCtx.textBaseline = 'middle';
            const curColor = (board[st.r] && board[st.r][st.c]) || st.p;
            piecesCtx.fillStyle = (curColor === 1) ? '#f8fafc' : '#0f172a';
            const displayNum = st.moveNum || (i + 1);
            piecesCtx.fillText(String(displayNum), sx, sy + 1);
          }
        }
      } finally {
        ctx = originalCtx;
      }
      cachedPiecesKey = key;
      return cachedPiecesCanvas;
    }

    function drawFirstFrame() {
      ctx.clearRect(0, 0, cWidth, cHeight);
      ctx.fillStyle = '#78c82e';
      ctx.fillRect(0, 0, cWidth, cHeight);
      ctx.strokeStyle = 'rgba(36, 78, 12, 0.46)';
      ctx.lineWidth = Math.max(0.6, 1 / Math.max(1, dpr));
      ctx.beginPath();
      for (let i = 0; i < 15; i++) {
        const x = paddingX + i * gridX;
        const y = paddingY + i * gridY;
        ctx.moveTo(x, paddingY);
        ctx.lineTo(x, paddingY + 14 * gridY);
        ctx.moveTo(paddingX, y);
        ctx.lineTo(paddingX + 14 * gridX, y);
      }
      ctx.stroke();
    }

    function drawNow() {
      // VFX 的 rAF 可能与普通状态绘制同时排队；立即绘制时取消待执行的普通
      // 帧，避免同一刷新周期重复清屏、贴图和重建缓存。
      cancelScheduledBoardDraw();
      boardDrawPending = false;
      boardDrawLastAt = performance.now();
      canvasFrameStats.rendered++;
      canvasFrameStats.lastRenderAt = boardDrawLastAt;
      ctx.clearRect(0, 0, cWidth, cHeight);

      // 1. 硬件加速单次贴图：极速离屏底盘位图 (GPU Blit 零回流零重绘，高分屏1:1超采样)
      ctx.drawImage(getCachedBoardBitmap(), 0, 0, cWidth, cHeight);

      // 2. 棋子与复盘序号使用离屏缓存；动态标记和粒子特效仍在主画布绘制 (零插值模糊)。
      const piecesBitmap = getCachedPiecesBitmap();
      if (piecesBitmap) ctx.drawImage(piecesBitmap, 0, 0, cWidth, cHeight);

      // 棋息预览：按下或悬停时先显示半透明棋子，松手才真正落子。
      if (!isReplayMode && !isOver && boardPreviewPoint && !activeSkill &&
          board[boardPreviewPoint.r] && board[boardPreviewPoint.r][boardPreviewPoint.c] === EMPTY) {
        const previewX = paddingX + (boardPreviewPoint.c + 0.5) * gridX;
        const previewY = paddingY + (boardPreviewPoint.r + 0.5) * gridY;
        const pulse = (Math.sin(performance.now() / 120) + 1) / 2;
        ctx.save();
        ctx.globalAlpha = 0.46;
        drawThemedStone(previewX, previewY, radius, turn, 'default');
        ctx.globalAlpha = 0.45 + pulse * 0.35;
        ctx.beginPath();
        ctx.arc(previewX, previewY, radius * (1.34 + pulse * 0.1), 0, Math.PI * 2);
        ctx.strokeStyle = '#f2bf4d';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.restore();
      }

      // 3. 最后一手落子标记 (采用五子棋行业公认标准：中心经典高反差正红圆点 + 纯白轮廓，全主题全棋色通用)
      if (!isReplayMode) {
        let last = null;
        for (let i = history.length - 1; i >= 0; i--) {
          const h = history[i];
          if (!h) continue;
          if (h.action === 'mega_bomb' || h.type === 'skill_mega_bomb' ||
              h.action === 'remove_stone' || h.type === 'skill_remove_stone' ||
              h.action === 'destiny_wipe_danger' || h.type === 'destiny_wipe_danger') {
            break; // 大爆炸洗牌全盘或棋子抹除后，绝不在空位绘制幽灵落子标记
          }
          if (h.r >= 0 && h.c >= 0 && board[h.r] && board[h.r][h.c] !== EMPTY) {
            last = h;
            break;
          }
        }
        if (last) {
          const lx = paddingX + (last.c + 0.5) * gridX;
          const ly = paddingY + (last.r + 0.5) * gridY;
          const dotRadius = Math.max(3.5, radius * 0.28);

          ctx.save();
          // 外层轻柔微阴影，增强各主题与棋色下的立体度与清晰度
          ctx.shadowColor = 'rgba(0, 0, 0, 0.4)';
          ctx.shadowBlur = 3;
          ctx.shadowOffsetX = 0;
          ctx.shadowOffsetY = 1;

          // 经典行业正红圆标
          ctx.beginPath();
          ctx.arc(lx, ly, dotRadius, 0, Math.PI * 2);
          ctx.fillStyle = '#ef4444';
          ctx.fill();

          // 纯白高反差轮廓线 (在黑棋、白棋及各主题背景下均极其清晰醒目，符合国际围棋与五子棋通用规范)
          ctx.lineWidth = Math.max(1.5, dotRadius * 0.35);
          ctx.strokeStyle = '#ffffff';
          ctx.stroke();

          ctx.restore();
        }
      } else if (isReplayMode && replayStepIndex > 0) {
        // 🔍 复盘模式：为当前步动作/落子添加清晰聚焦高亮环
        const lastM = replayAllMoves[replayStepIndex - 1];
        if (lastM) {
          const hlPoints = [];
          let ringColor = '#ef4444';
          if (lastM.action === 'shift_stone') {
            if (lastM.toR >= 0 && lastM.toC >= 0) hlPoints.push({ r: lastM.toR, c: lastM.toC });
            ringColor = '#3b82f6';
          } else if (lastM.action === 'swap_color') {
            if (lastM.r >= 0 && lastM.c >= 0) hlPoints.push({ r: lastM.r, c: lastM.c });
            ringColor = '#a855f7';
          } else if (lastM.action === 'swap_positions') {
            if (lastM.r1 >= 0 && lastM.c1 >= 0) hlPoints.push({ r: lastM.r1, c: lastM.c1 });
            if (lastM.r2 >= 0 && lastM.c2 >= 0) hlPoints.push({ r: lastM.r2, c: lastM.c2 });
            ringColor = '#ec4899';
          } else if (lastM.r >= 0 && lastM.c >= 0 && !lastM.action) {
            hlPoints.push({ r: lastM.r, c: lastM.c });
            ringColor = '#f59e0b';
          }
          for (const pt of hlPoints) {
            if (board[pt.r] && board[pt.r][pt.c] !== EMPTY) {
              const lx = paddingX + (pt.c + 0.5) * gridX;
              const ly = paddingY + (pt.r + 0.5) * gridY;
              ctx.save();
              ctx.shadowColor = ringColor;
              ctx.shadowBlur = 6;
              ctx.beginPath();
              ctx.arc(lx, ly, radius * 1.25, 0, Math.PI * 2);
              ctx.lineWidth = 2.5;
              ctx.strokeStyle = ringColor;
              ctx.stroke();
              ctx.restore();
            }
          }
        }
      }

      // 4. 绘制【移星换斗】与【移形换影】选中的己方棋子高亮光环
      if (activeSkill && (activeSkill.skill.id === 'shift_stone' || activeSkill.skill.id === 'swap_positions') && activeSkill.step === 2) {
        const sx = paddingX + (activeSkill.srcC + 0.5) * gridX;
        const sy = paddingY + (activeSkill.srcR + 0.5) * gridY;
        ctx.save();
        ctx.beginPath(); ctx.arc(sx, sy, radius * 1.38, 0, Math.PI * 2);
        ctx.strokeStyle = activeSkill.skill.id === 'swap_positions' ? '#d946ef' : '#facc15';
        ctx.lineWidth = 3.5;
        ctx.setLineDash([5, 3]);
        ctx.stroke();
        ctx.restore();
      }

      // 5. 绘制【预言封锁】水晶球标记（在预言的空格上显示 🔮 标记）
      if (prophecyPoint) {
        const fx = paddingX + (prophecyPoint.c + 0.5) * gridX;
        const fy = paddingY + (prophecyPoint.r + 0.5) * gridY;
        ctx.save();
        ctx.beginPath(); ctx.arc(fx, fy, radius * 0.9, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(167, 139, 250, 0.35)'; ctx.fill();
        ctx.strokeStyle = '#a78bfa'; ctx.lineWidth = 2.5; ctx.setLineDash([4, 3]); ctx.stroke();
        ctx.font = `${Math.floor(radius * 1.1)}px sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('🔮', fx, fy + 1);
        ctx.restore();
      }

      // 7. 绘制【五子连珠】连线金光激光与胜利光环
      if (isOver && winningLine && winningLine.length >= 5) {
        ctx.save();
        ctx.beginPath();
        const p0 = winningLine[0];
        ctx.moveTo(paddingX + (p0.c + 0.5) * gridX, paddingY + (p0.r + 0.5) * gridY);
        for (let i = 1; i < winningLine.length; i++) {
          const pt = winningLine[i];
          ctx.lineTo(paddingX + (pt.c + 0.5) * gridX, paddingY + (pt.r + 0.5) * gridY);
        }
        const pulse = (Math.sin(performance.now() / 140) + 1) / 2;
        ctx.strokeStyle = '#facc15';
        ctx.lineWidth = 4.5 + pulse * 2.5;
        ctx.shadowColor = '#f59e0b';
        ctx.shadowBlur = 18 + pulse * 10;
        ctx.lineCap = 'round';
        ctx.stroke();

        for (const pt of winningLine) {
          const wx = paddingX + (pt.c + 0.5) * gridX;
          const wy = paddingY + (pt.r + 0.5) * gridY;
          ctx.beginPath();
          ctx.arc(wx, wy, radius * (1.3 + pulse * 0.15), 0, Math.PI * 2);
          ctx.strokeStyle = '#fef08a';
          ctx.lineWidth = 3;
          ctx.shadowBlur = 14;
          ctx.stroke();
        }
        ctx.restore();
      }

      // 8. 实时渲染全屏高能粒子与技能动画特效（帧率由画质档位控制）
      renderActiveVFX(ctx);
    }

    function draw(immediate = false) {
      canvasFrameStats.requested++;
      if (immediate) {
        cancelScheduledBoardDraw();
        boardDrawPending = false;
        drawNow();
        return;
      }

      boardDrawPending = true;
      if (document.visibilityState === 'hidden') return;
      if (boardDrawFrame !== null) {
        canvasFrameStats.coalesced++;
        return;
      }
      boardDrawFrame = requestCanvasFrame(() => {
        boardDrawFrame = null;
        if (document.visibilityState === 'hidden' || !boardDrawPending) return;
        boardDrawPending = false;
        drawNow();
      });
    }

    let winningLine = null;
    let gameResultIsDraw = false;
    function checkWin(r, c, p) {
      const dirs = [[0,1],[1,0],[1,1],[1,-1]];
      for (const [dr,dc] of dirs) {
        let line = [{r, c}];
        for (let s=1; s<=4; s++) {
          const nr=r+s*dr, nc=c+s*dc;
          if (nr>=0&&nr<15&&nc>=0&&nc<15&&board[nr][nc]===p) line.push({r: nr, c: nc}); else break;
        }
        for (let s=1; s<=4; s++) {
          const nr=r-s*dr, nc=c-s*dc;
          if (nr>=0&&nr<15&&nc>=0&&nc<15&&board[nr][nc]===p) line.unshift({r: nr, c: nc}); else break;
        }
        if (line.length >= 5) {
          winningLine = line;
          return true;
        }
      }
      return false;
    }

    function isBoardFull() {
      for (let r = 0; r < 15; r++) {
        for (let c = 0; c < 15; c++) {
          if (board[r][c] === EMPTY) return false;
        }
      }
      return true;
    }

    // 轻量确定性状态摘要：不是密码学签名，而是用来发现丢包、乱序、旧快照和
    // 两端技能结算不同步。真正的安全边界仍是会话隔离、角色校验和房主权威快照。
    function getOnlineStateDigest(state = {}) {
      const payload = {
        board: state.board || board,
        history: state.history || history,
        turn: state.turn === undefined ? turn : state.turn,
        isOver: state.isOver === undefined ? isOver : state.isOver,
        isDraw: state.isDraw === undefined ? gameResultIsDraw : state.isDraw,
        winnerColor: state.winnerColor === undefined ? gameWinnerColor : state.winnerColor
      };
      let hash = 2166136261;
      const text = JSON.stringify(payload);
      for (let i = 0; i < text.length; i++) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
      }
      return (hash >>> 0).toString(16).padStart(8, '0');
    }

    function isIncomingStateDigestValid(data) {
      if (!data || !data.stateDigest) return true;
      return data.stateDigest.toLowerCase() === getOnlineStateDigest({
        board: data.board,
        history: data.history,
        turn: data.turn,
        isOver: data.isOver,
        isDraw: data.isDraw === true,
        winnerColor: data.winnerColor || 0
      });
    }

    function settleRemoteSkillResult(reason = '对方发动干扰牌后') {
      if (isOver) return true;
      let winnerColor = 0;
      for (let r = 0; r < 15 && !winnerColor; r++) {
        for (let c = 0; c < 15; c++) {
          const color = board[r][c];
          if (color !== EMPTY && checkWin(r, c, color)) {
            winnerColor = color;
            break;
          }
        }
      }
      if (winnerColor) {
        triggerGameEnd(
          winnerColor,
          `${reason}，【${getPlayerNameByColor(winnerColor)} (${winnerColor === BLACK ? '黑子' : '白子'})】达成五子连珠！`
        );
        return true;
      }
      if (isBoardFull()) {
        triggerGameDraw(`${reason}，棋盘已无空位，双方本局和棋！`);
        return true;
      }
      return false;
    }

    function makeMove(r, c, p, fromRemote = false) {
      if (!Number.isInteger(r) || !Number.isInteger(c) || r < 0 || r >= 15 || c < 0 || c >= 15 || (p !== BLACK && p !== WHITE)) return;
      if (board[r][c] !== EMPTY || isOver) return;

      // 检查是否命中对手布下的预言封锁
      if (isProphecied(r, c, p)) {
        const victimR = r, victimC = c;
        prophecyPoint = null; // 预言成功阻断命中，消耗掉
        triggerSkillVFX('freeze', victimR, victimC);
        playSkillSound('ice');
        triggerBoardShake();
        showSkillBanner('🔮', '【预言封锁】神威生效！', `天机显现！试图在 (${victimR+1}, ${victimC+1}) 的绝杀落子已被天命强行撤销！`);
        showGameNotice(`🔮 预言封锁命中！撤销 (${victimR+1}, ${victimC+1}) 处的落子！`, true);
        draw();

        // 若是 AI 试图落子被预言拦截，AI 重新寻找其他落子点，绝不卡死
        if (gameMode === 'ai' && p === WHITE) {
          setTimeout(() => smartAiMove([{ r: victimR, c: victimC }]), 700);
        }
        return; // 不落子，不切回合，对手必须另选位置落子！
      }

      // 如果对手落在了其他位置，则预言落空失效；若是施法者本人落子，预言保留等待对手落子！
      if (prophecyPoint && p !== prophecyPoint.by) {
        prophecyPoint = null;
      }

      saveUndoSnapshot('move', { r, c, p, turn });
      board[r][c] = p;
      history.push({r, c, p});
      playPopSound();
      triggerStoneDropVFX(r, c, p); // 💫 落子波纹与微光微粒反馈
      draw();

      if (gameMode === 'online' && !fromRemote && conn && conn.open) {
        conn.send({ type: 'move', r, c, p, step: history.length });
      }

      if (checkWin(r, c, p)) {
        triggerGameEnd(p);
        return;
      }

      if (isBoardFull()) {
        triggerGameDraw();
        return;
      }

      // 连击处理 (双星连珠 或 命运神抽疯狂暴击 / 大凶补子)
      if (opponentFreeMove) {
        opponentFreeMove = false;
        showGameNotice("💀 免费补子已完成！继续执行正常落子回合！", false);
        // 不切换 turn，继续落正常子
      } else if (consecutiveMovesLeft > 0) {
        consecutiveMovesLeft--;
        showGameNotice(`⚡ 疯狂暴击生效中！还可连续再落 ${consecutiveMovesLeft + 1} 颗子！`, false);
        // 不切换 turn
      } else if (hasExtraMove) {
        hasExtraMove = false;
        showGameNotice("⚡【双星连珠】神威生效！本回合可连续再落一子！", false);
        // 不切换 turn
      } else {
        turn = p === BLACK ? WHITE : BLACK;
      }

      updateUI();
      persistGameState();

      if (gameMode === 'ai' && turn === WHITE && !isOver) {
        setTimeout(smartAiMove, 80);
      }
    }

    function getBoardPointFromPointer(e) {
      const rect = cvs.getBoundingClientRect();
      const clickX = (e.clientX - rect.left) * (cWidth / rect.width);
      const clickY = (e.clientY - rect.top) * (cHeight / rect.height);
      const col = Math.floor((clickX - paddingX) / gridX);
      const row = Math.floor((clickY - paddingY) / gridY);
      return row >= 0 && row < 15 && col >= 0 && col < 15 ? { row, col } : null;
    }

    function canPreviewLocalMove() {
      if (isReplayMode || isOver) return false;
      if (gameMode === 'ai' && turn !== BLACK) return false;
      if (gameMode === 'online' && (turn !== myOnlineColor || !conn || !conn.open)) return false;
      return true;
    }

    function setBoardPreview(point) {
      const next = point && board[point.row] && board[point.row][point.col] === EMPTY
        ? { r: point.row, c: point.col }
        : null;
      if ((next?.r ?? -1) === (boardPreviewPoint?.r ?? -1) && (next?.c ?? -1) === (boardPreviewPoint?.c ?? -1)) return;
      boardPreviewPoint = next;
      if (next) cvs.dataset.previewPoint = `${next.r},${next.c}`;
      else delete cvs.dataset.previewPoint;
      draw();
    }

    cvs.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const point = getBoardPointFromPointer(e);
      if (!point) return;

      // 技能选点保持原来的即时操作语义，避免影响联机卡牌协议。
      if (activeSkill) {
        handleSkillClick(point.row, point.col);
        return;
      }
      if (!canPreviewLocalMove()) {
        if (gameMode === 'online' && turn !== myOnlineColor) showGameNotice('轮到对手走棋，请稍候…', false);
        else if (gameMode === 'online' && (!conn || !conn.open)) showGameNotice('连接正在恢复，棋盘进度已保留', true);
        return;
      }
      if (board[point.row][point.col] !== EMPTY) {
        triggerSkillVFX('invalid_click', point.row, point.col);
        return;
      }
      boardPointerId = e.pointerId;
      cvs.setPointerCapture?.(e.pointerId);
      setBoardPreview(point);
    }, { passive: false });

    cvs.addEventListener('pointermove', (e) => {
      if (activeSkill || !canPreviewLocalMove()) return;
      if (e.pointerType !== 'mouse' && e.pointerId !== boardPointerId) return;
      if (e.pointerId === boardPointerId) e.preventDefault();
      setBoardPreview(getBoardPointFromPointer(e));
    }, { passive: false });

    cvs.addEventListener('pointerup', (e) => {
      if (e.pointerId !== boardPointerId) return;
      e.preventDefault();
      const point = getBoardPointFromPointer(e);
      const preview = boardPreviewPoint;
      boardPointerId = null;
      cvs.releasePointerCapture?.(e.pointerId);
      boardPreviewPoint = null;
      delete cvs.dataset.previewPoint;
      if (point && preview && point.row === preview.r && point.col === preview.c &&
          board[point.row][point.col] === EMPTY && canPreviewLocalMove()) {
        makeMove(point.row, point.col, turn);
        try { navigator.vibrate?.(8); } catch (_) {}
      } else {
        draw();
      }
    }, { passive: false });

    const cancelBoardPointer = (e) => {
      if (boardPointerId !== null && (!e || e.pointerId === boardPointerId)) {
        boardPointerId = null;
        boardPreviewPoint = null;
        delete cvs.dataset.previewPoint;
        draw();
      }
    };
    cvs.addEventListener('pointercancel', cancelBoardPointer, { passive: false });
    cvs.addEventListener('pointerleave', (e) => {
      if (boardPointerId === null && e.pointerType === 'mouse') {
        boardPreviewPoint = null;
        delete cvs.dataset.previewPoint;
        draw();
      }
    }, { passive: true });

    // 底部按键绑定
    document.getElementById('btnOpenChat').onclick = openChatDrawer;
    document.getElementById('btnCloseChat').onclick = closeChatDrawer;
    document.getElementById('chatBackdrop').onclick = (e) => {
      if (e.target === document.getElementById('chatBackdrop')) closeChatDrawer();
    };

    document.getElementById('btnSendCustom').onclick = () => {
      const input = document.getElementById('chatInput');
      sendChat(input.value);
    };
    document.getElementById('chatInput').onkeydown = (e) => {
      if (e.key === 'Enter') document.getElementById('btnSendCustom').click();
    };

    // 📱 手机端快速触控响应：确保点击头像或胶囊 100% 秒开个人档案弹窗
    const p1CardElem = document.getElementById('p1Card');
    if (p1CardElem) {
      let tStart = 0;
      p1CardElem.addEventListener('touchstart', () => { tStart = Date.now(); }, { passive: true });
      p1CardElem.addEventListener('touchend', (e) => {
        if (Date.now() - tStart < 400) {
          e.preventDefault();
          openProfileModal(1);
        }
      });
    }
    const p2CardElem = document.getElementById('p2Card');
    if (p2CardElem) {
      let tStart = 0;
      p2CardElem.addEventListener('touchstart', () => { tStart = Date.now(); }, { passive: true });
      p2CardElem.addEventListener('touchend', (e) => {
        if (Date.now() - tStart < 400) {
          e.preventDefault();
          openProfileModal(2);
        }
      });
    }

    // 🚪 退出联机房间功能 (彻底断开连接并还原棋盘)
    function confirmLeaveOnlineRoom() {
      showCustomConfirm("确定要退出当前联机房间吗？\n退出后将解散对战并切回单机模式。", () => {
        leaveOnlineRoom(true);
      }, null, { title: '退出联机房间', icon: '🚪', okText: '确认退出', cancelText: '取消' });
    }

    function leaveOnlineRoom(sendNotice = true) {
      if (typeof commitPendingMatchRecord === 'function') commitPendingMatchRecord();
      stopReconnectHandshakeLoop();
      detachHostInviteListener();
      if (sendNotice && conn && conn.open) {
        try { conn.send({ type: "leave_room", name: p1Name }); } catch(_) {}
      }
      if (conn) {
        try { conn.close(true); } catch(_) {}
        conn = null;
      }
      closeMqttClientPool();
      if (p2pChannel) {
        try { p2pChannel.close(); } catch(_) {}
        p2pChannel = null;
      }
      if (peer && !peer.destroyed) {
        try { peer.destroy(); } catch(_) {}
        peer = null;
      }
      if (onlineHeartbeatTimer) {
        clearInterval(onlineHeartbeatTimer);
        onlineHeartbeatTimer = null;
      }
      pendingOnlinePings.clear();
      onlineNetworkTelemetry.localLatencyMs = null;
      onlineNetworkTelemetry.remoteLatencyMs = null;
      onlineNetworkTelemetry.remoteLastSeenAt = 0;
      onlineNetworkTelemetry.remoteState = '等待对方';
      onlineNetworkTelemetry.localLatencySamples = [];
      onlineNetworkTelemetry.remoteLatencySamples = [];
      onlineNetworkTelemetry.localTransportRttMs = null;
      onlineNetworkTelemetry.remoteTransportRttMs = null;
      currentRoomCode = null;
      onlineSessionId = '';
      onlineJoinTicket = '';
      onlineTransportGeneration++;
      clearOnlineReliableOutbox();
      onlineRoundId = '';
      pendingOnlineUndoId = '';
      activeOnlineUndoId = '';
      pendingOnlineRestartId = '';
      activeOnlineRestartId = '';
      activeOnlineGuestUid = '';
      activeOnlineOpponentUid = '';
      if (typeof closeUndoModal === 'function') closeUndoModal();
      if (typeof closeGameResultModal === 'function') closeGameResultModal();
      try { localStorage.removeItem('gomoku_active_online_room'); } catch(_) {}
      cancelQuickMatch();
      hideMatchingFloatingBar();
      setMode("ai", false);
      resetBoardOnly();
      updatePlayerHeaderUI();
      closeOnlineModal();
      showGameNotice("🚪 您已退出联机房间，已切回人机对弈模式~", false);
    }

    // 👤 退出当前账号功能 (切回安全游客模式)
    function confirmLogoutAccount() {
      if (!hasRegisteredAccountSession()) return;
      showCustomConfirm(`确定要退出账号【${currentUsername}】吗？\n退出后将切换为游客模式，随时可重新输入密码登录。`, () => {
        logoutAccount();
      }, null, { title: '退出当前账号', icon: '👤', okText: '确认退出', cancelText: '取消' });
    }

    async function logoutAccount() {
      const oldName = currentUsername;
      if (window.GomokuSocial?.stop) window.GomokuSocial.stop();
      currentUsername = "";
      currentUserUid = "";
      currentUserToken = "";
      currentUserRefreshToken = "";
      currentUserScore = 1000;
      localStorage.removeItem("gomoku_user_username");
      localStorage.removeItem("gomoku_user_token");
      localStorage.removeItem("gomoku_user_refresh_token");
      localStorage.removeItem("gomoku_user_uid");
      localStorage.setItem("gomoku_user_score", "1000");

      // 重置本地临时分数和战绩徽标，杜绝跨账号复制数据漏洞
      const badge = document.getElementById("myLadderBadge");
      if (badge) badge.textContent = "1000 分";
      const countEl = document.getElementById("historyStatCount");
      if (countEl) countEl.textContent = "0 局战绩";

      if (typeof AndroidNativeApp !== "undefined" && AndroidNativeApp.clearUserLogin) {
        try { AndroidNativeApp.clearUserLogin(); } catch(e) {}
      }

      // 分配全新的纯净游客身份
      try {
        const res = await safeApiFetch("/api/auth/guest", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({})
        });
        const json = await res.json();
        if (json && json.code === 0 && json.data) {
          applyUserData(json.data);
        }
      } catch(e) {
        let guestNick = localStorage.getItem('gomoku_guest_nickname') || '逍遥弈客';
        p1Name = guestNick;
        localStorage.setItem('gomoku_p1Name', p1Name);
        currentUserUid = 'guest_' + Math.random().toString(36).substring(2, 9);
        localStorage.setItem('gomoku_user_uid', currentUserUid);
        currentUserScore = 1000;
        updatePlayerHeaderUI();
        updateAccountUI();
      }

      updatePlayerHeaderUI();
      updateAccountUI();
      updateHistoryCountUI();
      closeAuthModal();
      showGameNotice(`🚪 已退出账号【${oldName}】，战绩已在云端安全归档`, true);
    }

    function resetBoardOnly(nextRoundId = null) {
      if (typeof commitPendingMatchRecord === 'function') commitPendingMatchRecord();
      aiTurnSeq++;
      aiThinking = false;
      activeSkill = null;
      const skillPromptBar = document.getElementById('skillPromptBar');
      if (skillPromptBar) skillPromptBar.style.display = 'none';
      cancelPendingGameResultModal();
      if (typeof closeGameResultModal === 'function') closeGameResultModal();
      if (gameMode === 'online' && nextRoundId) {
        clearOnlineReliableOutbox();
        onlineRoundId = nextRoundId;
      }
      opponentSkillsUsedCount = 0;
      opponentReforgeUsed = false;
      board = Array.from({length: 15}, () => Array(15).fill(0));
      turn = BLACK; history = []; isOver = false; gameWinnerColor = 0; winningLine = null; gameResultIsDraw = false;
      pendingOnlineUndoId = '';
      activeOnlineUndoId = '';
      pendingOnlineRestartId = '';
      activeOnlineRestartId = '';
      activeVFX = [];
      undoStack = [];
      if (typeof vfxRAF !== 'undefined' && vfxRAF) { cancelCanvasFrame(vfxRAF); vfxRAF = null; }
      vfxLastRenderAt = 0;
      drawRandomThreeCards();
      playSkillSound('dice');
      draw();
      updateUI();
      persistGameState();
    }

    document.getElementById('btnRestart').onclick = (e) => {
      if (e && e.currentTarget) e.currentTarget.blur();

      if (gameMode === 'online') {
        if (pendingOnlineRestartId) {
          showGameNotice("⏳ 重新开局申请已发送，正在等待对方回应中...", false);
          return;
        }
        if (!conn || !conn.open) {
          showGameNotice("⚠️ 当前联机已中断，直接重置棋盘", true);
          resetBoardOnly();
          return;
        }
        // 🚀 联机模式：点击重开直接向对手发送申请，必须经过对方同意才能重开
        pendingOnlineRestartId = generateSecureId(10, 'restart_');
        if (!conn.send({ type: 'restart_req', name: p1Name, requestId: pendingOnlineRestartId })) {
          pendingOnlineRestartId = '';
          showGameNotice("⚠️ 重开申请发送失败，请检查联机状态后重试", true);
          return;
        }
        showGameNotice("📡 已向对手发送重新开局申请，等待对方同意...", false);
      } else if (gameMode === 'ai') {
        if (history.length > 0 && !isOver) {
          showCustomConfirm("当前正在与大师AI对弈中，确定要重开一局吗？", () => {
            resetBoardOnly();
            showGameNotice("🔄 已重开新对局，大师AI已就绪~", false);
          }, null, { title: '重开对局', icon: '🔄', okText: '确认重开', cancelText: '继续对弈' });
        } else {
          resetBoardOnly();
        }
      } else {
        // 双人同屏对战模式
        resetBoardOnly();
      }
    };

    function restoreSnapshot(snap) {
      if (!snap || !Array.isArray(snap.board) || snap.board.length !== 15 ||
          !Array.isArray(snap.history) || snap.history.length > 512) return false;
      const prevBoard = board.map(r => [...r]);
      const prevCardsUsed = [...cardUsedStatus];

      board = snap.board.map(r => [...r]);
      history = snap.history.map(h => ({ ...h }));
      turn = snap.turn;
      currentDrawnCards = cloneSkillCardState(snap.currentDrawnCards).map(card =>
        card && typeof card.id === 'string'
          ? (SKILL_CARD_POOL.find(localCard => localCard.id === card.id) || card)
          : card
      );
      if (currentDrawnCards.length !== 3) currentDrawnCards = cloneSkillCardState(currentDrawnCards);
      cardUsedStatus = Array.isArray(snap.cardUsedStatus) && snap.cardUsedStatus.length === 3
        ? snap.cardUsedStatus.map(value => value === true)
        : [false, false, false];
      prophecyPoint = snap.prophecyPoint ? { ...snap.prophecyPoint } : null;
      hasExtraMove = snap.hasExtraMove || false;
      consecutiveMovesLeft = snap.consecutiveMovesLeft || 0;
      opponentFreeMove = snap.opponentFreeMove || false;
      opponentSkillsUsedCount = Number.isInteger(snap.opponentSkillsUsedCount)
        ? Math.max(0, Math.min(MAX_OPPONENT_SKILLS_PER_HAND, snap.opponentSkillsUsedCount))
        : 0;
      opponentReforgeUsed = snap.opponentReforgeUsed === true;
      winningLine = null;
      isOver = false;
      gameWinnerColor = 0;
      gameResultIsDraw = false;
      cancelPendingGameResultModal();
      if (typeof closeGameResultModal === 'function') closeGameResultModal();

      activeVFX = [];
      if (typeof vfxRAF !== 'undefined' && vfxRAF) {
        cancelCanvasFrame(vfxRAF);
        vfxRAF = null;
      }
      vfxLastRenderAt = 0;

      // 💫 粒子反馈：检测被撤销的棋子，触发金色倒流粒子动效
      for (let r = 0; r < 15; r++) {
        for (let c = 0; c < 15; c++) {
          if (prevBoard[r][c] !== EMPTY && board[r][c] === EMPTY) {
            triggerUndoVFX(r, c);
          }
        }
      }

      // 🃏 恢复反馈：检测哪些已使用的干扰牌被满血复活
      const restoredIndices = [];
      for (let i = 0; i < 3; i++) {
        if (prevCardsUsed[i] === true && cardUsedStatus[i] === false) {
          restoredIndices.push(i);
        }
      }

      cancelActiveSkill();
      renderCardSlots();
      draw();
      updateUI();
      persistGameState();
      playSkillSound('rewind');

      // 为被恢复的卡牌添加视觉弹跳光晕动效
      if (restoredIndices.length > 0) {
        setTimeout(() => {
          const slots = document.querySelectorAll('.card-slot');
          restoredIndices.forEach(idx => {
            if (slots[idx]) {
              slots[idx].classList.add('restored');
              setTimeout(() => slots[idx] && slots[idx].classList.remove('restored'), 1000);
            }
          });
        }, 60);
        showGameNotice(`↩️ 悔棋成功！已连同本回合使用的 ${restoredIndices.length} 张干扰牌一并满血恢复！`, false);
      } else {
        showGameNotice("↩️ 悔棋成功！已撤回上一步落子", false);
      }
      return true;
    }

    function doUndo() {
      if (undoStack.length === 0 && history.length === 0) return false;
      const wasGameOver = isOver;

      let undoSuccess = false;
      // 🚀 优先使用高精度全息快照恢复（完美还原棋盘 + 干扰牌 + 技能全部状态）
      if (undoStack.length > 0) {
        let targetSnap = null;

        // 1. 如果当前栈顶直接是刚刚单独发动的技能牌（尚未落子），直接撤销该技能牌与棋盘变化
        if (undoStack[undoStack.length - 1].type === 'skill') {
          targetSnap = undoStack.pop();
          undoSuccess = restoreSnapshot(targetSnap);
        } else if (gameMode === 'ai') {
          // 🤖 人机模式：撤销一整轮（包括：AI的一手落子 + 玩家的一手落子 + 玩家本回合使用的所有干扰牌）
          while (undoStack.length > 0 && (undoStack[undoStack.length - 1].turn === WHITE || undoStack[undoStack.length - 1].p === WHITE)) {
            undoStack.pop();
          }
          while (undoStack.length > 0) {
            targetSnap = undoStack.pop();
            const next = undoStack[undoStack.length - 1];
            if (!next) break;
            if (next.turn === WHITE || next.p === WHITE) break;
          }
          if (targetSnap) undoSuccess = restoreSnapshot(targetSnap);
        } else {
          // 👥 双人同屏或联机模式：撤销最后这一手（含伴随发动的技能牌）
          if (undoStack.length > 0) {
            targetSnap = undoStack.pop();
          }
          while (undoStack.length > 0 && undoStack[undoStack.length - 1].type === 'skill') {
            targetSnap = undoStack.pop();
          }
          if (targetSnap) undoSuccess = restoreSnapshot(targetSnap);
        }
      }

      if (!undoSuccess) {
        // 兜底降级处理（防旧局数据无 undoStack 时的兼容）
        winningLine = null;
        isOver = false;
        gameWinnerColor = 0;
        gameResultIsDraw = false;
        cancelPendingGameResultModal();
        if (typeof closeGameResultModal === 'function') closeGameResultModal();
        const last = history[history.length - 1];
        if (last && last.action === 'identity_swap') {
          history.pop();
          for (let r = 0; r < 15; r++) for (let c = 0; c < 15; c++) {
            if (board[r][c] === BLACK) board[r][c] = WHITE;
            else if (board[r][c] === WHITE) board[r][c] = BLACK;
          }
          playSkillSound('rewind');
          draw(); updateUI();
          persistGameState();
          undoSuccess = true;
        } else if (last && (last.action === 'mega_bomb' || last.type === 'skill_mega_bomb')) {
          history.pop();
          for (let r = 0; r < 15; r++) for (let c = 0; c < 15; c++) board[r][c] = EMPTY;
          if (Array.isArray(last.prevStones)) {
            for (const s of last.prevStones) board[s.r][s.c] = s.p;
          }
          playSkillSound('rewind');
          draw(); updateUI();
          persistGameState();
          undoSuccess = true;
        } else if (last && (last.action === 'remove_stone' || last.type === 'skill_remove_stone')) {
          history.pop();
          if (last.r >= 0 && last.r < 15 && last.c >= 0 && last.c < 15) {
            board[last.r][last.c] = last.p;
            triggerUndoVFX(last.r, last.c);
          }
          playSkillSound('rewind');
          draw(); updateUI();
          persistGameState();
          undoSuccess = true;
        } else if (last && (last.action === 'destiny_wipe_danger' || last.type === 'destiny_wipe_danger')) {
          history.pop();
          if (Array.isArray(last.stones)) {
            for (const s of last.stones) {
              board[s.r][s.c] = s.p !== undefined ? s.p : (last.p === BLACK ? WHITE : BLACK);
              triggerUndoVFX(s.r, s.c);
            }
          }
          playSkillSound('rewind');
          draw(); updateUI();
          persistGameState();
          undoSuccess = true;
        } else if (last && (last.action === 'shift_stone' || last.type === 'skill_shift_stone')) {
          history.pop();
          if (last.toR >= 0 && last.toR < 15 && last.toC >= 0 && last.toC < 15) {
            board[last.toR][last.toC] = EMPTY;
          }
          if (last.fromR >= 0 && last.fromR < 15 && last.fromC >= 0 && last.fromC < 15) {
            board[last.fromR][last.fromC] = last.p;
            triggerUndoVFX(last.fromR, last.fromC);
          }
          playSkillSound('rewind');
          draw(); updateUI();
          persistGameState();
          undoSuccess = true;
        } else if (last && (last.action === 'swap_color' || last.type === 'skill_swap_color')) {
          history.pop();
          if (last.r >= 0 && last.r < 15 && last.c >= 0 && last.c < 15) {
            board[last.r][last.c] = last.fromP !== undefined ? last.fromP : (last.p === BLACK ? WHITE : BLACK);
            triggerUndoVFX(last.r, last.c);
          }
          playSkillSound('rewind');
          draw(); updateUI();
          persistGameState();
          undoSuccess = true;
        } else if (last && (last.action === 'swap_positions' || last.type === 'skill_swap_positions')) {
          history.pop();
          if (last.r1 >= 0 && last.r1 < 15 && last.c1 >= 0 && last.c1 < 15 && last.r2 >= 0 && last.r2 < 15 && last.c2 >= 0 && last.c2 < 15) {
            board[last.r1][last.c1] = last.p2;
            board[last.r2][last.c2] = last.p1;
          }
          playSkillSound('rewind');
          draw(); updateUI();
          persistGameState();
          undoSuccess = true;
        } else if (gameMode === 'ai' && history.length >= 2) {
          const a = history.pop(); const b = history.pop();
          if (a && a.r >= 0 && a.c >= 0) { board[a.r][a.c] = EMPTY; triggerUndoVFX(a.r, a.c); }
          if (b && b.r >= 0 && b.c >= 0) { board[b.r][b.c] = EMPTY; triggerUndoVFX(b.r, b.c); }
          playSkillSound('rewind');
          turn = BLACK;
          undoSuccess = true;
        } else {
          const lastMove = history.pop();
          if (lastMove && lastMove.r >= 0 && lastMove.c >= 0) {
            board[lastMove.r][lastMove.c] = EMPTY;
            triggerUndoVFX(lastMove.r, lastMove.c);
          }
          playSkillSound('rewind');
          turn = lastMove ? (lastMove.p || (turn === BLACK ? WHITE : BLACK)) : turn;
          undoSuccess = true;
        }
        draw(); updateUI();
        persistGameState();
      }

      if (undoSuccess && wasGameOver) {
        const wasCommitted = pendingRecordCommitted;
        discardPendingMatchRecord();
        aiTurnSeq++;
        aiThinking = false;
        activeSkill = null;
        isOver = false;
        gameWinnerColor = 0;
        gameResultIsDraw = false;
        winningLine = null;
        if (wasCommitted) {
          try {
            const key = getHistoryStorageKey();
            const list = JSON.parse(localStorage.getItem(key) || "[]");
            if (list.length > 0) {
              const popped = list.shift();
              localStorage.setItem(key, JSON.stringify(list));
              updateHistoryCountUI();
              if (!hasRegisteredAccountSession() && popped) {
                rollbackLocalResult(popped.isWin, popped.isDraw);
              }
            }
          } catch(e) {}
          if (activeMatchStartingScore != null) {
            currentUserScore = activeMatchStartingScore;
            localStorage.setItem('gomoku_user_score', currentUserScore);
            updateLadderBadgeUI(currentUserScore);
          }
        }
        activeMatchResultScore = null;
        activeMatchStartingScore = null;
        cancelPendingGameResultModal();
        closeGameResultModal();
        const skillBanner = document.getElementById('skillBanner');
        if (skillBanner) skillBanner.classList.remove('show');
        const skillPromptBar = document.getElementById('skillPromptBar');
        if (skillPromptBar) skillPromptBar.style.display = 'none';
        draw(); updateUI(); persistGameState();
      }

      return undoSuccess;
    }

    const undoModal = document.getElementById('undoModal');
    const undoDescText = document.getElementById('undoDescText');

    document.getElementById('btnUndo').onclick = () => {
      if (history.length === 0 && undoStack.length === 0) {
        showGameNotice("棋盘上还没有棋子，无需悔棋~", false);
        return;
      }

      if (gameMode === 'ai') {
        let hasCardToRestore = false;
        if (undoStack.length > 0) {
          for (let i = undoStack.length - 1; i >= 0; i--) {
            if (undoStack[i].type === 'skill' || undoStack[i].cardUsedStatus.some((s, idx) => s !== cardUsedStatus[idx])) {
              hasCardToRestore = true;
              break;
            }
            if (undoStack[i].turn === BLACK) break;
          }
        }
        if (isOver) {
          undoDescText.textContent = "已达成五子连珠，向大师AI申请撤回决胜落子继续对局？";
        } else if (hasCardToRestore) {
          undoDescText.textContent = "正在向大师AI申请悔棋，将连同本回合使用的干扰牌一并满血恢复！";
        } else {
          undoDescText.textContent = "正在向大师AI申请悔棋一步...";
        }
        undoModal.classList.add('show');
        document.getElementById('btnUndoAgree').textContent = "确认悔棋";
        document.getElementById('btnUndoRefuse').style.display = "none";
      } else if (gameMode === 'online') {
        if (!conn || !conn.open) {
          showGameNotice("⚠️ 联机连接未就绪或已断开，无法申请悔棋！", true);
          return;
        }
        if (pendingOnlineUndoId) {
          showGameNotice("⏳ 悔棋申请正在等待对方回应中，请稍候...", false);
          return;
        }
        pendingOnlineUndoId = generateSecureId(10, 'undo_');
        if (!conn.send({ type: 'undo_req', requestId: pendingOnlineUndoId, wasOver: isOver })) {
          pendingOnlineUndoId = '';
          showGameNotice("⚠️ 悔棋申请发送失败，请检查联机状态后重试", true);
          return;
        }
        showGameNotice(isOver ? "📡 已向联机好友发送终局悔棋申请，等待对方同意..." : "📡 已向联机好友发送悔棋申请，等待对方同意...", false);
      } else {
        const applicant = turn === BLACK ? `${p2Name} (白方)` : `${p1Name} (黑方)`;
        if (isOver) {
          undoDescText.textContent = `对局已结束，【${applicant}】请求撤回决胜落子继续对战，是否同意？`;
        } else {
          undoDescText.textContent = `【${applicant}】请求悔棋一步（含使用的干扰牌），是否同意？`;
        }
        document.getElementById('btnUndoAgree').textContent = "✅ 同意悔棋";
        document.getElementById('btnUndoRefuse').style.display = "block";
        undoModal.classList.add('show');
      }
    };

    document.getElementById('btnUndoAgree').onclick = () => {
      undoModal.classList.remove('show');
      const acceptedUndoId = activeOnlineUndoId;
      activeOnlineUndoId = '';
      const undoApplied = doUndo();
      if (gameMode === 'online' && conn && conn.open) {
        if (!undoApplied) {
          conn.send({ type: 'undo_res', agree: false, requestId: acceptedUndoId });
        } else {
          // 双方手牌是私有状态，只同步悔棋后的公共棋盘；对端会用自己的快照恢复自己的干扰牌。
          conn.send({
            type: 'undo_res',
            agree: true,
            requestId: acceptedUndoId,
            board: board.map(row => [...row]),
            history: history.map(step => ({ ...step })),
            turn
          });
        }
      }
    };

    document.getElementById('btnUndoRefuse').onclick = () => {
      undoModal.classList.remove('show');
      const refusedUndoId = activeOnlineUndoId;
      activeOnlineUndoId = '';
      if (gameMode === 'online' && conn && conn.open) {
        conn.send({ type: 'undo_res', agree: false, requestId: refusedUndoId });
      } else {
        showGameNotice("❌ 已拒绝悔棋申请，落子无悔哦~", true);
      }
    };

    function closeUndoModal() {
      if (undoModal) {
        undoModal.classList.remove('show');
        undoModal.style.display = 'none';
      }
    }

    // ==========================================
    // 💬 快捷短语管理系统 (支持自定义、本地记忆与左右拖拽滑动)
    // ==========================================
    const DEFAULT_PHRASES = [
      "快点吧，等得我花都谢了~ 🌸",
      "手滑了手滑了，让我悔一步嘛 🥺",
      "哇！这步棋走得好绝啊！✨",
      "哈哈，这局我赢定啦！😎",
      "落子无悔，大丈夫一言九鼎！🤠",
      "承让承让，承蒙关照啦~ 🎉",
      "棋逢对手，打得精彩！👏",
      "静心以待，后手发力！🍵"
    ];

    let customPhrases = [];
    try {
      const saved = localStorage.getItem('gomoku_custom_phrases');
      customPhrases = saved ? JSON.parse(saved) : [...DEFAULT_PHRASES];
    } catch (e) {
      customPhrases = [...DEFAULT_PHRASES];
    }
    if (!Array.isArray(customPhrases)) customPhrases = [...DEFAULT_PHRASES];
    customPhrases = customPhrases
      .filter(p => typeof p === 'string')
      .map(p => p.trim().slice(0, 80))
      .filter(Boolean)
      .slice(0, 30);
    if (customPhrases.length === 0) customPhrases = [...DEFAULT_PHRASES];

    function savePhrases() {
      try {
        localStorage.setItem('gomoku_custom_phrases', JSON.stringify(customPhrases));
      } catch (e) {
        console.warn('保存快捷短语异常:', e);
      }
    }

    function renderQuickPhrases() {
      const container = document.getElementById('quickPhrasesContainer');
      if (!container) return;
      let html = `<div class="phrase-chip-manage" onclick="openPhraseManageModal()">⚙️ 自定义</div>`;
      html += customPhrases.map((phrase) => `
        <div class="phrase-chip" data-phrase="${escapeHtml(phrase)}">${escapeHtml(phrase)}</div>
      `).join('');
      container.innerHTML = html;
      container.querySelectorAll('.phrase-chip').forEach(el => {
        el.onclick = () => sendChat(el.getAttribute('data-phrase') || '');
      });
    }

    function openPhraseManageModal() {
      const proxy = openPhraseManageModal;
      return window.ensureGomokuFeature('settings').then(() => {
        if (window.openPhraseManageModal === proxy) throw new Error('设置模块加载后未注册');
        return window.openPhraseManageModal();
      }).catch(error => showGameNotice(error.message || '快捷短语设置加载失败', true));
    }

    // 通用丝滑鼠标水平拖拽滑动 (解决桌面端鼠标拖动与移动端滑动手感)
    function enableHorizontalDrag(el) {
      if (!el) return;
      let isDown = false, startX, scrollLeft;
      el.addEventListener('mousedown', (e) => {
        isDown = true;
        startX = e.pageX - el.offsetLeft;
        scrollLeft = el.scrollLeft;
      });
      el.addEventListener('mouseleave', () => { isDown = false; });
      el.addEventListener('mouseup', () => { isDown = false; });
      el.addEventListener('mousemove', (e) => {
        if (!isDown) return;
        e.preventDefault();
        const x = e.pageX - el.offsetLeft;
        const walk = (x - startX) * 1.5;
        el.scrollLeft = scrollLeft - walk;
      });
    }

    // ==========================================
    // 💾 棋局状态跨页面互通保全 (对局不丢失，切换无忧，划掉后台自动恢复)
    // ==========================================
    function persistGameState() {
      try {
        const state = {
          board, history, turn, stepCount: history.length, isOver, winnerColor: gameWinnerColor, isDraw: gameResultIsDraw, gameMode,
          p1Name, p2Name, p1Avatar, p2Avatar,
          currentDrawnCards, cardUsedStatus,
          opponentSkillsUsedCount, opponentReforgeUsed,
          undoStack: undoStack.slice(-30)
        };
        sessionStorage.setItem('gomoku_active_game_state', JSON.stringify(state));

        // 💾 针对划掉后台/杀进程的永久保全 (有效期 5 分钟)
        if (gameMode === 'online' && !isOver && currentRoomCode) {
          const session = {
            roomCode: currentRoomCode,
            myColor: myOnlineColor,
            myRole: myOnlineColor === BLACK ? 'host' : 'client',
            // 页面被系统回收后必须沿用原房间身份。只恢复房号会生成新的
            // sessionId，仍在线的对端会按安全校验拒绝它，造成同房号两套会话。
            sessionId: onlineSessionId,
            joinTicket: onlineJoinTicket,
            activeGuestUid: activeOnlineGuestUid,
            roundId: onlineRoundId,
            p1Name, p1Avatar, p2Name, p2Avatar,
            board, history, turn, winnerColor: gameWinnerColor,
            isDraw: gameResultIsDraw,
            currentDrawnCards, cardUsedStatus,
            opponentSkillsUsedCount, opponentReforgeUsed,
            undoStack: undoStack.slice(-30),
            timestamp: Date.now()
          };
          localStorage.setItem('gomoku_active_online_room', JSON.stringify(session));
        } else {
          localStorage.removeItem('gomoku_active_online_room');
        }
      } catch(e) {}
    }

    function restoreGameStateIfAny() {
      // 1. 优先检测是否刚刚在联机对局中被系统杀后台或划掉后台
      try {
        const rawOnline = localStorage.getItem('gomoku_active_online_room');
        if (rawOnline) {
          const session = JSON.parse(rawOnline);
          if (session && session.roomCode && (Date.now() - session.timestamp < 300000)) {
            console.info('检测到刚刚有一局未完成的联机对战，自动恢复房间:', session.roomCode);
            currentRoomCode = session.roomCode;
            lastActiveRoomCode = session.roomCode;
            myOnlineColor = session.myColor;
            onlineSessionId = typeof session.sessionId === 'string' && session.sessionId.length <= 96
              ? session.sessionId : '';
            onlineJoinTicket = typeof session.joinTicket === 'string' && session.joinTicket.length <= 96
              ? session.joinTicket : '';
            activeOnlineGuestUid = typeof session.activeGuestUid === 'string' && session.activeGuestUid.length <= 128
              ? session.activeGuestUid : '';
            onlineRoundId = typeof session.roundId === 'string' ? session.roundId : onlineRoundId;
            p1Name = session.p1Name || p1Name;
            p1Avatar = session.p1Avatar || p1Avatar;
            p2Name = session.p2Name || '好友';
            p2Avatar = session.p2Avatar || '👧';
            if (session.board) board = session.board;
            if (session.history) history = session.history;
            if (session.turn) turn = session.turn;
            if (session.currentDrawnCards) currentDrawnCards = session.currentDrawnCards;
            if (session.cardUsedStatus) cardUsedStatus = session.cardUsedStatus;
            gameResultIsDraw = session.isDraw === true;
            gameWinnerColor = session.winnerColor === BLACK || session.winnerColor === WHITE ? session.winnerColor : 0;
            opponentSkillsUsedCount = Number.isInteger(session.opponentSkillsUsedCount) ? session.opponentSkillsUsedCount : 0;
            opponentReforgeUsed = session.opponentReforgeUsed === true;
            if (Array.isArray(session.undoStack)) undoStack = session.undoStack;
            gameMode = 'online';

            setTimeout(() => {
              showGameNotice(`🔄 检测到您刚退出后台，正在自动重连回房间【${session.roomCode}】...`, false);
              triggerOnlineReconnect("划掉后台恢复");
            }, 800);
            return;
          } else {
            localStorage.removeItem('gomoku_active_online_room');
          }
        }
      } catch(e) {}

      // 2. 常规 session 恢复
      try {
        const raw = sessionStorage.getItem('gomoku_active_game_state');
        if (raw) {
          const s = JSON.parse(raw);
          if (s.board && s.history && s.history.length > 0 && !s.isOver) {
            board = s.board;
            history = s.history;
            turn = s.turn;
            isOver = s.isOver || false;
            gameWinnerColor = s.winnerColor === BLACK || s.winnerColor === WHITE ? s.winnerColor : 0;
            gameResultIsDraw = s.isDraw === true;
            opponentSkillsUsedCount = Number.isInteger(s.opponentSkillsUsedCount) ? s.opponentSkillsUsedCount : 0;
            opponentReforgeUsed = s.opponentReforgeUsed === true;
            if (s.currentDrawnCards) currentDrawnCards = s.currentDrawnCards;
            if (s.cardUsedStatus) cardUsedStatus = s.cardUsedStatus;
            if (Array.isArray(s.undoStack)) undoStack = s.undoStack;
            if (s.gameMode) gameMode = s.gameMode;
            if (gameMode === 'ai' && turn === WHITE && !isOver) {
              setTimeout(smartAiMove, 300);
            }
          }
        }
      } catch(e) {}
    }

    let boardResizeFrame = null;
    let boardSurfaceReady = false;
    function scheduleBoardResize() {
      if (boardResizeFrame !== null) return;
      const raf = window.requestAnimationFrame || (fn => setTimeout(fn, 16));
      boardResizeFrame = raf(() => {
        boardResizeFrame = null;
        resizeBoard();
      });
    }
    // 浏览器拖动窗口/手机旋转时可能连续触发几十次 resize，合并到下一帧避免重复重建棋盘缓存。
    window.addEventListener('resize', scheduleBoardResize, { passive: true });
    window.addEventListener('orientationchange', () => setTimeout(scheduleBoardResize, 150), { passive: true });

    window.__gomokuTrimMemory = function(level = 0) {
      const pressure = Number(level) || 0;
      if (vfxRAF) cancelCanvasFrame(vfxRAF);
      vfxRAF = null;
      vfxLastRenderAt = 0;
      activeVFX = [];
      cachedBoardCanvas = null;
      cachedPiecesCanvas = null;
      cachedBoardKey = '';
      cachedPiecesKey = '';
      if (pressure >= 60 && !aiThinking) disposeAiWorker('系统内存回收');
    };
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        void flushGomokuMetrics();
        window.__gomokuTrimMemory(20);
      } else {
        updateGraphicsQualityUI();
        if (boardSurfaceReady) scheduleBoardResize();
        if (window.GomokuSocial?.resume) window.GomokuSocial.resume();
      }
    });

    function markBoardInteractive() {
      requestAnimationFrame(() => {
        try { performance.mark('gomoku_interactive'); } catch (_) {}
        setTimeout(() => {
          try {
            const navigation = performance.getEntriesByType('navigation')[0];
            const paint = performance.getEntriesByName('first-contentful-paint')[0];
            const boardReady = performance.getEntriesByName('gomoku_board_ready')[0];
            const interactive = performance.getEntriesByName('gomoku_interactive')[0];
            if (paint) window.recordGomokuMetric('fcp', paint.startTime);
            if (navigation) window.recordGomokuMetric('dcl', navigation.domContentLoadedEventEnd - navigation.startTime);
            if (boardReady) window.recordGomokuMetric('board_ready', boardReady.startTime);
            if (interactive) window.recordGomokuMetric('interactive', interactive.startTime);
            window.recordGomokuMetric('graphics_quality', 1, { bucket: getEffectiveGraphicsTier() });
          } catch (_) {}
        }, 800);
      });
    }

    // 首页现在先展示天空棋岛大厅；在大厅阶段不要为隐藏的旧棋盘做完整
    // Canvas 初始化。真正进入标准对局时再初始化，避免首屏主线程被无效绘制占用。
    function ensureBoardSurface() {
      if (boardSurfaceReady) return true;
      updateGraphicsQualityUI();
      resizeBoard();
      boardSurfaceReady = true;
      try { performance.mark('gomoku_board_ready'); } catch (_) {}
      markBoardInteractive();
      // The playable canvas is ready before the optional chat chips and skill
      // tray are rebuilt.  Those two DOM renderers can be relatively costly on
      // a 4x-throttled WebView, so schedule them after the first interactive
      // frame instead of making the player wait for decorative controls.
      const raf = window.requestAnimationFrame || (fn => setTimeout(fn, 0));
      raf(() => {
        renderQuickPhrases();
        drawRandomThreeCards();
        updateUI();
      });
      return true;
    }
    window.__gomokuEnsureBoardReady = ensureBoardSurface;

    // 初始化：只锁定官方视觉，不覆盖大厅/棋局等页面状态 class。
    activeThemeKey = 'default';
    restoreGameStateIfAny();
    updateGraphicsQualityUI();
    if (!window.SkyIslandUI) ensureBoardSurface();

    // 启用水平拖拽滑动
    enableHorizontalDrag(document.getElementById('quickPhrasesContainer'));
    enableHorizontalDrag(document.querySelector('.emoji-row'));

    // 🚀 Cloudflare Worker 私有仓库更新中转
        // 📜 当前版本官方更新内容说明（用于开机公告、弹窗展示与日志回顾）
    const CURRENT_UPDATE_NOTES = [
      "👥 【完整好友系统】支持精确账号查找、好友申请、在线状态、最近对手、删除与黑名单管理",
      "💬 【实时私聊】好友间支持文字、Emoji、快捷短语、未读同步、历史分页和个人清空",
      "🎮 【好友邀战】一键创建 2 分钟有效房间邀请，接受后自动进房，P2P 失败仍可靠中继",
      "⚡ 【首屏性能升级】核心、联机、社交、排行榜、复盘和设置按需拆包，4× CPU 冷启动中位交互约 2.01 秒",
      "🎨 【智能画质】新增自动/高清/流畅档，依据设备能力选择 Canvas 清晰度并降低弱机发热",
      "📡 【联机质量】并行探测官方入口、缓存近期较快线路，断线按 0/1/2/4/8/12 秒自动恢复",
      "🛡️ 【社交安全】短时一次性 WebSocket 票据、消息幂等、精确搜索、防枚举和全链路拉黑校验",
      "📊 【匿名质量统计】仅采样上传性能区间、画质、入口、链路类型和重连结果，可随时关闭"
    ];
    try {
      const verEl = document.getElementById('appVersionDisplay');
      if (verEl) verEl.textContent = DISPLAY_VERSION_TAG;
    } catch(e) {}
    const UPDATE_PROXY_ORIGIN = 'https://gomoku-api.pages.dev';
    const UPDATE_API_URL = `${UPDATE_PROXY_ORIGIN}/api/version`;
    const UPDATE_PROXY_APK_PATH = '/api/update/apk';
    const UPDATE_PROXY_HTML_PATH = '/api/update/html';
    const UPDATE_PROXY_APK_URL = `${UPDATE_PROXY_ORIGIN}${UPDATE_PROXY_APK_PATH}`;
    const UPDATE_PROXY_HTML_URL = `${UPDATE_PROXY_ORIGIN}${UPDATE_PROXY_HTML_PATH}`;
    const UPDATE_CLIENT_HEADER = 'X-Gomoku-Client';
    const UPDATE_CLIENT_VALUE = 'gomoku-app-client-v2';
    const UPDATE_TICKET_HEADER = 'X-Gomoku-Update-Ticket';
    // 版本清单只读公开的中转接口，不携带客户端专属请求头，避免 Android WebView 先发 CORS 预检。
    // 下载 APK/HTML 时仍保留专属请求头和短时票据，不能为了提速而放宽文件保护。
    const UPDATE_MANIFEST_TIMEOUTS_MS = [8500, 5000];

    function isTrustedUpdatePath(value, expectedPath) {
      return String(value || '').trim() === expectedPath;
    }

    function getUpdateHeaders(ticket = '') {
      const headers = { [UPDATE_CLIENT_HEADER]: UPDATE_CLIENT_VALUE };
      if (ticket) headers[UPDATE_TICKET_HEADER] = ticket;
      return headers;
    }

    async function downloadProtectedApk(url, ticket) {
      if (url !== UPDATE_PROXY_APK_URL || !ticket) throw new Error('更新下载授权无效');
      const response = await fetch(url, {
        cache: 'no-store',
        headers: getUpdateHeaders(ticket)
      });
      if (!response.ok) throw new Error('更新文件接口不可用');
      const declaredLength = Number(response.headers.get('content-length') || 0);
      if (declaredLength > 50 * 1024 * 1024) throw new Error('更新文件超过大小限制');
      const blob = await response.blob();
      if (blob.size < 500000 || blob.size > 50 * 1024 * 1024) throw new Error('更新文件大小异常');
      const objectUrl = URL.createObjectURL(blob);
      try {
        const anchor = document.createElement('a');
        anchor.href = objectUrl;
        anchor.download = 'gomoku_latest.apk';
        anchor.rel = 'noopener';
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
      } finally {
        setTimeout(() => URL.revokeObjectURL(objectUrl), 1500);
      }
    }

    function invokeProtectedNativeApkUpdate(ticket) {
      if (typeof AndroidNativeApp === 'undefined' || !ticket) return false;
      if (typeof AndroidNativeApp.downloadAndInstallApkWithTicket !== 'function') return false;
      AndroidNativeApp.downloadAndInstallApkWithTicket(ticket);
      return true;
    }

    async function sha256Hex(value) {
      if (!window.crypto || !window.crypto.subtle) throw new Error('当前环境不支持更新完整性校验');
      const bytes = new TextEncoder().encode(value);
      const digest = await window.crypto.subtle.digest('SHA-256', bytes);
      return Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, '0')).join('');
    }

    async function readLimitedResponseText(response, maxBytes) {
      const declaredLength = Number(response.headers.get('content-length') || 0);
      if (declaredLength > maxBytes) throw new Error('更新文件超过大小限制');
      if (!response.body || typeof response.body.getReader !== 'function') {
        const text = await response.text();
        if (new TextEncoder().encode(text).byteLength > maxBytes) throw new Error('更新文件超过大小限制');
        return text;
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let total = 0;
      let text = '';
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          total += chunk.value.byteLength;
          if (total > maxBytes) {
            try { await reader.cancel(); } catch (_) {}
            throw new Error('更新文件超过大小限制');
          }
          text += decoder.decode(chunk.value, { stream: true });
        }
        return text + decoder.decode();
      } finally {
        try { reader.releaseLock(); } catch (_) {}
      }
    }

    function compareVersions(v1, v2) {
      const p1 = (v1 || '').replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);
      const p2 = (v2 || '').replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);
      for (let i = 0; i < Math.max(p1.length, p2.length); i++) {
        const num1 = p1[i] || 0;
        const num2 = p2[i] || 0;
        if (num1 > num2) return 1;
        if (num1 < num2) return -1;
      }
      return 0;
    }

    function normalizeUpdateManifest(data) {
      const releaseTag = String(data && data.tag || '').trim();
      if (!data || Number(data.code) !== 0 || !/^v\d+\.\d+\.\d+$/.test(releaseTag)) {
        throw new Error('更新清单响应无效');
      }
      return {
        tag: releaseTag,
        notes: data.updateLog || "修复已知问题，优化联机体验与显示",
        fastUrl: isTrustedUpdatePath(data.apkPath, UPDATE_PROXY_APK_PATH) ? UPDATE_PROXY_APK_URL : '',
        htmlUrl: isTrustedUpdatePath(data.htmlPath, UPDATE_PROXY_HTML_PATH) ? UPDATE_PROXY_HTML_URL : '',
        apkTicket: String(data.apkTicket || '').trim(),
        htmlTicket: String(data.htmlTicket || '').trim(),
        htmlSha256: /^[0-9a-f]{64}$/i.test(String(data.htmlSha256 || '')) ? String(data.htmlSha256).toLowerCase() : ''
      };
    }

    async function fetchUpdateManifest() {
      let lastError = null;
      for (let attempt = 0; attempt < UPDATE_MANIFEST_TIMEOUTS_MS.length; attempt++) {
        let controller = null;
        let timeoutId = null;
        try {
          // 时间戳避免手机 WebView/中间缓存返回旧清单；GET 不附带 X-Gomoku-Client，因此不会触发预检。
          const separator = UPDATE_API_URL.includes('?') ? '&' : '?';
          const manifestUrl = `${UPDATE_API_URL}${separator}_t=${Date.now()}&attempt=${attempt}`;
          const requestOptions = {
            method: 'GET',
            mode: 'cors',
            credentials: 'omit',
            cache: 'no-store'
          };
          if (typeof AbortController === 'function') {
            controller = new AbortController();
            timeoutId = setTimeout(() => controller.abort(), UPDATE_MANIFEST_TIMEOUTS_MS[attempt]);
            requestOptions.signal = controller.signal;
          }
          const response = await fetch(manifestUrl, requestOptions);
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          return normalizeUpdateManifest(await response.json());
        } catch (error) {
          lastError = error;
          if (attempt + 1 < UPDATE_MANIFEST_TIMEOUTS_MS.length) continue;
        } finally {
          if (timeoutId) clearTimeout(timeoutId);
        }
      }
      throw lastError || new Error('更新清单不可用');
    }

    let isCheckingAppUpdate = false;
    let isAppDownloading = false;

    // 原生下载进度实时通知
        window.onApkDownloadProgress = function(percent, status) {
      const btn = document.getElementById('btnFastDownload');
      const progressWrap = document.getElementById('updateProgressBarWrap');
      const progressInner = document.getElementById('updateProgressBarInner');
      const progressPercent = document.getElementById('updateProgressPercentText');
      const progressStatus = document.getElementById('updateProgressStatusText');

      if (progressWrap) progressWrap.style.display = 'block';

      if (status === 'done' || percent >= 100) {
        isAppDownloading = false;
        if (progressInner) progressInner.style.width = '100%';
        if (progressPercent) progressPercent.textContent = '100%';
        if (progressStatus) progressStatus.textContent = '✅ 下载完成，正在调起安装...';
        if (btn) btn.innerHTML = '<span>✅ 下载完成，请在手机上确认安装</span>';
        setTimeout(() => closeUpdateModal(), 2500);
      } else if (percent > 0) {
        isAppDownloading = true;
        if (progressInner) progressInner.style.width = percent + '%';
        if (progressPercent) progressPercent.textContent = percent + '%';
        if (progressStatus) progressStatus.textContent = `🚀 正在下载安装包... ${percent}%`;
        if (btn) btn.innerHTML = `<span>⏳ 正在全自动极速下载 (${percent}%)...</span>`;
      }
    };

    async function checkAppUpdate(isManual = false) {
      if (isAppDownloading) {
        if (isManual) showGameNotice('🚀 正在全自动下载最新安装包中，请稍候...');
        return;
      }
      if (isCheckingAppUpdate) return;
      isCheckingAppUpdate = true;

      if (isManual) {
        showGameNotice('🔍 正在连接官方云端检查最新更新...');
      }

      let versionData = null;

      // 0. 版本清单走无预检 GET；首次冷启动较慢时自动重试一次，避免旧版常见的静默漏检。
      try {
        versionData = await fetchUpdateManifest();
      } catch(error) {
        console.warn('[UpdateCheck] 无法获取版本清单:', error?.message || error);
      }

      isCheckingAppUpdate = false;

      // 检查当前应用版本
      // 当前加载的 HTML 才是实际运行版本；旧版遗留的本地标记不能把新版本误判为已安装。
      const effectiveVersion = CURRENT_VERSION_TAG;
      const hasNewVersion = versionData ? (compareVersions(versionData.tag, effectiveVersion) > 0) : false;

      // 静默后台检查分支：有新版本仅做静默提示
      if (!isManual) {
        if (hasNewVersion && versionData) {
          const sessKey = "notified_update_" + versionData.tag;
          if (!sessionStorage.getItem(sessKey)) {
            sessionStorage.setItem(sessKey, "1");
            showGameNotice(`🔔 发现新版本 ${formatDisplayVersionTag(versionData.tag)}，可随时在个人中心点击更新`, false);
          }
          const versionEl = document.getElementById('appVersionDisplay');
          if (versionEl) {
            versionEl.textContent = `有新版本 ${formatDisplayVersionTag(versionData.tag)}`;
            versionEl.title = `发现 ${formatDisplayVersionTag(versionData.tag)}，点击检查更新`;
          }
        }
        return;
      }

      // 手动检查分支：展示清晰美观的确认弹窗
      const updateModal = document.getElementById("appUpdateModal");
      const modalIcon = document.getElementById("updateModalIcon");
      const modalTitle = document.getElementById("updateModalTitle");
      const tagEl = document.getElementById("updateTagText");
      const notesTitle = document.getElementById("updateNotesTitle");
      const notesEl = document.getElementById("updateNotesContent");
      const btnFast = document.getElementById("btnFastDownload");
      const btnCancel = document.getElementById("btnUpdateCancel");
      const progressWrap = document.getElementById("updateProgressBarWrap");
      const progressInner = document.getElementById("updateProgressBarInner");
      const progressPercent = document.getElementById("updateProgressPercentText");
      const progressStatus = document.getElementById("updateProgressStatusText");

      if (progressWrap) progressWrap.style.display = "none";

      const setVisualProgress = (pct, text) => {
        if (progressWrap) progressWrap.style.display = "block";
        if (progressInner) progressInner.style.width = pct + "%";
        if (progressPercent) progressPercent.textContent = pct + "%";
        if (progressStatus) progressStatus.textContent = text;
      };

      if (!versionData) {
        // 网络超时/异常兜底展示
        if (modalIcon) modalIcon.textContent = "📶";
        if (modalTitle) modalTitle.textContent = "暂时无法检查更新";
        if (tagEl) {
          tagEl.textContent = `${effectiveVersion} (当前运行版本)`;
          tagEl.style.background = "#f1f5f9";
          tagEl.style.color = "#475569";
        }
        if (notesTitle) notesTitle.textContent = "运行状态：";
        if (notesEl) notesEl.textContent = `暂时无法连接官方更新服务，无法确认是否有新版本。\n\n请检查网络后点击下方按钮重试；这不会影响当前版本 (${effectiveVersion}) 的正常对弈。`;
        if (btnFast) {
          btnFast.style.display = "flex";
          btnFast.innerHTML = "<span>🔄 重新尝试获取更新</span>";
          btnFast.onclick = (e) => {
            e.preventDefault();
            checkAppUpdate(true);
          };
        }
        if (btnCancel) {
          btnCancel.textContent = "关闭";
          btnCancel.style.background = "#f1f5f9";
          btnCancel.style.color = "#64748b";
          btnCancel.style.padding = "8px 0";
        }
        showGameNotice('暂时无法获取更新，请检查网络后重试', true);
        openUpdateModal();
        return;
      }

      const fastLink = versionData.fastUrl || '';
      const htmlLink = versionData.htmlUrl || '';
      const hasUpdateTickets = Boolean(versionData.apkTicket && versionData.htmlTicket);

      if (hasNewVersion) {
        // 发现新版本！
        if (modalIcon) modalIcon.textContent = "🚀";
        if (modalTitle) modalTitle.textContent = "发现新版本！";
        if (tagEl) {
          tagEl.textContent = `${DISPLAY_VERSION_TAG} ➔ ${formatDisplayVersionTag(versionData.tag)}`;
          tagEl.style.background = "#e0f2fe";
          tagEl.style.color = "#0369a1";
        }
        if (notesTitle) notesTitle.textContent = "🚀 本次更新内容说明：";
        const incomingNotes = versionData.updateLog || versionData.notes || CURRENT_UPDATE_NOTES.join("\n\n");
        if (notesEl) notesEl.textContent = incomingNotes;

        if (btnFast) {
          btnFast.style.display = "flex";
          // 🌟 核心革新：如果处于原生 App 环境，首推免安装秒级在线热更新！
          if (typeof AndroidNativeApp !== "undefined" && AndroidNativeApp.saveHotUpdateFile) {
            btnFast.innerHTML = "<span>⚡ 免安装一键秒更 (推荐·2秒无感)</span>";
            btnFast.onclick = async (e) => {
              e.preventDefault();
              if (btnFast.disabled) return;
              btnFast.disabled = true;
              btnFast.style.opacity = "0.8";
              btnFast.innerHTML = "<span>⏳ 正在多路高速竞速下载...</span>";
              setVisualProgress(15, "🚀 正在启动 4 路极速 CDN 并发竞速...");
              isAppDownloading = true;

              try {
                // ⚡ 4 路高可用 CDN 镜像并发竞速（彻底消灭单点阻塞，哪个最快就用哪个，1次点击秒成！）
                const hotUrls = htmlLink ? [htmlLink + (htmlLink.includes('?') ? '&' : '?') + '_t=' + Date.now()] : [];

                const fetchCandidate = (url, timeoutMs = 7000) => {
                  const controller = new AbortController();
                  const tId = setTimeout(() => controller.abort(), timeoutMs);
                  return fetch(url, {
                    signal: controller.signal,
                    cache: 'no-store',
                    headers: getUpdateHeaders(versionData.htmlTicket)
                  })
                    .then(async (res) => {
                      clearTimeout(tId);
                      if (!res.ok) throw new Error("HTTP " + res.status);
                      const txt = await readLimitedResponseText(res, 4 * 1024 * 1024);
                      if (!txt || txt.length < 50000 || !txt.includes("五子棋")) {
                        throw new Error("Invalid html payload");
                      }
                      if (versionData.htmlSha256) {
                        const actualHash = await sha256Hex(txt);
                        if (actualHash !== versionData.htmlSha256) {
                          throw new Error("HTML integrity check failed");
                        }
                      } else {
                        throw new Error("Missing HTML integrity digest");
                      }
                      return txt;
                    });
                };

                setVisualProgress(35, "📥 正在极速接收最新代码包 (毫秒级直连)...");
                if (hotUrls.length === 0) throw new Error("Worker 未提供热更新文件地址");
                const newHtml = await Promise.any(hotUrls.map(u => fetchCandidate(u)));

                setVisualProgress(80, "💾 正在极速写入本地沙盒存储...");
                const ok = AndroidNativeApp.saveHotUpdateFile("index.html", newHtml);
                if (ok) {
                  setVisualProgress(100, "🎉 免安装秒更成功！正在重载进入新版...");
                  showGameNotice("🎉 更新成功！即将无缝重载进入最新版", false);
                  setTimeout(() => {
                    window.location.reload();
                  }, 800);
                  return;
                }
                throw new Error("沙盒写入失败");
              } catch(err) {
                console.warn('[HotUpdate Concurrent Fallback]', err);
                setVisualProgress(50, "🔄 自动转入 APK 完整通道下载...");
                if (hasUpdateTickets && !invokeProtectedNativeApkUpdate(versionData.apkTicket)) {
                  isAppDownloading = false;
                  showGameNotice('当前安装包需要先安装新版安全客户端，请先手动安装最新版 APK', true);
                }
              }
            };
          } else {
            btnFast.innerHTML = "<span>⚡ 极速全自动下载更新 (推荐)</span>";
            btnFast.onclick = (e) => {
              e.preventDefault();
              setVisualProgress(5, "🚀 正在启动全自动极速下载...");
              isAppDownloading = true;
              if (hasUpdateTickets && typeof AndroidNativeApp !== "undefined" && invokeProtectedNativeApkUpdate(versionData.apkTicket)) {
                showGameNotice(`🚀 正在全自动下载最新版 (${versionData.tag})，下载完成后将自动弹出安装！`, true);
              } else if (hasUpdateTickets && fastLink) {
                downloadProtectedApk(fastLink, versionData.apkTicket)
                  .then(() => showGameNotice('✅ 安装包已开始下载，请在浏览器下载列表中安装', false))
                  .catch(() => showGameNotice('更新下载授权已失效，请重新检查更新', true))
                  .finally(() => { isAppDownloading = false; });
              } else {
                isAppDownloading = false;
                showGameNotice('更新服务暂未提供有效授权，请重新检查更新', true);
              }
            };
          }
        }
        if (btnCancel) {
          btnCancel.textContent = "稍后再说";
          btnCancel.style.background = "#f1f5f9";
          btnCancel.style.color = "#64748b";
          btnCancel.style.padding = "6px 0";
        }
      } else {
        // 当前已是最新正式版！清晰直观反馈
        if (modalIcon) modalIcon.textContent = "✅";
        if (modalTitle) modalTitle.textContent = "当前已是最新正式版！";
        if (tagEl) {
          tagEl.textContent = `${DISPLAY_VERSION_TAG} (最新正式版)`;
          tagEl.style.background = "#dcfce7";
          tagEl.style.color = "#15803d";
        }
        if (notesTitle) notesTitle.textContent = "📜 当前版本更新说明：";
        if (notesEl) notesEl.textContent = `恭喜！您的游戏已处于最新正式版本 (${DISPLAY_VERSION_TAG})。\n\n` + CURRENT_UPDATE_NOTES.join("\n\n");

        if (btnFast) btnFast.style.display = "none";
        if (btnCancel) {
          btnCancel.textContent = "✅ 我知道了 (当前已是最新)";
          btnCancel.style.background = "#10b981";
          btnCancel.style.color = "#fff";
          btnCancel.style.fontWeight = "900";
          btnCancel.style.padding = "10px 0";
          btnCancel.style.fontSize = "13px";
        }
        showGameNotice(`🎉 检查完成！当前已是最新正式版 (${DISPLAY_VERSION_TAG})！`, false);
      }

      openUpdateModal();
    }


    // 🌟 自动检查：如果是刚更新后的首次打开，主动弹出新版本更新内容公告
    function checkPostUpdateAnnouncement() {
      try {
        const lastSeen = localStorage.getItem('gomoku_last_seen_version');
        if (lastSeen !== CURRENT_VERSION_TAG) {
          setTimeout(() => {
            const modalIcon = document.getElementById("updateModalIcon");
            const modalTitle = document.getElementById("updateModalTitle");
            const tagEl = document.getElementById("updateTagText");
            const notesTitle = document.getElementById("updateNotesTitle");
            const notesEl = document.getElementById("updateNotesContent");
            const btnFast = document.getElementById("btnFastDownload");
            const btnCancel = document.getElementById("btnUpdateCancel");

            if (modalIcon) modalIcon.textContent = "🎉";
            if (modalTitle) modalTitle.textContent = "欢迎体验全新版本！";
            if (tagEl) {
              tagEl.textContent = `已成功升级至 ${DISPLAY_VERSION_TAG} 旗舰版`;
              tagEl.style.background = "#dcfce7";
              tagEl.style.color = "#15803d";
            }
            if (notesTitle) notesTitle.textContent = "✨ 本次更新内容说明：";
            if (notesEl) {
              notesEl.textContent = CURRENT_UPDATE_NOTES.join("\n\n");
              notesEl.style.maxHeight = "180px";
            }
            if (btnFast) btnFast.style.display = "none";
            if (btnCancel) {
              btnCancel.textContent = "🎉 我知道了，立即开局！";
              btnCancel.style.background = "linear-gradient(135deg, #0284c7, #0369a1)";
              btnCancel.style.color = "#fff";
              btnCancel.style.fontWeight = "900";
              btnCancel.style.padding = "10px 0";
              btnCancel.style.fontSize = "13px";
              btnCancel.style.borderRadius = "10px";
              btnCancel.style.boxShadow = "0 3px 0 #075985";
            }
            openUpdateModal();
            localStorage.setItem('gomoku_last_seen_version', CURRENT_VERSION_TAG);
          }, 800);
        }
      } catch(e) {}
    }

    function openUpdateModal() {
      const el = document.getElementById('appUpdateModal');
      if (el) {
        el.style.display = 'flex';
        el.classList.add('show');
      }
    }

    function closeUpdateModal() {
      const el = document.getElementById('appUpdateModal');
      if (el) {
        el.classList.remove('show');
        setTimeout(() => {
          el.style.display = 'none';
        }, 150);
      }
    }

    // 仅在进入游戏 2.5 秒后静默全自动检查一次（杜绝频繁切后台反复触发重复下载）
    const scheduleAutomaticUpdateCheck = () => checkAppUpdate(false);
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(scheduleAutomaticUpdateCheck, { timeout: 8000 });
    } else {
      setTimeout(scheduleAutomaticUpdateCheck, 5000);
    }

    // 首帧优先：头像、账号同步和历史统计不阻塞棋盘首次绘制。
    const runNonCriticalStartupTasks = () => {
      renderChatHistory();
      updateAccountUI();
      updatePlayerHeaderUI();
      updateHistoryCountUI();
      Promise.resolve(initUserSession()).finally(() => {
        if (!hasRegisteredAccountSession()) return;
        const startSocial = () => {
          if (typeof window.ensureGomokuFeature !== 'function') return;
          window.ensureGomokuFeature('social').then(() => window.GomokuSocial.start()).catch(() => {});
        };
        if (typeof requestIdleCallback === 'function') requestIdleCallback(startSocial, { timeout: 5000 });
        else setTimeout(startSocial, 1200);
      });
    };
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => setTimeout(runNonCriticalStartupTasks, 0));
    } else {
      setTimeout(runNonCriticalStartupTasks, 0);
    }
    // 📱 Android 原生实体/手势 Back 返回键拦截器
    // 当任意弹窗、抽屉或确认框打开时，按返回键优雅关闭弹窗，避免误退游戏
    window.handleAndroidBack = function() {
      // 1. 若处于主棋盘动态复盘模式，优先平滑退出复盘
      if (typeof isReplayMode !== 'undefined' && isReplayMode) {
        if (typeof exitReplayMode === 'function') exitReplayMode();
        return true;
      }

      // 2. 自定义二次确认弹窗
      const openConfirm = document.getElementById('customConfirmModal');
      if (openConfirm && (openConfirm.classList.contains('show') || openConfirm.style.display === 'flex')) {
        if (typeof closeCustomConfirm === 'function') closeCustomConfirm(false);
        else { openConfirm.classList.remove('show'); openConfirm.style.display = 'none'; }
        return true;
      }

      // 3. 常驻聊天抽屉
      const chatBackdrop = document.getElementById('chatBackdrop');
      if (chatBackdrop && (chatBackdrop.classList.contains('show') || chatBackdrop.style.display === 'flex' || chatBackdrop.style.display === 'block')) {
        if (typeof closeChatDrawer === 'function') closeChatDrawer();
        else { chatBackdrop.classList.remove('show'); chatBackdrop.style.display = 'none'; }
        return true;
      }

      // 4. 全套模态弹窗列表（安全函数探测，100% 杜绝 ReferenceError）
      const modalDefs = [
        { id: 'themeModal', close: () => typeof closeThemeModal === 'function' && closeThemeModal() },
        { id: 'leaderboardModal', close: () => typeof closeLeaderboardModal === 'function' && closeLeaderboardModal() },
        { id: 'feedbackModal', close: () => typeof closeFeedbackModal === 'function' && closeFeedbackModal() },
        { id: 'onlineModal', close: () => typeof closeOnlineModal === 'function' && closeOnlineModal() },
        { id: 'profileModal', close: () => typeof closeProfileModal === 'function' && closeProfileModal() },
        { id: 'authModal', close: () => typeof closeAuthModal === 'function' && closeAuthModal() },
        { id: 'changePasswordModal', close: () => typeof closeChangePasswordModal === 'function' && closeChangePasswordModal() },
        { id: 'historyModal', close: () => typeof closeHistoryModal === 'function' && closeHistoryModal() },
        { id: 'gameResultModal', close: () => typeof closeGameResultModal === 'function' && closeGameResultModal() },
        { id: 'phraseManageModal', close: () => typeof closePhraseManageModal === 'function' && closePhraseManageModal() },
        { id: 'undoModal', close: () => typeof closeUndoModal === 'function' && closeUndoModal() },
        { id: 'appUpdateModal', close: () => typeof closeUpdateModal === 'function' && closeUpdateModal() },
        { id: 'gameReplayModal', close: () => typeof closeReplayModal === 'function' && closeReplayModal() }
      ];

      for (const m of modalDefs) {
        const el = document.getElementById(m.id);
        if (el && (el.classList.contains('show') || el.classList.contains('open') || el.style.display === 'flex' || el.style.display === 'block')) {
          if (typeof m.close === 'function') {
            m.close();
          }
          // 保底兜底：若 close() 没能完全清理样式，强制关闭
          if (el.classList.contains('show') || el.classList.contains('open') || el.style.display === 'flex' || el.style.display === 'block') {
            el.classList.remove('show', 'open');
            el.style.display = 'none';
          }
          return true;
        }
      }
      return false;
    };
    // 按照用户需求：启动绝不自动弹更新卡片，保持极致秒开直入棋盘
    // checkPostUpdateAnnouncement();
