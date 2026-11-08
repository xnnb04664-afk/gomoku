const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const sourcePath = process.env.GOMOKU_VOICE_SOURCE || path.resolve('js/voice.js');
const source = fs.readFileSync(sourcePath, 'utf8');
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
function fixture(role = 'host', options = {}) {
  const nodes = new Map(), peers = [], tracks = [], sent = [];
  let mediaCalls = 0, listener;
  const connection = { open: true, ready: true, closed: false, send: data => { sent.push(data); return true; } };
  function stream() {
    const track = { stopped: 0, enabled: true, stop() { this.stopped++; } };
    tracks.push(track);
    return { getTracks: () => [track], getAudioTracks: () => [track] };
  }
  class Peer {
    constructor() { this.signalingState = 'stable'; this.connectionState = 'new'; this.closed = false; this.remote = []; this.local = []; peers.push(this); }
    addTrack() {}
    createOffer() { return options.offer?.promise || Promise.resolve({ type: 'offer', sdp: 'offer' }); }
    createAnswer() { return Promise.resolve({ type: 'answer', sdp: 'answer' }); }
    setLocalDescription(data) { this.local.push(data); this.localDescription = data; this.signalingState = data.type === 'offer' ? 'have-local-offer' : 'stable'; return Promise.resolve(); }
    setRemoteDescription(data) { this.remote.push(data); this.signalingState = data.type === 'offer' ? 'have-remote-offer' : 'stable'; return Promise.resolve(); }
    addIceCandidate() { return Promise.resolve(); }
    close() { this.closed = true; this.signalingState = 'closed'; }
  }
  const context = {
    console, Date, Math, Uint8Array, gameMode: 'online', myOnlineColor: role === 'host' ? 1 : 2,
    RTCPeerConnection: Peer, MediaStream: class {},
    navigator: { mediaDevices: { getUserMedia: () => { mediaCalls++; return options.media?.promise || Promise.resolve(stream()); } } },
    document: { getElementById(id) {
      if (!nodes.has(id)) nodes.set(id, { style: {}, setAttribute() {}, pause() {}, play: () => Promise.resolve() });
      return nodes.get(id);
    } },
    window: {
      __gomokuGetOnlineConnection: () => connection,
      __gomokuGetWebRtcIceServers: () => options.ice?.promise || Promise.resolve([{ urls: 'stun:local.test' }]),
      __gomokuRegisterOnlineConnectionListener: callback => { listener = callback; return () => {}; },
      addEventListener() {},
    },
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  return { api: context.window.GomokuVoice, context, connection, sent, peers, tracks, stream,
    mediaCalls: () => mediaCalls, closeConnection: () => listener('close', connection), nodes };
}
const flush = async () => { for (let index = 0; index < 12; index++) await Promise.resolve(); };
const results = [];
async function run(name, test) {
  try { const evidence = await test(); results.push({ name, pass: true, ...evidence }); }
  catch (error) { results.push({ name, pass: false, error: error.message }); }
}

async function main() {
  await run('hello exchange is bounded rather than an echo loop', async () => {
    const host = fixture('host'), guest = fixture('client');
    await host.api.toggle(); await guest.api.toggle();
    let hostIndex = 0, guestIndex = 0, deliveries = 0;
    for (; deliveries < 40; deliveries++) {
      const hostHello = host.sent.slice(hostIndex).find(message => message.type === 'voice_hello');
      hostIndex = host.sent.length;
      const guestHello = guest.sent.slice(guestIndex).find(message => message.type === 'voice_hello');
      guestIndex = guest.sent.length;
      if (!hostHello && !guestHello) break;
      if (hostHello) await guest.api.handleSignal(hostHello);
      if (guestHello) await host.api.handleSignal(guestHello);
    }
    const helloCount = [...host.sent, ...guest.sent].filter(message => message.type === 'voice_hello').length;
    host.api.stop(); guest.api.stop();
    assert(deliveries < 40, `hello exchange did not settle after ${deliveries} rounds (${helloCount} hellos)`);
    assert(helloCount <= 6, `excessive hello work: ${helloCount}`);
    return { deliveries, helloCount };
  });
  await run('client accepts the authoritative host voice session after enabling first', async () => {
    const guest = fixture('client');
    await guest.api.toggle();
    await guest.api.handleSignal({ type: 'voice_hello', role: 'host', voiceSessionId: 'host-session' });
    await guest.api.handleSignal({ type: 'voice_offer', role: 'host', voiceSessionId: 'host-session', sdp: 'host-offer' });
    const applied = guest.peers.reduce((sum, peer) => sum + peer.remote.length, 0);
    guest.api.stop();
    assert.equal(applied, 1, 'the host offer was discarded because the client invented a different session');
  });
  await run('late microphone permission cannot resurrect voice after room close', async () => {
    const media = deferred(), f = fixture('host', { media });
    const enabling = f.api.toggle();
    f.closeConnection();
    media.resolve(f.stream());
    const enabled = await enabling;
    assert.equal(enabled, false);
    assert.equal(f.api.isEnabled(), false);
    assert.equal(f.tracks[0].stopped, 1);
    assert.equal(f.peers.length, 0);
    assert.equal(f.sent.length, 0);
  });
  await run('pending enable is canceled by a second toggle without a second permission request', async () => {
    const media = deferred(), f = fixture('host', { media });
    const first = f.api.toggle(), second = f.api.toggle();
    media.resolve(f.stream());
    await Promise.all([first, second]);
    const calls = f.mediaCalls();
    f.api.stop();
    assert.equal(calls, 1);
    assert.equal(f.api.isEnabled(), false);
  });
  await run('late ICE configuration cannot create a peer after stop', async () => {
    const ice = deferred(), f = fixture('host', { ice });
    const enabling = f.api.toggle();
    await flush();
    f.api.stop();
    ice.resolve([{ urls: 'stun:local.test' }]);
    assert.equal(await enabling, false);
    assert.equal(f.peers.length, 0);
    assert.equal(f.sent.filter(message => message.type !== 'voice_bye').length, 0);
    assert.equal(f.tracks[0].stopped, 1);
  });
  await run('late offer cannot send stale signaling after stop', async () => {
    const offer = deferred(), f = fixture('host', { offer });
    const enabling = f.api.toggle();
    await flush();
    f.api.stop();
    const count = f.sent.length;
    offer.resolve({ type: 'offer', sdp: 'stale-offer' });
    await enabling;
    assert.equal(f.sent.length, count);
    assert.equal(f.peers[0].local.length, 0);
    assert.equal(f.api.isEnabled(), false);
  });
  await run('concurrent hello and enable share one peer configuration request', async () => {
    const ice = deferred(), f = fixture('host', { ice });
    const enabling = f.api.toggle();
    await flush();
    const hello = f.api.handleSignal({ type: 'voice_hello', role: 'client', voiceSessionId: 'guest-request' });
    ice.resolve([{ urls: 'stun:local.test' }]);
    await Promise.all([enabling, hello]);
    const peerCount = f.peers.length;
    f.api.stop();
    assert.equal(peerCount, 1);
  });
  await run('explicit microphone policy denial is explained before requesting permission', async () => {
    const f = fixture('host');
    f.context.document.permissionsPolicy = { allowsFeature: feature => feature !== 'microphone' };
    assert.equal(await f.api.toggle(), false);
    assert.equal(f.mediaCalls(), 0);
    assert(f.nodes.get('gomokuVoiceStatus').textContent.includes('当前运行环境未开放麦克风'));
  });
  for (const pendingPermission of [false, true]) {
    await run(`production leaveOnlineRoom stops ${pendingPermission ? 'pending' : 'active'} microphone`, async () => {
      const media = pendingPermission ? deferred() : null;
      const f = fixture('host', { media });
      const enabling = f.api.toggle();
      if (!pendingPermission) await enabling;
      let stoppedAtConnectionClose = false;
      f.connection.close = () => {
        stoppedAtConnectionClose = !f.api.isEnabled() && f.tracks.every(track => track.stopped > 0);
        f.connection.open = false; f.connection.closed = true;
      };
      const noop = () => {};
      Object.assign(f.context, {
        conn: f.connection, currentRoomCode: '123456', lastActiveRoomCode: '123456',
        onlineSessionId: 'room', onlineJoinTicket: 'ticket', onlineRoundId: 'round',
        onlineTransportGeneration: 1, p1Name: 'Local', p2pChannel: null, peer: null,
        onlineHeartbeatTimer: null, pendingOnlinePings: new Map(), onlineNetworkTelemetry: {},
        stopReconnectHandshakeLoop: noop, detachHostInviteListener: noop,
        notifyGomokuOnlineConnection: (event, connection) => {
          assert.equal(event, 'close'); assert.equal(connection, f.connection); f.closeConnection();
        },
        closeMqttClientPool: noop, clearOnlineReliableOutbox: noop,
        clearPendingOnlineUndo: noop, clearActiveOnlineUndo: noop,
        removeCurrentOnlineRoomSnapshot: noop, cancelQuickMatch: noop,
        hideMatchingFloatingBar: noop, resetBoardOnly: noop, updatePlayerHeaderUI: noop,
        closeOnlineModal: noop, showGameNotice: noop,
        setMode: mode => { f.context.gameMode = mode; },
      });
      const app = fs.readFileSync('js/app.js', 'utf8');
      const start = app.indexOf('    function leaveOnlineRoom(');
      const end = app.indexOf('    // 👤 退出当前账号功能', start);
      assert(start >= 0 && end > start);
      vm.runInContext(app.slice(start, end), f.context);
      f.context.leaveOnlineRoom(false);
      if (pendingPermission) { media.resolve(f.stream()); assert.equal(await enabling, false); }
      assert.equal(f.api.isEnabled(), false);
      assert.equal(f.tracks[0].stopped, 1);
      assert.equal(stoppedAtConnectionClose, true, 'the voice close event must precede silent transport close');
      assert.equal(f.context.conn, null);
    });
  }
  for (const order of [['host', 'client'], ['client', 'host']]) {
    await run(`both peers negotiate when ${order[0]} enables first`, async () => {
      const host = fixture('host'), guest = fixture('client');
      const clients = { host, client: guest };
      let hostIndex = 0, guestIndex = 0;
      async function pump() {
        for (let round = 0; round < 20; round++) {
          const hostMessages = host.sent.slice(hostIndex), guestMessages = guest.sent.slice(guestIndex);
          hostIndex = host.sent.length; guestIndex = guest.sent.length;
          if (!hostMessages.length && !guestMessages.length) return;
          for (const message of hostMessages) await guest.api.handleSignal(message);
          for (const message of guestMessages) await host.api.handleSignal(message);
        }
        assert.fail('voice negotiation did not settle');
      }
      await clients[order[0]].api.toggle();
      await pump();
      await clients[order[1]].api.toggle();
      await pump();
      assert(host.peers.some(peer => peer.remote.some(description => description.type === 'answer')));
      assert(guest.peers.some(peer => peer.remote.some(description => description.type === 'offer')));
      assert.equal(host.mediaCalls(), 1); assert.equal(guest.mediaCalls(), 1);
      const oldHello = host.sent.find(message => message.type === 'voice_hello');
      const oldBye = { type: 'voice_bye', voiceSessionId: oldHello.voiceSessionId };
      host.api.stop(); await pump();
      await host.api.toggle(); await pump();
      const currentPeer = guest.peers.at(-1);
      await guest.api.handleSignal(oldBye);
      await guest.api.handleSignal(oldHello);
      assert.equal(currentPeer.closed, false, 'old session signaling closed the new peer');
      assert.equal(guest.peers.at(-1), currentPeer);
      const count = host.sent.length + guest.sent.length;
      host.api.stop(); guest.api.stop();
      return { signalingMessagesAcrossTwoSessions: count };
    });
  }
  console.log(JSON.stringify({ source: sourcePath, results, pass: results.every(result => result.pass) }, null, 2));
  if (results.some(result => !result.pass)) process.exitCode = 1;
}
main().catch(error => { console.error(error); process.exitCode = 1; });
