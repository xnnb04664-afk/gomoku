import json
import os
from pathlib import Path

from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeoutError


ROOT = Path(__file__).resolve().parents[1]


def test_page(page, url, expected_inline):
    page.route(
        "https://gomoku-api.pages.dev/api/version**",
        lambda route: route.fulfill(
            status=200,
            content_type="application/json",
            body=json.dumps({
                "code": 0,
                "tag": "v1.0.100",
                "apkPath": "/api/update/apk",
                "htmlPath": "/api/update/html",
                "apkTicket": "test-apk-ticket",
                "htmlTicket": "test-html-ticket",
                "htmlSha256": "0" * 64,
            }),
        ),
    )
    console_errors = []
    page_errors = []
    page.on("console", lambda message: console_errors.append(message.text) if message.type == "error" else None)
    page.on("pageerror", lambda error: page_errors.append(str(error)))
    page.goto(url, wait_until="domcontentloaded", timeout=30_000)
    try:
        page.wait_for_load_state("networkidle", timeout=15_000)
    except PlaywrightTimeoutError:
        pass
    # 官方首页先展示天空棋岛；单文件版可能没有大厅壳，直接保留原棋局入口。
    page.wait_for_function(
        "() => Boolean(document.querySelector('#skyLobby, #cvs'))",
        timeout=15_000,
    )
    if page.locator("#skyLobby").count():
        page.locator("#skyLobby").wait_for(state="visible", timeout=15_000)
        page.evaluate("() => window.SkyIslandUI?.showGame()")
    page.locator("#cvs").wait_for(state="visible", timeout=10_000)

    result = page.evaluate(
        """
        async (expectedInline) => {
          const sourceNode = document.getElementById('gomokuAiWorkerSource');
          const actualInline = Boolean(sourceNode && sourceNode.textContent && sourceNode.textContent.length > 20000);
          const originalWorker = window.Worker;
          const fallbackBoard = Array.from({length: 15}, () => Array(15).fill(0));
          for (let c = 3; c < 7; c++) fallbackBoard[7][c] = 2;
          let fallbackMove = null;
          let fallbackError = '';
          let fallbackCardsUnchanged = false;
          let fallbackSkillSnapshotsUnchanged = false;
          try {
            const cardsBefore = JSON.stringify(currentDrawnCards);
            const usedBefore = JSON.stringify(cardUsedStatus);
            const skillSnapshotsBefore = undoStack.filter(snapshot => snapshot && snapshot.type === 'skill').length;
            window.Worker = undefined;
            gameMode = 'ai';
            turn = 2;
            isOver = false;
            aiThinking = false;
            board = fallbackBoard;
            history = [];
            fallbackMove = await window.smartAiMove([]);
            fallbackCardsUnchanged = cardsBefore === JSON.stringify(currentDrawnCards) && usedBefore === JSON.stringify(cardUsedStatus);
            fallbackSkillSnapshotsUnchanged = skillSnapshotsBefore === undoStack.filter(snapshot => snapshot && snapshot.type === 'skill').length;
          } catch (error) {
            fallbackError = String(error);
          } finally {
            window.Worker = originalWorker;
          }
          const win = Array.from({length: 15}, () => Array(15).fill(0));
          for (let c = 3; c < 7; c++) win[7][c] = 2;
          let ticks = 0;
          const timer = setInterval(() => { ticks++; }, 16);
          const started = performance.now();
          const move = await window.requestFastAiMove(win, []);
          const elapsedMs = Math.round(performance.now() - started);
          const quiet = Array.from({length: 15}, () => Array(15).fill(0));
          for (const [r, c, p] of [[7, 7, 1], [7, 8, 2], [8, 8, 1], [6, 7, 2]]) quiet[r][c] = p;
          const quietStarted = performance.now();
          const quietMove = await window.requestFastAiMove(quiet, []);
          const quietElapsedMs = Math.round(performance.now() - quietStarted);
          clearInterval(timer);
          return {
            actualInline,
            inlineOk: actualInline === expectedInline,
            move,
            fallbackMove: fallbackMove || null,
            fallbackError,
            fallbackCardsUnchanged,
            fallbackSkillSnapshotsUnchanged,
            elapsedMs,
            quietMove,
            quietElapsedMs,
            ticks,
            stats: window.gomokuLastAiStats || null
          };
        }
        """,
        expected_inline,
    )
    expected_win = result["move"]["r"] == 7 and result["move"]["c"] in (2, 7)
    result["winTacticOk"] = expected_win
    result["fallbackOk"] = (
        result["fallbackError"] == ""
        and result["fallbackCardsUnchanged"]
        and result["fallbackSkillSnapshotsUnchanged"]
        and result["fallbackMove"] is None
    )
    # smartAiMove 落子成功后通过棋盘/历史体现结果；函数本身不返回棋步。
    result["fallbackBoardMoveOk"] = page.evaluate(
        """
        () => board.some(row => row.some(cell => cell === 2)) && history.some(item => item && item.p === 2)
        """
    )
    result["quietSearchOk"] = (
        result["quietMove"] is not None
        and 0 <= result["quietMove"].get("r", -1) < 15
        and 0 <= result["quietMove"].get("c", -1) < 15
        and (result["stats"] or {}).get("nodes", 0) > 0
    )
    result["uiStayedResponsive"] = result["ticks"] >= 1
    result["consoleErrors"] = console_errors
    result["pageErrors"] = page_errors
    result["ok"] = all([
        result["inlineOk"],
        result["winTacticOk"],
        result["fallbackOk"],
        result["fallbackBoardMoveOk"],
        result["quietSearchOk"],
        result["uiStayedResponsive"],
        not console_errors,
        not page_errors,
    ])
    return result


def main():
    base_url = os.environ.get("GOMOKU_TEST_URL", "http://127.0.0.1:3000")
    results = {}
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        context = browser.new_context(
            viewport={"width": 390, "height": 844},
            device_scale_factor=1,
            user_agent=(
                "Mozilla/5.0 (Linux; Android 13; Pixel 7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36"
            ),
        )
        for relative, expected_inline in (("/index.html", False), ("/五子棋大师_单文件版.html", True)):
            page = context.new_page()
            results[relative] = test_page(page, base_url + relative, expected_inline)
            page.close()
        context.close()
        browser.close()
    print(json.dumps(results, ensure_ascii=False))
    if not all(item["ok"] for item in results.values()):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
