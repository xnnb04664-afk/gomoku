"""Live smoke audit for the public Pages site.

Run with:
  python tests/official_site_live_audit.py

Override GOMOKU_OFFICIAL_BASE_URL when checking a preview deployment.
"""

import os

from playwright.sync_api import sync_playwright


BASE_URL = os.environ.get("GOMOKU_OFFICIAL_BASE_URL", "https://gomoku-home.pages.dev").rstrip("/")


def assert_no_horizontal_overflow(page):
    width = page.evaluate("document.documentElement.scrollWidth")
    viewport = page.viewport_size["width"]
    assert width <= viewport + 1, f"horizontal overflow: {width}px > {viewport}px"


def settle_page(page):
    """Wait for the useful UI without making a diagnostic depend on idle fetches."""
    try:
        page.wait_for_load_state("networkidle", timeout=5000)
    except Exception:
        # The game/landing page may keep an API check or WebSocket pending;
        # DOMContentLoaded plus a short paint window is sufficient for this audit.
        page.wait_for_timeout(500)


def mock_local_api(page):
    if BASE_URL.startswith("http://127.0.0.1"):
        page.route(
            "**/api/site-version",
            lambda route: route.fulfill(
                status=200,
                content_type="application/json",
                body='{"code":0,"tag":"v1.0.122","build":123}',
            ),
        )


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        errors = []

        home = browser.new_page(viewport={"width": 1365, "height": 900})
        home.on("console", lambda msg: errors.append(f"console:{msg.type}:{msg.text}") if msg.type == "error" else None)
        home.on("pageerror", lambda error: errors.append(f"pageerror:{error}"))
        mock_local_api(home)
        home.goto(f"{BASE_URL}/", wait_until="domcontentloaded", timeout=30000)
        settle_page(home)
        assert home.locator("h1").inner_text().startswith("一盘棋")
        assert home.locator('a[href="/play/"]').count() >= 1
        assert home.locator('a[href="/social/"]').count() >= 1
        assert home.locator('a[href="/help/"]').count() >= 1
        assert_no_horizontal_overflow(home)

        mobile = browser.new_page(viewport={"width": 390, "height": 844})
        mock_local_api(mobile)
        mobile.goto(f"{BASE_URL}/", wait_until="domcontentloaded", timeout=30000)
        settle_page(mobile)
        mobile.locator(".nav-toggle").click()
        assert "is-open" in (mobile.locator("#siteNav").get_attribute("class") or "")
        assert_no_horizontal_overflow(mobile)

        play = browser.new_page(viewport={"width": 390, "height": 844})
        mock_local_api(play)
        play.goto(f"{BASE_URL}/play/", wait_until="domcontentloaded", timeout=30000)
        play.wait_for_selector("#cvs", timeout=30000)
        play.wait_for_timeout(1200)
        assert play.locator(".official-return-strip").count() == 1
        assert play.locator('.official-return-strip a[href="/"]').count() == 1
        assert play.locator('.official-return-strip a[href="/social/"]').count() == 1
        assert play.locator("#gameSocialDock .game-social-dock-grid button").count() == 8
        assert play.locator("#btnGameSettings").count() == 1
        assert_no_horizontal_overflow(play)
        if os.environ.get("SAVE_SCREENSHOT") == "1":
            play.screenshot(path="D:/小游戏/.codex-diagnostics/official-site-play-mobile.png", full_page=True)

        social = browser.new_page(viewport={"width": 390, "height": 844})
        mock_local_api(social)
        social.goto(f"{BASE_URL}/social/", wait_until="domcontentloaded", timeout=30000)
        social.wait_for_selector('iframe[title="五子棋好友中心"]', timeout=15000)
        assert social.locator('iframe[title="五子棋好友中心"]').get_attribute("src") == "/play/#friends"
        assert_no_horizontal_overflow(social)

        assert errors == [], errors
        browser.close()
    print(f"official site live audit: PASS ({BASE_URL})")


if __name__ == "__main__":
    main()
