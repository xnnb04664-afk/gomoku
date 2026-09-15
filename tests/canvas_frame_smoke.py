"""Regression checks for coalesced Canvas draws and low-end VFX frame budgeting."""

import json
import os
import sys

from playwright.sync_api import TimeoutError as PlaywrightTimeoutError, sync_playwright


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")

    url = os.environ.get("GOMOKU_TEST_URL", "http://127.0.0.1:3000/index.html")
    console_errors = []
    page_errors = []

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        context = browser.new_context(
            viewport={"width": 390, "height": 844},
            device_scale_factor=1,
        )
        context.add_init_script(
            "localStorage.setItem('gomoku_graphics_quality_v1', 'smooth');"
        )
        page = context.new_page()
        page.on(
            "console",
            lambda message: console_errors.append(message.text)
            if message.type == "error"
            else None,
        )
        page.on("pageerror", lambda error: page_errors.append(str(error)))
        page.goto(url, wait_until="domcontentloaded", timeout=30_000)
        # The product now opens on the sky-island lobby; reveal the preserved
        # standard game surface before asserting Canvas scheduling behavior.
        if page.locator("#skyLobby").count():
            page.wait_for_selector("#skyLobby", state="visible", timeout=15_000)
            page.wait_for_function("() => typeof window.SkyIslandUI?.showGame === 'function'", timeout=10_000)
            page.evaluate("() => window.SkyIslandUI?.showGame()")
        page.locator("#cvs").wait_for(state="visible", timeout=10_000)
        try:
            page.wait_for_load_state("networkidle", timeout=15_000)
        except PlaywrightTimeoutError:
            # Optional CDN resources must not block the local Canvas checks.
            pass

        result = page.evaluate(
            """
            async () => {
              const stats = window.__gomokuCanvasFrameStats;
              const schedulerReady = Boolean(
                stats && typeof window.draw === 'function' &&
                typeof window.drawNow === 'function' &&
                typeof window.getCanvasFrameBudgetMs === 'function'
              );
              if (!schedulerReady) {
                return { schedulerReady: false };
              }

              // 切换大厅/棋局后可能还有一帧初始化重绘，先让它稳定再计数。
              await new Promise(resolve => setTimeout(resolve, 120));
              const before = { ...stats };
              for (let i = 0; i < 8; i++) window.draw();
              await new Promise(resolve => setTimeout(resolve, 120));
              const after = { ...stats };

              const immediateBefore = stats.rendered;
              window.draw();
              const queuedDrawWasAsync = stats.rendered === immediateBefore;
              window.draw(true);
              const immediateRenderedOnce = stats.rendered === immediateBefore + 1;
              await new Promise(resolve => setTimeout(resolve, 80));
              const immediateCancelledQueuedFrame = stats.rendered === immediateBefore + 1;

              const boardBefore = board[7][7];
              gameMode = 'pvp';
              window.makeMove(7, 7, 1);
              await new Promise(resolve => setTimeout(resolve, 80));
              const movePreserved = board[7][7] === 1 && boardBefore === 0;
              window.resetBoardOnly();

              const vfxBefore = stats.vfxRendered;
              const vfxRenderBefore = stats.rendered;
              window.draw();
              window.triggerStoneDropVFX(7, 7, 1);
              const vfxStartedAsync = stats.rendered === vfxRenderBefore;
              await new Promise(resolve => setTimeout(resolve, 500));
              const vfxFrames = stats.vfxRendered - vfxBefore;

              return {
                schedulerReady,
                drawRequests: after.requested - before.requested,
                drawRenders: after.rendered - before.rendered,
                coalesced: after.coalesced - before.coalesced,
                drawMerged: after.requested - before.requested === 8 &&
                  after.coalesced - before.coalesced >= 7 &&
                  after.rendered - before.rendered <= 2,
                queuedDrawWasAsync,
                immediateRenderedOnce,
                immediateCancelledQueuedFrame,
                frameBudgetMs: window.getCanvasFrameBudgetMs(),
                smoothBudgetOk: window.getCanvasFrameBudgetMs() >= 30,
                vfxFrames,
                vfxBudgeted: vfxFrames > 0 && vfxFrames <= 18,
                vfxStartedAsync,
                movePreserved,
                pageVisible: document.visibilityState === 'visible'
              };
            }
            """
        )

        page.evaluate("window.triggerVictoryVFX()")
        page.wait_for_timeout(80)
        page.evaluate(
            """
            () => {
              window.__testVisibilityState = 'hidden';
              Object.defineProperty(document, 'visibilityState', {
                configurable: true,
                get: () => window.__testVisibilityState
              });
              document.dispatchEvent(new Event('visibilitychange'));
            }
            """
        )
        hidden_before = page.evaluate("({ ...window.__gomokuCanvasFrameStats })")
        page.wait_for_timeout(180)
        hidden_after = page.evaluate(
            """
            () => ({
              stats: { ...window.__gomokuCanvasFrameStats },
              vfxCount: activeVFX.length
            })
            """
        )
        result["backgroundPaused"] = (
            hidden_after["stats"]["rendered"] == hidden_before["rendered"]
            and hidden_after["stats"]["vfxRendered"] == hidden_before["vfxRendered"]
            and hidden_after["vfxCount"] == 0
        )
        page.evaluate(
            """
            () => {
              window.__testVisibilityState = 'visible';
              document.dispatchEvent(new Event('visibilitychange'));
            }
            """
        )
        browser.close()

    failures = []
    if not result.get("schedulerReady"):
        failures.append("Canvas scheduler did not register")
    if not result.get("drawMerged"):
        failures.append(f"draw requests were not coalesced: {result}")
    if not all(
        result.get(name)
        for name in (
            "queuedDrawWasAsync",
            "immediateRenderedOnce",
            "immediateCancelledQueuedFrame",
        )
    ):
        failures.append(f"immediate draw compatibility failed: {result}")
    if not result.get("smoothBudgetOk"):
        failures.append(f"smooth frame budget is too high: {result}")
    if not result.get("vfxBudgeted"):
        failures.append(f"VFX frame budget check failed: {result}")
    if not result.get("vfxStartedAsync"):
        failures.append(f"VFX performed a synchronous draw: {result}")
    if not result.get("backgroundPaused"):
        failures.append(f"background VFX did not pause cleanly: {result}")
    if not result.get("movePreserved"):
        failures.append(f"makeMove regression: {result}")
    if page_errors:
        failures.append(f"page errors: {page_errors}")
    if console_errors:
        failures.append(f"console errors: {console_errors}")
    if failures:
        raise AssertionError("; ".join(failures))

    print(json.dumps({"pass": True, **result}, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except PlaywrightTimeoutError as error:
        raise AssertionError(str(error))
