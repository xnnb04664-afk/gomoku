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
        host.add_init_script("window.__GOMOKU_DISABLE_RELAY__ = true; window.__GOMOKU_ENABLE_LEGACY_MQTT__ = true;")
        guest.add_init_script("window.__GOMOKU_DISABLE_RELAY__ = true; window.__GOMOKU_ENABLE_LEGACY_MQTT__ = true;")

        try:
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
                page.evaluate("() => window.SkyIslandUI?.showGame()")
                page.locator("#cvs").wait_for(state="visible", timeout=10_000)
                page.evaluate("() => window.ensureGomokuFeature('online')")
                page.wait_for_function("() => window.__GOMOKU_ONLINE_READY__ === true", timeout=30_000)

            host.evaluate("code => window.initHostPeer(code, true)", room)
            guest.evaluate("code => window.joinOnlineRoom(code)", room)

            def state(page):
                return page.evaluate(
                    """
                    () => ({
                      mode: gameMode,
                      room: currentRoomCode,
                      conn: conn ? {
                        open: conn.open,
                        ready: conn.ready,
                        mqtt: Boolean(conn.client && conn.client.connected),
                        p2p: Boolean(conn.isP2pReady),
                        dc: conn.dc ? conn.dc.readyState : null,
                        pc: conn.pc ? conn.pc.connectionState : null,
                        ice: conn.pc ? conn.pc.iceConnectionState : null,
                        recoveryAttempts: conn.p2pRecoveryAttempts
                      } : null,
                      network: document.querySelector('#onlineNetworkStatusBar')?.textContent?.trim() || '',
                      latency: {
                        local: onlineNetworkTelemetry.localLatencyMs,
                        remote: onlineNetworkTelemetry.remoteLatencyMs
                      }
                    })
                    """
                )

            deadline = time.time() + 24
            initial_states = {}
            while time.time() < deadline:
                initial_states = {"host": state(host), "guest": state(guest)}
                if all(
                    item["mode"] == "online" and item["conn"] and item["conn"]["open"] and
                    item["conn"]["ready"] and item["conn"]["p2p"]
                    for item in initial_states.values()
                ):
                    break
                host.wait_for_timeout(500)
            if not all(
                item["mode"] == "online" and item["conn"] and item["conn"]["open"] and
                item["conn"]["ready"] and item["conn"]["p2p"]
                for item in initial_states.values()
            ):
                raise AssertionError(json.dumps({"phase": "initial_p2p", **initial_states, "logs": logs, "errors": errors}, ensure_ascii=False))

            host.evaluate("window.makeMove(7, 7, BLACK)")
            guest.wait_for_timeout(500)
            first_move = guest.evaluate("({ piece: board[7][7], steps: history.length, turn })")
            if first_move != {"piece": 1, "steps": 1, "turn": 2}:
                raise AssertionError(f"initial P2P move did not arrive: {first_move}")

            host.evaluate(
                """
                () => {
                  if (!conn || !conn.dc || conn.dc.readyState !== 'open') throw new Error('P2P DataChannel is not open');
                  conn.dc.close();
                }
                """
            )
            host.wait_for_timeout(700)
            degraded_states = {"host": state(host), "guest": state(guest)}
            if any(item["conn"] and item["conn"]["p2p"] for item in degraded_states.values()):
                # The peer may receive the close event a little later; allow the recovery
                # coordinator to observe the half-open channel before continuing.
                host.wait_for_timeout(1800)
                degraded_states = {"host": state(host), "guest": state(guest)}
            if any(item["conn"] and item["conn"]["p2p"] for item in degraded_states.values()):
                raise AssertionError(json.dumps({"phase": "close_detection", **degraded_states}, ensure_ascii=False))

            guest.evaluate("window.makeMove(7, 8, WHITE)")
            host.wait_for_timeout(900)
            fallback_move = host.evaluate("({ piece: board[7][8], steps: history.length, turn })")
            if fallback_move != {"piece": 2, "steps": 2, "turn": 1}:
                raise AssertionError(f"MQTT fallback move did not arrive after P2P close: {fallback_move}")

            recovered_states = degraded_states
            deadline = time.time() + 24
            while time.time() < deadline:
                recovered_states = {"host": state(host), "guest": state(guest)}
                if all(item["conn"] and item["conn"]["p2p"] for item in recovered_states.values()):
                    break
                host.wait_for_timeout(500)
            if not all(item["conn"] and item["conn"]["p2p"] for item in recovered_states.values()):
                raise AssertionError(json.dumps({"phase": "p2p_recovery", **recovered_states, "logs": logs, "errors": errors}, ensure_ascii=False))

            host.evaluate("window.makeMove(7, 9, BLACK)")
            guest.wait_for_timeout(700)
            recovered_move = guest.evaluate("({ piece: board[7][9], steps: history.length, turn })")
            if recovered_move != {"piece": 1, "steps": 3, "turn": 2}:
                raise AssertionError(f"post-recovery P2P move did not arrive: {recovered_move}")

            if any(errors.values()):
                raise AssertionError(json.dumps({"phase": "browser_errors", "errors": errors, "logs": logs}, ensure_ascii=False))

            print(json.dumps({
                "pass": True,
                "room": room,
                "initial": initial_states,
                "degraded": degraded_states,
                "recovered": recovered_states,
                "fallbackMove": fallback_move,
                "recoveredMove": recovered_move,
                "pageErrors": errors
            }, ensure_ascii=False, indent=2))
        finally:
            browser.close()


if __name__ == "__main__":
    main()
