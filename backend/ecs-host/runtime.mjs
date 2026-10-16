const NativeResponse = globalThis.Response;
const responseStatus = Symbol('workerStatus');
const responseWebSocket = Symbol('workerWebSocket');
const MAX_PENDING_NETWORK_FRAMES = 32;

/** Adapt Cloudflare's 101 + webSocket Response extension to Node's Fetch API. */
export function installWorkerResponseCompatibility() {
  if (globalThis.Response?.__gomokuWorkerResponse) return;
  const BaseResponse = globalThis.Response;

  class WorkerCompatibleResponse extends BaseResponse {
    constructor(body = null, init = {}) {
      const source = init && typeof init === 'object' ? { ...init } : {};
      const socket = source.webSocket || null;
      const status = Number(source.status ?? 200);
      delete source.webSocket;
      if (status === 101) source.status = 200;
      super(body, source);
      Object.defineProperty(this, responseStatus, { value: status });
      Object.defineProperty(this, responseWebSocket, { value: socket });
    }

    get status() {
      return this[responseStatus] ?? super.status;
    }

    get webSocket() {
      return this[responseWebSocket] || null;
    }
  }

  Object.defineProperty(WorkerCompatibleResponse, '__gomokuWorkerResponse', { value: true });
  globalThis.Response = WorkerCompatibleResponse;
}

function eventFor(type, fields = {}) {
  return { type, target: null, currentTarget: null, ...fields };
}

/** A minimal Worker-side WebSocket endpoint paired with the Node `ws` socket. */
export class WorkerWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  constructor() {
    this._listeners = new Map();
    this._peer = null;
    this._network = null;
    this._pendingNetworkFrames = [];
    this._networkFacing = false;
    this._readyState = WorkerWebSocket.OPEN;
    this._accepted = false;
    this._attachment = null;
    this._tags = [];
    this.onopen = null;
    this.onmessage = null;
    this.onclose = null;
    this.onerror = null;
  }

  get readyState() {
    return this._readyState;
  }

  accept() {
    this._accepted = true;
  }

  addEventListener(type, listener) {
    if (typeof listener !== 'function' && typeof listener?.handleEvent !== 'function') return;
    let listeners = this._listeners.get(type);
    if (!listeners) this._listeners.set(type, listeners = new Set());
    listeners.add(listener);
  }

  removeEventListener(type, listener) {
    this._listeners.get(type)?.delete(listener);
  }

  _dispatch(type, fields = {}) {
    const event = eventFor(type, fields);
    event.target = this;
    event.currentTarget = this;
    const handler = this[`on${type}`];
    if (typeof handler === 'function') {
      try { handler.call(this, event); } catch (_) {}
    }
    for (const listener of Array.from(this._listeners.get(type) || [])) {
      try {
        if (typeof listener === 'function') listener.call(this, event);
        else listener.handleEvent(event);
      } catch (_) {}
    }
  }

  _dispatchMessage(data) {
    if (this._readyState === WorkerWebSocket.CLOSED) return;
    this._dispatch('message', { data });
  }

  send(data) {
    if (this._readyState !== WorkerWebSocket.OPEN) throw new Error('WebSocket is not open');
    const peer = this._peer;
    if (!peer || peer._readyState === WorkerWebSocket.CLOSED) throw new Error('WebSocket peer is closed');

    // The returned pair[0] endpoint is the network-facing side. Worker code
    // sends on pair[1], which reaches the attached Node ws connection here.
    if (peer._networkFacing) {
      if (!peer._network) {
        if (peer._pendingNetworkFrames.length >= MAX_PENDING_NETWORK_FRAMES) {
          throw new Error('Pending WebSocket upgrade queue is full');
        }
        const binary = typeof data !== 'string';
        const frame = Buffer.isBuffer(data)
          ? data
          : data instanceof ArrayBuffer
            ? Buffer.from(data)
            : ArrayBuffer.isView(data)
              ? Buffer.from(data.buffer, data.byteOffset, data.byteLength)
              : String(data);
        peer._pendingNetworkFrames.push({ data: frame, binary });
        return;
      }
      if (peer._network.readyState !== 1) throw new Error('Network WebSocket is not open');
      const binary = typeof data !== 'string';
      const frame = Buffer.isBuffer(data)
        ? data
        : data instanceof ArrayBuffer
          ? Buffer.from(data)
          : ArrayBuffer.isView(data)
            ? Buffer.from(data.buffer, data.byteOffset, data.byteLength)
            : String(data);
      peer._network.send(frame, { binary });
      return;
    }

    peer._dispatchMessage(data);
  }

  close(code = 1000, reason = '') {
    if (this._readyState >= WorkerWebSocket.CLOSING) return;
    this._readyState = WorkerWebSocket.CLOSING;
    const peer = this._peer;
    if (peer?._network && peer._network.readyState === 1) {
      try { peer._network.close(code, String(reason)); } catch (_) {}
    }
    this._finish(code, String(reason), false);
  }

  serializeAttachment(value) {
    this._attachment = value;
  }

  deserializeAttachment() {
    return this._attachment;
  }

  _attachNetwork(networkSocket) {
    this._network = networkSocket;
    for (const frame of this._pendingNetworkFrames.splice(0)) {
      try { networkSocket.send(frame.data, { binary: frame.binary }); } catch (_) {}
    }
  }

  _receiveNetwork(data, isBinary) {
    if (this._readyState === WorkerWebSocket.CLOSED) return;
    const value = isBinary ? Buffer.from(data) : Buffer.from(data).toString('utf8');
    this._peer?._dispatchMessage(value);
  }

  _finish(code = 1000, reason = '', wasClean = false) {
    if (this._readyState === WorkerWebSocket.CLOSED) return;
    this._readyState = WorkerWebSocket.CLOSED;
    this._dispatch('close', { code: Number(code) || 1000, reason: String(reason || ''), wasClean: Boolean(wasClean) });
    if (this._peer && this._peer._readyState !== WorkerWebSocket.CLOSED) {
      this._peer._readyState = WorkerWebSocket.CLOSED;
      this._peer._dispatch('close', { code: Number(code) || 1000, reason: String(reason || ''), wasClean: Boolean(wasClean) });
    }
  }
}

export class WebSocketPair {
  constructor() {
    const client = new WorkerWebSocket();
    const server = new WorkerWebSocket();
    client._peer = server;
    server._peer = client;
    client._networkFacing = true;
    this[0] = client;
    this[1] = server;
    Object.freeze(this);
  }
}

export class MemoryDurableObjectState {
  constructor(onBackgroundError = () => {}) {
    this.sockets = new Set();
    this.tags = new WeakMap();
    this.backgroundTasks = new Set();
    this.onBackgroundError = onBackgroundError;
  }

  acceptWebSocket(socket, tags = []) {
    socket.accept();
    this.trackSocket(socket, tags);
    const dispatch = (method, ...args) => {
      const instance = this.instance;
      if (typeof instance?.[method] !== 'function') return;
      try {
        const result = instance[method](socket, ...args);
        if (result && typeof result.then === 'function') this.waitUntil(result);
      } catch (error) {
        this.onBackgroundError(error);
      }
    };
    socket.addEventListener('message', event => dispatch('webSocketMessage', event.data));
    socket.addEventListener('close', event => {
      this.sockets.delete(socket);
      dispatch('webSocketClose', event.code, event.reason);
    });
    socket.addEventListener('error', event => dispatch('webSocketError', event));
  }

  trackSocket(socket, tags = []) {
    if (!socket || this.sockets.has(socket)) return;
    this.sockets.add(socket);
    this.tags.set(socket, Array.isArray(tags) ? tags.slice() : []);
    socket.addEventListener('close', () => this.sockets.delete(socket));
  }

  getWebSockets() {
    return Array.from(this.sockets).filter(socket => socket.readyState !== WorkerWebSocket.CLOSED);
  }

  getTags(socket) {
    return this.tags.get(socket) || [];
  }

  waitUntil(promise) {
    const task = Promise.resolve(promise);
    this.backgroundTasks.add(task);
    task.catch(error => this.onBackgroundError(error)).finally(() => this.backgroundTasks.delete(task));
  }
}

export class MemoryDurableObjectNamespace {
  constructor(DurableObjectClass, env, { onBackgroundError } = {}) {
    this.DurableObjectClass = DurableObjectClass;
    this.env = env;
    this.onBackgroundError = onBackgroundError || (() => {});
    this.instances = new Map();
    this.idleTimeoutMs = 30 * 60 * 1000;
  }

  idFromName(name) {
    return String(name);
  }

  get(id) {
    const key = String(id);
    return { fetch: (request, init) => this._fetch(key, request, init) };
  }

  async _fetch(key, input, init) {
    const now = Date.now();
    for (const [instanceKey, record] of this.instances) {
      if (now - record.lastUsedAt > this.idleTimeoutMs && record.state.getWebSockets().length === 0) {
        this.instances.delete(instanceKey);
      }
    }

    let record = this.instances.get(key);
    if (!record) {
      const state = new MemoryDurableObjectState(this.onBackgroundError);
      const instance = new this.DurableObjectClass(state, this.env);
      state.instance = instance;
      record = { instance, state, lastUsedAt: now };
      this.instances.set(key, record);
    }
    record.lastUsedAt = now;

    const request = input instanceof Request ? input : new Request(input, init);
    const response = await record.instance.fetch(request);
    const returnedSocket = response?.webSocket;
    if (returnedSocket?._peer) record.state.trackSocket(returnedSocket._peer, returnedSocket._peer._tags || []);
    record.lastUsedAt = Date.now();
    return response;
  }
}

export { NativeResponse };
