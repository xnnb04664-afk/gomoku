from playwright.sync_api import sync_playwright


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1280, "height": 900})
        events = []
        page.on("console", lambda msg: events.append(f"CONSOLE {msg.type}: {msg.text}"))
        page.on("pageerror", lambda exc: events.append(f"PAGEERROR: {exc}"))
        page.on(
            "requestfailed",
            lambda req: events.append(f"REQUESTFAILED: {req.url} :: {req.failure}"),
        )

        page.goto("http://127.0.0.1:3000/", wait_until="networkidle", timeout=30000)
        print("TITLE", page.title())
        print("READY", page.evaluate("document.readyState"))
        print("BODY_VISIBLE", page.locator("body").is_visible())
        print("PEER_TYPE", page.evaluate("typeof window.Peer"))
        print("MQTT_TYPE", page.evaluate("typeof window.mqtt"))
        print("OPEN_ONLINE_TYPE", page.evaluate("typeof window.openOnlineModal"))
        print("RESTART_TYPE", page.evaluate("typeof window.restartGame"))
        print("ONLINE_BUTTONS", page.locator("#btnOnline").count())

        page.locator("#btnRestart").click()
        print("RESTART_CLICKED", True)
        page.screenshot(path="review-home.png", full_page=True)

        if page.evaluate("typeof window.openOnlineModal === 'function'"):
            page.locator("#btnOnline").click()
            print("ONLINE_MODAL_CLASS", page.locator("#onlineModal").get_attribute("class"))
            print("ROOM_CODE", page.locator("#myRoomCodeDisplay").inner_text())
            print("ROOM_STATUS", page.locator("#roomStatusBadge").inner_text())
        else:
            print("ONLINE_MODAL_SKIPPED", "openOnlineModal is unavailable")

        for event in events:
            print(event)
        browser.close()


if __name__ == "__main__":
    main()
