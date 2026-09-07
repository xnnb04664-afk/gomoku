import json
import os
import time

from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeoutError


MOCK_RELAY_INIT = r"""
(() => {
  const role = window.__gomokuRelayRole;
  const protocolRole = role === 'host' ? 'host' : 'client';
  const clientId = window.__gomokuRelayClientId;
  const channel = new BroadcastChannel('gomoku-mock-room-relay');
  const sockets = new Set();

  function deliver(payload) {
    for (const socket of sockets) {
      if (socket.readyState !== 1 || typeof socket.onmessage !== 'function') continue;
      socket.onmessage({ data: JSON.stringify(payload) });
    }
  }

  channel.onmessage = ({ data }) => {
    if (!data || data.source === clientId || data.room !== socketRoom) return;
    if (data.kind === 'host_ready' && protocolRole === 'client') {
      deliver({ type: 'relay_ready', role: 'client', room: socketRoom, sessionId: data.sessionId });
      return;
    }
    if (data.kind === 'wire' && data.targetRole && data.targetRole === protocolRole) {
      deliver({ type: 'message', topic: data.topic, payload: data.payload });
    }
  };

  let socketRoom = '';
  let firstJoinConfirmedAt = 0;
  window.__gomokuDroppedJoinConfirmations = 0;
  class MockRelayWebSocket {
    constructor(url) {
      this.url = String(url);
      this.readyState = 0;
      const parsed = new URL(this.url);
      socketRoom = parsed.searchParams.get('room') || '';
      sockets.add(this);
      this.sessionId = parsed.searchParams.get('session') || '';
      setTimeout(() => {
        if (this.readyState !== 0) return;
        this.readyState = 1;
        if (typeof this.onopen === 'function') this.onopen();
        if (role === 'host') {
          channel.postMessage({ kind: 'host_ready', source: clientId, room: socketRoom, sessionId: this.sessionId });
        }
      }, 25);
    }
    send(raw) {
      if (this.readyState !== 1) throw new Error('socket is not open');
      const message = JSON.parse(String(raw));
      if (message.type !== 'publish') return;
      if (protocolRole === 'host') {
        let payload = null;
        try { payload = JSON.parse(String(message.payload || '')); } catch (_) {}
        if (payload?.type === 'join_confirmed') {
          if (!firstJoinConfirmedAt) firstJoinConfirmedAt = Date.now();
          if (Date.now() - firstJoinConfirmedAt < 1600) {
            window.__gomokuDroppedJoinConfirmations++;
            return;
          }
        }
      }
      channel.postMessage({
        kind: 'wire',
        source: clientId,
        room: socketRoom,
        targetRole: protocolRole === 'host' ? 'client' : 'host',
        topic: message.topic,
        payload: message.payload
      });
    }
    close() {
      if (this.readyState === 3) return;
      this.readyState = 3;
      sockets.delete(this);
      if (typeof this.onclose === 'function') this.onclose();
    }
  }
  window.WebSocket = MockRelayWebSocket;
})();
"""


def main():
    import sys
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    room = str(int(time.time() * 1000) % 900000 + 100000)
    url = os.environ.get("GOMOKU_TEST_URL", "http://127.0.0.1:3000/index.html")
    errors = {"host": [], "guest": []}
    logs = {"host": [], "guest": []}

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        context = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=1)
        pages = {}
        for role in ("host", "guest"):
            page = context.new_page()
            pages[role] = page
            page.on("pageerror", lambda error, role=role: errors[role].append(str(error)))
            page.on("console", lambda message, role=role: logs[role].append({"type": message.type, "text": message.text}))
            page.add_init_script(
                f"window.__gomokuRelayRole = {json.dumps(role)}; "
                f"window.__gomokuRelayClientId = {json.dumps(role)}; "
                "try { Object.defineProperty(window, 'RTCPeerConnection', { configurable: true, value: undefined }); } catch (_) {} "
                "try { Object.defineProperty(window, 'webkitRTCPeerConnection', { configurable: true, value: undefined }); } catch (_) {}"
            )
            page.add_init_script(MOCK_RELAY_INIT)
            page.goto(url, wait_until="domcontentloaded", timeout=30_000)
            try:
                page.wait_for_load_state("networkidle", timeout=15_000)
            except PlaywrightTimeoutError:
                pass
            page.locator("#cvs").wait_for(state="visible", timeout=10_000)

        pages["host"].evaluate("code => window.initHostPeer(code, true)", room)
        pages["guest"].evaluate("code => window.joinOnlineRoom(code)", room)

        def state(page):
            return page.evaluate(
                """
                () => ({
                  mode: gameMode,
                  room: currentRoomCode,
                  conn: conn ? {
                    open: conn.open,
                    ready: conn.ready,
                    transportType: conn.client?.transportType || '',
                    relay: conn.client?.transportType === 'relay'
                  } : null,
                  notice: document.querySelector('#gameNoticeToast')?.textContent?.trim() || ''
                })
                """
            )

        deadline = time.time() + 12
        states = {}
        while time.time() < deadline:
            states = {role: state(page) for role, page in pages.items()}
            if all(item["mode"] == "online" and item["conn"] and item["conn"]["ready"] and item["conn"]["relay"]
                   for item in states.values()):
                break
            pages["guest"].wait_for_timeout(250)
        if not all(item["mode"] == "online" and item["conn"] and item["conn"]["ready"] and item["conn"]["relay"]
                   for item in states.values()):
            raise AssertionError(json.dumps({"states": states, "errors": errors, "logs": logs}, ensure_ascii=False))
        dropped_confirmations = pages["host"].evaluate("window.__gomokuDroppedJoinConfirmations || 0")
        if dropped_confirmations < 3:
            raise AssertionError(f"join-confirmation loss simulation did not run: {dropped_confirmations}")

        pages["host"].evaluate("window.makeMove(7, 7, BLACK)")
        pages["guest"].wait_for_function("board[7][7] === BLACK", timeout=5_000)
        pages["guest"].evaluate("window.makeMove(7, 8, WHITE)")
        pages["host"].wait_for_function("board[7][8] === WHITE", timeout=5_000)
        pages["host"].evaluate("window.sendChat('自有中继可靠聊天测试')")
        pages["guest"].wait_for_timeout(500)
        chat_count = pages["guest"].evaluate(
            "() => chatHistory.filter(item => item.sender === 2 && item.text === '自有中继可靠聊天测试').length"
        )
        if chat_count != 1:
            raise AssertionError(f"relay chat count={chat_count}")

        print(json.dumps({
            "pass": True,
            "room": room,
            "transport": "durable_object_relay_mock",
            "states": states,
            "bidirectionalMoves": True,
            "reliableChatExactlyOnce": chat_count == 1,
            "recoveredFromDroppedJoinConfirmations": dropped_confirmations,
            "pageErrors": errors,
        }, ensure_ascii=False, indent=2))
        browser.close()


if __name__ == "__main__":
    main()
