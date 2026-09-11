import os

from playwright.sync_api import sync_playwright


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        desktop = browser.new_page(viewport={"width": 1365, "height": 900})
        errors = []
        desktop.on("console", lambda msg: errors.append(f"console:{msg.type}:{msg.text}") if msg.type == "error" else None)
        desktop.on("pageerror", lambda error: errors.append(f"pageerror:{error}"))
        desktop.route("**/api/site-version", lambda route: route.fulfill(status=200, content_type="application/json", body='{"code":0,"tag":"v1.0.120","build":121}'))

        desktop.goto("http://127.0.0.1:4173/", wait_until="networkidle")
        if os.environ.get("SAVE_SCREENSHOT") == "1":
            desktop.screenshot(path="D:/小游戏/.codex-diagnostics/official-site-home.png", full_page=True)
        assert "一盘棋" in desktop.title()
        assert desktop.locator("h1").inner_text().startswith("一盘棋")
        assert desktop.locator("[data-demo-board]").count() == 1
        desktop.locator("[data-demo-board]").click(position={"x": 120, "y": 120})
        assert "第 1 手" in desktop.locator("[data-demo-status]").inner_text()
        desktop.locator("[data-reset-board]").click()
        assert "第一手" in desktop.locator("[data-demo-status]").inner_text()
        assert errors == [], errors

        mobile = browser.new_page(viewport={"width": 390, "height": 844})
        mobile.route("**/api/site-version", lambda route: route.fulfill(status=200, content_type="application/json", body='{"code":0,"tag":"v1.0.120","build":121}'))
        mobile.goto("http://127.0.0.1:4173/", wait_until="networkidle")
        toggle = mobile.locator(".nav-toggle")
        assert toggle.is_visible()
        toggle.click()
        assert mobile.locator("#siteNav").get_attribute("class").find("is-open") >= 0
        mobile.locator("#siteNav a", has_text="下载").click()
        assert mobile.locator("#siteNav").get_attribute("class").find("is-open") == -1

        for path, marker in (("/help/", "怎样开始一局"), ("/privacy/", "我们保存什么"), ("/play/", "gomokuResourceLoader")):
            page = browser.new_page()
            page.goto(f"http://127.0.0.1:4173{path}", wait_until="networkidle")
            assert marker in page.content(), path
            page.close()

        browser.close()
    print("official site smoke: PASS")


if __name__ == "__main__":
    main()
