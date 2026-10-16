import json
import os

from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeoutError
from online_relay_test_support import TEST_ACCOUNTS, install_local_relay_mocks


def main():
    import sys
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")

    url = os.environ.get("GOMOKU_TEST_URL", "http://127.0.0.1:3000/index.html")
    room = "741852"
    output = {}

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        context = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=1)
        pages = {}
        for role in ("host", "guest"):
            page = context.new_page()
            pages[role] = page
            page_errors = []
            console_logs = []
            console_errors = []
            page.on("pageerror", lambda error, errors=page_errors: errors.append(str(error)))
            page.on("console", lambda message, logs=console_logs, errors=console_errors: (logs.append({"type": message.type, "text": message.text}), errors.append(message.text) if message.type == "error" else None))
            install_local_relay_mocks(
                page,
                role,
                open_delay_ms=850 if role == "guest" else 0,
                disable_p2p=True,
            )
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
            output[role] = {"pageErrors": page_errors, "consoleErrors": console_errors, "consoleLogs": console_logs}

        # 开房与加入都从大厅首页开始；握手完成后双方必须真正切到棋盘。
        pages["guest"].evaluate("() => openOnlineModal('join')")
        pages["guest"].locator("#inputJoinCode").fill("123456")
        pages["guest"].locator("#btnJoinRoomCancel").click()
        if pages["guest"].locator("#inputJoinCode").input_value() != "":
            raise AssertionError("the clear-room-code button did not clear an incorrect room number")
        pages["guest"].evaluate("() => closeOnlineModal()")
        for page in pages.values():
            page.evaluate("() => window.SkyIslandUI?.showLobby()")
        pages["host"].evaluate("code => { void window.initHostPeer(code, true).catch(error => console.error(error)); }", room)
        pages["guest"].evaluate("code => { void window.joinOnlineRoom(code).catch(error => console.error(error)); }", room)
        pages["host"].wait_for_timeout(250)

        pending_states = {
            role: page.evaluate(
                "() => ({ mode: gameMode, p2: document.querySelector('#p2NameLabel')?.textContent || '', p2AccountName: p2Name, badge: document.querySelector('#roomStatusBadge')?.textContent?.trim() || '' })"
            )
            for role, page in pages.items()
        }
        if any(state["mode"] != "ai" for state in pending_states.values()):
            raise AssertionError(f"a room must not enter online mode before both sides confirm readiness: {pending_states}")
        if pending_states["host"]["p2AccountName"] == TEST_ACCOUNTS["guest"]["username"]:
            raise AssertionError(f"host displayed a guest before join confirmation: {pending_states}")
        pages["guest"].wait_for_timeout(2_500)

        for role, page in pages.items():
            output[role]["state"] = page.evaluate(
                """
                () => ({
                  mode: gameMode,
                  room: currentRoomCode,
                  conn: conn ? { open: conn.open, ready: conn.ready, broker: conn.client?.url || '' } : null,
                  lobbyHidden: document.getElementById('skyLobby')?.hidden === true,
                  gameOpen: document.body.classList.contains('sky-game-open'),
                  notice: document.querySelector('#gameNoticeToast')?.textContent?.trim() || '',
                  badge: document.querySelector('#roomStatusBadge')?.textContent?.trim() || '',
                  acceptedTimes: window.__gomokuMockAcceptedTimes || []
                })
                """
            )
        host_state = output["host"]["state"]
        guest_state = output["guest"]["state"]
        if not all(state["mode"] == "online" and state["conn"] and state["conn"]["open"] and state["conn"]["ready"]
                   for state in (host_state, guest_state)):
            raise AssertionError(json.dumps(output, ensure_ascii=False))
        if not all(state["lobbyHidden"] and state["gameOpen"] for state in (host_state, guest_state)):
            raise AssertionError(f"room join did not transition both players from the lobby to the board: {output}")
        color_state = {
            "host": pages["host"].evaluate(
                "({ myColor: myOnlineColor, p1: document.querySelector('#p1NameLabel')?.textContent || '', p2: document.querySelector('#p2NameLabel')?.textContent || '' })"
            ),
            "guest": pages["guest"].evaluate(
                "({ myColor: myOnlineColor, p1: document.querySelector('#p1NameLabel')?.textContent || '', p2: document.querySelector('#p2NameLabel')?.textContent || '' })"
            )
        }
        if color_state["host"]["myColor"] != 1 or color_state["guest"]["myColor"] != 2:
            raise AssertionError(f"online colors were not assigned deterministically: {color_state}")
        if '黑子' not in color_state['host']['p1'] or '白子' not in color_state['host']['p2']:
            raise AssertionError(f"host labels are inconsistent: {color_state}")
        if '白子' not in color_state['guest']['p1'] or '黑子' not in color_state['guest']['p2']:
            raise AssertionError(f"guest labels are inconsistent: {color_state}")
        accepted_times = host_state.get("acceptedTimes") or []
        if not accepted_times:
            raise AssertionError("host did not send join_accepted after its room connection became ready")

        pages["host"].evaluate("window.makeMove(7, 7, BLACK)")
        pages["guest"].wait_for_timeout(250)
        guest_move = pages["guest"].evaluate("({ piece: board[7][7], steps: history.length, turn })")
        if guest_move != {"piece": 1, "steps": 1, "turn": 2}:
            raise AssertionError(f"host move did not reach guest: {guest_move}")

        pages["host"].evaluate("sendChat('WebSocket中继可靠聊天测试')")
        pages["guest"].wait_for_timeout(300)
        guest_chat_count = pages["guest"].evaluate(
            "() => chatHistory.filter(item => item.sender === 2 && item.text === 'WebSocket中继可靠聊天测试').length"
        )
        if guest_chat_count != 1:
            raise AssertionError(f"WebSocket relay chat was not delivered exactly once: {guest_chat_count}")

        pages["guest"].evaluate("window.makeMove(7, 8, WHITE)")
        pages["host"].wait_for_timeout(250)
        host_move = pages["host"].evaluate("({ piece: board[7][8], steps: history.length, turn })")
        if host_move != {"piece": 2, "steps": 2, "turn": 1}:
            raise AssertionError(f"guest move did not reach host: {host_move}")

        print(json.dumps({
            "pass": True,
            "host": host_state,
            "guest": guest_state,
            "transport": "local WebSocket relay mock",
            "mqttCompatibilityAdapterUsed": False,
            "colorAssignment": color_state,
            "bidirectionalMoves": True,
            "reliableChatExactlyOnce": guest_chat_count == 1,
            "pageErrors": {role: output[role]["pageErrors"] for role in output},
            "consoleErrors": {role: output[role]["consoleErrors"] for role in output},
        }, ensure_ascii=False, indent=2))
        browser.close()


if __name__ == "__main__":
    main()
