const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const online = fs.readFileSync('js/online.js', 'utf8');
const app = fs.readFileSync('js/app.js', 'utf8');
function between(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert(from >= 0 && to > from, `Missing production source: ${start}`);
  return source.slice(from, to);
}

async function main() {
  const messages = [];
  const button = {};
  let transportCalls = 0;
  const noop = () => {};
  const context = {
    console, performance, Date, setTimeout, clearTimeout, clearInterval,
    window: {}, document: { getElementById: () => button },
    BLACK: 1, WHITE: 2, gameMode: 'online', myOnlineColor: 1,
    isOver: true, gameWinnerColor: 1, gameResultIsDraw: false,
    board: [[1, 1, 1, 1, 1]], history: [{ r: 0, c: 4, p: 1 }],
    onlineRoundId: 'finished-round', currentRoomCode: '123456',
    lastActiveRoomCode: '123456', onlineSessionId: 'same-session',
    onlineTransportGeneration: 1,
    isReconnecting: false, reconnectTimer: null, reconnectAttempts: 0,
    reconnectMetricStartedAt: 0, reconnectMetricFinished: false,
    onlineHeartbeatTimer: null, mqttClient: null, conn: null,
    MAX_RECONNECT_ATTEMPTS: 10,
    pendingOnlineRestartId: '', activeOnlineRestartId: '',
    pendingOnlineRestartState: null, activeOnlineRestartState: null,
    p1Name: 'Test player', generateSecureId: (length, prefix) => `${prefix}test`,
    showGameNotice: noop, showReconnectOverlay: noop,
    stopReconnectHandshakeLoop: noop, setupConn: noop,
    sendFullStateSnapshot: noop, persistGameState: noop, playPopSound: noop,
    isMqttPoolUsable: () => true,
    getOrCreateOnlineTransport: async () => { transportCalls++; return {}; },
    initHostMqttPeer: async (room, forceNew) => {
      assert.equal(room, '123456');
      assert.equal(forceNew, true);
      context.conn = { open: true, ready: true, send: message => { messages.push(message); return true; } };
      context.onReconnectSuccess();
      return true;
    },
  };
  vm.createContext(context);
  vm.runInContext(between(online, '    function triggerOnlineReconnect(', '    function scheduleNextReconnect('), context);
  vm.runInContext(between(online, '    function onReconnectSuccess(', '    function sendFullStateSnapshot('), context);
  vm.runInContext(between(online, '    function sendPendingOnlineRestartTransaction(', '    function handleOnlineRestartRequest('), context);

  const finishedState = JSON.stringify([context.board, context.history, context.isOver, context.gameWinnerColor, context.gameResultIsDraw, context.onlineRoundId]);
  context.triggerOnlineReconnect('finished-game socket closed');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(transportCalls, 1, 'finished games must rebuild the room transport');
  assert.equal(context.isReconnecting, false);
  assert.equal(context.conn.ready, true);
  assert.equal(JSON.stringify([context.board, context.history, context.isOver, context.gameWinnerColor, context.gameResultIsDraw, context.onlineRoundId]), finishedState, 'reconnection must preserve the finished game');

  vm.runInContext(between(app, "    document.getElementById('btnRestart').onclick =", "      } else if (gameMode === 'ai')") + '\n      }\n    };', context);
  for (const active of [
    { activeOnlineRestartId: 'existing-request', activeOnlineRestartState: null },
    { activeOnlineRestartId: '', activeOnlineRestartState: { side: 'responder', phase: 'awaiting_commit' } },
  ]) {
    Object.assign(context, active);
    button.onclick();
    assert.equal(context.pendingOnlineRestartState, null, 'a responder must not create a second transaction');
    assert.equal(messages.length, 0, 'an active responder transaction must block new requests');
  }
  context.activeOnlineRestartId = '';
  context.activeOnlineRestartState = null;
  button.onclick();
  assert.equal(messages.at(-1).type, 'restart_req', 'the restored finished room must allow next-round negotiation');
  assert.equal(context.pendingOnlineRestartState.oldRoundId, 'finished-round');
  assert.equal(context.isOver, true, 'requesting a rematch must retain the result until agreement');
  const sentCount = messages.length;
  button.onclick();
  assert.equal(messages.length, sentCount, 'a pending request must block another request');

  // Exercise the production leave path: silent close, clearing room state, and
  // switching modes must prevent a later stale close callback from reconnecting.
  const silentCloses = [];
  context.conn.close = silent => silentCloses.push(silent);
  Object.assign(context, {
    p2pChannel: null, peer: null, onlineJoinTicket: 'ticket', onlineTransportGeneration: 1,
    pendingOnlinePings: new Map(), onlineNetworkTelemetry: {},
    detachHostInviteListener: noop, closeMqttClientPool: noop, clearOnlineReliableOutbox: noop,
    clearPendingOnlineUndo: noop, clearActiveOnlineUndo: noop,
    removeCurrentOnlineRoomSnapshot: noop, cancelQuickMatch: noop,
    hideMatchingFloatingBar: noop, resetBoardOnly: noop,
    updatePlayerHeaderUI: noop, closeOnlineModal: noop,
    setMode: mode => { context.gameMode = mode; },
  });
  vm.runInContext(between(app, '    function leaveOnlineRoom(', '    // 👤 退出当前账号功能'), context);
  context.leaveOnlineRoom(false);
  assert.deepEqual(silentCloses, [true]);
  assert.equal(context.gameMode, 'ai');
  assert.equal(context.currentRoomCode, null);
  context.triggerOnlineReconnect('late close after leaving');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(transportCalls, 1, 'leaving the room must prevent reconnect');

  let resolveTransport;
  context.getOrCreateOnlineTransport = () => {
    transportCalls++;
    return new Promise(resolve => { resolveTransport = resolve; });
  };
  context.gameMode = 'online';
  context.currentRoomCode = '123456';
  context.onlineSessionId = 'same-session';
  context.isOver = true;
  context.triggerOnlineReconnect('disconnect before transport resolves');
  assert.equal(transportCalls, 2);
  context.leaveOnlineRoom(false);
  resolveTransport({});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(context.gameMode, 'ai');
  assert.equal(context.conn, null, 'an in-flight transport must not recreate the room after leaving');

  context.gameMode = 'online';
  context.currentRoomCode = '123456';
  context.onlineSessionId = 'same-session';
  context.isReconnecting = false;
  context.triggerOnlineReconnect('old attempt before leaving and rejoining same room');
  assert.equal(transportCalls, 3);
  context.leaveOnlineRoom(false);
  context.gameMode = 'online';
  context.currentRoomCode = '123456';
  resolveTransport({});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(context.conn, null, 'a previous generation must not take over a rejoined room with the same code');

  // Losing the transport ACK for commit_ack must remain recoverable after the
  // initiator changes rounds: a duplicate is ACKed again before business dedup.
  Object.assign(context, {
    MAX_ONLINE_PAYLOAD_BYTES: 65536,
    ONLINE_MESSAGE_TYPES: new Set(['restart_commit_ack', 'delivery_ack']),
    RELIABLE_ONLINE_MESSAGE_TYPES: new Set(['restart_commit_ack']),
    getOnlinePayloadByteLength: value => Buffer.byteLength(value),
    P2P_SIGNAL_TYPES: new Set(),
  });
  const incomingMethod = between(online, '      _handleIncomingPayload(', '      _republishP2PSignals(');
  const receiver = vm.runInContext('({' + incomingMethod + '})', context);
  let received = 0;
  const ackMessages = [];
  Object.assign(receiver, {
    sessionId: 'same-session', role: 'client', processedMsgIds: new Set(),
    _consumeInboundBudget: () => true,
    send: message => ackMessages.push(message),
    emit: () => { received++; context.onlineRoundId = 'new-round'; },
  });
  const commitAck = JSON.stringify({ type: 'restart_commit_ack', sessionId: 'same-session', senderRole: 'host', _mid: 'commit-ack-id', roundId: 'finished-round' });
  receiver._handleIncomingPayload(commitAck);
  receiver._handleIncomingPayload(commitAck);
  assert.equal(received, 1, 'commit ACK retransmission must not reset twice');
  assert.equal(ackMessages.length, 2, 'a lost ACK must be regenerated after the initiator changes round');
  assert.equal(ackMessages[1].ackId, 'commit-ack-id');
  console.log('PASS: finished room reconnects, preserves result, allows rematch, and stays closed after leaving');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
