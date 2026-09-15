import os
import sys

from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeoutError


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    url = os.environ.get("GOMOKU_TEST_URL", "http://127.0.0.1:3000/index.html")
    errors = []
    console_errors = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 390, "height": 844}, device_scale_factor=1)
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.on("console", lambda message: console_errors.append(message.text) if message.type == "error" else None)
        page.goto(url, wait_until="domcontentloaded", timeout=30_000)
        page.wait_for_selector("#skyLobby", state="visible", timeout=15_000)
        page.wait_for_function("() => typeof window.SkyIslandUI?.showGame === 'function'", timeout=10_000)
        page.evaluate("() => window.SkyIslandUI.showGame()")
        page.locator("#cvs").wait_for(state="visible", timeout=10_000)
        page.evaluate("() => window.ensureGomokuFeature('voice')")
        page.wait_for_function("() => window.__GOMOKU_VOICE_READY__ === true", timeout=10_000)
        assert page.evaluate("() => window.GomokuVoice.isEnabled()") is False
        assert page.locator("#gomokuVoicePanel").count() == 1
        assert page.locator("#gomokuVoicePanel").evaluate("el => getComputedStyle(el).display") == "none"
        # 未进入房间时不得请求麦克风，也不得抛异常。
        assert page.evaluate("() => window.GomokuVoice.toggle()") is False
        assert "请先进入联机房间" in page.locator("#gomokuVoiceStatus").inner_text()

        # 不访问真实麦克风或公网：用最小 WebRTC 假实现验证房间语音的
        # hello → offer → answer/早到 ICE 信令和关闭时音轨清理。
        page.evaluate("""() => {
            gameMode = 'online';
            myOnlineColor = 1;
            window.__voiceMockConnection = {
                open: true,
                closed: false,
                sent: [],
                send(message) { this.sent.push(message); return true; }
            };
            window.__gomokuGetOnlineConnection = () => window.__voiceMockConnection;
            const track = {
                enabled: true,
                stopped: false,
                stop() { this.stopped = true; },
            };
            window.__voiceMockTrack = track;
            Object.defineProperty(navigator, 'mediaDevices', {
                configurable: true,
                value: { getUserMedia: async () => ({
                    getTracks: () => [track],
                    getAudioTracks: () => [track],
                }) }
            });
            window.__voiceMockRtc = null;
            window.RTCPeerConnection = class {
                constructor() {
                    this.signalingState = 'stable';
                    this.connectionState = 'new';
                    this.iceConnectionState = 'new';
                    this.localDescription = null;
                    this.candidates = [];
                    window.__voiceMockRtc = this;
                }
                addTrack() {}
                async createOffer() { return { type: 'offer', sdp: 'fake-offer' }; }
                async createAnswer() { return { type: 'answer', sdp: 'fake-answer' }; }
                async setLocalDescription(description) { this.localDescription = description; }
                async setRemoteDescription(description) { this.remoteDescription = description; }
                async addIceCandidate(candidate) { this.candidates.push(candidate); }
                close() { this.connectionState = 'closed'; }
            };
        }""")
        handshake = page.evaluate("""async () => {
            const enabled = await window.GomokuVoice.toggle();
            const sent = window.__voiceMockConnection.sent;
            const hello = sent.find(item => item.type === 'voice_hello');
            const offer = sent.find(item => item.type === 'voice_offer');
            if (!enabled || !hello || !offer) return { enabled, hello: !!hello, offer: !!offer };
            await window.GomokuVoice.handleSignal({
                type: 'voice_ice', voiceSessionId: hello.voiceSessionId,
                candidate: { candidate: 'early-candidate' }
            });
            const beforeAnswer = window.__voiceMockRtc.candidates.length;
            await window.GomokuVoice.handleSignal({
                type: 'voice_answer', voiceSessionId: hello.voiceSessionId, sdp: 'remote-answer'
            });
            const afterAnswer = window.__voiceMockRtc.candidates.length;
            window.GomokuVoice.stop();
            return {
                enabled,
                hello: true,
                offer: true,
                earlyIceBuffered: beforeAnswer === 0,
                earlyIceFlushed: afterAnswer === 1,
                trackStopped: window.__voiceMockTrack.stopped,
                bye: sent.some(item => item.type === 'voice_bye')
            };
        }""")
        assert handshake == {
            "enabled": True,
            "hello": True,
            "offer": True,
            "earlyIceBuffered": True,
            "earlyIceFlushed": True,
            "trackStopped": True,
            "bye": True,
        }, handshake
        assert not errors, errors
        assert not console_errors, console_errors
        print('{"pass":true,"voiceLazyLoaded":true,"defaultOff":true,"permissionDeferred":true,"signalingHandshake":true,"earlyIceBuffer":true,"cleanup":true,"pageErrors":[]}')
        browser.close()


if __name__ == "__main__":
    try:
        main()
    except PlaywrightTimeoutError as error:
        raise AssertionError(str(error))
