import json
import os
import re
import sys
import time
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeoutError


UID = "user_smoke_1"
TOKEN = "token_smoke_formal_account"
REQUEST_ACCEPT = "a" * 24
REQUEST_REJECT = "b" * 24
REQUEST_CANCEL = "c" * 24
INVITE_ID = "d" * 24


def payload(data=None, code=0, msg=""):
    result = {"code": code}
    if data is not None:
        result["data"] = data
    if msg:
        result["msg"] = msg
    return result


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")

    test_url = os.environ.get("GOMOKU_TEST_URL", "http://127.0.0.1:3000/index.html")
    source = (Path(__file__).resolve().parents[1] / "js" / "social.js").read_text(encoding="utf-8")
    assert "[0, 1000, 2000, 4000, 8000, 12000]" in source, "社交重连退避表不完整"
    assert "SEARCH_DEBOUNCE_MS = 320" in source, "好友搜索没有稳定的输入防抖"
    assert "searchGeneration" in source and "AbortController" in source, "好友搜索缺少过期请求隔离"
    assert "removeEventListener('input', onSearchInput)" in source, "社交停止时未清理搜索监听器"

    requests = [
        {"id": REQUEST_ACCEPT, "direction": "incoming", "uid": "user_in_accept", "username": "in.accept", "nickname": "待同意"},
        {"id": REQUEST_REJECT, "direction": "incoming", "uid": "user_in_reject", "username": "in.reject", "nickname": "待拒绝"},
        {"id": REQUEST_CANCEL, "direction": "outgoing", "uid": "user_out_cancel", "username": "out.cancel", "nickname": "待取消"},
    ]
    friends = [{
        "uid": "user_friend_2", "username": "friend.two", "nickname": "云端棋友", "avatar": "🙂",
        "score": 1320, "online": True, "presenceHidden": False, "unread": 2,
    }]
    recent = [{
        "uid": "user_recent_3", "username": "recent.three", "nickname": "最近对手", "avatar": "👤",
        "score": 1100, "games_count": 3, "last_played_at": 1_788_800_000_000,
    }]
    blocks = [{"uid": "user_block_4", "username": "block.four", "nickname": "黑名单甲", "avatar": "👤"}]
    settings = {"presenceHidden": False, "metricsEnabled": True}
    pending_invites = [{
        "inviteId": INVITE_ID, "fromUid": "user_friend_2", "username": "friend.two", "nickname": "云端棋友",
        "avatar": "🙂", "roomCode": "654321", "expiresAt": int(time.time() * 1000) + 120_000,
    }]
    newest_messages = [
        {"id": index, "sender_uid": "user_friend_2" if index % 2 else UID, "receiver_uid": UID if index % 2 else "user_friend_2",
         "body": "<img src=x onerror=alert(1)>" if index == 99 else f"最新消息-{index}", "created_at": 1_788_800_000_000 + index}
        for index in range(51, 101)
    ]
    older_messages = [
        {"id": index, "sender_uid": "user_friend_2", "receiver_uid": UID, "body": f"更早消息-{index}", "created_at": 1_788_700_000_000 + index}
        for index in range(1, 51)
    ]
    calls = []
    socket_ticket_failures = {"enabled": False}
    socket_ticket_times = []

    def api_handler(route):
        request = route.request
        parsed = urlparse(request.url)
        path = parsed.path
        query = parse_qs(parsed.query)
        body = {}
        if request.post_data:
            try:
                body = json.loads(request.post_data)
            except json.JSONDecodeError:
                body = {}
        calls.append({"method": request.method, "path": path, "query": query, "body": body, "authorization": request.headers.get("authorization", "")})

        response = payload({})
        status = 200
        if path == "/api/auth/verify_session":
            response = payload({"uid": UID, "username": "smoke.owner", "nickname": "冒烟账号", "avatar": "🙂", "score": 1200, "token": TOKEN})
        elif path == "/api/friends" and request.method == "GET":
            response = payload({"friends": friends, "requests": requests, "invites": pending_invites, **settings})
        elif path == "/api/recent-opponents" and request.method == "GET":
            response = payload(recent)
        elif path == "/api/blocks" and request.method == "GET":
            response = payload(blocks)
        elif path == "/api/friends/search":
            response = payload({"uid": "user_exact_5", "username": query.get("username", [""])[0], "nickname": "精确目标", "avatar": "👤", "score": 1260, "relationship": "none", "requestId": ""})
        elif path == "/api/friends/requests" and request.method == "POST":
            response = payload({"requestId": "e" * 24})
        elif re.fullmatch(r"/api/friends/requests/[a-f0-9]{24}/(accept|reject|cancel)", path):
            request_id = path.split("/")[-2]
            requests[:] = [item for item in requests if item["id"] != request_id]
            response = payload()
        elif path == "/api/messages" and request.method == "GET":
            before = int(query.get("before", [0])[0] or 0)
            response = payload(older_messages if before == 51 else newest_messages)
        elif path == "/api/messages" and request.method == "POST":
            response = payload({"id": 101, "sender_uid": UID, "receiver_uid": body.get("receiverUid"), "body": body.get("text"), "created_at": int(time.time() * 1000)})
        elif path in ("/api/messages/read", "/api/messages/clear"):
            response = payload()
        elif path == "/api/social/settings":
            settings["presenceHidden"] = body.get("presenceHidden") is True
            settings["metricsEnabled"] = body.get("metricsEnabled") is not False
            response = payload()
        elif path == "/api/blocks" and request.method == "POST":
            target_uid = body.get("targetUid")
            person = next((item for item in recent + friends if item["uid"] == target_uid), {"uid": target_uid, "username": "blocked", "nickname": "已拉黑"})
            blocks.insert(0, person.copy())
            recent[:] = [item for item in recent if item["uid"] != target_uid]
            friends[:] = [item for item in friends if item["uid"] != target_uid]
            response = payload()
        elif path == "/api/blocks" and request.method == "DELETE":
            blocks[:] = [item for item in blocks if item["uid"] != body.get("targetUid")]
            response = payload()
        elif path.startswith("/api/friends/") and request.method == "DELETE":
            target_uid = path.rsplit("/", 1)[-1]
            friends[:] = [item for item in friends if item["uid"] != target_uid]
            response = payload()
        elif path == "/api/game-invites" and request.method == "POST":
            response = payload({"inviteId": "f" * 24, "expiresAt": int(time.time() * 1000) + 120_000})
        elif re.fullmatch(r"/api/game-invites/[a-f0-9]{24}/respond", path):
            pending_invites.clear()
            response = payload({"roomCode": "654321" if body.get("response") == "accepted" else ""})
        elif path == "/api/social/socket-ticket":
            socket_ticket_times.append(time.monotonic())
            if socket_ticket_failures["enabled"]:
                # 4xx 不触发 safeApiFetch 的备用入口重试，便于单独检查 socket 退避。
                response, status = payload(code=429, msg="mock unavailable"), 429
            else:
                response = payload({"ticket": "1" * 48, "expiresAt": int(time.time() * 1000) + 60_000})
        elif path in ("/api/metrics", "/api/history/list", "/api/rank"):
            response = payload([] if path != "/api/metrics" else {})

        route.fulfill(status=status, content_type="application/json", body=json.dumps(response, ensure_ascii=False))

    errors = []
    page_errors = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)

        # 游客必须被正式账号门槛拦截并引导登录。
        guest = browser.new_page(viewport={"width": 390, "height": 844})
        guest.route("https://*/api/**", api_handler)
        guest.goto(test_url, wait_until="domcontentloaded", timeout=30_000)
        guest.wait_for_selector("#skyLobby", state="visible", timeout=15_000)
        guest.evaluate("() => window.SkyIslandUI?.showGame()")
        guest.wait_for_selector("#cvs", state="visible")
        gate_result = guest.evaluate("window.openFriendsModal()")
        guest.wait_for_timeout(100)
        gate = {
            "returnedFalse": gate_result is False,
            "friendsClosed": "show" not in (guest.locator("#friendsModal").get_attribute("class") or ""),
            "authOpened": "show" in (guest.locator("#authModal").get_attribute("class") or ""),
        }
        guest.close()

        page = browser.new_page(viewport={"width": 390, "height": 844})
        page.on("console", lambda message: errors.append(message.text) if message.type == "error" else None)
        page.on("pageerror", lambda error: page_errors.append(str(error)))
        page.route("https://*/api/**", api_handler)
        page.add_init_script(
            f"""
            localStorage.setItem('gomoku_user_uid', {json.dumps(UID)});
            localStorage.setItem('gomoku_user_username', 'smoke.owner');
            localStorage.setItem('gomoku_user_token', {json.dumps(TOKEN)});
            localStorage.setItem('gomoku_user_refresh_token', 'refresh_smoke');
            window.__mockSockets = [];
            window.WebSocket = class MockWebSocket {{
              static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
              constructor(url) {{
                this.url = String(url); this.readyState = 0; this.sent = [];
                window.__mockSockets.push(this);
                setTimeout(() => {{ this.readyState = 1; if (this.onopen) this.onopen({{}}); }}, 5);
              }}
              send(value) {{ this.sent.push(String(value)); }}
              close() {{ this.readyState = 3; if (this.onclose) this.onclose({{}}); }}
              serverClose() {{ this.readyState = 3; if (this.onclose) this.onclose({{}}); }}
              serverMessage(value) {{ if (this.onmessage) this.onmessage({{ data: String(value) }}); }}
            }};
            window.__nativeNotificationCalls = 0;
            window.AndroidNativeApp = {{
              requestSocialNotificationPermission() {{}},
              showSocialNotification() {{ window.__nativeNotificationCalls += 1; }}
            }};
            """
        )
        page.goto(test_url, wait_until="domcontentloaded", timeout=30_000)
        try:
            page.wait_for_load_state("networkidle", timeout=10_000)
        except PlaywrightTimeoutError:
            pass
        page.wait_for_selector("#skyLobby", state="visible", timeout=15_000)
        page.evaluate("() => window.SkyIslandUI?.showGame()")
        page.wait_for_function("typeof window.hasRegisteredAccountSession === 'function' && window.hasRegisteredAccountSession()")
        page.evaluate("() => { window.showCustomConfirm = (_message, yes) => yes(); return true; }")
        page.evaluate("window.openFriendsModal()")
        page.wait_for_selector("#friendsModal.show")
        page.wait_for_selector("#socialFriendsList >> text=云端棋友")

        # 未读总数要同时出现在弹窗入口、底部好友按钮和收起后的悬浮入口。
        # 这里的 2 条私聊 + 2 条好友申请 + 1 条邀战来自同一份 /api/friends 快照。
        for badge_id in ("socialUnreadBadge", "gameFriendsUnreadBadge", "gameDockUnreadBadge"):
            page.wait_for_function(
                "id => getComputedStyle(document.getElementById(id)).display !== 'none' && document.getElementById(id).textContent === '5'",
                arg=badge_id,
            )
        assert "5 条好友动态" in (page.locator("#btnGameFriends").get_attribute("aria-label") or "")
        assert page.locator("#gameFriendsUnreadBadge").get_attribute("aria-hidden") == "false"
        assert "5 条好友动态" in (page.locator("#gameSocialDockFab").get_attribute("aria-label") or "")
        page.wait_for_function("window.__nativeNotificationCalls === 1")

        # WebSocket 收到新私聊时，红点保留并触发原生通知桥；消息正文不下发到通知。
        page.wait_for_function("window.__mockSockets.length > 0 && window.__mockSockets.some(socket => socket.readyState === 1)")
        page.evaluate("""
          () => {
            const socket = [...window.__mockSockets].reverse().find(item => item.readyState === 1);
            socket.serverMessage(JSON.stringify({ type: 'social_event', event: {
              kind: 'message', fromUid: 'user_friend_2', messageId: 777, body: '不应进入系统通知正文'
            }}));
          }
        """)
        page.wait_for_function("window.__nativeNotificationCalls === 2")
        assert page.locator("#gameFriendsUnreadBadge").inner_text() == "5"

        # 输入变化只允许最后一次精确账号查找发出请求，避免移动端键入时刷接口。
        search_calls_before_debounce = len([call for call in calls if call["path"] == "/api/friends/search"])
        page.locator("#socialSearchInput").fill("Auto.Partial")
        page.locator("#socialSearchInput").fill("Auto.Final")
        page.wait_for_timeout(650)
        debounced_calls = [call for call in calls if call["path"] == "/api/friends/search"][search_calls_before_debounce:]
        debounced_search = len(debounced_calls) == 1 and debounced_calls[0]["query"].get("username") == ["Auto.Final"]

        # 精确账号搜索与申请。
        page.locator("#socialSearchInput").fill("Exact.Target")
        page.locator("#socialSearchInput").press("Enter")
        page.wait_for_selector("#socialSearchResult >> text=精确目标")
        with page.expect_response(lambda response: urlparse(response.url).path == "/api/friends/requests" and response.request.method == "POST"):
            page.locator('#socialSearchResult [data-social-action="request"]').click()
        try:
            page.wait_for_function("document.querySelector('#socialSearchResult')?.textContent.includes('申请已发送')", timeout=5000)
        except PlaywrightTimeoutError:
            raise AssertionError(json.dumps({
                "searchHtml": page.locator("#socialSearchResult").inner_html(),
                "recentCalls": calls[-12:],
                "consoleErrors": errors,
                "pageErrors": page_errors,
            }, ensure_ascii=False))

        # 申请的同意、拒绝、取消三种操作。
        page.evaluate("window.GomokuSocial.switchTab('requests')")
        for request_id, action in ((REQUEST_ACCEPT, "request-accept"), (REQUEST_REJECT, "request-reject"), (REQUEST_CANCEL, "request-cancel")):
            page.locator(f'[data-request-id="{request_id}"][data-social-action="{action}"]').click()
            page.wait_for_function("requestId => !document.querySelector(`[data-request-id=\"${requestId}\"]`)", arg=request_id)

        # 私聊：最新页、XSS 转义、向前分页、已读、发送幂等 ID、个人清空。
        page.evaluate("window.GomokuSocial.switchTab('friends')")
        page.locator('#socialFriendsList [data-social-action="chat"]').click()
        page.wait_for_selector("#socialChatModal.show")
        page.wait_for_selector("#socialChatMessages >> text=最新消息-100")
        assert page.locator("#socialChatMessages img").count() == 0, "消息正文被当成 HTML 执行"
        page.locator('[data-social-action="load-older-messages"]').click()
        page.wait_for_selector("#socialChatMessages >> text=更早消息-1")
        page.locator("#socialChatInput").fill("你好🙂")
        page.locator("#socialChatInput").press("Enter")
        page.wait_for_selector("#socialChatMessages >> text=你好🙂")
        page.locator('[data-social-action="quick-message"][data-text="来一局？"]').click()
        page.wait_for_selector("#socialChatMessages >> text=来一局？")
        page.evaluate("window.GomokuSocial.clearChat()")
        page.wait_for_function("document.querySelector('#socialChatMessages')?.textContent.includes('还没有消息')")
        page.evaluate("window.GomokuSocial.closeChat()")

        # 邀战发送与接受复用房间链路。
        page.evaluate("window.ensureGomokuFeature('online')")
        page.wait_for_function("window.__GOMOKU_ONLINE_READY__ === true")
        page.evaluate("""() => {
          window.__joinedInviteRoom = '';
          window.initHostPeer = async () => { currentRoomCode = '123456'; };
          window.openOnlineModal = () => {};
          window.joinOnlineRoom = async code => { window.__joinedInviteRoom = code; };
          return true;
        }""")
        page.locator('#socialFriendsList [data-social-action="invite"]').click()
        page.wait_for_function("!document.querySelector('#friendsModal')?.classList.contains('show')")
        page.evaluate("window.GomokuSocial.open()")
        page.wait_for_selector("#friendsModal.show")
        page.evaluate("window.GomokuSocial.switchTab('requests')")
        page.locator(f'[data-invite-id="{INVITE_ID}"][data-social-action="invite-accept"]').click()
        page.wait_for_function("window.__joinedInviteRoom === '654321'")

        # 设置会同步到本地；拉黑/解除拉黑和删除好友均需确认后刷新。
        page.evaluate("window.GomokuSocial.open()")
        page.wait_for_selector("#friendsModal.show")
        page.locator("#socialMetricsEnabled").uncheck()
        page.wait_for_function("localStorage.getItem('gomoku_metrics_enabled') === '0'")
        page.evaluate("window.GomokuSocial.switchTab('recent')")
        page.locator('#socialRecentList [data-social-action="block"]').click()
        page.wait_for_function("!document.querySelector('#socialRecentList [data-uid=\"user_recent_3\"]')")
        page.evaluate("window.GomokuSocial.switchTab('blocks')")
        page.locator('#socialBlocksList [data-uid="user_block_4"][data-social-action="unblock"]').click()
        page.wait_for_function("!document.querySelector('#socialBlocksList [data-uid=\"user_block_4\"]')")
        page.evaluate("window.GomokuSocial.switchTab('friends')")
        page.locator('#socialFriendsList [data-social-action="delete-friend"]').click()
        page.wait_for_function("!document.querySelector('#socialFriendsList [data-social-action=\"delete-friend\"]')")

        # 已连接的 socket URL 只含一次性票据，不含长期令牌；连续失败遵循 0/1/2 秒退避。
        page.wait_for_function("window.__mockSockets.length > 0 && window.__mockSockets.some(socket => socket.readyState === 1)")
        socket_security = page.evaluate("""
          () => {
            const socket = [...window.__mockSockets].reverse().find(item => item.readyState === 1);
            return {
              url: socket.url,
              hasTicket: /[?&]ticket=1{48}(?:&|$)/.test(socket.url),
              leaksToken: socket.url.includes('token_smoke_formal_account')
            };
          }
        """)
        socket_ticket_failures["enabled"] = True
        reconnect_start_index = len(socket_ticket_times)
        page.evaluate("() => [...window.__mockSockets].reverse().find(socket => socket.readyState === 1).serverClose()")
        page.wait_for_timeout(3400)
        reconnect_times = socket_ticket_times[reconnect_start_index:]
        reconnect_intervals = [round(reconnect_times[i] - reconnect_times[i - 1], 1) for i in range(1, len(reconnect_times))]

        # 登出/账号切换会清理搜索和社交 DOM 监听器，避免重新登录后重复触发请求。
        page.evaluate("window.GomokuSocial.stop()")
        dom_cleanup = page.evaluate("""
          () => ({
            friendsBound: document.querySelector('#friendsModal')?.dataset.socialBound || '',
            searchBound: document.querySelector('#socialSearchInput')?.dataset.socialBound || '',
            chatBound: document.querySelector('#socialChatInput')?.dataset.socialBound || ''
          })
        """)

        # 请求契约检查。
        exact_search = next(call for call in calls if call["path"] == "/api/friends/search" and call["query"].get("username") == ["Exact.Target"])
        sent_message = next(call for call in calls if call["path"] == "/api/messages" and call["method"] == "POST")
        sent_invite = next(call for call in calls if call["path"] == "/api/game-invites" and call["method"] == "POST")
        read_call = next(call for call in calls if call["path"] == "/api/messages/read")
        checks = {
            "registeredGate": all(gate.values()),
            "debouncedSearch": debounced_search,
            "exactSearch": exact_search["query"].get("uid") == [UID],
            "authorization": exact_search["authorization"] == f"Bearer {TOKEN}",
            "requestActions": all(not any(item["id"] == value for item in requests) for value in (REQUEST_ACCEPT, REQUEST_REJECT, REQUEST_CANCEL)),
            "chatPagination": any(call["path"] == "/api/messages" and call["query"].get("before") == ["51"] for call in calls),
            "chatRead": read_call["body"].get("lastMessageId") == 100,
            "messageIdempotency": bool(re.fullmatch(r"msg_[a-f0-9]{24}", sent_message["body"].get("clientMessageId", ""))),
            "messageUtf8": sent_message["body"].get("text") == "你好🙂",
            "quickPhrase": any(call["path"] == "/api/messages" and call["method"] == "POST" and call["body"].get("text") == "来一局？" for call in calls),
            "inviteRoom": sent_invite["body"].get("roomCode") == "123456" and sent_invite["body"].get("friendUid") == "user_friend_2",
            "socketTicketOnly": socket_security["hasTicket"] and not socket_security["leaksToken"],
            "reconnectBackoff": len(reconnect_times) >= 3 and reconnect_intervals[:2] == [1.0, 2.0],
            "settingsLocal": page.evaluate("localStorage.getItem('gomoku_metrics_enabled')") == "0",
            "domCleanup": not any(dom_cleanup.values()),
            "noPageErrors": not page_errors,
        }
        print(json.dumps({
            "ok": all(checks.values()),
            "checks": checks,
            "gate": gate,
            "socket": {**socket_security, "ticketAttempts": len(reconnect_times), "intervals": reconnect_intervals},
            "consoleErrors": errors,
            "pageErrors": page_errors,
            "apiCallCount": len(calls),
        }, ensure_ascii=False))
        browser.close()

        if not all(checks.values()):
            raise SystemExit(1)


if __name__ == "__main__":
    main()
