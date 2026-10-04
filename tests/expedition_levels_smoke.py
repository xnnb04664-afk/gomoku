import json
import re
from pathlib import Path

from playwright.sync_api import sync_playwright


ROOT = Path(r"D:\小游戏\五子棋")
URL = "http://127.0.0.1:3000/index.html?expedition-levels=20261002"
SCREENSHOT_DIR = ROOT / ".codex-diagnostics"


def main() -> None:
    SCREENSHOT_DIR.mkdir(exist_ok=True)
    progress = {"schema": 1, "completed": [f"island-{index:02d}" for index in range(1, 37)], "current": 36}
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        context = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=1)
        context.add_init_script(
            f"localStorage.setItem('gomoku_expedition_progress_v1', {json.dumps(json.dumps(progress))});"
            "localStorage.removeItem('gomoku_expedition_state_v1');"
        )
        page = context.new_page()
        page_errors = []
        page.on("pageerror", lambda error: page_errors.append(str(error)))
        page.goto(URL, wait_until="domcontentloaded")
        page.wait_for_selector("#skyLobby", timeout=10000)
        page.wait_for_function("document.getElementById('startupSplash')?.hidden === true", timeout=6000)
        page.wait_for_timeout(120)
        page.get_by_role("button", name=re.compile("开始远征|继续远征")).click()
        page.wait_for_selector("#skyExpedition.show", timeout=5000)

        assert page.locator(".exp-node").count() == 48
        assert page.locator(".exp-title small").inner_text().startswith("8 章 · 48 关")
        assert "active" in (page.locator(".exp-node").nth(36).get_attribute("class") or "")
        assert page.locator(".exp-node").last.get_attribute("aria-label") == "天穹王座"
        page.screenshot(path=str(SCREENSHOT_DIR / "expedition-levels-mobile.png"), full_page=True)

        page.locator(".exp-node").nth(24).click()
        assert "高级" in page.locator("#expKicker").inner_text()
        canvas = page.locator("#skyExpeditionCanvas")
        box = canvas.bounding_box()
        assert box is not None
        size = box["width"]
        pad = size * 0.055
        cell = (size - pad * 2) / 15

        def click_cell(row: int, col: int) -> None:
            page.mouse.click(box["x"] + pad + ((col + 0.5) * cell), box["y"] + pad + ((row + 0.5) * cell))
            page.wait_for_timeout(520)

        click_cell(12, 5)
        click_cell(12, 6)
        assert page.evaluate("window.GomokuExpedition.getSnapshot().status") == "won"

        page.locator(".exp-node").last.click()
        assert page.locator("#expLevelName").inner_text() == "天穹王座"
        assert page.locator("#expKicker").inner_text().endswith("48/48")

        box = canvas.bounding_box()
        assert box is not None
        size = box["width"]
        pad = size * 0.055
        cell = (size - pad * 2) / 15
        for row, col in ((5, 5), (6, 6), (7, 7), (8, 8)):
            page.mouse.click(box["x"] + pad + ((col + 0.5) * cell), box["y"] + pad + ((row + 0.5) * cell))
            page.wait_for_timeout(520)
        assert page.evaluate("window.GomokuExpedition.getSnapshot().status") == "won"

        desktop = browser.new_page(viewport={"width": 1440, "height": 900}, device_scale_factor=1)
        desktop.goto(URL, wait_until="domcontentloaded")
        desktop.wait_for_selector("#skyLobby", timeout=10000)
        desktop.wait_for_function("document.getElementById('startupSplash')?.hidden === true", timeout=6000)
        desktop.wait_for_timeout(120)
        desktop.get_by_role("button", name=re.compile("开始远征|继续远征")).click()
        desktop.wait_for_selector("#skyExpedition.show", timeout=5000)
        assert desktop.locator(".exp-node").count() == 48
        assert desktop.locator(".exp-route").evaluate("node => node.scrollHeight > node.clientHeight")
        desktop.screenshot(path=str(SCREENSHOT_DIR / "expedition-levels-desktop.png"), full_page=True)

        if page_errors:
            raise AssertionError("; ".join(page_errors))
        print("expedition levels smoke: PASS (48 levels, legacy progress migrated, professional sequence playable)")
        desktop.close()
        context.close()
        browser.close()


if __name__ == "__main__":
    main()
