from pathlib import Path

from playwright.sync_api import sync_playwright


URL = (Path(__file__).resolve().parents[1] / "index.html").as_uri()


def prepare_finished_game(page):
    page.evaluate("""() => {
      board = Array.from({ length: 15 }, () => Array(15).fill(EMPTY));
      history = [];
      for (let c = 3; c < 8; c++) {
        board[7][c] = BLACK;
        history.push({ r: 7, c, p: BLACK, moveNum: c - 2 });
      }
      isOver = true;
      gameWinnerColor = BLACK;
      gameResultIsDraw = false;
      winningLine = Array.from({ length: 5 }, (_, index) => ({ r: 7, c: index + 3 }));
      gameMode = 'ai';
      updatePlayerHeaderUI();
      activeVFX = [{ type: 'victory_confetti', startTime: performance.now(), duration: 10000, particles: [] }];
      document.getElementById('resultModalTitle').textContent = '对局获胜';
      const resultModal = document.getElementById('gameResultModal');
      resultModal.style.display = 'flex';
      resultModal.classList.add('show');
      draw();
    }""")


def assert_replay_started(page, expected_step):
    page.wait_for_function(
        "document.getElementById('replayControlDock')?.style.display === 'flex'"
    )
    assert page.evaluate("isReplayMode") is True
    assert page.evaluate("isOver") is False
    assert page.evaluate("winningLine") is None
    assert page.evaluate("activeVFX.length") == 0
    assert int(page.locator("#replayMainSlider").input_value()) == expected_step


def main():
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        page = browser.new_page()
        page.route("**/api/**", lambda route: route.abort())
        page.route("https://mcp.figma.com/**", lambda route: route.abort())
        page.goto(URL, wait_until="domcontentloaded", timeout=30000)
        page.wait_for_function("typeof window.getReplayInsightSnapshot === 'function'", timeout=30000)
        page.evaluate("window.SkyIslandUI.showGame()")

        prepare_finished_game(page)
        # The current page exposes step replay through the core API; the old
        # sky-replay-insights-event component has been removed from this UI.
        page.evaluate("openCurrentGameReplayAtStep(5)")
        page.wait_for_function("typeof window.openCurrentGameReplay === 'function'", timeout=10000)
        assert_replay_started(page, 5)
        assert page.locator("#p2AvatarIcon [aria-label='AI 棋手头像']").count() == 1
        legacy_ai_profile = page.evaluate(
            "historyOpponentProfile({ mode: 'ai', date: '2026-01-01', oppName: '大师AI', oppAvatar: '🤖' }, 0)"
        )
        assert legacy_ai_profile["avatar"].startswith("ai_")

        page.evaluate("exitReplayMode({ silent: true })")
        page.wait_for_function("isReplayMode === false")
        page.evaluate("""() => {
          const auth = document.getElementById('authModal');
          auth?.classList.remove('show');
          if (auth) auth.style.display = 'none';
          const result = document.getElementById('gameResultModal');
          result.style.display = 'flex';
          result.classList.add('show');
        }""")
        page.locator("#gameResultModal button").filter(has_text="返回棋盘复盘").click()
        assert_replay_started(page, 5)

        browser.close()


if __name__ == "__main__":
    main()
