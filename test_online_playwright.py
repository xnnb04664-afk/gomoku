from playwright.sync_api import sync_playwright


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()
    console_logs = []
    page.on("console", lambda msg: console_logs.append(f"CONSOLE {msg.type}: {msg.text}"))
    page.on("pageerror", lambda exc: console_logs.append(f"PAGEERROR: {exc}"))
    page.on("requestfailed", lambda req: console_logs.append(
        f"REQUESTFAILED {req.url}: {req.failure}"
    ))

    page.goto("http://127.0.0.1:3000/", wait_until="networkidle", timeout=30000)
    print("TITLE", page.title())
    print("PEER_TYPE", page.evaluate("typeof Peer"))
    print("MQTT_TYPE", page.evaluate("typeof mqtt"))
    print("BTN_ONLINE", page.locator("#btnOnline").count())

    for broker_url in [
        "wss://broker.emqx.io:8084/mqtt",
        "wss://broker.hivemq.com:8884/mqtt",
    ]:
        result = page.evaluate(
            """async (url) => new Promise((resolve) => {
                const client = mqtt.connect(url, {
                    clientId: 'probe_' + Math.random().toString(36).slice(2),
                    connectTimeout: 5000,
                    reconnectPeriod: 0,
                    clean: true
                });
                const timer = setTimeout(() => {
                    try { client.end(true); } catch (_) {}
                    resolve('timeout');
                }, 6500);
                client.once('connect', () => {
                    clearTimeout(timer);
                    client.end(true);
                    resolve('connected');
                });
                client.once('error', (err) => {
                    clearTimeout(timer);
                    try { client.end(true); } catch (_) {}
                    resolve('error: ' + (err && (err.message || err.type) || String(err)));
                });
            })""",
            broker_url,
        )
        print("BROKER", broker_url, result)

    page.locator("#btnOnline").click()
    page.wait_for_timeout(12000)
    print("MODAL", page.locator("#onlineModal").get_attribute("class"))
    print("ROOM_CODE", page.locator("#myRoomCodeDisplay").inner_text())
    print("ROOM_STATUS", page.locator("#roomStatusBadge").inner_text())
    page.screenshot(path="online-modal.png", full_page=True)
    for line in console_logs:
        print(line)
    browser.close()
