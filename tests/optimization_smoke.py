import json
import os
import sys
import tempfile
from pathlib import Path

from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeoutError


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    errors = []
    page_errors = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 390, "height": 844}, device_scale_factor=1)
        page.on("console", lambda message: errors.append(message.text) if message.type == "error" else None)
        page.on("pageerror", lambda error: page_errors.append(str(error)))

        test_url = os.environ.get("GOMOKU_TEST_URL", "http://127.0.0.1:3000/index.html")
        page.goto(test_url, wait_until="domcontentloaded", timeout=30_000)
        try:
            page.wait_for_load_state("networkidle", timeout=15_000)
        except PlaywrightTimeoutError:
            # 外部 CDN 不应阻止核心页面完成；记录状态后继续检查本地功能。
            pass

        page.locator("#cvs").wait_for(state="visible", timeout=10_000)
        critical = page.evaluate(
            """
            () => ({
              title: document.title,
              version: document.querySelector('#appVersionDisplay')?.textContent?.trim() || '',
              canvas: Boolean(document.querySelector('#cvs')),
              playerLabels: Boolean(document.querySelector('#p1NameLabel') && document.querySelector('#p2NameLabel')),
              functions: ['draw', 'makeMove', 'checkWin', 'triggerGameEnd', 'showGameResultModal']
                .filter(name => typeof window[name] === 'function')
            })
            """
        )
        behavior = page.evaluate(
            """
            () => {
              let chatCapError = '';
              try {
                for (let i = 0; i < 120; i++) window.addMessage(2, `smoke-${i}`);
              } catch (error) {
                chatCapError = String(error);
              }
              return {
                chatRows: document.querySelectorAll('#chatHistoryBox .msg-row').length,
                chatCapOk: chatCapError === '' && document.querySelectorAll('#chatHistoryBox .msg-row').length <= 100,
                chatCapError,
                resizeScheduler: typeof window.scheduleBoardResize === 'function',
                apiFailover: typeof window.safeApiFetch === 'function'
              };
            }
            """
        )
        chat_export = page.evaluate(
            """
            async () => {
              const previousBridge = window.AndroidNativeApp;
              let captured = null;
              window.AndroidNativeApp = {
                exportChatText(content, fileName) {
                  captured = { content, fileName };
                  return true;
                }
              };
              chatHistory = [{ sender: 1, name: '测试用户', text: '手机导出回归', time: '12:34' }];
              const result = await window.exportChatTxt();
              if (previousBridge === undefined) delete window.AndroidNativeApp;
              else window.AndroidNativeApp = previousBridge;
              return {
                returned: result === true,
                bridgeCalled: Boolean(captured),
                hasUtf8Text: Boolean(captured && captured.content.includes('手机导出回归')),
                safeTxtName: Boolean(captured && /\\.txt$/i.test(captured.fileName))
              };
            }
            """
        )
        chat_export_ok = all(chat_export.values())
        back_handler = page.evaluate(
            """
            () => {
              const modal = document.querySelector('#appUpdateModal');
              if (!modal || typeof window.handleAndroidBack !== 'function') {
                return { available: false, handled: false, closed: false };
              }
              modal.classList.add('show');
              modal.style.display = 'flex';
              const handled = window.handleAndroidBack();
              const closed = !modal.classList.contains('show') && modal.style.display === 'none';
              return { available: true, handled, closed };
            }
            """
        )
        end_reset = page.evaluate(
            """
            () => {
              window.setMode('pvp', true);
              for (let c = 0; c < 5; c++) window.makeMove(0, c, 1);
              return {
                p1Status: document.querySelector('#p1Status')?.textContent || '',
                p2Status: document.querySelector('#p2Status')?.textContent || '',
                turnBubble: document.querySelector('#turnBubble')?.textContent || ''
              };
            }
            """
        )
        page.evaluate("window.resetBoardOnly()")
        page.wait_for_timeout(450)
        reset_state = page.evaluate(
            """
            () => ({
              p1Status: document.querySelector('#p1Status')?.textContent || '',
              p2Status: document.querySelector('#p2Status')?.textContent || '',
              turnBubble: document.querySelector('#turnBubble')?.textContent || '',
              resultModal: getComputedStyle(document.querySelector('#gameResultModal')).display
            })
            """
        )
        end_reset_ok = (
            end_reset['p1Status'] == '已结束' and
            end_reset['p2Status'] == '已结束' and
            end_reset['turnBubble'] == '对局结束' and
            reset_state['p1Status'] == '落子中' and
            reset_state['p2Status'] == '等待' and
            reset_state['turnBubble'] == '黑方回合' and
            reset_state['resultModal'] == 'none'
        )
        undo_cards = page.evaluate(
            """
            () => {
              window.setMode('pvp', true);
              currentDrawnCards = [
                SKILL_CARD_POOL.find(card => card.id === 'double_move'),
                SKILL_CARD_POOL.find(card => card.id === 'prophecy_block'),
                SKILL_CARD_POOL.find(card => card.id === 'mega_bomb')
              ];
              cardUsedStatus = [false, false, false];
              renderCardSlots();
              window.handleCardClick(0);
              const usedBeforeUndo = cardUsedStatus[0] === true;
              const applied = window.doUndo();
              return {
                usedBeforeUndo,
                undoApplied: applied === true,
                cardRestored: cardUsedStatus[0] === false,
                boardEmpty: board.every(row => row.every(cell => cell === EMPTY))
              };
            }
            """
        )
        undo_cards_ok = all(undo_cards.values())
        online_undo = page.evaluate(
            """
            () => {
              const listeners = {};
              const sent = [];
              const fakeConn = {
                open: true,
                ready: true,
                on(type, handler) { (listeners[type] ||= []).push(handler); },
                send(message) { sent.push({ ...message }); return true; },
                emit(type, value) { (listeners[type] || []).forEach(handler => handler(value)); },
                close() {}
              };
              gameMode = 'online';
              myOnlineColor = BLACK;
              onlineRoundId = 'round_smoke';
              currentRoomCode = '123456';
              board = Array.from({ length: 15 }, () => Array(15).fill(EMPTY));
              history = [];
              turn = BLACK;
              isOver = false;
              currentDrawnCards = [
                SKILL_CARD_POOL.find(card => card.id === 'double_move'),
                SKILL_CARD_POOL.find(card => card.id === 'prophecy_block'),
                SKILL_CARD_POOL.find(card => card.id === 'mega_bomb')
              ];
              cardUsedStatus = [false, false, false];
              renderCardSlots();
              conn = fakeConn;
              setupConn();
              window.handleCardClick(0);
              const usedBeforeResponse = cardUsedStatus[0] === true;
              pendingOnlineUndoId = 'undo_smoke';
              fakeConn.emit('data', {
                type: 'undo_res',
                agree: true,
                requestId: 'undo_smoke',
                board: board.map(row => [...row]),
                history: [],
                turn: BLACK,
                roundId: 'round_smoke'
              });
              if (onlineHeartbeatTimer) clearInterval(onlineHeartbeatTimer);
              onlineHeartbeatTimer = null;
              return {
                usedBeforeResponse,
                restoredAfterResponse: cardUsedStatus[0] === false,
                responseSent: sent.some(message => message.type === 'skill_use')
              };
            }
            """
        )
        online_undo_ok = all(online_undo.values())
        network_status = page.evaluate(
            """
            () => {
              const listeners = {};
              const sent = [];
              const fakeConn = {
                open: true,
                ready: true,
                isP2pReady: false,
                client: { connected: true },
                on(type, handler) { (listeners[type] ||= []).push(handler); },
                send(message) { sent.push({ ...message }); return true; },
                emit(type, value) { (listeners[type] || []).forEach(handler => handler(value)); },
                close() {}
              };
              gameMode = 'online';
              onlineRoundId = 'round_network';
              currentRoomCode = '654321';
              history = [];
              isOver = false;
              conn = fakeConn;
              setupConn();
              fakeConn.emit('data', {
                type: 'ping',
                pingId: 'peer_ping',
                sentAt: Date.now() - 40,
                networkState: 'MQTT中继',
                roundId: 'round_network'
              });
              const pong = sent.find(message => message.type === 'pong');
              pendingOnlinePings.set('local_ping', Date.now() - 28);
              fakeConn.emit('data', {
                type: 'pong',
                pingId: 'local_ping',
                peerState: 'P2P直连',
                peerLatencyMs: 33,
                step: 0,
                roundId: 'round_network'
              });
              updateOnlineNetworkUI();
              if (onlineHeartbeatTimer) clearInterval(onlineHeartbeatTimer);
              onlineHeartbeatTimer = null;
              return {
                pongEchoesPing: Boolean(pong && pong.pingId === 'peer_ping'),
                pongReportsState: pong && pong.peerState === 'MQTT中继',
                pongReportsLatency: pong && Object.prototype.hasOwnProperty.call(pong, 'peerLatencyMs'),
                localLabel: document.querySelector('#myNetworkStatusLabel')?.textContent || '',
                peerLabel: document.querySelector('#peerNetworkStatusLabel')?.textContent || '',
                localLatencyMs: onlineNetworkTelemetry.localLatencyMs,
                localLatencyOk: Number.isFinite(onlineNetworkTelemetry.localLatencyMs) && onlineNetworkTelemetry.localLatencyMs >= 20 && onlineNetworkTelemetry.localLatencyMs <= 100,
                peerLatencyOk: (document.querySelector('#peerNetworkStatusLabel')?.textContent || '').includes('33ms'),
                peerTransportOk: (document.querySelector('#peerNetworkStatusLabel')?.textContent || '').includes('P2P直连')
              };
            }
            """
        )
        network_status_ok = all([
            network_status['pongEchoesPing'],
            network_status['pongReportsState'],
            network_status['pongReportsLatency'],
            network_status['localLatencyOk'],
            network_status['peerLatencyOk'],
            network_status['peerTransportOk']
        ])
        screenshot = Path(tempfile.gettempdir()) / "gomoku-optimization-smoke.png"
        page.screenshot(path=str(screenshot), full_page=False)
        print(json.dumps({
            "critical": critical,
            "behavior": behavior,
            "chatExport": {**chat_export, "ok": chat_export_ok},
            "backHandler": {**back_handler, "ok": all(back_handler.values())},
            "endReset": {"ended": end_reset, "reset": reset_state, "ok": end_reset_ok},
            "undoCards": {**undo_cards, "ok": undo_cards_ok},
            "onlineUndo": {**online_undo, "ok": online_undo_ok},
            "networkStatus": {**network_status, "ok": network_status_ok},
            "consoleErrors": errors,
            "pageErrors": page_errors,
            "screenshot": str(screenshot),
        }, ensure_ascii=False))
        browser.close()


if __name__ == "__main__":
    main()
