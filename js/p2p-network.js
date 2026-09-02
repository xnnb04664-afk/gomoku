/**
 * 中国网络环境下的 WebRTC P2P 通道。
 * PeerJS 只负责信令，棋局数据在连接建立后通过 DataChannel 直传。
 * 如果信令或直连失败，上层会切回 MQTT 中继。
 */
(function () {
  const SIGNAL_SERVERS = [
    { host: '0.peerjs.com', port: 443, path: '/', secure: true },
    { host: 'peerjs.92k.de', port: 443, path: '/', secure: true }
  ];

  const STUN_SERVERS = [
    { urls: 'stun:stun.qq.com:3478' },
    { urls: 'stun:stun.cloudflare.com:3478' },
    { urls: 'stun:stun.syncthing.net:3478' },
    { urls: 'stun:stun.l.google.com:19302' }
  ];

  const CONNECT_TIMEOUT = 9000;

  class GomokuP2PChannel {
    constructor(roomCode, role) {
      this.roomCode = String(roomCode || '').toUpperCase().trim();
      this.role = role;
      this.peer = null;
      this.connection = null;
      this.open = false;
      this.listeners = { open: [], data: [], close: [], error: [] };
      this._resolved = false;
      this._serverIndex = 0;
      this._timer = null;
    }

    on(event, handler) {
      if (this.listeners[event]) this.listeners[event].push(handler);
      return this;
    }

    off(event, handler) {
      if (this.listeners[event]) {
        this.listeners[event] = this.listeners[event].filter(item => item !== handler);
      }
      return this;
    }

    _emit(event, value) {
      (this.listeners[event] || []).slice().forEach(handler => {
        try { handler(value); } catch (error) { console.error('[P2P listener error]', error); }
      });
    }

    _peerOptions(server) {
      const extraTurn = Array.isArray(window.GOMOKU_TURN_SERVERS)
        ? window.GOMOKU_TURN_SERVERS
        : [];
      return {
        debug: 0,
        host: server.host,
        port: server.port,
        path: server.path,
        secure: server.secure,
        config: {
          iceServers: STUN_SERVERS.concat(extraTurn),
          iceCandidatePoolSize: 10,
          sdpSemantics: 'unified-plan'
        }
      };
    }

    _clearTimer() {
      if (this._timer) clearTimeout(this._timer);
      this._timer = null;
    }

    _destroyPeer() {
      this._clearTimer();
      if (this.connection) {
        try { this.connection.close(); } catch (_) {}
        this.connection = null;
      }
      if (this.peer) {
        try { this.peer.destroy(); } catch (_) {}
        this.peer = null;
      }
      this.open = false;
    }

    _attachConnection(connection) {
      if (this.connection && this.connection !== connection && this.connection.open) {
        try { connection.close(); } catch (_) {}
        return;
      }
      this.connection = connection;
      connection.on('open', () => {
        this.open = true;
        this._clearTimer();
        this._emit('open');
      });
      connection.on('data', data => this._emit('data', data));
      connection.on('close', () => {
        this.open = false;
        this._emit('close');
      });
      connection.on('error', error => {
        this.open = false;
        this._emit('error', error);
      });
    }

    _tryServer(index, resolve, reject) {
      if (index >= SIGNAL_SERVERS.length) {
        reject(new Error('P2P 信令节点均不可用'));
        return;
      }

      this._serverIndex = index;
      const server = SIGNAL_SERVERS[index];
      const peerId = `gomoku-room-${this.roomCode}`;
      let settled = false;
      const retry = (error) => {
        if (settled || this._resolved) return;
        settled = true;
        this._clearTimer();
        this._destroyPeer();
        console.warn(`[P2P] ${server.host} 失败，尝试下一个节点`, error || '');
        this._tryServer(index + 1, resolve, reject);
      };

      try {
        const peer = this.role === 'host'
          ? new Peer(peerId, this._peerOptions(server))
          : new Peer(this._peerOptions(server));
        this.peer = peer;

        peer.once('open', () => {
          if (settled) return;
          if (this.role === 'host') {
            settled = true;
            this._clearTimer();
            peer.on('connection', connection => this._attachConnection(connection));
            resolve(this);
            return;
          }

          const connection = peer.connect(peerId, { reliable: true, serialization: 'json' });
          this._attachConnection(connection);
          connection.once('open', () => {
            if (settled) return;
            settled = true;
            this._clearTimer();
            resolve(this);
          });
          connection.once('error', retry);
          connection.once('close', () => {
            if (!settled) retry(new Error('P2P 数据通道关闭'));
          });
        });

        peer.once('error', retry);
        this._timer = setTimeout(() => retry(new Error('P2P 连接超时')), CONNECT_TIMEOUT);
      } catch (error) {
        retry(error);
      }
    }

    start() {
      if (typeof Peer !== 'function') {
        return Promise.reject(new Error('PeerJS 未加载'));
      }
      return new Promise((resolve, reject) => this._tryServer(0, resolve, reject));
    }

    send(data) {
      if (!this.open || !this.connection) return false;
      try {
        this.connection.send(data);
        return true;
      } catch (error) {
        this._emit('error', error);
        return false;
      }
    }

    close() {
      this._resolved = true;
      this._destroyPeer();
      this._emit('close');
      this.listeners = { open: [], data: [], close: [], error: [] };
    }
  }

  window.GomokuP2PChannel = GomokuP2PChannel;
})();
