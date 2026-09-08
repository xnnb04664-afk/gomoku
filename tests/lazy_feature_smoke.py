"""Verify that optional bundles stay off the critical path and load cleanly.

Run this script behind the webapp-testing ``with_server.py`` helper.  The HTTP
server URL can be overridden with ``GOMOKU_TEST_URL``.
"""

import json
import os
import sys

from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
from playwright.sync_api import sync_playwright


TEST_URL = os.environ.get(
    "GOMOKU_TEST_URL", "http://127.0.0.1:3000/index.html"
)
TIMEOUT_MS = int(os.environ.get("GOMOKU_LAZY_TIMEOUT_MS", "30000"))


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        context = browser.new_context(
            viewport={"width": 390, "height": 844},
            device_scale_factor=2,
            is_mobile=True,
            has_touch=True,
        )
        page = context.new_page()
        page_errors = []
        console_errors = []
        page.on("pageerror", lambda error: page_errors.append(str(error)))
        page.on(
            "console",
            lambda message: console_errors.append(message.text)
            if message.type == "error"
            else None,
        )
        cdp = context.new_cdp_session(page)
        cdp.send("Network.enable")
        cdp.send("Network.setCacheDisabled", {"cacheDisabled": True})
        cdp.send("Emulation.setCPUThrottlingRate", {"rate": 4})

        try:
            page.goto(TEST_URL, wait_until="domcontentloaded", timeout=TIMEOUT_MS)
            try:
                page.wait_for_load_state("networkidle", timeout=5_000)
            except PlaywrightTimeoutError:
                # Health probes and account refresh can keep the network active.
                pass
            page.wait_for_function(
                """
                () => ['gomoku_board_ready', 'gomoku_interactive'].every(
                  name => performance.getEntriesByName(name).length > 0
                )
                """,
                timeout=TIMEOUT_MS,
            )

            initial = page.evaluate(
                """
                () => ({
                  onlineReady: window.__GOMOKU_ONLINE_READY__ === true,
                  socialReady: Boolean(window.GomokuSocial),
                  accountReady: window.__GOMOKU_ACCOUNT_READY__ === true,
                  replayReady: window.__GOMOKU_REPLAY_READY__ === true,
                  settingsReady: window.__GOMOKU_SETTINGS_READY__ === true,
                  onlineScripts: [...document.scripts].filter(
                    script => /\/online(?:\.min)?\.js(?:\?|$)/.test(script.src)
                  ).length,
                  socialScripts: [...document.scripts].filter(
                    script => /\/social(?:\.min)?\.js(?:\?|$)/.test(script.src)
                  ).length,
                  accountScripts: [...document.scripts].filter(script => /\/account(?:\.min)?\.js(?:\?|$)/.test(script.src)).length,
                  replayScripts: [...document.scripts].filter(script => /\/replay(?:\.min)?\.js(?:\?|$)/.test(script.src)).length,
                  settingsScripts: [...document.scripts].filter(script => /\/settings(?:\.min)?\.js(?:\?|$)/.test(script.src)).length
                })
                """
            )
            if initial != {
                "onlineReady": False,
                "socialReady": False,
                "accountReady": False,
                "replayReady": False,
                "settingsReady": False,
                "onlineScripts": 0,
                "socialScripts": 0,
                "accountScripts": 0,
                "replayScripts": 0,
                "settingsScripts": 0,
            }:
                raise AssertionError(
                    "lazy bundles executed during critical startup: "
                    + json.dumps(initial, ensure_ascii=False)
                )

            page.evaluate("() => window.ensureGomokuFeature('online')")
            page.wait_for_function(
                "() => window.__GOMOKU_ONLINE_READY__ === true", timeout=TIMEOUT_MS
            )
            online = page.evaluate(
                """
                () => ({
                  ready: window.__GOMOKU_ONLINE_READY__ === true,
                  open: typeof window.openOnlineModal,
                  reconnect: typeof window.triggerOnlineReconnect,
                  scripts: [...document.scripts].filter(
                    script => /\/online(?:\.min)?\.js(?:\?|$)/.test(script.src)
                  ).length
                })
                """
            )
            if online != {
                "ready": True,
                "open": "function",
                "reconnect": "function",
                "scripts": 1,
            }:
                raise AssertionError(
                    "online bundle did not register exactly once: "
                    + json.dumps(online, ensure_ascii=False)
                )

            page.evaluate("() => window.ensureGomokuFeature('social')")
            page.wait_for_function(
                "() => Boolean(window.GomokuSocial?.open)", timeout=TIMEOUT_MS
            )
            social = page.evaluate(
                """
                () => ({
                  ready: Boolean(window.GomokuSocial?.open),
                  start: typeof window.GomokuSocial?.start,
                  scripts: [...document.scripts].filter(
                    script => /\/social(?:\.min)?\.js(?:\?|$)/.test(script.src)
                  ).length
                })
                """
            )
            if social != {"ready": True, "start": "function", "scripts": 1}:
                raise AssertionError(
                    "social bundle did not register exactly once: "
                    + json.dumps(social, ensure_ascii=False)
                )

            optional = {}
            for name, ready_flag in (
                ("account", "__GOMOKU_ACCOUNT_READY__"),
                ("replay", "__GOMOKU_REPLAY_READY__"),
                ("settings", "__GOMOKU_SETTINGS_READY__"),
            ):
                page.evaluate("name => window.ensureGomokuFeature(name)", name)
                page.wait_for_function(
                    "flag => window[flag] === true", arg=ready_flag, timeout=TIMEOUT_MS
                )
                optional[name] = page.evaluate(
                    """
                    name => ({
                      ready: window[`__GOMOKU_${name.toUpperCase()}_READY__`] === true,
                      scripts: [...document.scripts].filter(script => {
                        const src = script.src.split('?')[0];
                        return src.endsWith(`/${name}.js`) || src.endsWith(`/${name}.min.js`);
                      }).length
                    })
                    """,
                    name,
                )
                if optional[name] != {"ready": True, "scripts": 1}:
                    raise AssertionError(
                        f"{name} bundle did not register exactly once: "
                        + json.dumps(optional[name], ensure_ascii=False)
                    )

            if page_errors or console_errors:
                raise AssertionError(
                    "browser errors: "
                    + json.dumps(
                        {
                            "page_errors": page_errors,
                            "console_errors": console_errors,
                        },
                        ensure_ascii=False,
                    )
                )

            print(
                json.dumps(
                    {
                        "url": TEST_URL,
                        "cpu_throttle_rate": 4,
                        "critical_startup": initial,
                        "online_after_load": online,
                        "social_after_load": social,
                        "optional_after_load": optional,
                        "page_errors": page_errors,
                        "console_errors": console_errors,
                        "passed": True,
                    },
                    ensure_ascii=False,
                    indent=2,
                )
            )
        finally:
            context.close()
            browser.close()


if __name__ == "__main__":
    main()
