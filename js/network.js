/**
 * 五子棋 WebRTC P2P 联机网络管理器 (PeerJS DataChannel)
 * 已升级注入全球+国内顶级多节点 STUN/ICE 穿透服务器矩阵，大幅提升跨公网/跨宽带穿透率
 */

// ============================================================
// 🌐 信令服务器配置列表（按优先级排序，连不上自动切换下一个）
// ============================================================
const PEER_SERVERS = [
  // 节点1: 官方 peerjs.com
  { host: '0.peerjs.com', port: 443, path: '/', secure: true },
  // 节点2: 欧洲社区节点（国内相对可用）
  { host: 'peerjs.92k.de', port: 443, path: '/', secure: true },
];

// 每个信令服务器的连接超时（毫秒）
const PEER_SERVER_TIMEOUT_MS = 8000;

// 高穿透率多链路 STUN 服务器集群（优先使用国内可访问节点）
const ICE_SERVERS = [
  { urls: 'stun:stun.cloudflare.com:3478' },
  { urls: 'stun:stun.qq.com:3478' },
  { urls: 'stun:stun.syncthing.net:3478' },
  { urls: 'stun:stun.stunprotocol.org:3478' },
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

class PeerNetwork {
  constructor() {
    this.peer = null;
    this.conn = null;
    this.isHost = false;
    this.roomId = null;
    this.isConnected = false;
    this._connectTimer = null; // 信令服务器连接超时定时器

    // 事件监听回调
    this.onStatusChange = null; // (status: 'disconnected'|'connecting'|'waiting'|'connected', text: string)
    this.onMessage = null;      // (msg: { type: string, payload: any })
    this.onError = null;        // (err: any)
  }

  /** 清除信令超时定时器 */
  _clearConnectTimer() {
    if (this._connectTimer) {
      clearTimeout(this._connectTimer);
      this._connectTimer = null;
    }
  }

  /**
   * 生成安全的随机 6 位大写房间码（使用 Web Crypto API）
   * 采用排除易混字符的字符集，可在极短时间内产生唯一码。
   */
   static generateRoomId() {
     const charset = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
     const array = new Uint8Array(6);
     // crypto.getRandomValues 在所有现代浏览器中均为同步调用，性能极佳
     window.crypto.getRandomValues(array);
     let code = '';
     for (let i = 0; i < 6; i++) {
       // 使用取模确保索引在字符集范围内
       code += charset[array[i] % charset.length];
     }
     return code;
   }

  /**
   * 格式化 Peer 真实 ID 前缀以防冲突
   */
  static getPeerId(roomCode) {
    return `gomoku-room-${roomCode.toUpperCase().trim()}`;
  }

  /**
   * 创建房间 (作为房主 Host)
   * @param {string|null} customCode  固定房间码（重试时保持同一码）
   * @param {number}      serverIndex 当前尝试的信令服务器索引（递归用）
   */
  createRoom(customCode = null, serverIndex = 0) {
    if (serverIndex === 0) this.cleanup();

    const roomCode = customCode || PeerNetwork.generateRoomId();
    this.roomId = roomCode;
    this.isHost = true;

    const serverCfg = PEER_SERVERS[serverIndex];

    // 所有备用服务器均失败
    if (!serverCfg) {
      if (this.onStatusChange) {
        this.onStatusChange('disconnected', '所有信令服务器均无法连接，请检查网络或稍后重试');
      }
      return roomCode;
    }

    if (this.onStatusChange) {
      const hint = PEER_SERVERS.length > 1
        ? `(${serverIndex + 1}/${PEER_SERVERS.length}) 正在尝试 ${serverCfg.host}...`
        : '正在连接信令服务器...';
      this.onStatusChange('connecting', hint);
    }

    // 销毁上一次失败的 Peer
    if (this.peer) { try { this.peer.destroy(); } catch (e) {} this.peer = null; }

    // 设置超时：PEER_SERVER_TIMEOUT_MS 内未 open 则自动切换下一服务器
    this._clearConnectTimer();
    this._connectTimer = setTimeout(() => {
      console.warn(`[PeerNetwork] ${serverCfg.host} 连接超时，切换下一节点...`);
      this.createRoom(roomCode, serverIndex + 1);
    }, PEER_SERVER_TIMEOUT_MS);

    try {
      this.peer = new Peer(PeerNetwork.getPeerId(roomCode), {
        debug: 0,
        host: serverCfg.host,
        port: serverCfg.port,
        path: serverCfg.path,
        secure: serverCfg.secure,
        config: { iceServers: ICE_SERVERS, iceCandidatePoolSize: 10 }
      });

      this.peer.on('open', () => {
        this._clearConnectTimer();
        if (this.onStatusChange) {
          this.onStatusChange('waiting', `房间已创建！房间号: ${this.roomId}，等待对手加入...`);
        }
      });

      // 监听对手加入连接
      this.peer.on('connection', (conn) => {
        if (this.conn && this.conn.open) { conn.close(); return; }
        this.conn = conn;
        this.setupConnectionHandlers();
      });

      this.peer.on('error', (err) => {
        console.error('[PeerNetwork] Peer error:', err);
        this._clearConnectTimer();
        if (err.type === 'unavailable-id') {
          // 房间号冲突，换新码重试（同一服务器节点）
          this.createRoom(null, serverIndex);
          return;
        }
        // 其他错误：尝试下一个服务器
        if (serverIndex + 1 < PEER_SERVERS.length) {
          this.createRoom(roomCode, serverIndex + 1);
        } else {
          if (this.onError) this.onError(err);
          if (this.onStatusChange) {
            this.onStatusChange('disconnected', `连接失败: ${err.type || err.message}`);
          }
        }
      });

    } catch (e) {
      this._clearConnectTimer();
      console.error('[PeerNetwork] Failed to create Peer:', e);
      if (this.onError) this.onError(e);
    }

    return roomCode;
  }

  /**
   * 加入房间 (作为客机 Client)
   * @param {string} roomCode     要加入的房间码
   * @param {number} serverIndex  当前尝试的信令服务器索引（递归用）
   */
  joinRoom(roomCode, serverIndex = 0) {
    if (serverIndex === 0) this.cleanup();

    const code = roomCode.toUpperCase().trim();
    this.roomId = code;
    this.isHost = false;

    const serverCfg = PEER_SERVERS[serverIndex];

    if (!serverCfg) {
      if (this.onStatusChange) {
        this.onStatusChange('disconnected', '所有信令服务器均无法连接，请检查网络或稍后重试');
      }
      return;
    }

    if (this.onStatusChange) {
      const hint = PEER_SERVERS.length > 1
        ? `(${serverIndex + 1}/${PEER_SERVERS.length}) 正在通过 ${serverCfg.host} 寻找房间...`
        : `正在寻找房间 ${code}...`;
      this.onStatusChange('connecting', hint);
    }

    // 销毁上一次失败的 Peer
    if (this.peer) { try { this.peer.destroy(); } catch (e) {} this.peer = null; }

    // 超时切换
    this._clearConnectTimer();
    this._connectTimer = setTimeout(() => {
      console.warn(`[PeerNetwork] ${serverCfg.host} 超时，切换下一节点...`);
      this.joinRoom(code, serverIndex + 1);
    }, PEER_SERVER_TIMEOUT_MS);

    try {
      this.peer = new Peer({
        debug: 0,
        host: serverCfg.host,
        port: serverCfg.port,
        path: serverCfg.path,
        secure: serverCfg.secure,
        config: { iceServers: ICE_SERVERS, iceCandidatePoolSize: 10 }
      });

      this.peer.on('open', () => {
        this._clearConnectTimer();
        const targetPeerId = PeerNetwork.getPeerId(code);
        this.conn = this.peer.connect(targetPeerId, { reliable: true });
        this.setupConnectionHandlers();
      });

      this.peer.on('error', (err) => {
        console.error('[PeerNetwork] Peer error:', err);
        this._clearConnectTimer();
        if (serverIndex + 1 < PEER_SERVERS.length) {
          this.joinRoom(code, serverIndex + 1);
        } else {
          if (this.onError) this.onError(err);
          if (this.onStatusChange) {
            this.onStatusChange('disconnected', '加入房间失败：房间不存在或所有服务器均不可用');
          }
        }
      });

    } catch (e) {
      this._clearConnectTimer();
      console.error('[PeerNetwork] Failed to join Peer:', e);
      if (this.onError) this.onError(e);
    }
  }



  /**
   * 配置 DataChannel 事件监听
   */
  setupConnectionHandlers() {
    if (!this.conn) return;

    this.conn.on('open', () => {
      this.isConnected = true;
      if (this.onStatusChange) {
        this.onStatusChange('connected', `已成功连接对手！`);
      }
    });

    this.conn.on('data', (data) => {
      if (this.onMessage) {
        this.onMessage(data);
      }
    });

    this.conn.on('close', () => {
      this.isConnected = false;
      if (this.onStatusChange) {
        this.onStatusChange('disconnected', '对手已退出或断开连接');
      }
    });

    this.conn.on('error', (err) => {
      console.error('Connection error:', err);
      this.isConnected = false;
      if (this.onStatusChange) {
        this.onStatusChange('disconnected', '连接中断');
      }
    });
  }

  /**
   * 发送消息给对手
   */
  send(type, payload = {}) {
    if (!this.conn || !this.isConnected) {
      console.warn('Cannot send message, connection is not ready.');
      return false;
    }
    this.conn.send({ type, payload, timestamp: Date.now() });
    return true;
  }

  /**
   * 断开并清理资源
   */
  cleanup() {
    this._clearConnectTimer();
    this.isConnected = false;
    if (this.conn) {
      try { this.conn.close(); } catch (e) {}
      this.conn = null;
    }
    if (this.peer) {
      try { this.peer.destroy(); } catch (e) {}
      this.peer = null;
    }
    this.roomId = null;
  }
}

window.PeerNetwork = PeerNetwork;
