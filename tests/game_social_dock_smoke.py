import os

from playwright.sync_api import sync_playwright


def assert_collapsed_fab_clear(page):
    geometry = page.evaluate("""
      () => {
        const fab = document.getElementById('gameSocialDockFab');
        const roomExit = document.getElementById('btnLeaveRoom');
        const previousRoomExitDisplay = roomExit?.style.display || '';
        if (roomExit) roomExit.style.display = 'inline-flex';
        const fabRect = fab?.getBoundingClientRect();
        const visibleControls = [...document.querySelectorAll('.bottom-controls .btn-ctrl')]
          .filter(node => {
            const style = getComputedStyle(node);
            const rect = node.getBoundingClientRect();
            return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
          });
        const overlaps = visibleControls.filter(node => {
          const rect = node.getBoundingClientRect();
          return fabRect && rect.left < fabRect.right && rect.right > fabRect.left
            && rect.top < fabRect.bottom && rect.bottom > fabRect.top;
        }).map(node => node.id);
        const fabVisibleText = [...(fab?.querySelectorAll(':scope > span') || [])]
          .filter(node => {
            const style = getComputedStyle(node);
            return style.display !== 'none' && style.visibility !== 'hidden';
          })
          .map(node => node.textContent || '')
          .join('')
          .trim();
        if (roomExit) roomExit.style.display = previousRoomExitDisplay;
        return {
          overlaps,
          fabText: fab?.querySelector('span[aria-hidden="true"]')?.textContent || '',
          fabVisibleText,
          roomExitTested: Boolean(roomExit),
          fabTop: fabRect?.top || 0,
          fabBottom: fabRect?.bottom || 0,
          viewportHeight: window.innerHeight,
        };
      }
    """)
    assert geometry["overlaps"] == [], f"collapsed FAB overlaps bottom controls: {geometry}"
    assert geometry["fabText"] == "⌃", f"collapsed FAB still has feature text: {geometry}"
    assert geometry["fabVisibleText"] == "⌃", f"collapsed FAB has visible text besides ⌃: {geometry}"
    assert geometry["roomExitTested"], "room exit control was not included in geometry regression"


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

        # 八按钮区可收起，收起后保留独立的小入口，并记住本机状态。
        toggle = page.locator("#btnGameDockToggle")
        fab = page.locator("#gameSocialDockFab")
        assert not page.evaluate("document.querySelector('#gameSocialDock')?.classList.contains('is-collapsed')")
        assert toggle.get_attribute("aria-expanded") == "true"
        assert page.locator("#gameSocialDockGrid").is_visible()
        toggle.click()
        page.wait_for_function("() => document.querySelector('#gameSocialDock')?.classList.contains('is-collapsed')")
        assert page.locator("#gameSocialDockGrid").is_hidden()
        assert fab.is_visible()
        assert fab.get_attribute("aria-expanded") == "false"
        assert page.evaluate("document.activeElement?.id") == "gameSocialDockFab"
        assert_collapsed_fab_clear(page)
        fab.click()
        page.wait_for_function("() => !document.querySelector('#gameSocialDock')?.classList.contains('is-collapsed')")
        assert page.locator("#gameSocialDockGrid").is_visible()
        assert toggle.get_attribute("aria-expanded") == "true"
        assert page.evaluate("document.activeElement?.id") == "btnGameDockToggle"
        toggle.click()
        page.reload(wait_until="domcontentloaded")
        page.wait_for_selector("#cvs", state="visible", timeout=15_000)
        page.wait_for_function("() => document.querySelector('#gameSocialDock')?.classList.contains('is-collapsed')")
        assert page.locator("#gameSocialDockGrid").is_hidden()
        assert page.locator("#gameSocialDockFab").is_visible()
        assert_collapsed_fab_clear(page)
        page.locator("#gameSocialDockFab").click()
        page.wait_for_function("() => !document.querySelector('#gameSocialDock')?.classList.contains('is-collapsed')")

        panel_buttons = {
            "btnGameRecent": "最近对手",
            "btnGameBag": "背包",
            "btnGameTasks": "任务中心",
            "btnGameAchievements": "成就墙",
        }
        for button_id, expected_title in panel_buttons.items():
            page.locator(f"#{button_id}").click()
            page.wait_for_selector("#gameFeaturePanelModal.show", state="visible", timeout=5_000)
            assert page.locator("#gameFeaturePanelTitle").inner_text() == expected_title
            page.locator("#gameFeaturePanelModal .game-feature-panel-close").click()
            page.wait_for_selector("#gameFeaturePanelModal.show", state="hidden", timeout=5_000)

        overflow = page.evaluate("document.documentElement.scrollWidth - window.innerWidth")
        assert overflow <= 1, f"social dock causes horizontal overflow: {overflow}px"
        if os.environ.get("SAVE_SCREENSHOT") == "1":
            page.screenshot(path="D:/小游戏/.codex-diagnostics/game-social-dock-mobile.png", full_page=True)

        page.locator("#btnGameRecent").click()
        page.wait_for_selector("#gameFeaturePanelModal.show", state="visible", timeout=5_000)
        assert page.locator("#gameFeaturePanelTitle").inner_text() == "最近对手"
        page.locator("#gameFeaturePanelModal .game-feature-panel-close").click()
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

        # 桌面宽屏也必须把收起入口放在底部两行操作按钮之外。
        page.set_viewport_size({"width": 1440, "height": 900})
        page.reload(wait_until="domcontentloaded")
        page.wait_for_selector("#cvs", state="visible", timeout=15_000)
        page.wait_for_function("() => !document.querySelector('#gameSocialDock')?.classList.contains('is-collapsed')")
        page.locator("#btnGameDockToggle").click()
        page.wait_for_function("() => document.querySelector('#gameSocialDock')?.classList.contains('is-collapsed')")
        assert_collapsed_fab_clear(page)
        browser.close()
    print("game social dock smoke: PASS")


if __name__ == "__main__":
    main()
