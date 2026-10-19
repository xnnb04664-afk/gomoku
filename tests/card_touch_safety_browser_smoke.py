"""Browser regression for the match card drawer's touch boundary."""

from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from urllib.parse import urlsplit

from playwright.sync_api import sync_playwright


PROJECT_ROOT = Path(__file__).resolve().parents[1]


class QuietStaticHandler(SimpleHTTPRequestHandler):
    def log_message(self, _format, *_args):
        pass


def assert_cards_closed(page):
    state = page.evaluate(
        """() => {
          const area = document.querySelector('.card-area-wrapper');
          const style = getComputedStyle(area);
          const toggle = document.getElementById('skyCardsToggle');
          return {
            open: document.body.classList.contains('sky-cards-open'),
            visibility: style.visibility,
            pointerEvents: style.pointerEvents,
            ariaHidden: area.getAttribute('aria-hidden'),
            inert: area.hasAttribute('inert'),
            expanded: toggle?.getAttribute('aria-expanded')
          };
        }"""
    )
    assert not state["open"], f"card drawer is open: {state}"
    assert state["pointerEvents"] == "none", f"hidden cards accept pointer input: {state}"
    assert state["ariaHidden"] == "true" and state["inert"], f"hidden cards remain accessible: {state}"
    assert state["expanded"] == "false", f"toggle state is out of sync: {state}"
    page.wait_for_function(
        "getComputedStyle(document.querySelector('.card-area-wrapper')).visibility === 'hidden'",
        timeout=3000,
    )
    state["visibility"] = page.evaluate(
        "getComputedStyle(document.querySelector('.card-area-wrapper')).visibility"
    )
    assert state["visibility"] == "hidden", f"card drawer did not finish hiding: {state}"
    return state


def assert_cards_open(page):
    page.wait_for_function(
        """() => {
          const area = document.querySelector('.card-area-wrapper');
          return document.body.classList.contains('sky-cards-open')
            && getComputedStyle(area).visibility === 'visible'
            && getComputedStyle(area).pointerEvents === 'auto'
            && !area.hasAttribute('inert');
        }""",
        timeout=3000,
    )
    state = page.evaluate(
        """() => ({
          open: document.body.classList.contains('sky-cards-open'),
          ariaHidden: document.querySelector('.card-area-wrapper').getAttribute('aria-hidden'),
          expanded: document.getElementById('skyCardsToggle')?.getAttribute('aria-expanded')
        })"""
    )
    assert state == {"open": True, "ariaHidden": "false", "expanded": "true"}, state
    return state


def run_browser_check(base_url):
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        context = browser.new_context(
            viewport={"width": 390, "height": 844},
            device_scale_factor=1,
            has_touch=True,
        )
        context.add_init_script(
            "try { localStorage.clear(); sessionStorage.clear(); } catch (_) {}"
        )
        page = context.new_page()
        local_netloc = urlsplit(base_url).netloc

        def keep_local_assets(route):
            parsed = urlsplit(route.request.url)
            is_local_asset = parsed.netloc == local_netloc and "/api/" not in parsed.path
            if is_local_asset:
                route.continue_()
            else:
                route.abort()

        # This smoke covers local UI only; leave no external API state or traffic.
        page.route("**/*", keep_local_assets)
        page.goto(base_url, wait_until="domcontentloaded", timeout=30000)
        try:
            page.wait_for_load_state("networkidle", timeout=10000)
        except Exception:
            pass

        page.wait_for_selector("#skyLobby", state="visible", timeout=15000)
        page.wait_for_selector("#cvs", state="attached", timeout=15000)
        page.evaluate(
            """() => {
              if (typeof closeAuthModal === 'function') closeAuthModal();
              else document.getElementById('authModal')?.classList.remove('show');
            }"""
        )

        page.locator("[data-sky-action='ai']").click()
        page.wait_for_selector("#skyLobby", state="hidden", timeout=15000)
        page.wait_for_selector("#cvs", state="visible", timeout=15000)
        entered_open = assert_cards_open(page)

        page.locator("#skyCardsToggle").click()
        closed_by_toggle = assert_cards_closed(page)
        page.locator("#skyCardsToggle").click()
        reopened_by_toggle = assert_cards_open(page)

        # showGame is also the shared resume path used by online/replay flows.
        page.locator("#skyCardsToggle").click()
        assert_cards_closed(page)
        page.evaluate("window.SkyIslandUI.showGame()")
        resumed_open = assert_cards_open(page)

        touch_result = page.evaluate(
            """() => {
              const slot = document.querySelector('.card-slot');
              const board = document.querySelector('#cvs');
              if (!slot || !board || typeof window.handleCardClick !== 'function') {
                return {error: 'card slot, board, or card handler is missing'};
              }
              const originalHandler = window.handleCardClick;
              const calls = [];
              // Observe the existing inline card path without changing game state.
              window.handleCardClick = index => calls.push(index);
              try {
                board.dispatchEvent(new PointerEvent('pointerdown', {
                  bubbles: true, pointerType: 'touch', pointerId: 41
                }));
                const slipped = new PointerEvent('click', {
                  bubbles: true, cancelable: true, pointerType: 'touch', pointerId: 41, detail: 1
                });
                slot.dispatchEvent(slipped);
                const slippedBlocked = slipped.defaultPrevented;
                const slippedCalls = calls.length;

                slot.dispatchEvent(new PointerEvent('pointerdown', {
                  bubbles: true, pointerType: 'touch', pointerId: 42
                }));
                const deliberate = new PointerEvent('click', {
                  bubbles: true, cancelable: true, pointerType: 'touch', pointerId: 42, detail: 1
                });
                slot.dispatchEvent(deliberate);
                return {
                  slotCount: document.querySelectorAll('.card-slot').length,
                  slippedBlocked,
                  slippedCalls,
                  deliberateAllowed: !deliberate.defaultPrevented,
                  deliberateCalls: calls.length
                };
              } finally {
                window.handleCardClick = originalHandler;
              }
            }"""
        )
        assert "error" not in touch_result, touch_result
        assert touch_result["slotCount"] > 0, touch_result
        assert touch_result["slippedBlocked"] and touch_result["slippedCalls"] == 0, touch_result
        assert touch_result["deliberateAllowed"] and touch_result["deliberateCalls"] == 1, touch_result

        browser.close()
        return {
            "entered_expanded": entered_open,
            "toggle_closed": closed_by_toggle,
            "toggle_reopened": reopened_by_toggle,
            "resume_expanded": resumed_open,
            "touch_boundary": touch_result,
        }


def main():
    handler = partial(QuietStaticHandler, directory=str(PROJECT_ROOT))
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    base_url = f"http://127.0.0.1:{server.server_address[1]}/index.html"
    try:
        print(run_browser_check(base_url))
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


if __name__ == "__main__":
    main()
