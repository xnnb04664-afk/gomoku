import os
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright


def board_point(box, row, col):
    pad = box["width"] * 0.055
    cell = (box["width"] - pad * 2) / 15
    return (
        box["x"] + pad + (col + 0.5) * cell,
        box["y"] + pad + (row + 0.5) * cell,
    )


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
        page.goto(url, wait_until="domcontentloaded", timeout=30_000)
        page.wait_for_selector("#skyLobby", state="visible", timeout=15_000)
        page.wait_for_selector("#cvs", state="attached", timeout=15_000)

        assert page.locator("#skyLobby [data-sky-nav]").count() == 4
        assert page.locator("#skyLobby [data-sky-action='expedition']").is_visible()
        assert "今日岛讯" in page.locator("#skyLobby").inner_text()
        assert page.locator("script[src='js/expedition.js']").count() == 0, "expedition must stay lazy"
        assert_no_overflow(page, "desktop lobby")
        page.screenshot(path=str(output_dir / "sky-island-home-desktop-1440x900.png"), full_page=True)

        page.locator("[data-sky-action='quick']").click()
        page.wait_for_selector("#skySheetBackdrop.show", state="visible")
        assert "与大师 AI 对弈" in page.locator("#skySheetBody").inner_text()
        page.screenshot(path=str(output_dir / "sky-island-mode-sheet-desktop.png"), full_page=True)
        page.locator("#skySheetBackdrop").click(position={"x": 4, "y": 4})

        page.set_viewport_size({"width": 390, "height": 844})
        page.wait_for_timeout(120)
        assert_no_overflow(page, "mobile lobby")
        page.screenshot(path=str(output_dir / "sky-island-home-mobile-390x844.png"), full_page=True)

        standard_before = page.evaluate("sessionStorage.getItem('gomoku_active_game_state')")
        page.locator("[data-sky-action='expedition']").click()
        page.wait_for_selector("#skyExpedition.show", state="visible", timeout=15_000)
        page.wait_for_selector("#skyExpeditionCanvas", state="visible")
        assert page.locator("script[src='js/expedition.js']").count() == 1
        assert page.evaluate("GomokuExpedition.levels.length") == 7
        assert page.evaluate("GomokuExpedition.getSnapshot().levelId") == "island-01"
        assert_no_overflow(page, "expedition")
        page.screenshot(path=str(output_dir / "sky-island-expedition-board-390x844.png"), full_page=True)

        canvas = page.locator("#skyExpeditionCanvas")
        box = canvas.bounding_box()
        assert box and box["width"] >= 280 and box["height"] >= 280, box
        x, y = board_point(box, 7, 9)
        page.mouse.move(x, y)
        page.mouse.down()
        page.wait_for_function("document.querySelector('#skyExpeditionCanvas')?.dataset.previewPoint === '7,9'")
        assert page.evaluate("GomokuExpedition.getSnapshot().history.length") == 0, "pointerdown must only preview"
        page.screenshot(path=str(output_dir / "sky-island-ghost-piece-mobile.png"), full_page=True)
        page.mouse.up()
        page.wait_for_function("GomokuExpedition.getSnapshot().status === 'won'")
        snapshot = page.evaluate("GomokuExpedition.getSnapshot()")
        assert len(snapshot["winningLine"]) >= 5
        assert snapshot["history"][-1]["r"] == 7 and snapshot["history"][-1]["c"] == 9
        page.wait_for_selector("#expResult.show", state="visible", timeout=3_000)
        page.screenshot(path=str(output_dir / "sky-island-result-drawer-mobile.png"), full_page=True)

        page.locator("#skyExpedition [data-exp-action='close']").click()
        page.wait_for_function("!GomokuExpedition.isOpen()")
        assert page.evaluate("sessionStorage.getItem('gomoku_active_game_state')") == standard_before

        # Standard board stays reachable and uses preview-on-down / commit-on-up.
        page.locator("[data-sky-action='quick']").click()
        page.locator("[data-sheet-action='pvp']").click()
        page.wait_for_selector("#skyLobby", state="hidden")
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
            expedition: getComputedStyle(document.querySelector('#skyExpedition')).display,
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
        page.wait_for_selector("#skyNavWorkspace[data-screen='friends']", state="visible", timeout=10_000)
        assert "棋友在云上相逢" in page.locator("#skyNavWorkspace").inner_text()
        page.screenshot(path=str(output_dir / "sky-island-friends-screen-mobile.png"), full_page=True)
        page.locator("[data-nav-action='friends-open']").click()
        page.wait_for_selector("#authModal.show", state="visible", timeout=10_000)
        page.wait_for_function("getComputedStyle(document.querySelector('#authModal')).opacity === '1'")
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
