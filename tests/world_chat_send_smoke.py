"""Regression coverage for world-chat send and quick-phrase controls."""

from __future__ import annotations

import os

from playwright.sync_api import sync_playwright


URL = os.environ.get("GOMOKU_TEST_URL", "http://127.0.0.1:3000/index.html")
MESSAGES = ["按钮发送回归测试", "精彩对局！", "事件参数回归测试"]
LEGACY_VISIBLE = "正常历史消息"
LEGACY_POINTER_EVENT = "[object PointerEvent]"


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
                if (pathname === '/api/world/messages' && method === 'GET') {
                  data = {
                    messages: [
                      { id: 98000, body: '正常历史消息', senderUid: 'other-user', username: 'other-user', nickname: '测试用户', createdAt: Date.now() },
                      { id: 98001, body: '[object PointerEvent]', senderUid: 'other-user', username: 'other-user', nickname: '测试用户', createdAt: Date.now() }
                    ],
                    hasMore: false,
                    unreadCount: 0
                  };
                } else if (pathname === '/api/world/messages' && method === 'POST') {
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
        page.wait_for_function(
            "text => Array.from(document.querySelectorAll('.world-chat-body'))"
            ".some(node => node.textContent === text)",
            arg=LEGACY_VISIBLE,
            timeout=5_000,
        )
        initial_texts = page.locator(".world-chat-body").all_text_contents()
        assert initial_texts == [LEGACY_VISIBLE], initial_texts
        assert LEGACY_POINTER_EVENT not in page.locator("#worldChatMessages").inner_text()

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
        assert rendered_texts == [LEGACY_VISIBLE] + MESSAGES, rendered_texts
        assert LEGACY_POINTER_EVENT not in page.locator("#worldChatMessages").inner_text()
        browser.close()

    print("world chat send smoke: PASS")


if __name__ == "__main__":
    main()
