"""Repeatable startup, Canvas and AI benchmark for the Android/WebView entry.

This is intentionally a diagnostic test: it does not change application state
outside a short-lived browser context and it never signs in or calls production
accounts.  Start a local static server first, then run for example::

    python tests/performance_benchmark.py

The default run uses a mobile viewport, disabled cache and Chromium's 4x CPU
throttling to keep the result comparable with the release acceptance target.
Set ``GOMOKU_PERF_RUNS`` or ``GOMOKU_TEST_URL`` for a different sample count or
local server.  APK inspection uses only the Python standard library.
"""

from __future__ import annotations

import json
import os
import statistics
import sys
import time
import zipfile
from pathlib import Path
from typing import Any, Dict, List

from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_URL = "http://127.0.0.1:3000/index.html"
DEFAULT_APK = ROOT / "五子棋.apk"
REQUIRED_MARKS = (
    "gomoku_boot_start",
    "gomoku_first_paint",
    "gomoku_board_ready",
    "gomoku_interactive",
)
MOBILE_UA = (
    "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36"
)


def env_int(name: str, default: int) -> int:
    value = os.environ.get(name)
    return int(value) if value else default


def env_float(name: str, default: float) -> float:
    value = os.environ.get(name)
    return float(value) if value else default


def median(values: List[float]) -> float | None:
    return round(statistics.median(values), 2) if values else None


def percentile(values: List[float], fraction: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, int((len(ordered) - 1) * fraction)))
    return round(ordered[index], 2)


def route_local_only(route: Any) -> None:
    """Keep this benchmark deterministic and account-free.

    The application is served locally.  Remote update/social/telemetry calls
    are deliberately aborted; startup marks and local AI remain available.
    """

    try:
        host = route.request.url.split("/", 3)[2].split(":", 1)[0].lower()
    except (IndexError, AttributeError):
        host = ""
    if host in {"127.0.0.1", "localhost", "[::1]"}:
        route.continue_()
    else:
        route.abort()


def build_quiet_board() -> List[List[int]]:
    board = [[0 for _ in range(15)] for _ in range(15)]
    for row, column, color in (
        (7, 7, 1),
        (7, 8, 2),
        (8, 8, 1),
        (6, 7, 2),
    ):
        board[row][column] = color
    return board


def collect_browser_run(
    browser: Any, test_url: str, cpu_rate: float, timeout_ms: int, frame_count: int
) -> Dict[str, Any]:
    context = browser.new_context(
        viewport={"width": 390, "height": 844},
        device_scale_factor=2,
        is_mobile=True,
        has_touch=True,
        user_agent=MOBILE_UA,
    )
    page = context.new_page()
    page.route("**/*", route_local_only)
    console_errors: List[str] = []
    page_errors: List[str] = []
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
        page.wait_for_selector("#skyLobby", state="visible", timeout=timeout_ms)
        page.wait_for_function("() => typeof window.SkyIslandUI?.showGame === 'function'", timeout=10_000)
        page.evaluate("() => window.SkyIslandUI.showGame()")
        page.locator("#cvs").wait_for(state="visible", timeout=timeout_ms)
        page.wait_for_function(
            "names => names.every(name => performance.getEntriesByName(name).length > 0)",
            arg=list(REQUIRED_MARKS),
            timeout=timeout_ms,
        )

        startup = page.evaluate(
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
                marks,
                canvas: (() => {
                  const canvas = document.getElementById('cvs');
                  return canvas ? {
                    cssWidth: canvas.clientWidth,
                    cssHeight: canvas.clientHeight,
                    pixelWidth: canvas.width,
                    pixelHeight: canvas.height
                  } : null;
                })()
              };
            }
            """,
            list(REQUIRED_MARKS),
        )

        canvas = page.evaluate(
            """
            async frameCount => {
              const output = {
                draw_ms: [],
                frame_interval_ms: [],
                frame_count: 0,
                draw_available: typeof draw === 'function'
              };
              if (!output.draw_available) return output;

              // Exercise the steady-state path with a realistic mid-game board,
              // then restore the user's untouched startup state before closing.
              const savedBoard = board;
              const savedHistory = history;
              const savedReplay = typeof isReplayMode === 'boolean' ? isReplayMode : false;
              const testBoard = Array.from({length: 15}, () => Array(15).fill(0));
              const testHistory = [];
              let placed = 0;
              for (let r = 2; r < 13 && placed < 60; r++) {
                for (let c = 2; c < 13 && placed < 60; c++) {
                  if ((r + c) % 2 === 0) {
                    const p = placed % 2 ? 2 : 1;
                    testBoard[r][c] = p;
                    testHistory.push({r, c, p});
                    placed++;
                  }
                }
              }
              board = testBoard;
              history = testHistory;
              isReplayMode = false;

              // Warm the board/pieces caches before recording steady-state draw
              // duration; the first call is separately measured below.
              const warmStart = performance.now();
              draw();
              const warmEnd = performance.now();
              output.first_draw_ms = Math.round((warmEnd - warmStart) * 100) / 100;
              for (let i = 0; i < 12; i++) {
                const started = performance.now();
                draw();
                output.draw_ms.push(Math.round((performance.now() - started) * 100) / 100);
              }

              await new Promise(resolve => {
                let last = null;
                const tick = now => {
                  if (last !== null) {
                    output.frame_interval_ms.push(Math.round((now - last) * 100) / 100);
                  }
                  last = now;
                  const started = performance.now();
                  draw();
                  output.draw_ms.push(Math.round((performance.now() - started) * 100) / 100);
                  output.frame_count++;
                  if (output.frame_count >= frameCount) resolve();
                  else requestAnimationFrame(tick);
                };
                requestAnimationFrame(tick);
              });

              board = savedBoard;
              history = savedHistory;
              isReplayMode = savedReplay;
              draw();
              return output;
            }
            """,
            frame_count,
        )

        ai = page.evaluate(
            """
            async quietBoard => {
              const output = {
                available: typeof requestFastAiMove === 'function',
                samples: [],
                error: ''
              };
              if (!output.available) return output;
              for (let index = 0; index < 4; index++) {
                const started = performance.now();
                try {
                  const move = await requestFastAiMove(quietBoard, []);
                  const elapsed = performance.now() - started;
                  const stats = window.gomokuLastAiStats || {};
                  output.samples.push({
                    phase: index === 0 ? 'first' : 'warm',
                    wall_ms: Math.round(elapsed * 100) / 100,
                    worker_ms: Number(stats.elapsedMs) || 0,
                    nodes: Number(stats.nodes) || 0,
                    depth: Number(stats.depth) || 0,
                    move
                  });
                } catch (error) {
                  output.error = String(error && error.message || error);
                  break;
                }
              }
              return output;
            }
            """,
            build_quiet_board(),
        )

        return {
            "startup": startup,
            "canvas": canvas,
            "ai": ai,
            "console_error_count": len(console_errors),
            "page_errors": page_errors,
        }
    finally:
        context.close()


def summarize_runs(runs: List[Dict[str, Any]]) -> Dict[str, Any]:
    mark_medians = {
        name: median(
            [float(run["startup"]["marks"].get(name)) for run in runs]
        )
        for name in REQUIRED_MARKS
    }
    fcp_values = [float(run["startup"]["fcp_ms"]) for run in runs if run["startup"].get("fcp_ms") is not None]
    dcl_values = [float(run["startup"]["dcl_ms"]) for run in runs if run["startup"].get("dcl_ms") is not None]
    draw_values = [
        float(value)
        for run in runs
        for value in run["canvas"].get("draw_ms", [])
    ]
    frame_values = [
        float(value)
        for run in runs
        for value in run["canvas"].get("frame_interval_ms", [])
    ]
    ai_samples = [
        sample
        for run in runs
        for sample in run["ai"].get("samples", [])
    ]
    first_ai = [s for s in ai_samples if s.get("phase") == "first"]
    warm_ai = [s for s in ai_samples if s.get("phase") == "warm"]

    def ai_medians(samples: List[Dict[str, Any]]) -> Dict[str, Any]:
        return {
            "count": len(samples),
            "wall_ms": median([float(s["wall_ms"]) for s in samples]),
            "worker_ms": median([float(s["worker_ms"]) for s in samples]),
            "nodes": median([float(s["nodes"]) for s in samples]),
            "depth": median([float(s["depth"]) for s in samples]),
        }

    return {
        "startup_median_ms": {
            "fcp": median(fcp_values),
            "dcl": median(dcl_values),
            "boot_start": mark_medians["gomoku_boot_start"],
            "first_paint": mark_medians["gomoku_first_paint"],
            "board_ready": mark_medians["gomoku_board_ready"],
            "interactive": mark_medians["gomoku_interactive"],
        },
        "canvas_median_ms": {
            "first_draw": median([
                float(run["canvas"].get("first_draw_ms", 0)) for run in runs
            ]),
            "steady_draw": median(draw_values),
            "steady_draw_p95": percentile(draw_values, 0.95),
            "frame_interval": median(frame_values),
            "frame_interval_p95": percentile(frame_values, 0.95),
            "frames": len(frame_values),
        },
        "ai_median": {
            "first": ai_medians(first_ai),
            "warm": ai_medians(warm_ai),
        },
    }


def inspect_apk(apk_path: Path) -> Dict[str, Any]:
    if not apk_path.exists():
        return {"path": str(apk_path), "available": False, "error": "APK not found"}
    with zipfile.ZipFile(apk_path) as apk:
        entries = apk.infolist()
        asset_entries = [entry for entry in entries if entry.filename.startswith("assets/")]
        dex_entries = [entry for entry in entries if entry.filename.endswith(".dex")]
        native_entries = [entry for entry in entries if entry.filename.startswith("lib/")]
        def group_total(prefix: str) -> Dict[str, int]:
            grouped = [entry for entry in entries if entry.filename.startswith(prefix)]
            return {
                "files": len(grouped),
                "uncompressed_bytes": sum(entry.file_size for entry in grouped),
                "compressed_bytes": sum(entry.compress_size for entry in grouped),
            }

        largest_assets = sorted(
            (
                {
                    "name": entry.filename,
                    "uncompressed_bytes": entry.file_size,
                    "compressed_bytes": entry.compress_size,
                    "compression": entry.compress_type,
                }
                for entry in asset_entries
            ),
            key=lambda item: item["uncompressed_bytes"],
            reverse=True,
        )[:10]
        uncompressed_assets = [
            entry.filename
            for entry in asset_entries
            if entry.compress_type == zipfile.ZIP_STORED
        ]
        return {
            "path": str(apk_path),
            "available": True,
            "apk_bytes": apk_path.stat().st_size,
            "entries": len(entries),
            "assets": {
                "files": len(asset_entries),
                "uncompressed_bytes": sum(entry.file_size for entry in asset_entries),
                "compressed_bytes": sum(entry.compress_size for entry in asset_entries),
                "largest": largest_assets,
                "uncompressed_entries": uncompressed_assets,
            },
            "dex": {
                "files": len(dex_entries),
                "items": [
                    {
                        "name": entry.filename,
                        "uncompressed_bytes": entry.file_size,
                        "compressed_bytes": entry.compress_size,
                    }
                    for entry in dex_entries
                ],
            },
            "native": group_total("lib/"),
            "resources_arsc": next(
                (
                    {
                        "uncompressed_bytes": entry.file_size,
                        "compressed_bytes": entry.compress_size,
                    }
                    for entry in entries
                    if entry.filename == "resources.arsc"
                ),
                None,
            ),
        }


def make_decision(summary: Dict[str, Any], ai_budget_ms: float) -> Dict[str, Any]:
    warm = summary["ai_median"]["warm"]
    warm_worker = warm.get("worker_ms")
    if warm.get("count", 0) == 0:
        return {
            "rust_wasm": "unknown",
            "reason": "AI Worker 没有可用样本，先修复运行环境再评估。",
        }
    if warm_worker is not None and warm_worker >= ai_budget_ms * 0.9:
        return {
            "rust_wasm": "defer_with_targeted_profile",
            "reason": (
                f"热 AI 中位 {warm_worker}ms 已接近移动端预算 {ai_budget_ms}ms；"
                "这说明当前测试是预算受限，不能单凭墙钟时间证明 Rust/WASM 会更快。"
                "先做棋步/节点级 profile；若需要在同一预算提高深度，再评估 Rust/WASM。"
            ),
        }
    return {
        "rust_wasm": "not_yet",
        "reason": (
            f"热 AI 中位 {warm_worker}ms 未接近移动端预算 {ai_budget_ms}ms；"
            "先继续 JavaScript/Worker 与 Canvas 优化，暂不值得引入 Rust/WASM 的维护成本。"
        ),
    }


def main() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    test_url = os.environ.get("GOMOKU_TEST_URL", DEFAULT_URL)
    run_count = env_int("GOMOKU_PERF_RUNS", 5)
    cpu_rate = env_float("GOMOKU_CPU_THROTTLE", 4.0)
    timeout_ms = env_int("GOMOKU_PERF_TIMEOUT_MS", 30_000)
    frame_count = env_int("GOMOKU_CANVAS_FRAMES", 45)
    ai_budget_ms = env_float("GOMOKU_AI_BUDGET_MS", 520.0)
    apk_path = Path(os.environ.get("GOMOKU_APK_PATH", str(DEFAULT_APK)))
    if run_count < 1 or frame_count < 1 or cpu_rate < 1:
        raise ValueError("run/frame counts must be positive and CPU throttle >= 1")

    runs: List[Dict[str, Any]] = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        try:
            for run_number in range(1, run_count + 1):
                sample = collect_browser_run(
                    browser, test_url, cpu_rate, timeout_ms, frame_count
                )
                runs.append(sample)
                marks = sample["startup"]["marks"]
                warm = [s for s in sample["ai"].get("samples", []) if s["phase"] == "warm"]
                warm_wall = median([float(s["wall_ms"]) for s in warm])
                print(
                    f"run {run_number}/{run_count}: "
                    f"FCP={sample['startup']['fcp_ms']}ms, "
                    f"board={marks['gomoku_board_ready']}ms, "
                    f"interactive={marks['gomoku_interactive']}ms, "
                    f"draw-p95={percentile([float(v) for v in sample['canvas']['draw_ms']], 0.95)}ms, "
                    f"AI-warm={warm_wall}ms",
                    flush=True,
                )
        finally:
            browser.close()

    summary = summarize_runs(runs)
    report = {
        "url": test_url,
        "run_count": run_count,
        "cpu_throttle_rate": cpu_rate,
        "frame_count_per_run": frame_count,
        "summary": summary,
        "rust_wasm_decision": make_decision(summary, ai_budget_ms),
        "apk": inspect_apk(apk_path),
        "page_error_count": sum(len(run.get("page_errors", [])) for run in runs),
        "console_error_count": sum(int(run.get("console_error_count", 0)) for run in runs),
        "generated_at_unix": int(time.time()),
    }
    print(json.dumps(report, ensure_ascii=False, indent=2))
    if report["page_error_count"] or not all(run["ai"].get("available") for run in runs):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
