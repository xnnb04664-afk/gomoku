import json
import os
import time

from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeoutError

from online_relay_test_support import install_local_relay_mocks


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
            install_local_relay_mocks(page, name)
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
                      // online.js keeps the reconnect flag module-scoped; use the
                      // visible overlay as a public diagnostic fallback so this
                      // smoke test does not depend on a private lexical binding.
                      reconnecting: typeof isReconnecting !== 'undefined'
                        ? isReconnecting
                        : Boolean(document.querySelector('#onlineReconnectModal.show')),
                      conn: conn ? {
                        open: conn.open,
                        ready: conn.ready,
                        relayConnected: Boolean(conn.client && conn.client.connected),
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
                  const ownerUid = getCurrentGameOwnerUid();
                  const storageKey = getOnlineRoomStorageKey(ownerUid);
                  const expectedStorageKey = `gomoku_active_online_room_v1_${encodeURIComponent(ownerUid || 'guest')}`;
                  const saved = JSON.parse(localStorage.getItem(storageKey) || '{}');
                  return {
                    ownerUid,
                    storageKey,
                    expectedStorageKey,
                    liveSessionId: onlineSessionId,
                    savedSessionId: saved.sessionId,
                    savedRoundId: saved.roundId,
                    savedOwnerUid: saved.ownerUid,
                    savedHistoryLength: Array.isArray(saved.history) ? saved.history.length : -1
                  };
                }
                """
            )
            if (initial_persisted["storageKey"] != initial_persisted["expectedStorageKey"] or
                    not initial_persisted["ownerUid"] or
                    initial_persisted["savedOwnerUid"] != initial_persisted["ownerUid"] or
                    not initial_persisted["liveSessionId"] or
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
                  const ownerUid = getCurrentGameOwnerUid();
                  const storageKey = getOnlineRoomStorageKey(ownerUid);
                  const expectedStorageKey = `gomoku_active_online_room_v1_${encodeURIComponent(ownerUid || 'guest')}`;
                  const saved = JSON.parse(localStorage.getItem(storageKey) || '{}');
                  return {
                    ownerUid,
                    storageKey,
                    expectedStorageKey,
                    liveSessionId: onlineSessionId,
                    savedSessionId: saved.sessionId,
                    savedRoundId: saved.roundId,
                    savedOwnerUid: saved.ownerUid,
                    savedJoinTicket: saved.joinTicket
                  };
                }
                """
            )
            if (persisted["storageKey"] != persisted["expectedStorageKey"] or
                    not persisted["ownerUid"] or
                    persisted["savedOwnerUid"] != persisted["ownerUid"] or
                    not persisted["liveSessionId"] or
                    persisted["savedSessionId"] != persisted["liveSessionId"]):
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

            # Complete a genuine winning line, then lose the transport while the
            # finished room is retained for a rematch.
            for index in range(4):
                row = 8 + index
                host.evaluate("row => window.makeMove(row, 7, BLACK)", row)
                guest.wait_for_function("row => board[row][7] === BLACK", arg=row, timeout=5_000)
                if index < 3:
                    guest.evaluate("row => window.makeMove(row, 8, WHITE)", row)
                    host.wait_for_function("row => board[row][8] === WHITE", arg=row, timeout=5_000)
            for page in (host, guest):
                page.wait_for_function("isOver && gameWinnerColor === BLACK && history.length === 9", timeout=5_000)
            finished_boards = [page.evaluate("JSON.stringify(board)") for page in (host, guest)]
            previous_connections = guest.evaluate("window.__gomokuMockRelayStats.connections")
            guest.evaluate("conn.client.ws.close(1001, 'smoke finished-room transport loss')")
            try:
                guest.wait_for_function(
                    "previous => window.__gomokuMockRelayStats.connections > previous && conn?.open && conn?.ready",
                    arg=previous_connections, timeout=20_000,
                )
            except PlaywrightTimeoutError:
                raise AssertionError(json.dumps({
                    "phase": "finished_room_transport_reconnect", "host": state(host), "guest": state(guest),
                    "previousConnections": previous_connections,
                    "guestMockStats": guest.evaluate("window.__gomokuMockRelayStats"), "logs": logs, "errors": errors,
                }, ensure_ascii=False))
            host.wait_for_function("conn?.open && conn?.ready", timeout=20_000)
            for index, page in enumerate((host, guest)):
                finished = page.evaluate("({over:isOver,winner:gameWinnerColor,round:onlineRoundId,steps:history.length,board:JSON.stringify(board)})")
                if (not finished["over"] or finished["winner"] != 1 or finished["steps"] != 9
                        or finished["round"] != round_before or finished["board"] != finished_boards[index]):
                    raise AssertionError(json.dumps({"phase": "finished_room_reconnect", "state": finished}, ensure_ascii=False))

            # Hold the final commit acknowledgment to prove that neither board
            # clears merely because the responder clicked Agree.
            host.evaluate("""() => {
              window.__rematchOriginalTransmit = conn._transmitMessage;
              conn._transmitMessage = function(message, ...args) {
                if (message.type === 'restart_commit_ack') {
                  window.__heldRematchCommitAck = message;
                  return true;
                }
                return window.__rematchOriginalTransmit.call(this, message, ...args);
              };
            }""")
            guest.evaluate("document.getElementById('btnRestart').onclick()")
            host.wait_for_function("document.getElementById('customConfirmModal').classList.contains('show')", timeout=5_000)
            host.evaluate("closeCustomConfirm(true)")
            host.wait_for_function("Boolean(window.__heldRematchCommitAck)", timeout=5_000)
            for page in (host, guest):
                retained = page.evaluate("({over:isOver,steps:history.length,round:onlineRoundId})")
                if not retained["over"] or retained["steps"] != 9 or retained["round"] != round_before:
                    raise AssertionError(json.dumps({"phase": "rematch_before_commit", "state": retained}, ensure_ascii=False))
            host.evaluate("""() => {
              conn._transmitMessage = window.__rematchOriginalTransmit;
              conn._transmitMessage(window.__heldRematchCommitAck);
            }""")
            for page in (host, guest):
                page.wait_for_function("!isOver && history.length === 0 && !pendingOnlineRestartState && !activeOnlineRestartState", timeout=5_000)
            rematch_rounds = [page.evaluate("onlineRoundId") for page in (host, guest)]
            if not rematch_rounds[0] or rematch_rounds[0] == round_before or rematch_rounds[0] != rematch_rounds[1]:
                raise AssertionError(f"rematch rounds did not agree: {rematch_rounds}")
            host.evaluate("window.makeMove(7, 7, BLACK)")
            guest.wait_for_function("board[7][7] === BLACK", timeout=5_000)

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
                "finishedRoomReconnectedWithoutClearingResult": True,
                "rematchRetainsBoardUntilCommit": True,
                "rematchRoundAgreed": True,
                "postRematchMove": True,
                "transport": "local WebSocket relay mock",
                "mqttCompatibilityAdapterUsed": False,
                "pageErrors": errors
            }, ensure_ascii=False, indent=2))
        finally:
            browser.close()


if __name__ == "__main__":
    main()
