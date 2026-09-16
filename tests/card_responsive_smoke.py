import os
from pathlib import Path

from playwright.sync_api import sync_playwright


VIEWPORTS = ((1440, 900), (390, 844), (320, 568))


def assert_no_horizontal_overflow(page, label):
    overflow = page.evaluate("document.documentElement.scrollWidth - window.innerWidth")
    assert overflow <= 1, f"{label} page overflow: {overflow}px"


def inspect_visible_controls(page, label):
    selectors = [
        ".card-slot",
        ".bottom-controls .btn-ctrl",
        ".sky-game-topbar button",
        ".game-social-dock-grid button",
        ".sky-lobby-nav button",
        ".sky-mode-rail button",
        ".sky-primary-action",
        ".sky-space-command-line button",
        ".sky-route-button",
    ]
    clipped = page.evaluate(
        """(selectors) => selectors.flatMap(selector => Array.from(document.querySelectorAll(selector))
          .filter(element => {
            const style = getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
          })
          .map(element => ({
            selector,
            text: (element.innerText || element.getAttribute('aria-label') || '').trim(),
            clientWidth: element.clientWidth,
            scrollWidth: element.scrollWidth,
            right: element.getBoundingClientRect().right,
          }))
          .filter(item => item.scrollWidth - item.clientWidth > 4 || item.right > window.innerWidth + 1))""",
        selectors,
    )
    assert not clipped, f"{label} visible control clipping: {clipped}"


def main():
    url = os.environ.get("GOMOKU_TEST_URL", "http://127.0.0.1:3000/index.html")
    output_dir = Path(os.environ.get("GOMOKU_SCREENSHOT_DIR", "D:/小游戏/.codex-diagnostics"))
    output_dir.mkdir(parents=True, exist_ok=True)
    page_errors = []

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        for width, height in VIEWPORTS:
            context = browser.new_context(viewport={"width": width, "height": height}, device_scale_factor=1)
            context.add_init_script("localStorage.clear(); sessionStorage.clear();")
            page = context.new_page()
            page.on("pageerror", lambda error: page_errors.append(f"{width}x{height}: {error}"))
            page.goto(url, wait_until="domcontentloaded", timeout=30_000)
            page.wait_for_selector("#skyLobby", state="visible", timeout=15_000)
            assert_no_horizontal_overflow(page, f"{width}x{height} lobby")
            inspect_visible_controls(page, f"{width}x{height} lobby")
            for nav in ("friends", "records", "me"):
                page.locator(f"[data-sky-nav='{nav}']").click()
                page.wait_for_selector(f"#skyNavWorkspace[data-screen='{nav}']", state="visible", timeout=5_000)
                assert_no_horizontal_overflow(page, f"{width}x{height} {nav}")
                inspect_visible_controls(page, f"{width}x{height} {nav}")
            page.locator("[data-sky-nav='game']").click()

            page.locator("[data-sky-action='quick']").click()
            page.wait_for_selector("#skySheetBackdrop.show", state="visible", timeout=10_000)
            page.locator("[data-sheet-action='pvp']").click()
            page.wait_for_selector("body.sky-game-open", timeout=10_000)
            page.wait_for_selector("#cvs", state="visible", timeout=15_000)
            page.locator("[data-game-action='more']").click()
            page.wait_for_selector("body.sky-cards-open", timeout=5_000)
            page.wait_for_selector("#cardSlotsArea .card-slot", state="visible", timeout=5_000)

            cards = page.locator("#cardSlotsArea .card-slot")
            assert cards.count() == 3, f"{width}x{height} expected 3 skill buttons"
            assert all(cards.nth(index).evaluate("element => element.tagName") == "BUTTON" for index in range(3))
            for index in range(3):
                card = cards.nth(index)
                subtitle = card.locator(".slot-sub")
                assert subtitle.is_visible(), f"{width}x{height} card {index} description is hidden"
                style = subtitle.evaluate(
                    "element => ({whiteSpace: getComputedStyle(element).whiteSpace, lineClamp: getComputedStyle(element).webkitLineClamp})"
                )
                assert style["whiteSpace"] == "normal", style
                assert style["lineClamp"] in ("2", "-webkit-line-clamp: 2"), style
                assert card.get_attribute("aria-label"), f"{width}x{height} card {index} lacks an accessible label"

            assert_no_horizontal_overflow(page, f"{width}x{height}")
            inspect_visible_controls(page, f"{width}x{height}")
            page.screenshot(path=str(output_dir / f"card-responsive-{width}x{height}.png"), full_page=True)
            context.close()

        assert not page_errors, page_errors
        browser.close()

    print("card responsive smoke: PASS")


if __name__ == "__main__":
    main()
