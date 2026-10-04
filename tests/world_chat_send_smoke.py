"""Regression test for world-chat button sends.

The send button must read the textarea value instead of receiving the browser's
click PointerEvent as send(text).
"""

from __future__ import annotations

import os

from playwright.sync_api import sync_playwright


URL = os.environ.get("GOMOKU_TEST_URL", "http://127.0.0.1:3000/index.html")
MESSAGE = "按钮发送回归测试"


def main() -> None:
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 390, "height": 844})
        page.goto(URL, wait_until="networkidle", timeout=30_000)
        page.wait_for_function("() => Boolean(window.GomokuWorldChat)", timeout=15_000)

        page.evaluate(
            """() => {
              window.__worldChatRequests = [];
              window.hasRegisteredAccountSession = () => true;
              window.safeApiFetch = async (endpoint, options = {}) => {
                window.__worldChatRequests.push({ endpoint: String(endpoint), options });
                const method = String(options.method || 'GET').toUpperCase();
                let data = { messages: [], hasMore: false, unreadCount: 0 };
                if (String(endpoint).includes('/api/world/messages') && method === 'POST') {
                  const body = JSON.parse(options.body || '{}');
                  data = {
                    id: 99001,
                    body: body.text,
                    senderUid: 'test-user',
                    username: 'test-user',
                    nickname: '测试用户',
                    createdAt: Date.now()
                  };
                } else if (String(endpoint).includes('/api/world/socket-ticket')) {
                  data = { ticket: 'a'.repeat(48) };
                }
                return {
                  ok: true,
                  status: 200,
                  url: window.location.href,
                  json: async () => ({ code: 0, data })
                };
              };
            }"""
        )

        page.evaluate("window.GomokuWorldChat.open()")
        page.wait_for_selector("#worldChatPanel.show")
        page.locator("#worldChatInput").fill(MESSAGE)
        page.locator("#worldChatSend").click()
        page.wait_for_function(
            "message => window.__worldChatRequests.some(item => "
            "item.endpoint.includes('/api/world/messages') && "
            "String(item.options.method || 'GET').toUpperCase() === 'POST' && "
            "JSON.parse(item.options.body || '{}').text === message)",
            arg=MESSAGE,
            timeout=5_000,
        )

        request_text = page.evaluate(
            """() => {
              const request = window.__worldChatRequests.find(item =>
                item.endpoint.includes('/api/world/messages') &&
                String(item.options.method || 'GET').toUpperCase() === 'POST'
              );
              return request ? JSON.parse(request.options.body || '{}').text : '';
            }"""
        )
        rendered_text = page.locator(".world-chat-body").last.text_content()
        assert request_text == MESSAGE, request_text
        assert rendered_text == MESSAGE, rendered_text
        assert request_text != "[object PointerEvent]"
        browser.close()

    print("world chat send smoke: PASS")


if __name__ == "__main__":
    main()
