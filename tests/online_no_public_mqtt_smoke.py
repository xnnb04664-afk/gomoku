import json
import os

from playwright.sync_api import sync_playwright


def main():
    import sys
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")

    url = os.environ.get("GOMOKU_TEST_URL", "http://127.0.0.1:3000/index.html")
    mqtt_requests = []
    page_errors = []
    console_errors = []

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 390, "height": 844}, device_scale_factor=1)
        page.add_init_script("window.__GOMOKU_DISABLE_RELAY__ = true;")
        page.route("**/js/mqtt.min.js", lambda route: (mqtt_requests.append(route.request.url), route.abort()))
        page.on("pageerror", lambda error: page_errors.append(str(error)))
        page.on("console", lambda message: console_errors.append(message.text) if message.type == "error" else None)
        page.goto(url, wait_until="domcontentloaded", timeout=30_000)
        page.locator("#cvs").wait_for(state="visible", timeout=10_000)

        result = page.evaluate(
            """
            async () => {
              try {
                await window.getOrCreateOnlineTransport('123456', 'host', 'legacy-disabled-test');
                return { ok: true, message: '' };
              } catch (error) {
                return { ok: false, message: String(error && error.message || error) };
              }
            }
            """
        )
        browser.close()

    passed = (
        result.get("ok") is False
        and "项目联机中继不可用" in result.get("message", "")
        and not mqtt_requests
        and not page_errors
        and all("项目自有 WebSocket 中继不可用" in message for message in console_errors)
    )
    print(json.dumps({
        "pass": passed,
        "transportRejected": result,
        "mqttRequests": mqtt_requests,
        "pageErrors": page_errors,
        "consoleErrors": console_errors,
    }, ensure_ascii=False, indent=2))
    if not passed:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
