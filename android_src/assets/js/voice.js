(() => {
  'use strict';

  const state = {
    enabled: false,
    enabling: false,
    generation: 0,
    peerGeneration: 0,
    peerPromise: null,
    signalTask: Promise.resolve(),
    helloReplySession: '',
    retiredSessions: new Set(),
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
      toggle.textContent = state.enabled ? '⏹️ 关闭语音' : state.enabling ? '⏹️ 取消开启' : '🎙️ 开启语音';
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
    const connection = currentConnection();
    if (!state.enabled || !connection || connection !== state.connection || !connection.open ||
        connection.closed || typeof connection.send !== 'function') return false;
    // 只有房主分配语音会话。客方尚未收到房主 hello 时发送无会话的请求，
    // 不能自行随机生成一个会让房主 offer 被丢弃的不同会话。
    const voiceSessionId = state.voiceSessionId || '';
    if (!voiceSessionId && payload.type !== 'voice_hello') return false;
    try { return connection.send({ ...payload, voiceSessionId }) !== false; } catch (_) { return false; }
  }
  function isCurrent(generation, connection = state.connection) {
    return state.generation === generation && state.connection === connection &&
      currentConnection() === connection && typeof gameMode !== 'undefined' && gameMode === 'online';
  }
  function isCurrentPeer(peer, generation, peerGeneration) {
    return state.enabled && isCurrent(generation) && state.peer === peer && state.peerGeneration === peerGeneration;
  }
  function retireSession(sessionId) {
    if (!sessionId) return;
    state.retiredSessions.add(sessionId);
    if (state.retiredSessions.size > 32) state.retiredSessions.delete(state.retiredSessions.values().next().value);
  }
  async function iceServers() {
    try {
      const value = await window.__gomokuGetWebRtcIceServers?.();
      if (Array.isArray(value) && value.length) return value;
    } catch (_) {}
    let stunUrl = String(window.__GOMOKU_ECS_STUN_URL || '');
    if (!stunUrl) {
      try {
        const host = new URL(String(window.GOMOKU_BACKEND_CONFIG?.apiBase || '')).hostname;
        if (host) stunUrl = `stun:${host}:3478`;
      } catch (_) {}
    }
    return [{ urls: stunUrl || 'stun:101.201.76.166:3478' }];
  }
  function clearRemoteAudio() {
    const audio = byId('gomokuVoiceRemoteAudio');
    if (audio) {
      try { audio.pause(); } catch (_) {}
      audio.srcObject = null;
    }
  }
  function closePeer() {
    state.peerGeneration++;
    state.peerPromise = null;
    if (state.peer) {
      try { state.peer.onicecandidate = null; state.peer.ontrack = null; state.peer.onconnectionstatechange = null; state.peer.close(); } catch (_) {}
    }
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
    state.generation++;
    state.enabling = false;
    state.signalTask = Promise.resolve();
    state.helloReplySession = '';
    retireSession(state.voiceSessionId);
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
      if (state.connection && state.connection !== connection) {
        cleanup(false);
        state.retiredSessions.clear();
      }
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
  function createPeer() {
    if (state.peer) return Promise.resolve(state.peer);
    if (state.peerPromise) return state.peerPromise;
    if (typeof RTCPeerConnection !== 'function') return Promise.reject(new Error('当前设备不支持 WebRTC 语音'));
    const generation = state.generation;
    const peerGeneration = state.peerGeneration;
    const pending = (async () => {
      const servers = await iceServers();
      if (!state.enabled || !isCurrent(generation) || state.peerGeneration !== peerGeneration) return null;
      const peer = new RTCPeerConnection({ iceServers: servers });
      state.peer = peer;
      for (const track of state.stream?.getTracks?.() || []) peer.addTrack(track, state.stream);
      peer.onicecandidate = event => {
        if (isCurrentPeer(peer, generation, peerGeneration) && event.candidate) {
          sendSignal({ type: 'voice_ice', candidate: event.candidate });
        }
      };
      peer.ontrack = event => {
        if (!isCurrentPeer(peer, generation, peerGeneration)) return;
        const audio = byId('gomokuVoiceRemoteAudio');
        const stream = event.streams?.[0] || new MediaStream([event.track]);
        if (audio) {
          audio.srcObject = stream;
          audio.play?.().catch(() => {});
        }
        status('🎙️ 语音已连接');
      };
      peer.onconnectionstatechange = () => {
        if (!isCurrentPeer(peer, generation, peerGeneration)) return;
        const value = peer.connectionState || peer.iceConnectionState;
        if (value === 'connected' || value === 'completed') status('🎙️ 语音已连接');
        else if (value === 'failed' || value === 'closed' || value === 'disconnected') status('🎙️ 语音线路断开，可重新开启', true);
      };
      return peer;
    })();
    state.peerPromise = pending;
    pending.finally(() => {
      if (state.peerPromise === pending) state.peerPromise = null;
    }).catch(() => {});
    return pending;
  }
  async function makeOffer() {
    if (!state.enabled || currentRole() !== 'host' || state.makingOffer) return;
    const generation = state.generation;
    const peerGeneration = state.peerGeneration;
    state.makingOffer = true;
    try {
      const peer = await createPeer();
      if (!peer || !isCurrentPeer(peer, generation, peerGeneration)) return;
      // 房主先开启时，首次 offer 可能早于对方开启。复用未回答的 offer，
      // 不重复建 Peer，也不能因为 have-local-offer 而永远拒绝补发。
      if (peer.signalingState === 'have-local-offer' && peer.localDescription?.type === 'offer') {
        sendSignal({ type: 'voice_offer', role: 'host', sdp: peer.localDescription.sdp });
        return;
      }
      if (peer.signalingState !== 'stable') return;
      const offer = await peer.createOffer({ offerToReceiveAudio: true });
      if (!isCurrentPeer(peer, generation, peerGeneration)) return;
      await peer.setLocalDescription(offer);
      if (!isCurrentPeer(peer, generation, peerGeneration)) return;
      sendSignal({ type: 'voice_offer', role: 'host', sdp: peer.localDescription?.sdp || offer.sdp });
      status('🎙️ 正在连接对方语音…');
    } catch (error) {
      if (!isCurrent(generation) || state.peerGeneration !== peerGeneration) return;
      status('🎙️ 语音协商失败，请重试', true);
      console.warn('[voice offer]', error?.message || error);
    } finally {
      if (state.generation === generation && state.peerGeneration === peerGeneration) state.makingOffer = false;
    }
  }
  async function handleCurrentSignal(data, generation) {
    if (!isCurrent(generation)) return;
    const sessionId = typeof data.voiceSessionId === 'string' ? data.voiceSessionId : '';
    if (sessionId.length > 96 || state.retiredSessions.has(sessionId)) return;
    if (data.type === 'voice_hello') {
      const remoteRole = currentRole() === 'host' ? 'client' : 'host';
      if (data.role !== remoteRole || (remoteRole === 'host' && !sessionId)) return;
      state.remoteRole = remoteRole;
      state.pendingHello = data;
      if (remoteRole === 'host' && state.voiceSessionId !== sessionId) {
        if (state.voiceSessionId) {
          retireSession(state.voiceSessionId);
          closePeer();
        }
        state.voiceSessionId = sessionId;
      }
      if (!state.enabled) return;
      const replyKey = state.voiceSessionId;
      if (state.helloReplySession === replyKey) return;
      state.helloReplySession = replyKey;
      sendSignal({ type: 'voice_hello', role: currentRole() });
      if (currentRole() === 'host') await makeOffer();
      return;
    }
    if (!state.enabled || !sessionId || sessionId !== state.voiceSessionId) return;
    if (data.type === 'voice_bye') {
      closePeer();
      retireSession(sessionId);
      state.helloReplySession = '';
      state.voiceSessionId = currentRole() === 'host' ? safeId() : '';
      // 对方可重新手动开启；房主为下一次协商准备新会话，旧 bye/ICE 不能
      // 关闭后续连接。麦克风仍由本地用户的开关控制。
      if (currentRole() === 'host') sendSignal({ type: 'voice_hello', role: 'host' });
      status('🎙️ 对方已关闭语音');
      return;
    }
    const peerGeneration = state.peerGeneration;
    const peer = await createPeer();
    const current = () => peer && isCurrentPeer(peer, generation, peerGeneration) && state.voiceSessionId === sessionId;
    if (!current()) return;
    if (data.type === 'voice_offer' && currentRole() === 'client' && typeof data.sdp === 'string') {
      await peer.setRemoteDescription({ type: 'offer', sdp: data.sdp });
      if (!current()) return;
      state.remoteDescriptionReady = true;
      for (const candidate of state.pendingCandidates.splice(0)) {
        try { await peer.addIceCandidate(candidate); } catch (_) {}
        if (!current()) return;
      }
      const answer = await peer.createAnswer();
      if (!current()) return;
      await peer.setLocalDescription(answer);
      if (!current()) return;
      sendSignal({ type: 'voice_answer', role: 'client', sdp: peer.localDescription?.sdp || answer.sdp });
      status('🎙️ 正在连接对方语音…');
    } else if (data.type === 'voice_answer' && currentRole() === 'host' && typeof data.sdp === 'string') {
      await peer.setRemoteDescription({ type: 'answer', sdp: data.sdp });
      if (!current()) return;
      state.remoteDescriptionReady = true;
      for (const candidate of state.pendingCandidates.splice(0)) {
        try { await peer.addIceCandidate(candidate); } catch (_) {}
        if (!current()) return;
      }
      status('🎙️ 正在连接对方语音…');
    } else if (data.type === 'voice_ice' && data.candidate) {
      if (!state.remoteDescriptionReady) state.pendingCandidates.push(data.candidate);
      else await peer.addIceCandidate(data.candidate);
    }
  }
  function handleSignal(data, transport, connection) {
    if (!data || typeof data.type !== 'string' || (connection && connection !== currentConnection())) return Promise.resolve();
    // 未开启时只缓存房主 hello，绝不请求麦克风或回复信令。
    if (!state.connection && data.type === 'voice_hello') state.connection = currentConnection();
    const generation = state.generation;
    const task = state.signalTask.then(() => handleCurrentSignal(data, generation)).catch(error => {
      if (isCurrent(generation)) console.warn('[voice signal]', error?.message || error);
    });
    state.signalTask = task;
    return task;
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
    try {
      const policy = document.permissionsPolicy || document.featurePolicy;
      if (typeof policy?.allowsFeature === 'function' && policy.allowsFeature('microphone') === false) {
        status('🎙️ 当前运行环境未开放麦克风，暂时无法使用语音', true);
        updateUi();
        return false;
      }
    } catch (_) {}
    if (!navigator.mediaDevices?.getUserMedia) {
      status('🎙️ 当前设备不支持麦克风语音', true);
      return false;
    }
    const generation = ++state.generation;
    state.enabling = true;
    state.connection = connection;
    state.voiceSessionId = currentRole() === 'host' ? safeId() :
      (state.pendingHello?.role === 'host' && !state.retiredSessions.has(state.pendingHello.voiceSessionId) ? state.pendingHello.voiceSessionId : '');
    state.helloReplySession = '';
    updateUi();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
      if (!isCurrent(generation, connection)) {
        for (const track of stream.getTracks?.() || []) { try { track.stop(); } catch (_) {} }
        return false;
      }
      state.stream = stream;
      state.enabled = true;
      state.muted = false;
      updateUi();
      status('🎙️ 麦克风已开启，正在连接对方…');
      const peer = await createPeer();
      if (!peer || !isCurrent(generation, connection) || !state.enabled) {
        if (state.generation === generation) cleanup(false);
        return false;
      }
      sendSignal({ type: 'voice_hello', role: currentRole() });
      if (currentRole() === 'host') await makeOffer();
      return isCurrent(generation, connection) && state.enabled;
    } catch (error) {
      if (!isCurrent(generation, connection)) return false;
      cleanup(false);
      const name = String(error?.name || '');
      status(name === 'NotAllowedError' || name === 'PermissionDeniedError' ? '🎙️ 麦克风权限被拒绝，请在系统设置中允许' : '🎙️ 无法开启麦克风语音', true);
      console.warn('[voice getUserMedia]', error?.message || error);
      return false;
    } finally {
      if (state.generation === generation) {
        state.enabling = false;
        updateUi();
      }
    }
  }
  function toggle() {
    if (state.enabled || state.enabling) { cleanup(true); return Promise.resolve(false); }
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
