"""Regression coverage for the four-frame Sky Island startup sequence."""

from __future__ import annotations

import os
from pathlib import Path

from playwright.sync_api import sync_playwright


BASE_URL = os.environ.get("GOMOKU_STARTUP_BASE_URL", "http://127.0.0.1:4198").rstrip("/")
ROOT = Path(__file__).resolve().parents[1]


def assert_no_page_errors(errors: list[str], label: str) -> None:
    if errors:
        raise AssertionError(f"{label} page errors: {errors}")


def main() -> None:
    single_file = (ROOT / "五子棋大师_单文件版.html").read_text(encoding="utf-8")
    assert "startup-splash-inline-style" in single_file
    assert "js/startup-splash.js" not in single_file
    assert single_file.count("data:image/webp;base64,") >= 4

    android_index = (ROOT / "android_src" / "assets" / "index.html").read_text(encoding="utf-8")
    assert 'src="img/startup/startup-04.webp"' in android_index
    for frame_name in ("startup-01.webp", "startup-02.webp", "startup-03.webp", "startup-04.webp"):
        assert (ROOT / "android_src" / "assets" / "img" / "startup" / frame_name).is_file()

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)

        page_errors: list[str] = []
        page = browser.new_page(viewport={"width": 390, "height": 844})
        page.on("pageerror", lambda error: page_errors.append(str(error)))
        page.goto(f"{BASE_URL}/index.html?startupSmoke=1", wait_until="domcontentloaded")
        page.wait_for_function("window.GomokuStartupSplash && document.getElementById('startupSplash')")
        page.locator("#startupSplash").wait_for(state="visible")
        assert page.locator("[data-startup-frame]").count() == 4
        page.wait_for_function(
            "Array.from(document.querySelectorAll('[data-startup-frame] img')).every(img => img.complete && img.naturalWidth > 0)"
        )
        assert page.evaluate("window.GomokuStartupSplash.isVisible()") is True
        page.locator("[data-startup-skip]").click()
        page.wait_for_function("document.getElementById('startupSplash').hidden === true")
        assert page.evaluate("window.GomokuStartupSplash.isVisible()") is False
        assert_no_page_errors(page_errors, "normal startup")
        page.close()

        first_tap_errors: list[str] = []
        first_tap_page = browser.new_page(viewport={"width": 390, "height": 844})
        first_tap_page.on("pageerror", lambda error: first_tap_errors.append(str(error)))
        first_tap_page.goto(f"{BASE_URL}/index.html?startupSmoke=firstTap", wait_until="domcontentloaded")
        first_tap_page.wait_for_function("window.GomokuStartupSplash && document.getElementById('startupSplash')")
        first_tap_page.wait_for_selector("#startupSplash", state="visible")
        first_tap_page.wait_for_selector("#skyLobby", state="visible", timeout=15_000)
        assert first_tap_page.evaluate("window.GomokuStartupSplash.isVisible()") is True
        first_tap_page.locator("#skyLobby [data-sky-nav='friends']").click()
        first_tap_page.wait_for_selector("#skyNavWorkspace[data-screen='friends']", state="visible", timeout=10_000)
        first_tap_page.wait_for_function("document.getElementById('startupSplash').hidden === true")
        assert "棋友在云上相逢" in first_tap_page.locator("#skyNavWorkspace").inner_text()
        assert_no_page_errors(first_tap_errors, "first tap startup")
        first_tap_page.close()

        reduced_errors: list[str] = []
        reduced_page = browser.new_page(
            viewport={"width": 390, "height": 844},
            reduced_motion="reduce",
        )
        reduced_page.on("pageerror", lambda error: reduced_errors.append(str(error)))
        reduced_page.goto(f"{BASE_URL}/index.html?startupSmoke=reduced", wait_until="domcontentloaded")
        reduced_page.wait_for_function("window.GomokuStartupSplash && document.getElementById('startupSplash')")
        reduced_page.wait_for_function(
            "document.getElementById('startupSplash').hidden === true",
            timeout=2000,
        )
        assert_no_page_errors(reduced_errors, "reduced-motion startup")
        reduced_page.close()
        browser.close()

    print("startup_splash_smoke: PASS")


if __name__ == "__main__":
    main()
