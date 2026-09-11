(() => {
  'use strict';

  const state = {
    enabled: false,
    muted: false,
    stream: null,
    peer: null,
    connection: null,
    unsubscribeConnection: null,
    voiceSessionId: '',
    remoteRole: '',
    pendingHello: null,
    pendingCandidates: [],
    makingOffer: false,
    remoteDescriptionReady: false
  };

  function byId(id) { return document.getElementById(id); }
  function currentConnection() {
    try { return window.__gomokuGetOnlineConnection?.() || null; } catch (_) { return null; }
  }
  function currentRole() {
    try {
      return typeof myOnlineColor !== 'undefined' && Number(myOnlineColor) === 1 ? 'host' : 'client';
    } catch (_) { return 'host'; }
  }
  function safeId(prefix = 'voice_') {
    try {
      const bytes = new Uint8Array(12);
      crypto.getRandomValues(bytes);
      return prefix + Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
    } catch (_) {
      return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
    }
  }
  function status(text, warning = false) {
    const el = byId('gomokuVoiceStatus');
    if (el) {
      el.textContent = text;
      el.style.color = warning ? '#fecaca' : '#cbd5e1';
    }
  }
  function updateUi() {
    const panel = byId('gomokuVoicePanel');
    const toggle = byId('gomokuVoiceToggle');
    const mute = byId('gomokuVoiceMute');
    let online = false;
    try { online = typeof gameMode !== 'undefined' && gameMode === 'online'; } catch (_) {}
    if (panel) panel.style.display = online ? 'flex' : 'none';
    if (toggle) {
      toggle.textContent = state.enabled ? '⏹️ 关闭语音' : '🎙️ 开启语音';
      toggle.setAttribute('aria-pressed', state.enabled ? 'true' : 'false');
    }
    if (mute) {
      mute.disabled = !state.enabled;
      mute.textContent = state.muted ? '🔊 取消静音' : '🔇 静音';
      mute.setAttribute('aria-pressed', state.muted ? 'true' : 'false');
      mute.style.opacity = state.enabled ? '1' : '.55';
    }
  }
  function sendSignal(payload) {
    const connection = currentConnection() || state.connection;
    if (!connection || !connection.open || connection.closed || typeof connection.send !== 'function') return false;
    const message = { ...payload, type: payload.type, voiceSessionId: state.voiceSessionId || payload.voiceSessionId || safeId() };
    if (!state.voiceSessionId) state.voiceSessionId = message.voiceSessionId;
    try { return connection.send(message) !== false; } catch (_) { return false; }
  }
  async function iceServers() {
    try {
      const value = await window.__gomokuGetWebRtcIceServers?.();
      if (Array.isArray(value) && value.length) return value;
    } catch (_) {}
    return [{ urls: 'stun:stun.cloudflare.com:3478' }];
  }
  function clearRemoteAudio() {
    const audio = byId('gomokuVoiceRemoteAudio');
    if (audio) {
      try { audio.pause(); } catch (_) {}
      audio.srcObject = null;
    }
  }
  function closePeer() {
    if (!state.peer) return;
    try { state.peer.onicecandidate = null; state.peer.ontrack = null; state.peer.onconnectionstatechange = null; state.peer.close(); } catch (_) {}
    state.peer = null;
    state.remoteDescriptionReady = false;
    state.makingOffer = false;
    state.pendingCandidates = [];
    clearRemoteAudio();
  }
  function stopLocalStream() {
    if (!state.stream) return;
    for (const track of state.stream.getTracks?.() || []) {
      try { track.stop(); } catch (_) {}
    }
    state.stream = null;
  }
  function cleanup(sendBye = true) {
    if (sendBye && state.enabled) sendSignal({ type: 'voice_bye' });
    closePeer();
    stopLocalStream();
    state.enabled = false;
    state.muted = false;
    state.connection = null;
    state.voiceSessionId = '';
    state.remoteRole = '';
    state.pendingHello = null;
    updateUi();
    status('🎙️ 语音默认关闭');
  }
  function attachConnection(eventName, connection) {
    if (eventName === 'open') {
      state.connection = connection;
      if (state.enabled) {
        sendSignal({ type: 'voice_hello', role: currentRole() });
        if (currentRole() === 'host') void makeOffer();
      }
    } else if (eventName === 'close' && (!connection || state.connection === connection)) {
      cleanup(false);
      status('🎙️ 联机已断开，语音已关闭', true);
    }
  }
  async function createPeer() {
    if (state.peer) return state.peer;
    if (typeof RTCPeerConnection !== 'function') throw new Error('当前设备不支持 WebRTC 语音');
    const peer = new RTCPeerConnection({ iceServers: await iceServers() });
    state.peer = peer;
    for (const track of state.stream?.getTracks?.() || []) peer.addTrack(track, state.stream);
    peer.onicecandidate = event => {
      if (event.candidate) sendSignal({ type: 'voice_ice', candidate: event.candidate });
    };
    peer.ontrack = event => {
      const audio = byId('gomokuVoiceRemoteAudio');
      const stream = event.streams?.[0] || new MediaStream([event.track]);
      if (audio) {
        audio.srcObject = stream;
        audio.play?.().catch(() => {});
      }
      status('🎙️ 语音已连接');
    };
    peer.onconnectionstatechange = () => {
      const value = peer.connectionState || peer.iceConnectionState;
      if (value === 'connected' || value === 'completed') status('🎙️ 语音已连接');
      else if (value === 'failed' || value === 'closed' || value === 'disconnected') status('🎙️ 语音线路断开，可重新开启', true);
    };
    return peer;
  }
  async function makeOffer() {
    if (!state.enabled || currentRole() !== 'host' || state.makingOffer) return;
    const peer = await createPeer();
    if (!peer || peer.signalingState !== 'stable') return;
    state.makingOffer = true;
    try {
      const offer = await peer.createOffer({ offerToReceiveAudio: true });
      await peer.setLocalDescription(offer);
      sendSignal({ type: 'voice_offer', role: 'host', sdp: peer.localDescription?.sdp || offer.sdp });
      status('🎙️ 正在连接对方语音…');
    } catch (error) {
      status('🎙️ 语音协商失败，请重试', true);
      console.warn('[voice offer]', error?.message || error);
    } finally {
      state.makingOffer = false;
    }
  }
  async function handleSignal(data) {
    if (!data || typeof data.type !== 'string') return;
    if (data.type === 'voice_bye') {
      closePeer();
      if (state.enabled) status('🎙️ 对方已关闭语音');
      return;
    }
    if (!state.enabled && data.type !== 'voice_hello') return;
    if (data.type === 'voice_hello') {
      state.remoteRole = data.role === 'host' || data.role === 'client' ? data.role : '';
      state.pendingHello = data;
      // 房间只使用主持方生成的一次性会话号。客户端开启时可能尚未收到它的
      // hello，不能因为双方各自的临时号不同而把首次握手丢弃。
      if (!state.voiceSessionId && data.voiceSessionId) state.voiceSessionId = String(data.voiceSessionId).slice(0, 96);
      if (state.enabled) {
        sendSignal({ type: 'voice_hello', role: currentRole() });
        if (currentRole() === 'host') await makeOffer();
      }
      return;
    }
    if (data.voiceSessionId && state.voiceSessionId && data.voiceSessionId !== state.voiceSessionId) return;
    if (data.voiceSessionId && !state.voiceSessionId) state.voiceSessionId = String(data.voiceSessionId).slice(0, 96);
    if (!state.enabled) return;
    const peer = await createPeer();
    if (data.type === 'voice_offer' && typeof data.sdp === 'string') {
      try {
        await peer.setRemoteDescription({ type: 'offer', sdp: data.sdp });
        state.remoteDescriptionReady = true;
        for (const candidate of state.pendingCandidates.splice(0)) {
          try { await peer.addIceCandidate(candidate); } catch (_) {}
        }
        const answer = await peer.createAnswer();
        await peer.setLocalDescription(answer);
        sendSignal({ type: 'voice_answer', role: 'client', sdp: peer.localDescription?.sdp || answer.sdp });
        status('🎙️ 正在连接对方语音…');
      } catch (error) {
        status('🎙️ 语音接听失败，请重试', true);
        console.warn('[voice answer]', error?.message || error);
      }
    } else if (data.type === 'voice_answer' && typeof data.sdp === 'string') {
      try {
        await peer.setRemoteDescription({ type: 'answer', sdp: data.sdp });
        state.remoteDescriptionReady = true;
        for (const candidate of state.pendingCandidates.splice(0)) {
          try { await peer.addIceCandidate(candidate); } catch (_) {}
        }
        status('🎙️ 正在连接对方语音…');
      } catch (error) { console.warn('[voice remote answer]', error?.message || error); }
    } else if (data.type === 'voice_ice' && data.candidate) {
      if (!state.remoteDescriptionReady) {
        state.pendingCandidates.push(data.candidate);
      } else {
        try { await peer.addIceCandidate(data.candidate); } catch (error) { console.warn('[voice ice]', error?.message || error); }
      }
    }
  }
  async function enable() {
    let online = false;
    try { online = typeof gameMode !== 'undefined' && gameMode === 'online'; } catch (_) {}
    const connection = currentConnection();
    if (!online || !connection) {
      status('🎙️ 请先进入联机房间，再开启语音', true);
      updateUi();
      return false;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      status('🎙️ 当前设备不支持麦克风语音', true);
      return false;
    }
    try {
      state.connection = connection;
      state.voiceSessionId = currentRole() === 'host' ? safeId() : '';
      state.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
      state.enabled = true;
      state.muted = false;
      updateUi();
      status('🎙️ 麦克风已开启，正在连接对方…');
      await createPeer();
      sendSignal({ type: 'voice_hello', role: currentRole() });
      if (currentRole() === 'host') await makeOffer();
      return true;
    } catch (error) {
      cleanup(false);
      const name = String(error?.name || '');
      status(name === 'NotAllowedError' || name === 'PermissionDeniedError' ? '🎙️ 麦克风权限被拒绝，请在系统设置中允许' : '🎙️ 无法开启麦克风语音', true);
      console.warn('[voice getUserMedia]', error?.message || error);
      return false;
    }
  }
  function toggle() {
    if (state.enabled) { cleanup(true); return Promise.resolve(false); }
    return enable();
  }
  function toggleMute() {
    if (!state.enabled || !state.stream) return false;
    state.muted = !state.muted;
    for (const track of state.stream.getAudioTracks?.() || []) track.enabled = !state.muted;
    updateUi();
    status(state.muted ? '🔇 已静音（仅本地关闭麦克风）' : '🎙️ 语音已连接');
    return state.muted;
  }

  state.unsubscribeConnection = window.__gomokuRegisterOnlineConnectionListener?.(attachConnection) || null;
  window.addEventListener('beforeunload', () => cleanup(false), { once: true });
  updateUi();
  window.GomokuVoice = Object.freeze({
    toggle,
    toggleMute,
    handleSignal,
    stop: () => cleanup(true),
    isEnabled: () => state.enabled
  });
  window.__GOMOKU_VOICE_READY__ = true;
})();
