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
        page.locator("#cvs").wait_for(state="visible", timeout=10_000)
        page.evaluate("() => window.ensureGomokuFeature('voice')")
        page.wait_for_function("() => window.__GOMOKU_VOICE_READY__ === true", timeout=10_000)
        assert page.evaluate("() => window.GomokuVoice.isEnabled()") is False
        assert page.locator("#gomokuVoicePanel").count() == 1
        assert page.locator("#gomokuVoicePanel").evaluate("el => getComputedStyle(el).display") == "none"
        # 未进入房间时不得请求麦克风，也不得抛异常。
        assert page.evaluate("() => window.GomokuVoice.toggle()") is False
        assert "请先进入联机房间" in page.locator("#gomokuVoiceStatus").inner_text()
        assert not errors, errors
        assert not console_errors, console_errors
        print('{"pass":true,"voiceLazyLoaded":true,"defaultOff":true,"permissionDeferred":true,"pageErrors":[]}')
        browser.close()


if __name__ == "__main__":
    try:
        main()
    except PlaywrightTimeoutError as error:
        raise AssertionError(str(error))
