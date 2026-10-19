from pathlib import Path

from playwright.sync_api import sync_playwright


URL = (Path(__file__).resolve().parents[1] / "index.html").as_uri()
BLACK = 1
WHITE = 2

CONTROLLED_RANDOM_SCRIPT = """
(() => {
  const nativeRandom = Math.random.bind(Math);
  let forcedValue = null;
  window.__setGomokuTestRandom = value => { forcedValue = value; };
  Math.random = () => forcedValue === null ? nativeRandom() : forcedValue;
})();
"""


def open_page(browser):
    page = browser.new_page(viewport={"width": 1280, "height": 900})
    page.add_init_script(CONTROLLED_RANDOM_SCRIPT)
    page.route("**/api/**", lambda route: route.abort())
    page.goto(URL, wait_until="domcontentloaded", timeout=30000)
    page.wait_for_function(
        "typeof window.resumeSavedGame === 'function' && Boolean(window.SkyIslandUI)",
        timeout=30000,
    )
    # The private build opens a guest login prompt shortly after startup. The
    # AI board is testable without an account, so dismiss that expected prompt.
    page.wait_for_function(
        "document.getElementById('authModal')?.classList.contains('show')",
        timeout=5000,
    )
    page.evaluate("""() => {
      window.closeAuthModal();
    }""")
    page.evaluate("""() => {
      window.__nativeAiCalls = [];
      window.AndroidNativeApp = {
        requestNativeAiMove(requestId, boardJson, color, forbiddenJson) {
          window.__nativeAiCalls.push({
            requestId,
            color: Number(color),
            board: JSON.parse(boardJson),
            forbidden: JSON.parse(forbiddenJson)
          });
          return true;
        }
      };
    }""")
    return page


def enter_ai_game(page, random_value):
    page.evaluate("""() => {
      window.__gomokuTestModeResizeCount = 0;
      window.addEventListener('resize', () => window.__gomokuTestModeResizeCount++);
    }""")
    page.evaluate(
        """value => {
          window.__setGomokuTestRandom(value);
          return window.SkyIslandUI.enterMode('ai');
        }""",
        random_value,
    )
    page.wait_for_function(
        """() => document.body.classList.contains('sky-game-open') && (() => {
          try { return JSON.parse(sessionStorage.getItem('gomoku_active_game_state') || 'null')?.gameMode === 'ai'; }
          catch (_) { return false; }
        })()""",
        timeout=15000,
    )
    page.locator("#cvs").wait_for(state="visible", timeout=10000)
    # showGame dispatches a resize after revealing the board. Wait for that
    # event and two stable frames before reading the canvas's live geometry.
    page.wait_for_function("window.__gomokuTestModeResizeCount > 0", timeout=5000)
    page.evaluate("""() => new Promise(resolve => {
      let previous = '';
      let stableFrames = 0;
      const sample = () => {
        const canvas = document.getElementById('cvs');
        const rect = canvas.getBoundingClientRect();
        const current = [rect.x, rect.y, rect.width, rect.height, cWidth, cHeight].join(':');
        stableFrames = current === previous ? stableFrames + 1 : 0;
        previous = current;
        if (stableFrames >= 2) resolve();
        else requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    })""")


def current_state(page):
    return page.evaluate("""() => JSON.parse(sessionStorage.getItem('gomoku_active_game_state'))""")


def click_board(page, row, col):
    point = page.evaluate("""({ row, col }) => {
      const canvas = document.getElementById('cvs');
      const rect = canvas.getBoundingClientRect();
      const logicalX = paddingX + (col + 0.5) * gridX;
      const logicalY = paddingY + (row + 0.5) * gridY;
      const x = rect.left + logicalX / cWidth * rect.width;
      const y = rect.top + logicalY / cHeight * rect.height;
      const mapped = getBoardPointFromPointer({ clientX: x, clientY: y });
      const state = JSON.parse(sessionStorage.getItem('gomoku_active_game_state') || 'null');
      return {
        x,
        y,
        targetId: document.elementFromPoint(x, y)?.id || '',
        mapped,
        geometry: { paddingX, paddingY, gridX, gridY, cWidth, cHeight },
        state: state && { history: state.history, turn: state.turn, aiPlayerColor: state.aiPlayerColor }
      };
    }""", {"row": row, "col": col})
    assert point["targetId"] == "cvs", f"board click target mismatch: {point}"
    assert point["mapped"] == {"row": row, "col": col}, f"board point mapping mismatch: {point}"
    page.mouse.click(point["x"], point["y"])


def resolve_native_move(page, call_index, row, col):
    page.evaluate("""({ callIndex, row, col }) => {
      const call = window.__nativeAiCalls[callIndex];
      if (!call) throw new Error(`Missing native AI call ${callIndex}`);
      window.__gomokuNativeAiResult(call.requestId, JSON.stringify({
        ok: true, r: row, c: col, engine: 'java', elapsedMs: 1
      }));
    }""", {"callIndex": call_index, "row": row, "col": col})


def seed_winning_checkpoint(page, human_color):
    black_row = 5 if human_color == WHITE else 7
    white_row = 7 if human_color == WHITE else 5
    board = [[0] * 15 for _ in range(15)]
    history = []
    for col in range(3, 7):
        board[black_row][col] = BLACK
        board[white_row][col] = WHITE
    for col in range(3, 7):
        history.append({"r": black_row, "c": col, "p": BLACK})
        history.append({"r": white_row, "c": col, "p": WHITE})

    # After four alternating pairs, add black's fifth move. White then wins
    # on its turn; for a black win, add white's fifth move and restore black's turn.
    board[0][0] = BLACK
    history.append({"r": 0, "c": 0, "p": BLACK})
    turn = WHITE
    if human_color == BLACK:
        board[0][1] = WHITE
        history.append({"r": 0, "c": 1, "p": WHITE})
        turn = BLACK
    snapshot = {
        "ownerUid": "guest",
        "gameMode": "ai",
        "isOver": False,
        "board": board,
        "history": history,
        "turn": turn,
        "aiPlayerColor": human_color,
        "p1Name": "颜色回归玩家",
        "p2Name": "回归 AI",
        "savedAt": 1,
    }
    page.evaluate("""snapshot => {
      localStorage.setItem('gomoku_current_game_v1_guest', JSON.stringify(snapshot));
      window.__setGomokuTestRandom(snapshot.aiPlayerColor === 1 ? 0.9 : 0.1);
      if (!window.resumeSavedGame()) throw new Error('AI checkpoint was rejected');
    }""", snapshot)


def verify_winner_record(page, human_color):
    seed_winning_checkpoint(page, human_color)
    label_text = page.locator("#p1NameLabel").inner_text()
    opponent_text = page.locator("#p2NameLabel").inner_text()
    expected_human_tag = "●黑子" if human_color == BLACK else "○白子"
    expected_ai_tag = "○白子" if human_color == BLACK else "●黑子"
    assert expected_human_tag in label_text, f"human header color mismatch: {label_text}"
    assert expected_ai_tag in opponent_text, f"AI header color mismatch: {opponent_text}"

    click_board(page, 7, 7)
    page.wait_for_function(
        """() => {
          try { return JSON.parse(sessionStorage.getItem('gomoku_active_game_state') || 'null')?.isOver === true; }
          catch (_) { return false; }
        }""",
        timeout=10000,
    )
    page.wait_for_function(
        "document.getElementById('gameResultModal')?.classList.contains('show')",
        timeout=5000,
    )
    page.locator("#resultModalSub").wait_for(state="visible")
    page.locator("#gameResultModal .btn-confirm-ok").click()
    page.wait_for_function(
        """() => {
          try { return JSON.parse(localStorage.getItem('gomoku_game_history_guest') || '[]').length > 0; }
          catch (_) { return false; }
        }""",
        timeout=10000,
    )
    record = page.evaluate("""() => JSON.parse(localStorage.getItem('gomoku_game_history_guest'))[0]""")
    assert record["winnerColor"] == human_color, f"winner color mismatch: {record}"
    assert record["myColor"] == human_color, f"saved myColor mismatch: {record}"
    assert record["isWin"] is True and record["isPlayerWin"] is True, f"win result mismatch: {record}"


def test_ai_black_open_and_white_undo(browser):
    page = open_page(browser)
    try:
        enter_ai_game(page, 0.75)  # 人类白，AI 黑。
        page.wait_for_function("window.__nativeAiCalls.length === 1", timeout=10000)
        state = current_state(page)
        assert state["aiPlayerColor"] == WHITE
        assert state["turn"] == BLACK
        assert state["history"] == [], "AI black must own the opening turn"
        call = page.evaluate("window.__nativeAiCalls[0]")
        assert call["color"] == BLACK, f"AI opening must request black: {call}"
        assert len(call["board"]) == 225 and all(value == 0 for value in call["board"])

        # Leave the AI request pending and attempt to play as white during black's turn.
        click_board(page, 7, 7)
        state = current_state(page)
        assert state["history"] == [], "human white must not take AI black's opening turn"
        assert page.evaluate("window.__nativeAiCalls.length") == 1

        resolve_native_move(page, 0, 7, 7)
        page.wait_for_function(
            """() => {
              try {
                const state = JSON.parse(sessionStorage.getItem('gomoku_active_game_state') || 'null');
                return state?.history?.length === 1 && state.history[0].p === 1 && state.turn === 2;
              } catch (_) { return false; }
            }""",
            timeout=10000,
        )
        assert "○白子" in page.locator("#p1NameLabel").inner_text()
        assert "●黑子" in page.locator("#p2NameLabel").inner_text()

        # A restore must retain white even though the controlled random value now selects black.
        page.evaluate("""() => {
          window.__setGomokuTestRandom(0.25);
          if (!window.resumeSavedGame()) throw new Error('saved AI game was not restored');
        }""")
        assert "○白子" in page.locator("#p1NameLabel").inner_text()
        click_board(page, 7, 8)
        page.wait_for_function(
            """() => {
              try {
                const state = JSON.parse(sessionStorage.getItem('gomoku_active_game_state') || 'null');
                return state?.history?.length === 2 && state.history[1].p === 2 && state.turn === 1;
              } catch (_) { return false; }
            }""",
            timeout=10000,
        )
        page.wait_for_function("window.__nativeAiCalls.length === 2", timeout=10000)
        second_call = page.evaluate("window.__nativeAiCalls[1]")
        assert second_call["color"] == BLACK, f"AI should own the next black turn: {second_call}"
        resolve_native_move(page, 1, 8, 8)
        page.wait_for_function(
            """() => {
              try {
                const state = JSON.parse(sessionStorage.getItem('gomoku_active_game_state') || 'null');
                return state?.history?.length === 3 && state.turn === 2;
              } catch (_) { return false; }
            }""",
            timeout=10000,
        )

        page.locator("#btnUndo").click()
        page.locator("#undoModal.show").wait_for(state="visible", timeout=5000)
        page.locator("#btnUndoAgree").click()
        page.wait_for_function(
            """() => {
              try {
                const state = JSON.parse(sessionStorage.getItem('gomoku_active_game_state') || 'null');
                return state?.history?.length === 1 && state.turn === 2 && state.board[7][7] === 1;
              } catch (_) { return false; }
            }""",
            timeout=10000,
        )
        assert page.evaluate("window.__nativeAiCalls.length") == 2, "undo should return control to human white"
    finally:
        page.close()


def test_ai_white_waits_for_human_black(browser):
    page = open_page(browser)
    try:
        enter_ai_game(page, 0.25)  # 人类黑，AI 白。
        state = current_state(page)
        assert state["aiPlayerColor"] == BLACK
        assert state["turn"] == BLACK
        assert state["history"] == []
        assert "●黑子" in page.locator("#p1NameLabel").inner_text()
        click_board(page, 7, 7)
        page.wait_for_function(
            """() => {
              try {
                const state = JSON.parse(sessionStorage.getItem('gomoku_active_game_state') || 'null');
                return state?.history?.length === 1 && state.history[0].p === 1 && state.turn === 2;
              } catch (_) { return false; }
            }""",
            timeout=10000,
        )
        page.wait_for_function("window.__nativeAiCalls.length === 1", timeout=10000)
        call = page.evaluate("window.__nativeAiCalls[0]")
        assert call["color"] == WHITE, f"AI should take white after the human black opening: {call}"
    finally:
        page.close()


def test_winner_and_record_my_color(browser, human_color):
    page = open_page(browser)
    try:
        verify_winner_record(page, human_color)
    finally:
        page.close()


def test_legacy_checkpoint_defaults_to_black(browser):
    page = open_page(browser)
    try:
        board = [[0] * 15 for _ in range(15)]
        board[7][7] = BLACK
        snapshot = {
            "ownerUid": "guest",
            "gameMode": "ai",
            "isOver": False,
            "board": board,
            "history": [{"r": 7, "c": 7, "p": BLACK}],
            "turn": WHITE,
            "p1Name": "旧档玩家",
            "savedAt": 1,
        }
        page.evaluate("""snapshot => {
          localStorage.setItem('gomoku_current_game_v1_guest', JSON.stringify(snapshot));
          window.__setGomokuTestRandom(0.9);
          if (!window.resumeSavedGame()) throw new Error('legacy AI checkpoint was rejected');
        }""", snapshot)
        assert "●黑子" in page.locator("#p1NameLabel").inner_text(), "legacy saves should default the human to black"
        assert "○白子" in page.locator("#p2NameLabel").inner_text(), "legacy saves should default the AI to white"
    finally:
        page.close()


def main():
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        test_ai_black_open_and_white_undo(browser)
        test_ai_white_waits_for_human_black(browser)
        test_winner_and_record_my_color(browser, BLACK)
        test_winner_and_record_my_color(browser, WHITE)
        test_legacy_checkpoint_defaults_to_black(browser)
        browser.close()
    print("AI player color browser smoke passed.")


if __name__ == "__main__":
    main()
