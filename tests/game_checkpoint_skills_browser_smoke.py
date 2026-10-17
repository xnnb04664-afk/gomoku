from pathlib import Path

from playwright.sync_api import sync_playwright


URL = (Path(__file__).resolve().parents[1] / "index.html").as_uri()


def main():
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        page = browser.new_page()
        page.route("**/api/**", lambda route: route.abort())
        page.goto(URL, wait_until="domcontentloaded", timeout=30000)
        page.wait_for_function("typeof window.resumeSavedGame === 'function'", timeout=30000)

        restored = page.evaluate("""() => {
          const board = Array.from({ length: 15 }, () => Array(15).fill(EMPTY));
          board[7][6] = BLACK;
          board[7][8] = WHITE;
          const snapshot = {
            ownerUid: 'guest', gameMode: 'pvp', isOver: false,
            board, history: [{ r: 7, c: 6, p: BLACK }, { r: 7, c: 8, p: WHITE }],
            turn: BLACK, savedAt: Date.now(), hasExtraMove: true,
            consecutiveMovesLeft: 2, opponentFreeMove: true,
            prophecyPoint: { r: 6, c: 7, by: BLACK },
            currentDrawnCards: [], cardUsedStatus: [false, false, false]
          };
          localStorage.setItem('gomoku_current_game_v1_guest', JSON.stringify(snapshot));
          return window.resumeSavedGame();
        }""")
        assert restored is True, "saved game checkpoint should be accepted"

        state = page.evaluate("""() => ({
          hasExtraMove,
          consecutiveMovesLeft,
          opponentFreeMove,
          prophecyPoint
        })""")
        assert state["hasExtraMove"] is True
        assert state["consecutiveMovesLeft"] == 2
        assert state["opponentFreeMove"] is True
        assert state["prophecyPoint"] == {"r": 6, "c": 7, "by": 1}

        saved = page.evaluate("""() => {
          persistGameState();
          return JSON.parse(localStorage.getItem('gomoku_current_game_v1_guest'));
        }""")
        assert saved["hasExtraMove"] is True
        assert saved["consecutiveMovesLeft"] == 2
        assert saved["opponentFreeMove"] is True
        assert saved["prophecyPoint"] == {"r": 6, "c": 7, "by": 1}

        browser.close()
    print("Current game skill checkpoint browser smoke passed.")


if __name__ == "__main__":
    main()
