"""Live smoke audit for the public Pages site.

Run with:
  python tests/official_site_live_audit.py

Override GOMOKU_OFFICIAL_BASE_URL when checking a preview deployment.
"""

import json
import os
import time
from pathlib import Path

from playwright.sync_api import sync_playwright


BASE_URL = os.environ.get("GOMOKU_OFFICIAL_BASE_URL", "https://gomoku-home.pages.dev").rstrip("/")
VERSION = json.loads(Path("official-site/version.json").read_text(encoding="utf-8"))


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


def goto_page(page, url):
    # A local static preview can accept its TCP probe a few milliseconds before
    # Python's handler is ready. Retry only that preview navigation; real live
    # URLs still surface the first navigation failure immediately.
    attempts = 3 if BASE_URL.startswith(("http://127.0.0.1", "http://localhost")) else 1
    for attempt in range(attempts):
        try:
            page.goto(url, wait_until="domcontentloaded", timeout=30000)
            return
        except Exception:
            if attempt + 1 >= attempts:
                raise
            time.sleep(0.5)


def mock_local_api(page):
    if BASE_URL.startswith(("http://127.0.0.1", "http://localhost")):
        page.route(
            "**/api/site-version",
            lambda route: route.fulfill(
                status=200,
                content_type="application/json",
                body=json.dumps({"code": 0, "tag": VERSION["releaseTag"], "build": VERSION["versionCode"]}),
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
        goto_page(home, f"{BASE_URL}/")
        settle_page(home)
        assert home.locator("h1").inner_text().startswith("落子有声")
        assert home.locator('a[href="/play/"]').count() >= 1
        assert home.locator('a[href="/social/"]').count() >= 1
        assert home.locator('a[href="/help/"]').count() >= 1
        assert_no_horizontal_overflow(home)

        mobile = browser.new_page(viewport={"width": 390, "height": 844})
        mock_local_api(mobile)
        goto_page(mobile, f"{BASE_URL}/")
        settle_page(mobile)
        mobile.locator(".nav-toggle").click()
        assert "is-open" in (mobile.locator("#siteNav").get_attribute("class") or "")
        assert_no_horizontal_overflow(mobile)

        play = browser.new_page(viewport={"width": 390, "height": 844})
        mock_local_api(play)
        goto_page(play, f"{BASE_URL}/play/")
        play.wait_for_function("window.SkyIslandUI && typeof window.SkyIslandUI.showGame === 'function'", timeout=30000)
        play.evaluate("window.SkyIslandUI.showGame()")
        play.wait_for_selector("#cvs", state="visible", timeout=30000)
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
        goto_page(social, f"{BASE_URL}/social/")
        social.wait_for_selector('iframe[title="五子棋好友中心"]', timeout=15000)
        assert social.locator('iframe[title="五子棋好友中心"]').get_attribute("src") == "/play/#friends"
        assert_no_horizontal_overflow(social)

        assert errors == [], errors
        browser.close()
    print(f"official site live audit: PASS ({BASE_URL})")


if __name__ == "__main__":
    main()
