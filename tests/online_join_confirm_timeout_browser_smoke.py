"""Exercise the 15-second join-confirm recovery and pending-leave race.

This reuses online_relay_smoke's deterministic WebSocket fixture, extending its
join_confirmed drop interval beyond the production timeout. The pages use only
fictional local accounts, a local WebSocket mock, and Chromium's native page
runtime; no production relay or MQTT broker is contacted.
"""

from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

sys.path.insert(0, str(Path(__file__).resolve().parent))
from online_relay_smoke import MOCK_RELAY_INIT


ROOT = Path(__file__).resolve().parents[1]
DIAGNOSTICS = ROOT / ".codex-diagnostics" / "online-session-20261108"
DROP_MS = 17_000


def make_drop_fixture() -> str:
    fixture = MOCK_RELAY_INIT
    original = "if (Date.now() - firstJoinConfirmedAt < 1600) {"
    replacement = f"window.__gomokuFirstJoinConfirmedAt = firstJoinConfirmedAt;\n          if (Date.now() - firstJoinConfirmedAt < {DROP_MS}) {{"
    if original not in fixture:
        raise RuntimeError("relay smoke join-confirm drop hook changed unexpectedly")
    fixture = fixture.replace(original, replacement, 1)
    fixture = fixture.replace(
        "window.__gomokuDroppedJoinConfirmations = 0;",
        "window.__gomokuDroppedJoinConfirmations = 0;\n"
        "  window.__gomokuAcceptedJoinConfirmations = 0;\n"
        "  window.__gomokuFirstJoinConfirmedAt = 0;\n"
        "  window.__gomokuSnapshotDeliveries = 0;",
        1,
    )
    fixture = fixture.replace(
        "deliver({ type: 'message', topic: data.topic, payload: data.payload });",
        "try { const payload = JSON.parse(String(data.payload || '')); "
        "if (protocolRole === 'client' && payload.type === 'state_snapshot') "
        "window.__gomokuSnapshotDeliveries++; } catch (_) {}\n"
        "      deliver({ type: 'message', topic: data.topic, payload: data.payload });",
        1,
    )
    fixture = fixture.replace(
        "if (Date.now() - firstJoinConfirmedAt < 17000) {\n"
        "            window.__gomokuDroppedJoinConfirmations++;\n"
        "            return;\n"
        "          }",
        "if (Date.now() - firstJoinConfirmedAt < 17000) {\n"
        "            window.__gomokuDroppedJoinConfirmations++;\n"
        "            return;\n"
        "          }\n"
        "          window.__gomokuAcceptedJoinConfirmations++;",
        1,
    )
    return fixture


FIXTURE = make_drop_fixture()


def configure_page(page, role: str, errors: list[str], console_errors: list[str]) -> None:
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.on("console", lambda message: console_errors.append(message.text) if message.type == "error" else None)
    page.add_init_script(
        "localStorage.setItem('gomoku_user_uid', 'user_local_relay_test'); "
        "localStorage.setItem('gomoku_user_username', 'local.relay'); "
        "localStorage.setItem('gomoku_user_token', 'local-test-token'); "
        "localStorage.setItem('gomoku_user_refresh_token', 'local-test-refresh'); "
        f"window.__gomokuRelayRole = {json.dumps(role)}; "
        f"window.__gomokuRelayClientId = {json.dumps(role)}; "
        "try { Object.defineProperty(window, 'RTCPeerConnection', { configurable: true, value: undefined }); } catch (_) {} "
        "try { Object.defineProperty(window, 'webkitRTCPeerConnection', { configurable: true, value: undefined }); } catch (_) {}"
    )
    page.add_init_script(FIXTURE)

    def mock_api(route):
        url = route.request.url
        if "/api/room/socket-ticket" in url:
            data = {"ticket": "a" * 64, "expiresAt": int(time.time() * 1000) + 30_000}
        elif "/api/auth/verify_session" in url:
            data = {"uid": "user_local_relay_test", "username": "local.relay",
                    "nickname": "Local Relay Test", "avatar": "anime_boy",
                    "score": 1000, "token": "local-test-token"}
        else:
            data = {}
        route.fulfill(status=200, content_type="application/json",
                      body=json.dumps({"code": 0, "data": data}, ensure_ascii=False))

    page.route("**/api/**", mock_api)
    page.route("**/js/mqtt.min.js", lambda route: route.abort())
    page.goto(os.environ.get("GOMOKU_TEST_URL", "http://127.0.0.1:4193/index.html"),
              wait_until="domcontentloaded", timeout=30_000)
    page.wait_for_selector("#skyLobby", state="visible", timeout=20_000)
    page.wait_for_function("() => typeof window.SkyIslandUI?.showGame === 'function'", timeout=10_000)
    page.evaluate("() => window.SkyIslandUI.showGame()")
    page.locator("#cvs").wait_for(state="visible", timeout=10_000)
    page.evaluate("() => window.ensureGomokuFeature('online')")
    page.wait_for_function("() => window.__GOMOKU_ONLINE_READY__ === true", timeout=30_000)


def state(page):
    return page.evaluate(
        """() => ({
          mode: gameMode,
          room: currentRoomCode,
          session: onlineSessionId,
          round: onlineRoundId,
          moves: history.length,
          board: JSON.stringify(board),
          conn: conn ? { open: conn.open, ready: conn.ready,
                         relay: conn.client?.transportType === 'relay' } : null,
          reconnectVisible: Boolean(document.querySelector('#onlineReconnectModal.show')),
          reconnectTitle: document.querySelector('#reconnectTitle')?.textContent?.trim() || '',
          dropped: window.__gomokuDroppedJoinConfirmations || 0,
          accepted: window.__gomokuAcceptedJoinConfirmations || 0,
          firstConfirmAt: window.__gomokuFirstJoinConfirmedAt || 0,
          snapshots: window.__gomokuSnapshotDeliveries || 0,
          notice: document.querySelector('#gameNoticeToast')?.textContent?.trim() || ''
        })"""
    )


def main() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    DIAGNOSTICS.mkdir(parents=True, exist_ok=True)
    url = os.environ.get("GOMOKU_TEST_URL", "http://127.0.0.1:4193/index.html")
    report = {"url": url, "dropWindowMs": DROP_MS,
              "fixture": "online_relay_smoke.MOCK_RELAY_INIT with extended join_confirmed drop"}
    errors = {"recovery": {"host": [], "guest": []}, "pendingLeave": {"host": [], "guest": []}}
    console_errors = {"recovery": {"host": [], "guest": []}, "pendingLeave": {"host": [], "guest": []}}

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        try:
            context = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=1)
            host, guest = context.new_page(), context.new_page()
            configure_page(host, "host", errors["recovery"]["host"], console_errors["recovery"]["host"])
            configure_page(guest, "guest", errors["recovery"]["guest"], console_errors["recovery"]["guest"])
            snapshot_baseline = guest.evaluate("() => window.__gomokuSnapshotDeliveries || 0")
            room = str(int(time.time() * 1000) % 900_000 + 100_000)
            report["room"] = room
            host.evaluate("code => window.initHostPeer(code, true)", room)
            guest.evaluate("code => window.joinOnlineRoom(code)", room)
            host.wait_for_function(
                "() => window.__gomokuDroppedJoinConfirmations >= 1", timeout=12_000)
            host.wait_for_function("() => gameMode === 'online' && conn?.open && conn?.ready", timeout=8_000)
            host_identity = state(host)
            guest_before_confirmation = state(guest)
            if guest_before_confirmation["mode"] != "ai":
                raise AssertionError(json.dumps({"phase": "accepted_guest_still_awaits_confirmation",
                                                 "host": host_identity,
                                                 "guest": guest_before_confirmation}, ensure_ascii=False))
            host.evaluate("window.makeMove(7, 7, BLACK)")
            host.wait_for_function("history.length === 1 && board[7][7] === BLACK", timeout=5_000)
            move_time_state = state(host)
            if move_time_state["moves"] != 1:
                raise AssertionError(json.dumps({"phase": "host_first_move", "host": move_time_state}, ensure_ascii=False))

            # Observe the pending-confirmation timeout before the fixture admits
            # any acknowledgement (17s drop window vs 15s production timeout).
            host.wait_for_function(
                "() => window.__gomokuDroppedJoinConfirmations >= 1 && "
                "window.__gomokuFirstJoinConfirmedAt > 0 && "
                "Date.now() - window.__gomokuFirstJoinConfirmedAt >= 15500",
                timeout=22_000,
            )
            before_release = {"host": state(host), "guest": state(guest)}
            if before_release["guest"]["mode"] != "online":
                raise AssertionError(json.dumps({"phase": "guest_must_not_restore_old_ai_at_confirm_timeout",
                                                 **before_release}, ensure_ascii=False))
            if before_release["host"]["moves"] != 1 or before_release["host"]["round"] != host_identity["round"]:
                raise AssertionError(json.dumps({"phase": "host_room_retains_first_move", **before_release},
                                                ensure_ascii=False))
            if (before_release["guest"]["moves"] != 1 or
                    before_release["guest"]["board"] != before_release["host"]["board"] or
                    before_release["guest"]["session"] != before_release["host"]["session"] or
                    before_release["guest"]["round"] != before_release["host"]["round"] or
                    before_release["guest"]["snapshots"] <= snapshot_baseline):
                raise AssertionError(json.dumps({"phase": "timeout_snapshot_restores_one_move",
                                                 "snapshotBaseline": snapshot_baseline,
                                                 "states": before_release}, ensure_ascii=False))
            report["stateAt15Seconds"] = before_release

            # The original join-confirm is still being dropped past the normal
            # timeout; recovery must keep the same room identity and replay the
            # host's snapshot instead of restoring the guest's old AI game.
            recovered = before_release
            if (recovered["host"]["room"] != recovered["guest"]["room"] or
                    recovered["host"]["session"] != recovered["guest"]["session"] or
                    recovered["host"]["round"] != recovered["guest"]["round"] or
                    recovered["host"]["session"] != host_identity["session"] or
                    recovered["host"]["round"] != host_identity["round"] or
                    recovered["guest"]["moves"] != 1):
                raise AssertionError(json.dumps({"phase": "same_session_round_snapshot_recovery",
                                                 "beforeRelease": before_release,
                                                 "recovered": recovered}, ensure_ascii=False))
            report["afterReconnectSnapshot"] = recovered
            report["timeoutRecovery"] = {
                "hostOnlineBeforeGuestConfirmed": host_identity,
                "guestStillInAiWhileConfirmWasPending": guest_before_confirmation,
                "hostMoveBeforeTimeout": move_time_state,
                "stateAt15SecondsBeforeFixtureRelease": before_release,
                "afterReconnectSnapshot": recovered,
            }
            context.close()

            # Reproduce the companion race: host leaves while guest is still AI
            # in the accepted-but-not-confirmed phase. The delayed timeout must
            # not resurrect a stale AI or leave the join attempt active.
            context = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=1)
            host2, guest2 = context.new_page(), context.new_page()
            configure_page(host2, "host", errors["pendingLeave"]["host"], console_errors["pendingLeave"]["host"])
            configure_page(guest2, "guest", errors["pendingLeave"]["guest"], console_errors["pendingLeave"]["guest"])
            room2 = str(int(time.time() * 1000) % 900_000 + 100_000)
            report["pendingLeaveRoom"] = room2
            host2.evaluate("code => window.initHostPeer(code, true)", room2)
            guest2.evaluate("code => window.joinOnlineRoom(code)", room2)
            host2.wait_for_function("() => window.__gomokuDroppedJoinConfirmations >= 1", timeout=12_000)
            host2.wait_for_function("() => gameMode === 'online' && conn?.open && conn?.ready", timeout=8_000)
            leave_started = state(host2)
            guest_pending_before_leave = state(guest2)
            if guest_pending_before_leave["mode"] != "ai":
                raise AssertionError(json.dumps({"phase": "pending_leave_guest_ai_precondition",
                                                 "host": leave_started,
                                                 "guest": guest_pending_before_leave}, ensure_ascii=False))
            report["hostAtPendingLeave"] = leave_started
            report["guestAiBeforePendingLeave"] = guest_pending_before_leave
            host2.evaluate("() => leaveOnlineRoom(true)")
            guest2.wait_for_function(
                "() => document.querySelector('#onlineReconnectModal.show') && "
                "document.querySelector('#reconnectTitle')?.textContent.includes('对手已退出房间')",
                timeout=10_000,
            )
            after_leave = state(guest2)
            report["guestImmediatelyAfterPendingLeave"] = after_leave
            host2.wait_for_function(
                "() => window.__gomokuFirstJoinConfirmedAt > 0 && "
                "Date.now() - window.__gomokuFirstJoinConfirmedAt >= 15500",
                timeout=20_000,
            )
            after_stale_timeout = state(guest2)
            report["guestAfterOriginalTimeoutWindow"] = after_stale_timeout
            if (after_leave["mode"] != "online" or after_stale_timeout["mode"] != "online" or
                    after_stale_timeout["moves"] != 0 or not after_stale_timeout["reconnectVisible"] or
                    after_stale_timeout["reconnectTitle"] != "对手已退出房间"):
                raise AssertionError(json.dumps({"phase": "pending_leave_cancels_old_join_timeout",
                                                 "hostAtLeave": leave_started,
                                                 "guestAfterLeave": after_leave,
                                                 "guestAfterStaleTimeout": after_stale_timeout}, ensure_ascii=False))
            report["pendingLeave"] = {
                "hostAtLeave": leave_started,
                "guestAfterLeave": after_leave,
                "guestAfterOriginalTimeoutWindow": after_stale_timeout,
            }
            report["pageErrors"] = errors
            report["consoleErrors"] = console_errors
            if (any(messages for roles in errors.values() for messages in roles.values()) or
                    any(messages for roles in console_errors.values() for messages in roles.values())):
                raise AssertionError(json.dumps({"phase": "browser_errors", "errors": errors,
                                                 "consoleErrors": console_errors}, ensure_ascii=False))
            report["pass"] = True
            print(json.dumps(report, ensure_ascii=False, indent=2))
            context.close()
        except Exception as exc:
            report.update({"pass": False, "failure": str(exc), "pageErrors": errors,
                           "consoleErrors": console_errors})
            raise
        finally:
            (DIAGNOSTICS / "online-join-confirm-timeout-browser-smoke.json").write_text(
                json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
            browser.close()


if __name__ == "__main__":
    main()
