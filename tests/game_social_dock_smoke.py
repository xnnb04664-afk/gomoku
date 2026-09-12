import os

from playwright.sync_api import sync_playwright


def main():
    url = os.environ.get("GOMOKU_TEST_URL", "http://127.0.0.1:3000/index.html")
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 390, "height": 844})
        page.goto(url, wait_until="domcontentloaded", timeout=30_000)
        page.wait_for_selector("#cvs", state="visible", timeout=15_000)
        dock = page.locator("#gameSocialDock")
        assert dock.is_visible()
        buttons = page.locator("#gameSocialDock .game-social-dock-grid button")
        assert buttons.count() == 8
        assert page.evaluate("Array.from(document.querySelectorAll('#gameSocialDockGrid button')).map(node => node.id)") == [
            "btnGameFriends", "btnGameRecent", "btnGameRank", "btnGameBag",
            "btnGameTasks", "btnGameAchievements", "btnGameActivity", "btnGameSettings"
        ]
        assert "亲密关系" in (page.locator("#btnGameFriends").get_attribute("aria-label") or "")
        assert page.locator("#btnGameActivity").count() == 1
        assert page.locator("#btnGameSettings").count() == 1
        assert page.locator("#gameDiamondBalance").inner_text() == "💎 0 钻石"
        assert page.locator("#gameActivityModal").count() == 1
        assert page.locator(".game-recharge-package").count() == 3
        assert page.locator("#friendsModal .game-social-dock").count() == 0, "社交 dock 不应嵌套在好友遮罩"

        overflow = page.evaluate("document.documentElement.scrollWidth - window.innerWidth")
        assert overflow <= 1, f"social dock causes horizontal overflow: {overflow}px"
        if os.environ.get("SAVE_SCREENSHOT") == "1":
            page.screenshot(path="D:/小游戏/.codex-diagnostics/game-social-dock-mobile.png", full_page=True)

        page.evaluate("""() => {
          window.__dockNotice = '';
          window.showGameNotice = (text) => { window.__dockNotice = String(text); };
        }""")
        page.locator("#btnGameRecent").click()
        page.wait_for_function("window.__dockNotice.includes('最近对手')")
        page.locator("#btnGameActivity").click()
        page.wait_for_selector("#authModal.show", timeout=5_000)
        page.locator("#authModal").click(position={"x": 2, "y": 2})
        page.evaluate("window.openGameRecharge()")
        page.wait_for_selector("#authModal.show", timeout=5_000)
        page.locator("#authModal").click(position={"x": 2, "y": 2})

        page.locator("#btnGameSettings").click()
        page.wait_for_selector("#themeModal.show", timeout=5_000)
        order_rows = page.locator("#gameFeatureOrderList .game-feature-order-row")
        assert order_rows.count() == 8
        assert page.locator("#gameFeatureOrderList .game-feature-order-row").first.get_attribute("data-feature-id") == "btnGameFriends"
        order_rows.first.locator(".game-feature-order-down").click()
        assert page.evaluate("Array.from(document.querySelectorAll('#gameSocialDockGrid button')).map(node => node.id)")[:2] == ["btnGameRecent", "btnGameFriends"]
        assert page.evaluate("JSON.parse(localStorage.getItem('gomoku_game_dock_order_v1'))")[:2] == ["btnGameRecent", "btnGameFriends"]
        page.locator("#gameDockOrderSettings").get_by_role("button", name="恢复默认").click()
        assert page.evaluate("Array.from(document.querySelectorAll('#gameSocialDockGrid button')).map(node => node.id)")[:2] == ["btnGameFriends", "btnGameRecent"]
        page.locator("#themeModal").click(position={"x": 2, "y": 2})
        browser.close()
    print("game social dock smoke: PASS")


if __name__ == "__main__":
    main()
