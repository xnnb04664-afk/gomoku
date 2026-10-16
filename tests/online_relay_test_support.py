"""Local, deterministic browser fixtures for the production room relay path.

These fixtures exercise the current WebSocket room transport without connecting
to public MQTT brokers, Cloudflare, or ECS. They deliberately mock the ticket
endpoint and WebSocket relay boundary while leaving the game transport state
machine and (unless disabled by a test) Chromium WebRTC implementation intact.
"""

from __future__ import annotations

import json
import time


MOCK_RELAY_JS = r"""
(() => {
  const role = String(window.__gomokuRelayTestRole || 'host');
  const ownId = `${role}-${Math.random().toString(16).slice(2)}-${Date.now()}`;
  const delayMs = Math.max(0, Number(window.__gomokuRelayOpenDelayMs) || 0);
  const sockets = new Set();
  window.__gomokuMockRelayStats = { connections: 0, publishes: 0, subscriptions: 0 };
  window.__gomokuMockAcceptedTimes = [];

  class LocalRelayWebSocket {
    constructor(rawUrl) {
      const url = new URL(String(rawUrl));
      this.url = url.href;
      this.readyState = LocalRelayWebSocket.CONNECTING;
      this.bufferedAmount = 0;
      this.extensions = '';
      this.protocol = '';
      this.binaryType = 'blob';
      this.onopen = null;
      this.onmessage = null;
      this.onerror = null;
      this.onclose = null;
      this.room = url.searchParams.get('room') || '';
      this.role = url.searchParams.get('role') || role;
      this.sessionId = url.searchParams.get('session') || '';
      this.channel = new BroadcastChannel(`gomoku-local-room-relay:${this.room}`);
      this.channel.onmessage = event => this._receive(event.data);
      sockets.add(this);
      window.__gomokuMockRelayStats.connections += 1;

      setTimeout(() => {
        if (this.readyState !== LocalRelayWebSocket.CONNECTING) return;
        this.readyState = LocalRelayWebSocket.OPEN;
        if (typeof this.onopen === 'function') this.onopen({ target: this });
        this._deliver({
          type: 'relay_ready',
          role: this.role,
          room: this.room,
          sessionId: this.sessionId || `relay-${this.room}`
        });
      }, delayMs);
    }

    _deliver(message) {
      if (this.readyState !== LocalRelayWebSocket.OPEN || typeof this.onmessage !== 'function') return;
      this.onmessage({ data: JSON.stringify(message), target: this });
    }

    _receive(message) {
      if (!message || message.source === ownId || message.room !== this.room ||
          message.role === this.role || this.readyState !== LocalRelayWebSocket.OPEN) return;
      if (message.kind === 'publish') {
        this._deliver({ type: 'message', topic: message.topic, payload: message.payload });
      } else if (message.kind === 'close') {
        this._deliver({ type: 'relay_peer_left', role: message.role });
      }
    }

    send(raw) {
      if (this.readyState !== LocalRelayWebSocket.OPEN) throw new Error('WebSocket is not open');
      let message;
      try { message = JSON.parse(String(raw)); } catch (_) { return; }
      if (!message || typeof message !== 'object') return;
      if (message.type === 'subscribe') {
        window.__gomokuMockRelayStats.subscriptions += 1;
        return;
      }
      if (message.type !== 'publish' || typeof message.topic !== 'string' || typeof message.payload !== 'string') return;
      window.__gomokuMockRelayStats.publishes += 1;
      try {
        const payload = JSON.parse(message.payload);
        if (payload && payload.type === 'join_accepted') window.__gomokuMockAcceptedTimes.push(performance.now());
      } catch (_) {}
      this.channel.postMessage({
        kind: 'publish', source: ownId, room: this.room, role: this.role,
        topic: message.topic, payload: message.payload
      });
    }

    close(code = 1000, reason = '') {
      if (this.readyState >= LocalRelayWebSocket.CLOSING) return;
      const wasOpen = this.readyState === LocalRelayWebSocket.OPEN;
      this.readyState = LocalRelayWebSocket.CLOSING;
      if (wasOpen) {
        try { this.channel.postMessage({ kind: 'close', source: ownId, room: this.room, role: this.role }); } catch (_) {}
      }
      this.readyState = LocalRelayWebSocket.CLOSED;
      try { this.channel.close(); } catch (_) {}
      sockets.delete(this);
      setTimeout(() => {
        if (typeof this.onclose === 'function') this.onclose({ code, reason, wasClean: true, target: this });
      }, 0);
    }
  }

  LocalRelayWebSocket.CONNECTING = 0;
  LocalRelayWebSocket.OPEN = 1;
  LocalRelayWebSocket.CLOSING = 2;
  LocalRelayWebSocket.CLOSED = 3;
  window.WebSocket = LocalRelayWebSocket;

  // Force browser-to-browser WebRTC to use local host candidates only. The
  // reliable fallback remains the local BroadcastChannel-backed WebSocket mock.
  const NativePeerConnection = window.RTCPeerConnection;
  if (typeof NativePeerConnection === 'function') {
    function LocalOnlyPeerConnection(configuration = {}, ...args) {
      return new NativePeerConnection({ ...configuration, iceServers: [], iceCandidatePoolSize: 0 }, ...args);
    }
    LocalOnlyPeerConnection.prototype = NativePeerConnection.prototype;
    Object.setPrototypeOf(LocalOnlyPeerConnection, NativePeerConnection);
    window.RTCPeerConnection = LocalOnlyPeerConnection;
    if (window.webkitRTCPeerConnection) window.webkitRTCPeerConnection = LocalOnlyPeerConnection;
  }

  window.addEventListener('pagehide', () => {
    for (const socket of [...sockets]) socket.close(1001, 'page hidden');
  });
})();
"""


TEST_ACCOUNTS = {
    "host": {"uid": "local-test-host-100001", "username": "Local Test Host", "nickname": "Local Test Host", "avatar": "anime_boy"},
    "guest": {"uid": "local-test-guest-100002", "username": "Local Test Guest", "nickname": "Local Test Guest", "avatar": "anime_girl"},
}


def install_local_relay_mocks(page, role: str, *, open_delay_ms: int = 0, disable_p2p: bool = False) -> None:
    """Install an account fixture, fake ticket API, and in-browser room relay."""
    account = TEST_ACCOUNTS.get(role)
    if account is None:
        raise ValueError(f"unsupported local relay test role: {role}")

    init_config = json.dumps(
        {"account": account, "role": role, "delay": int(open_delay_ms), "disableP2p": bool(disable_p2p)},
        ensure_ascii=False,
    )
    account_init_script = """(() => {
          const {account, role, delay, disableP2p} = __CONFIG__;
          localStorage.setItem('gomoku_user_uid', account.uid);
          localStorage.setItem('gomoku_user_username', account.username);
          localStorage.setItem('gomoku_user_token', `test-token-${role}`);
          localStorage.setItem('gomoku_user_refresh_token', `test-refresh-${role}`);
          localStorage.setItem('gomoku_p1Name', account.nickname);
          localStorage.setItem('gomoku_p1Avatar', account.avatar);
          window.__gomokuRelayTestRole = role;
          window.__gomokuRelayOpenDelayMs = delay;
          if (disableP2p) {
            try { Object.defineProperty(window, 'RTCPeerConnection', { configurable: true, value: undefined }); } catch (_) {}
            try { Object.defineProperty(window, 'webkitRTCPeerConnection', { configurable: true, value: undefined }); } catch (_) {}
          }
        })();""".replace("__CONFIG__", init_config)
    page.add_init_script(account_init_script + "\n" + MOCK_RELAY_JS)

    def mock_api(route):
        request_url = route.request.url
        if "/api/room/socket-ticket" in request_url:
            body = route.request.post_data_json or {}
            payload = {"code": 0, "data": {"ticket": "a" * 64, "expiresAt": int(time.time() * 1000) + 30_000}}
        elif "/api/rtc/ice-servers" in request_url:
            payload = {"code": 0, "data": {"iceServers": [{"urls": "stun:stun.local.invalid:3478"}], "expiresAt": int(time.time() * 1000) + 30_000}}
        elif "/api/auth/verify_session" in request_url:
            payload = {"code": 0, "data": {**account, "token": f"test-token-{role}", "score": 1000}}
        else:
            payload = {"code": 0, "data": {}}
        route.fulfill(status=200, content_type="application/json", body=json.dumps(payload, ensure_ascii=False))

    page.route("**/api/**", mock_api)
    # The retired compatibility adapter must remain unused by production-path tests.
    page.route("**/js/mqtt.min.js", lambda route: route.abort())
