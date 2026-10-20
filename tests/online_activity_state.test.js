const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('js/online.js', 'utf8');
const section = source.slice(source.indexOf('    function showMatchingFloatingBar()'), source.indexOf('    function setMode(mode,'));
function fixture() {
  const nodes = new Map();
  function node(id) {
    if (!nodes.has(id)) nodes.set(id, { style: {}, dataset: {}, hidden: false, textContent: '', innerHTML: '',
      classList: { add() {}, remove() {}, toggle() {} }, removeAttribute() {}, setAttribute() {} });
    return nodes.get(id);
  }
  const storage = new Map();
  const notifications = [], notices = [], events = [], intervals = new Map();
  let timerId = 0, clock = 10000000;
  const context = { console, Date: { now: () => clock },
    document: { getElementById: node, querySelector: () => null, dispatchEvent: event => events.push(event) },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
    localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
    setInterval: fn => { intervals.set(++timerId, fn); return timerId; }, clearInterval: id => intervals.delete(id),
    setTimeout: fn => fn(), currentRoomCode: '', onlineSessionId: '', conn: null, hostInviteBinding: null,
    activeRoomJoinAttempt: null, isHostConnecting: false, isReconnecting: false, gameMode: 'ai', isOver: false,
    currentUserUid: 'test_uid', currentUserToken: 'test_token', currentUserRefreshToken: '', currentUserScore: 1000,
    p1Name: '测试棋友', p1Avatar: 'anime_boy', p2Name: '', p2Avatar: '', BLACK: 1, WHITE: 2,
    hasReadyFriendRoom: () => Boolean(context.hostInviteBinding?.ready), hasRegisteredAccountSession: () => true,
    normalizeNetworkName: name => name, getNetworkAvatarValue: avatar => avatar, renderAvatarElement: avatar => avatar,
    generateSecureId: (length, prefix) => `${prefix}abcdefgh123456`, showGameNotice: message => notices.push(message),
    openAuthModal() {}, warmApiHost: async () => {}, playCardAudioEffect() {}, updatePlayerHeaderUI() {}, setOnlineColor() {},
    initPeer: () => { context.createdRooms++; }, createdRooms: 0, leftRooms: 0, shownGames: 0,
    showCustomConfirm: (message, accept) => { context.confirmExit = accept; },
    leaveOnlineRoom: () => { context.leftRooms++; context.hostInviteBinding = null; context.currentRoomCode = ''; context.onlineSessionId = ''; context.gameMode = 'ai'; },
    triggerOnlineReconnect: () => { context.isReconnecting = true; },
    setMode: mode => { context.gameMode = mode; },
    initHostMqttPeer: async () => true, joinOnlineRoom() {},
    safeApiFetch: async () => ({ status: 200, json: async () => ({ code: 0, status: 'waiting' }) })
  };
  context.window = { AndroidNativeApp: { updateMatchmakingNotification: (...args) => notifications.push(args) },
    SkyIslandUI: { showGame: () => context.shownGames++ }, getCurrentGameSummary: () => null };
  vm.createContext(context);
  vm.runInContext(section, context);
  context.window.publishOnlineActivityState = context.publishOnlineActivityState;
  return { context, node, storage, notifications, notices, events, intervals,
    state: () => context.getOnlineActivityState(), run: code => vm.runInContext(code, context), advance: ms => { clock += ms; } };
}

async function main() {
  const f = fixture(), c = f.context;
  c.publishOnlineActivityState();
  assert.equal(f.state().phase, 'idle');
  assert.equal(f.node('matchingFloatingTimer').textContent, '未在房间');
  Object.assign(c, { currentRoomCode: '123456', gameMode: 'online' });
  assert.equal(f.state().hasRoom, false, 'a stale short code/mode without transport, session or saved game must not block matching');
  Object.assign(c, { gameMode: 'ai', hostInviteBinding: { ready: true } });
  c.publishOnlineActivityState();
  assert.equal(f.state().phase, 'ready');
  assert.match(f.node('matchingFloatingTimer').textContent, /123456.*等待好友/);
  c.returnToOnlineActivity();
  assert.equal(c.createdRooms, 0, 'returning to the waiting room must not create a replacement');
  c.leaveOnlineActivity();
  assert.equal(c.leftRooms, 0, 'exit requires explicit confirmation');
  c.confirmExit();
  assert.equal(c.leftRooms, 1);
  assert.equal(f.state().phase, 'idle');
  Object.assign(c, { gameMode: 'online', currentRoomCode: '654321', onlineSessionId: 'session', conn: { open: true, ready: true } });
  assert.equal(f.state().phase, 'playing');
  await c.startQuickMatch();
  assert.equal(c.leftRooms, 1, 'clicking match must not silently leave an active game');
  assert.equal(c.shownGames, 1, 'an existing game is visibly returned to');
  c.isOver = true;
  await c.startQuickMatch();
  assert.equal(c.leftRooms, 1, 'a finished board still belongs to its room until explicit exit');
  c.isReconnecting = true;
  c.publishOnlineActivityState();
  assert.equal(f.state().phase, 'reconnecting');
  assert.match(f.node('matchingFloatingTimer').textContent, /棋局已保留/);
  Object.assign(c, { gameMode: 'ai', conn: null, onlineSessionId: '', currentRoomCode: '', isReconnecting: false, activeRoomJoinAttempt: { code: '777777' } });
  assert.equal(f.state().phase, 'joining');
  c.activeRoomJoinAttempt = null;
  c.isHostConnecting = true;
  assert.equal(f.state().phase, 'connecting');
  c.isHostConnecting = false;

  let resolveJoin;
  c.safeApiFetch = async endpoint => endpoint === '/api/match/join'
    ? await new Promise(resolve => { resolveJoin = resolve; })
    : { status: 200, json: async () => ({ code: 0 }) };
  const pendingStart = c.startQuickMatch();
  await new Promise(setImmediate);
  assert.equal(f.state().matching, true);
  assert.equal(f.notifications.at(-1)[2], true, 'only user-started matchmaking requests notification permission');
  const startedAt = f.state().startedAt;
  const count = f.notifications.length;
  f.advance(61000);
  for (const callback of [...f.intervals.values()]) await callback();
  assert.match(f.node('matchingFloatingTimer').textContent, /01:01/);
  c.closeOnlineModal();
  c.switchOnlineTab('join');
  c.switchOnlineTab('create');
  assert.equal(f.state().matching, true, 'closing the modal or switching its tabs must keep a pending match alive');
  assert.equal(c.createdRooms, 0, 'a create tab cannot replace a pending queue');
  assert.equal(f.node('matchingFloatingBar').style.display, 'flex');
  assert.equal(f.notifications.length, count, 'timer/modal rendering must not spam native notifications');
  await c.cancelQuickMatch();
  assert.equal(f.state().matching, false);
  assert.equal(f.storage.has('gomoku_pending_match_v1'), false);
  assert.deepEqual(f.notifications.at(-1), [false, 0, false]);
  resolveJoin({ status: 200, json: async () => ({ code: 0, status: 'matched', roomCode: '999999', role: 'host' }) });
  await pendingStart;
  assert.equal(f.state().phase, 'idle', 'a late join success must never resurrect a cancelled queue');
  assert.equal(c.gameMode, 'ai');
  c.onMatchFound({ roomCode: '999999', role: 'host' });
  assert.equal(f.state().phase, 'idle', 'unsolicited late callbacks are ignored');

  const restored = fixture();
  restored.storage.set('gomoku_pending_match_v1', JSON.stringify({ version: 1, state: 'waiting', uid: 'test_uid', matchId: 'match_abcdefgh', startedAt: startedAt - 2000 }));
  await restored.context.resumePendingQuickMatch();
  assert.equal(restored.state().startedAt, startedAt - 2000);
  assert.equal(restored.notifications.at(-1)[2], false, 'restore must not request permission');
  restored.context.finishMatchAuthenticationFailure();
  assert.equal(restored.state().matching, false);
  assert.equal(restored.storage.size, 0);
  assert.deepEqual(restored.notifications.at(-1), [false, 0, false]);

  const expired = fixture();
  await expired.context.startQuickMatch();
  expired.advance(3600000);
  for (const callback of [...expired.intervals.values()]) await callback();
  assert.equal(expired.state().matching, false);
  assert.deepEqual(expired.notifications.at(-1), [false, 0, false]);

  const changed = fixture();
  await changed.context.startQuickMatch();
  changed.context.currentUserUid = 'other_uid';
  changed.context.publishOnlineActivityState();
  assert.equal(changed.state().phase, 'idle');
  assert.equal(changed.storage.size, 0, 'switching accounts atomically cancels the old queue');
  assert.deepEqual(changed.notifications.at(-1), [false, 0, false]);

  const found = fixture();
  await found.context.startQuickMatch();
  found.context.onMatchFound({ roomCode: '333333', role: 'host', opponent: { uid: 'other', nickname: '对手' } });
  assert.equal(found.state().matching, false);
  assert.equal(found.state().hasRoom, true, 'match success transfers ownership into the room state');
  assert.equal(found.storage.size, 0);
  assert.deepEqual(found.notifications.at(-1), [false, 0, false], 'success removes the waiting notification');
  const previousMode = found.context.gameMode;
  found.context.onMatchFound({ roomCode: '444444', role: 'client' });
  assert.equal(found.context.gameMode, previousMode, 'a duplicate success cannot migrate into a second room');

  const oldApk = fixture();
  delete oldApk.context.window.AndroidNativeApp;
  await oldApk.context.startQuickMatch();
  assert.equal(oldApk.state().matching, true, 'old APK bridges remain compatible');
  await oldApk.context.cancelQuickMatch();

  const denied = fixture();
  let permission = 'denied', permissionReads = 0;
  denied.context.window.AndroidNativeApp.getMatchmakingNotificationPermissionState = () => { permissionReads++; return permission; };
  await denied.context.startQuickMatch();
  assert.equal(denied.state().matching, true, 'denying notification permission must not interrupt matchmaking');
  assert.equal(denied.node('onlineActivityNotificationHint').hidden, false);
  assert.match(denied.node('onlineActivityNotificationHint').textContent, /通知未开启/);
  const permissionReadCount = permissionReads;
  for (let i = 0; i < 5; i++) denied.context.publishOnlineActivityState();
  assert.equal(permissionReads, permissionReadCount, 'routine renders must use cached native permission');
  permission = 'granted';
  denied.context.publishOnlineActivityState(false, true);
  assert.equal(denied.node('onlineActivityNotificationHint').hidden, true, 'permission callback/resume refresh clears the hint after grant');
  permission = 'denied';
  denied.context.publishOnlineActivityState(false, true);
  await denied.context.cancelQuickMatch();
  assert.equal(denied.node('onlineActivityNotificationHint').hidden, true, 'terminal queue state removes the permission hint');

  const legacyPermission = fixture();
  await legacyPermission.context.startQuickMatch();
  assert.equal(legacyPermission.state().matching, true);
  assert.equal(legacyPermission.node('onlineActivityNotificationHint').hidden, true, 'an older APK without the permission getter remains compatible');

  const savedRoom = fixture();
  savedRoom.context.window.getCurrentGameSummary = () => ({ gameMode: 'online' });
  savedRoom.context.readCurrentOnlineRoomSnapshot = () => ({ roomCode: '888888' });
  savedRoom.context.publishOnlineActivityState();
  assert.equal(savedRoom.state().roomCode, '888888');
  assert.equal(savedRoom.state().hasRoom, true);

  const hostSource = source.slice(source.indexOf('    async function initHostMqttPeer('), source.indexOf('    function initPeer('));
  const prepared = fixture();
  Object.assign(prepared.context, { hostConnectionRequestId: 0, onlineTransportGeneration: 1,
    currentRoomCode: '123456', onlineSessionId: 'retained-session', onlineRoundId: 'retained-round',
    activeOnlineGuestUid: '',
    lastActiveRoomCode: '', MQTT_ROOM_DATA_QOS: 1, detachHostInviteListener() {},
    ensureOnlineSessionId: () => 'retained-session',
    getOrCreateOnlineTransport: async () => ({ on() {}, subscribe: (topic, options, done) => done() }) });
  vm.runInContext(hostSource, prepared.context);
  await prepared.context.initHostMqttPeer('123456');
  assert.equal(prepared.state().phase, 'ready', 'a real completed room subscription must publish its ready state');
  assert.match(prepared.node('matchingFloatingTimer').textContent, /等待好友加入/);

  const hostCancelled = fixture();
  let resolveHostAuth;
  Object.assign(hostCancelled.context, { hostConnectionRequestId: 0, onlineTransportGeneration: 1,
    ensurePrivateGameAccountSession: () => new Promise(resolve => { resolveHostAuth = resolve; }) });
  vm.runInContext(hostSource, hostCancelled.context);
  const hostPending = hostCancelled.context.initHostMqttPeer('666666');
  assert.equal(hostCancelled.state().phase, 'connecting', 'host account validation must be visible and cancellable');
  hostCancelled.context.onlineTransportGeneration++;
  hostCancelled.context.isHostConnecting = false;
  resolveHostAuth(true);
  assert.equal(await hostPending, false);
  assert.equal(hostCancelled.state().phase, 'idle', 'late host authorization must not create a room after explicit exit');
  console.log('online activity state: room visibility, safe return/exit, background queue, cancellation races, restore, auth, expiry and account switch passed');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
