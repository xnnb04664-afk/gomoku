"""Regression coverage for stale SocialHub work across account changes.

This test serves the current source module over the project's local Node server,
while mocking all API calls in Chromium. It never contacts a real account.
"""

import asyncio
import json
import os
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from playwright.async_api import async_playwright


ROOT = Path(__file__).resolve().parents[1]
UID_A = "lifecycle_user_a"
UID_B = "lifecycle_user_b"


def json_payload(data=None, code=0):
    return {"code": code, "data": data if data is not None else {}}


async def make_page(browser, source, calls, gates):
    page = await browser.new_page(viewport={"width": 390, "height": 844})
    await page.add_init_script(
        """
        localStorage.setItem('gomoku_user_uid', 'lifecycle_user_a');
        localStorage.setItem('gomoku_user_username', 'lifecycle.a');
        localStorage.setItem('gomoku_user_token', 'test_token_a');
        localStorage.setItem('gomoku_user_refresh_token', 'test_refresh_a');
        window.__mockSockets = [];
        window.WebSocket = class MockWebSocket {
          static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
          constructor(url) {
            this.url = String(url); this.readyState = 0; this.sent = [];
            window.__mockSockets.push(this);
            setTimeout(() => {
              if (this.readyState !== 0) return;
              this.readyState = 1;
              this.onopen && this.onopen({});
            }, 0);
          }
          send(value) { this.sent.push(String(value)); }
          close(code = 1000) {
            this.readyState = 3;
            this.onclose && this.onclose({ code });
          }
        };
        """
    )

    async def serve_source(route):
        await route.fulfill(status=200, content_type="text/javascript; charset=utf-8", body=source)

    async def serve_api(route):
        request = route.request
        parsed = urlparse(request.url)
        path = parsed.path
        if path.startswith("/gomoku-api/"):
            path = path[len("/gomoku-api"):]
        query = parse_qs(parsed.query)
        body = {}
        if request.post_data:
            try:
                body = json.loads(request.post_data)
            except json.JSONDecodeError:
                pass
        requested_uid = str(body.get("uid") or query.get("uid", [""])[0])
        calls.append({"path": path, "uid": requested_uid, "method": request.method})

        if path == "/api/social/socket-ticket":
            if requested_uid == UID_A and gates.get("ticket_a"):
                gates["ticket_a_started"].set()
                await gates["ticket_a"].wait()
            if requested_uid == UID_B and gates.get("ticket_b_started"):
                gates["ticket_b_started"].set()
            ticket = ("a" if requested_uid == UID_A else "b") * 48
            result = json_payload({"ticket": ticket, "expiresAt": 4_000_000_000_000})
        elif path == "/api/friends":
            if requested_uid == UID_A and gates.get("friends_a"):
                gates["friends_a_started"].set()
                await gates["friends_a"].wait()
            friend_uid = "friend_a" if requested_uid == UID_A else "friend_b"
            nickname = "账号甲好友" if requested_uid == UID_A else "账号乙好友"
            result = json_payload({
                "friends": [{"uid": friend_uid, "username": friend_uid, "nickname": nickname, "avatar": "👤", "score": 1000}],
                "requests": [], "invites": [], "presenceHidden": False, "metricsEnabled": True,
            })
        elif path == "/api/recent-opponents" or path == "/api/blocks":
            result = json_payload([])
        elif path == "/api/auth/verify_session":
            result = json_payload({"uid": requested_uid, "username": "lifecycle", "token": "test_token"})
        elif path == "/api/auth/refresh":
            result = json_payload({"uid": requested_uid, "username": "lifecycle", "token": "test_token"})
        else:
            result = json_payload({})
        await route.fulfill(status=200, content_type="application/json", body=json.dumps(result, ensure_ascii=False))

    await page.route("**/js/social.min.js*", serve_source)
    await page.route("**/api/**", serve_api)
    test_url = os.environ.get("GOMOKU_TEST_URL", "http://127.0.0.1:4194/index.html")
    await page.goto(test_url, wait_until="domcontentloaded", timeout=30_000)
    await page.wait_for_selector("#skyLobby", state="visible", timeout=15_000)
    return page


async def switch_to_b(page):
    await page.evaluate(
        """
        () => {
          window.GomokuSocial.stop();
          currentUserUid = 'lifecycle_user_b';
          currentUsername = 'lifecycle.b';
          currentUserToken = 'test_token_b';
          currentUserRefreshToken = 'test_refresh_b';
          localStorage.setItem('gomoku_user_uid', currentUserUid);
          localStorage.setItem('gomoku_user_username', currentUsername);
          localStorage.setItem('gomoku_user_token', currentUserToken);
          localStorage.setItem('gomoku_user_refresh_token', currentUserRefreshToken);
          window.GomokuSocial.start();
        }
        """
    )


async def check_refresh_after_stop(browser, source):
    calls = []
    release_a = asyncio.Event()
    gates = {"friends_a": release_a, "friends_a_started": asyncio.Event()}
    page = await make_page(browser, source, calls, gates)
    try:
        await page.evaluate("() => window.ensureGomokuFeature('social').then(() => window.GomokuSocial.start())")
        await asyncio.wait_for(gates["friends_a_started"].wait(), timeout=10)
        await switch_to_b(page)
        await asyncio.sleep(0.2)
        release_a.set()
        await asyncio.sleep(0.4)
        rendered_b = "账号乙好友" in await page.locator("#socialFriendsList").inner_text()
        b_requests = sum(call["path"] == "/api/friends" and call["uid"] == UID_B for call in calls)
        return {"renderedB": rendered_b, "bFriendRequests": b_requests, "calls": calls}
    finally:
        release_a.set()
        await page.close()


async def check_stale_socket_ticket(browser, source):
    calls = []
    release_a = asyncio.Event()
    gates = {
        "ticket_a": release_a,
        "ticket_a_started": asyncio.Event(),
        "ticket_b_started": asyncio.Event(),
    }
    page = await make_page(browser, source, calls, gates)
    try:
        await page.evaluate("() => window.ensureGomokuFeature('social').then(() => window.GomokuSocial.start())")
        await asyncio.wait_for(gates["ticket_a_started"].wait(), timeout=10)
        await switch_to_b(page)
        await asyncio.wait_for(gates["ticket_b_started"].wait(), timeout=10)
        await page.wait_for_function("window.__mockSockets.some(socket => socket.url.includes('b'.repeat(48)))", timeout=5000)
        release_a.set()
        await page.wait_for_timeout(150)
        urls = await page.evaluate("() => window.__mockSockets.map(socket => socket.url)")
        stale_a = any("a" * 48 in url for url in urls)
        return {"socketUrls": urls, "staleAccountASocketCreated": stale_a}
    finally:
        release_a.set()
        await page.close()


async def main():
    source = (ROOT / "js" / "social.js").read_text(encoding="utf-8")
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(headless=True)
        refresh = await check_refresh_after_stop(browser, source)
        socket = await check_stale_socket_ticket(browser, source)
        await browser.close()
    checks = {
        "refreshRestartsForNewAccount": refresh["renderedB"] and refresh["bFriendRequests"] > 0,
        "oldAccountTicketDoesNotCreateSocket": not socket["staleAccountASocketCreated"],
    }
    print(json.dumps({"ok": all(checks.values()), "checks": checks, "refresh": refresh, "socket": socket}, ensure_ascii=False))
    if not all(checks.values()):
        raise SystemExit(1)


if __name__ == "__main__":
    asyncio.run(main())
