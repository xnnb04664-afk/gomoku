import json
import os
import time

from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeoutError

from online_match_race_smoke import MOCK_MQTT_INIT


def main():
    import sys
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    room = str(int(time.time() * 1000) % 900000 + 100000)
    url = os.environ.get("GOMOKU_TEST_URL", "http://127.0.0.1:3000/index.html")
    logs = {"host": [], "guest": []}
    errors = {"host": [], "guest": []}

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        context = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=1)
        host = context.new_page()
        guest = context.new_page()

        for name, page in (("host", host), ("guest", guest)):
            page.add_init_script(
                f"window.__gomokuMockRole = {json.dumps(name)}; "
                f"window.__gomokuMockClientId = {json.dumps(name)}; "
                "window.__GOMOKU_DISABLE_RELAY__ = true; "
                "window.__GOMOKU_ENABLE_LEGACY_MQTT__ = true;"
            )
            page.add_init_script(MOCK_MQTT_INIT)
            page.route("**/js/mqtt.min.js", lambda route: route.fulfill(status=200, content_type="application/javascript", body="window.mqtt = window.__gomokuMockMqtt;"))
            page.on("console", lambda message, name=name: logs[name].append({"type": message.type, "text": message.text}))
            page.on("pageerror", lambda error, name=name: errors[name].append(str(error)))
            page.goto(url, wait_until="domcontentloaded", timeout=30_000)
            try:
                page.wait_for_load_state("networkidle", timeout=15_000)
            except PlaywrightTimeoutError:
                pass
            page.locator("#cvs").wait_for(state="visible", timeout=10_000)

        host.evaluate("code => window.initHostPeer(code, true)", room)
        guest.evaluate("code => window.joinOnlineRoom(code)", room)
        guest.wait_for_timeout(18_000)

        def state(page):
            return page.evaluate(
                """
                () => ({
                  room: currentRoomCode,
                  mode: gameMode,
                  round: onlineRoundId,
                  color: myOnlineColor,
                  conn: conn ? {
                    open: conn.open,
                    ready: conn.ready,
                    clientConnected: Boolean(conn.client && conn.client.connected),
                    p2p: Boolean(conn.isP2pReady)
                  } : null,
                  hostBinding: Boolean(hostInviteBinding),
                  roomBadge: document.querySelector('#roomStatusBadge')?.textContent?.trim() || '',
                  notice: document.querySelector('#gameNoticeToast')?.textContent?.trim() || '',
                  network: document.querySelector('#onlineNetworkStatusBar')?.textContent?.trim() || '',
                  telemetry: {
                    localLatencyMs: onlineNetworkTelemetry.localLatencyMs,
                    remoteLatencyMs: onlineNetworkTelemetry.remoteLatencyMs,
                    remoteLastSeenAt: onlineNetworkTelemetry.remoteLastSeenAt,
                    pendingPings: pendingOnlinePings.size,
                    heartbeatActive: Boolean(onlineHeartbeatTimer)
                  }
                })
                """
            )

        host_state = state(host)
        guest_state = state(guest)
        latency_ok = all(
            isinstance(item["telemetry"]["localLatencyMs"], (int, float)) and
            isinstance(item["telemetry"]["remoteLatencyMs"], (int, float))
            for item in (host_state, guest_state)
        )
        if not all(item["mode"] == "online" and item["conn"] and item["conn"]["open"] and item["conn"]["ready"]
                   for item in (host_state, guest_state)):
            raise AssertionError(json.dumps({"host": host_state, "guest": guest_state, "logs": logs, "errors": errors}, ensure_ascii=False))
        if not latency_ok:
            raise AssertionError(json.dumps({"host": host_state, "guest": guest_state}, ensure_ascii=False))

        host_sent_at = host.evaluate("Date.now()")
        host.evaluate("window.makeMove(7, 7, BLACK)")
        guest.wait_for_function("board[7][7] === BLACK", timeout=5_000)
        host_to_guest_latency_ms = guest.evaluate(f"Date.now() - {host_sent_at}")
        guest_move = guest.evaluate("({ piece: board[7][7], steps: history.length, turn })")
        if guest_move != {"piece": 1, "steps": 1, "turn": 2}:
            raise AssertionError(f"host move did not reach guest: {guest_move}")

        host.evaluate("sendChat('可靠传输聊天测试')")
        guest.wait_for_timeout(700)
        guest_chat_count = guest.evaluate(
            "() => chatHistory.filter(item => item.sender === 2 && item.text === '可靠传输聊天测试').length"
        )
        if guest_chat_count != 1:
            raise AssertionError(f"chat was not delivered exactly once: {guest_chat_count}")

        guest_sent_at = guest.evaluate("Date.now()")
        guest.evaluate("window.makeMove(7, 8, WHITE)")
        host.wait_for_function("board[7][8] === WHITE", timeout=5_000)
        guest_to_host_latency_ms = host.evaluate(f"Date.now() - {guest_sent_at}")
        host_move = host.evaluate("({ piece: board[7][8], steps: history.length, turn })")
        if host_move != {"piece": 2, "steps": 2, "turn": 1}:
            raise AssertionError(f"guest move did not reach host: {host_move}")

        print(json.dumps({
            "pass": True,
            "room": room,
            "host": host_state,
            "guest": guest_state,
            "latencyVisible": latency_ok,
            "moveLatencyMs": {
                "hostToGuest": round(host_to_guest_latency_ms, 1),
                "guestToHost": round(guest_to_host_latency_ms, 1)
            },
            "bidirectionalMoves": True,
            "reliableChatExactlyOnce": guest_chat_count == 1,
            "pageErrors": errors,
        }, ensure_ascii=False, indent=2))
        browser.close()


if __name__ == "__main__":
    main()
