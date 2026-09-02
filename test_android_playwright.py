from playwright.sync_api import sync_playwright


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()
    logs = []
    page.on("console", lambda msg: logs.append(f"CONSOLE {msg.type}: {msg.text}"))
    page.on("pageerror", lambda exc: logs.append(f"PAGEERROR: {exc}"))
    page.on("requestfailed", lambda req: logs.append(f"REQUESTFAILED {req.url}: {req.failure}"))
    page.goto("http://127.0.0.1:3000/android_src/assets/index.html", wait_until="networkidle", timeout=30000)
    print("TITLE", page.title())
    print("PEER_TYPE", page.evaluate("typeof Peer"))
    print("BUTTONS", page.locator("#btnCreateRoom").count(), page.locator("#btnJoinRoom").count())
    page.locator("#btnCreateRoom").click()
    page.wait_for_timeout(10000)
    print("STATUS", page.locator("#onlineStatusText").inner_text())
    print("ROOM", page.locator("#currentRoomCode").inner_text() if page.locator("#currentRoomCode").count() else "n/a")
    for line in logs:
        print(line)
    browser.close()
