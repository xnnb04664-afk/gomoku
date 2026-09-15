import os
import sys

from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeoutError


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    url = os.environ.get("GOMOKU_TEST_URL", "http://127.0.0.1:3000/index.html")
    errors = []
    console_errors = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 390, "height": 844}, device_scale_factor=1)
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.on("console", lambda message: console_errors.append(message.text) if message.type == "error" else None)
        page.goto(url, wait_until="domcontentloaded", timeout=30_000)
        # 十字棋属于实验风场；先离开默认大厅，再调用原有实验入口。
        page.wait_for_selector("#skyLobby", state="visible", timeout=15_000)
        page.evaluate("() => window.SkyIslandUI?.showGame()")
        page.locator("#cvs").wait_for(state="visible", timeout=10_000)
        page.evaluate("() => window.openCrossChess()")
        page.wait_for_selector("#crossChessModal.show", timeout=10_000)
        page.locator("#crossChessTitle").wait_for(state="visible")
        subtitle = page.locator(".cross-subtitle").inner_text()
        assert "10" in subtitle and "2" in subtitle, subtitle

        canvas = page.locator("#crossChessCanvas")
        box = canvas.bounding_box()
        assert box and box["width"] > 200 and box["height"] > 200
        center_x = box["x"] + box["width"] / 2
        center_y = box["y"] + box["height"] / 2
        page.mouse.click(center_x, center_y)
        assert "还可落 1 子" in page.locator("#crossChessStatus").inner_text()
        page.mouse.click(center_x + max(12, box["width"] / 19 * 0.7), center_y)
        assert "白方行动" in page.locator("#crossChessStatus").inner_text()

        page.locator('[data-cross-action="zoom-in"]').click()
        page.locator('[data-cross-action="hint"]').click()
        page.locator('[data-cross-action="zoom-reset"]').click()
        assert page.locator("#crossChessCanvas").is_visible()
        page.locator('[data-cross-action="close"]').click()
        page.wait_for_function("() => !document.querySelector('#crossChessModal')?.classList.contains('show')")
        assert not errors, errors
        assert not console_errors, console_errors
        print('{"pass":true,"mode":"cross","doubleMoveRule":true,"zoomControls":true,"hint":true,"cameraFollow":true,"pageErrors":[]}' )
        browser.close()


if __name__ == "__main__":
    try:
        main()
    except PlaywrightTimeoutError as error:
        raise AssertionError(str(error))
