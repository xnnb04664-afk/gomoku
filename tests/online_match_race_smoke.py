import json
import os

from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeoutError


MOCK_MQTT_INIT = r"""
(() => {
  const role = window.__gomokuMockRole;
  const brokerOne = 'wss://broker.emqx.io:8084/mqtt';
  const channel = new BroadcastChannel('gomoku-mock-mqtt-race');
  const clients = new Set();
  window.__gomokuMockAcceptedTimes = [];

  function emitter() {
    const listeners = new Map();
    const add = (event, fn, once) => {
      const list = listeners.get(event) || [];
      const wrapped = once ? (...args) => {
        remove(event, wrapped);
        fn(...args);
      } : fn;
      list.push(wrapped);
      listeners.set(event, list);
      return wrapped;
    };
    const remove = (event, fn) => {
      const list = listeners.get(event) || [];
      listeners.set(event, list.filter(item => item !== fn));
    };
    return {
      on(event, fn) { add(event, fn, false); return this; },
      once(event, fn) { add(event, fn, true); return this; },
      removeListener: remove,
      emit(event, ...args) { (listeners.get(event) || []).slice().forEach(fn => fn(...args)); },
    };
  }

  channel.onmessage = ({ data }) => {
    if (!data || data.source === window.__gomokuMockClientId) return;
    clients.forEach(client => {
      if (client.url !== data.url || !client.connected || !client.subscriptions.has(data.topic)) return;
      client.emit('message', data.topic, data.payload);
    });
  };

  window.__gomokuMockMqtt = {
    connect(url) {
      const client = emitter();
      client.url = url;
      client.connected = false;
      client.subscriptions = new Set();
      client.subscribeCounts = new Map();
      client.end = () => {
        if (!client.connected) return;
        client.connected = false;
        client.emit('close');
      };
      client.subscribe = (topic, _opts, callback) => {
        client.subscriptions.add(topic);
        const count = (client.subscribeCounts.get(topic) || 0) + 1;
        client.subscribeCounts.set(topic, count);
        const delayedHostRoomSubscription = role === 'host' && topic.endsWith('/c2h') && count >= 2;
        const delayedGuestRoomSubscription = role === 'guest' && topic.endsWith('/h2c') && count >= 2;
        // Host's first broker is healthy; guest's first broker is unreachable.
        // This reproduces asymmetric fallback selection between two networks.
        setTimeout(() => callback && callback(null), (delayedHostRoomSubscription || delayedGuestRoomSubscription) ? 700 : 0);
      };
      client.publish = (topic, payload) => {
        try {
          const parsed = JSON.parse(String(payload));
          if (role === 'host' && parsed.type === 'join_accepted') window.__gomokuMockAcceptedTimes.push(performance.now());
        } catch (_) {}
        channel.postMessage({
          source: window.__gomokuMockClientId,
          url: client.url,
          topic,
          payload: String(payload),
        });
      };
      clients.add(client);
      const failsForGuest = role === 'guest' && url === brokerOne;
      setTimeout(() => {
        if (failsForGuest) {
          client.emit('error', new Error('simulated broker unavailable for guest'));
          client.emit('close');
          return;
        }
        client.connected = true;
        client.emit('connect');
      }, 20);
      return client;
    }
  };
})();
"""


def main():
    import sys
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")

    url = os.environ.get("GOMOKU_TEST_URL", "http://127.0.0.1:3000/index.html")
    room = "741852"
    output = {}

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        context = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=1)
        pages = {}
        for role in ("host", "guest"):
            page = context.new_page()
            pages[role] = page
            page_errors = []
            console_logs = []
            console_errors = []
            page.on("pageerror", lambda error, errors=page_errors: errors.append(str(error)))
            page.on("console", lambda message, logs=console_logs, errors=console_errors: (logs.append({"type": message.type, "text": message.text}), errors.append(message.text) if message.type == "error" else None))
            page.add_init_script(
                f"window.__gomokuMockRole = {json.dumps(role)}; "
                f"window.__gomokuMockClientId = {json.dumps(role)}; "
                "try { Object.defineProperty(window, 'RTCPeerConnection', { configurable: true, value: undefined }); } catch (_) {} "
                "try { Object.defineProperty(window, 'webkitRTCPeerConnection', { configurable: true, value: undefined }); } catch (_) {}"
            )
            page.add_init_script(MOCK_MQTT_INIT)
            page.route("**/js/mqtt.min.js", lambda route: route.fulfill(status=200, content_type="application/javascript", body="window.mqtt = window.__gomokuMockMqtt;"))
            page.goto(url, wait_until="domcontentloaded", timeout=30_000)
            try:
                page.wait_for_load_state("networkidle", timeout=15_000)
            except PlaywrightTimeoutError:
                pass
            page.locator("#cvs").wait_for(state="visible", timeout=10_000)
            output[role] = {"pageErrors": page_errors, "consoleErrors": console_errors, "consoleLogs": console_logs}

        pages["host"].evaluate("code => window.initHostPeer(code, true)", room)
        pages["guest"].evaluate("code => window.joinOnlineRoom(code)", room)
        pages["host"].wait_for_timeout(250)

        pending_states = {
            role: page.evaluate(
                "() => ({ mode: gameMode, p2: document.querySelector('#p2NameLabel')?.textContent || '', badge: document.querySelector('#roomStatusBadge')?.textContent?.trim() || '' })"
            )
            for role, page in pages.items()
        }
        if any(state["mode"] != "ai" for state in pending_states.values()):
            raise AssertionError(f"a room must not enter online mode before both sides confirm readiness: {pending_states}")
        if "大师AI" not in pending_states["host"]["p2"]:
            raise AssertionError(f"host displayed a guest before join confirmation: {pending_states}")
        pages["guest"].wait_for_timeout(2_500)

        for role, page in pages.items():
            output[role]["state"] = page.evaluate(
                """
                () => ({
                  mode: gameMode,
                  room: currentRoomCode,
                  conn: conn ? { open: conn.open, ready: conn.ready, broker: conn.client?.url || '' } : null,
                  notice: document.querySelector('#gameNoticeToast')?.textContent?.trim() || '',
                  badge: document.querySelector('#roomStatusBadge')?.textContent?.trim() || '',
                  acceptedTimes: window.__gomokuMockAcceptedTimes || []
                })
                """
            )
        host_state = output["host"]["state"]
        guest_state = output["guest"]["state"]
        if not all(state["mode"] == "online" and state["conn"] and state["conn"]["open"] and state["conn"]["ready"]
                   for state in (host_state, guest_state)):
            raise AssertionError(json.dumps(output, ensure_ascii=False))
        color_state = {
            "host": pages["host"].evaluate(
                "({ myColor: myOnlineColor, p1: document.querySelector('#p1NameLabel')?.textContent || '', p2: document.querySelector('#p2NameLabel')?.textContent || '' })"
            ),
            "guest": pages["guest"].evaluate(
                "({ myColor: myOnlineColor, p1: document.querySelector('#p1NameLabel')?.textContent || '', p2: document.querySelector('#p2NameLabel')?.textContent || '' })"
            )
        }
        if color_state["host"]["myColor"] != 1 or color_state["guest"]["myColor"] != 2:
            raise AssertionError(f"online colors were not assigned deterministically: {color_state}")
        if '黑子' not in color_state['host']['p1'] or '白子' not in color_state['host']['p2']:
            raise AssertionError(f"host labels are inconsistent: {color_state}")
        if '白子' not in color_state['guest']['p1'] or '黑子' not in color_state['guest']['p2']:
            raise AssertionError(f"guest labels are inconsistent: {color_state}")
        accepted_times = host_state.get("acceptedTimes") or []
        if not accepted_times:
            raise AssertionError("host did not send join_accepted after its room connection became ready")

        pages["host"].evaluate("window.makeMove(7, 7, BLACK)")
        pages["guest"].wait_for_timeout(250)
        guest_move = pages["guest"].evaluate("({ piece: board[7][7], steps: history.length, turn })")
        if guest_move != {"piece": 1, "steps": 1, "turn": 2}:
            raise AssertionError(f"host move did not reach guest: {guest_move}")

        pages["host"].evaluate("sendChat('MQTT可靠聊天测试')")
        pages["guest"].wait_for_timeout(300)
        guest_chat_count = pages["guest"].evaluate(
            "() => chatHistory.filter(item => item.sender === 2 && item.text === 'MQTT可靠聊天测试').length"
        )
        if guest_chat_count != 1:
            raise AssertionError(f"MQTT chat was not delivered exactly once: {guest_chat_count}")

        pages["guest"].evaluate("window.makeMove(7, 8, WHITE)")
        pages["host"].wait_for_timeout(250)
        host_move = pages["host"].evaluate("({ piece: board[7][8], steps: history.length, turn })")
        if host_move != {"piece": 2, "steps": 2, "turn": 1}:
            raise AssertionError(f"guest move did not reach host: {host_move}")

        print(json.dumps({
            "pass": True,
            "host": host_state,
            "guest": guest_state,
            "crossBrokerFallback": True,
            "colorAssignment": color_state,
            "bidirectionalMoves": True,
            "mqttReliableChatExactlyOnce": guest_chat_count == 1,
            "pageErrors": {role: output[role]["pageErrors"] for role in output},
            "consoleErrors": {role: output[role]["consoleErrors"] for role in output},
        }, ensure_ascii=False, indent=2))
        browser.close()


if __name__ == "__main__":
    main()
