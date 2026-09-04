import json
import sys
import tempfile
from pathlib import Path

from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeoutError


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    errors = []
    page_errors = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 390, "height": 844}, device_scale_factor=1)
        page.on("console", lambda message: errors.append(message.text) if message.type == "error" else None)
        page.on("pageerror", lambda error: page_errors.append(str(error)))

        page.goto("http://127.0.0.1:3000/index.html", wait_until="domcontentloaded", timeout=30_000)
        try:
            page.wait_for_load_state("networkidle", timeout=15_000)
        except PlaywrightTimeoutError:
            # 外部 CDN 不应阻止核心页面完成；记录状态后继续检查本地功能。
            pass

        page.locator("#cvs").wait_for(state="visible", timeout=10_000)
        critical = page.evaluate(
            """
            () => ({
              title: document.title,
              version: document.querySelector('#appVersionDisplay')?.textContent?.trim() || '',
              canvas: Boolean(document.querySelector('#cvs')),
              playerLabels: Boolean(document.querySelector('#p1NameLabel') && document.querySelector('#p2NameLabel')),
              functions: ['draw', 'makeMove', 'checkWin', 'triggerGameEnd', 'showGameResultModal']
                .filter(name => typeof window[name] === 'function')
            })
            """
        )
        behavior = page.evaluate(
            """
            () => {
              let chatCapError = '';
              try {
                for (let i = 0; i < 120; i++) window.addMessage(2, `smoke-${i}`);
              } catch (error) {
                chatCapError = String(error);
              }
              return {
                chatRows: document.querySelectorAll('#chatHistoryBox .msg-row').length,
                chatCapOk: chatCapError === '' && document.querySelectorAll('#chatHistoryBox .msg-row').length <= 100,
                chatCapError,
                resizeScheduler: typeof window.scheduleBoardResize === 'function',
                apiFailover: typeof window.safeApiFetch === 'function'
              };
            }
            """
        )
        screenshot = Path(tempfile.gettempdir()) / "gomoku-optimization-smoke.png"
        page.screenshot(path=str(screenshot), full_page=False)
        print(json.dumps({
            "critical": critical,
            "behavior": behavior,
            "consoleErrors": errors,
            "pageErrors": page_errors,
            "screenshot": str(screenshot),
        }, ensure_ascii=False))
        browser.close()


if __name__ == "__main__":
    main()
