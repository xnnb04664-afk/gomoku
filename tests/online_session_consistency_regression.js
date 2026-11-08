const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const onlinePath = process.env.GOMOKU_ONLINE_SOURCE || path.resolve('js/online.js');
const online = fs.readFileSync(onlinePath, 'utf8');
const failures = [];
const results = [];

function between(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert(from >= 0 && to > from, `Missing production source in ${onlinePath}: ${start}`);
  return source.slice(from, to);
}

function capturedTimers() {
  const timers = [];
  let nextId = 0;
  const create = (kind, fn, delay) => {
    const timer = { id: ++nextId, kind, fn, delay, cleared: false };
    timers.push(timer);
    return timer;
  };
  return {
    timers,
    setTimeout: (fn, delay = 0) => create('timeout', fn, delay),
    clearTimeout: timer => { if (timer) timer.cleared = true; },
    setInterval: (fn, delay = 0) => create('interval', fn, delay),
    clearInterval: timer => { if (timer) timer.cleared = true; },
  };
}

async function run(name, callback) {
  try {
    await callback();
    results.push({ name, pass: true });
  } catch (error) {
    failures.push({ name, error: error?.stack || String(error) });
    results.push({ name, pass: false, error: error?.message || String(error) });
  }
}

function makeSetupConnContext(overrides = {}) {
  const timers = capturedTimers();
  const calls = { reconnect: 0, persist: 0, closePool: 0, closed: 0, sent: [] };
  const elements = new Map();
  const getElementById = id => {
    if (!elements.has(id)) {
      elements.set(id, {
        id, textContent: '', innerHTML: '', disabled: false, style: {}, attributes: {},
        setAttribute(name, value) { this.attributes[name] = value; },
      });
    }
    return elements.get(id);
  };
  const context = {
    console,
    Date,
    performance: { now: () => 1234 },
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
    setInterval: timers.setInterval,
    clearInterval: timers.clearInterval,
    window: {
      publishOnlineActivityState() {},
      getRandomAiOpponentProfile: () => ({ name: 'AI', avatar: 'ai_cloud_fox' }),
    },
    document: { getElementById },
    BLACK: 1,
    WHITE: 2,
    ONLINE_HEARTBEAT_INTERVAL_MS: 2500,
    ONLINE_PEER_TIMEOUT_MS: 9000,
    gameMode: 'online',
    myOnlineColor: 1,
    currentRoomCode: '123456',
    lastActiveRoomCode: '123456',
    onlineSessionId: 'room-session',
    onlineRoundId: 'round-session',
    onlineTransportGeneration: 4,
    onlineTransportPromise: null,
    onlineTransportPromiseKey: '',
    onlineTransportRequestSeq: 0,
    isReconnecting: true,
    reconnectTimer: { id: 'reconnect' },
    reconnectHandshakeTimer: { id: 'handshake' },
    onlineHeartbeatTimer: null,
    pendingOnlinePings: new Map(),
    activeRoomJoinAttempt: null,
    onlineNetworkTelemetry: { remoteState: '在线' },
    onlineReliableOutbox: new Map(),
    p2pChannel: null,
    peer: null,
    history: [{ r: 7, c: 7, p: 1 }],
    board: [[1]],
    turn: 2,
    isOver: false,
    gameResultIsDraw: false,
    gameWinnerColor: 0,
    pendingOnlineUndoId: '',
    activeOnlineUndoId: '',
    pendingOnlineRestartId: '',
    activeOnlineRestartId: '',
    pendingOnlineRestartState: null,
    activeOnlineRestartState: null,
    activeOnlineOpponentUid: 'opponent-1',
    activeOnlineGuestUid: 'opponent-1',
    currentUserUid: 'local-user',
    p1Name: 'Local player',
    p1Avatar: 'anime_boy',
    p2Name: 'Remote player',
    p2Avatar: 'anime_girl',
    MAX_NETWORK_PROFILE_NAME_CHARS: 48,
    getOnlinePayloadByteLength: value => Buffer.byteLength(value),
    getOnlineStateDigest: () => 'deadbeef',
    getLocalOnlineNetworkState: () => 'P2P直连',
    getLocalOnlineTransportRtt: () => 8,
    getLocalOnlineTransportPath: () => 'p2p',
    generateSecureId: (length, prefix) => `${prefix || ''}generated`,
    isSafeNetworkAvatar: () => true,
    normalizeNetworkName: value => value || 'Remote player',
    markOnlinePeerSeen() {},
    recordOnlineLatencySample() {},
    updateOnlineNetworkUI() {},
    publishOnlineActivityState() {},
    updatePlayerHeaderUI() {},
    draw() {},
    updateUI() {},
    showGameNotice() {},
    showReconnectOverlay() {},
    stopReconnectHandshakeLoop() {},
    detachHostInviteListener() {},
    notifyGomokuOnlineConnection() {},
    closeMqttClientPool() { calls.closePool++; },
    clearOnlineReliableOutbox() {},
    clearPendingOnlineUndo() {},
    clearActiveOnlineUndo() {},
    closeUndoModal() {},
    closeGameResultModal() {},
    removeCurrentOnlineRoomSnapshot() {},
    persistGameState() { calls.persist++; },
    cancelQuickMatch() {},
    requestOnlineResync() {},
    getOnlineMetricsRoute: () => 'websocket',
    triggerOnlineReconnect() { calls.reconnect++; },
    setMode(mode) { context.gameMode = mode; },
    getAiColor: () => 2,
    smartAiMove() {},
    sendFullStateSnapshot() {},
    isIncomingStateDigestValid: () => true,
    validateIncomingSnapshot: () => true,
    isOnlineStateDigestValid: () => true,
    makeMove() {},
    addMessage() {},
    EMPTY: 0,
    conn: null,
    calls,
    timers,
    elements,
    ...overrides,
  };
  vm.createContext(context);
  vm.runInContext(between(online, '    function setupConn() {', '    function setRoomJoinPendingUI('), context);
  return context;
}

async function testRelayPeerDepartureDoesNotTearDownHealthySocket() {
  const timer = capturedTimers();
  let socket;
  class FakeWebSocket {
    constructor(url) {
      this.url = String(url);
      this.readyState = 0;
      this.closes = 0;
      socket = this;
      queueMicrotask(() => {
        this.readyState = 1;
        this.onopen?.({ target: this });
        this.onmessage?.({ data: JSON.stringify({ type: 'relay_ready', sessionId: 'room-session' }) });
      });
    }
    send() {}
    close() { this.closes++; this.readyState = 3; }
  }

  const context = {
    console, URL, WebSocket: FakeWebSocket, queueMicrotask,
    setTimeout: timer.setTimeout, clearTimeout: timer.clearTimeout,
    setInterval: timer.setInterval, clearInterval: timer.clearInterval,
    ONLINE_RELAY_CONNECT_TIMEOUT_MS: 3000,
    isOnlineRelayEnabled: () => true,
    isLegacyMqttFallbackEnabled: () => false,
    describeRoomRelayFailure: error => error.message,
  };
  vm.createContext(context);
  vm.runInContext(
    between(online, '    class RoomRelayClient {', '    // 旧版 MQTT 兼容池：') +
      '\nglobalThis.RoomRelayClient = RoomRelayClient;',
    context,
  );

  const client = new context.RoomRelayClient('ws://local.invalid/room', '123456', 'host', 'room-session');
  await client.readyPromise;
  const events = [];
  client.on('peer_offline', message => events.push(`peer_offline:${message.role}`));
  client.on('offline', () => events.push('offline'));
  client.on('close', () => events.push('close'));
  socket.onmessage({ data: JSON.stringify({ type: 'relay_peer_left', role: 'client' }) });

  assert.deepEqual(events, ['peer_offline:client']);
  assert.equal(client.isUsable(), true, 'a remote socket closing must not invalidate the local healthy relay');
  assert.equal(client.closed, false);
  assert.equal(socket.closes, 0);
}

async function testManualAiSwitchSendsLeaveOnP2pAndRelayBeforeClosing() {
  const timers = capturedTimers();
  const p2pMessages = [];
  const relayMessages = [];
  let sentAtClose = null;
  const sets = {
    ONLINE_MESSAGE_TYPES: new Set(['leave_room']),
    RELIABLE_ONLINE_MESSAGE_TYPES: new Set(),
    ONLINE_HEARTBEAT_TYPES: new Set(['ping', 'pong']),
    ONLINE_IMMEDIATE_MIRROR_TYPES: new Set(['leave_room']),
    MIRRORED_ONLINE_MESSAGE_TYPES: new Set(['leave_room']),
    MAX_ONLINE_PAYLOAD_BYTES: 65536,
    onlineReliableOutbox: new Map(),
  };
  const context = {
    console, Date, Buffer,
    setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout,
    setInterval: timers.setInterval, clearInterval: timers.clearInterval,
    window: {
      publishOnlineActivityState() {},
      getRandomAiOpponentProfile: () => ({ name: 'AI', avatar: 'ai_cloud_fox' }),
    },
    gameMode: 'online', myOnlineColor: 1, aiPlayerColor: 2,
    onlineHeartbeatTimer: { id: 'heartbeat' },
    reconnectTimer: { id: 'reconnect' },
    currentRoomCode: '123456', lastActiveRoomCode: '123456',
    onlineSessionId: 'room-session', onlineJoinTicket: 'join-ticket', onlineRoundId: 'round-session',
    onlineTransportGeneration: 8,
    p1Name: 'Local player', p1Avatar: 'anime_boy',
    p2Name: 'Remote player', p2Avatar: 'anime_girl',
    history: [{ r: 7, c: 7, p: 1 }], board: [[1]], turn: 2, isOver: false,
    pendingOnlineRestartId: '', activeOnlineRestartId: '',
    pendingOnlineRestartState: null, activeOnlineRestartState: null,
    generateSecureId: (length, prefix) => `${prefix || ''}generated`,
    getOnlinePayloadByteLength: value => Buffer.byteLength(value),
    closeMqttClientPool() {}, clearOnlineReliableOutbox() {},
    clearPendingOnlineUndo() {}, clearActiveOnlineUndo() {},
    removeCurrentOnlineRoomSnapshot() {},
    closeUndoModal() {}, closeGameResultModal() {},
    stopReconnectHandshakeLoop() {}, showReconnectOverlay() {},
    detachHostInviteListener() {}, notifyGomokuOnlineConnection() {},
    updatePlayerHeaderUI() {}, showGameNotice() {},
    getAiColor: () => 2, smartAiMove() {},
    conn: null,
    ...sets,
  };
  vm.createContext(context);
  const sendMethod = between(online, '      send(data, preferredTransport = \'\') {', '      on(event, fn) {');
  const transmitMethod = between(online, '      _transmitMessage(message, preferredTransport = \'\') {', '      _scheduleReliableRetry() {');
  const methods = vm.runInContext(`({${sendMethod},${transmitMethod}})`, context);
  const connection = Object.assign(Object.create(methods), {
    roomCode: '123456', sessionId: 'room-session', role: 'host',
    open: true, ready: true, closed: false, isP2pReady: true,
    dc: { readyState: 'open', send: raw => p2pMessages.push(JSON.parse(raw)) },
    client: { connected: true },
    pendingMqttFailoverTimers: new Map(),
    _publishMqttPayload(raw) { relayMessages.push(JSON.parse(raw)); return true; },
    _scheduleReliableRetry() {},
    _releaseReliableOutboxOwner() {},
    _cancelP2PRecovery() {},
    _disposeP2P() {},
    _detachMqttListeners() {},
    close(silent) {
      sentAtClose = { p2p: p2pMessages.length, relay: relayMessages.length, silent };
      this.closed = true;
      this.open = false;
      this.ready = false;
    },
  });
  context.conn = connection;
  vm.runInContext(
    between(online, '    function fallbackToAiGame() {', '    const ONLINE_HEARTBEAT_INTERVAL_MS =') +
      '\nglobalThis.fallbackToAiGame = fallbackToAiGame;',
    context,
  );

  const boardBefore = JSON.stringify(context.board);
  const historyBefore = JSON.stringify(context.history);
  context.fallbackToAiGame();

  assert.deepEqual(sentAtClose, { p2p: 1, relay: 1, silent: true }, 'leave must be dual-pathed before transport close');
  for (const leave of [p2pMessages[0], relayMessages[0]]) {
    assert.equal(leave.type, 'leave_room');
    assert.equal(leave.sessionId, 'room-session');
    assert.equal(leave.senderRole, 'host');
  }
  assert.equal(context.gameMode, 'ai');
  assert.equal(JSON.stringify(context.board), boardBefore, 'manual AI fallback must preserve the current board');
  assert.equal(JSON.stringify(context.history), historyBefore, 'manual AI fallback must preserve move history');
}

async function testReceivedLeavePausesWithoutClearingBoardOrStartingAi() {
  const context = makeSetupConnContext();
  const connection = {
    open: true, ready: true, closed: false,
    listeners: new Map(),
    client: { connected: true, publish() {} },
    on(event, handler) { this.listeners.set(event, handler); return this; },
    send() { return true; },
    close(silent) { this.closeCalls = (this.closeCalls || 0) + 1; this.closed = true; this.silent = silent; },
  };
  context.conn = connection;
  vm.runInContext('setupConn();', context);
  const boardBefore = JSON.stringify(context.board);
  const historyBefore = JSON.stringify(context.history);
  connection.listeners.get('data')({
    type: 'leave_room', sessionId: 'room-session', senderRole: 'client',
  }, 'relay');

  assert.equal(context.gameMode, 'online', 'a peer leaving must pause online state until the local player chooses an action');
  assert.equal(context.isReconnecting, false, 'an explicit leave must stop automatic reconnect');
  assert.equal(context.onlineNetworkTelemetry.remoteState, '已退出');
  assert.equal(context.conn, null);
  assert.equal(connection.closeCalls, 1);
  assert.equal(context.calls.persist, 1);
  assert.equal(context.calls.reconnect, 0);
  assert.equal(JSON.stringify(context.board), boardBefore);
  assert.equal(JSON.stringify(context.history), historyBefore);
}

async function testLeaveDuringAcceptedJoinCancelsOnlyMatchingAttemptAndAllowsAiChoice() {
  const context = makeSetupConnContext({ gameMode: 'ai', myOnlineColor: 2 });
  let restoreAiCalls = 0;
  let restoreUiCalls = 0;
  const listener = () => {};
  const clientCalls = { removed: 0, unsubscribed: 0 };
  const client = {
    removeListener(event, handler) { if (event === 'message' && handler === listener) clientCalls.removed++; },
    unsubscribe(topic) { if (topic === 'gomoku/v3/123456/h2c') clientCalls.unsubscribed++; },
  };
  const connection = {
    open: true, ready: true, closed: false,
    listeners: new Map(),
    client: { connected: true, publish() {} },
    on(event, handler) { this.listeners.set(event, handler); return this; },
    send() { return true; },
    close(silent) { this.closeCalls = (this.closeCalls || 0) + 1; this.closed = true; this.silent = silent; },
  };
  context.conn = connection;
  const attemptTimers = [
    context.setInterval(() => {}, 450),
    context.setTimeout(() => {}, 15000),
    context.setTimeout(() => {}, 15000),
    context.setInterval(() => {}, 700),
  ];
  const attempt = {
    code: '123456', transportKey: '123456|client|room-session',
    generation: context.onlineTransportGeneration,
    cancelled: false, completed: false, preserveRoomState: false,
    connection, client, listener, h2cTopic: 'gomoku/v3/123456/h2c',
    joinInterval: attemptTimers[0], joinTimeout: attemptTimers[1],
    joinConfirmTimeout: attemptTimers[2], joinReadyInterval: attemptTimers[3],
    restoreBtn() {
      restoreUiCalls++;
      if (!attempt.completed) restoreAiCalls++;
    },
  };
  context.pendingAttempt = attempt;
  vm.runInContext('activeRoomJoinAttempt = pendingAttempt;', context);
  context.setMode = mode => {
    context.gameMode = mode;
    if (mode === 'online') {
      context.board = [];
      context.history = [];
      context.turn = 1;
    }
  };
  vm.runInContext(
    between(online, '    function setRoomJoinPendingUI(', '    async function joinMqttRoom(') +
      '\nglobalThis.cancelRoomJoin = cancelRoomJoin;',
    context,
  );

  vm.runInContext('setupConn();', context);
  connection.listeners.get('data')({
    type: 'leave_room', sessionId: 'room-session', senderRole: 'host',
  }, 'relay');

  assert.equal(context.gameMode, 'online', `accepted guests must leave AI mode before the disconnect pause: ${JSON.stringify({
    generation: context.onlineTransportGeneration,
    activeAttempt: context.activeRoomJoinAttempt,
    cancelled: attempt.cancelled,
    completed: attempt.completed,
    restored: restoreUiCalls,
  })}`);
  assert.deepEqual(context.board, [], 'switching an accepted guest from AI must discard the stale AI board');
  assert.deepEqual(context.history, [], 'an unconfirmed AI history must not be persisted as an online match');
  assert.equal(context.currentRoomCode, '123456');
  assert.equal(context.onlineSessionId, 'room-session');
  assert.equal(context.onlineRoundId, 'round-session');
  assert.equal(vm.runInContext('activeRoomJoinAttempt', context), null, 'the matching admission attempt must be cleared');
  assert.equal(attempt.completed, true);
  assert.equal(attempt.cancelled, true);
  assert.equal(attempt.preserveRoomState, true);
  assert.ok(attemptTimers.every(timer => timer.cleared), 'all admission and confirmation timers must be stopped');
  assert.deepEqual(clientCalls, { removed: 1, unsubscribed: 1 });
  assert.equal(restoreUiCalls, 1);
  assert.equal(restoreAiCalls, 0, 'cancel cleanup must not resume AI on a board now owned by the room session');
  assert.equal(connection.closeCalls, 1);
  assert.equal(context.elements.get('btnConnectRoom').disabled, false, 'the join button must be enabled again');
  assert.equal(context.elements.get('btnJoinRoomCancel').textContent, '清空号码');

  vm.runInContext(
    between(online, '    function fallbackToAiGame() {', '    const ONLINE_HEARTBEAT_INTERVAL_MS =') +
      '\nglobalThis.fallbackToAiGame = fallbackToAiGame;',
    context,
  );
  context.fallbackToAiGame();
  assert.equal(context.gameMode, 'ai', 'the visible fallback action must work after the interrupted join');
  assert.deepEqual(context.history, []);
}

async function testLeaveDoesNotCancelDifferentGenerationOrRoomJoinAttempt() {
  for (const mismatch of ['generation', 'room']) {
    const context = makeSetupConnContext({ gameMode: 'ai', myOnlineColor: 2 });
    const connection = {
      open: true, ready: true, closed: false,
      listeners: new Map(),
      client: { connected: true, publish() {} },
      on(event, handler) { this.listeners.set(event, handler); return this; },
      send() { return true; },
      close(silent) { this.closeCalls = (this.closeCalls || 0) + 1; this.closed = true; this.silent = silent; },
    };
    context.conn = connection;
    const joinTimer = context.setTimeout(() => {}, 15000);
    const attempt = {
      code: mismatch === 'room' ? '654321' : '123456',
      generation: mismatch === 'generation' ? context.onlineTransportGeneration - 1 : context.onlineTransportGeneration,
      cancelled: false, completed: false, preserveRoomState: false,
      connection, joinConfirmTimeout: joinTimer,
      restoreBtn() { throw new Error('a different join attempt must not be restored by this leave'); },
    };
    context.pendingAttempt = attempt;
    vm.runInContext('activeRoomJoinAttempt = pendingAttempt;', context);
    vm.runInContext(
      between(online, '    function setRoomJoinPendingUI(', '    async function joinMqttRoom(') +
        '\nglobalThis.cancelRoomJoin = cancelRoomJoin;',
      context,
    );
    vm.runInContext('setupConn();', context);
    connection.listeners.get('data')({
      type: 'leave_room', sessionId: 'room-session', senderRole: 'host',
    }, 'relay');

    assert.equal(vm.runInContext('activeRoomJoinAttempt', context), attempt, `${mismatch}: unrelated join must remain active`);
    assert.equal(attempt.completed, false);
    assert.equal(attempt.cancelled, false);
    assert.equal(joinTimer.cleared, false, `${mismatch}: unrelated join timeout must remain active`);
  }
}

async function testInterruptedRoomExitStopsReconnectAndHidesOverlay() {
  const timers = capturedTimers();
  const calls = { stopHandshake: 0, hideOverlay: 0, leaveRoom: 0, timerCleared: 0 };
  const reconnectTimer = { id: 7 };
  const context = {
    ...timers,
    isReconnecting: true,
    reconnectTimer,
    clearTimeout(timer) { if (timer === reconnectTimer) calls.timerCleared++; },
    stopReconnectHandshakeLoop() { calls.stopHandshake++; },
    showReconnectOverlay(show) { if (!show) calls.hideOverlay++; },
    leaveOnlineRoom() { calls.leaveRoom++; },
  };
  vm.createContext(context);
  vm.runInContext(
    between(online, '    function leaveInterruptedOnlineRoom() {', '    function fallbackToAiGame() {') +
      '\nglobalThis.leaveInterruptedOnlineRoom = leaveInterruptedOnlineRoom;',
    context,
  );
  context.leaveInterruptedOnlineRoom();
  assert.equal(context.isReconnecting, false);
  assert.deepEqual(calls, { stopHandshake: 1, hideOverlay: 1, leaveRoom: 1, timerCleared: 1 });
}

async function testHealthyP2PIsNotRebuiltForHighRttOrBriefDisconnect() {
  const timers = capturedTimers();
  const context = {
    console, Date,
    setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout,
    setInterval: timers.setInterval, clearInterval: timers.clearInterval,
    P2P_RECOVERY_INITIAL_DELAY_MS: 1200,
    P2P_RECOVERY_MAX_DELAY_MS: 30000,
    ONLINE_P2P_HIGH_RTT_THRESHOLD_MS: 250,
    ONLINE_P2P_HIGH_RTT_SAMPLE_COUNT: 3,
    ONLINE_P2P_REOPTIMIZE_COOLDOWN_MS: 90000,
    ONLINE_P2P_MAX_REOPTIMIZE_ATTEMPTS: 2,
    resetOnlineLatencyTelemetryForTransport() {},
    updateOnlineNetworkUI() {},
    showGameNotice() {},
  };
  vm.createContext(context);
  const scheduleMethod = between(online, '      _scheduleP2PRecovery(reason = \'P2P 通道异常\', delayOverride = null) {', '      async _attemptIceRestart(');
  const reoptMethod = between(online, '      _maybeReoptimizeP2P(rttMs) {', '      _disposeP2P() {');
  const methods = vm.runInContext(`({${scheduleMethod},${reoptMethod}})`, context);
  const connection = Object.assign(Object.create(methods), {
    open: true, ready: true, closed: false,
    isP2pReady: true, p2pRoute: 'relay', p2pStatsRttMs: 302,
    p2pHighRttStreak: 2, p2pReoptimizationCount: 0, p2pLastReoptimizationAt: 0,
    p2pRecoveryAttempts: 0, p2pRecoveryTimer: null,
    dc: { readyState: 'open' },
    pc: { connectionState: 'connected', iceConnectionState: 'connected' },
    _attemptIceRestart() { throw new Error('healthy high RTT should not schedule ICE restart'); },
    _restartP2PProbe() { throw new Error('healthy high RTT should not rebuild P2P'); },
  });

  connection._maybeReoptimizeP2P(302);
  connection._maybeReoptimizeP2P(318);
  connection._maybeReoptimizeP2P(327);
  assert.equal(connection.isP2pReady, true);
  assert.equal(connection.p2pRoute, 'relay');
  assert.equal(connection.p2pReoptimizationCount, 0);
  assert.equal(connection.p2pRecoveryTimer, null);

  connection._scheduleP2PRecovery('PeerConnection 暂时断开', 2500);
  assert.equal(connection.isP2pReady, true, 'an open channel keeps its route during the transient-disconnect grace period');
  assert.equal(connection.p2pRoute, 'relay');
  assert.equal(connection.p2pRecoveryAttempts, 1);
  assert.equal(timers.timers.filter(timer => timer.kind === 'timeout' && !timer.cleared).length, 1);
}

async function testP2pHeartbeatLossProbesRelayBeforeRoomReconnect() {
  const context = makeSetupConnContext();
  const pings = [];
  let recoveryReason = '';
  const connection = {
    open: true, ready: true, closed: false,
    client: { connected: true, publish() {} },
    listeners: new Map(),
    on(event, handler) { this.listeners.set(event, handler); return this; },
    send(message, preferredTransport = '') {
      if (message.type === 'ping') pings.push({ message, preferredTransport });
      return true;
    },
    _scheduleP2PRecovery(reason) { recoveryReason = reason; },
    close() {},
  };
  context.conn = connection;
  context.isMqttPoolUsable = client => client === connection.client && client.connected;
  context.getLocalOnlineTransportPath = () => 'p2p';
  vm.runInContext('setupConn();', context);
  const heartbeatTimer = context.timers.timers.find(timer => timer.kind === 'interval');
  assert.ok(heartbeatTimer, 'setupConn should install its room heartbeat');

  heartbeatTimer.fn();
  heartbeatTimer.fn();
  heartbeatTimer.fn();
  assert.equal(context.calls.reconnect, 0, 'P2P-only heartbeat loss must not restart the room while relay is healthy');
  assert.equal(recoveryReason, 'DataChannel 心跳无响应');
  assert.equal(pings.length, 3);
  assert.deepEqual(pings.map(item => item.preferredTransport), ['p2p', 'p2p', 'mqtt']);

  const relayProbe = pings[2];
  connection.listeners.get('data')({
    type: 'pong', sessionId: 'room-session', senderRole: 'client', pingId: relayProbe.message.pingId,
    step: context.history.length, stateDigest: 'deadbeef', peerState: '在线',
  }, 'p2p');
  heartbeatTimer.fn();
  assert.equal(pings[3].preferredTransport, 'mqtt', 'a late P2P pong cannot satisfy the relay probe');

  connection.listeners.get('data')({
    type: 'pong', sessionId: 'room-session', senderRole: 'client', pingId: relayProbe.message.pingId,
    step: context.history.length, stateDigest: 'deadbeef', peerState: '在线',
  }, 'mqtt');
  heartbeatTimer.fn();
  assert.equal(pings[4].preferredTransport, 'p2p', 'a matching relay pong restores the normal P2P heartbeat route');
  assert.equal(context.calls.reconnect, 0);
}

function makeJoinTimeoutHarness(staleChange) {
  const timers = capturedTimers();
  const state = {
    close: 0, detach: 0, readyRetryCleared: 0, restore: 0,
    persist: 0, reconnect: 0, notices: 0, modeChanges: 0,
  };
  const context = {
    Date,
    setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout,
    setInterval: timers.setInterval, clearInterval: timers.clearInterval,
    ONLINE_JOIN_CONFIRM_TIMEOUT_MS: 15000,
    onlineTransportGeneration: 9,
    currentRoomCode: '123456',
    gameMode: 'ai',
    conn: null,
    setMode(mode) { state.modeChanges++; context.gameMode = mode; },
    persistGameState() { state.persist++; },
    triggerOnlineReconnect() { state.reconnect++; },
    showGameNotice() { state.notices++; },
    state,
    timers: timers.timers,
  };
  vm.createContext(context);
  const timeoutBlock = between(online, 'joinConfirmTimeout = setTimeout(() => {', '}, ONLINE_JOIN_CONFIRM_TIMEOUT_MS);') +
    '}, ONLINE_JOIN_CONFIRM_TIMEOUT_MS);';
  vm.runInContext(`
    (() => {
      const code = '123456';
      const nextConn = { open: true, ready: true, close() { state.close++; } };
      let hasJoined = false;
      let joinCancelled = false;
      let joiningConnection = nextConn;
      let joinReadyInterval = { id: 'ready-retry' };
      let joinConfirmTimeout = null;
      const transportGeneration = 9;
      const attempt = { cancelled: false, completed: false };
      const restoreBtn = () => { state.restore++; };
      const clearJoinReadyRetry = () => { state.readyRetryCleared++; joinReadyInterval = null; };
      const detachJoinSignals = () => { state.detach++; };
      ${timeoutBlock}
      globalThis.fireJoinTimeout = () => {
        const timer = timers.find(item => item.kind === 'timeout' && item.delay === ONLINE_JOIN_CONFIRM_TIMEOUT_MS);
        if (!timer) throw new Error('join-confirm timeout was not scheduled');
        timer.fn();
      };
      globalThis.setJoinTimeoutState = change => {
        if (change === 'generation') onlineTransportGeneration++;
        if (change === 'room') currentRoomCode = '654321';
        if (change === 'current_connection') conn = { open: true, ready: true };
        if (change === 'cancelled') attempt.cancelled = true;
      };
      globalThis.timeoutState = () => ({
        ...state,
        gameMode,
        joinCancelled,
        attemptCompleted: attempt.completed,
        connectionIsCurrent: conn === nextConn,
      });
      conn = nextConn;
    })();
  `, context);
  if (staleChange) context.setJoinTimeoutState(staleChange);
  return { context, state };
}

async function testJoinConfirmTimeoutIsFencedAfterRoomChanges() {
  for (const staleChange of ['generation', 'room', 'current_connection', 'cancelled']) {
    const { context } = makeJoinTimeoutHarness(staleChange);
    context.fireJoinTimeout();
    const state = context.timeoutState();
    assert.equal(state.close, 0, `${staleChange}: stale timeout must not close a newer connection`);
    assert.equal(state.detach, 0, `${staleChange}: stale timeout must not detach current join signals`);
    assert.equal(state.readyRetryCleared, 0, `${staleChange}: stale timeout must not clear a new retry loop`);
    assert.equal(state.restore, 0, `${staleChange}: stale timeout must not restore old join UI`);
    assert.equal(state.persist, 0, `${staleChange}: stale timeout must not persist as an active game`);
    assert.equal(state.reconnect, 0, `${staleChange}: stale timeout must not start reconnect`);
    assert.equal(state.modeChanges, 0, `${staleChange}: stale timeout must not flip AI to online`);
  }
}

async function testCurrentJoinConfirmTimeoutStillRecoversAmbiguousAcceptance() {
  const { context } = makeJoinTimeoutHarness('');
  context.fireJoinTimeout();
  const state = context.timeoutState();
  assert.equal(state.gameMode, 'online', 'a current ambiguous join should preserve the accepted room session');
  assert.equal(state.persist, 1);
  assert.equal(state.reconnect, 1);
  assert.equal(state.attemptCompleted, true);
  assert.equal(state.close, 0);
}

async function main() {
  await run('nonintentional relay peer departure preserves healthy local socket', testRelayPeerDepartureDoesNotTearDownHealthySocket);
  await run('manual AI fallback sends leave on P2P and relay before close and preserves board', testManualAiSwitchSendsLeaveOnP2pAndRelayBeforeClosing);
  await run('received leave pauses without clearing board or starting AI', testReceivedLeavePausesWithoutClearingBoardOrStartingAi);
  await run('leave during accepted join cancels only matching attempt and allows AI choice', testLeaveDuringAcceptedJoinCancelsOnlyMatchingAttemptAndAllowsAiChoice);
  await run('leave does not cancel a different-generation or different-room join', testLeaveDoesNotCancelDifferentGenerationOrRoomJoinAttempt);
  await run('interrupted-room exit stops reconnect timers and hides overlay', testInterruptedRoomExitStopsReconnectAndHidesOverlay);
  await run('healthy P2P survives high RTT and brief disconnect grace period', testHealthyP2PIsNotRebuiltForHighRttOrBriefDisconnect);
  await run('P2P heartbeat loss probes relay before room reconnect', testP2pHeartbeatLossProbesRelayBeforeRoomReconnect);
  await run('join-confirm timeout is fenced from stale generations, rooms, connections, and cancellations', testJoinConfirmTimeoutIsFencedAfterRoomChanges);
  await run('current ambiguous join-confirm timeout still recovers accepted room', testCurrentJoinConfirmTimeoutStillRecoversAmbiguousAcceptance);

  console.log(JSON.stringify({ source: onlinePath, results, failures }, null, 2));
  if (failures.length) process.exitCode = 1;
}

main().catch(error => { console.error(error); process.exitCode = 1; });
