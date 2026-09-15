import os
from pathlib import Path

from playwright.sync_api import sync_playwright


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        desktop = browser.new_page(viewport={"width": 1365, "height": 900})
        errors = []
        desktop.on("console", lambda msg: errors.append(f"console:{msg.type}:{msg.text}") if msg.type == "error" else None)
        desktop.on("pageerror", lambda error: errors.append(f"pageerror:{error}"))
        desktop.route("**/api/site-version", lambda route: route.fulfill(status=200, content_type="application/json", body='{"code":0,"tag":"v1.0.124","build":125}'))

        desktop.goto("http://127.0.0.1:4173/", wait_until="networkidle")
        if os.environ.get("SAVE_SCREENSHOT") == "1":
            desktop.screenshot(path="D:/小游戏/.codex-diagnostics/official-site-home.png", full_page=True)
        assert "一盘棋" in desktop.title()
        assert desktop.locator("h1").inner_text().startswith("一盘棋")
        assert desktop.locator('meta[name="description"]').get_attribute("content")
        assert desktop.locator('meta[name="robots"]').get_attribute("content") == "index,follow"
        assert desktop.locator('link[rel="canonical"]').get_attribute("href") == "https://gomoku-home.pages.dev/"
        assert desktop.locator('meta[property="og:url"]').get_attribute("content") == "https://gomoku-home.pages.dev/"
        assert desktop.locator("h1").count() == 1
        assert desktop.locator('#siteNav a[href="/social/"]').count() == 1
        assert desktop.locator('.social-retention-note').inner_text().startswith("私聊消息会永久保存在云端数据库")
        assert desktop.locator(".js-version").first.inner_text() == "v1.2.4"
        assert desktop.locator(".js-build").first.inner_text() == "125"
        assert desktop.locator("[data-demo-status]").get_attribute("aria-live") == "polite"
        assert "@media (prefers-reduced-motion: reduce)" in Path("official-site/styles.css").read_text(encoding="utf-8")
        headers = Path("official-site/_headers").read_text(encoding="utf-8")
        assert "Permissions-Policy: camera=(), microphone=(self), geolocation=()" in headers
        assert desktop.locator("[data-demo-board]").count() == 1
        desktop.locator("[data-demo-board]").click(position={"x": 120, "y": 120})
        assert "第 1 手" in desktop.locator("[data-demo-status]").inner_text()
        desktop.locator("[data-reset-board]").click()
        assert "第一手" in desktop.locator("[data-demo-status]").inner_text()
        assert errors == [], errors

        mobile = browser.new_page(viewport={"width": 390, "height": 844})
        mobile.route("**/api/site-version", lambda route: route.fulfill(status=200, content_type="application/json", body='{"code":0,"tag":"v1.0.124","build":125}'))
        mobile.goto("http://127.0.0.1:4173/", wait_until="networkidle")
        toggle = mobile.locator(".nav-toggle")
        assert toggle.is_visible()
        assert toggle.get_attribute("aria-expanded") == "false"
        assert toggle.get_attribute("aria-label") == "打开导航"
        toggle.click()
        assert mobile.locator("#siteNav").get_attribute("class").find("is-open") >= 0
        assert toggle.get_attribute("aria-expanded") == "true"
        assert toggle.get_attribute("aria-label") == "关闭导航"
        mobile.locator("#siteNav a", has_text="下载").click()
        assert mobile.locator("#siteNav").get_attribute("class").find("is-open") == -1
        assert toggle.get_attribute("aria-expanded") == "false"
        assert toggle.get_attribute("aria-label") == "打开导航"
        for width in (320, 390):
            compact = browser.new_page(viewport={"width": width, "height": 844})
            compact.goto("http://127.0.0.1:4173/", wait_until="networkidle")
            assert compact.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1")
            compact.close()

        for path, marker in (("/help/", "怎样开始一局"), ("/privacy/", "我们保存什么"), ("/play/", "gomokuResourceLoader")):
            page = browser.new_page(viewport={"width": 320, "height": 844} if path != "/play/" else {"width": 390, "height": 844})
            page.goto(f"http://127.0.0.1:4173{path}", wait_until="networkidle")
            assert marker in page.content(), path
            if path in ("/help/", "/privacy/"):
                assert page.locator('link[rel="canonical"]').get_attribute("href") == f"https://gomoku-home.pages.dev{path}"
                assert page.locator('meta[name="robots"]').get_attribute("content") == "index,follow"
                assert page.locator(".doc-nav").get_attribute("aria-label") == "文档导航"
                assert page.locator(".doc-nav").is_visible()
                assert page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1")
            if path == "/play/":
                assert "openFriendsFromHash" in page.content()
                assert page.locator("#gameSocialDock .game-social-dock-grid button").count() == 8
                assert "亲密关系" in (page.locator("#btnGameFriends").get_attribute("aria-label") or "")
                assert page.locator("#btnGameSettings").count() == 1
                assert page.locator('.official-return-strip a[href="/social/"]').count() == 1
            page.close()

        social = browser.new_page(viewport={"width": 390, "height": 844})
        social.goto("http://127.0.0.1:4173/social/", wait_until="domcontentloaded")
        assert social.locator("#socialPageTitle").inner_text().startswith("把棋友")
        assert social.locator('iframe[title="五子棋好友中心"]').get_attribute("src") == "/play/#friends"
        assert social.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1")
        social.close()

        browser.close()
    print("official site smoke: PASS")


if __name__ == "__main__":
    main()
