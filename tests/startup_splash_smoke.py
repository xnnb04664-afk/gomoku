"""Regression coverage for automatic splash skipping on web and file://."""
from __future__ import annotations

import os
from pathlib import Path
from playwright.sync_api import sync_playwright

BASE_URL = os.environ.get("GOMOKU_STARTUP_BASE_URL", "http://127.0.0.1:4198").rstrip("/")
ROOT = Path(__file__).resolve().parents[1]


def check_startup(browser, url, offline=False):
    for motion in ("no-preference", "reduce"):
        context = browser.new_context(
            viewport={"width": 390, "height": 844}, offline=offline,
            reduced_motion=motion,
        )
        context.add_init_script("""
            window.__splashEverVisible = false;
            new MutationObserver(() => {
                const root = document.getElementById('startupSplash');
                if (root && !root.hidden) window.__splashEverVisible = true;
            }).observe(document, {childList: true, attributes: true, subtree: true,
                                  attributeFilter: ['hidden', 'class']});
        """)
        page = context.new_page()
        errors = []
        startup_requests = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.on("request", lambda request: startup_requests.append(request.url)
                if "/img/startup/" in request.url else None)
        page.goto(url, wait_until="domcontentloaded")
        assert page.evaluate("Boolean(window.GomokuStartupSplash)")
        assert page.locator("#startupSplash").get_attribute("data-dismiss-reason") == "auto-skip"
        assert page.evaluate("document.getElementById('startupSplash').hidden")
        assert not page.evaluate("window.GomokuStartupSplash.isVisible()")
        assert not page.evaluate("window.__splashEverVisible")
        assert not page.evaluate("document.documentElement.classList.contains('startup-splash-active')")
        page.locator("#skyLobby").wait_for(state="visible")
        page.locator("#skyLobby [data-sky-nav='friends']").click()
        page.wait_for_selector("#skyNavWorkspace[data-screen='friends']", state="visible")
        assert not startup_requests, startup_requests
        assert not errors, errors
        context.close()


def check_single_file_startup(browser):
    check_startup(browser, (ROOT / "五子棋大师_单文件版.html").as_uri(), offline=True)


def main():
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        check_single_file_startup(browser)
        check_startup(browser, f"{BASE_URL}/index.html")
        browser.close()
    print("startup_splash_smoke: PASS (automatic skip, no flash, no image requests, first click)")


if __name__ == "__main__":
    main()
