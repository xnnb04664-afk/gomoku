import os
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright


def assert_no_overflow(page, label):
    overflow = page.evaluate("document.documentElement.scrollWidth - window.innerWidth")
    assert overflow <= 1, f"{label} horizontal overflow: {overflow}px"


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    url = os.environ.get("GOMOKU_TEST_URL", "http://127.0.0.1:3000/index.html")
    output_dir = Path(os.environ.get("GOMOKU_SCREENSHOT_DIR", "D:/小游戏/.codex-diagnostics"))
    output_dir.mkdir(parents=True, exist_ok=True)
    errors = []
    console_errors = []

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        context = browser.new_context(viewport={"width": 1440, "height": 900}, device_scale_factor=1)
        context.add_init_script("localStorage.clear(); sessionStorage.clear();")
        page = context.new_page()
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.on("console", lambda message: console_errors.append(message.text) if message.type == "error" else None)
        page.route("https://gomoku-api.pages.dev/api/version**", lambda route: route.fulfill(
            status=200, content_type="application/json", body='{"code":0,"tag":"v1.0.126","updateLog":"smoke fixture"}'
        ))
        page.goto(url, wait_until="domcontentloaded", timeout=30_000)
        page.wait_for_selector("#skyLobby", state="visible", timeout=15_000)
        page.wait_for_selector("#cvs", state="attached", timeout=15_000)

        assert page.locator("#skyLobby [data-sky-nav]").count() == 4
        home_actions = page.locator("#skyLobby .sky-route-list [data-sky-action]")
        assert home_actions.count() == 3
        home_text = page.locator("#skyLobby .sky-route-list").inner_text()
        assert all(label in home_text for label in ("AI 对战", "匹配对决", "跟好友玩"))
        assert "远征" not in home_text and "十字棋" not in home_text
        assert page.locator("script[src='js/expedition.js'], script[src='js/cross.js']").count() == 0
        assert_no_overflow(page, "desktop lobby")
        page.screenshot(path=str(output_dir / "sky-island-home-desktop-1440x900.png"), full_page=True)

        # Private-game mode intentionally presents the login gate on a clean
        # profile. Close it after verifying the guest entry UI so this smoke
        # can exercise the local AI board without pretending to authenticate.
        page.wait_for_selector("#authModal.show", timeout=10_000)
        page.evaluate("() => { if (typeof closeAuthModal === 'function') closeAuthModal(); else document.getElementById('authModal')?.classList.remove('show'); }")
        page.wait_for_selector("#authModal.show", state="hidden", timeout=5_000)

        page.set_viewport_size({"width": 390, "height": 844})
        page.wait_for_timeout(120)
        assert_no_overflow(page, "mobile lobby")
        page.screenshot(path=str(output_dir / "sky-island-home-mobile-390x844.png"), full_page=True)

        standard_before = page.evaluate("sessionStorage.getItem('gomoku_active_game_state')")
        # AI is a direct home action; the standard board keeps preview-on-down / commit-on-up.
        page.locator("[data-sky-action='ai']").click()
        page.wait_for_selector("#skyLobby", state="hidden")
        page.wait_for_timeout(250)
        notice_state = page.evaluate("() => ({ icon: document.getElementById('noticeIconBox')?.className, html: document.getElementById('noticeIconBox')?.innerHTML, text: document.getElementById('noticeTextBox')?.textContent })")
        assert "notice-ai-avatar" in (notice_state["icon"] or "") and page.locator("#noticeIconBox [role='img']").count() == 1, f"AI mode toast should use the selected AI portrait, not a robot emoji: {notice_state}"
        standard_canvas = page.locator("#cvs")
        standard_box = standard_canvas.bounding_box()
        assert standard_box and standard_box["width"] > 260
        # Avoid the traditional opening point so this also passes if a restored
        # standard game already owns the exact centre intersection.
        sx = standard_box["x"] + standard_box["width"] * 0.42
        sy = standard_box["y"] + standard_box["height"] * 0.42
        target_info = page.evaluate("""([x,y]) => {
          const el = document.elementFromPoint(x, y);
          return { tag: el?.tagName, id: el?.id, cls: String(el?.className || ''), body: document.body.className,
            standardState: sessionStorage.getItem('gomoku_active_game_state') };
        }""", [sx, sy])
        page.mouse.move(sx, sy)
        page.mouse.down()
        page.wait_for_timeout(160)
        assert page.locator('#cvs').get_attribute('data-preview-point'), target_info
        state_on_down = page.evaluate("sessionStorage.getItem('gomoku_active_game_state')")
        page.mouse.up()
        page.wait_for_function("Boolean(sessionStorage.getItem('gomoku_active_game_state'))")
        state_on_up = page.evaluate("sessionStorage.getItem('gomoku_active_game_state')")
        assert state_on_down != state_on_up, "standard move should commit on pointerup"
        page.screenshot(path=str(output_dir / "sky-island-standard-game-mobile.png"), full_page=True)

        page.locator(".sky-game-topbar [data-game-action='lobby']").click()
        page.wait_for_selector("#skyLobby", state="visible")
        page.locator("#skyLobby [data-sky-nav='friends']").click()
        page.wait_for_function("document.getElementById('skyLobby')?.dataset.activePage === 'friends'")
        assert page.locator("#skyLobby [data-sky-nav='friends']").get_attribute("aria-current") == "page"
        page.wait_for_timeout(80)
        page.screenshot(path=str(output_dir / "sky-island-social-entry-mobile.png"), full_page=True)

        assert not errors, errors
        # Browser network errors from deliberately unavailable cloud APIs are not JS console failures.
        relevant_console_errors = [item for item in console_errors if "Failed to load resource" not in item]
        assert not relevant_console_errors, relevant_console_errors
        browser.close()

    print("sky island vertical slice smoke: PASS")


if __name__ == "__main__":
    main()
