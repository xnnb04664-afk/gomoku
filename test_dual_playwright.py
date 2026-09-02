from playwright.sync_api import sync_playwright


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    host = browser.new_page()
    guest = browser.new_page()
    logs = []
    for label, page in [("HOST", host), ("GUEST", guest)]:
        page.on("console", lambda msg, label=label: logs.append(f"{label} CONSOLE {msg.type}: {msg.text}"))
        page.on("pageerror", lambda exc, label=label: logs.append(f"{label} PAGEERROR: {exc}"))
        page.on("requestfailed", lambda req, label=label: logs.append(f"{label} REQUESTFAILED {req.url}: {req.failure}"))
        page.goto("http://127.0.0.1:3000/", wait_until="networkidle", timeout=30000)

    host.locator("#btnOnline").click()
    host.wait_for_timeout(3000)
    room_code = host.locator("#myRoomCodeDisplay").inner_text().strip()
    host_status = host.locator("#roomStatusBadge").inner_text()
    print("HOST", room_code, host_status)

    guest.locator("#btnOnline").click()
    guest.locator("#tabJoinRoom").click()
    guest.locator("#inputJoinCode").fill(room_code)
    guest.locator("#btnConnectRoom").click()
    guest.wait_for_timeout(8000)
    host.wait_for_timeout(1000)
    print("GUEST_STATUS", guest.locator("#onlineStatusText").inner_text())
    print("GUEST_MODAL", guest.locator("#onlineModal").get_attribute("class"))
    print("HOST_STATUS", host.locator("#roomStatusBadge").inner_text())
    print("HOST_MODE", host.evaluate("gameMode"))
    print("GUEST_MODE", guest.evaluate("gameMode"))
    for line in logs:
        print(line)
    browser.close()
