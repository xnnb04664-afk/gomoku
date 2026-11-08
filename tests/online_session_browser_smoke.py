"""Browser acceptance for P2P session stability and explicit peer-exit handling.

Uses two real Chromium pages and native WebRTC, with only the room WebSocket
relay/API replaced by the deterministic local fixture in
``online_relay_test_support``. No production account or service is contacted.
"""

from __future__ import annotations

import json
import os
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

from online_relay_test_support import install_local_relay_mocks


ROOT = Path(__file__).resolve().parents[1]
DIAGNOSTICS = ROOT / ".codex-diagnostics" / "online-session-20261108"


def wait_for_online(page, role: str, room: str) -> None:
    install_local_relay_mocks(page, role)
    page.goto(os.environ.get("GOMOKU_TEST_URL", "http://127.0.0.1:4191/index.html"),
              wait_until="domcontentloaded", timeout=30_000)
    # Do not wait for networkidle: analytics/long-lived app requests may keep it open.
    page.wait_for_selector("#skyLobby", state="visible", timeout=20_000)
    page.wait_for_function("() => typeof window.SkyIslandUI?.showGame === 'function'", timeout=10_000)
    page.evaluate("() => window.SkyIslandUI.showGame()")
    page.locator("#cvs").wait_for(state="visible", timeout=10_000)
    page.evaluate("() => window.ensureGomokuFeature('online')")
    page.wait_for_function("() => window.__GOMOKU_ONLINE_READY__ === true", timeout=30_000)


def read_state(page):
    return page.evaluate(
        """() => ({
          mode: gameMode,
          room: currentRoomCode,
          round: onlineRoundId,
          moves: history.length,
          board: JSON.stringify(board),
          conn: conn ? {
            open: conn.open,
            ready: conn.ready,
            p2p: Boolean(conn.isP2pReady),
            channel: conn.dc?.readyState || null,
            pc: conn.pc?.connectionState || null,
            relayConnected: Boolean(conn.client?.connected),
            sessionId: onlineSessionId,
            recoveryAttempts: conn.p2pRecoveryAttempts || 0
          } : null,
          reconnectVisible: Boolean(document.querySelector('#onlineReconnectModal.show')),
          reconnectTitle: document.querySelector('#reconnectTitle')?.textContent?.trim() || '',
          reconnectText: document.querySelector('#reconnectStatusText')?.textContent?.trim() || '',
          notice: document.querySelector('#gameNoticeToast')?.textContent?.trim() || ''
        })"""
    )


def wait_for_pair(host, guest, predicate, timeout_s=30):
    deadline = time.time() + timeout_s
    states = {}
    while time.time() < deadline:
        states = {"host": read_state(host), "guest": read_state(guest)}
        if predicate(states):
            return states
        host.wait_for_timeout(250)
    raise AssertionError(json.dumps({"phase": "wait_for_pair", "states": states}, ensure_ascii=False))


def main():
    import sys

    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    DIAGNOSTICS.mkdir(parents=True, exist_ok=True)
    room = str(int(time.time() * 1000) % 900_000 + 100_000)
    errors = {"host": [], "guest": []}
    console_errors = {"host": [], "guest": []}
    result = {"room": room, "transport": "native Chromium WebRTC + local WebSocket relay mock"}

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        context = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=1)
        host, guest = context.new_page(), context.new_page()
        for role, page in (("host", host), ("guest", guest)):
            page.on("pageerror", lambda error, role=role: errors[role].append(str(error)))
            page.on("console", lambda message, role=role: console_errors[role].append(message.text)
                    if message.type == "error" else None)
            wait_for_online(page, role, room)

        try:
            host.evaluate("code => window.initHostPeer(code, true)", room)
            guest.evaluate("code => window.joinOnlineRoom(code)", room)
            initial = wait_for_pair(
                host, guest,
                lambda states: all(s["mode"] == "online" and s["conn"] and s["conn"]["open"]
                                   and s["conn"]["ready"] and s["conn"]["p2p"]
                                   and s["conn"]["channel"] == "open" for s in states.values()),
            )
            result["initialP2P"] = initial

            # Feed repeated high-RTT samples through the live P2P policy handler.
            before = {role: {"attempts": state["conn"]["recoveryAttempts"],
                             "channel": state["conn"]["channel"], "pc": state["conn"]["pc"]}
                      for role, state in initial.items()}
            for page in (host, guest):
                page.evaluate("""() => {
                  if (!conn?.isP2pReady || typeof conn._maybeReoptimizeP2P !== 'function') {
                    throw new Error('live P2P RTT policy is unavailable');
                  }
                  for (let i = 0; i < 8; i++) conn._maybeReoptimizeP2P(1800);
                }""")
            host.wait_for_timeout(1_500)
            high_rtt = {"host": read_state(host), "guest": read_state(guest)}
            if not all(s["mode"] == "online" and s["conn"] and s["conn"]["p2p"]
                       and s["conn"]["channel"] == "open" and s["conn"]["pc"] == "connected"
                       and s["conn"]["recoveryAttempts"] == before[role]["attempts"]
                       for role, s in high_rtt.items()):
                raise AssertionError(json.dumps({"phase": "high_rtt_must_keep_healthy_p2p",
                                                 "before": before, "after": high_rtt}, ensure_ascii=False))
            result["highRttHealthyP2p"] = high_rtt

            # Establish a non-empty board before each unilateral network handoff.
            host.evaluate("window.makeMove(7, 7, BLACK)")
            guest.wait_for_function("board[7][7] === BLACK", timeout=5_000)
            guest.evaluate("window.makeMove(7, 8, WHITE)")
            host.wait_for_function("board[7][8] === WHITE", timeout=5_000)
            before_handoff = {role: read_state(page) for role, page in (("host", host), ("guest", guest))}

            # Exercise a network change on each endpoint separately. The native
            # handoff hook closes that page's stale transport; the opposite page
            # must stay ready while the same room and game are recovered.
            for role, page in (("host", host), ("guest", guest)):
                page.evaluate(
                    "role => window.__gomokuNativeNetworkChanged("
                    "`browser_smoke_${role}_network_handoff`, `browser-smoke-${role}-${Date.now()}`)",
                    role,
                )
                recovered = wait_for_pair(
                    host, guest,
                    lambda states: all(
                        s["mode"] == "online" and s["conn"] and s["conn"]["open"] and s["conn"]["ready"]
                        and s["room"] == room and s["round"] == before_handoff[role]["round"]
                        and s["moves"] == 2 and s["board"] == before_handoff[role]["board"]
                        for s in states.values()
                    ),
                    timeout_s=45,
                )
                if not all(s["conn"]["relayConnected"] for s in recovered.values()):
                    raise AssertionError(json.dumps({"phase": f"{role}_handoff_relay_recovery",
                                                     "states": recovered}, ensure_ascii=False))
                result.setdefault("unilateralNetworkRecovery", {})[role] = recovered

            # Open the ordinary reconnect sheet to use its real manual action.
            # Conversion must preserve this non-empty board locally, while the
            # remote page remains online and paused with a clear exit notice.
            host.evaluate("() => showReconnectOverlay(true, '网络暂时中断，正在尝试重新连接。')")
            host.locator("#onlineReconnectModal.show").wait_for(state="visible", timeout=5_000)
            before_manual = read_state(host)
            if before_manual["mode"] != "online" or before_manual["moves"] != 2:
                raise AssertionError(json.dumps({"phase": "manual_ai_precondition", "host": before_manual},
                                                ensure_ascii=False))
            host.locator('#onlineReconnectModal button[onclick="fallbackToAiGame()"]',
                         ).click()
            host.wait_for_function("() => gameMode === 'ai'", timeout=5_000)
            host_after_ai = read_state(host)
            guest.wait_for_function(
                "() => document.querySelector('#onlineReconnectModal.show') && "
                "document.querySelector('#reconnectTitle')?.textContent.includes('对手已退出房间')",
                timeout=10_000,
            )
            guest_paused = read_state(guest)
            if host_after_ai["moves"] != 2 or host_after_ai["board"] != before_manual["board"]:
                raise AssertionError(json.dumps({"phase": "manual_ai_preserves_board",
                                                 "before": before_manual, "after": host_after_ai},
                                                ensure_ascii=False))
            if guest_paused["mode"] != "online" or guest_paused["moves"] != 2 or not guest_paused["reconnectVisible"]:
                raise AssertionError(json.dumps({"phase": "peer_remains_online_paused", "guest": guest_paused},
                                                ensure_ascii=False))
            if "棋盘已保留" not in guest_paused["reconnectText"] or "手动" not in guest_paused["reconnectText"]:
                raise AssertionError(json.dumps({"phase": "peer_exit_message", "guest": guest_paused}, ensure_ascii=False))
            guest.wait_for_timeout(1_500)
            still_waiting = read_state(guest)
            if still_waiting["mode"] != "online" or still_waiting["moves"] != 2:
                raise AssertionError(json.dumps({"phase": "no_automatic_ai_after_peer_exit",
                                                 "guest": still_waiting}, ensure_ascii=False))

            # The explicit leave button must dismiss the stuck overlay and clear
            # room ownership; the user can then return to the lobby normally.
            guest.locator("#btnLeaveInterruptedRoom").click()
            guest.wait_for_function(
                "() => !document.querySelector('#onlineReconnectModal.show') && "
                "gameMode !== 'online' && !window.hasActiveOnlineRoom()",
                timeout=10_000,
            )
            guest.evaluate("() => window.SkyIslandUI.showLobby()")
            guest.locator("#skyLobby").wait_for(state="visible", timeout=10_000)
            result["manualExitFlow"] = {
                "hostAfterManualAi": host_after_ai,
                "guestPausedBeforeExit": guest_paused,
                "guestExitCompleted": read_state(guest),
                "lobbyVisible": True,
            }

            if any(errors.values()):
                raise AssertionError(json.dumps({"phase": "page_errors", "errors": errors}, ensure_ascii=False))
            result.update({"pass": True, "pageErrors": errors, "consoleErrors": console_errors})
            print(json.dumps(result, ensure_ascii=False, indent=2))
        except Exception as exc:
            result.update({"pass": False, "failure": str(exc), "pageErrors": errors,
                           "consoleErrors": console_errors,
                           "final": {"host": read_state(host), "guest": read_state(guest)}})
            raise
        finally:
            (DIAGNOSTICS / "online-session-browser-smoke.json").write_text(
                json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
            browser.close()


if __name__ == "__main__":
    main()
