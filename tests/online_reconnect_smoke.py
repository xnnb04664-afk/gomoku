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
            page.wait_for_selector("#skyLobby", state="visible", timeout=15_000)
            page.wait_for_function("() => typeof window.SkyIslandUI?.showGame === 'function'", timeout=10_000)
            page.evaluate("() => window.SkyIslandUI.showGame()")
            page.locator("#cvs").wait_for(state="visible", timeout=10_000)
            page.evaluate("() => window.ensureGomokuFeature('online')")
            page.wait_for_function("() => window.__GOMOKU_ONLINE_READY__ === true", timeout=30_000)

        try:
            host.evaluate("code => window.initHostPeer(code, true)", room)
            guest.evaluate("code => window.joinOnlineRoom(code)", room)

            def state(page):
                return page.evaluate(
                    """
                    () => ({
                      mode: gameMode,
                      room: currentRoomCode,
                      round: onlineRoundId,
                      reconnecting: isReconnecting,
                      conn: conn ? {
                        open: conn.open,
                        ready: conn.ready,
                        mqtt: Boolean(conn.client && conn.client.connected),
                        p2p: Boolean(conn.isP2pReady)
                      } : null,
                      historyLength: history.length,
                      network: document.querySelector('#onlineNetworkStatusBar')?.textContent?.trim() || '',
                      notice: document.querySelector('#gameNoticeToast')?.textContent?.trim() || ''
                    })
                    """
                )

            deadline = time.time() + 24
            initial = {}
            while time.time() < deadline:
                initial = {"host": state(host), "guest": state(guest)}
                if all(
                    item["mode"] == "online" and item["conn"] and item["conn"]["open"] and item["conn"]["ready"]
                    for item in initial.values()
                ):
                    break
                host.wait_for_timeout(500)
            if not all(
                item["mode"] == "online" and item["conn"] and item["conn"]["open"] and item["conn"]["ready"]
                for item in initial.values()
            ):
                raise AssertionError(json.dumps({"phase": "initial_join", **initial, "errors": errors}, ensure_ascii=False))

            initial_persisted = guest.evaluate(
                """
                () => {
                  const saved = JSON.parse(localStorage.getItem('gomoku_active_online_room') || '{}');
                  return {
                    liveSessionId: onlineSessionId,
                    savedSessionId: saved.sessionId,
                    savedRoundId: saved.roundId,
                    savedHistoryLength: Array.isArray(saved.history) ? saved.history.length : -1
                  };
                }
                """
            )
            if (not initial_persisted["liveSessionId"] or
                    initial_persisted["savedSessionId"] != initial_persisted["liveSessionId"] or
                    initial_persisted["savedRoundId"] != initial["guest"]["round"] or
                    initial_persisted["savedHistoryLength"] != 0):
                raise AssertionError(json.dumps({"phase": "persist_on_join", **initial_persisted}, ensure_ascii=False))

            round_before = initial["guest"]["round"]
            host.evaluate("window.makeMove(7, 7, BLACK)")
            guest.wait_for_function("board[7][7] === BLACK", timeout=5_000)

            guest.evaluate(
                """
                () => {
                  if (typeof window.__gomokuNativeNetworkChanged !== 'function') {
                    throw new Error('network handoff hook unavailable');
                  }
                  // 模拟 Android ConnectivityManager 在 WiFi→蜂窝数据切换时的回调。
                  window.__gomokuNativeNetworkChanged('smoke_wifi_to_cellular', 'smoke-cellular');
                }
                """
            )

            deadline = time.time() + 18
            recovered = {}
            while time.time() < deadline:
                recovered = {"host": state(host), "guest": state(guest)}
                if all(
                    item["mode"] == "online" and item["conn"] and item["conn"]["open"] and item["conn"]["ready"]
                    and not item["reconnecting"] and item["historyLength"] == 1
                    for item in recovered.values()
                ):
                    break
                host.wait_for_timeout(500)
            if not all(
                item["mode"] == "online" and item["conn"] and item["conn"]["open"] and item["conn"]["ready"]
                and not item["reconnecting"] and item["historyLength"] == 1
                for item in recovered.values()
            ):
                raise AssertionError(json.dumps({"phase": "reconnect", **recovered, "logs": logs, "errors": errors}, ensure_ascii=False))

            if recovered["guest"]["round"] != round_before:
                raise AssertionError(f"round changed during reconnect: {round_before} -> {recovered['guest']['round']}")

            guest.evaluate("window.makeMove(7, 8, WHITE)")
            host.wait_for_function("board[7][8] === WHITE", timeout=5_000)
            guest.evaluate("sendChat('重连后可靠聊天测试')")
            host.wait_for_timeout(700)
            chat_count = host.evaluate(
                "() => chatHistory.filter(item => item.sender === 2 && item.text === '重连后可靠聊天测试').length"
            )
            if chat_count != 1:
                raise AssertionError(f"post-reconnect chat was not delivered exactly once: {chat_count}")

            # Android WebView may be destroyed while the emulator/app is backgrounded.
            # A full page reload must retain the room identity, not merely its six-digit code.
            persisted = guest.evaluate(
                """
                () => {
                  persistGameState();
                  const saved = JSON.parse(localStorage.getItem('gomoku_active_online_room') || '{}');
                  return {
                    liveSessionId: onlineSessionId,
                    savedSessionId: saved.sessionId,
                    savedRoundId: saved.roundId,
                    savedJoinTicket: saved.joinTicket
                  };
                }
                """
            )
            if not persisted["liveSessionId"] or persisted["savedSessionId"] != persisted["liveSessionId"]:
                raise AssertionError(json.dumps({"phase": "persist_room_identity", **persisted}, ensure_ascii=False))

            guest.reload(wait_until="domcontentloaded", timeout=30_000)
            try:
                guest.wait_for_load_state("networkidle", timeout=15_000)
            except PlaywrightTimeoutError:
                pass
            guest.wait_for_selector("#skyLobby", state="visible", timeout=15_000)
            guest.wait_for_function("() => typeof window.SkyIslandUI?.showGame === 'function'", timeout=10_000)
            guest.evaluate("() => window.SkyIslandUI.showGame()")
            guest.locator("#cvs").wait_for(state="visible", timeout=10_000)
            # Reproduce the real mobile race: the surviving host has already
            # discarded its old v4 game channel before the reloaded guest's
            # delayed reconnect handshake arrives. The guest must also announce
            # itself on the host's v3 admission channel.
            host.evaluate("triggerOnlineReconnect('smoke simultaneous page reload')")

            deadline = time.time() + 20
            reloaded = {}
            while time.time() < deadline:
                reloaded = {"host": state(host), "guest": state(guest)}
                if all(
                    item["mode"] == "online" and item["conn"] and item["conn"]["open"] and item["conn"]["ready"]
                    and not item["reconnecting"] and item["historyLength"] == 2
                    for item in reloaded.values()
                ):
                    break
                host.wait_for_timeout(500)
            if not all(
                item["mode"] == "online" and item["conn"] and item["conn"]["open"] and item["conn"]["ready"]
                and not item["reconnecting"] and item["historyLength"] == 2
                for item in reloaded.values()
            ):
                raise AssertionError(json.dumps({"phase": "page_reload_reconnect", **reloaded, "persisted": persisted, "logs": logs, "errors": errors}, ensure_ascii=False))
            if reloaded["guest"]["round"] != round_before:
                raise AssertionError(f"round changed during page reload: {round_before} -> {reloaded['guest']['round']}")

            if any(errors.values()):
                raise AssertionError(json.dumps({"phase": "browser_errors", "errors": errors, "logs": logs}, ensure_ascii=False))

            print(json.dumps({
                "pass": True,
                "room": room,
                "initial": initial,
                "roomIdentityPersistedOnJoin": True,
                "recovered": recovered,
                "pageReloadRecovered": reloaded,
                "roomIdentityPersisted": True,
                "postReconnectMove": True,
                "postReconnectChatExactlyOnce": chat_count == 1,
                "pageErrors": errors
            }, ensure_ascii=False, indent=2))
        finally:
            browser.close()


if __name__ == "__main__":
    main()
