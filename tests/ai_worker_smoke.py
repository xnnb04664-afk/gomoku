import json
import os
from pathlib import Path

from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeoutError


ROOT = Path(__file__).resolve().parents[1]


def test_page(page, url, expected_inline):
    page.route(
        "https://gomoku-api.pages.dev/api/version**",
        lambda route: route.fulfill(
            status=200,
            content_type="application/json",
            body=json.dumps({
                "code": 0,
                "tag": "v1.0.100",
                "apkPath": "/api/update/apk",
                "htmlPath": "/api/update/html",
                "apkTicket": "test-apk-ticket",
                "htmlTicket": "test-html-ticket",
                "htmlSha256": "0" * 64,
            }),
        ),
    )
    console_errors = []
    page_errors = []
    page.on("console", lambda message: console_errors.append(message.text) if message.type == "error" else None)
    page.on("pageerror", lambda error: page_errors.append(str(error)))
    page.goto(url, wait_until="domcontentloaded", timeout=30_000)
    try:
        page.wait_for_load_state("networkidle", timeout=15_000)
    except PlaywrightTimeoutError:
        pass
    page.locator("#cvs").wait_for(state="visible", timeout=10_000)

    result = page.evaluate(
        """
        async (expectedInline) => {
          const sourceNode = document.getElementById('gomokuAiWorkerSource');
          const actualInline = Boolean(sourceNode && sourceNode.textContent && sourceNode.textContent.length > 20000);
          const win = Array.from({length: 15}, () => Array(15).fill(0));
          for (let c = 3; c < 7; c++) win[7][c] = 2;
          let ticks = 0;
          const timer = setInterval(() => { ticks++; }, 16);
          const started = performance.now();
          const move = await window.requestFastAiMove(win, []);
          const elapsedMs = Math.round(performance.now() - started);
          clearInterval(timer);
          return {
            actualInline,
            inlineOk: actualInline === expectedInline,
            move,
            elapsedMs,
            ticks,
            stats: window.gomokuLastAiStats || null
          };
        }
        """,
        expected_inline,
    )
    expected_win = result["move"]["r"] == 7 and result["move"]["c"] in (2, 7)
    result["winTacticOk"] = expected_win
    result["uiStayedResponsive"] = result["ticks"] >= 1
    result["consoleErrors"] = console_errors
    result["pageErrors"] = page_errors
    result["ok"] = all([
        result["inlineOk"],
        result["winTacticOk"],
        result["uiStayedResponsive"],
        not console_errors,
        not page_errors,
    ])
    return result


def main():
    base_url = os.environ.get("GOMOKU_TEST_URL", "http://127.0.0.1:3000")
    results = {}
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        for relative, expected_inline in (("/index.html", False), ("/五子棋大师_单文件版.html", True)):
            page = browser.new_page(viewport={"width": 390, "height": 844}, device_scale_factor=1)
            results[relative] = test_page(page, base_url + relative, expected_inline)
            page.close()
        browser.close()
    print(json.dumps(results, ensure_ascii=False))
    if not all(item["ok"] for item in results.values()):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
