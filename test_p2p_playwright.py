import sys

from playwright.sync_api import sync_playwright


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    host = browser.new_page()
    guest = browser.new_page()
    logs = []
    url = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:3000/"
    for label, page in [("HOST", host), ("GUEST", guest)]:
        page.on("console", lambda msg, label=label: logs.append(f"{label} CONSOLE {msg.type}: {msg.text}"))
        page.on("pageerror", lambda exc, label=label: logs.append(f"{label} PAGEERROR: {exc}"))
        page.goto(url, wait_until="networkidle", timeout=30000)

    host.evaluate("void openOnlineModal()")
    host.wait_for_function("() => document.querySelector('#roomStatusBadge').innerText.includes('P2P 直连房间已就绪')", timeout=20000)
    room_code = host.locator("#myRoomCodeDisplay").inner_text().strip()
    print("HOST_READY", room_code, host.locator("#roomStatusBadge").inner_text())

    guest.evaluate("void openOnlineModal()")
    guest.evaluate("switchOnlineTab('join')")
    guest.locator("#inputJoinCode").fill(room_code)
    guest.evaluate("void joinOnlineRoom()")
    guest.wait_for_function("() => window.location.href && typeof gameMode !== 'undefined' && gameMode === 'online'", timeout=20000)
    host.wait_for_function("() => typeof gameMode !== 'undefined' && gameMode === 'online'", timeout=10000)
    print("P2P_CONNECTED", host.evaluate("p2pChannel && p2pChannel.open"), guest.evaluate("p2pChannel && p2pChannel.open"))
    print("MODALS", host.locator("#onlineModal").get_attribute("class"), guest.locator("#onlineModal").get_attribute("class"))
    for line in logs:
        print(line)
    browser.close()
