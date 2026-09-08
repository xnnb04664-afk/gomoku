    // ==========================================
    // 🌐 极速秒开房间联机核心引擎 (全网络穿透·中国极速直连)
    // ==========================================
    // 生产联机使用项目自有 Durable Object WebSocket 中继；下面的公共 MQTT
    // 代码仅作为旧版本迁移/自动化测试兼容层，不参与正常用户流程。
    const MQTT_BROKER_URLS = [
      'wss://broker.emqx.io:8084/mqtt',
      'wss://broker.hivemq.com:8884/mqtt',
      'wss://mqtt.eclipseprojects.io:443/mqtt',
      'wss://test.mosquitto.org:8081/mqtt'
    ];

    let mqttClient = null;
    let mqttClientPromise = null;
    let mqttClientPromiseRoomKey = '';
    let mqttClientRequestSeq = 0;
    let onlineTransportPromise = null;
    let onlineTransportPromiseKey = '';
    let onlineTransportRequestSeq = 0;

    // 旧 MQTT 兼容层的参数，仅在显式 legacy 开关下使用。
    const MQTT_CONNECT_TIMEOUT_MS = 2800;
    const MQTT_LIBRARY_WAIT_MS = 8000;
    // 兼容适配器沿用 MQTT 的 publish/subscribe 形状：业务报文按 QoS 1 语义，
    // ICE 信令按 QoS 0 语义；项目自有 WebSocket 中继会忽略 QoS 参数。
    const MQTT_ROOM_DATA_QOS = 1;
    // 自有 Cloudflare Durable Object 是生产信令/可靠中继；公共 MQTT 只保留为
    // 老版本过渡和自动化测试兼容层，正常构建不会自动启用。
    const ONLINE_RELAY_ENDPOINTS = [
      'wss://gomoku-backend.xnnb04664.workers.dev/api/room/socket',
      'wss://gomoku-api.pages.dev/api/room/socket'
    ];
    const ONLINE_RELAY_CONNECT_TIMEOUT_MS = 2800;

    const MAX_ONLINE_PAYLOAD_BYTES = 60 * 1024;
    const MAX_ONLINE_MESSAGES_PER_SECOND = 80;
    const MAX_ONLINE_SIGNAL_MESSAGES_PER_SECOND = 180;
    // 会改变对局或玩家可见状态的消息不能“发出去就算完”：P2P 与项目自有 WebSocket 中继双发，
    // 收到端回 ACK；发送端在短时间内自动重发，接收端按 _mid 去重。
    const RELIABLE_ONLINE_MESSAGE_TYPES = new Set([
      'move', 'chat', 'sync_req', 'state_snapshot',
      'undo_req', 'undo_res', 'restart_req', 'restart_res', 'restart',
      'skill_use', 'skill_identity_swap', 'skill_prophecy', 'skill_remove_stone',
      'skill_shift_stone', 'skill_swap_color', 'skill_swap_positions', 'skill_mega_bomb',
      'destiny_point_1', 'destiny_point_2', 'destiny_wipe_danger', 'destiny_place_2x2'
    ]);
    const MIRRORED_ONLINE_MESSAGE_TYPES = new Set([
      ...RELIABLE_ONLINE_MESSAGE_TYPES,
      'delivery_ack', 'profile_sync', 'reconnect_handshake', 'leave_room'
    ]);
    // 心跳只测量当前实际业务传输路径：P2P 打通后不再把 ping/pong 同时
    // 镜像到 WebSocket 中继，否则中继排队/跨区延迟会污染 P2P 延迟显示。
    const ONLINE_IMMEDIATE_MIRROR_TYPES = new Set([
      'delivery_ack', 'profile_sync', 'reconnect_handshake', 'leave_room'
    ]);
    const ONLINE_HEARTBEAT_TYPES = new Set(['ping', 'pong']);
    const ONLINE_RELIABLE_RETRY_INTERVAL_MS = 900;
    const ONLINE_RELIABLE_MAX_ATTEMPTS = 8;
    const ONLINE_RELIABLE_MAX_AGE_MS = 10000;
    // P2P 正常时先走直连；只有未收到 ACK 才延迟镜像到项目自有中继，
    // 降低中继短暂抖动对落子/聊天的影响。
    const ONLINE_P2P_MQTT_FAILOVER_DELAY_MS = 300;
    const ONLINE_LATENCY_SAMPLE_LIMIT = 5;
    const ONLINE_P2P_STATS_INTERVAL_MS = 2000;
    // 连续多次确认 RTT 偏高才重选 ICE，并限制每个房间的尝试次数，避免弱网反复断线。
    const ONLINE_P2P_HIGH_RTT_THRESHOLD_MS = 250;
    const ONLINE_P2P_HIGH_RTT_SAMPLE_COUNT = 3;
    const ONLINE_P2P_REOPTIMIZE_COOLDOWN_MS = 90000;
    const ONLINE_P2P_MAX_REOPTIMIZE_ATTEMPTS = 2;
    // 进房确认始终走项目自有 WebSocket 中继，与 WebRTC/P2P 是否打通无关。
    // 移动网络切换或 WebView 短暂停顿时持续重发，避免三连发全部丢失后
    // 出现房主已经进房、房客却退回人机模式的半开局面。
    const ONLINE_JOIN_READY_RETRY_MS = 700;
    const ONLINE_JOIN_CONFIRM_TIMEOUT_MS = 15000;
    const onlineReliableOutbox = new Map();
    const ONLINE_TEXT_ENCODER = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;
    const ONLINE_MESSAGE_TYPES = new Set([
      'chat', 'delivery_ack', 'profile_sync', 'ping', 'pong', 'sync_req', 'state_snapshot', 'reconnect_handshake',
      'join_ready', 'join_confirmed',
      'move', 'leave_room', 'undo_req', 'undo_res', 'restart_req', 'restart_res', 'restart',
      'skill_use', 'skill_identity_swap', 'skill_prophecy', 'skill_remove_stone', 'skill_shift_stone',
      'skill_swap_color', 'skill_swap_positions', 'skill_mega_bomb',
      'destiny_point_1', 'destiny_point_2', 'destiny_wipe_danger', 'destiny_place_2x2'
    ]);
    const P2P_SIGNAL_TYPES = new Set(['hello', 'offer', 'answer', 'ice', 'ice_batch']);

    function clearOnlineReliableOutbox() {
      onlineReliableOutbox.clear();
    }

    function getOnlinePayloadByteLength(value) {
      if (ONLINE_TEXT_ENCODER) return ONLINE_TEXT_ENCODER.encode(value).byteLength;
      return String(value).length;
    }

    function generateSecureId(byteLength = 12, prefix = '') {
      try {
        const cryptoApi = (typeof window !== 'undefined' && window.crypto) ||
          (typeof crypto !== 'undefined' ? crypto : null);
        if (cryptoApi && cryptoApi.getRandomValues) {
          const bytes = new Uint8Array(byteLength);
          cryptoApi.getRandomValues(bytes);
          return prefix + Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
        }
      } catch (_) {}
      return prefix + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 12);
    }

    function getMqttLibrary() {
      if (typeof mqtt !== 'undefined' && mqtt && mqtt.connect) return mqtt;
      if (typeof window !== 'undefined' && window.mqtt && window.mqtt.connect) return window.mqtt;
      return null;
    }

    function waitForMqttLibrary(timeout = MQTT_LIBRARY_WAIT_MS) {
      const existing = getMqttLibrary();
      if (existing) return Promise.resolve(existing);

      const ensurePromise = typeof window.ensureGomokuResource === 'function'
        ? window.ensureGomokuResource('mqtt')
        : Promise.resolve();
      return ensurePromise.then(() => {
        const loaded = getMqttLibrary();
        if (loaded) return loaded;
        return new Promise((resolve, reject) => {
          const startedAt = Date.now();
          const timer = setInterval(() => {
            const loaded = getMqttLibrary();
            if (loaded) {
              clearInterval(timer);
              resolve(loaded);
              return;
            }
            if (Date.now() - startedAt >= timeout) {
              clearInterval(timer);
              reject(new Error('联机网络组件加载超时，请刷新页面后重试'));
            }
          }, 50);
        });
      });
    }

    function getMqttBrokerOrder(roomKey = '') {
      // 仅供 legacy 兼容层使用；生产联机不再探测公共 Broker。
      return MQTT_BROKER_URLS.map((url, index) => ({ url, index }));
    }

    // 项目自有的 WebSocket 房间中继适配器。它故意实现和旧 MQTT 客户端相同的
    // 最小接口，这样既能复用已有的 ACK、去重、P2P 探测和重连状态机，
    // 以便复用旧业务层，同时把生产信令固定在项目自己的 Cloudflare 入口。
    class RoomRelayClient {
      constructor(endpoint, roomCode, role, sessionId = '', joinTicket = '') {
        this.url = endpoint;
        this.roomKey = String(roomCode || '');
        this.roomCode = this.roomKey;
        this.role = role;
        this.sessionId = String(sessionId || '');
        this.joinTicket = String(joinTicket || '');
        this.transportType = 'relay';
        this.connected = false;
        this.closed = false;
        this.listeners = new Map();
        this.subscriptions = new Map();
        this.ws = null;
        this.connectTimer = null;
        this.readySettled = false;
        this.readyPromise = new Promise((resolve, reject) => {
          this._resolveReady = resolve;
          this._rejectReady = reject;
        });
        this._open();
      }

      _emit(event, ...args) {
        const list = (this.listeners.get(event) || []).slice();
        for (const item of list) {
          if (item.once) this.removeListener(event, item.fn);
          try { item.fn(...args); } catch (error) { console.error(`[Room relay ${event}]`, error); }
        }
      }

      on(event, fn) {
        if (typeof fn !== 'function') return this;
        const list = this.listeners.get(event) || [];
        list.push({ fn, once: false });
        this.listeners.set(event, list);
        return this;
      }

      once(event, fn) {
        if (typeof fn !== 'function') return this;
        const list = this.listeners.get(event) || [];
        list.push({ fn, once: true });
        this.listeners.set(event, list);
        return this;
      }

      removeListener(event, fn) {
        const list = this.listeners.get(event) || [];
        this.listeners.set(event, list.filter(item => item.fn !== fn));
        return this;
      }

      isUsable() {
        return !this.closed && this.connected && this.ws && this.ws.readyState === 1;
      }

      _buildUrl() {
        const url = new URL(this.url);
        url.searchParams.set('room', this.roomCode);
        url.searchParams.set('role', this.role);
        if (this.sessionId) url.searchParams.set('session', this.sessionId);
        if (this.joinTicket) url.searchParams.set('ticket', this.joinTicket);
        return url.href;
      }

      _open() {
        if (typeof WebSocket === 'undefined') {
          this._failInitial(new Error('当前 WebView 不支持 WebSocket'));
          return;
        }
        let socket;
        try { socket = new WebSocket(this._buildUrl()); } catch (error) {
          this._failInitial(error);
          return;
        }
        this.ws = socket;
        const failInitial = error => {
          if (!this.readySettled) this._failInitial(error || new Error('房间中继连接失败'));
        };
        socket.onopen = () => {
          if (this.closed) return;
          if (this.connectTimer) clearTimeout(this.connectTimer);
          this.connectTimer = null;
          this.connected = true;
          if (!this.readySettled) {
            this.readySettled = true;
            this._resolveReady(this);
          }
          this._emit('connect');
          for (const topic of this.subscriptions.keys()) this._send({ type: 'subscribe', topic });
        };
        socket.onmessage = event => {
          const raw = typeof event.data === 'string' ? event.data : '';
          if (!raw || raw.length > 96 * 1024) return;
          let message;
          try { message = JSON.parse(raw); } catch (_) { return; }
          if (!message || typeof message !== 'object' || Array.isArray(message)) return;
          if (message.type === 'relay_ready') {
            if (typeof message.sessionId === 'string' && message.sessionId.length <= 96) {
              this.relaySessionId = message.sessionId;
            }
            this._emit('relay_ready', message);
            return;
          }
          if (message.type === 'relay_peer_left') {
            this._emit('offline');
            this._emit('close');
            // 对端离开时主动释放本地 WebSocket；否则旧 relay 仍可能保持
            // connected=true，重连逻辑会误把它复用成“假在线”连接。
            this.end(true);
            return;
          }
          if (message.type === 'relay_error') {
            const error = new Error(String(message.message || '房间中继拒绝了消息'));
            this._emit('error', error);
            return;
          }
          if (message.type !== 'message' || typeof message.topic !== 'string' ||
              typeof message.payload !== 'string') return;
          this._emit('message', message.topic, message.payload);
        };
        socket.onerror = () => {
          const error = new Error('房间中继网络异常');
          failInitial(error);
          this._emit('error', error);
        };
        socket.onclose = () => {
          if (this.connectTimer) clearTimeout(this.connectTimer);
          this.connectTimer = null;
          const wasConnected = this.connected;
          this.connected = false;
          if (!this.readySettled) failInitial(new Error('房间中继连接关闭'));
          if (!this.closed && wasConnected) {
            this._emit('offline');
            this._emit('close');
          }
        };
        this.connectTimer = setTimeout(() => {
          if (!this.isUsable()) {
            try { socket.close(); } catch (_) {}
            failInitial(new Error('房间中继连接超时'));
          }
        }, ONLINE_RELAY_CONNECT_TIMEOUT_MS);
      }

      _failInitial(error) {
        if (this.readySettled) return;
        this.readySettled = true;
        this._rejectReady(error || new Error('房间中继连接失败'));
        this._closeSocket(true);
      }

      _closeSocket(force = true) {
        if (this.connectTimer) clearTimeout(this.connectTimer);
        this.connectTimer = null;
        try { if (this.ws) this.ws.close(force ? 1000 : undefined); } catch (_) {}
      }

      _send(payload) {
        if (!this.isUsable()) return false;
        try {
          this.ws.send(JSON.stringify(payload));
          return true;
        } catch (_) {
          return false;
        }
      }

      subscribe(topic, options, callback) {
        const cb = typeof options === 'function' ? options : callback;
        const normalizedTopic = String(topic || '');
        this.subscriptions.set(normalizedTopic, options && typeof options === 'object' ? options : {});
        if (this.isUsable()) this._send({ type: 'subscribe', topic: normalizedTopic });
        if (typeof cb === 'function') setTimeout(() => cb(), 0);
      }

      publish(topic, payload, _options) {
        const text = payload && typeof payload.toString === 'function' ? payload.toString() : String(payload ?? '');
        return this._send({ type: 'publish', topic: String(topic || ''), payload: text });
      }

      end(force = true) {
        if (this.closed) return;
        this.closed = true;
        this.connected = false;
        this._closeSocket(force);
      }
    }

    // 旧版 MQTT 兼容池：仅在显式 legacy 开关下用于迁移/自动化测试。
    // 生产用户不会创建这些公共 Broker 连接。
    const MQTT_FALLBACK_STAGGER_MS = 300;
    const MQTT_RECONNECT_INITIAL_DELAY_MS = 1500;
    const MQTT_RECONNECT_MAX_DELAY_MS = 15000;

    class MqttClientPool {
      constructor(m, roomKey, candidates) {
        this.library = m;
        this.roomKey = String(roomKey || '');
        this.candidates = Array.isArray(candidates) ? candidates : [];
        this.clients = new Map();
        this.pendingCandidates = new Set();
        this.initialCandidatesPending = 0;
        this.retryTimers = new Map();
        this.retryAttempts = new Map();
        this.subscriptions = new Map();
        this.listeners = new Map();
        this.connected = false;
        this.closed = false;
        this.__gomokuLifecycleBound = false;
        this._readySettled = false;
        this.readyPromise = new Promise((resolve, reject) => {
          this._resolveReady = resolve;
          this._rejectReady = reject;
        });
        this._startCandidates();
      }

      _startCandidates() {
        if (!this.candidates.length) {
          this._rejectReady(new Error('没有可用的信令节点'));
          return;
        }
        let settledCandidates = 0;
        this.initialCandidatesPending = this.candidates.length;
        const finishCandidate = () => {
          this.initialCandidatesPending = Math.max(0, this.initialCandidatesPending - 1);
          settledCandidates++;
          if (settledCandidates >= this.candidates.length && !this._readySettled && this.clients.size === 0) {
            this._readySettled = true;
            this._rejectReady(new Error('所有信令节点均连接失败，请检查网络后重试'));
          }
        };
        this.candidates.forEach((candidate, index) => {
          let finalized = false;
          const finishOnce = () => {
            if (finalized) return;
            finalized = true;
            finishCandidate();
          };
          void (async () => {
            if (index > 0) {
              await new Promise(resolve => setTimeout(resolve, index * MQTT_FALLBACK_STAGGER_MS));
            }
            if (this.closed) {
              finishOnce();
              return;
            }
            try {
              const client = await this._connectCandidate(candidate);
              this._adoptClient(candidate, client);
            } catch (err) {
              console.warn(`[MQTT] 节点 ${candidate.index + 1}/${MQTT_BROKER_URLS.length} 不可用`, err || '');
            } finally {
              finishOnce();
            }
          })().catch((err) => {
            console.warn(`[MQTT] 节点 ${candidate.index + 1}/${MQTT_BROKER_URLS.length} 探测异常`, err || '');
            finishOnce();
          });
        });
      }

      _getLiveEntries() {
        return [...this.clients.values()].filter(entry => entry && entry.client && entry.client.connected);
      }

      isUsable() {
        if (this.closed) return false;
        const liveEntries = this._getLiveEntries();
        if (!liveEntries.length) {
          if (this.clients.size > 0) this._markPoolOffline('连接状态失效');
          else this.connected = false;
          return false;
        }
        this.connected = true;
        return true;
      }

      _markPoolOffline(eventName = '断开') {
        if (this.closed) return;
        this.closed = true;
        this.connected = false;
        for (const timer of this.retryTimers.values()) clearTimeout(timer);
        this.retryTimers.clear();
        this.pendingCandidates.clear();
        const entries = [...this.clients.values()];
        this.clients.clear();
        for (const entry of entries) {
          try { entry.client.removeListener('message', entry.message); } catch (_) {}
          try { entry.client.removeListener('close', entry.close); } catch (_) {}
          try { entry.client.removeListener('offline', entry.offline); } catch (_) {}
          try { entry.client.removeListener('error', entry.error); } catch (_) {}
          try { entry.client.end(true); } catch (_) {}
        }
        console.warn(`[MQTT] 房间信令池已${eventName}，准备自动重连`);
        this.emit('offline');
        this.emit('close');
      }

      invalidate(reason = '网络切换') {
        this._markPoolOffline(reason);
      }

      _connectCandidate(candidate) {
        return new Promise((resolve, reject) => {
          let client = null;
          let timer = null;
          let settled = false;
          const cleanup = () => {
            if (timer) clearTimeout(timer);
            if (!client) return;
            try { client.removeListener('connect', onConnect); } catch (_) {}
            try { client.removeListener('error', onError); } catch (_) {}
            try { client.removeListener('close', onClose); } catch (_) {}
          };
          const fail = (reason) => {
            if (settled) return;
            settled = true;
            cleanup();
            try { if (client) client.end(true); } catch (_) {}
            reject(reason || new Error('连接关闭'));
          };
          const onConnect = () => {
            if (settled) return;
            settled = true;
            cleanup();
            resolve(client);
          };
          const onError = err => fail(err || new Error('信令节点错误'));
          const onClose = () => fail(new Error('连接关闭'));

          try {
            client = this.library.connect(candidate.url, {
              clientId: generateSecureId(9, 'gk_'),
              connectTimeout: MQTT_CONNECT_TIMEOUT_MS,
              keepalive: 25,
              clean: true,
              reconnectPeriod: 0
            });
            client.once('connect', onConnect);
            client.once('error', onError);
            client.once('close', onClose);
            timer = setTimeout(() => {
              if (!client.connected) fail(new Error('连接超时'));
            }, MQTT_CONNECT_TIMEOUT_MS + 500);
          } catch (err) {
            fail(err);
          }
        });
      }

      _adoptClient(candidate, client) {
        if (!client || this.closed) {
          try { if (client) client.end(true); } catch (_) {}
          return;
        }
        const retryTimer = this.retryTimers.get(candidate.url);
        if (retryTimer) clearTimeout(retryTimer);
        this.retryTimers.delete(candidate.url);
        this.pendingCandidates.delete(candidate.url);
        this.retryAttempts.delete(candidate.url);
        const entry = {
          candidate,
          client,
          message: (topic, payload) => this.emit('message', topic, payload),
          close: () => this._removeClient(candidate.url, '断开'),
          offline: () => this._removeClient(candidate.url, '离线'),
          error: err => {
            console.warn(`[MQTT] 节点 ${candidate.index + 1}/${MQTT_BROKER_URLS.length} 运行异常`, err || '');
            if (!client.connected) this._removeClient(candidate.url, '异常');
          }
        };
        this.clients.set(candidate.url, entry);
        client.on('message', entry.message);
        client.on('close', entry.close);
        client.on('offline', entry.offline);
        client.on('error', entry.error);
        this.connected = true;
        console.info(`[MQTT] 已连接信令节点 ${candidate.index + 1}/${MQTT_BROKER_URLS.length}`);
        if (!this._readySettled) {
          this._readySettled = true;
          this._resolveReady(this);
        }
        for (const [topic, options] of this.subscriptions) {
          try { client.subscribe(topic, options, () => {}); } catch (_) {}
        }
      }

      _scheduleCandidateRetry(candidate) {
        if (!candidate || this.closed || this.clients.has(candidate.url) ||
            this.pendingCandidates.has(candidate.url) || this.retryTimers.has(candidate.url)) return;
        const attempt = this.retryAttempts.get(candidate.url) || 0;
        const delay = Math.min(MQTT_RECONNECT_MAX_DELAY_MS,
          MQTT_RECONNECT_INITIAL_DELAY_MS * (2 ** Math.min(attempt, 4)));
        this.retryAttempts.set(candidate.url, attempt + 1);
        const timer = setTimeout(() => {
          this.retryTimers.delete(candidate.url);
          if (this.closed || this.clients.has(candidate.url) || this.pendingCandidates.has(candidate.url)) return;
          this.pendingCandidates.add(candidate.url);
          this._connectCandidate(candidate).then(client => {
            this.pendingCandidates.delete(candidate.url);
            if (this.closed || this.clients.has(candidate.url)) {
              try { client.end(true); } catch (_) {}
              return;
            }
            this._adoptClient(candidate, client);
          }).catch(err => {
            this.pendingCandidates.delete(candidate.url);
            if (this.closed || this.clients.size === 0) return;
            console.warn(`[MQTT] 节点 ${candidate.index + 1}/${MQTT_BROKER_URLS.length} 重连失败`, err || '');
            this._scheduleCandidateRetry(candidate);
          });
        }, delay);
        this.retryTimers.set(candidate.url, timer);
      }

      _removeClient(url, eventName = '断开') {
        const entry = this.clients.get(url);
        if (!entry) return;
        this.clients.delete(url);
        try { entry.client.removeListener('message', entry.message); } catch (_) {}
        try { entry.client.removeListener('close', entry.close); } catch (_) {}
        try { entry.client.removeListener('offline', entry.offline); } catch (_) {}
        try { entry.client.removeListener('error', entry.error); } catch (_) {}
        if (this.clients.size > 0) this._scheduleCandidateRetry(entry.candidate);
        if (this.clients.size === 0 && !this.closed && this.initialCandidatesPending === 0) {
          this._markPoolOffline(eventName);
        }
      }

      subscribe(topic, options, callback) {
        const opts = options && typeof options === 'object' ? options : {};
        const cb = typeof options === 'function' ? options : callback;
        this.subscriptions.set(String(topic), opts);
        const entries = this._getLiveEntries();
        if (!entries.length) {
          this._markPoolOffline('订阅时连接失效');
          if (typeof cb === 'function') setTimeout(() => cb(new Error('信令连接尚未就绪')), 0);
          return;
        }
        let pending = entries.length;
        let completed = false;
        let lastError = null;
        const finish = err => {
          if (completed) return;
          if (!err) {
            completed = true;
            if (typeof cb === 'function') cb();
            return;
          }
          lastError = err;
          pending--;
          if (pending <= 0) {
            completed = true;
            if (typeof cb === 'function') cb(lastError);
          }
        };
        entries.forEach(entry => {
          try {
            entry.client.subscribe(topic, opts, err => finish(err || null));
          } catch (err) {
            finish(err);
          }
        });
      }

      publish(topic, payload, options) {
        let sent = false;
        const entries = this._getLiveEntries();
        if (!entries.length) {
          this._markPoolOffline('发送时连接失效');
          return false;
        }
        for (const entry of entries) {
          try {
            entry.client.publish(topic, payload, options);
            sent = true;
          } catch (_) {}
        }
        this.connected = sent;
        if (!sent) this._markPoolOffline('发送失败');
        return sent;
      }

      on(event, fn) {
        if (typeof fn !== 'function') return this;
        const list = this.listeners.get(event) || [];
        list.push({ fn, once: false });
        this.listeners.set(event, list);
        return this;
      }

      once(event, fn) {
        if (typeof fn !== 'function') return this;
        const list = this.listeners.get(event) || [];
        list.push({ fn, once: true });
        this.listeners.set(event, list);
        return this;
      }

      removeListener(event, fn) {
        const list = this.listeners.get(event) || [];
        this.listeners.set(event, list.filter(item => item.fn !== fn));
        return this;
      }

      emit(event, ...args) {
        const list = (this.listeners.get(event) || []).slice();
        for (const item of list) {
          if (item.once) this.removeListener(event, item.fn);
          try { item.fn(...args); } catch (err) { console.error(`[MQTT Pool ${event} error]`, err); }
        }
      }

      end(force = true) {
        if (this.closed) return;
        this.closed = true;
        this.connected = false;
        for (const timer of this.retryTimers.values()) clearTimeout(timer);
        this.retryTimers.clear();
        this.pendingCandidates.clear();
        for (const entry of this.clients.values()) {
          try { entry.client.removeListener('message', entry.message); } catch (_) {}
          try { entry.client.removeListener('close', entry.close); } catch (_) {}
          try { entry.client.removeListener('offline', entry.offline); } catch (_) {}
          try { entry.client.removeListener('error', entry.error); } catch (_) {}
          try { entry.client.end(force); } catch (_) {}
        }
        this.clients.clear();
      }
    }

    function watchMqttClientLifecycle(client) {
      if (!client || client.__gomokuLifecycleBound) return;
      client.__gomokuLifecycleBound = true;
      const invalidate = (eventName) => {
        if (mqttClient === client) {
          mqttClient = null;
          console.warn(`[MQTT] 活跃信令连接已${eventName}，准备自动重连`);
        }
      };
      client.on('close', () => invalidate('断开'));
      client.on('offline', () => invalidate('离线'));
      client.on('error', (err) => console.warn('[MQTT Client Error]', err));
    }

    function closeMqttClientPool() {
      const client = mqttClient;
      mqttClientRequestSeq++;
      onlineTransportRequestSeq++;
      mqttClient = null;
      mqttClientPromise = null;
      mqttClientPromiseRoomKey = '';
      onlineTransportPromise = null;
      onlineTransportPromiseKey = '';
      if (client) {
        try { client.end(true); } catch (_) {}
      }
    }

    function isMqttPoolUsable(client) {
      if (!client) return false;
      if (typeof client.isUsable === 'function') return client.isUsable();
      return client.connected === true;
    }

    function getOrCreateMqttClient(roomKey = '') {
      const normalizedRoomKey = String(roomKey || '');
      if (mqttClient && mqttClient.roomKey === normalizedRoomKey && isMqttPoolUsable(mqttClient)) {
        return Promise.resolve(mqttClient);
      }
      if (mqttClient && mqttClient.roomKey === normalizedRoomKey && !isMqttPoolUsable(mqttClient)) {
        closeMqttClientPool();
      }
      if (mqttClientPromise) {
        if (mqttClientPromiseRoomKey === normalizedRoomKey) return mqttClientPromise;
        const previousPromise = mqttClientPromise;
        return previousPromise.catch(() => null).then(() => getOrCreateMqttClient(normalizedRoomKey));
      }

      if (mqttClient && mqttClient.roomKey !== normalizedRoomKey) {
        closeMqttClientPool();
      }

      const requestSeq = ++mqttClientRequestSeq;
      const promise = waitForMqttLibrary().then(m => {
        const pool = new MqttClientPool(m, normalizedRoomKey, getMqttBrokerOrder(normalizedRoomKey));
        return pool.readyPromise.then(() => {
          if (requestSeq !== mqttClientRequestSeq || pool.closed) {
            pool.end(true);
            throw new Error('信令连接请求已取消');
          }
          mqttClient = pool;
          mqttClientPromise = null;
          mqttClientPromiseRoomKey = '';
          watchMqttClientLifecycle(pool);
          return pool;
        });
      });
      mqttClientPromise = promise;
      mqttClientPromiseRoomKey = normalizedRoomKey;
      promise.catch(() => {
        if (mqttClientPromise === promise) {
          mqttClientPromise = null;
          mqttClientPromiseRoomKey = '';
        }
      });
      return promise;
    }

    function isOnlineRelayEnabled() {
      try {
        if (window.__GOMOKU_DISABLE_RELAY__ === true) return false;
      } catch (_) {}
      return typeof WebSocket !== 'undefined';
    }

    async function connectRoomRelay(roomKey, role, sessionId = '') {
      // 同一房间的同一角色不能并行连接两个 DO 入口：后建立的连接会让
      // 前一个连接被判定为重复会话，表现为“一边进房、另一边断开”。
      // 因此这里按主入口 -> Pages 备用入口串行切换。
      let lastError = null;
      const preferredRelayOrigin = typeof activeApiHost === 'string' ? activeApiHost.replace(/^http/, 'ws') : '';
      const orderedRelayEndpoints = [...ONLINE_RELAY_ENDPOINTS].sort((left, right) => {
        const leftPreferred = preferredRelayOrigin && left.startsWith(preferredRelayOrigin) ? 1 : 0;
        const rightPreferred = preferredRelayOrigin && right.startsWith(preferredRelayOrigin) ? 1 : 0;
        return rightPreferred - leftPreferred;
      });
      for (const endpoint of orderedRelayEndpoints) {
        const relay = new RoomRelayClient(endpoint, roomKey, role, sessionId, role === 'host' ? onlineJoinTicket : '');
        try {
          return await relay.readyPromise;
        } catch (error) {
          lastError = error;
          try { relay.end(true); } catch (_) {}
        }
      }
      throw lastError || new Error('自有房间中继不可用');
    }

    function isLegacyMqttFallbackEnabled() {
      // 公共 MQTT 只保留给旧版迁移/自动化测试，正常构建和用户流程默认关闭。
      try { return window.__GOMOKU_ENABLE_LEGACY_MQTT__ === true; } catch (_) { return false; }
    }

    // 生产联机只使用项目自有 Durable Object WebSocket 中继。
    // P2P/TURN 仍负责低延迟数据通道；WebSocket 中继负责信令和最终可靠兜底。
    function getOrCreateOnlineTransport(roomKey = '', role = 'host', sessionId = '') {
      const normalizedRoomKey = String(roomKey || '');
      const normalizedRole = role === 'client' ? 'client' : 'host';
      const normalizedSessionId = String(sessionId || '');
      const transportKey = `${normalizedRoomKey}|${normalizedRole}|${normalizedSessionId}`;
      const currentMatches = mqttClient && mqttClient.roomKey === normalizedRoomKey &&
        mqttClient.transportType === 'relay' && mqttClient.role === normalizedRole &&
        (normalizedRole !== 'host' || mqttClient.sessionId === normalizedSessionId) &&
        isMqttPoolUsable(mqttClient);
      const mqttMatches = mqttClient && mqttClient.roomKey === normalizedRoomKey &&
        mqttClient.transportType !== 'relay' && isMqttPoolUsable(mqttClient);
      if (currentMatches || mqttMatches) return Promise.resolve(mqttClient);
      if (mqttClient && mqttClient.roomKey === normalizedRoomKey && !isMqttPoolUsable(mqttClient)) {
        closeMqttClientPool();
      }
      if (mqttClient && mqttClient.roomKey === normalizedRoomKey && mqttClient.transportType === 'relay' && !currentMatches) {
        closeMqttClientPool();
      }
      if (mqttClient && mqttClient.roomKey !== normalizedRoomKey) closeMqttClientPool();
      if (onlineTransportPromise) {
        if (onlineTransportPromiseKey === transportKey) return onlineTransportPromise;
        const previousPromise = onlineTransportPromise;
        return previousPromise.catch(() => null).then(() => getOrCreateOnlineTransport(normalizedRoomKey, normalizedRole, normalizedSessionId));
      }

      const requestSeq = ++onlineTransportRequestSeq;
      const relayAttempt = isOnlineRelayEnabled()
        ? connectRoomRelay(normalizedRoomKey, normalizedRole, normalizedSessionId)
        : Promise.reject(new Error('本地测试已禁用自有中继'));
      const promise = relayAttempt.catch((relayError) => {
        if (!isLegacyMqttFallbackEnabled()) {
          console.error('[Room relay] 项目自有 WebSocket 中继不可用:', relayError?.message || relayError);
          throw new Error('项目联机中继不可用，请检查网络后重试');
        }
        console.warn('[Legacy MQTT] 仅测试/迁移开关已启用，使用公共 MQTT 兼容通道:', relayError?.message || relayError);
        return getOrCreateMqttClient(normalizedRoomKey);
      }).then(client => {
        if (requestSeq !== onlineTransportRequestSeq || !client || client.closed) {
          try { client?.end(true); } catch (_) {}
          throw new Error('联机传输请求已取消');
        }
        mqttClient = client;
        watchMqttClientLifecycle(client);
        return client;
      });
      onlineTransportPromise = promise;
      onlineTransportPromiseKey = transportKey;
      promise.finally(() => {
        if (onlineTransportPromise === promise) {
          onlineTransportPromise = null;
          onlineTransportPromiseKey = '';
        }
      }).catch(() => {});
      return promise;
    }

    const P2P_SIGNAL_RETRY_MS = 900;
    const P2P_SIGNAL_TIMEOUT_MS = 12000;
    const P2P_RECOVERY_INITIAL_DELAY_MS = 1200;
    const P2P_RECOVERY_MAX_DELAY_MS = 30000;
    const P2P_DISCONNECTED_GRACE_MS = 2500;
    const P2P_ICE_RESTART_WAIT_MS = 1800;
    const MAX_P2P_REMOTE_ICE_CANDIDATES = 128;
    const DEFAULT_WEBRTC_ICE_SERVERS = [
      { urls: 'stun:stun.cloudflare.com:3478' }
    ];
    const RTC_ICE_CACHE_MAX_AGE_MS = 45 * 60 * 1000;
    let cachedRtcIceServers = null;
    let cachedRtcIceServersExpiresAt = 0;
    let rtcIceServersPromise = null;

    function normalizeRtcIceServers(value) {
      if (!Array.isArray(value)) return [];
      return value.map((server) => {
        if (!server || typeof server !== 'object' || Array.isArray(server)) return null;
        const rawUrls = Array.isArray(server.urls) ? server.urls : [server.urls];
        const urls = rawUrls.filter((url) => {
          if (typeof url !== 'string' || url.length < 8 || url.length > 512) return false;
          if (!/^(?:stun|turn|turns):/i.test(url)) return false;
          return !/:(?:53)(?:[/?]|$)/.test(url);
        });
        if (!urls.length) return null;
        const normalized = { urls };
        if (typeof server.username === 'string' && server.username.length <= 256) normalized.username = server.username;
        if (typeof server.credential === 'string' && server.credential.length <= 512) normalized.credential = server.credential;
        return normalized;
      }).filter(Boolean);
    }

    async function getWebRtcIceServers() {
      const now = Date.now();
      if (Array.isArray(cachedRtcIceServers) && cachedRtcIceServers.length && now < cachedRtcIceServersExpiresAt) {
        return cachedRtcIceServers;
      }
      if (rtcIceServersPromise) return rtcIceServersPromise;

      rtcIceServersPromise = (async () => {
        try {
          const response = await safeApiFetch('/api/rtc/ice-servers', {
            method: 'GET',
            cache: 'no-store',
            timeoutMs: 7000
          });
          const payload = await response.json().catch(() => null);
          const servers = normalizeRtcIceServers(payload?.data?.iceServers || payload?.iceServers);
          if (!response.ok || payload?.code !== 0 || !servers.length) {
            throw new Error(payload?.msg || `TURN 配置获取失败 (${response.status})`);
          }
          const expiresAt = Number(payload?.data?.expiresAt);
          cachedRtcIceServers = servers;
          cachedRtcIceServersExpiresAt = Math.min(
            Number.isFinite(expiresAt) && expiresAt > now ? expiresAt - 60 * 1000 : now + RTC_ICE_CACHE_MAX_AGE_MS,
            now + RTC_ICE_CACHE_MAX_AGE_MS
          );
          return servers;
        } catch (error) {
          // TURN 不可用时继续使用 STUN；项目自有 WebSocket 中继仍可承接信令，
          // 不能因凭据接口失败阻断进房。
          console.warn('[WebRTC ICE] TURN 凭据获取失败，回退 STUN:', error?.message || error);
          return DEFAULT_WEBRTC_ICE_SERVERS;
        } finally {
          rtcIceServersPromise = null;
        }
      })();
      return rtcIceServersPromise;
    }

    function getWebRtcIceServersForProbe() {
      const now = Date.now();
      if (Array.isArray(cachedRtcIceServers) && cachedRtcIceServers.length && now < cachedRtcIceServersExpiresAt) {
        return cachedRtcIceServers;
      }
      // TURN 凭据获取属于增强路径，不能阻塞首个 P2P 探测；先用公共 STUN 建链，后台并行刷新 TURN。
      // 如果当前网络必须走 TURN，首轮 ICE 失败后会进入既有指数退避恢复，并使用已缓存的 TURN 配置。
      void getWebRtcIceServers().catch(() => {});
      return DEFAULT_WEBRTC_ICE_SERVERS;
    }

    async function getWebRtcIceServersForRecovery() {
      const immediate = getWebRtcIceServersForProbe();
      if (immediate !== DEFAULT_WEBRTC_ICE_SERVERS) return immediate;
      try {
        // 重连不能被 TURN 接口拖住；给临时凭据一个短窗口，超时就先用 STUN
        // 建链，后台请求完成后下一次 ICE 重建再自动带上新 TURN。
        return await Promise.race([
          getWebRtcIceServers(),
          new Promise(resolve => setTimeout(() => resolve(DEFAULT_WEBRTC_ICE_SERVERS), P2P_ICE_RESTART_WAIT_MS))
        ]);
      } catch (_) {
        return DEFAULT_WEBRTC_ICE_SERVERS;
      }
    }

    class MqttRoomConnection {
      constructor(client, roomCode, role, sessionId = '') {
        this.client = client;
        this.roomCode = roomCode;
        this.role = role;
        this.sessionId = typeof sessionId === 'string' ? sessionId.slice(0, 96) : '';
        this.open = true;
        this.closed = false;
        this.ready = false;
        this.listeners = { data: [], close: [], error: [], open: [] };

        // 会话 ID 进入 MQTT topic，避免同一 6 位房间码的旧局/撞码报文串入新局。
        // 没拿到会话 ID 时保留 v3 兼容路径，便于旧客户端完成升级过渡。
        const topicRoot = this.sessionId
          ? `gomoku/v4/${roomCode}/${this.sessionId}`
          : `gomoku/v3/${roomCode}`;
        this.pubTopic = role === 'host' ? `${topicRoot}/h2c` : `${topicRoot}/c2h`;
        this.subTopic = role === 'host' ? `${topicRoot}/c2h` : `${topicRoot}/h2c`;
        this.sigTopic = `${topicRoot}/p2p_speed_sig`;

        this.isP2pReady = false;
        this.pc = null;
        this.dc = null;
        this.p2pRoute = 'unknown';
        this.p2pStatsRttMs = null;
        this.p2pStatsTimer = null;
        this.p2pStatsInFlight = false;
        this.p2pHighRttStreak = 0;
        this.p2pReoptimizationCount = 0;
        this.p2pLastReoptimizationAt = 0;
        this.processedMsgIds = new Set();
        this.p2pProbeStarted = false;
        this.p2pSessionId = role === 'host' ? this._createSessionId() : '';
        this.localOffer = null;
        this.localAnswer = null;
        this.localIceCandidates = [];
        this.remoteIceCandidates = new Set();
        this.pendingRemoteIceCandidates = [];
        this.remoteDescriptionSet = false;
        this.remoteOfferSdp = '';
        this.signalRetryTimer = null;
        this.signalTask = Promise.resolve();
        this.p2pGeneration = 0;
        this.p2pRecoveryTimer = null;
        this.p2pRecoveryAttempts = 0;
        this.iceRestartInFlight = false;
        this.reliableRetryTimer = null;
        this.pendingMqttFailoverTimers = new Map();
        this.inboundWindowAt = Date.now();
        this.inboundMessageCount = 0;
        this.inboundSignalCount = 0;

        this.messageHandler = (topic, payload) => {
          const rawPayload = payload && typeof payload.toString === 'function' ? payload.toString() : '';
          if (topic === this.sigTopic) {
            this._handleIncomingPayload(rawPayload, true, 'mqtt');
            return;
          }
          if (topic !== this.subTopic) return;
          this._handleIncomingPayload(rawPayload, false, 'mqtt');
        };
        this.mqttCloseHandler = () => this._markTransportClosed(new Error('信令连接已断开'));
        this.mqttOfflineHandler = () => this._markTransportClosed(new Error('信令连接已离线'));
        this.mqttErrorHandler = (err) => {
          if (this.open && !isMqttPoolUsable(this.client)) this._markTransportClosed(err || new Error('信令网络异常'));
        };

        this.client.on('message', this.messageHandler);
        this.client.on('close', this.mqttCloseHandler);
        this.client.on('offline', this.mqttOfflineHandler);
        this.client.on('error', this.mqttErrorHandler);

        // 先确认房间信道订阅成功，再启动 WebRTC；避免一次性 offer/ICE 在订阅完成前丢失。
        this.readyPromise = this._prepareConnection();
        this.readyPromise.then(() => this._adoptPendingReliableMessages()).catch(() => {});
        this.readyPromise.catch(() => {});
      }

      _createSessionId() {
        return generateSecureId(12, 'p2p_');
      }

      _prepareConnection() {
        return this._subscribeTopics().then(() => {
          if (this.closed || !this.open) throw new Error('房间连接已关闭');
          this.ready = true;
          this._startSilentP2PProbe();
          this.emit('open');
          return this;
        }).catch((err) => {
          if (!this.closed) this._markTransportClosed(err);
          throw err;
        });
      }

      _subscribeTopics() {
        return new Promise((resolve, reject) => {
          if (!isMqttPoolUsable(this.client)) {
            reject(new Error('信令连接尚未就绪'));
            return;
          }
          const topics = [this.subTopic, this.sigTopic];
          let pending = topics.length;
          let finished = false;
          const timer = setTimeout(() => finish(new Error('房间信道订阅超时')), 6000);
          const finish = (err) => {
            if (finished) return;
            finished = true;
            clearTimeout(timer);
            if (err) reject(err); else resolve();
          };
          topics.forEach((topic) => {
            try {
              const qos = topic === this.sigTopic ? 0 : MQTT_ROOM_DATA_QOS;
              this.client.subscribe(topic, { qos }, (err) => {
                if (err) return finish(err);
                pending--;
                if (pending === 0) finish();
              });
            } catch (err) {
              finish(err);
            }
          });
        });
      }

      _publishSignal(type, extra = {}) {
        if (!this.open || !isMqttPoolUsable(this.client) || !P2P_SIGNAL_TYPES.has(type)) return false;
        const signal = { ...extra, sender: this.role, type };
        if (this.p2pSessionId) signal.sessionId = this.p2pSessionId;
        try {
          const payload = JSON.stringify(signal);
          if (getOnlinePayloadByteLength(payload) > MAX_ONLINE_PAYLOAD_BYTES) return false;
          this.client.publish(this.sigTopic, payload, { qos: 0 });
          return true;
        } catch (err) {
          return false;
        }
      }

      _consumeInboundBudget(isSignal) {
        const now = Date.now();
        if (now - this.inboundWindowAt >= 1000) {
          this.inboundWindowAt = now;
          this.inboundMessageCount = 0;
          this.inboundSignalCount = 0;
        }
        if (isSignal) {
          if (this.inboundSignalCount >= MAX_ONLINE_SIGNAL_MESSAGES_PER_SECOND) return false;
          this.inboundSignalCount++;
          return true;
        }
        if (this.inboundMessageCount >= MAX_ONLINE_MESSAGES_PER_SECOND) return false;
        this.inboundMessageCount++;
        return true;
      }

      _handleIncomingPayload(rawPayload, isSignal = false, transport = 'mqtt') {
        if (typeof rawPayload !== 'string' || !rawPayload || rawPayload.length > 64 * 1024 ||
            getOnlinePayloadByteLength(rawPayload) > MAX_ONLINE_PAYLOAD_BYTES ||
            !this._consumeInboundBudget(isSignal)) return;
        let data;
        try { data = JSON.parse(rawPayload); } catch (_) { return; }
        if (!data || typeof data !== 'object' || Array.isArray(data) ||
            typeof data.type !== 'string' || data.type.length > 64) return;

        if (isSignal) {
          if (!P2P_SIGNAL_TYPES.has(data.type) || (data.sender !== 'host' && data.sender !== 'client')) return;
          this._queueWebRtcSignal(data);
          return;
        }

        if (!ONLINE_MESSAGE_TYPES.has(data.type)) return;
        // 新版连接把房间会话和发送角色写入每条业务报文。没有会话隔离的旧 v3
        // 连接仍可兼容接收；但进入 v4 topic 后必须带上完全匹配的 sessionId，
        // 避免旧连接、撞码报文或恶意跨房间注入混入当前棋局。
        if (this.sessionId &&
            (typeof data.sessionId !== 'string' || data.sessionId.length > 96 ||
             data.sessionId !== this.sessionId)) return;
        if (!this.sessionId && data.sessionId !== undefined &&
            (typeof data.sessionId !== 'string' || data.sessionId.length > 96)) return;
        if (data.senderRole !== undefined &&
            (data.senderRole !== 'host' && data.senderRole !== 'client' || data.senderRole === this.role)) return;
        if (data._mid !== undefined && (typeof data._mid !== 'string' || data._mid.length > 80)) return;
        if (data.type === 'delivery_ack' &&
            (typeof data.ackId !== 'string' || data.ackId.length === 0 || data.ackId.length > 80)) return;
        // ACK 也走两条链路，但不再向上层冒泡，避免被当成普通业务报文。
        if (data.type === 'delivery_ack') {
          this._acknowledgeReliableMessage(data.ackId);
          return;
        }
        // 先确认“传输层已收到”，再做业务去重。这样 P2P/中继重复到达时，
        // 即使首个 ACK 丢了，重复报文也能再次触发 ACK，而不会重复落子或重复聊天。
        if (RELIABLE_ONLINE_MESSAGE_TYPES.has(data.type) && data._mid) {
          this.send({ type: 'delivery_ack', ackId: data._mid });
        }
        // 消息去重（若 P2P 与中继收到同一条数据时自动忽略重复项）
        if (data._mid) {
          if (this.processedMsgIds.has(data._mid)) return;
          this.processedMsgIds.add(data._mid);
          if (this.processedMsgIds.size > 200) {
            const first = this.processedMsgIds.values().next().value;
            this.processedMsgIds.delete(first);
          }
        }
        this.emit('data', data, transport);
      }

      _republishP2PSignals() {
        if (this.role === 'host') {
          if (this.localOffer) this._publishSignal('offer', { sdp: this.localOffer.sdp });
          if (this.localIceCandidates.length) {
            // 重试时批量补发，避免每 900ms 为每个 ICE 候选重复制造 MQTT 报文。
            this._publishSignal('ice_batch', { candidates: this.localIceCandidates.slice(-64) });
          }
        } else if (this.localAnswer) {
          this._publishSignal('answer', { sdp: this.localAnswer.sdp });
        } else {
          // 客方没有房主 sessionId 时发送 hello；房主收到后会重发 offer 和 ICE。
          this._publishSignal('hello');
        }
      }

      _startSignalRetry() {
        if (this.signalRetryTimer) clearTimeout(this.signalRetryTimer);
        const startedAt = Date.now();
        const tick = () => {
          if (this.closed || !this.open || this.isP2pReady) {
            this.signalRetryTimer = null;
            return;
          }
          if (Date.now() - startedAt >= P2P_SIGNAL_TIMEOUT_MS) {
            this.signalRetryTimer = null;
            this._scheduleP2PRecovery('P2P 信令超时');
            return;
          }
          this._republishP2PSignals();
          this.signalRetryTimer = setTimeout(tick, P2P_SIGNAL_RETRY_MS);
        };
        tick();
      }

      _queueWebRtcSignal(sig) {
        this.signalTask = this.signalTask.then(() => this._handleWebRtcSignal(sig)).catch((err) => {
          if (this.closed) return;
          console.warn('[P2P signal]', err?.message || err);
          this._scheduleP2PRecovery('signal_error');
        });
      }

      _cancelP2PRecovery(resetAttempts = false) {
        if (this.p2pRecoveryTimer) clearTimeout(this.p2pRecoveryTimer);
        this.p2pRecoveryTimer = null;
        if (resetAttempts) this.p2pRecoveryAttempts = 0;
      }

      _scheduleP2PRecovery(reason = 'P2P 通道异常', delayOverride = null) {
        if (this.closed || !this.open || !this.ready) return;
        if ((this.isP2pReady || this.p2pRoute !== 'unknown') && typeof resetOnlineLatencyTelemetryForTransport === 'function') {
          resetOnlineLatencyTelemetryForTransport();
        }
        this.isP2pReady = false;
        this.p2pRoute = 'unknown';
        this.p2pHighRttStreak = 0;
        updateOnlineNetworkUI();
        if (this.p2pRecoveryTimer) return;

        const attempt = this.p2pRecoveryAttempts++;
        const delay = Number.isFinite(delayOverride)
          ? Math.max(0, delayOverride)
          : Math.min(P2P_RECOVERY_MAX_DELAY_MS,
              P2P_RECOVERY_INITIAL_DELAY_MS * (2 ** Math.min(attempt, 5)));
        console.warn(`[P2P] ${reason}，${delay}ms 后重建通道（第 ${this.p2pRecoveryAttempts} 次）`);
        this.p2pRecoveryTimer = setTimeout(() => {
          this.p2pRecoveryTimer = null;
          if (this.closed || !this.open || !this.ready) return;
          void this._attemptIceRestart(reason).then((restarted) => {
            if (!restarted && !this.closed && this.open && this.ready) {
              this._restartP2PProbe(reason);
            }
          });
        }, delay);
      }

      async _attemptIceRestart(reason = 'ICE 线路恢复') {
        if (this.closed || !this.open || !this.ready || this.role !== 'host' ||
            this.iceRestartInFlight || !this.pc || typeof this.pc.createOffer !== 'function') return false;
        // ICE restart 可以修复网络路径变化，但不能复活已经关闭的 SCTP
        // DataChannel。此时两端必须一起重建 PeerConnection，否则房主会一直
        // 保留“ICE connected + DataChannel closed”的假在线状态。
        if (/DataChannel/i.test(String(reason)) ||
            (this.dc && ['closing', 'closed'].includes(this.dc.readyState))) return false;
        const pc = this.pc;
        const generation = this.p2pGeneration;
        this.iceRestartInFlight = true;
        try {
          const iceServers = await getWebRtcIceServersForRecovery();
          if (this.closed || this.pc !== pc || this.p2pGeneration !== generation) return false;
          if (typeof pc.setConfiguration === 'function') {
            try { pc.setConfiguration({ iceServers, iceCandidatePoolSize: 4 }); } catch (_) {}
          }
          if (typeof pc.restartIce === 'function') {
            try { pc.restartIce(); } catch (_) {}
          }
          this.p2pSessionId = this._createSessionId();
          this.localOffer = null;
          this.localIceCandidates = [];
          this.remoteIceCandidates = new Set();
          this.pendingRemoteIceCandidates = [];
          this.remoteDescriptionSet = false;
          this.remoteOfferSdp = '';
          const offer = await pc.createOffer({ iceRestart: true });
          if (this.closed || this.pc !== pc || this.p2pGeneration !== generation) return false;
          await pc.setLocalDescription(offer);
          if (this.closed || this.pc !== pc || this.p2pGeneration !== generation || !pc.localDescription) return false;
          this.localOffer = { type: 'offer', sdp: pc.localDescription.sdp || offer.sdp };
          this._startSignalRetry();
          console.info(`[P2P] 已发起原位 ICE restart：${reason}`);
          return true;
        } catch (err) {
          console.warn('[P2P ICE restart]', err?.message || err);
          return false;
        } finally {
          if (this.p2pGeneration === generation) this.iceRestartInFlight = false;
        }
      }

      _resetP2PSession() {
        if (this.signalRetryTimer) clearTimeout(this.signalRetryTimer);
        this.signalRetryTimer = null;
        this._stopP2PStatsPolling();
        this.p2pRoute = 'unknown';
        this.p2pStatsRttMs = null;
        this.p2pHighRttStreak = 0;
        this.p2pSessionId = this.role === 'host' ? this._createSessionId() : '';
        this.localOffer = null;
        this.localAnswer = null;
        this.localIceCandidates = [];
        this.remoteIceCandidates = new Set();
        this.pendingRemoteIceCandidates = [];
        this.remoteDescriptionSet = false;
        this.remoteOfferSdp = '';
      }

      async _restartP2PProbe(reason = 'P2P 通道异常') {
        if (this.closed || !this.open || !this.ready) return;
        const iceServers = await getWebRtcIceServersForRecovery();
        if (this.closed || !this.open || !this.ready) return;
        this._disposeP2P();
        this.p2pProbeStarted = false;
        this._resetP2PSession();
        console.info(`[P2P] 开始第 ${this.p2pRecoveryAttempts} 次通道重建：${reason}`);
        this._startSilentP2PProbe(true, iceServers);
      }

      async _startSilentP2PProbe(force = false, iceServersOverride = null) {
        if (this.closed || (this.p2pProbeStarted && !force)) return;
        this.p2pProbeStarted = true;
        const generation = ++this.p2pGeneration;
        const isCurrent = () => !this.closed && this.p2pGeneration === generation;
        try {
          const RTCPC = window.RTCPeerConnection || window.webkitRTCPeerConnection;
          if (!RTCPC) {
            this.p2pProbeStarted = false;
            return;
          }
          const iceServers = Array.isArray(iceServersOverride) && iceServersOverride.length
            ? iceServersOverride
            : getWebRtcIceServersForProbe();
          if (!isCurrent()) return;
          const usingFallbackIce = iceServers === DEFAULT_WEBRTC_ICE_SERVERS;
          if (usingFallbackIce) {
            // TURN 配置到达后给首轮 STUN 一个短暂机会；若仍未直连，立即用缓存 TURN 重建，
            // 避免在必须中继的网络环境里等待浏览器把整轮 ICE 超时耗尽。
            getWebRtcIceServers().then((resolvedServers) => {
              if (!isCurrent() || this.isP2pReady || resolvedServers === DEFAULT_WEBRTC_ICE_SERVERS) return;
              setTimeout(() => {
                if (!isCurrent() || this.isP2pReady) return;
                this._scheduleP2PRecovery('TURN 凭据已就绪', 0);
              }, 1200);
            }).catch(() => {});
          }

          const pc = new RTCPC({
            iceServers,
            iceCandidatePoolSize: 4
          });
          if (!isCurrent()) {
            try { pc.close(); } catch (_) {}
            return;
          }
          this.pc = pc;
          this.p2pRoute = 'unknown';
          this.p2pStatsRttMs = null;
          this.p2pHighRttStreak = 0;
          updateOnlineNetworkUI();

          pc.onicecandidate = (e) => {
            if (!isCurrent() || !e.candidate) return;
            const candidate = typeof e.candidate.toJSON === 'function' ? e.candidate.toJSON() : e.candidate;
            this.localIceCandidates.push(candidate);
            if (this.localIceCandidates.length > 64) this.localIceCandidates.shift();
            this._publishSignal('ice', { candidate });
          };
          pc.onconnectionstatechange = () => {
            if (!isCurrent() || this.pc !== pc) return;
            if (pc.connectionState === 'connected' && this.dc && this.dc.readyState === 'open') {
              this._cancelP2PRecovery(true);
              this.isP2pReady = true;
              this._startP2PStatsPolling();
              updateOnlineNetworkUI();
            } else if (pc.connectionState === 'disconnected' &&
                       (this.remoteDescriptionSet || this.isP2pReady)) {
              this._scheduleP2PRecovery('PeerConnection 暂时断开', P2P_DISCONNECTED_GRACE_MS);
            } else if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
              this.isP2pReady = false;
              updateOnlineNetworkUI();
              this._scheduleP2PRecovery(`PeerConnection ${pc.connectionState}`);
            }
          };
          pc.oniceconnectionstatechange = () => {
            if (!isCurrent() || this.pc !== pc) return;
            if ((pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') &&
                this.dc && this.dc.readyState === 'open') {
              this._cancelP2PRecovery(true);
              this.isP2pReady = true;
              this._startP2PStatsPolling();
              updateOnlineNetworkUI();
            } else if (pc.iceConnectionState === 'disconnected' &&
                       (this.remoteDescriptionSet || this.isP2pReady)) {
              this._scheduleP2PRecovery('ICE 暂时断开', P2P_DISCONNECTED_GRACE_MS);
            } else if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'closed') {
              this.isP2pReady = false;
              updateOnlineNetworkUI();
              this._scheduleP2PRecovery(`ICE ${pc.iceConnectionState}`);
            }
          };

          if (this.role === 'host') {
            const dc = pc.createDataChannel('gomoku_dc', { ordered: true });
            this._bindDataChannel(dc, generation);
            pc.createOffer().then(async (offer) => {
              if (!isCurrent() || this.pc !== pc) return;
              await pc.setLocalDescription(offer);
              if (!isCurrent() || this.pc !== pc || !pc.localDescription) return;
              this.localOffer = { type: 'offer', sdp: pc.localDescription.sdp || offer.sdp };
              this._startSignalRetry();
            }).catch((err) => {
              if (!isCurrent()) return;
              console.warn('[P2P offer]', err);
              this._scheduleP2PRecovery('offer 创建失败');
            });
          } else {
            pc.ondatachannel = (e) => {
              if (isCurrent()) this._bindDataChannel(e.channel, generation);
            };
            // 客方主动 hello，解决房主 offer 早于客方订阅而丢失的问题。
            this._startSignalRetry();
          }
        } catch(err) {
          if (!isCurrent()) return;
          this.p2pProbeStarted = false;
          console.warn('[P2P silent probe init]', err);
          this._scheduleP2PRecovery('P2P 通道初始化失败');
        }
      }

      async _addRemoteIceCandidate(candidate) {
        const pc = this.pc;
        const generation = this.p2pGeneration;
        if (!pc || !candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return;
        let candidateKey = '';
        try { candidateKey = JSON.stringify(candidate); } catch (_) { return; }
        if (!candidateKey || candidateKey.length > 4096 || this.remoteIceCandidates.has(candidateKey) ||
            this.remoteIceCandidates.size >= MAX_P2P_REMOTE_ICE_CANDIDATES) return;
        if (!this.remoteDescriptionSet && this.pendingRemoteIceCandidates.length >= MAX_P2P_REMOTE_ICE_CANDIDATES) return;
        this.remoteIceCandidates.add(candidateKey);
        if (!this.remoteDescriptionSet) {
          this.pendingRemoteIceCandidates.push(candidate);
          return;
        }
        if (this.pc !== pc || this.p2pGeneration !== generation || this.closed) return;
        try { await pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch (_) {}
      }

      async _handleWebRtcSignal(sig) {
        const pc = this.pc;
        const generation = this.p2pGeneration;
        if (!sig || !this.open || !pc || sig.sender === this.role) return;
        if (typeof sig.type !== 'string' || sig.type.length > 16) return;

        // hello 不需要 sessionId；它的作用是请求房主重新发送当前 session 的 offer/ICE。
        if (sig.type === 'hello' && this.role === 'host') {
          this._republishP2PSignals();
          return;
        }
        if (!sig.sessionId || typeof sig.sessionId !== 'string' || sig.sessionId.length > 80) return;

        if (this.role === 'client') {
          // 房主做原位 ICE restart 时会换 P2P sessionId，但不应销毁整个
          // DataChannel/MQTT 房间连接。客方接受新的 offer，并让浏览器完成
          // ICE 重协商；只有真正失败时才进入完整重建。
          if (sig.type === 'offer' && this.p2pSessionId && this.p2pSessionId !== sig.sessionId) {
            this.p2pSessionId = sig.sessionId;
            this.remoteDescriptionSet = false;
            this.remoteOfferSdp = '';
            this.remoteIceCandidates = new Set();
            this.pendingRemoteIceCandidates = [];
            this.localAnswer = null;
          }
          if (!this.p2pSessionId) this.p2pSessionId = sig.sessionId;
          if (this.p2pSessionId !== sig.sessionId) return;
        } else if (this.p2pSessionId !== sig.sessionId) {
          return;
        }

        if (sig.type === 'offer' && this.role === 'client' && typeof sig.sdp === 'string' && sig.sdp.length <= 128 * 1024) {
          if (this.remoteDescriptionSet && this.remoteOfferSdp === sig.sdp) {
            this._republishP2PSignals();
            return;
          }
          if (this.pc !== pc || this.p2pGeneration !== generation) return;
          await pc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp: sig.sdp }));
          if (this.pc !== pc || this.p2pGeneration !== generation) return;
          this.remoteDescriptionSet = true;
          this.remoteOfferSdp = sig.sdp;
          await this._flushRemoteIceCandidates();
          if (this.pc !== pc || this.p2pGeneration !== generation) return;
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          if (this.pc !== pc || this.p2pGeneration !== generation) return;
          this.localAnswer = { type: 'answer', sdp: pc.localDescription?.sdp || answer.sdp };
          this._republishP2PSignals();
          return;
        }

        if (sig.type === 'answer' && this.role === 'host' && typeof sig.sdp === 'string' && sig.sdp.length <= 128 * 1024) {
          if (pc.signalingState === 'have-local-offer' && !this.remoteDescriptionSet) {
            await pc.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: sig.sdp }));
            if (this.pc !== pc || this.p2pGeneration !== generation) return;
            this.remoteDescriptionSet = true;
            await this._flushRemoteIceCandidates();
          }
          return;
        }

        if (sig.type === 'ice') {
          await this._addRemoteIceCandidate(sig.candidate);
          return;
        }

        if (sig.type === 'ice_batch' && Array.isArray(sig.candidates) && sig.candidates.length <= 64) {
          for (const candidate of sig.candidates) {
            await this._addRemoteIceCandidate(candidate);
          }
        }
      }

      async _flushRemoteIceCandidates() {
        const pc = this.pc;
        const generation = this.p2pGeneration;
        if (!pc || !this.remoteDescriptionSet) return;
        const pending = this.pendingRemoteIceCandidates.splice(0);
        for (const candidate of pending) {
          if (this.pc !== pc || this.p2pGeneration !== generation || this.closed) return;
          try { await pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch(_) {}
        }
      }

      _bindDataChannel(dc, generation = this.p2pGeneration) {
        if (!dc) return;
        if (this.dc && this.dc !== dc) {
          const previous = this.dc;
          this.dc = null;
          try { previous.close(); } catch(_) {}
        }
        this.dc = dc;
        dc.onopen = () => {
          if (this.dc !== dc || this.p2pGeneration !== generation || this.closed) return;
          if (typeof resetOnlineLatencyTelemetryForTransport === 'function') {
            resetOnlineLatencyTelemetryForTransport();
          }
          this.p2pRoute = 'unknown';
          this.p2pStatsRttMs = null;
          this.p2pHighRttStreak = 0;
          this.isP2pReady = true;
          this._cancelP2PRecovery(true);
          if (this.signalRetryTimer) clearTimeout(this.signalRetryTimer);
          this.signalRetryTimer = null;
          this._startP2PStatsPolling();
          console.info('🎉 [P2P Dual-Track] WebRTC 数据通道成功建立，正在检测直连或 TURN 中继线路');
          showGameNotice('⚡ 已无感激活 WebRTC 低延迟通道，正在检测线路', false);
          updateOnlineNetworkUI();
        };
        dc.onmessage = (e) => {
          if (this.dc !== dc || this.p2pGeneration !== generation || !e || typeof e.data !== 'string') return;
          this._handleIncomingPayload(e.data, false, 'p2p');
        };
        const onClosed = (eventName = 'DataChannel 关闭') => {
          if (this.dc === dc && this.p2pGeneration === generation) {
            this.isP2pReady = false;
            updateOnlineNetworkUI();
            this._scheduleP2PRecovery(eventName);
          }
        };
        dc.onclose = () => onClosed('DataChannel 关闭');
        dc.onerror = () => onClosed('DataChannel 错误');
      }

      _startP2PStatsPolling() {
        if (this.p2pStatsTimer) clearInterval(this.p2pStatsTimer);
        const generation = this.p2pGeneration;
        const sample = () => {
          if (this.closed || this.p2pGeneration !== generation || !this.isP2pReady) {
            this._stopP2PStatsPolling();
            return;
          }
          void this._refreshP2PStats(generation);
        };
        sample();
        this.p2pStatsTimer = setInterval(sample, ONLINE_P2P_STATS_INTERVAL_MS);
      }

      _stopP2PStatsPolling() {
        if (this.p2pStatsTimer) clearInterval(this.p2pStatsTimer);
        this.p2pStatsTimer = null;
        this.p2pStatsInFlight = false;
      }

      async _refreshP2PStats(generation = this.p2pGeneration) {
        if (this.p2pStatsInFlight || this.closed || this.p2pGeneration !== generation ||
            !this.pc || typeof this.pc.getStats !== 'function') return;
        const pc = this.pc;
        this.p2pStatsInFlight = true;
        try {
          const report = await pc.getStats();
          if (this.closed || this.p2pGeneration !== generation || this.pc !== pc) return;

          let selectedPairId = '';
          let selectedPair = null;
          const candidatePairs = [];
          report.forEach((stat) => {
            if (!stat || typeof stat !== 'object') return;
            if (stat.type === 'transport' && stat.selectedCandidatePairId) {
              selectedPairId = stat.selectedCandidatePairId;
            } else if (stat.type === 'candidate-pair') {
              if (stat.selected === true) selectedPair = stat;
              if (stat.state === 'succeeded' && (stat.nominated === true || stat.writable === true)) {
                candidatePairs.push(stat);
              }
            }
          });

          if (!selectedPair && selectedPairId && typeof report.get === 'function') {
            selectedPair = report.get(selectedPairId) || null;
          }
          if (!selectedPair) selectedPair = candidatePairs[0] || null;

          if (!selectedPair) {
            this.p2pRoute = 'unknown';
            this.p2pStatsRttMs = null;
            this.p2pHighRttStreak = 0;
            updateOnlineNetworkUI();
            return;
          }

          const getStat = (id) => typeof report.get === 'function' && id ? report.get(id) : null;
          const localCandidate = getStat(selectedPair.localCandidateId);
          const remoteCandidate = getStat(selectedPair.remoteCandidateId);
          const localCandidateType = localCandidate?.candidateType;
          const remoteCandidateType = remoteCandidate?.candidateType;
          const usesRelay = localCandidateType === 'relay' || remoteCandidateType === 'relay';
          const nextRoute = usesRelay ? 'relay' : (localCandidateType || remoteCandidateType) ? 'direct' : 'unknown';
          if (this.p2pRoute !== nextRoute) this.p2pHighRttStreak = 0;
          this.p2pRoute = nextRoute;
          const currentRoundTripTime = Number(selectedPair.currentRoundTripTime);
          this.p2pStatsRttMs = Number.isFinite(currentRoundTripTime) && currentRoundTripTime >= 0
            ? Math.min(120000, Math.round(currentRoundTripTime * 1000))
            : null;
          updateOnlineNetworkUI();
          this._maybeReoptimizeP2P(this.p2pStatsRttMs);
        } catch (_) {
          // 部分 WebView 不提供完整 RTCStats；不影响 P2P 业务，只保留“检测中”。
        } finally {
          if (this.p2pGeneration === generation) this.p2pStatsInFlight = false;
        }
      }

      _maybeReoptimizeP2P(rttMs) {
        if (!this.isP2pReady || (this.p2pRoute !== 'direct' && this.p2pRoute !== 'relay') ||
            !Number.isFinite(rttMs)) {
          this.p2pHighRttStreak = 0;
          return;
        }
        if (rttMs <= ONLINE_P2P_HIGH_RTT_THRESHOLD_MS) {
          this.p2pHighRttStreak = 0;
          return;
        }
        this.p2pHighRttStreak++;
        if (this.p2pHighRttStreak < ONLINE_P2P_HIGH_RTT_SAMPLE_COUNT ||
            this.p2pReoptimizationCount >= ONLINE_P2P_MAX_REOPTIMIZE_ATTEMPTS ||
            this.p2pRecoveryTimer) return;
        const now = Date.now();
        if (now - this.p2pLastReoptimizationAt < ONLINE_P2P_REOPTIMIZE_COOLDOWN_MS) return;
        this.p2pReoptimizationCount++;
        this.p2pLastReoptimizationAt = now;
        this.p2pHighRttStreak = 0;
        showGameNotice(`📡 检测到 ${this.p2pRoute === 'relay' ? 'TURN中继' : 'P2P'} 延迟偏高，正在尝试重选线路…`, true);
        this._scheduleP2PRecovery('P2P 高延迟，自动重选线路', 0);
      }

      _disposeP2P() {
        if (this.signalRetryTimer) clearTimeout(this.signalRetryTimer);
        this.signalRetryTimer = null;
        this.iceRestartInFlight = false;
        this.p2pGeneration++;
        this._stopP2PStatsPolling();
        this.isP2pReady = false;
        this.p2pRoute = 'unknown';
        this.p2pStatsRttMs = null;
        this.p2pHighRttStreak = 0;
        const dc = this.dc;
        this.dc = null;
        if (dc) {
          try { dc.close(); } catch(_) {}
        }
        const pc = this.pc;
        this.pc = null;
        if (pc) {
          try { pc.close(); } catch(_) {}
        }
      }

      _publishMqttPayload(jsonStr) {
        if (!isMqttPoolUsable(this.client)) return false;
        try {
          this.client.publish(this.pubTopic, jsonStr, { qos: MQTT_ROOM_DATA_QOS, retain: false });
          return true;
        } catch (e) {
          console.warn('[MqttRoom send error]', e);
          return false;
        }
      }

      _clearMqttFailover(mid) {
        if (!mid) return;
        const timer = this.pendingMqttFailoverTimers.get(mid);
        if (timer) clearTimeout(timer);
        this.pendingMqttFailoverTimers.delete(mid);
      }

      _scheduleMqttFailover(message, jsonStr) {
        const mid = message && message._mid;
        if (!mid || this.closed || this.pendingMqttFailoverTimers.has(mid)) return;
        const timer = setTimeout(() => {
          this.pendingMqttFailoverTimers.delete(mid);
          const pending = onlineReliableOutbox.get(mid);
          // ACK 已到达，或消息已经由新连接接管时，不再从旧连接重复镜像。
          if (!pending || pending.owner !== this || this.closed) return;
          this._publishMqttPayload(jsonStr);
        }, ONLINE_P2P_MQTT_FAILOVER_DELAY_MS);
        this.pendingMqttFailoverTimers.set(mid, timer);
      }

      _markTransportClosed(reason) {
        if (this.closed) return;
        this._releaseReliableOutboxOwner();
        this._cancelP2PRecovery();
        this.closed = true;
        this.open = false;
        this.ready = false;
        this._disposeP2P();
        this._detachMqttListeners();
        this.emit('error', reason || new Error('信令连接异常'));
        this.emit('close');
      }

      _detachMqttListeners() {
        if (!this.client) return;
        try { this.client.removeListener('message', this.messageHandler); } catch(_) {}
        try { this.client.removeListener('close', this.mqttCloseHandler); } catch(_) {}
        try { this.client.removeListener('offline', this.mqttOfflineHandler); } catch(_) {}
        try { this.client.removeListener('error', this.mqttErrorHandler); } catch(_) {}
      }

      _transmitMessage(message, preferredTransport = '') {
        let jsonStr;
        try { jsonStr = JSON.stringify(message); } catch (_) { return false; }
        if (getOnlinePayloadByteLength(jsonStr) > MAX_ONLINE_PAYLOAD_BYTES) return false;

        // P2P 打通后优先走 WebRTC；可靠消息先走低延迟直连，ACK 未及时回来时再镜像项目自有中继，
        // 兼顾正常对局延迟与 DataChannel 半开、手机切网、中继抖动时的可靠性。
        let sentViaP2p = false;
        let sentViaMqtt = false;
        const allowP2p = preferredTransport !== 'mqtt';
        const allowMqtt = preferredTransport !== 'p2p';
        if (allowP2p && this.isP2pReady && this.dc && this.dc.readyState === 'open') {
          try {
            this.dc.send(jsonStr);
            sentViaP2p = true;
          } catch(e) {
            this.isP2pReady = false;
            this._scheduleP2PRecovery('DataChannel 发送失败');
          }
        } else if (allowP2p && this.isP2pReady) {
          // 某些 WebView 会先把 readyState 置为 closing/closed，却不及时派发
          // close 事件；发送路径本身也必须能启动恢复，而不是永久停在半开状态。
          this.isP2pReady = false;
          this._scheduleP2PRecovery('DataChannel 状态失效');
        }

        const isReliableData = RELIABLE_ONLINE_MESSAGE_TYPES.has(message.type);
        const isHeartbeat = ONLINE_HEARTBEAT_TYPES.has(message.type);
        const shouldMirrorImmediately = (allowMqtt && !sentViaP2p) || (!isHeartbeat &&
          (ONLINE_IMMEDIATE_MIRROR_TYPES.has(message.type) || !MIRRORED_ONLINE_MESSAGE_TYPES.has(message.type)));
        if (sentViaP2p && allowMqtt && isReliableData && !isHeartbeat && !ONLINE_IMMEDIATE_MIRROR_TYPES.has(message.type)) {
          this._scheduleMqttFailover(message, jsonStr);
        } else if (shouldMirrorImmediately && allowMqtt) {
          sentViaMqtt = this._publishMqttPayload(jsonStr);
        }
        return sentViaP2p || sentViaMqtt;
      }

      _scheduleReliableRetry() {
        if (this.reliableRetryTimer || this.closed) return;
        const tick = () => {
          this.reliableRetryTimer = null;
          if (this.closed) return;
          const now = Date.now();
          let shouldContinue = false;
          for (const [mid, entry] of onlineReliableOutbox) {
            if (entry.owner !== this) continue;
            if (now - entry.firstSentAt >= ONLINE_RELIABLE_MAX_AGE_MS ||
                entry.attempts >= ONLINE_RELIABLE_MAX_ATTEMPTS) {
              onlineReliableOutbox.delete(mid);
              this.emit('delivery_timeout', entry.message);
              continue;
            }
            shouldContinue = true;
            if (now - entry.lastSentAt >= ONLINE_RELIABLE_RETRY_INTERVAL_MS) {
              entry.attempts++;
              entry.lastSentAt = now;
              this._transmitMessage(entry.message);
            }
          }
          if (shouldContinue) {
            this.reliableRetryTimer = setTimeout(tick, ONLINE_RELIABLE_RETRY_INTERVAL_MS);
          }
        };
        this.reliableRetryTimer = setTimeout(tick, ONLINE_RELIABLE_RETRY_INTERVAL_MS);
      }

      _adoptPendingReliableMessages() {
        if (this.closed || !this.open) return;
        const now = Date.now();
        let adopted = false;
        for (const [mid, entry] of onlineReliableOutbox) {
          if (entry.roomCode !== this.roomCode ||
              entry.sessionId !== this.sessionId ||
              (entry.message.roundId && onlineRoundId && entry.message.roundId !== onlineRoundId)) {
            onlineReliableOutbox.delete(mid);
            continue;
          }
          if (now - entry.firstSentAt >= ONLINE_RELIABLE_MAX_AGE_MS) {
            onlineReliableOutbox.delete(mid);
            continue;
          }
          if (entry.owner && entry.owner !== this && !entry.owner.closed) continue;
          entry.owner = this;
          entry.attempts = Math.min(ONLINE_RELIABLE_MAX_ATTEMPTS, entry.attempts + 1);
          entry.lastSentAt = now;
          this._transmitMessage(entry.message);
          adopted = true;
        }
        if (adopted) this._scheduleReliableRetry();
      }

      _acknowledgeReliableMessage(ackId) {
        const entry = onlineReliableOutbox.get(ackId);
        if (!entry) return;
        this._clearMqttFailover(ackId);
        onlineReliableOutbox.delete(ackId);
        if (entry.owner === this && ![...onlineReliableOutbox.values()].some(item => item.owner === this)) {
          if (this.reliableRetryTimer) clearTimeout(this.reliableRetryTimer);
          this.reliableRetryTimer = null;
        }
      }

      _releaseReliableOutboxOwner() {
        if (this.reliableRetryTimer) clearTimeout(this.reliableRetryTimer);
        this.reliableRetryTimer = null;
        for (const mid of this.pendingMqttFailoverTimers.keys()) this._clearMqttFailover(mid);
        for (const entry of onlineReliableOutbox.values()) {
          if (entry.owner === this) entry.owner = null;
        }
      }

      send(data, preferredTransport = '') {
        if (!this.open || !data || typeof data !== 'object') return false;
        if (!ONLINE_MESSAGE_TYPES.has(data.type)) return false;
        const message = {
          ...data,
          _mid: typeof data._mid === 'string' && data._mid.length <= 80 ? data._mid : generateSecureId(10, 'm_')
        };
        if (this.sessionId && !message.sessionId) message.sessionId = this.sessionId;
        if (!message.senderRole) message.senderRole = this.role;
        // 每一局使用独立轮次标识，避免重开后延迟到达的旧落子/技能重新污染新棋局。
        const currentRound = typeof onlineRoundId === 'string' ? onlineRoundId : '';
        if (currentRound && !message.roundId) message.roundId = currentRound;
        if (message.stateVersion === undefined && typeof history !== 'undefined') message.stateVersion = history.length;
        if (message.stateDigest === undefined &&
            ['ping', 'pong', 'state_snapshot'].includes(message.type) &&
            typeof getOnlineStateDigest === 'function') {
          message.stateDigest = getOnlineStateDigest();
        }
        let jsonStr;
        try { jsonStr = JSON.stringify(message); } catch (_) { return false; }
        if (getOnlinePayloadByteLength(jsonStr) > MAX_ONLINE_PAYLOAD_BYTES) return false;

        const isReliable = RELIABLE_ONLINE_MESSAGE_TYPES.has(message.type);
        let outboxEntry = null;
        if (isReliable) {
          outboxEntry = {
            message,
            owner: this,
            roomCode: this.roomCode,
            sessionId: this.sessionId,
            attempts: 1,
            firstSentAt: Date.now(),
            lastSentAt: Date.now()
          };
          onlineReliableOutbox.set(message._mid, outboxEntry);
        }
        const sent = this._transmitMessage(message, preferredTransport);
        // 即使当前瞬间两条链路都不可用，也保留短暂 outbox，给 MQTT 重连或
        // P2P 恢复留下接管机会；超过时限后再通知上层对账/重试。
        if (isReliable && onlineReliableOutbox.get(message._mid) === outboxEntry) {
          this._scheduleReliableRetry();
        }
        return sent;
      }

      on(event, fn) {
        if (this.listeners[event]) this.listeners[event].push(fn);
        return this;
      }

      off(event, fn) {
        if (this.listeners[event]) this.listeners[event] = this.listeners[event].filter(h => h !== fn);
        return this;
      }

      emit(event, ...args) {
        if (this.listeners[event]) {
          this.listeners[event].forEach(fn => {
            try { fn(...args); } catch(err) { console.error(`[MqttRoom ${event} error]`, err); }
          });
        }
      }

      close(silent = false) {
        if (this.closed) return;
        this._releaseReliableOutboxOwner();
        this._cancelP2PRecovery();
        this.closed = true;
        this.open = false;
        this.ready = false;
        this._disposeP2P();
        this._detachMqttListeners();
        if (!silent) this.emit('close');
      }
    }

    // 房间码只是用户可见的短码；真正隔离一局对战的是不可预测的会话 ID。
    // 它会进入业务 topic、消息 envelope 和快照校验，防止旧连接/撞码报文串局。
    // sessionId 负责隔离整局；joinTicket 再作为一次进房确认的短期能力票据，
    // 防止仅知道 6 位房间码的第三方伪造 join_ready/confirmed。
    let isHostConnecting = false;
    let hostInviteBinding = null;

    function rotateOnlineSessionId() {
      onlineSessionId = generateSecureId(18, 'room_').slice(0, 96);
      onlineJoinTicket = generateSecureId(24, 'join_').slice(0, 96);
      onlineTransportGeneration++;
      clearOnlineReliableOutbox();
      return onlineSessionId;
    }

    function ensureOnlineSessionId() {
      if (!onlineSessionId) rotateOnlineSessionId();
      return onlineSessionId;
    }

    function detachHostInviteListener() {
      if (!hostInviteBinding) return;
      try { hostInviteBinding.client.removeListener('message', hostInviteBinding.handler); } catch(_) {}
      hostInviteBinding = null;
    }

    function generateFastRoomCode() {
      try {
        const bytes = new Uint32Array(1);
        crypto.getRandomValues(bytes);
        return String(100000 + (bytes[0] % 900000));
      } catch (_) {
        return String(Math.floor(100000 + Math.random() * 900000));
      }
    }

    // 统一采用高可用 MQTT Anycast 国内极速全双工中继（穿透所有移动 4G/5G、WiFi 与复杂内网对称 NAT）
    async function initHostPeer(targetCode = null, forceNew = false) {
      if (isMatchmaking) { cancelQuickMatch(); }
      hideMatchingFloatingBar();
      return await initHostMqttPeer(targetCode, forceNew);
    }

    async function initHostMqttPeer(targetCode = null, forceNew = false) {
      const isDifferentRoom = targetCode && String(targetCode) !== String(currentRoomCode);
      // 手动刷新房间/新匹配要换会话；断线重连沿用原会话，保证旧棋局可以恢复。
      if (isDifferentRoom || !onlineSessionId || (forceNew && !isReconnecting)) {
        rotateOnlineSessionId();
      }
      if (isDifferentRoom) {
        clearOnlineReliableOutbox();
        activeOnlineGuestUid = '';
        activeOnlineOpponentUid = '';
      }
      // forceNew 只表示重建传输连接，不能在断线重连时更换棋局轮次。
      if (isDifferentRoom || !onlineRoundId) {
        clearOnlineReliableOutbox();
        onlineRoundId = generateSecureId(12, 'round_');
      }
      if (isDifferentRoom) resetChatHistoryForRoom();
      if (targetCode) currentRoomCode = targetCode;
      if (!currentRoomCode) currentRoomCode = generateFastRoomCode();
      const sessionId = ensureOnlineSessionId();
      const transportGeneration = onlineTransportGeneration;

      const displayEl = document.getElementById('myRoomCodeDisplay');
      const badgeEl = document.getElementById('roomStatusBadge');
      if (displayEl) displayEl.textContent = currentRoomCode;

      if (!forceNew && conn && conn.open && currentRoomCode === lastActiveRoomCode) {
        if (badgeEl) {
          badgeEl.innerHTML = '🟢 房间已就绪，等待好友加入...';
          badgeEl.style.color = '#10b981';
        }
        return;
      }

      if (badgeEl) {
        badgeEl.innerHTML = '🟡 正在连入极速联机网络...';
        badgeEl.style.color = '#f59e0b';
      }

      detachHostInviteListener();
      if (conn) {
        try { conn.close(true); } catch(e) {}
        conn = null;
      }

      const roomCode = currentRoomCode;

      try {
        const client = await getOrCreateOnlineTransport(roomCode, 'host', sessionId);
        if (transportGeneration !== onlineTransportGeneration || currentRoomCode !== roomCode || onlineSessionId !== sessionId) {
          return;
        }
        const c2hTopic = `gomoku/v3/${roomCode}/c2h`;
        const h2cTopic = `gomoku/v3/${roomCode}/h2c`;

        // 房主监听客方加入/重连握手。监听器随房间连接重建，避免房主重连后只剩“空壳”连接。
        let hostHandshakeDone = false;
        let activeGuestUid = activeOnlineGuestUid || null;
        let hostJoinInFlight = null;
        let pendingGuestReady = null;
        let hostJoinReadyTimer = null;

        const clearPendingGuestReady = () => {
          if (hostJoinReadyTimer) clearTimeout(hostJoinReadyTimer);
          hostJoinReadyTimer = null;
          pendingGuestReady = null;
        };

        // 只有房主自己的房间信道和 MqttRoomConnection 都准备好后，才回送 accepted。
        // 旧逻辑先回 accepted、后建连接，客方会提前进入对局，房主连接失败时就会出现“一边断开、一边没进房”。
        const sendAcceptedBurst = (targetUid) => {
          const sendAccept = () => {
            if (transportGeneration !== onlineTransportGeneration || currentRoomCode !== roomCode || onlineSessionId !== sessionId) return;
            try {
              client.publish(h2cTopic, JSON.stringify({
                type: 'join_accepted',
                targetUid,
                uid: currentUserUid || '',
                name: p1Name,
                avatar: getNetworkAvatarValue(p1Avatar),
                sessionId,
                joinTicket: onlineJoinTicket,
                roundId: onlineRoundId || undefined
              }), { qos: MQTT_ROOM_DATA_QOS, retain: false });
            } catch(_) {}
          };
          sendAccept();
          setTimeout(sendAccept, 150);
          setTimeout(sendAccept, 350);
        };

        const sendJoinConfirmedBurst = (targetUid) => {
          const sendJoinConfirmed = () => {
            if (transportGeneration !== onlineTransportGeneration || currentRoomCode !== roomCode || onlineSessionId !== sessionId) return;
            try {
              client.publish(h2cTopic, JSON.stringify({
                type: 'join_confirmed',
                targetUid,
                sessionId,
                joinTicket: onlineJoinTicket,
                roundId: onlineRoundId || undefined
              }), { qos: MQTT_ROOM_DATA_QOS, retain: false });
            } catch (_) {}
          };
          sendJoinConfirmed();
          setTimeout(sendJoinConfirmed, 150);
          setTimeout(sendJoinConfirmed, 350);
        };

        const onHostInvite = (topic, payload) => {
          if (transportGeneration !== onlineTransportGeneration) return;
          if (topic !== c2hTopic) return;
          try {
            const rawPayload = payload && typeof payload.toString === 'function' ? payload.toString() : '';
            if (rawPayload.length > 64 * 1024) return;
            const data = JSON.parse(rawPayload);
            if (data.type !== 'join_request' && data.type !== 'reconnect_handshake' && data.type !== 'join_ready') return;
            if (data.name !== undefined && (typeof data.name !== 'string' || data.name.length > MAX_NETWORK_PROFILE_NAME_CHARS)) return;
            if (data.avatar !== undefined && !isSafeNetworkAvatar(data.avatar)) return;
            if (data.roundId !== undefined && (typeof data.roundId !== 'string' || data.roundId.length > 80)) return;
            if (data.sessionId !== undefined &&
                (typeof data.sessionId !== 'string' || data.sessionId.length > 96 ||
                 (data.sessionId && data.sessionId !== sessionId))) return;
            if (data.joinTicket !== undefined &&
                (typeof data.joinTicket !== 'string' || data.joinTicket.length > 96)) return;
            // 新客户端必须回显房主下发的短期票据；旧客户端过渡期间仍允许
            // 缺少票据的 ready，但不能接受一个不匹配的票据。
            if (data.type === 'join_ready' && data.joinTicket !== undefined && data.joinTicket !== onlineJoinTicket) return;
            if (data.type === 'reconnect_handshake' && data.roundId && onlineRoundId && data.roundId !== onlineRoundId) return;
            if (data.type === 'join_ready' && data.roundId && onlineRoundId && data.roundId !== onlineRoundId) return;
            const reqUid = String(data.uid || data.name || 'guest').slice(0, 128);

            // 客方只有在自己的 MqttRoomConnection ready 后才会发 join_ready。
            // 房主在这一步之前不能把对方显示成已进房，更不能提前切入 online，
            // 否则客方建连失败时就会出现“房主看到对方、客方仍在和人机下棋”。
            if (data.type === 'join_ready') {
              const pending = pendingGuestReady;
              // join_confirmed 可能在移动网络抖动时丢失。客方会继续重发
              // join_ready；已完成闸门的房主必须幂等补发确认。
              if ((!pending || pending.connection !== conn) && activeGuestUid === reqUid &&
                  hostHandshakeDone && conn && conn.open && conn.ready &&
                  currentRoomCode === roomCode && gameMode === 'online') {
                sendJoinConfirmedBurst(reqUid);
                return;
              }
              if (!pending || pending.uid !== reqUid || pending.connection !== conn ||
                  !conn || !conn.open || !conn.ready || currentRoomCode !== roomCode) {
                return;
              }
              clearPendingGuestReady();
              p2Name = normalizeNetworkName(data.name, pending.name || '好友');
              p2Avatar = isSafeNetworkAvatar(data.avatar) ? data.avatar : (pending.avatar || '👧');
              updatePlayerHeaderUI();
              if (gameMode !== 'online') setMode('online');
              else updateOnlineNetworkUI();
              // 入房闸门完成就保存会话身份；即使尚未落子，WebView 被系统回收后
              // 也能使用同一 sessionId 回到这局，而不是创建同房号的新会话。
              persistGameState();

              if (badgeEl) {
                badgeEl.innerHTML = '🟢 已与好友连接，可以开始对弈';
                badgeEl.style.color = '#10b981';
              }

              sendJoinConfirmedBurst(reqUid);
              showGameNotice("🎉 好友已成功加入房间！您执黑先行~", false);
              activeOnlineOpponentUid = reqUid;
              if (window.GomokuSocial?.recordOpponent) void window.GomokuSocial.recordOpponent(reqUid);
              closeOnlineModal();
              try {
                conn.send({ type: 'profile_sync', uid: currentUserUid || '', name: p1Name, avatar: getNetworkAvatarValue(p1Avatar) });
              } catch (_) {}
              return;
            }

            // 🛡️ 第三人进房拦截：若房间已有客方在对局，且请求者不是当前对局客方，直接回绝人数已满
            if (activeGuestUid && reqUid !== activeGuestUid && (pendingGuestReady || (gameMode === 'online' && !isOver))) {
              try {
                client.publish(h2cTopic, JSON.stringify({
                  type: 'room_full',
                  targetUid: reqUid,
                  sessionId,
                  msg: '该房间已有 2 人正在对弈，人数已满！'
                }), { qos: MQTT_ROOM_DATA_QOS, retain: false });
              } catch(_) {}
              return;
            }

            activeGuestUid = reqUid;
            activeOnlineGuestUid = reqUid;

            const liveConnection = !!(conn && conn.open && conn.ready && currentRoomCode === roomCode && !isReconnecting);
            if (liveConnection && hostHandshakeDone) {
              sendAcceptedBurst(reqUid);
              if (data.type === 'reconnect_handshake') sendFullStateSnapshot();
              return;
            }

            // 客方会每 450ms 重发 join_request；房主正在准备连接时只保留一次建连任务，
            // 避免重复创建多个 MqttRoomConnection，又把旧连接误判成“对方断开”。
            if (hostJoinInFlight) return;

            hostHandshakeDone = true;
            const reconnectingNow = isReconnecting;
            hostJoinInFlight = (async () => {
              if (conn) {
                try { conn.close(true); } catch(_) {}
                conn = null;
              }

              const nextConn = new MqttRoomConnection(client, roomCode, 'host', sessionId);
              conn = nextConn;
              myOnlineColor = BLACK;
              lastActiveRoomCode = roomCode;
              const guestName = normalizeNetworkName(data.name, '好友');
              const guestAvatar = isSafeNetworkAvatar(data.avatar) ? data.avatar : '👧';
              setupConn();
              await nextConn.readyPromise;
              if (transportGeneration !== onlineTransportGeneration || currentRoomCode !== roomCode ||
                  onlineSessionId !== sessionId || conn !== nextConn || !nextConn.open || !nextConn.ready) return;

              if (reconnectingNow) {
                // ACK 必须排在房主连接 ready 之后，且继续发送短 burst 兼容弱网/切后台。
                sendAcceptedBurst(reqUid);
                p2Name = guestName;
                p2Avatar = guestAvatar;
                updatePlayerHeaderUI();
                onReconnectSuccess();
              } else {
                // 先建立 pending 闸门再发送 accepted。WebSocket 同机房转发足够快时，
                // 客方的首个 join_ready 可能在 sendAcceptedBurst 返回前抵达。
                pendingGuestReady = {
                  uid: reqUid,
                  connection: nextConn,
                  name: guestName,
                  avatar: guestAvatar
                };
                if (hostJoinReadyTimer) clearTimeout(hostJoinReadyTimer);
                hostJoinReadyTimer = setTimeout(() => {
                  if (!pendingGuestReady || pendingGuestReady.connection !== nextConn || conn !== nextConn) return;
                  clearPendingGuestReady();
                  hostHandshakeDone = false;
                  try { nextConn.close(true); } catch (_) {}
                  if (conn === nextConn) conn = null;
                  if (gameMode !== 'online') {
                    p2Name = '大师AI';
                    p2Avatar = '🤖';
                    updatePlayerHeaderUI();
                  }
                  if (badgeEl) {
                    badgeEl.innerHTML = '🟢 房间已就绪，等待好友加入...';
                    badgeEl.style.color = '#10b981';
                  }
                }, ONLINE_JOIN_CONFIRM_TIMEOUT_MS);
                sendAcceptedBurst(reqUid);
                if (badgeEl) {
                  badgeEl.innerHTML = '🟡 等待好友完成进房确认...';
                  badgeEl.style.color = '#f59e0b';
                }
              }
            })().catch((err) => {
              console.warn('[host room connection]', err);
            }).finally(() => {
              hostJoinInFlight = null;
            });
          } catch(e) {
            console.warn('[onHostInvite error]', e);
          }
        };

        client.on('message', onHostInvite);
        hostInviteBinding = { client, handler: onHostInvite, topic: c2hTopic, roomCode };

        // 房间创建函数现在真正等待信道订阅完成，匹配流程不再凭“已开始连接”提前进入房间。
        await new Promise((resolve, reject) => {
          try {
            client.subscribe(c2hTopic, { qos: MQTT_ROOM_DATA_QOS }, err => err ? reject(err) : resolve());
          } catch (err) {
            reject(err);
          }
        });
        if (badgeEl) {
          badgeEl.innerHTML = '🟢 房间已就绪，等待好友加入...';
          badgeEl.style.color = '#10b981';
        }

      } catch(err) {
        console.error('[initHostPeer error]', err);
        detachHostInviteListener();
        if (badgeEl) {
          badgeEl.innerHTML = `⚠️ 极速网络连接受阻 <span style="cursor:pointer;color:#3b82f6;text-decoration:underline;" onclick="initHostPeer(null, true)">[点击重试]</span>`;
          badgeEl.style.color = '#ef4444';
        }
      }
    }

    function initPeer(customCode = null) {
      initHostPeer(customCode, false);
    }

    function refreshNewRoomCode() {
      activeOnlineGuestUid = '';
      activeOnlineOpponentUid = '';
      currentRoomCode = generateFastRoomCode();
      initHostPeer(currentRoomCode, true);
      showGameNotice("🔄 正在刷新全新房间码...", false);
    }

    // --- 🛰️ 联机断线自动重连与对局状态瞬时同步系统 ---
    let isReconnecting = false;
    let reconnectAttempts = 0;
    const MAX_RECONNECT_ATTEMPTS = 6;
    const ONLINE_RECONNECT_DELAYS_MS = [0, 1000, 2000, 4000, 8000, 12000];
    let reconnectTimer = null;
    let reconnectHandshakeTimer = null;
    let reconnectMetricStartedAt = 0;
    let reconnectMetricFinished = false;

    function showReconnectOverlay(show, text = '') {
      const modal = document.getElementById('onlineReconnectModal');
      if (!modal) return;
      if (show) {
        modal.classList.add('show');
        if (text) document.getElementById('reconnectStatusText').innerHTML = text;
      } else {
        modal.classList.remove('show');
      }
    }

    function triggerOnlineReconnect(reason = '网络波动') {
      if (gameMode !== 'online' || isOver) return;
      if (isReconnecting) return;

      if (!currentRoomCode && lastActiveRoomCode) {
        currentRoomCode = lastActiveRoomCode;
      }
      if (!currentRoomCode) {
        showGameNotice("⚠️ 联机已断开！", true);
        return;
      }

      lastActiveRoomCode = currentRoomCode;
      isReconnecting = true;
      reconnectAttempts = 0;
      reconnectMetricStartedAt = performance.now ? performance.now() : Date.now();
      reconnectMetricFinished = false;
      // 前 2 次采用轻量 HUD 提示，后台自动静默接续，不强行弹出全屏窗口干扰玩家
      showGameNotice("⚡ 网络连接轻微波动，正在后台自动接续...", false);

      // 心跳超时并不一定伴随 WebSocket close（WiFi→流量时尤其常见）。
      // 重连前主动废弃旧池和旧 P2P，禁止后续逻辑误把半开连接当成新连接复用。
      const stalePool = mqttClient;
      const staleConnection = conn;
      if (stalePool && typeof stalePool.invalidate === 'function') {
        stalePool.invalidate(`重连触发：${reason}`);
      }
      if (staleConnection && staleConnection.open && !staleConnection.closed &&
          typeof staleConnection._markTransportClosed === 'function') {
        staleConnection._markTransportClosed(new Error(`重连触发：${reason}`));
      }

      if (onlineHeartbeatTimer) clearInterval(onlineHeartbeatTimer);
      doAutoReconnect();
    }

    async function doAutoReconnect() {
      if (!isReconnecting || isOver || gameMode !== 'online') return;

      reconnectAttempts++;
      // 连续多次尝试（>2次）才弹出全屏等待遮罩
      if (reconnectAttempts > 2) {
        const statusText = `⚠️ 正在尝试重新建立连接 (第 ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS} 次)...<br><span style="font-size:11px; color:#92400e; font-weight:normal;">棋盘进度已完整保全，连接恢复后自动接续</span>`;
        showReconnectOverlay(true, statusText);
      }

      try {
        const roomCode = currentRoomCode;
        const client = await getOrCreateOnlineTransport(roomCode, myOnlineColor === WHITE ? 'client' : 'host', onlineSessionId);
        if (conn && conn.open && conn.ready && isMqttPoolUsable(client)) {
          onReconnectSuccess();
          return;
        }

        if (conn) {
          try { conn.close(true); } catch(_) {}
          conn = null;
        }

        if (myOnlineColor === WHITE) {
          const nextConn = new MqttRoomConnection(client, roomCode, 'client', onlineSessionId);
          conn = nextConn;
          setupConn();
          await nextConn.readyPromise;
          if (conn === nextConn && nextConn.open) startReconnectHandshakeLoop(nextConn);
        } else {
          // 房主必须重新挂载原始入房监听，等待客方的 reconnect_handshake。
          await initHostMqttPeer(roomCode, true);
        }
      } catch(e) {
        console.warn('[doAutoReconnect error]', e);
        scheduleNextReconnect();
      }
    }

    function scheduleNextReconnect(delay = null) {
      if (!isReconnecting) return;
      if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
        document.getElementById('reconnectTitle').textContent = '⚠️ 重连未成功';
        document.getElementById('reconnectStatusText').innerHTML = '对方可能已断网或退出游戏。<br>您可以选择手动再次重试，或转为单人人机继续对局！';
        if (!reconnectMetricFinished && typeof window.recordGomokuMetric === 'function') {
          reconnectMetricFinished = true;
          const now = performance.now ? performance.now() : Date.now();
          window.recordGomokuMetric('reconnect_ms', Math.max(0, now - reconnectMetricStartedAt), { route: getGomokuMetricsRoute() });
          window.recordGomokuMetric('reconnect_result', 0, { route: getGomokuMetricsRoute() });
        }
        return;
      }
      const nextDelay = Number.isFinite(delay)
        ? Math.max(0, delay)
        : ONLINE_RECONNECT_DELAYS_MS[Math.min(reconnectAttempts, ONLINE_RECONNECT_DELAYS_MS.length - 1)];
      reconnectTimer = setTimeout(doAutoReconnect, nextDelay);
    }

    function manualTriggerReconnect() {
      reconnectAttempts = 0;
      reconnectMetricStartedAt = performance.now ? performance.now() : Date.now();
      reconnectMetricFinished = false;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      document.getElementById('reconnectTitle').textContent = '联机中断重连中...';
      doAutoReconnect();
    }

    function stopReconnectHandshakeLoop() {
      if (reconnectHandshakeTimer) clearInterval(reconnectHandshakeTimer);
      reconnectHandshakeTimer = null;
    }

    function startReconnectHandshakeLoop(connection) {
      stopReconnectHandshakeLoop();
      const sendHandshake = () => {
        if (!isReconnecting || conn !== connection || !connection.open) {
          stopReconnectHandshakeLoop();
          return;
        }
        const handshake = {
          type: 'reconnect_handshake',
          role: 'client',
          uid: getOrCreateMatchUid(),
          name: normalizeNetworkName(p1Name, '棋友'),
          avatar: getNetworkAvatarValue(p1Avatar),
          stepCount: history.length
        };
        // v4 对局信道仍存活时可直接让房主回快照；如果房主也因心跳超时
        // 正在重建，它此刻只监听 v3 入房信道。两路同时发送同一份、带原
        // sessionId/roundId 的握手，避免弱网下双方恰好同时重连而擦肩。
        connection.send(handshake);
        try {
          const inviteHandshake = {
            ...handshake,
            sessionId: onlineSessionId || undefined,
            roundId: onlineRoundId || undefined
          };
          connection.client.publish(
            `gomoku/v3/${currentRoomCode}/c2h`,
            JSON.stringify(inviteHandshake),
            { qos: MQTT_ROOM_DATA_QOS, retain: false }
          );
        } catch (_) {}
      };
      sendHandshake();
      reconnectHandshakeTimer = setInterval(sendHandshake, 700);
    }

    function onReconnectSuccess() {
      const wasReconnecting = isReconnecting;
      isReconnecting = false;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      stopReconnectHandshakeLoop();
      showReconnectOverlay(false);
      setupConn();

      if (wasReconnecting && myOnlineColor === BLACK) {
        sendFullStateSnapshot();
      }

      if (wasReconnecting) {
        if (!reconnectMetricFinished && typeof window.recordGomokuMetric === 'function') {
          reconnectMetricFinished = true;
          const now = performance.now ? performance.now() : Date.now();
          window.recordGomokuMetric('reconnect_ms', Math.max(0, now - reconnectMetricStartedAt), { route: getGomokuMetricsRoute() });
          window.recordGomokuMetric('reconnect_result', 1, { route: getGomokuMetricsRoute() });
        }
        persistGameState();
        playPopSound();
        showGameNotice("🎉 联机重连成功！棋局已完好恢复，继续对弈~", false);
      }
    }

    function sendFullStateSnapshot() {
      if (!conn || !conn.open) return;
      conn.send({
        type: 'state_snapshot',
        board: board,
        history: history,
        turn: turn,
        isOver: isOver,
        isDraw: gameResultIsDraw,
        winnerColor: gameWinnerColor,
        stateVersion: history.length,
        stateDigest: getOnlineStateDigest(),
        p1Name: p1Name,
        p1Avatar: getNetworkAvatarValue(p1Avatar),
        p2Name: p2Name,
        p2Avatar: getNetworkAvatarValue(p2Avatar)
      });
    }

    function fallbackToAiGame() {
      isReconnecting = false;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      stopReconnectHandshakeLoop();
      showReconnectOverlay(false);
      detachHostInviteListener();
      if (conn) { try { conn.close(true); } catch(e) {} conn = null; }
      closeMqttClientPool();
      activeOnlineGuestUid = '';
      activeOnlineOpponentUid = '';
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
      if (typeof closeUndoModal === 'function') closeUndoModal();
      if (typeof closeGameResultModal === 'function') closeGameResultModal();
      
      gameMode = 'ai';
      p2Name = '大师AI';
      p2Avatar = '🤖';
      updatePlayerHeaderUI();
      showGameNotice("🤖 已成功转为单人人机对弈模式，局势已完整继承！", false);
      if (turn === WHITE && !isOver) {
        setTimeout(smartAiMove, 500);
      }
    }

    const ONLINE_HEARTBEAT_INTERVAL_MS = 2500;
    const ONLINE_PEER_TIMEOUT_MS = 9000;
    let onlineNetworkTelemetry = {
      localLatencyMs: null,
      remoteLatencyMs: null,
      remoteLastSeenAt: 0,
      remoteState: '等待对方',
      localLatencySamples: [],
      remoteLatencySamples: [],
      localTransportRttMs: null,
      remoteTransportRttMs: null
    };
    let lastOnlineNetworkMetricAt = 0;

    function getGomokuMetricsRoute() {
      if (conn && conn.isP2pReady && conn.dc && conn.dc.readyState === 'open') {
        return conn.p2pRoute === 'relay' ? 'turn' : 'direct';
      }
      return 'websocket';
    }

    function resetOnlineLatencyTelemetryForTransport() {
      pendingOnlinePings.clear();
      onlineNetworkTelemetry.localLatencyMs = null;
      onlineNetworkTelemetry.remoteLatencyMs = null;
      onlineNetworkTelemetry.localLatencySamples = [];
      onlineNetworkTelemetry.remoteLatencySamples = [];
      onlineNetworkTelemetry.localTransportRttMs = null;
      onlineNetworkTelemetry.remoteTransportRttMs = null;
      updateOnlineNetworkUI();
    }

    function normalizeOnlineNetworkState(value, fallback = '在线') {
      const allowed = new Set(['离线', '断开', '连接中', '重连中', 'P2P直连', 'P2P中继', 'P2P检测', 'WebSocket中继', 'MQTT中继', '在线']);
      return typeof value === 'string' && allowed.has(value) ? value : fallback;
    }

    function getLocalOnlineNetworkState() {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return '离线';
      if (!conn || !conn.open) return isReconnecting ? '重连中' : '断开';
      if (!conn.ready) return '连接中';
      if (conn.isP2pReady && conn.dc && conn.dc.readyState === 'open') {
        if (conn.p2pRoute === 'relay') return 'P2P中继';
        if (conn.p2pRoute === 'direct') return 'P2P直连';
        return 'P2P检测';
      }
      if (conn.client && isMqttPoolUsable(conn.client)) {
        return conn.client.transportType === 'relay' ? 'WebSocket中继' : 'MQTT中继';
      }
      return '在线';
    }

    function getLocalOnlineTransportRtt() {
      const value = conn && Number(conn.p2pStatsRttMs);
      return Number.isFinite(value) && value >= 0 && value <= 120000 ? Math.round(value) : null;
    }

    function getLocalOnlineTransportPath() {
      if (conn && conn.isP2pReady && conn.dc && conn.dc.readyState === 'open') return 'p2p';
      if (conn && conn.client && isMqttPoolUsable(conn.client)) return 'mqtt';
      return '';
    }

    function formatOnlineLatency(value) {
      return Number.isFinite(value) && value >= 0 && value <= 120000 ? `${Math.round(value)}ms` : '--ms';
    }

    function onlineStateIcon(state) {
      if (state === 'P2P直连' || state === 'P2P中继' || state === 'WebSocket中继' || state === 'MQTT中继' || state === '在线') return '🟢';
      if (state === '连接中' || state === '重连中' || state === 'P2P检测') return '🟡';
      if (state === '离线' || state === '断开' || state === '连接超时') return '🔴';
      return '⚪';
    }

    function recordOnlineLatencySample(scope, value) {
      if (!Number.isFinite(value) || value < 0 || value > 120000) return;
      const sampleKey = scope === 'remote' ? 'remoteLatencySamples' : 'localLatencySamples';
      const latencyKey = scope === 'remote' ? 'remoteLatencyMs' : 'localLatencyMs';
      const samples = onlineNetworkTelemetry[sampleKey];
      samples.push(Math.round(value));
      while (samples.length > ONLINE_LATENCY_SAMPLE_LIMIT) samples.shift();
      const sorted = samples.slice().sort((a, b) => a - b);
      const middle = Math.floor(sorted.length / 2);
      const median = sorted.length % 2 === 1
        ? sorted[middle]
        : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
      onlineNetworkTelemetry[latencyKey] = median;
      const now = Date.now();
      if (scope !== 'remote' && samples.length >= 3 && now - lastOnlineNetworkMetricAt >= 60000 &&
          typeof window.recordGomokuMetric === 'function') {
        lastOnlineNetworkMetricAt = now;
        window.recordGomokuMetric('network_rtt', median, { route: getGomokuMetricsRoute() });
      }
    }

    function markOnlinePeerSeen(state, latency, transportRtt = undefined) {
      onlineNetworkTelemetry.remoteLastSeenAt = Date.now();
      onlineNetworkTelemetry.remoteState = normalizeOnlineNetworkState(state, '在线');
      recordOnlineLatencySample('remote', latency);
      if (Number.isFinite(transportRtt) && transportRtt >= 0 && transportRtt <= 120000) {
        onlineNetworkTelemetry.remoteTransportRttMs = Math.round(transportRtt);
      } else if (transportRtt !== undefined) {
        onlineNetworkTelemetry.remoteTransportRttMs = null;
      }
      updateOnlineNetworkUI();
    }

    function updateOnlineNetworkUI() {
      const bar = document.getElementById('onlineNetworkStatusBar');
      if (!bar) return;
      if (gameMode !== 'online') {
        bar.style.display = 'none';
        return;
      }
      const roomBar = document.getElementById('onlineRoomTopBar');
      if (roomBar) roomBar.style.display = 'flex';
      bar.style.display = 'flex';
      const localState = getLocalOnlineNetworkState();
      const peerFresh = onlineNetworkTelemetry.remoteLastSeenAt > 0 &&
        Date.now() - onlineNetworkTelemetry.remoteLastSeenAt <= ONLINE_PEER_TIMEOUT_MS;
      const peerState = peerFresh ? onlineNetworkTelemetry.remoteState :
        (onlineNetworkTelemetry.remoteLastSeenAt > 0 ? '连接超时' : '等待对方');
      const localEl = document.getElementById('myNetworkStatusLabel');
      const peerEl = document.getElementById('peerNetworkStatusLabel');
      if (localEl) {
        localEl.textContent = `我方: ${onlineStateIcon(localState)} ${localState} · ${formatOnlineLatency(onlineNetworkTelemetry.localLatencyMs)}`;
        localEl.title = onlineNetworkTelemetry.localTransportRttMs == null
          ? '应用心跳往返延迟（最近 5 次样本中位数）'
          : `应用心跳往返延迟（最近 5 次样本中位数）；WebRTC RTT ${formatOnlineLatency(onlineNetworkTelemetry.localTransportRttMs)}`;
      }
      if (peerEl) {
        peerEl.textContent = `对方: ${onlineStateIcon(peerState)} ${peerState} · ${formatOnlineLatency(onlineNetworkTelemetry.remoteLatencyMs)}`;
        peerEl.title = onlineNetworkTelemetry.remoteTransportRttMs == null
          ? '对方应用心跳往返延迟（最近 5 次样本中位数）'
          : `对方应用心跳往返延迟（最近 5 次样本中位数）；WebRTC RTT ${formatOnlineLatency(onlineNetworkTelemetry.remoteTransportRttMs)}`;
      }
    }

    let onlineNetworkChangeTimer = null;
    let lastOnlineNetworkSignature = '';
    let lastOnlineNetworkResetAt = 0;
    let onlineNetworkChangeSequence = 0;
    const ONLINE_NETWORK_CHANGE_DEBOUNCE_MS = 650;
    const ONLINE_NETWORK_RESET_COOLDOWN_MS = 1200;

    function getBrowserNetworkSignature() {
      try {
        const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
        const parts = [navigator.onLine === false ? 'offline' : 'online'];
        if (connection) {
          parts.push(connection.type || '');
          parts.push(connection.effectiveType || '');
          parts.push(Number.isFinite(connection.downlink) ? String(connection.downlink) : '');
          parts.push(Number.isFinite(connection.rtt) ? String(connection.rtt) : '');
          parts.push(connection.saveData ? 'save-data' : 'normal');
        }
        return parts.join('|');
      } catch (_) {
        return navigator.onLine === false ? 'offline' : 'online';
      }
    }

    function handleOnlineNetworkChange(reason = '网络切换', signature = '', force = false) {
      const nextSignature = String(signature || getBrowserNetworkSignature()).slice(0, 160);
      if (!force && nextSignature && nextSignature === lastOnlineNetworkSignature) return;
      lastOnlineNetworkSignature = nextSignature || `event-${Date.now()}`;
      updateOnlineNetworkUI();
      if (gameMode !== 'online' || isOver) return;
      const now = Date.now();
      if (!force && now - lastOnlineNetworkResetAt < ONLINE_NETWORK_RESET_COOLDOWN_MS) return;
      lastOnlineNetworkResetAt = now;

      // 网络接口切换时，旧 WebSocket/ICE 可能长时间保持“假连接”。先主动销毁旧信令池，
      // 让 conn.close/error 路径接管当前房间，再由原有重连逻辑用同一房间号和 roundId 重建。
      const resetReason = `网络切换：${String(reason).slice(0, 80)}`;
      const activeConnection = conn;
      const activePool = mqttClient;
      if (activePool && typeof activePool.invalidate === 'function') {
        activePool.invalidate(resetReason);
      }
      if (activeConnection && activeConnection.open && !activeConnection.closed &&
          typeof activeConnection._markTransportClosed === 'function') {
        activeConnection._markTransportClosed(new Error(resetReason));
      }
      if ((!activeConnection || !activeConnection.open) && !isReconnecting) {
        triggerOnlineReconnect(resetReason);
      }
    }

    function scheduleOnlineNetworkChange(reason = '网络变化', signature = '', force = false) {
      if (onlineNetworkChangeTimer) clearTimeout(onlineNetworkChangeTimer);
      const sequence = ++onlineNetworkChangeSequence;
      onlineNetworkChangeTimer = setTimeout(() => {
        onlineNetworkChangeTimer = null;
        if (sequence !== onlineNetworkChangeSequence) return;
        handleOnlineNetworkChange(reason, signature, force);
      }, ONLINE_NETWORK_CHANGE_DEBOUNCE_MS);
    }

    // Android 原生 ConnectivityManager、Chrome Network Information API 和普通 online/offline
    // 事件统一进入同一去抖入口；这样 WiFi→4G/5G 不依赖浏览器是否派发 offline 事件。
    window.__gomokuNativeNetworkChanged = (reason = 'Android网络变化', signature = '') => {
      scheduleOnlineNetworkChange(reason, signature || `${reason}-${Date.now()}`, true);
    };

    try {
      window.addEventListener('offline', () => {
        scheduleOnlineNetworkChange('设备离线', 'offline', true);
        if (gameMode === 'online' && !isOver) {
          showGameNotice('📴 当前设备已离线，网络恢复后将自动重连…', true);
        }
      });
      window.addEventListener('online', () => {
        scheduleOnlineNetworkChange('网络已恢复', `online-${Date.now()}`, true);
      });
      const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
      if (connection && typeof connection.addEventListener === 'function') {
        connection.addEventListener('change', () => {
          scheduleOnlineNetworkChange('网络接口变化', getBrowserNetworkSignature(), false);
        });
      }
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          scheduleOnlineNetworkChange('页面恢复前台', getBrowserNetworkSignature(), false);
        }
      });
      window.addEventListener('pageshow', () => {
        scheduleOnlineNetworkChange('页面恢复', getBrowserNetworkSignature(), false);
      });
    } catch (_) {}

    // 🛡️ 联机技能反作弊拦截审计层：每轮手牌最多使用 3 次，神抽最多重铸 1 次
    function rejectIncomingSkill(reason = '⚠️ 拦截到对手异常技能数据包，已自动防御！') {
      console.warn(reason);
      showGameNotice(reason, true);
      return false;
    }

    // 无坐标的技能（双星连珠、天降神抽）也必须进入同一额度账本，不能绕过校验。
    function validateIncomingSkillUse(data) {
      const remoteColor = myOnlineColor === BLACK ? WHITE : BLACK;
      if (!data || data.type !== 'skill_use' || typeof data.skillId !== 'string' || data.skillId.length > 64 ||
          turn !== remoteColor) return false;
      const card = SKILL_CARD_POOL.find(item => item.id === data.skillId);
      if (!card) return rejectIncomingSkill();

      if (data.skillId === 'reforge_cards') {
        if (opponentReforgeUsed) {
          return rejectIncomingSkill('⚠️ 对手重复发动【天降神抽】，已自动拦截！');
        }
        // 神抽会生成一套全新的三张手牌，额度从新手牌阶段重新计算。
        opponentReforgeUsed = true;
        opponentSkillsUsedCount = 0;
        return true;
      }

      if (opponentSkillsUsedCount >= MAX_OPPONENT_SKILLS_PER_HAND) {
        return rejectIncomingSkill('⚠️ 对手本轮技能额度已用尽，异常数据包已拦截！');
      }
      opponentSkillsUsedCount++;
      return true;
    }

    function validateIncomingSkill(data) {
      if (!data || typeof data !== 'object' || typeof data.type !== 'string' || data.type.length > 64) return false;
      if (!ONLINE_MESSAGE_TYPES.has(data.type)) return false;
      const localColor = myOnlineColor === BLACK ? BLACK : WHITE;
      const remoteColor = localColor === BLACK ? WHITE : BLACK;
      const isDestinyContinuation = data.type === 'destiny_point_1' || data.type === 'destiny_point_2';
      // 技能只能由当前回合的对手发动，避免利用公开 MQTT 信道注入跨回合操作。
      if (turn !== remoteColor) return false;
      // 1. 施法上限风控：当前手牌阶段最多只能使用 3 张技能牌。
      if (!isDestinyContinuation && opponentSkillsUsedCount >= MAX_OPPONENT_SKILLS_PER_HAND) {
        return rejectIncomingSkill('⚠️ 对手本轮技能额度已用尽，异常数据包已拦截！');
      }
      
      // 2. 严格坐标类型与 15x15 越界数值校验（杜绝 NaN、负数或越界崩溃注入）
      const isValidCoord = (n) => typeof n === "number" && Number.isInteger(n) && n >= 0 && n < 15;
      
      if ("r" in data && !isValidCoord(data.r)) return false;
      if ("c" in data && !isValidCoord(data.c)) return false;
      if ("fromR" in data && !isValidCoord(data.fromR)) return false;
      if ("fromC" in data && !isValidCoord(data.fromC)) return false;
      if ("toR" in data && !isValidCoord(data.toR)) return false;
      if ("toC" in data && !isValidCoord(data.toC)) return false;
      if ("r1" in data && !isValidCoord(data.r1)) return false;
      if ("c1" in data && !isValidCoord(data.c1)) return false;
      if ("r2" in data && !isValidCoord(data.r2)) return false;
      if ("c2" in data && !isValidCoord(data.c2)) return false;
      if ("p" in data && data.p !== BLACK && data.p !== WHITE) return false;
      if ("by" in data && data.by !== BLACK && data.by !== WHITE) return false;
      if ("stones" in data) {
        if (!Array.isArray(data.stones) || data.stones.length > 225) return false;
        for (const stone of data.stones) {
          if (!stone || !isValidCoord(stone.r) || !isValidCoord(stone.c) ||
              (stone.p !== undefined && stone.p !== BLACK && stone.p !== WHITE)) return false;
        }
      }
      if ("cells" in data) {
        if (!Array.isArray(data.cells) || data.cells.length !== 4) return false;
        const seen = new Set();
        for (const cell of data.cells) {
          if (!cell || !isValidCoord(cell.r) || !isValidCoord(cell.c) || seen.has(`${cell.r},${cell.c}`)) return false;
          seen.add(`${cell.r},${cell.c}`);
        }
      }

      // 3. 目标物理实体合法性校验（防凭空捏造）
      if (data.type === "skill_identity_swap") {
        if (!board.some(row => row.some(cell => cell !== EMPTY))) return false;
      } else if (data.type === "skill_prophecy") {
        if (data.by !== remoteColor || board[data.r][data.c] !== EMPTY) return false;
      } else if (data.type === "skill_remove_stone") {
        if (board[data.r][data.c] !== localColor) return false;
      } else if (data.type === "skill_shift_stone") {
        if (data.p !== remoteColor || board[data.fromR][data.fromC] !== remoteColor || board[data.toR][data.toC] !== EMPTY) return false;
        if (Math.abs(data.fromR - data.toR) > 1 || Math.abs(data.fromC - data.toC) > 1) return false;
      } else if (data.type === "skill_swap_color") {
        if (data.p !== remoteColor || board[data.r][data.c] !== localColor) return false;
      } else if (data.type === "skill_swap_positions") {
        if (board[data.r1][data.c1] !== remoteColor || board[data.r2][data.c2] !== localColor) return false;
      } else if (data.type === "skill_mega_bomb") {
        if (!Array.isArray(data.stones)) return false;
        let count = 0;
        let localCount = 0;
        let remoteCount = 0;
        for (let r = 0; r < 15; r++) {
          for (let col = 0; col < 15; col++) {
            if (board[r][col] !== EMPTY) count++;
            if (board[r][col] === localColor) localCount++;
            if (board[r][col] === remoteColor) remoteCount++;
          }
        }
        if (data.stones.length !== count) return false;
        const seen = new Set();
        let nextLocalCount = 0;
        let nextRemoteCount = 0;
        for (const stone of data.stones) {
          if (stone.p !== BLACK && stone.p !== WHITE) return false;
          const key = `${stone.r},${stone.c}`;
          if (seen.has(key)) return false;
          seen.add(key);
          if (stone.p === localColor) nextLocalCount++;
          if (stone.p === remoteColor) nextRemoteCount++;
        }
        if (nextLocalCount !== localCount || nextRemoteCount !== remoteCount) return false;
      } else if (data.type === "destiny_point_2") {
        if (board[data.fromR][data.fromC] !== remoteColor || board[data.toR][data.toC] !== EMPTY) return false;
      } else if (data.type === "destiny_wipe_danger") {
        if (!Array.isArray(data.stones) || data.stones.length < 3 || data.stones.length > 15) return false;
        const seen = new Set();
        for (const stone of data.stones) {
          const key = `${stone.r},${stone.c}`;
          if (seen.has(key) || board[stone.r][stone.c] !== localColor) return false;
          seen.add(key);
        }
        const first = data.stones[0];
        const second = data.stones[1];
        const dr = Math.sign(second.r - first.r);
        const dc = Math.sign(second.c - first.c);
        if ((!dr && !dc) || (dr && dc && Math.abs(second.r - first.r) !== Math.abs(second.c - first.c))) return false;
        for (let i = 1; i < data.stones.length; i++) {
          if (data.stones[i].r !== first.r + dr * i || data.stones[i].c !== first.c + dc * i) return false;
        }
      } else if (data.type === "destiny_place_2x2") {
        if (data.p !== remoteColor || data.cells.length !== 4 || data.cells.some(cell => board[cell.r][cell.c] !== EMPTY)) return false;
        const rows = [...new Set(data.cells.map(cell => cell.r))].sort((a, b) => a - b);
        const cols = [...new Set(data.cells.map(cell => cell.c))].sort((a, b) => a - b);
        if (rows.length !== 2 || cols.length !== 2 || rows[1] !== rows[0] + 1 || cols[1] !== cols[0] + 1) return false;
      }

      if (!isDestinyContinuation) opponentSkillsUsedCount++;
      return true;
    }

    function validateIncomingSnapshot(data) {
      const isValidCoord = (n) => Number.isInteger(n) && n >= 0 && n < 15;
      if (!data || typeof data !== 'object' || !Array.isArray(data.board) || data.board.length !== 15 ||
          data.board.some(row => !Array.isArray(row) || row.length !== 15 ||
            row.some(cell => cell !== EMPTY && cell !== BLACK && cell !== WHITE))) return false;
      if (!Array.isArray(data.history) || data.history.length > 512) return false;
      for (const item of data.history) {
        if (!item || typeof item !== 'object') return false;
        const special = item.r === -1 && item.c === -1 && (item.p === 0 || item.p === BLACK || item.p === WHITE) &&
          ((typeof item.action === 'string' && item.action.length <= 64) || (typeof item.type === 'string' && item.type.length <= 64));
        const move = isValidCoord(item.r) && isValidCoord(item.c) && (item.p === BLACK || item.p === WHITE);
        if (!special && !move) return false;
      }
      if (data.turn !== BLACK && data.turn !== WHITE) return false;
      if (typeof data.isOver !== 'boolean') return false;
      if (data.isDraw !== undefined && typeof data.isDraw !== 'boolean') return false;
      if (data.winnerColor !== undefined && data.winnerColor !== 0 && data.winnerColor !== BLACK && data.winnerColor !== WHITE) return false;
      if (data.stateVersion !== undefined && (!Number.isInteger(data.stateVersion) || data.stateVersion < 0 || data.stateVersion > 1024)) return false;
      if (data.stateVersion !== undefined && data.stateVersion !== data.history.length) return false;
      if (data.stateDigest !== undefined &&
          (typeof data.stateDigest !== 'string' || !/^[0-9a-f]{8}$/i.test(data.stateDigest))) return false;
      if (data.cardUsedStatus !== undefined &&
          (!Array.isArray(data.cardUsedStatus) || data.cardUsedStatus.length !== 3 ||
           data.cardUsedStatus.some(value => typeof value !== 'boolean'))) return false;
      if (data.currentDrawnCards !== undefined &&
          (!Array.isArray(data.currentDrawnCards) || data.currentDrawnCards.length !== 3 ||
           data.currentDrawnCards.some(card => !card || typeof card.id !== 'string' ||
             !SKILL_CARD_POOL.some(localCard => localCard.id === card.id)))) return false;
      for (const value of [data.p1Name, data.p2Name]) {
        if (value !== undefined && (typeof value !== 'string' || value.length > MAX_NETWORK_PROFILE_NAME_CHARS)) return false;
      }
      for (const value of [data.p1Avatar, data.p2Avatar]) {
        if (value !== undefined && !isSafeNetworkAvatar(value)) return false;
      }
      return true;
    }

    function validateIncomingUndoState(data) {
      if (!data || typeof data !== 'object' || typeof data.agree !== 'boolean') return false;
      if (!data.agree) return true;
      // 悔棋响应复用快照的棋盘/棋谱校验，但不携带 isOver/isDraw 字段。
      return validateIncomingSnapshot({
        board: data.board,
        history: data.history,
        turn: data.turn,
        isOver: false,
        isDraw: false,
        currentDrawnCards: data.currentDrawnCards,
        cardUsedStatus: data.cardUsedStatus
      });
    }

    let lastOnlineResyncAt = 0;
    function requestOnlineResync(reason = '状态对账') {
      if (!conn || !conn.open) return;
      const now = Date.now();
      if (now - lastOnlineResyncAt < 900) return;
      lastOnlineResyncAt = now;
      if (myOnlineColor === BLACK) sendFullStateSnapshot();
      else {
        try { conn.send({ type: 'sync_req', reason: String(reason).slice(0, 80) }); } catch (_) {}
      }
    }

    function setupConn() {
      if (!conn) return;
      if (conn.__gomokuSetup) return;
      conn.__gomokuSetup = true;
      if (onlineHeartbeatTimer) clearInterval(onlineHeartbeatTimer);
      pendingOnlinePings.clear();
      onlineNetworkTelemetry.localLatencyMs = null;
      onlineNetworkTelemetry.remoteLatencyMs = null;
      onlineNetworkTelemetry.remoteLastSeenAt = 0;
      onlineNetworkTelemetry.remoteState = '等待对方';
      onlineNetworkTelemetry.localLatencySamples = [];
      onlineNetworkTelemetry.remoteLatencySamples = [];
      onlineNetworkTelemetry.localTransportRttMs = null;
      onlineNetworkTelemetry.remoteTransportRttMs = null;
      updateOnlineNetworkUI();

      let missedPings = 0;
      const connection = conn;
      const sendHeartbeat = (countMiss = true) => {
        if (conn !== connection) return;
        if (conn && conn.open && gameMode === 'online' && !isOver) {
          if (countMiss) missedPings++;
          // WebSocket 中继 close/offline 会立即触发重连；只有半开连接才走心跳兜底。
          if (countMiss && missedPings >= 3) {
            triggerOnlineReconnect("心跳无响应");
            return;
          }
          const pingId = generateSecureId(10, 'hb_');
          const heartbeatTransport = getLocalOnlineTransportPath();
          const sentAt = Date.now();
          pendingOnlinePings.set(pingId, { sentAt, transport: heartbeatTransport });
          for (const [id, pending] of pendingOnlinePings) {
            const pendingSentAt = typeof pending === 'number' ? pending : pending?.sentAt;
            if (Number.isFinite(pendingSentAt) && Date.now() - pendingSentAt > ONLINE_PEER_TIMEOUT_MS) {
              pendingOnlinePings.delete(id);
            }
          }
          try {
            if (!conn.send({
              type: 'ping',
              step: history.length,
              stateVersion: history.length,
              stateDigest: getOnlineStateDigest(),
              pingId,
              sentAt,
              networkState: getLocalOnlineNetworkState()
            }, heartbeatTransport)) pendingOnlinePings.delete(pingId);
          } catch(e) {
            pendingOnlinePings.delete(pingId);
          }
          updateOnlineNetworkUI();
        } else {
          updateOnlineNetworkUI();
        }
      };
      onlineHeartbeatTimer = setInterval(() => sendHeartbeat(true), ONLINE_HEARTBEAT_INTERVAL_MS);
      // setupConn 会早于双方进房闸门完成：0ms 首探测可能仍处于 AI 模式。
      // 在移动 WebView 上补两次轻量探测，让进房后约 1 秒即可显示实际链路延迟，
      // 不必等满第一个 4 秒心跳周期。
      setTimeout(() => sendHeartbeat(false), 0);
      setTimeout(() => sendHeartbeat(false), 700);
      setTimeout(() => sendHeartbeat(false), 1600);

      conn.on('close', () => {
        if (conn !== connection || gameMode !== 'online' || isOver) return;
        if (onlineHeartbeatTimer) clearInterval(onlineHeartbeatTimer);
        triggerOnlineReconnect("连接断开");
      });

      conn.on('error', (err) => {
        if (conn !== connection || gameMode !== 'online' || isOver) return;
        console.warn('[conn error]', err);
        if (onlineHeartbeatTimer) clearInterval(onlineHeartbeatTimer);
        triggerOnlineReconnect("网络异常");
      });

      conn.on('delivery_timeout', (message) => {
        if (conn !== connection || gameMode !== 'online') return;
        if (message && message.type === 'move') {
          showGameNotice("⚠️ 落子暂未收到对方确认，正在自动对账棋局…", true);
          requestOnlineResync();
        } else if (message && message.type === 'chat') {
          showGameNotice("⚠️ 这条聊天暂未确认送达，请稍后重试", true);
        }
      });

      conn.on('data', (data, receivedTransport = 'mqtt') => {
        if (conn !== connection || connection.closed) return;
        if (!data || typeof data !== 'object' || typeof data.type !== 'string' || data.type.length > 64) return;
        if (data.name !== undefined && (typeof data.name !== 'string' || data.name.length > MAX_NETWORK_PROFILE_NAME_CHARS)) return;
        if (data.avatar !== undefined && !isSafeNetworkAvatar(data.avatar)) return;
        if (data.step !== undefined && (!Number.isInteger(data.step) || data.step < 0 || data.step > 1024)) return;
        if (data.roundId !== undefined && (typeof data.roundId !== 'string' || data.roundId.length > 80)) return;
        if (data.requestId !== undefined && (typeof data.requestId !== 'string' || data.requestId.length > 80)) return;
        if (data.nextRoundId !== undefined && (typeof data.nextRoundId !== 'string' || data.nextRoundId.length > 80)) return;
        if (data.sessionId !== undefined &&
            (typeof data.sessionId !== 'string' || data.sessionId.length > 96 ||
             (onlineSessionId && data.sessionId !== onlineSessionId))) return;
        if (data.senderRole !== undefined &&
            (data.senderRole !== 'host' && data.senderRole !== 'client' ||
             data.senderRole === (myOnlineColor === BLACK ? 'host' : 'client'))) return;
        if (data.stateVersion !== undefined &&
            (!Number.isInteger(data.stateVersion) || data.stateVersion < 0 || data.stateVersion > 1024)) return;
        if (data.stateDigest !== undefined &&
            (typeof data.stateDigest !== 'string' || !/^[0-9a-f]{8}$/i.test(data.stateDigest))) return;
        if (data.ackId !== undefined && (typeof data.ackId !== 'string' || data.ackId.length > 80)) return;
        if (data.pingId !== undefined && (typeof data.pingId !== 'string' || data.pingId.length > 80)) return;
        if (data.sentAt !== undefined && (!Number.isFinite(data.sentAt) || Math.abs(Date.now() - data.sentAt) > 120000)) return;
        if (data.networkState !== undefined && (typeof data.networkState !== 'string' || data.networkState.length > 32)) return;
        if (data.peerState !== undefined && (typeof data.peerState !== 'string' || data.peerState.length > 32)) return;
        // 首个 pong 可能发生在对方尚未完成第一次测速时，null 代表“尚未知晓”，不能因此丢弃整条 pong。
        if (data.peerLatencyMs !== undefined && data.peerLatencyMs !== null &&
            (!Number.isFinite(data.peerLatencyMs) || data.peerLatencyMs < 0 || data.peerLatencyMs > 120000)) return;
        if (data.peerTransportRttMs !== undefined && data.peerTransportRttMs !== null &&
            (!Number.isFinite(data.peerTransportRttMs) || data.peerTransportRttMs < 0 || data.peerTransportRttMs > 120000)) return;
        // 新局轮次不一致的报文一律丢弃，防止旧中继/P2P 报文在重开后再次触发旧胜局。
        if (data.roundId && onlineRoundId && data.roundId !== onlineRoundId) return;
        // pong 的延迟只在后面确认“请求和响应走的是同一条链路”后记账，
        // 避免 P2P 切换瞬间迟到的中继 pong 污染 P2P 延迟。
        if (data.type !== 'pong') {
          markOnlinePeerSeen(data.networkState || data.peerState || '在线', undefined, data.peerTransportRttMs);
        }
        if (data.type === "leave_room") {
          if (data.senderRole && data.senderRole === (myOnlineColor === BLACK ? 'host' : 'client')) return;
          showGameNotice(`⚠️ 对手【${normalizeNetworkName(data.name, p2Name)}】已退出房间，已自动切回人机对弈模式~`, false);
          if (onlineHeartbeatTimer) clearInterval(onlineHeartbeatTimer);
          detachHostInviteListener();
          if (conn) { try { conn.close(true); } catch(_) {} conn = null; }
          closeMqttClientPool();
          if (p2pChannel) { try { p2pChannel.close(); } catch(_) {} p2pChannel = null; }
          activeOnlineGuestUid = '';
          activeOnlineOpponentUid = '';
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
          if (typeof closeUndoModal === 'function') closeUndoModal();
          if (typeof closeGameResultModal === 'function') closeGameResultModal();
          setMode("ai", false);
          return;
        }
        if (data.type === 'ping') {
          try {
            conn.send({
              type: 'pong',
              step: history.length,
              stateVersion: history.length,
              stateDigest: getOnlineStateDigest(),
              pingId: data.pingId,
              peerState: getLocalOnlineNetworkState(),
              peerLatencyMs: onlineNetworkTelemetry.localLatencyMs,
              peerTransportRttMs: getLocalOnlineTransportRtt()
            }, receivedTransport);
          } catch(e) {}
          // 🛡️ 心跳对账：若发现双方步数不一致，房主立即下发全量快照，客方主动请求
          if (data.step !== undefined && !isOver && data.step !== history.length) {
            requestOnlineResync('心跳步数不一致');
          } else if (data.stateDigest && data.stateDigest !== getOnlineStateDigest()) {
            requestOnlineResync('心跳摘要不一致');
          }
          return;
        }
        if (data.type === 'pong') {
          const pending = data.pingId ? pendingOnlinePings.get(data.pingId) : null;
          const expectedTransport = pending && typeof pending === 'object' ? pending.transport : '';
          if (expectedTransport && receivedTransport !== expectedTransport) {
            markOnlinePeerSeen(data.peerState || '在线', undefined, data.peerTransportRttMs);
            updateOnlineNetworkUI();
            return;
          }
          missedPings = 0;
          if (data.pingId && pendingOnlinePings.has(data.pingId)) {
            const startedAt = typeof pending === 'number' ? pending : pending?.sentAt;
            pendingOnlinePings.delete(data.pingId);
            if (Number.isFinite(startedAt)) recordOnlineLatencySample('local', Date.now() - startedAt);
            onlineNetworkTelemetry.localTransportRttMs = getLocalOnlineTransportRtt();
          }
          markOnlinePeerSeen(data.peerState || '在线', data.peerLatencyMs, data.peerTransportRttMs);
          if (data.step !== undefined && !isOver && data.step !== history.length) {
            requestOnlineResync('对端步数不一致');
          } else if (data.stateDigest && data.stateDigest !== getOnlineStateDigest()) {
            requestOnlineResync('对端摘要不一致');
          }
          return;
        }
        if (data.type === 'sync_req') {
          if (myOnlineColor === BLACK) {
            sendFullStateSnapshot();
          }
          return;
        }
        if (data.type === 'reconnect_handshake') {
          // 只有房主响应重连握手并下发权威快照；客方收到同类报文不反向覆盖棋局。
          if (myOnlineColor === BLACK) {
            sendFullStateSnapshot();
            onReconnectSuccess();
          }
          return;
        }
        if (data.type === 'state_snapshot') {
          // 房主是唯一的公共棋局快照权威；客方快照不能反向覆盖房主状态。
          if (myOnlineColor === BLACK || (data.senderRole && data.senderRole !== 'host')) return;
          // 🛡️ 收到全量快照：对等双向安全审计与防倒退/防篡改校验
          if (!validateIncomingSnapshot(data)) {
            console.warn('[state_snapshot] 拦截结构非法的棋局快照');
            return;
          }
          if (!isIncomingStateDigestValid(data)) {
            console.warn('[state_snapshot] 状态摘要校验失败，拒绝应用损坏快照');
            requestOnlineResync('快照摘要校验失败');
            return;
          }

          // 1. 防倒退校验：如果发来的步数少于本地步数，说明对方因卡顿落后！
          // 客方绝不倒退；它只请求房主再次对账，避免双方互相覆盖。
          if (data.history.length < history.length ||
              (data.stateVersion !== undefined && data.stateVersion < history.length)) {
            console.warn('[state_snapshot] 房主快照落后于本地，等待下一次权威对账');
            requestOnlineResync('房主快照落后');
            return;
          }

          // 2. 账本一致性前缀校验：比对双方已共同落子的历史记录（防中途恶意篡改已有棋子）
          let isHistoryConsistent = true;
          for (let i = 0; i < history.length; i++) {
            const myH = history[i];
            const oppH = data.history[i];
            if (!myH || !oppH) { isHistoryConsistent = false; break; }
            const myAct = myH.action || myH.type;
            const oppAct = oppH.action || oppH.type;
            if (myAct || oppAct) {
              if (myAct !== oppAct) { isHistoryConsistent = false; break; }
            } else if (myH.r !== oppH.r || myH.c !== oppH.c || myH.p !== oppH.p) {
              isHistoryConsistent = false;
              break;
            }
          }
          if (!isHistoryConsistent && history.length > 0) {
            console.error('[state_snapshot] 检测到棋局历史前缀冲突，已安全拦截异常快照！');
            showGameNotice("⚠️ 检测到异常棋局数据，已安全拦截并保持当前棋局！", true);
            return;
          }

          // 3. 安全核验通过，接纳恢复最新局势
          board = data.board.map(row => [...row]);
          history = data.history.map(step => ({ ...step }));
          turn = data.turn;
          isOver = data.isOver;
          gameResultIsDraw = data.isDraw === true;
          gameWinnerColor = data.winnerColor === BLACK || data.winnerColor === WHITE ? data.winnerColor : 0;
          winningLine = null;
          if (isOver && gameWinnerColor) {
            for (let i = history.length - 1; i >= 0; i--) {
              const step = history[i];
              if (step && step.r >= 0 && step.c >= 0 && step.p === gameWinnerColor && checkWin(step.r, step.c, step.p)) break;
            }
          }
          p2Name = normalizeNetworkName(data.p1Name, p2Name);
          if (isSafeNetworkAvatar(data.p1Avatar)) p2Avatar = data.p1Avatar;
          // 干扰牌是每位玩家的私有手牌，重连只同步棋盘，不覆盖本地手牌或泄露对方手牌。
          updatePlayerHeaderUI();
          draw();
          updateUI();
          persistGameState();
          onReconnectSuccess();
          return;
        }
        if (data.type === 'move') {
          const remoteColor = myOnlineColor === BLACK ? WHITE : BLACK;
          const isValidMove = Number.isInteger(data.r) && Number.isInteger(data.c) &&
            data.r >= 0 && data.r < 15 && data.c >= 0 && data.c < 15 &&
            data.p === remoteColor && board[data.r][data.c] === EMPTY;
          if (!isValidMove) {
            requestOnlineResync('收到非法或重复落子');
            return;
          }
          // 🛡️ 步数、回合和棋子颜色必须同时连续；错位后只请求对账，不继续执行可疑落子。
          if ((data.step !== undefined && (!Number.isInteger(data.step) || data.step !== history.length + 1)) ||
              (data.stateVersion !== undefined && data.stateVersion !== history.length + 1) ||
              turn !== remoteColor) {
            requestOnlineResync('落子顺序不一致');
            return;
          }
          makeMove(data.r, data.c, data.p, true);
        } else if (data.type === 'chat') {
          if (typeof data.text !== 'string' || data.text.length > MAX_CHAT_MESSAGE_CHARS) return;
          addMessage(2, data.text);
        } else if (data.type === 'profile_sync') {
          if (data.uid !== undefined && (typeof data.uid !== 'string' || data.uid.length > 64)) return;
          if (data.name !== undefined && (typeof data.name !== 'string' || data.name.length > MAX_NETWORK_PROFILE_NAME_CHARS)) return;
          if (data.avatar !== undefined && !isSafeNetworkAvatar(data.avatar)) return;
          if (data.isReply !== undefined && typeof data.isReply !== 'boolean') return;
          p2Name = normalizeNetworkName(data.name, p2Name || '好友');
          if (data.avatar !== undefined) p2Avatar = data.avatar;
          if (typeof data.uid === 'string' && data.uid) activeOnlineOpponentUid = data.uid;
          updatePlayerHeaderUI();
          if (!data.isReply && conn && conn.open) {
            conn.send({ type: 'profile_sync', uid: currentUserUid || '', name: normalizeNetworkName(p1Name, '棋友'), avatar: getNetworkAvatarValue(p1Avatar), isReply: true });
          }
        } else if (data.type === 'undo_req') {
          const incomingUndoId = typeof data.requestId === 'string' && data.requestId ? data.requestId : generateSecureId(10, 'undo_');
          if (activeOnlineUndoId) return;
          activeOnlineUndoId = incomingUndoId;
          if (isOver || data.wasOver) {
            undoDescText.textContent = "对方发起了终局悔棋申请，是否同意撤回决胜落子继续对战？";
          } else {
            undoDescText.textContent = "对方发起了悔棋申请，是否同意？";
          }
          document.getElementById('btnUndoAgree').textContent = "✅ 同意悔棋";
          document.getElementById('btnUndoRefuse').style.display = "block";
          if (typeof closeGameResultModal === 'function') closeGameResultModal();
          undoModal.classList.add('show');
        } else if (data.type === 'undo_res') {
          if (!pendingOnlineUndoId) return;
          if (pendingOnlineUndoId && data.requestId && data.requestId !== pendingOnlineUndoId) return;
          pendingOnlineUndoId = '';
          if (!validateIncomingUndoState(data)) {
            console.warn('[undo_res] 拦截结构非法的悔棋响应');
            return;
          }
          if (data.agree) {
            const localUndoApplied = doUndo();
            if (!localUndoApplied) {
              showGameNotice("⚠️ 悔棋状态已过期，正在重新对齐棋局！", true);
              requestOnlineResync();
              return;
            }
            if (data.board && data.history) {
              board = data.board.map(r => [...r]);
              history = data.history.map(h => ({ ...h }));
              if (data.turn !== undefined) turn = data.turn;
              isOver = false;
              gameWinnerColor = 0;
              gameResultIsDraw = false;
              winningLine = null;
              cancelPendingGameResultModal();
              closeGameResultModal();
              const skillBanner = document.getElementById('skillBanner');
              if (skillBanner) skillBanner.classList.remove('show');
              draw(); updateUI(); persistGameState();
            }
            showGameNotice("✅ 对方同意了悔棋申请！已撤回落子并恢复对局！", false);
          } else {
            showGameNotice("❌ 对方拒绝了您的悔棋申请！落子无悔哦~", true);
          }
        } else if (data.type === 'restart_req') {
          const incomingRestartId = typeof data.requestId === 'string' && data.requestId ? data.requestId : generateSecureId(10, 'restart_');
          if (activeOnlineRestartId) return;
          activeOnlineRestartId = incomingRestartId;
          showCustomConfirm(`【${normalizeNetworkName(data.name, p2Name)}】向您发起重新开局申请，是否同意重置棋盘并开启新局？`, () => {
            activeOnlineRestartId = '';
            const nextRoundId = generateSecureId(12, 'round_');
            if (conn && conn.open) conn.send({ type: 'restart_res', agree: true, requestId: incomingRestartId, nextRoundId });
            resetBoardOnly(nextRoundId);
            showGameNotice("🔄 双方达成一致，已重新开启新的一局！", false);
          }, () => {
            activeOnlineRestartId = '';
            if (conn && conn.open) conn.send({ type: 'restart_res', agree: false, requestId: incomingRestartId });
            showGameNotice("已拒绝对手的重开申请，继续本局", false);
          }, { title: '重开对局申请', icon: '🔄', okText: '✅ 同意重开', cancelText: '❌ 拒绝' });
        } else if (data.type === 'restart_res') {
          if (typeof data.agree !== 'boolean') return;
          if (!pendingOnlineRestartId) return;
          if (pendingOnlineRestartId && data.requestId && data.requestId !== pendingOnlineRestartId) return;
          pendingOnlineRestartId = '';
          if (data.agree) {
            resetBoardOnly(data.nextRoundId || null);
            showGameNotice("🎉 对手同意了您的重开申请，新对局已开启！", false);
          } else {
            showGameNotice("❌ 对手拒绝了重开申请，继续当前对局！", true);
          }
        } else if (data.type === 'restart') {
          // 兼容旧版客户端指令：弹出协商弹窗，严禁单方面清空棋盘
          const incomingRestartId = typeof data.requestId === 'string' && data.requestId ? data.requestId : generateSecureId(10, 'restart_');
          if (activeOnlineRestartId) return;
          activeOnlineRestartId = incomingRestartId;
          showCustomConfirm(`【${normalizeNetworkName(data.name, p2Name)}】向您发起重新开局申请，是否同意重开？`, () => {
            activeOnlineRestartId = '';
            const nextRoundId = generateSecureId(12, 'round_');
            if (conn && conn.open) conn.send({ type: 'restart_res', agree: true, requestId: incomingRestartId, nextRoundId });
            resetBoardOnly(nextRoundId);
            showGameNotice("🔄 双方达成一致，已重新开启新的一局！", false);
          }, () => {
            activeOnlineRestartId = '';
            if (conn && conn.open) conn.send({ type: 'restart_res', agree: false, requestId: incomingRestartId });
            showGameNotice("已拒绝对手的重开申请，继续本局", false);
          }, { title: '重开对局申请', icon: '🔄', okText: '✅ 同意重开', cancelText: '❌ 拒绝' });
        } else if (data.type === "skill_use") {
          const quotaBefore = {
            opponentSkillsUsedCount,
            opponentReforgeUsed
          };
          const incomingCard = SKILL_CARD_POOL.find(card => card.id === data.skillId);
          if (!incomingCard || !validateIncomingSkillUse(data)) {
            console.warn("[AntiCheat] 无效的无目标技能报文，已被裁判拦截");
            requestOnlineResync('无目标技能顺序不一致');
            return;
          }
          // 远端无目标技能也要写入本地撤销栈，否则双方栈会错位，悔棋时无法恢复本地手牌额度。
          saveUndoSnapshot('skill', {
            source: 'remote',
            skillId: data.skillId,
            player: myOnlineColor === BLACK ? WHITE : BLACK,
            ...quotaBefore
          });
          alert(`⚡ 对方发动了干扰卡【${incomingCard.name}】！`);
        } else if (data.type.startsWith("skill_") || data.type.startsWith("destiny_point_")) {
          const quotaBefore = {
            opponentSkillsUsedCount,
            opponentReforgeUsed
          };
          if (!validateIncomingSkill(data)) {
            console.warn("[AntiCheat] 技能报文非法，已被裁判拦截丢弃:", data);
            requestOnlineResync('技能状态不一致');
            return;
          }
          // destiny_point_1/2 是【命运神抽】的结果报文；前置 skill_use 已经记录了同一张牌，不能重复压栈。
          if (data.type !== 'destiny_point_1' && data.type !== 'destiny_point_2') {
            saveUndoSnapshot('skill', {
              source: 'remote',
              skillId: data.type,
              player: myOnlineColor === BLACK ? WHITE : BLACK,
              ...quotaBefore
            });
          }
          if (data.type === "skill_identity_swap") {
            // 身份互换：全盘棋子颜色对调
            for (let r = 0; r < 15; r++) for (let c = 0; c < 15; c++) {
              if (board[r][c] === BLACK) board[r][c] = WHITE;
              else if (board[r][c] === WHITE) board[r][c] = BLACK;
            }
            // ⚠️ 严禁倒退翻转已有落子记录（杜绝开头就互换颜色），记录身份互换事件
            history.push({ action: 'identity_swap', type: 'skill_identity_swap', r: -1, c: -1, p: 0, desc: '身份互换' });
            triggerBoardShake();
            playSkillSound('warp');
            showSkillBanner('🔄', '对方发动【身份互换】！', '全场棋子黑白颠倒！');
            draw();
            // 检查互换后是否有人达成五子连珠（直接按棋盘实际棋子扫描判定）
            winningLine = null;
            let hasWin = false;
            for (let r = 0; r < 15; r++) {
              for (let c = 0; c < 15; c++) {
                if (board[r][c] !== EMPTY && checkWin(r, c, board[r][c])) {
                  triggerGameEnd(board[r][c], `对方发动身份互换后，【${getPlayerNameByColor(board[r][c])} (${board[r][c] === BLACK ? '黑子' : '白子'})】直接达成五子连珠获胜！`);
                  hasWin = true;
                  break;
                }
              }
              if (hasWin) break;
            }
            if (!hasWin && isBoardFull()) {
              triggerGameDraw('对方发动身份互换后棋盘已无空位，双方本局和棋！');
            }
          } else if (data.type === 'skill_prophecy') {
          prophecyPoint = { r: data.r, c: data.c, by: data.by };
          draw();
          showSkillBanner('🔮', '对方发动【预言封锁】！', `对方预言了您下一步落点为 (${data.r+1}, ${data.c+1})，若落此处将被强行抹杀撤销！`);
        } else if (data.type === 'skill_remove_stone') {
          const removedP = board[data.r][data.c];
          board[data.r][data.c] = EMPTY;
          history.push({
            action: 'remove_stone',
            type: 'skill_remove_stone',
            r: data.r,
            c: data.c,
            p: removedP !== EMPTY ? removedP : myOnlineColor,
            by: (myOnlineColor === BLACK ? WHITE : BLACK),
            desc: '虚空陨石'
          });
          draw();
          updateUI();
          persistGameState();
          alert(`💥 对方发动了【虚空陨石】！抹除了您在 (${data.r+1}, ${data.c+1}) 的棋子！`);
        } else if (data.type === 'skill_shift_stone') {
          board[data.fromR][data.fromC] = EMPTY;
          board[data.toR][data.toC] = data.p;
          history.push({
            action: 'shift_stone',
            type: 'skill_shift_stone',
            fromR: data.fromR,
            fromC: data.fromC,
            toR: data.toR,
            toC: data.toC,
            r: data.toR,
            c: data.toC,
            p: data.p,
            desc: '移星换斗'
          });
          draw();
          updateUI();
          persistGameState();
          alert(`🌟 对方发动了【移星换斗】！将其棋子移到了 (${data.toR+1}, ${data.toC+1})！`);
        } else if (data.type === 'skill_swap_color') {
          const oldColor = board[data.r][data.c];
          board[data.r][data.c] = data.p;
          history.push({
            action: 'swap_color',
            type: 'skill_swap_color',
            r: data.r,
            c: data.c,
            fromP: oldColor !== EMPTY ? oldColor : (data.p === BLACK ? WHITE : BLACK),
            p: data.p,
            desc: '偷天换日'
          });
          triggerSkillVFX('swap_color', data.r, data.c);
          triggerBoardShake();
          playSkillSound('magic');
          showSkillBanner('🎭', `对方发动【偷天换日】！`, `您位于 (${data.r+1}, ${data.c+1}) 的棋子被策反！`);
          draw();
          updateUI();
          persistGameState();
        } else if (data.type === 'skill_swap_positions') {
          const p1 = board[data.r1][data.c1];
          const p2 = board[data.r2][data.c2];
          board[data.r1][data.c1] = p2;
          board[data.r2][data.c2] = p1;
          history.push({
            action: 'swap_positions',
            type: 'skill_swap_positions',
            r1: data.r1,
            c1: data.c1,
            p1: p2,
            r2: data.r2,
            c2: data.c2,
            p2: p1,
            desc: '移形换影'
          });
          triggerSkillVFX('swap_positions', data.r2, data.c2, data.r1, data.c1);
          triggerBoardShake();
          playSkillSound('warp');
          showSkillBanner('💫', `对方发动【移形换影】！`, `双方棋子位置发生了对调！`);
          draw();
          updateUI();
          persistGameState();
        } else if (data.type === 'skill_mega_bomb') {
          const prevStones = [];
          for (let r = 0; r < 15; r++) {
            for (let c = 0; c < 15; c++) {
              if (board[r][c] !== EMPTY) {
                prevStones.push({ r, c, p: board[r][c] });
              }
            }
          }
          for (let r = 0; r < 15; r++) {
            for (let c = 0; c < 15; c++) board[r][c] = EMPTY;
          }
          for (const s of data.stones) {
            board[s.r][s.c] = s.p;
          }
          history.push({
            action: 'mega_bomb',
            type: 'skill_mega_bomb',
            stones: data.stones.map(s => ({ ...s })),
            prevStones: prevStones,
            r: -1,
            c: -1,
            p: (myOnlineColor === BLACK ? WHITE : BLACK),
            desc: '乾坤大乱'
          });
          triggerSkillVFX('mega_bomb');
          triggerBoardShake(true);
          playSkillSound('bomb');
          showSkillBanner('💣', `对方发动【乾坤大乱/大炸弹】！`, `天翻地覆！全盘所有棋子已被随机打乱！`);
          winningLine = null;
          for (const s of data.stones) {
            if (checkWin(s.r, s.c, s.p)) {
              triggerGameEnd(s.p, `对方引爆炸弹洗牌后，【${getPlayerNameByColor(s.p)} (${s.p === BLACK ? '黑子' : '白子'})】达成五子连珠！`);
              break;
            }
          }
          if (!isOver && isBoardFull()) {
            triggerGameDraw('对方引爆炸弹后棋盘已无空位，双方本局和棋！');
          }
          draw();
          updateUI();
          persistGameState();
        } else if (data.type === 'destiny_point_1') {
          opponentFreeMove = true;
          turn = myOnlineColor;
          updateUI();
          showSkillBanner('💀', '对方掷出【大凶·空军】！', '对方本回合直接空过！您获得免费补下 1 子！');
        } else if (data.type === 'destiny_point_2') {
          const shiftColor = (myOnlineColor === BLACK ? WHITE : BLACK);
          board[data.fromR][data.fromC] = EMPTY;
          board[data.toR][data.toC] = shiftColor;
          history.push({
            action: 'shift_stone',
            type: 'skill_shift_stone',
            fromR: data.fromR,
            fromC: data.fromC,
            toR: data.toR,
            toC: data.toC,
            r: data.toR,
            c: data.toC,
            p: shiftColor,
            desc: '偷梁换柱'
          });
          triggerSkillVFX('shift_stone', data.toR, data.toC, data.fromR, data.fromC);
          playSkillSound('magic');
          showSkillBanner('🙈', '对方触发【偷梁换柱】！', `盲选将其位于 (${data.fromR+1}, ${data.fromC+1}) 的棋子移到了 (${data.toR+1}, ${data.toC+1})！`);
          draw(); updateUI(); persistGameState();
        } else if (data.type === 'destiny_wipe_danger') {
          data.stones.forEach(pos => {
            board[pos.r][pos.c] = EMPTY;
            triggerSkillVFX('remove_stone', pos.r, pos.c);
          });
          history.push({
            action: 'destiny_wipe_danger',
            type: 'destiny_wipe_danger',
            stones: data.stones.map(s => ({ ...s })),
            r: -1,
            c: -1,
            p: (myOnlineColor === BLACK ? WHITE : BLACK),
            desc: '天命掀桌'
          });
          triggerBoardShake(true);
          playSkillSound('boom');
          showSkillBanner('👑', '对方发动【天命掀桌】！', `我方 ${data.stones.length} 颗杀机连线已被强行作废抹除！`);
          draw(); updateUI(); persistGameState();
        } else if (data.type === 'destiny_place_2x2') {
          data.cells.forEach(pos => {
            board[pos.r][pos.c] = data.p;
            history.push({ r: pos.r, c: pos.c, p: data.p });
            triggerStoneDropVFX(pos.r, pos.c, data.p);
          });
          triggerBoardShake();
          playSkillSound('victory');
          showSkillBanner('👑', '对方发动【天命降临】！', '2×2 区域瞬间天降 4 颗连星！');
          draw(); updateUI(); persistGameState();
          let hasWinner = false;
          for (const pos of data.cells) {
            if (checkWin(pos.r, pos.c, data.p)) {
              triggerGameEnd(data.p, `对方发动天命降临后，【${getPlayerNameByColor(data.p)} (${data.p === BLACK ? '黑子' : '白子'})】达成五子连珠！`);
              hasWinner = true;
              break;
            }
          }
          if (!hasWinner && isBoardFull()) {
            triggerGameDraw('对方发动天命降临后棋盘已无空位，双方本局和棋！');
          }
        }
        // 技能可能通过移形、策反、抹除后的棋盘变化直接形成五子；这些分支
        // 过去只刷新棋盘，没有统一做终局判定，导致一方已经成五却继续对局。
        settleRemoteSkillResult();
      }
      });
    }

    // ==========================================
    // 🎴 干扰技能卡执行与棋盘交互核心逻辑
    // ==========================================
    async function joinMqttRoom(code, btn) {
      if (!/^\d{6}$/.test(String(code))) return showGameNotice("请输入 6 位数字房间码！", true);

      // 手动加入是一个全新的传输世代；先作废旧连接的异步回调。
      // 房客不在这里伪造会话 ID，真正的 ID 只接受自房主的 join_accepted。
      if (!isReconnecting || String(currentRoomCode || '') !== String(code)) {
        onlineSessionId = '';
        onlineJoinTicket = '';
        onlineTransportGeneration++;
        clearOnlineReliableOutbox();
      }
      const transportGeneration = onlineTransportGeneration;

      // 加入房间的一方固定执白。先在建连阶段写入颜色，避免 accepted 报文延迟时
      // 客户端仍沿用默认 BLACK，出现“双方都是黑子”并在首步互相拦截的假联机状态。
      setOnlineColor(WHITE);
      // 加入过程完成前冻结旧的人机搜索，避免用户已经点击加入房间却继续看见旧棋局中的 AI 落子。
      aiTurnSeq++;
      aiThinking = false;

      if (currentRoomCode && String(currentRoomCode) !== String(code)) {
        clearOnlineReliableOutbox();
      }

      if (btn) {
        btn.disabled = true;
        btn.textContent = '⏳ 正在连接好友房间...';
      }

      if (conn) {
        try { conn.close(true); } catch(e) {}
        conn = null;
      }
      detachHostInviteListener();

      try {
        const client = await getOrCreateOnlineTransport(code, 'client', onlineSessionId);
        if (transportGeneration !== onlineTransportGeneration ||
            (currentRoomCode && String(currentRoomCode) !== String(code))) return;
        const c2hTopic = `gomoku/v3/${code}/c2h`;
        const h2cTopic = `gomoku/v3/${code}/h2c`;

        let hasJoined = false;
        let joinCancelled = false;
        let joiningConnection = null;
        let joinInterval = null;
        let joinTimeout = null;
        let joinConfirmTimeout = null;
        let joinReadyInterval = null;

        const restoreBtn = () => {
          if (btn) {
            btn.disabled = false;
            btn.textContent = '🚀 立即连接开局';
          }
        };

        const clearJoinConfirmTimeout = () => {
          if (joinConfirmTimeout) clearTimeout(joinConfirmTimeout);
          joinConfirmTimeout = null;
        };

        const clearJoinReadyRetry = () => {
          if (joinReadyInterval) clearInterval(joinReadyInterval);
          joinReadyInterval = null;
        };

        const myJoinUid = getOrCreateMatchUid();
        const startJoinReadyRetry = (connection) => {
          clearJoinReadyRetry();
          const sendReady = () => {
            if (transportGeneration !== onlineTransportGeneration || hasJoined || joinCancelled ||
                joiningConnection !== connection || conn !== connection || !connection.open || !connection.ready) return;
            const payload = JSON.stringify({
              type: 'join_ready',
              uid: myJoinUid,
              name: normalizeNetworkName(p1Name, '棋友'),
              avatar: getNetworkAvatarValue(p1Avatar),
              sessionId: onlineSessionId || undefined,
              joinTicket: onlineJoinTicket || undefined,
              roundId: onlineRoundId || undefined
            });
            try { client.publish(c2hTopic, payload, { qos: MQTT_ROOM_DATA_QOS, retain: false }); } catch (_) {}
          };
          sendReady();
          setTimeout(sendReady, 150);
          setTimeout(sendReady, 350);
          joinReadyInterval = setInterval(sendReady, ONLINE_JOIN_READY_RETRY_MS);
        };

        const onClientInvite = (topic, payload) => {
          if (transportGeneration !== onlineTransportGeneration) return;
          if (topic !== h2cTopic) return;
          try {
            const rawPayload = payload && typeof payload.toString === 'function' ? payload.toString() : '';
            if (rawPayload.length > 64 * 1024) return;
            const data = JSON.parse(rawPayload);

            // 🛡️ 接收到满员拒绝信号：立即停止重试，给用户明确提示
            if (data.type === 'room_full') {
              if (!data.targetUid || data.targetUid === myJoinUid) {
                joinCancelled = true;
                clearInterval(joinInterval);
                clearTimeout(joinTimeout);
                clearJoinReadyRetry();
                clearJoinConfirmTimeout();
                client.removeListener('message', onClientInvite);
                restoreBtn();
                showGameNotice('🚫 该房间已有 2 位棋友正在对弈，人数已满！请让好友新建房间或更换房间码。', true);
                return;
              }
            }

            if (data.type === 'join_confirmed' && !hasJoined) {
              if (data.targetUid && data.targetUid !== myJoinUid) return;
              if (data.sessionId !== undefined &&
                  (typeof data.sessionId !== 'string' || data.sessionId.length > 96 ||
                   (onlineSessionId && data.sessionId !== onlineSessionId))) return;
              if (data.joinTicket !== undefined &&
                  (typeof data.joinTicket !== 'string' || data.joinTicket.length > 96)) return;
              if (data.joinTicket !== undefined && onlineJoinTicket && data.joinTicket !== onlineJoinTicket) return;
              if (data.roundId !== undefined && (typeof data.roundId !== 'string' || data.roundId.length > 80)) return;
              if (data.roundId && onlineRoundId && data.roundId !== onlineRoundId) return;
              const readyConnection = joiningConnection;
              if (!readyConnection || conn !== readyConnection || !readyConnection.open || !readyConnection.ready) return;
              hasJoined = true;
              clearJoinConfirmTimeout();
              clearJoinReadyRetry();
              clearInterval(joinInterval);
              clearTimeout(joinTimeout);
              client.removeListener('message', onClientInvite);
              restoreBtn();
              closeOnlineModal();
              if (gameMode !== 'online') setMode('online');
              else updateOnlineNetworkUI();
              persistGameState();
              const guestBadgeEl = document.getElementById('roomStatusBadge');
              if (guestBadgeEl) {
                guestBadgeEl.innerHTML = '🟢 已与好友连接，可以开始对弈';
                guestBadgeEl.style.color = '#10b981';
              }
              showGameNotice('🎉 已成功连入好友房间！您执白~', false);
              if (activeOnlineOpponentUid && window.GomokuSocial?.recordOpponent) void window.GomokuSocial.recordOpponent(activeOnlineOpponentUid);
              try {
                readyConnection.send({ type: 'profile_sync', uid: currentUserUid || '', name: p1Name, avatar: getNetworkAvatarValue(p1Avatar) });
              } catch (_) {}
              return;
            }

            if (data.type === 'join_accepted' && !hasJoined) {
              if (data.targetUid && data.targetUid !== myJoinUid) {
                return;
              }
              if (data.name !== undefined && (typeof data.name !== 'string' || data.name.length > MAX_NETWORK_PROFILE_NAME_CHARS)) return;
              if (data.uid !== undefined && (typeof data.uid !== 'string' || data.uid.length > 64)) return;
              if (data.avatar !== undefined && !isSafeNetworkAvatar(data.avatar)) return;
              if (data.roundId !== undefined && (typeof data.roundId !== 'string' || data.roundId.length > 80)) return;
              if (data.sessionId !== undefined &&
                  (typeof data.sessionId !== 'string' || data.sessionId.length > 96)) return;
              // accepted 可能会按 burst 重发；在上一条连接真正 ready 前只保留一个建连任务。
              if (joiningConnection) return;
              clearInterval(joinInterval);
              clearTimeout(joinTimeout);
              const acceptedSessionId = typeof data.sessionId === 'string' ? data.sessionId : '';
              if (onlineSessionId && acceptedSessionId && onlineSessionId !== acceptedSessionId) return;
              onlineSessionId = acceptedSessionId || onlineSessionId;
              activeOnlineOpponentUid = typeof data.uid === 'string' ? data.uid : activeOnlineOpponentUid;
              onlineJoinTicket = typeof data.joinTicket === 'string' ? data.joinTicket : onlineJoinTicket;
              const nextConn = new MqttRoomConnection(client, code, 'client', onlineSessionId);
              joiningConnection = nextConn;
              conn = nextConn;
              lastActiveRoomCode = code;
              currentRoomCode = code;
              myOnlineColor = WHITE;
              const acceptedRoundId = typeof data.roundId === 'string' ? data.roundId : '';
              if (onlineRoundId && acceptedRoundId && onlineRoundId !== acceptedRoundId) {
                clearOnlineReliableOutbox();
              }
              onlineRoundId = acceptedRoundId;
              resetChatHistoryForRoom();
              p2Name = normalizeNetworkName(data.name, '房主');
              p2Avatar = isSafeNetworkAvatar(data.avatar) ? data.avatar : '👦';
              updatePlayerHeaderUI();
              // 先挂载数据/断线监听，再等待 ready，避免 ready 后到达的首条资料消息丢失。
              setupConn();

              (async () => {
                try {
                  await nextConn.readyPromise;
                  if (transportGeneration !== onlineTransportGeneration || joinCancelled || joiningConnection !== nextConn ||
                      conn !== nextConn || !nextConn.open || !nextConn.ready) {
                    throw new Error('加入请求已过期或房间连接未就绪');
                  }
                  // accepted 只代表房主信道已就绪；还要等待房主确认 join_ready，
                  // 防止一端提前显示进房、另一端仍停留在人机模式。
                  startJoinReadyRetry(nextConn);
                  clearJoinConfirmTimeout();
                  joinConfirmTimeout = setTimeout(() => {
                    if (hasJoined || joiningConnection !== nextConn) return;
                    joinCancelled = true;
                    clearJoinReadyRetry();
                    try { nextConn.close(true); } catch (_) {}
                    if (conn === nextConn) conn = null;
                    joiningConnection = null;
                    restoreBtn();
                    showGameNotice('❌ 对局确认超时，请重新匹配；P2P 不可用时仍会自动使用 WebSocket 中继', true);
                  }, ONLINE_JOIN_CONFIRM_TIMEOUT_MS);
                  try { nextConn.send({ type: 'profile_sync', name: p1Name, avatar: getNetworkAvatarValue(p1Avatar) }); } catch (_) {}
                } catch (err) {
                  console.warn('[guest room connection]', err);
                  clearJoinConfirmTimeout();
                  clearJoinReadyRetry();
                  if (conn === nextConn) {
                    try { nextConn.close(true); } catch (_) {}
                    conn = null;
                  }
                } finally {
                  // 等待 join_confirmed 时必须保留引用；否则确认报文会被当成旧连接直接丢弃。
                  if (joiningConnection === nextConn && !joinConfirmTimeout && !hasJoined) joiningConnection = null;
                }
              })();
            }
          } catch(e) {
            console.warn('[onClientInvite error]', e);
          }
        };

        client.on('message', onClientInvite);
        client.subscribe(h2cTopic, { qos: MQTT_ROOM_DATA_QOS }, (err) => {
          if (err) {
            joinCancelled = true;
            restoreBtn();
            client.removeListener('message', onClientInvite);
            return showGameNotice('❌ 订阅房间信道失败，请检查网络！', true);
          }

          const sendReq = () => {
            if (transportGeneration !== onlineTransportGeneration || hasJoined) return;
            client.publish(c2hTopic, JSON.stringify({
              type: 'join_request',
              uid: myJoinUid,
              name: normalizeNetworkName(p1Name, '棋友'),
              avatar: getNetworkAvatarValue(p1Avatar)
            }), { qos: MQTT_ROOM_DATA_QOS, retain: false });
          };

          sendReq();
          joinInterval = setInterval(sendReq, 450);
          joinTimeout = setTimeout(() => {
            if (!hasJoined) {
              joinCancelled = true;
              clearInterval(joinInterval);
              clearJoinReadyRetry();
              clearJoinConfirmTimeout();
              client.removeListener('message', onClientInvite);
              if (joiningConnection) {
                try { joiningConnection.close(true); } catch (_) {}
                if (conn === joiningConnection) conn = null;
                joiningConnection = null;
              }
              restoreBtn();
              showGameNotice('❌ 未找到该房间，请确认房间码正确，并让好友先开启房间！', true);
            }
          }, 15000);
        });
      } catch(err) {
        if (btn) {
          btn.disabled = false;
          btn.textContent = '🚀 立即连接开局';
        }
        showGameNotice('❌ 连接服务器失败：' + (err.message || '网络异常'), true);
      }
    }

    async function joinOnlineRoom(targetCode = null) {
      if (isMatchmaking) { cancelQuickMatch(); }
      hideMatchingFloatingBar();
      const codeInput = document.getElementById('inputJoinCode');
      const code = (targetCode || (codeInput ? codeInput.value : "")).trim();
      if (codeInput && targetCode) codeInput.value = targetCode;
      if (!/^\d{6}$/.test(String(code))) return showGameNotice("请输入 6 位数字房间码！", true);

      const btn = document.getElementById('btnConnectRoom');
      return await joinMqttRoom(code, btn);
    }


    
    // ══════════════════════════════════════════════════════════════════
    // ⚡ 全服极速匹配系统 (实时信令 + 人机即时保底双引擎)
    // ══════════════════════════════════════════════════════════════════
    function showMatchingFloatingBar() {
      const bar = document.getElementById("matchingFloatingBar");
      if (bar) bar.style.display = "flex";
    }

    function hideMatchingFloatingBar() {
      const bar = document.getElementById("matchingFloatingBar");
      if (bar) bar.style.display = "none";
    }

    let isMatchmaking = false;
    let matchPollInterval = null;
    let matchTimerInterval = null;
    let matchStartTime = 0;
    let currentActiveMatchUid = "";
    let currentActiveMatchId = "";
    let matchPollInFlight = false;

    function isMatchAuthFailure(response, data) {
      const status = Number(response && response.status);
      const code = Number(data && data.code);
      return status === 401 || status === 403 || code === 401 || code === 403 || code === 2;
    }

    function getMatchSessionToken() {
      try {
        if (typeof currentUserToken !== 'undefined' && currentUserToken) return String(currentUserToken);
        return localStorage.getItem('gomoku_user_token') || '';
      } catch (_) {
        return (typeof currentUserToken !== 'undefined' && currentUserToken) ? String(currentUserToken) : '';
      }
    }

    async function ensureMatchAccountSession() {
      if (!currentUserUid || String(currentUserUid).startsWith('guest_')) return false;
      if (getMatchSessionToken()) return true;
      if (currentUserRefreshToken && typeof refreshUserSession === 'function') {
        await refreshUserSession();
      }
      return Boolean(currentUserUid && !String(currentUserUid).startsWith('guest_') && getMatchSessionToken());
    }

    async function requestMatchApi(endpoint, payload, retryState, timeoutMs = 10000) {
      const send = async () => {
        const body = { ...(payload || {}) };
        // Authorization 头是主路径；body.token 是 Android WebView/旧客户端的兼容兜底。
        // 两者都只通过 HTTPS 发送，服务端仍会校验 uid 与 Token 的绑定关系。
        const sessionToken = getMatchSessionToken();
        if (sessionToken && !body.token) body.token = sessionToken;
        const response = await safeApiFetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          timeoutMs
        });
        let data = null;
        try { data = await response.json(); } catch (_) {
          data = { code: response.status, msg: '服务器返回格式异常' };
        }
        return { response, data };
      };

      let result = await send();
      const state = retryState || {};
      if (isMatchAuthFailure(result.response, result.data) && !state.authRetried && currentUserRefreshToken) {
        state.authRetried = true;
        if (typeof refreshUserSession === 'function' && await refreshUserSession()) {
          result = await send();
        }
      }
      return result;
    }

    function getOrCreateMatchUid() {
      let uid = (typeof currentUserUid !== "undefined" && currentUserUid) ? currentUserUid : localStorage.getItem("gomoku_user_uid");
      if (!uid) {
        uid = localStorage.getItem("gomoku_temp_match_uid");
        if (!uid) {
          uid = "guest_" + Math.floor(100000 + Math.random() * 900000);
          localStorage.setItem("gomoku_temp_match_uid", uid);
        }
      }
      return uid;
    }

    async function startQuickMatch() {
      if (isMatchmaking) return;
      if (!(await ensureMatchAccountSession())) {
        showGameNotice('⚡ 全服匹配需要先登录正式账号，游客仍可使用房间联机。', true);
        if (typeof openAuthModal === 'function') openAuthModal('login');
        return;
      }
      isMatchmaking = true;
      activeMatchRoomKey = '';
      matchStartTime = Date.now();
      clearInterval(matchPollInterval);
      clearInterval(matchTimerInterval);
      matchPollInFlight = false;

      const btnStart = document.getElementById('btnStartMatch');
      const btnCancel = document.getElementById('btnCancelMatch');
      const statusEl = document.getElementById('matchStatusText');
      const vsCard = document.getElementById('matchVsCard');
      const prevAvatar = document.getElementById('matchMyAvatarPreview');

      if (btnStart) btnStart.style.display = 'none';
      if (btnCancel) btnCancel.style.display = 'block';
      if (statusEl) statusEl.textContent = '🔍 正在全服搜寻对手...';
      if (vsCard) vsCard.style.display = 'none';
      if (prevAvatar) prevAvatar.innerHTML = renderAvatarElement(p1Avatar);

      // 实时计时器 (纯真人全服匹配，绝不自动转假人)
      matchTimerInterval = setInterval(() => {
        const elapsed = Math.floor((Date.now() - matchStartTime) / 1000);
        const m = String(Math.floor(elapsed / 60)).padStart(2, "0");
        const s = String(elapsed % 60).padStart(2, "0");
        const timerEl = document.getElementById("matchTimerText");
        if (timerEl) timerEl.textContent = "正在全服搜寻：" + m + ":" + s;

        const floatTimer = document.getElementById("matchingFloatingTimer");
        if (floatTimer) floatTimer.textContent = "正在全服匹配：" + m + ":" + s;

        const statusEl = document.getElementById("matchStatusText");
        if (statusEl) {
          if (elapsed < 8) statusEl.textContent = "🔍 正在全服搜寻实力相当的真实对手...";
          else if (elapsed < 20) statusEl.textContent = "⚡ 正在扩大搜寻范围，邀请全国在线棋友...";
          else if (elapsed < 40) statusEl.textContent = "🌐 持续全网搜寻中，随时为您秒级接通...";
          else statusEl.textContent = "☕ 正在全服耐心等候棋友，可关闭界面保持挂起...";
        }

        // 超过 8 秒后，提供可选的“与智能棋友切磋”按钮（完全由玩家主动选择，绝不强行匹配假人）
        const btnPlayAi = document.getElementById("btnPlayWithAi");
        if (elapsed >= 8 && btnPlayAi && isMatchmaking) {
          btnPlayAi.style.display = "block";
        }

        // 达到 1 小时 (3600秒) 上限保护
        if (elapsed >= 3600 && isMatchmaking) {
          cancelQuickMatch();
          showGameNotice("⏰ 匹配已满 1 小时，已自动结束本次搜寻", true);
        }
      }, 1000);

      currentActiveMatchUid = getOrCreateMatchUid();
      const matchUid = currentActiveMatchUid;
      currentActiveMatchId = generateSecureId(12, 'match_');
      const matchId = currentActiveMatchId;
      const matchRequestState = { authRetried: false };

      try {
        const joinResult = await requestMatchApi('/api/match/join', {
          uid: matchUid,
          matchId,
          nickname: normalizeNetworkName(p1Name, '棋友'),
          avatar: getNetworkAvatarValue(p1Avatar),
          score: currentUserScore || 1000
        }, matchRequestState, 12000);
        const res = joinResult.response;
        const data = joinResult.data;
        if (data.code === 0) {
          if (data.status === 'matched') {
            onMatchFound(data);
          } else {
            // 定时轮询对手是否加入（严格使用统一的 matchUid）
            matchPollInterval = setInterval(async () => {
              if (!isMatchmaking || matchPollInFlight) {
                clearInterval(matchPollInterval);
                return;
              }
              matchPollInFlight = true;
              try {
                const pollResult = await requestMatchApi('/api/match/poll', {
                  uid: matchUid,
                  matchId
                }, matchRequestState, 10000);
                const pRes = pollResult.response;
                const pData = pollResult.data;
                if (pData.code === 0 && pData.status === 'matched' && isMatchmaking) {
                  clearInterval(matchPollInterval);
                  onMatchFound(pData);
                } else if (isMatchAuthFailure(pRes, pData)) {
                  clearInterval(matchPollInterval);
                  if (isMatchmaking) {
                    isMatchmaking = false;
                    clearInterval(matchTimerInterval);
                    hideMatchingFloatingBar();
                    showGameNotice('🔑 登录状态已失效，请重新登录后再匹配', true);
                    openAuthModal('login');
                  }
                }
              } catch(e) {
                console.warn('[match poll]', e);
              } finally {
                matchPollInFlight = false;
              }
            }, 1200);
          }
        } else {
          const error = new Error(data?.msg || '匹配服务暂时不可用');
          error.response = res;
          error.data = data;
          throw error;
        }
      } catch (err) {
        console.warn('Match join error:', err);
        if (isMatchmaking) await cancelQuickMatch();
        if (isMatchAuthFailure(err.response, err.data)) {
          showGameNotice('🔑 登录状态已失效，请重新登录后再匹配', true);
          if (typeof openAuthModal === 'function') openAuthModal('login');
        } else {
          showGameNotice(`⚠️ ${err.message || '匹配连接失败，请稍后重试'}`, true);
        }
      }
    }

    let activeMatchRoomKey = '';

    function onMatchFound(data) {
      const roomCode = String(data?.roomCode || '');
      const matchRole = String(data?.role || '').toLowerCase();
      const matchKey = `${matchRole}:${roomCode}:${data?.opponent?.uid || ''}`;
      // D1 轮询与首次 join 请求可能在同一时间返回；同一场匹配只允许启动一次房间迁移。
      if (matchKey && activeMatchRoomKey === matchKey) return;
      activeMatchRoomKey = matchKey;
      clearInterval(matchPollInterval);
      clearInterval(matchTimerInterval);
      matchPollInFlight = false;
      isMatchmaking = false;
      hideMatchingFloatingBar();

      const opp = data.opponent || { nickname: '棋圣隐士', avatar: '🐱' };
      activeOnlineOpponentUid = typeof opp.uid === 'string' ? opp.uid : '';
      const statusEl = document.getElementById('matchStatusText');
      const vsCard = document.getElementById('matchVsCard');
      if (statusEl) statusEl.textContent = '⚔️ 匹配成功！正在载入对局...';
      if (vsCard) vsCard.style.display = 'block';

      const p1N = document.getElementById('matchP1Name');
      const p1A = document.getElementById('matchP1Avatar');
      const p2N = document.getElementById('matchP2Name');
      const p2A = document.getElementById('matchP2Avatar');
      if (p1N) p1N.textContent = p1Name;
      if (p1A) p1A.innerHTML = renderAvatarElement(p1Avatar);
      if (p2N) p2N.textContent = opp.nickname;
      if (p2A) p2A.innerHTML = renderAvatarElement(opp.avatar);

      showGameNotice(`⚔️ 匹配成功！对手【${opp.nickname}】已就位！`, false);
      try { playCardAudioEffect('draw'); } catch(e) {}

      // 匹配接口同时返回 role/color；先锁定本端执子，再启动 MQTT 建连，
      // 防止客户端在 accepted 到达前沿用默认 BLACK，导致两端都显示黑子。
      if (matchRole === 'client' || data.color === 'white' || data.color === WHITE) {
        setOnlineColor(WHITE);
      } else if (matchRole === 'host' || data.color === 'black' || data.color === BLACK) {
        setOnlineColor(BLACK);
      }

      if (matchRole === "host") {
        // 我作为房主（执黑先行）：先进入“连接中”状态，再等待房间信道 ready。
        myOnlineColor = BLACK;
        p2Name = opp.nickname;
        p2Avatar = opp.avatar;
        updatePlayerHeaderUI();
        setMode("online", true);
        initHostMqttPeer(roomCode, true).then(() => {
          closeOnlineModal();
        }).catch(() => {
          showGameNotice('❌ 房间信道连接失败，请点击重试或更换网络后再匹配', true);
        });
      } else {
        // 我作为客户端（执白后行）：匹配结果一到就开始订阅，不再人为等待 1 秒。
        closeOnlineModal();
        joinOnlineRoom(roomCode);
      }
    }

    function matchWithAiOpponent() {
      if (!isMatchmaking) return;
      const queuedUid = currentActiveMatchUid;
      const queuedMatchId = currentActiveMatchId;
      isMatchmaking = false;
      clearInterval(matchPollInterval);
      clearInterval(matchTimerInterval);
      matchPollInFlight = false;
      currentActiveMatchUid = '';
      currentActiveMatchId = '';
      if (queuedUid) {
        void safeApiFetch('/api/match/cancel', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ uid: queuedUid, matchId: queuedMatchId })
        }).catch(() => {});
      }

      let aiName = "弈林少侠";
      let aiAvatar = "👦";
      try {
        aiName = getRandomDefaultNickname();
        aiAvatar = getRandomDefaultAvatar();
      } catch(e) {
        console.warn("randomize error:", e);
      }

      const statusEl = document.getElementById("matchStatusText");
      const vsCard = document.getElementById("matchVsCard");
      if (statusEl) statusEl.textContent = "⚔️ 匹配到全服棋友！正在开局...";
      if (vsCard) vsCard.style.display = "block";

      const p1N = document.getElementById("matchP1Name");
      const p1A = document.getElementById("matchP1Avatar");
      const p2N = document.getElementById("matchP2Name");
      const p2A = document.getElementById("matchP2Avatar");
      if (p1N) p1N.textContent = p1Name;
      if (p1A) p1A.innerHTML = renderAvatarElement(p1Avatar);
      if (p2N) p2N.textContent = aiName;
      if (p2A) p2A.innerHTML = renderAvatarElement(aiAvatar);

      showGameNotice("⚔️ 匹配成功！全服棋友【" + aiName + "】已就位！", false);
      try { playCardAudioEffect("draw"); } catch(e) {}

      setTimeout(() => {
        closeOnlineModal();
        p2Name = aiName;
        p2Avatar = aiAvatar;
        updatePlayerHeaderUI();
        setMode("ai", true);
        initGame();
      }, 1400);
    }

    async function cancelQuickMatch() {
      isMatchmaking = false;
      clearInterval(matchPollInterval);
      clearInterval(matchTimerInterval);
      matchPollInFlight = false;
      hideMatchingFloatingBar();

      const btnStart = document.getElementById('btnStartMatch');
      const btnCancel = document.getElementById('btnCancelMatch');
      const statusEl = document.getElementById('matchStatusText');
      const timerEl = document.getElementById('matchTimerText');
      const vsCard = document.getElementById('matchVsCard');

      const btnPlayAi = document.getElementById("btnPlayWithAi");
      if (btnPlayAi) btnPlayAi.style.display = "none";
      if (btnStart) btnStart.style.display = "block";
      if (btnCancel) btnCancel.style.display = "none";
      if (statusEl) statusEl.textContent = '⚡ 寻找全国实力相当的对手';
      if (timerEl) timerEl.textContent = '全国百万棋友实时联网对战';
      if (vsCard) vsCard.style.display = 'none';

      const cancelUid = currentActiveMatchUid || getOrCreateMatchUid();
      const cancelMatchId = currentActiveMatchId;
      currentActiveMatchUid = '';
      currentActiveMatchId = '';
      try {
        await safeApiFetch('/api/match/cancel', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ uid: cancelUid, matchId: cancelMatchId })
        });
      } catch(e) {}
      showGameNotice('已取消匹配');
    }

    function switchOnlineTab(tab) {
      const tabMatch = document.getElementById('tabMatch');
      const tabCreate = document.getElementById('tabCreateRoom');
      const tabJoin = document.getElementById('tabJoinRoom');
      const viewMatch = document.getElementById('viewMatch');
      const viewCreate = document.getElementById('viewCreateRoom');
      const viewJoin = document.getElementById('viewJoinRoom');

      if (tabMatch) tabMatch.classList.toggle('active', tab === 'match');
      if (tabCreate) tabCreate.classList.toggle('active', tab === 'create');
      if (tabJoin) tabJoin.classList.toggle('active', tab === 'join');

      if (viewMatch) viewMatch.style.display = tab === 'match' ? 'block' : 'none';
      if (viewCreate) viewCreate.style.display = tab === 'create' ? 'block' : 'none';
      if (viewJoin) viewJoin.style.display = tab === 'join' ? 'block' : 'none';

      const prevAvatar = document.getElementById('matchMyAvatarPreview');
      if (prevAvatar) prevAvatar.innerHTML = renderAvatarElement(p1Avatar);

      if (tab === 'create') {
        initPeer();
      } else if (tab !== 'match') {
        if (isMatchmaking) cancelQuickMatch();
      }
    }

    function copyRoomCode() {
      const codeEl = document.getElementById('myRoomCodeDisplay');
      const code = codeEl ? codeEl.textContent.trim() : '';
      if (!code || code === '------') {
        initPeer();
        return;
      }
      navigator.clipboard ? navigator.clipboard.writeText(code).then(() => showGameNotice(`📋 房间码【${code}】已复制！快发给好友吧~`, false)) : showGameNotice(`📋 房间码: ${code}`, false);
    }

    function openOnlineModal(tab = 'match') {
      const prevAvatar = document.getElementById('matchMyAvatarPreview');
      if (prevAvatar) prevAvatar.innerHTML = renderAvatarElement(p1Avatar);
      document.getElementById('onlineModal').classList.add('show');
      void warmApiHost(false);
      switchOnlineTab(tab);
    }
    function closeOnlineModal() {
      document.getElementById("onlineModal").classList.remove("show");
      if (isMatchmaking) {
        showMatchingFloatingBar();
        showGameNotice("⚡ 匹配已挂起在后台持续搜寻中...", false);
      }
    }

    function setMode(mode, silent = false) {
      const previousMode = gameMode;
      gameMode = mode;
      if (mode === 'online' && previousMode !== 'online') {
        resetChatHistoryForRoom();
      }
      updatePlayerHeaderUI();
      resetBoardOnly();
      if (!silent) {
        if (mode === 'pvp') showGameNotice("👥 已切换为【双人同屏】对战模式！", false);
        else if (mode === 'ai') showGameNotice("🤖 已切换为【人机对弈】模式！", false);
      }
    }


window.__GOMOKU_ONLINE_READY__ = true;
