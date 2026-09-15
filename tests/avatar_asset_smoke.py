import json
import os
from pathlib import Path

from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeoutError


ROOT = Path(__file__).resolve().parents[1]


def test_page(page, url, single_file):
    requests = []
    legacy_avatar_requests = []
    console_errors = []
    page_errors = []
    page.on("request", lambda request: requests.append(request.url) if "anime_avatar_" in request.url else None)
    page.on(
        "request",
        lambda request: legacy_avatar_requests.append(request.url)
        if request.url.endswith("/img/avatar_boy.png") or request.url.endswith("/img/avatar_girl.png")
        else None,
    )
    page.on("console", lambda message: console_errors.append(message.text) if message.type == "error" else None)
    page.on("pageerror", lambda error: page_errors.append(str(error)))
    page.route(
        "**/api/rank*",
        lambda route: route.fulfill(
            status=200,
            content_type="application/json",
            headers={"Access-Control-Allow-Origin": "*"},
            body=json.dumps(
                {
                    "code": 0,
                    "data": [
                        {
                            "uid": "avatar-smoke-test",
                            "name": "头像测试",
                            "score": 1200,
                            "wins": 3,
                            "total_games": 4,
                            "avatar": "anime_boy",
                        }
                    ],
                },
                ensure_ascii=False,
            ),
        ),
    )
    page.goto(url, wait_until="domcontentloaded", timeout=30_000)
    # The refreshed product opens on the sky-island lobby. Enter the
    # preserved standard board before asserting avatar-related game UI.
    page.wait_for_selector("#skyLobby", state="visible", timeout=10_000)
    page.evaluate("() => window.SkyIslandUI?.showGame()")
    page.locator("#cvs").wait_for(state="visible", timeout=10_000)

    cold = page.evaluate(
        """
        () => ({
          boyReady: typeof window.ANIME_AVATAR_BOY !== 'undefined',
          girlReady: typeof window.ANIME_AVATAR_GIRL !== 'undefined'
        })
        """
    )
    page.evaluate("() => window.openLeaderboardModal()")
    try:
        page.wait_for_function(
            """() => {
              const image = document.querySelector('#leaderboardList img');
              return image && image.complete && image.naturalWidth > 0;
            }""",
            timeout=10_000,
        )
    except PlaywrightTimeoutError:
        pass
    leaderboard = page.evaluate(
        """
        () => {
          const image = document.querySelector('#leaderboardList img');
          const src = String(image?.src || '');
          return {
            hasImage: Boolean(image),
            width: image?.naturalWidth || 0,
            isJpegData: src.startsWith('data:image/jpeg;base64,'),
            isExpectedPath: src.endsWith('/img/anime_avatar_boy.jpg')
          };
        }
        """
    )
    page.evaluate("() => window.closeLeaderboardModal()")
    page.evaluate("() => window.openProfileModal(1)")
    page.locator("#animeImgBoy").wait_for(state="visible", timeout=10_000)
    try:
        page.wait_for_function(
            """() => {
              const boy = document.getElementById('animeImgBoy');
              const girl = document.getElementById('animeImgGirl');
              return boy && girl && boy.complete && girl.complete && boy.naturalWidth > 0 && girl.naturalWidth > 0;
            }""",
            timeout=10_000,
        )
    except PlaywrightTimeoutError:
        pass

    loaded = page.evaluate(
        """
        () => ({
          boyIsJpegData: String(window.ANIME_AVATAR_BOY || '').startsWith('data:image/jpeg;base64,'),
          girlIsJpegData: String(window.ANIME_AVATAR_GIRL || '').startsWith('data:image/jpeg;base64,'),
          boyIsExpectedPath: window.ANIME_AVATAR_BOY === 'img/anime_avatar_boy.jpg',
          girlIsExpectedPath: window.ANIME_AVATAR_GIRL === 'img/anime_avatar_girl.jpg',
          boySrcIsJpegData: String(document.getElementById('animeImgBoy')?.src || '').startsWith('data:image/jpeg;base64,'),
          girlSrcIsJpegData: String(document.getElementById('animeImgGirl')?.src || '').startsWith('data:image/jpeg;base64,'),
          boySrcIsExpectedPath: String(document.getElementById('animeImgBoy')?.src || '').endsWith('/img/anime_avatar_boy.jpg'),
          girlSrcIsExpectedPath: String(document.getElementById('animeImgGirl')?.src || '').endsWith('/img/anime_avatar_girl.jpg'),
          boyWidth: document.getElementById('animeImgBoy')?.naturalWidth || 0,
          girlWidth: document.getElementById('animeImgGirl')?.naturalWidth || 0,
          boyValueLength: String(window.ANIME_AVATAR_BOY || '').length,
          girlValueLength: String(window.ANIME_AVATAR_GIRL || '').length
        })
        """
    )
    if single_file:
        mode_ok = (
            loaded["boyIsJpegData"]
            and loaded["girlIsJpegData"]
            and loaded["boySrcIsJpegData"]
            and loaded["girlSrcIsJpegData"]
            and not requests
        )
        mode_ok = mode_ok and leaderboard["isJpegData"]
    else:
        mode_ok = (
            loaded["boyIsExpectedPath"]
            and loaded["girlIsExpectedPath"]
            and loaded["boySrcIsExpectedPath"]
            and loaded["girlSrcIsExpectedPath"]
            and len(requests) == 2
        )
        mode_ok = mode_ok and leaderboard["isExpectedPath"]
    result = {
        "url": url,
        "singleFile": single_file,
        "cold": cold,
        "loaded": loaded,
        "leaderboard": leaderboard,
        "avatarRequests": requests,
        "legacyAvatarRequests": legacy_avatar_requests,
        "consoleErrors": console_errors,
        "pageErrors": page_errors,
        "ok": (
            not cold["boyReady"]
            and not cold["girlReady"]
            and loaded["boyWidth"] > 0
            and loaded["girlWidth"] > 0
            and leaderboard["hasImage"]
            and leaderboard["width"] > 0
            and mode_ok
            and not legacy_avatar_requests
            and not console_errors
            and not page_errors
        ),
    }
    return result


def main():
    base_url = os.environ.get("GOMOKU_TEST_URL", "http://127.0.0.1:3000")
    results = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        context = browser.new_context(viewport={"width": 390, "height": 844})
        for relative, single_file in (("/index.html", False), ("/五子棋大师_单文件版.html", True)):
            page = context.new_page()
            results.append(test_page(page, base_url + relative, single_file))
            page.close()
        context.close()
        browser.close()
    print(json.dumps(results, ensure_ascii=False))
    if not all(result["ok"] for result in results):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
