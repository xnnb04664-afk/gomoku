const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('js/online.js', 'utf8');
function between(start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert(from >= 0 && to > from, `Missing production source: ${start}`);
  return source.slice(from, to);
}

async function main() {
  const sockets = [];
  let autoOpen = true;
  class BlackholeSocket {
    constructor(url) {
      this.url = url;
      this.readyState = 0;
      this.closes = 0;
      sockets.push(this);
      if (autoOpen) queueMicrotask(() => {
        this.readyState = 1;
        this.onopen();
      });
    }
    send() { /* Packets vanish while readyState remains OPEN. */ }
    close() {
      this.closes++;
      this.readyState = 3;
      // Deliberately omit onclose, as a half-open mobile socket may do.
    }
  }
  const context = {
    console, URL, WebSocket: BlackholeSocket, setTimeout, clearTimeout,
    ONLINE_RELAY_CONNECT_TIMEOUT_MS: 3000,
    mqttClient: null, mqttClientPromise: null, mqttClientPromiseRoomKey: '', mqttClientRequestSeq: 0,
    onlineTransportPromise: null, onlineTransportPromiseKey: '', onlineTransportRequestSeq: 0,
    isOnlineRelayEnabled: () => true, isLegacyMqttFallbackEnabled: () => false,
    describeRoomRelayFailure: error => error.message,
  };
  vm.createContext(context);
  vm.runInContext(between('    class RoomRelayClient {', '    // 旧版 MQTT 兼容池：') + '\nglobalThis.RoomRelayClient = RoomRelayClient;', context);
  vm.runInContext(between('    function watchMqttClientLifecycle(', '    function getOrCreateMqttClient('), context);
  vm.runInContext(between('    function getOrCreateOnlineTransport(', '    const P2P_SIGNAL_RETRY_MS'), context);
  context.connectRoomRelay = async (room, role, session) => {
    const client = new context.RoomRelayClient('ws://local.invalid/room', room, role, session);
    await client.readyPromise;
    return client;
  };

  const first = await context.getOrCreateOnlineTransport('123456', 'host', 'retained-session');
  assert.equal(first.isUsable(), true);
  assert.equal(first.publish('test', 'silently dropped'), true);
  const events = [];
  first.on('offline', () => { assert.equal(first.isUsable(), false); events.push('offline'); });
  first.on('close', () => events.push('close'));
  first.invalidate('WiFi to cellular');
  first.invalidate('duplicate network event');
  first.ws.onclose();
  assert.deepEqual(events, ['offline', 'close']);
  assert.equal(first.closed, true);
  assert.equal(first.connected, false);
  assert.equal(first.ws.closes, 1);
  assert.equal(context.mqttClient, null, 'production lifecycle must release the invalidated pool');

  const second = await context.getOrCreateOnlineTransport('123456', 'host', 'retained-session');
  assert.notEqual(second, first);
  assert.equal(sockets.length, 2, 'half-open recovery must create a fresh WebSocket');
  const nextUrl = new URL(second.ws.url);
  assert.equal(nextUrl.searchParams.get('room'), '123456');
  assert.equal(nextUrl.searchParams.get('session'), 'retained-session');
  const intentionalEvents = [];
  second.on('offline', () => intentionalEvents.push('offline'));
  second.on('close', () => intentionalEvents.push('close'));
  second.end(true);
  second.ws.onclose();
  second.invalidate('late event after intentional shutdown');
  assert.deepEqual(intentionalEvents, [], 'intentional end must not trigger reconnect events');

  autoOpen = false;
  const pending = new context.RoomRelayClient('ws://local.invalid/room', '123456', 'host', 'retained-session');
  const rejection = pending.readyPromise.then(() => { throw new Error('invalidated initial connection unexpectedly resolved'); }, error => error);
  pending.invalidate('initial connection replaced');
  assert.match((await rejection).message, /initial connection replaced/);
  assert.equal(pending.connectTimer, null);
  assert.equal(pending.ws.closes, 1);
  console.log('PASS: half-open relay invalidates once, creates a new socket with retained identity, rejects pending readiness, and keeps intentional end silent');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
