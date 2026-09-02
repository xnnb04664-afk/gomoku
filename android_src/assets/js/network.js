/**
 * 五子棋 WebRTC P2P 联机网络管理器 (PeerJS DataChannel)
 * 已升级注入全球+国内顶级多节点 STUN/ICE 穿透服务器矩阵，大幅提升跨公网/跨宽带穿透率
 */

// 高穿透率多链路 STUN 服务器集群 (含 Cloudflare, Google, 腾讯等)
const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:stun3.l.google.com:19302' },
  { urls: 'stun:stun4.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
  { urls: 'stun:stun.qq.com:3478' },
  { urls: 'stun:stun.syncthing.net:3478' },
  { urls: 'stun:stun.stunprotocol.org:3478' }
];

class PeerNetwork {
  constructor() {
    this.peer = null;
    this.conn = null;
    this.isHost = false;
    this.roomId = null;
    this.isConnected = false;

    // 事件监听回调
    this.onStatusChange = null; // (status: 'disconnected'|'connecting'|'waiting'|'connected', text: string)
    this.onMessage = null;      // (msg: { type: string, payload: any })
    this.onError = null;        // (err: any)
  }

  /**
   * 生成随机 6 位大写房间码
   */
  static generateRoomId() {
    const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
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
   */
  createRoom(customCode = null) {
    this.cleanup();
    const roomCode = customCode || PeerNetwork.generateRoomId();
    this.roomId = roomCode;
    this.isHost = true;

    if (this.onStatusChange) {
      this.onStatusChange('connecting', '正在连接信令服务器并准备穿透...');
    }

    try {
      this.peer = new Peer(PeerNetwork.getPeerId(roomCode), {
        debug: 1,
        config: {
          iceServers: ICE_SERVERS,
          iceCandidatePoolSize: 10
        }
      });

      this.peer.on('open', (id) => {
        if (this.onStatusChange) {
          this.onStatusChange('waiting', `房间已创建！房间号: ${this.roomId}，等待对手加入...`);
        }
      });

      // 监听对手加入连接
      this.peer.on('connection', (conn) => {
        if (this.conn && this.conn.open) {
          conn.close();
          return;
        }

        this.conn = conn;
        this.setupConnectionHandlers();
      });

      this.peer.on('error', (err) => {
        console.error('Peer error:', err);
        if (err.type === 'unavailable-id') {
          // 房间号冲突，自动换一个重试
          this.createRoom();
          return;
        }
        if (this.onError) this.onError(err);
        if (this.onStatusChange) {
          this.onStatusChange('disconnected', `连接异常: ${err.type || err.message}`);
        }
      });

    } catch (e) {
      console.error('Failed to create Peer:', e);
      if (this.onError) this.onError(e);
    }

    return roomCode;
  }

  /**
   * 加入房间 (作为客机 Client)
   */
  joinRoom(roomCode) {
    this.cleanup();
    const code = roomCode.toUpperCase().trim();
    this.roomId = code;
    this.isHost = false;

    if (this.onStatusChange) {
      this.onStatusChange('connecting', `正在寻找房间 ${code} 并尝试打洞穿透...`);
    }

    try {
      this.peer = new Peer({
        debug: 1,
        config: {
          iceServers: ICE_SERVERS,
          iceCandidatePoolSize: 10
        }
      });

      this.peer.on('open', () => {
        const targetPeerId = PeerNetwork.getPeerId(code);
        this.conn = this.peer.connect(targetPeerId, {
          reliable: true
        });
        this.setupConnectionHandlers();
      });

      this.peer.on('error', (err) => {
        console.error('Peer error:', err);
        if (this.onError) this.onError(err);
        if (this.onStatusChange) {
          this.onStatusChange('disconnected', `加入房间失败: 房间不存在或网络未连通`);
        }
      });

    } catch (e) {
      console.error('Failed to join Peer:', e);
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
