from playwright.sync_api import sync_playwright


def main():
    url = "http://127.0.0.1:3000/index.html"
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 390, "height": 844})
        page.goto(url, wait_until="domcontentloaded", timeout=30_000)
        page.wait_for_selector("#cvs", state="visible", timeout=15_000)
        page.locator("#btnGameTasks").click()
        page.wait_for_selector("#gameFeaturePanelModal.show", state="visible", timeout=5_000)
        page.wait_for_timeout(350)
        info = page.evaluate(
            """() => {
              const modal = document.querySelector('#gameFeaturePanelModal');
              const card = modal.querySelector('.online-modal-card');
              const modalStyle = getComputedStyle(modal);
              const cardStyle = getComputedStyle(card);
              return {
                modalClass: modal.className,
                modalStyleAttr: modal.getAttribute('style'),
                cardClass: card.className,
                modalZ: modalStyle.zIndex,
                modalOpacity: modalStyle.opacity,
                cardBackground: cardStyle.backgroundColor,
                cardOpacity: cardStyle.opacity,
                cardTransform: cardStyle.transform,
                modalRect: modal.getBoundingClientRect().toJSON(),
                cardRect: card.getBoundingClientRect().toJSON(),
                title: document.querySelector('#gameFeaturePanelTitle').innerText,
                matchingRules: [...document.styleSheets].flatMap(sheet => {
                  try { return [...sheet.cssRules]; } catch (_) { return []; }
                }).filter(rule => String(rule.selectorText || '').includes('online-modal-backdrop')).map(rule => ({selector: rule.selectorText, css: rule.style.cssText})),
              };
            }"""
        )
        page.screenshot(path="D:/小游戏/.codex-diagnostics/game-feature-panel-mobile.png", full_page=True)
        browser.close()
    print(info)


if __name__ == "__main__":
    main()
