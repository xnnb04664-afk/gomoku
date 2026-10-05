"""Regression coverage for world-chat send and quick-phrase controls."""

from __future__ import annotations

import os

from playwright.sync_api import sync_playwright


URL = os.environ.get("GOMOKU_TEST_URL", "http://127.0.0.1:3000/index.html")
MESSAGES = ["按钮发送回归测试", "精彩对局！", "事件参数回归测试"]


def main() -> None:
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 390, "height": 844})
        page.goto(URL, wait_until="domcontentloaded", timeout=30_000)
        page.wait_for_function("() => Boolean(window.GomokuWorldChat)", timeout=15_000)

        page.evaluate(
            """() => {
              window.__worldChatRequests = [];
              window.__worldChatNextId = 99000;
              window.hasRegisteredAccountSession = () => true;
              window.safeApiFetch = async (endpoint, options = {}) => {
                window.__worldChatRequests.push({ endpoint: String(endpoint), options });
                const method = String(options.method || 'GET').toUpperCase();
                const pathname = new URL(String(endpoint), window.location.href).pathname;
                let data = { messages: [], hasMore: false, unreadCount: 0 };
                if (pathname === '/api/world/messages' && method === 'POST') {
                  const body = JSON.parse(options.body || '{}');
                  data = {
                    id: ++window.__worldChatNextId,
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

        page.locator("#worldChatInput").fill(MESSAGES[0])
        page.locator("#worldChatSend").click()
        page.wait_for_function(
            "message => window.__worldChatRequests.some(item => "
            "item.endpoint.includes('/api/world/messages') && "
            "String(item.options.method || 'GET').toUpperCase() === 'POST' && "
            "JSON.parse(item.options.body || '{}').text === message)",
            arg=MESSAGES[0],
            timeout=5_000,
        )

        quick = page.locator('[data-world-quick="精彩对局！"]')
        quick.click()
        assert page.locator("#worldChatInput").input_value() == MESSAGES[1]
        page.locator("#worldChatSend").click()
        page.wait_for_function(
            "message => window.__worldChatRequests.filter(item => "
            "item.endpoint.includes('/api/world/messages') && "
            "String(item.options.method || 'GET').toUpperCase() === 'POST' && "
            "JSON.parse(item.options.body || '{}').text === message).length === 1",
            arg=MESSAGES[1],
            timeout=5_000,
        )

        page.locator("#worldChatInput").fill(MESSAGES[2])
        page.evaluate("() => window.GomokuWorldChat.send(new PointerEvent('click'))")
        page.wait_for_function(
            "message => window.__worldChatRequests.some(item => "
            "item.endpoint.includes('/api/world/messages') && "
            "String(item.options.method || 'GET').toUpperCase() === 'POST' && "
            "JSON.parse(item.options.body || '{}').text === message)",
            arg=MESSAGES[2],
            timeout=5_000,
        )

        sent_texts = page.evaluate(
            """() => window.__worldChatRequests
              .filter(item => item.endpoint.includes('/api/world/messages') &&
                new URL(item.endpoint, window.location.href).pathname === '/api/world/messages' &&
                String(item.options.method || 'GET').toUpperCase() === 'POST')
              .map(item => JSON.parse(item.options.body || '{}').text)"""
        )
        rendered_texts = page.locator(".world-chat-body").all_text_contents()
        assert sent_texts == MESSAGES, sent_texts
        assert rendered_texts == MESSAGES, rendered_texts
        assert all("[object PointerEvent]" not in text for text in sent_texts + rendered_texts)
        browser.close()

    print("world chat send smoke: PASS")


if __name__ == "__main__":
    main()
