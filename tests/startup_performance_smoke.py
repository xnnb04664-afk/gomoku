"""Mobile cold-start performance smoke test for Gomoku.

The test expects an HTTP server to be running already.  The default target is
http://127.0.0.1:3000/index.html and can be overridden with GOMOKU_TEST_URL.
"""

import json
import os
import statistics
import sys

from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
from playwright.sync_api import sync_playwright


DEFAULT_URL = "http://127.0.0.1:3000/index.html"
REQUIRED_MARKS = (
    "gomoku_boot_start",
    "gomoku_first_paint",
    "gomoku_board_ready",
    "gomoku_interactive",
)


def env_float(name, default):
    value = os.environ.get(name)
    return float(value) if value else default


def env_int(name, default):
    value = os.environ.get(name)
    return int(value) if value else default


def percentile_median(samples, key):
    return round(statistics.median(sample[key] for sample in samples), 2)


def collect_run(browser, test_url, cpu_rate, timeout_ms):
    context = browser.new_context(
        viewport={"width": 390, "height": 844},
        device_scale_factor=2,
        is_mobile=True,
        has_touch=True,
        user_agent=(
            "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36"
        ),
    )
    page = context.new_page()
    console_errors = []
    page_errors = []
    page.on(
        "console",
        lambda message: console_errors.append(message.text)
        if message.type == "error"
        else None,
    )
    page.on("pageerror", lambda error: page_errors.append(str(error)))

    cdp = context.new_cdp_session(page)
    cdp.send("Network.enable")
    cdp.send("Network.setCacheDisabled", {"cacheDisabled": True})
    if cpu_rate > 1:
        cdp.send("Emulation.setCPUThrottlingRate", {"rate": cpu_rate})

    try:
        page.goto(test_url, wait_until="domcontentloaded", timeout=timeout_ms)
        page.locator("#cvs").wait_for(state="visible", timeout=timeout_ms)
        try:
            page.wait_for_function(
                """
                names => names.every(name => performance.getEntriesByName(name).length > 0)
                """,
                arg=list(REQUIRED_MARKS),
                timeout=timeout_ms,
            )
        except PlaywrightTimeoutError as error:
            diagnostics = page.evaluate(
                """
                names => ({
                  readyState: document.readyState,
                  marks: Object.fromEntries(names.map(name => [
                    name,
                    performance.getEntriesByName(name)[0]?.startTime ?? null
                  ])),
                  scripts: [...document.scripts].map(script => ({
                    src: script.src,
                    type: script.type,
                    readyState: script.readyState || null
                  })),
                  boardPresent: Boolean(document.querySelector('#cvs')),
                  onlineReady: window.__GOMOKU_ONLINE_READY__ === true,
                  socialReady: Boolean(window.GomokuSocial)
                })
                """,
                list(REQUIRED_MARKS),
            )
            diagnostics["console_errors"] = console_errors
            diagnostics["page_errors"] = page_errors
            raise RuntimeError(
                "startup marks timed out: "
                + json.dumps(diagnostics, ensure_ascii=False)
            ) from error
        try:
            page.wait_for_load_state("networkidle", timeout=5_000)
        except PlaywrightTimeoutError:
            # Optional remote services may stay active; startup marks are authoritative.
            pass

        metrics = page.evaluate(
            """
            names => {
              const navigation = performance.getEntriesByType('navigation')[0];
              const paint = performance.getEntriesByName('first-contentful-paint')[0];
              const marks = Object.fromEntries(names.map(name => [
                name,
                performance.getEntriesByName(name)[0]?.startTime ?? null
              ]));
              return {
                fcp_ms: paint?.startTime ?? null,
                dcl_ms: navigation
                  ? navigation.domContentLoadedEventEnd - navigation.startTime
                  : null,
                board_ready_ms: marks.gomoku_board_ready,
                interactive_ms: marks.gomoku_interactive,
                marks
              };
            }
            """,
            list(REQUIRED_MARKS),
        )
        missing = [
            name for name in REQUIRED_MARKS if metrics["marks"].get(name) is None
        ]
        if metrics["fcp_ms"] is None:
            missing.append("first-contentful-paint")
        if metrics["dcl_ms"] is None:
            missing.append("navigation.domContentLoadedEventEnd")
        if missing:
            raise RuntimeError("missing performance entries: " + ", ".join(missing))

        metrics["fcp_ms"] = round(metrics["fcp_ms"], 2)
        metrics["dcl_ms"] = round(metrics["dcl_ms"], 2)
        metrics["board_ready_ms"] = round(metrics["board_ready_ms"], 2)
        metrics["interactive_ms"] = round(metrics["interactive_ms"], 2)
        metrics["console_error_count"] = len(console_errors)
        metrics["page_errors"] = page_errors
        return metrics
    finally:
        context.close()


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")

    test_url = os.environ.get("GOMOKU_TEST_URL", DEFAULT_URL)
    run_count = env_int("GOMOKU_PERF_RUNS", 5)
    cpu_rate = env_float("GOMOKU_CPU_THROTTLE", 4.0)
    timeout_ms = env_int("GOMOKU_PERF_TIMEOUT_MS", 30_000)
    fcp_budget_ms = env_float("GOMOKU_FCP_BUDGET_MS", 1_600.0)
    interactive_budget_ms = env_float("GOMOKU_INTERACTIVE_BUDGET_MS", 2_500.0)
    minimum_improvement_pct = env_float("GOMOKU_MIN_IMPROVEMENT_PCT", 35.0)
    baseline_fcp_ms = env_float("GOMOKU_BASELINE_FCP_MS", 2_260.0)
    baseline_interactive_ms = env_float("GOMOKU_BASELINE_INTERACTIVE_MS", 3_800.0)

    if run_count < 1:
        raise ValueError("GOMOKU_PERF_RUNS must be at least 1")
    if cpu_rate < 1:
        raise ValueError("GOMOKU_CPU_THROTTLE must be at least 1")

    samples = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        try:
            for run_number in range(1, run_count + 1):
                sample = collect_run(browser, test_url, cpu_rate, timeout_ms)
                samples.append(sample)
                print(
                    f"run {run_number}/{run_count}: "
                    f"FCP={sample['fcp_ms']}ms, "
                    f"board={sample['board_ready_ms']}ms, "
                    f"interactive={sample['interactive_ms']}ms",
                    flush=True,
                )
        finally:
            browser.close()

    medians = {
        "fcp_ms": percentile_median(samples, "fcp_ms"),
        "dcl_ms": percentile_median(samples, "dcl_ms"),
        "board_ready_ms": percentile_median(samples, "board_ready_ms"),
        "interactive_ms": percentile_median(samples, "interactive_ms"),
    }
    improvement = {
        "fcp_pct": round((1 - medians["fcp_ms"] / baseline_fcp_ms) * 100, 2),
        "interactive_pct": round(
            (1 - medians["interactive_ms"] / baseline_interactive_ms) * 100, 2
        ),
    }
    failures = []
    if medians["fcp_ms"] > fcp_budget_ms:
        failures.append(
            f"median FCP {medians['fcp_ms']}ms exceeds {fcp_budget_ms}ms budget"
        )
    if medians["interactive_ms"] > interactive_budget_ms:
        failures.append(
            "median interactive "
            f"{medians['interactive_ms']}ms exceeds {interactive_budget_ms}ms budget"
        )
    if improvement["fcp_pct"] < minimum_improvement_pct:
        failures.append(
            f"FCP improvement {improvement['fcp_pct']}% is below "
            f"{minimum_improvement_pct}%"
        )
    if improvement["interactive_pct"] < minimum_improvement_pct:
        failures.append(
            f"interactive improvement {improvement['interactive_pct']}% is below "
            f"{minimum_improvement_pct}%"
        )

    report = {
        "url": test_url,
        "run_count": run_count,
        "cpu_throttle_rate": cpu_rate,
        "samples": samples,
        "medians": medians,
        "baseline_ms": {
            "fcp": baseline_fcp_ms,
            "interactive": baseline_interactive_ms,
        },
        "improvement": improvement,
        "budgets_ms": {
            "fcp": fcp_budget_ms,
            "interactive": interactive_budget_ms,
            "minimum_improvement_pct": minimum_improvement_pct,
        },
        "passed": not failures,
        "failures": failures,
    }
    print(json.dumps(report, ensure_ascii=False, indent=2))
    if failures:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
