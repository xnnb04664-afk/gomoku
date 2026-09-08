"""Collect a compact Chromium CPU profile up to gomoku_interactive.

This is a diagnostic companion to startup_performance_smoke.py. Run it behind
the webapp-testing ``with_server.py`` helper; it never writes a trace file.
"""

import collections
import json
import os
import sys

from playwright.sync_api import sync_playwright


TEST_URL = os.environ.get(
    "GOMOKU_TEST_URL", "http://127.0.0.1:3000/index.html"
)
TIMEOUT_MS = int(os.environ.get("GOMOKU_PROFILE_TIMEOUT_MS", "30000"))


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
        page.on("pageerror", lambda error: page_errors.append(str(error)))
        cdp = context.new_cdp_session(page)
        cdp.send("Network.enable")
        cdp.send("Network.setCacheDisabled", {"cacheDisabled": True})
        cdp.send("Emulation.setCPUThrottlingRate", {"rate": 4})
        cdp.send("Profiler.enable")
        cdp.send("Profiler.setSamplingInterval", {"interval": 100})
        cdp.send("Profiler.start")

        try:
            page.goto(TEST_URL, wait_until="domcontentloaded", timeout=TIMEOUT_MS)
            page.wait_for_function(
                "() => performance.getEntriesByName('gomoku_interactive').length > 0",
                timeout=TIMEOUT_MS,
            )
            profile = cdp.send("Profiler.stop")["profile"]
            marks = page.evaluate(
                """
                () => Object.fromEntries([
                  'gomoku_boot_start', 'gomoku_first_paint',
                  'gomoku_board_ready', 'gomoku_interactive'
                ].map(name => [
                  name, performance.getEntriesByName(name)[0]?.startTime ?? null
                ]))
                """
            )
        finally:
            context.close()
            browser.close()

    nodes = {node["id"]: node for node in profile["nodes"]}
    sample_counts = collections.Counter(profile.get("samples", []))
    rows = []
    for node_id, count in sample_counts.most_common():
        frame = nodes[node_id]["callFrame"]
        url = frame.get("url", "")
        if url and "127.0.0.1:3000" not in url:
            continue
        rows.append(
            {
                "self_ms": round(count * 0.1, 1),
                "samples": count,
                "function": frame.get("functionName") or "(anonymous)",
                "url": url,
                "line": int(frame.get("lineNumber", -1)) + 1,
                "column": int(frame.get("columnNumber", -1)) + 1,
            }
        )
        if len(rows) >= 30:
            break

    print(
        json.dumps(
            {
                "url": TEST_URL,
                "cpu_throttle_rate": 4,
                "marks_ms": marks,
                "sampling_interval_ms": 0.1,
                "top_self_time": rows,
                "page_errors": page_errors,
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
