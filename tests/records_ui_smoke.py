import json
from pathlib import Path

from playwright.sync_api import sync_playwright


ROOT = Path(r"D:\小游戏\五子棋")
URL = "http://127.0.0.1:3000/index.html?records-smoke=20261002"
SCREENSHOT_DIR = ROOT / ".codex-diagnostics"


def main() -> None:
    SCREENSHOT_DIR.mkdir(exist_ok=True)
    sample = [{
        "mode": "ai",
        "isWin": True,
        "isDraw": False,
        "oppName": "大师AI",
        "oppAvatar": "🤖",
        "moves": 18,
        "date": "10/02",
        "time": "18:26",
        "movesData": [
            {"r": 7, "c": 7, "p": 1}, {"r": 7, "c": 8, "p": 2},
            {"r": 8, "c": 8, "p": 1}, {"r": 6, "c": 8, "p": 2},
            {"r": 8, "c": 7, "p": 1}, {"r": 8, "c": 9, "p": 2},
            {"r": 9, "c": 7, "p": 1}, {"r": 6, "c": 7, "p": 2},
            {"r": 10, "c": 7, "p": 1}
        ],
        "boardData": [[0] * 15 for _ in range(15)],
    }]
    sample[0]["boardData"][7][7] = 1
    sample[0]["boardData"][7][8] = 2
    sample[0]["boardData"][8][8] = 1
    sample[0]["boardData"][6][8] = 2
    sample[0]["boardData"][8][7] = 1
    sample[0]["boardData"][8][9] = 2
    sample[0]["boardData"][9][7] = 1
    sample[0]["boardData"][6][7] = 2
    sample[0]["boardData"][10][7] = 1

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 390, "height": 844}, device_scale_factor=1)
        errors = []
        page.on("pageerror", lambda error: errors.append(f"pageerror: {error}"))
        page.on("console", lambda message: errors.append(f"console {message.type}: {message.text}") if message.type == "error" else None)
        payload = json.dumps(sample, ensure_ascii=False)
        page.add_init_script(f"localStorage.setItem('gomoku_game_history_guest', {json.dumps(payload)});")
        page.goto(URL, wait_until="domcontentloaded")
        page.wait_for_selector("#skyLobby", timeout=10000)
        page.wait_for_timeout(1800)
        page.get_by_role("button", name="棋谱").click()
        page.wait_for_selector(".sky-records-overview", timeout=5000)
        page.wait_for_timeout(250)

        assert page.locator(".sky-records-metrics").inner_text().find("总对局") >= 0
        assert page.locator(".sky-records-latest-copy h2").inner_text() == "VS 大师AI"
        assert page.locator(".sky-record-item").count() == 1
        assert page.locator(".sky-records-stone").count() >= 9
        page.screenshot(path=str(SCREENSHOT_DIR / "records-final-mobile.png"), full_page=True)

        page.locator(".sky-record-item").first.click()
        page.wait_for_timeout(1200)
        assert "sky-game-open" in (page.locator("body").get_attribute("class") or "")
        assert page.locator("#replayTopBar").is_visible()
        assert page.locator("#replayStepLabel").inner_text().find("共") >= 0
        page.screenshot(path=str(SCREENSHOT_DIR / "records-replay-mobile.png"), full_page=True)

        desktop = browser.new_page(viewport={"width": 1440, "height": 900}, device_scale_factor=1)
        desktop.add_init_script(f"localStorage.setItem('gomoku_game_history_guest', {json.dumps(payload)});")
        desktop.goto(URL, wait_until="domcontentloaded")
        desktop.wait_for_selector("#skyLobby", timeout=10000)
        desktop.wait_for_timeout(3600)
        desktop.get_by_role("button", name="棋谱").click()
        desktop.wait_for_selector(".sky-records-overview", timeout=5000)
        desktop.screenshot(path=str(SCREENSHOT_DIR / "records-final-desktop.png"), full_page=True)
        desktop.locator("#skyNavWorkspace").evaluate("node => { node.scrollTop = node.scrollHeight; }")
        desktop.wait_for_timeout(100)
        assert desktop.locator(".sky-records-log").is_visible()

        empty = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=1)
        empty_page = empty.new_page()
        empty.add_init_script("localStorage.removeItem('gomoku_game_history_guest');")
        empty_page.goto(URL, wait_until="domcontentloaded")
        empty_page.wait_for_selector("#skyLobby", timeout=10000)
        empty_page.wait_for_timeout(3600)
        empty_page.get_by_role("button", name="棋谱").click()
        empty_page.wait_for_selector(".sky-records-empty-log", timeout=5000)
        assert empty_page.locator(".sky-record-item").count() == 0
        empty.close()

        if errors:
            raise AssertionError("; ".join(errors))
        desktop.close()
        browser.close()


if __name__ == "__main__":
    main()
