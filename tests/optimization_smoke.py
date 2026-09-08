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
            async () => {
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
        page.evaluate("() => window.ensureGomokuFeature('online')")
        page.wait_for_function(
            "() => window.__GOMOKU_ONLINE_READY__ === true", timeout=30_000
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
        remote_skill_result = page.evaluate(
            """
            async () => {
              const listeners = {};
              const fakeConn = {
                open: true,
                ready: true,
                on(type, handler) { (listeners[type] ||= []).push(handler); },
                send() { return true; },
                emit(type, value) { (listeners[type] || []).forEach(handler => handler(value)); },
                close() {}
              };
              gameMode = 'online';
              myOnlineColor = WHITE;
              onlineRoundId = 'round_skill_result';
              currentRoomCode = '777777';
              p2Name = '对手';
              board = Array.from({ length: 15 }, () => Array(15).fill(EMPTY));
              for (let c = 3; c <= 6; c++) board[7][c] = BLACK;
              board[7][7] = WHITE;
              history = [];
              turn = BLACK;
              isOver = false;
              gameWinnerColor = 0;
              gameResultIsDraw = false;
              winningLine = null;
              opponentSkillsUsedCount = 0;
              opponentReforgeUsed = false;
              conn = fakeConn;
              setupConn();
              fakeConn.emit('data', {
                type: 'skill_swap_color',
                r: 7,
                c: 7,
                p: BLACK,
                roundId: 'round_skill_result'
              });
              await new Promise(resolve => setTimeout(resolve, 420));
              if (onlineHeartbeatTimer) clearInterval(onlineHeartbeatTimer);
              onlineHeartbeatTimer = null;
              return {
                boardConverted: board[7][7] === BLACK,
                gameOver: isOver === true,
                winner: gameWinnerColor === BLACK,
                resultVisible: document.querySelector('#gameResultModal')?.classList.contains('show') === true
              };
            }
            """
        )
        remote_skill_result_ok = all(remote_skill_result.values())
        network_status = page.evaluate(
            """
            async () => {
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
              p2Name = '旧昵称';
              p2Avatar = '👧';
              conn = fakeConn;
              setupConn();
              await new Promise(resolve => setTimeout(resolve, 20));
              const immediatePingSent = sent.some(message => message.type === 'ping');
              fakeConn.emit('data', {
                type: 'profile_sync',
                name: '新昵称',
                avatar: '👦',
                roundId: 'round_network'
              });
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
              const p2pPayloads = [];
              const mqttPayloads = [];
              const heartbeatP2pPayloads = [];
              const heartbeatMqttPayloads = [];
              const heartbeatProbe = {
                open: true,
                closed: false,
                roomCode: '654321',
                isP2pReady: true,
                dc: { readyState: 'open', send(payload) { heartbeatP2pPayloads.push(payload); } },
                client: {
                  connected: true,
                  publish(topic, payload) { heartbeatMqttPayloads.push({ topic, payload }); }
                },
                pubTopic: 'probe/heartbeat',
                pendingMqttFailoverTimers: new Map(),
                _publishMqttPayload: MqttRoomConnection.prototype._publishMqttPayload,
                _transmitMessage: MqttRoomConnection.prototype._transmitMessage
              };
              const heartbeatSent = MqttRoomConnection.prototype.send.call(heartbeatProbe, {
                type: 'ping', pingId: 'p2p_only_ping'
              });
              const transportProbe = {
                open: true,
                closed: false,
                isP2pReady: true,
                dc: { readyState: 'open', send(payload) { p2pPayloads.push(payload); } },
                client: {
                  connected: true,
                  publish(topic, payload) { mqttPayloads.push({ topic, payload }); }
                },
                pubTopic: 'probe/profile',
                pendingMqttFailoverTimers: new Map(),
                _publishMqttPayload: MqttRoomConnection.prototype._publishMqttPayload,
                _clearMqttFailover: MqttRoomConnection.prototype._clearMqttFailover,
                _transmitMessage: MqttRoomConnection.prototype._transmitMessage,
                _scheduleReliableRetry() {}
              };
              const mirrored = MqttRoomConnection.prototype.send.call(transportProbe, {
                type: 'profile_sync', name: '新昵称', avatar: '👦'
              });
              const p2pMessage = p2pPayloads.length ? JSON.parse(p2pPayloads[0]) : null;
              const mqttMessage = mqttPayloads.length ? JSON.parse(mqttPayloads[0].payload) : null;
              const reliableP2pPayloads = [];
              const reliableMqttPayloads = [];
              const reliableProbe = {
                open: true,
                closed: false,
                roomCode: '654321',
                reliableRetryTimer: null,
                pendingMqttFailoverTimers: new Map(),
                isP2pReady: true,
                dc: { readyState: 'open', send(payload) { reliableP2pPayloads.push(payload); } },
                client: {
                  connected: true,
                  publish(topic, payload) { reliableMqttPayloads.push({ topic, payload }); }
                },
                pubTopic: 'probe/reliable',
                _publishMqttPayload: MqttRoomConnection.prototype._publishMqttPayload,
                _clearMqttFailover: MqttRoomConnection.prototype._clearMqttFailover,
                _scheduleMqttFailover: MqttRoomConnection.prototype._scheduleMqttFailover,
                emit() {},
                _transmitMessage: MqttRoomConnection.prototype._transmitMessage,
                _scheduleReliableRetry: MqttRoomConnection.prototype._scheduleReliableRetry
              };
              const reliableSent = MqttRoomConnection.prototype.send.call(reliableProbe, {
                type: 'chat', text: '可靠 ACK 测试'
              });
              await new Promise(resolve => setTimeout(resolve, 1300));
              const reliableMessage = reliableP2pPayloads.length ? JSON.parse(reliableP2pPayloads[0]) : null;
              const reliableRetryOk = reliableP2pPayloads.length >= 2 && reliableMqttPayloads.length >= 2;
              if (reliableMessage && reliableMessage._mid) {
                MqttRoomConnection.prototype._acknowledgeReliableMessage.call(reliableProbe, reliableMessage._mid);
              }
              const reliableAckCleared = reliableMessage && !onlineReliableOutbox.has(reliableMessage._mid);
              const statsProbe = Object.create(MqttRoomConnection.prototype);
              statsProbe.closed = false;
              statsProbe.p2pGeneration = 1;
              statsProbe.p2pStatsInFlight = false;
              statsProbe.pc = {
                async getStats() {
                  return new Map([
                    ['transport', { type: 'transport', selectedCandidatePairId: 'pair' }],
                    ['pair', { type: 'candidate-pair', state: 'succeeded', nominated: true,
                      currentRoundTripTime: 0.12, localCandidateId: 'local', remoteCandidateId: 'remote' }],
                    ['local', { type: 'local-candidate', candidateType: 'relay' }],
                    ['remote', { type: 'remote-candidate', candidateType: 'srflx' }]
                  ]);
                }
              };
              await statsProbe._refreshP2PStats(1);
              const reoptProbe = Object.create(MqttRoomConnection.prototype);
              reoptProbe.isP2pReady = true;
              reoptProbe.p2pRoute = 'relay';
              reoptProbe.p2pHighRttStreak = 0;
              reoptProbe.p2pReoptimizationCount = 0;
              reoptProbe.p2pLastReoptimizationAt = 0;
              reoptProbe.p2pRecoveryTimer = null;
              reoptProbe._scheduleP2PRecovery = function(reason) {
                this.reoptReason = reason;
                this.p2pRecoveryTimer = true;
              };
              reoptProbe._maybeReoptimizeP2P(300);
              reoptProbe._maybeReoptimizeP2P(301);
              reoptProbe._maybeReoptimizeP2P(302);
              updateOnlineNetworkUI();
              if (onlineHeartbeatTimer) clearInterval(onlineHeartbeatTimer);
              onlineHeartbeatTimer = null;
              return {
                immediatePingSent,
                pongEchoesPing: Boolean(pong && pong.pingId === 'peer_ping'),
                pongReportsState: pong && pong.peerState === 'MQTT中继',
                pongReportsLatency: pong && Object.prototype.hasOwnProperty.call(pong, 'peerLatencyMs'),
                heartbeatP2pOnly: heartbeatSent && heartbeatP2pPayloads.length === 1 && heartbeatMqttPayloads.length === 0,
                profileMirrorOk: mirrored && p2pMessage && mqttMessage && p2pMessage._mid === mqttMessage._mid,
                reliableMirrorOk: reliableSent && reliableP2pPayloads.length >= 1 && reliableMqttPayloads.length >= 1,
                reliableRetryOk,
                reliableAckCleared,
                relayRouteDetected: statsProbe.p2pRoute === 'relay' && statsProbe.p2pStatsRttMs === 120,
                highRttReoptimizeOk: reoptProbe.p2pReoptimizationCount === 1 &&
                  reoptProbe.reoptReason === 'P2P 高延迟，自动重选线路',
                localLabel: document.querySelector('#myNetworkStatusLabel')?.textContent || '',
                peerLabel: document.querySelector('#peerNetworkStatusLabel')?.textContent || '',
                statusBarVisible: getComputedStyle(document.querySelector('#onlineNetworkStatusBar')).display !== 'none',
                roomBarVisible: getComputedStyle(document.querySelector('#onlineRoomTopBar')).display !== 'none',
                peerName: p2Name,
                peerNameLabel: document.querySelector('#p2NameLabel')?.textContent || '',
                localLatencyMs: onlineNetworkTelemetry.localLatencyMs,
                localLatencyOk: Number.isFinite(onlineNetworkTelemetry.localLatencyMs) && onlineNetworkTelemetry.localLatencyMs >= 20 && onlineNetworkTelemetry.localLatencyMs <= 100,
                peerLatencyOk: (document.querySelector('#peerNetworkStatusLabel')?.textContent || '').includes('33ms'),
                peerTransportOk: (document.querySelector('#peerNetworkStatusLabel')?.textContent || '').includes('P2P直连')
              };
            }
            """
        )
        network_status_ok = all([
            network_status['immediatePingSent'],
            network_status['pongEchoesPing'],
            network_status['pongReportsState'],
            network_status['pongReportsLatency'],
            network_status['heartbeatP2pOnly'],
            network_status['profileMirrorOk'],
            network_status['reliableMirrorOk'],
            network_status['reliableRetryOk'],
            network_status['reliableAckCleared'],
            network_status['relayRouteDetected'],
            network_status['highRttReoptimizeOk'],
            network_status['localLatencyOk'],
            network_status['peerLatencyOk'],
            network_status['peerTransportOk'],
            network_status['statusBarVisible'],
            network_status['roomBarVisible'],
            network_status['peerName'] == '新昵称',
            '新昵称' in network_status['peerNameLabel']
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
            "remoteSkillResult": {**remote_skill_result, "ok": remote_skill_result_ok},
            "networkStatus": {**network_status, "ok": network_status_ok},
            "consoleErrors": errors,
            "pageErrors": page_errors,
            "screenshot": str(screenshot),
        }, ensure_ascii=False))
        browser.close()


if __name__ == "__main__":
    main()
