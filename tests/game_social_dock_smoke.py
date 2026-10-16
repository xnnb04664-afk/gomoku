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
        context = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=1)
        context.add_init_script("localStorage.clear(); sessionStorage.clear();")
        page = context.new_page()
        page.goto(url, wait_until="domcontentloaded", timeout=30_000)
        page.wait_for_selector("#skyLobby", state="visible", timeout=15_000)
        page.wait_for_selector("#cvs", state="attached", timeout=15_000)
        page.wait_for_selector("#authModal.show", timeout=10_000)
        page.evaluate("() => { if (typeof closeAuthModal === 'function') closeAuthModal(); else document.getElementById('authModal')?.classList.remove('show'); }")
        page.wait_for_selector("#authModal.show", state="hidden", timeout=5_000)

        # The old eight-button dock remains mounted for compatibility, but the
        # new product surface is the four-item lobby navigation and sheets.
        assert page.locator("#gameSocialDock").count() == 1
        assert page.locator("#gameSocialDock").is_hidden()
        assert page.locator("#skyLobby [data-sky-nav]").count() == 4
        assert [page.locator("#skyLobby [data-sky-nav]").nth(i).get_attribute("data-sky-nav") for i in range(4)] == [
            "game", "friends", "records", "me"
        ]
        home_actions = page.locator("#skyLobby .sky-route-list [data-sky-action]")
        assert home_actions.count() == 3
        home_text = page.locator("#skyLobby .sky-route-list").inner_text()
        assert all(label in home_text for label in ("AI 对战", "匹配对决", "跟好友玩"))

        page.locator("[data-sky-action='friend-play']").click()
        page.wait_for_selector("#skySheetBackdrop.show", state="visible")
        sheet_text = page.locator("#skySheetBody").inner_text()
        assert all(label in sheet_text for label in ("从好友列表邀战", "创建好友房间", "加入好友房间"))
        page.locator("#skySheetBackdrop").click(position={"x": 4, "y": 4})

        # Matching opens its online dialog and waits for the user to start;
        # it must not jump straight into a board.
        page.locator("#skyLobby .sky-route-list [data-sky-action='match']").click()
        page.wait_for_selector("#onlineModal.show", state="visible")
        assert page.locator("#skyLobby").is_visible()
        assert not page.locator("body").evaluate("node => node.classList.contains('sky-game-open')")
        page.evaluate("window.closeOnlineModal?.()")

        # Entering a standard game keeps the board and all existing controls.
        page.locator("[data-sky-action='ai']").click()
        page.wait_for_selector("#skyLobby", state="hidden", timeout=15_000)
        page.wait_for_selector("#cvs", state="visible", timeout=15_000)
        page.wait_for_function("document.body.classList.contains('sky-cards-open')")
        assert page.locator(".card-area-wrapper").is_visible()
        page.locator(".sky-game-topbar [data-game-action='more']").click()
        page.wait_for_function("!document.body.classList.contains('sky-cards-open')")
        page.locator(".sky-game-topbar [data-game-action='more']").click()
        page.wait_for_function("document.body.classList.contains('sky-cards-open')")
        page.wait_for_function("getComputedStyle(document.querySelector('.card-area-wrapper')).visibility === 'visible'")
        assert page.locator(".card-area-wrapper").is_visible()
        page.locator(".sky-game-topbar [data-game-action='lobby']").click()
        page.wait_for_selector("#skyLobby", state="visible", timeout=15_000)

        # Each navigation tab changes the main page independently. Private
        # account checks apply only when opening account-bound social actions.
        page.locator("#skyLobby [data-sky-nav='friends']").click()
        page.wait_for_function("document.getElementById('skyLobby')?.dataset.activePage === 'friends'")
        page.locator("#skyLobby [data-sky-action='friend-center']").click()
        page.wait_for_selector("#authModal.show", state="visible", timeout=10_000)
        page.wait_for_function("getComputedStyle(document.querySelector('#authModal')).opacity === '1'")
        page.locator("#authModal").click(position={"x": 2, "y": 2})

        page.locator("#skyLobby [data-sky-nav='records']").click()
        page.wait_for_function("document.getElementById('skyLobby')?.dataset.activePage === 'records'")
        page.locator("#skyLobby [data-sky-action='history']").click()
        page.wait_for_selector("#historyModal.show", state="visible", timeout=10_000)
        history_z = page.evaluate("""() => { const e=document.querySelector('#historyModal'),s=getComputedStyle(e); return {inline:e.style.zIndex,computed:s.zIndex,body:document.body.className,top:document.elementFromPoint(2,2)?.id}; }""")
        assert history_z["computed"] == "100040", history_z
        page.evaluate("window.closeHistoryModal()")

        page.locator("#skyLobby [data-sky-nav='me']").click()
        page.wait_for_function("document.getElementById('skyLobby')?.dataset.activePage === 'me'")
        me_text = page.locator("#skyLobby [data-sky-page='me']").inner_text()
        assert "我的棋岛" in me_text
        assert "背景音乐" in me_text and "棋盘画质" in me_text

        overflow = page.evaluate("document.documentElement.scrollWidth - window.innerWidth")
        assert overflow <= 1, f"new lobby causes horizontal overflow: {overflow}px"
        if os.environ.get("SAVE_SCREENSHOT") == "1":
            page.screenshot(path="D:/小游戏/.codex-diagnostics/game-social-dock-mobile.png", full_page=True)
        browser.close()
    print("game social dock smoke: PASS")


if __name__ == "__main__":
    main()
