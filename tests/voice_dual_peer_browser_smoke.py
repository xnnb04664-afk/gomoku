"""Real Chromium WebRTC voice smoke using only Chromium's fake audio source.

Room tickets and signaling relay use the existing local fixture; media capture,
RTCPeerConnection negotiation, RTP, and audio tracks remain Chromium-native.
No physical microphone or public service is used.
"""

from __future__ import annotations

import hashlib
import json
import os
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

from online_relay_test_support import install_local_relay_mocks


ROOT = Path(__file__).resolve().parents[1]
DIAGNOSTICS = ROOT / ".codex-diagnostics" / "audit-performance-20261108"
BASE_URL = os.environ.get("GOMOKU_TEST_URL", "http://127.0.0.1:4194/index.html")
APP_SOURCE = ROOT / "js" / "app.js"
VOICE_SOURCE = ROOT / "js" / "voice.js"
TRACK_RTC_JS = r"""
(() => {
  const Original = window.RTCPeerConnection;
  if (typeof Original !== 'function') return;
  window.__gomokuVoiceTestPcs = window.__gomokuVoiceTestPcs || [];
  function TrackedPeerConnection(...args) {
    const pc = new Original(...args);
    pc.__gomokuVoiceTestId = `pc-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    window.__gomokuVoiceTestPcs.push(pc);
    return pc;
  }
  TrackedPeerConnection.prototype = Original.prototype;
  Object.setPrototypeOf(TrackedPeerConnection, Original);
  window.RTCPeerConnection = TrackedPeerConnection;
  if (window.webkitRTCPeerConnection) window.webkitRTCPeerConnection = TrackedPeerConnection;
})();
"""

SNAPSHOT_JS = r"""async () => {
  const pcs = window.__gomokuVoiceTestPcs || [];
  const pc = [...pcs].reverse().find(candidate => {
    try {
      return candidate.getSenders().some(item => item.track?.kind === 'audio') ||
        candidate.getReceivers().some(item => item.track?.kind === 'audio');
    } catch (_) { return false; }
  }) || null;
  const audio = document.getElementById('gomokuVoiceRemoteAudio');
  let inbound = [];
  if (pc) {
    try {
      const stats = await pc.getStats();
      inbound = [...stats.values()]
        .filter(stat => stat.type === 'inbound-rtp' && (stat.kind === 'audio' || stat.mediaType === 'audio'))
        .map(stat => ({ packetsReceived: Number(stat.packetsReceived || 0), bytesReceived: Number(stat.bytesReceived || 0) }));
    } catch (error) { inbound = [{ error: String(error) }]; }
  }
  const trackShape = track => ({ id: track.id, kind: track.kind, readyState: track.readyState,
    enabled: track.enabled, muted: track.muted });
  return {
    mode: typeof gameMode === 'undefined' ? null : gameMode,
    room: typeof currentRoomCode === 'undefined' ? null : currentRoomCode,
    connection: typeof conn === 'undefined' || !conn ? null : { open: !!conn.open, ready: !!conn.ready, closed: !!conn.closed },
    enabled: !!window.GomokuVoice?.isEnabled?.(),
    status: document.getElementById('gomokuVoiceStatus')?.textContent?.trim() || '',
    pcCount: pcs.length,
    pc: pc ? {
      id: pc.__gomokuVoiceTestId || '',
      signalingState: pc.signalingState,
      connectionState: pc.connectionState,
      iceConnectionState: pc.iceConnectionState,
      localDescriptionType: pc.localDescription?.type || null,
      remoteDescriptionType: pc.remoteDescription?.type || null,
      senders: pc.getSenders().filter(item => item.track).map(item => trackShape(item.track)),
      receivers: pc.getReceivers().filter(item => item.track).map(item => trackShape(item.track)),
      inbound
    } : null,
    remoteAudio: audio ? {
      hasStream: !!audio.srcObject,
      paused: audio.paused,
      tracks: audio.srcObject?.getTracks?.().map(trackShape) || []
    } : null
  };
}"""


def source_digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def log_browser(page, role: str, result: dict) -> None:
    result.setdefault("browser", {}).setdefault(role, {"pageErrors": [], "console": []})
    bucket = result["browser"][role]
    page.on("pageerror", lambda error: bucket["pageErrors"].append(str(error)))
    page.on("console", lambda message: bucket["console"].append({
        "type": message.type, "text": message.text
    }) if message.type in ("warning", "error") else None)


def install_sources(page, role: str, served: dict) -> None:
    install_local_relay_mocks(page, role)
    page.add_init_script(TRACK_RTC_JS)

    def serve(path: Path, key: str):
        body = path.read_bytes()
        served[key] = {"path": str(path), "sha256": hashlib.sha256(body).hexdigest()}

        def handler(route):
            route.fulfill(status=200, content_type="application/javascript; charset=utf-8",
                          headers={"cache-control": "no-store"}, body=body)
        return handler

    # Exercise the current readable source files, and retain exact hashes in
    # the result so a later source edit cannot be confused with this run.
    page.route("**/js/app.min.js", serve(APP_SOURCE, "app"))
    page.route("**/js/voice.js", serve(VOICE_SOURCE, "voice"))


def load_game(page, role: str, served: dict, result: dict, diagnostic_role: str | None = None) -> None:
    install_sources(page, role, served)
    log_browser(page, diagnostic_role or role, result)
    page.goto(BASE_URL, wait_until="domcontentloaded", timeout=30_000)
    page.wait_for_selector("#skyLobby", state="visible", timeout=20_000)
    page.wait_for_function("() => typeof window.SkyIslandUI?.showGame === 'function'", timeout=10_000)
    page.evaluate("() => window.SkyIslandUI.showGame()")
    page.locator("#cvs").wait_for(state="visible", timeout=10_000)
    page.evaluate("() => window.ensureGomokuFeature('online')")
    page.wait_for_function("() => window.__GOMOKU_ONLINE_READY__ === true", timeout=30_000)
    page.evaluate("() => window.ensureGomokuFeature('voice')")
    page.wait_for_function("() => window.__GOMOKU_VOICE_READY__ === true", timeout=10_000)


def snapshot(page) -> dict:
    return page.evaluate(SNAPSHOT_JS)


def wait_pair(host, guest, predicate, phase: str, timeout_s: float = 30.0) -> dict:
    deadline = time.monotonic() + timeout_s
    states = {}
    while time.monotonic() < deadline:
        states = {"host": snapshot(host), "guest": snapshot(guest)}
        if predicate(states):
            return states
        host.wait_for_timeout(250)
    raise AssertionError(json.dumps({"phase": phase, "states": states}, ensure_ascii=False))


def enable(page, role: str) -> dict:
    enabled = page.evaluate("() => window.GomokuVoice.toggle()")
    if enabled is not True:
        raise AssertionError(json.dumps({"phase": f"{role}_enable_voice", "state": snapshot(page)}, ensure_ascii=False))
    return snapshot(page)


def wait_media_pair(host, guest, phase: str) -> dict:
    states = wait_pair(
        host, guest,
        lambda pair: all(
            state["enabled"] and state["pc"] and state["pc"]["connectionState"] == "connected" and
            state["remoteAudio"]["hasStream"] and
            any(track["kind"] == "audio" and track["readyState"] == "live"
                for track in state["remoteAudio"]["tracks"]) and
            sum(item.get("packetsReceived", 0) for item in state["pc"]["inbound"]) > 0
            for state in pair.values()
        ), phase, timeout_s=35.0)
    # Prove the native inbound RTP counter continues to move on both peers.
    host.wait_for_timeout(1_000)
    after = {"host": snapshot(host), "guest": snapshot(guest)}
    for role in ("host", "guest"):
        before_packets = sum(item.get("packetsReceived", 0) for item in states[role]["pc"]["inbound"])
        after_packets = sum(item.get("packetsReceived", 0) for item in after[role]["pc"]["inbound"])
        if after_packets <= before_packets:
            raise AssertionError(json.dumps({"phase": f"{phase}_{role}_inbound_rtp_growth",
                                             "before": states[role], "after": after[role]}, ensure_ascii=False))
    return {"connected": states, "afterRtpInterval": after}


def connect_room(host, guest, room: str) -> None:
    host.evaluate("code => window.initHostPeer(code, true)", room)
    guest.evaluate("code => window.joinOnlineRoom(code)", room)
    host.wait_for_function("() => conn?.open && conn?.ready", timeout=30_000)
    guest.wait_for_function("() => conn?.open && conn?.ready", timeout=30_000)


def main() -> None:
    import sys

    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    DIAGNOSTICS.mkdir(parents=True, exist_ok=True)
    result = {
        "pass": False,
        "url": BASE_URL,
        "roomTransport": "existing local API/WebSocket relay fixture",
        "mediaTransport": "native Chromium RTCPeerConnection with fake audio capture; no physical microphone",
        "sourceHashes": {},
        "phases": [],
    }
    host = guest = None
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True, args=[
                "--use-fake-device-for-media-stream",
                "--use-fake-ui-for-media-stream",
                "--autoplay-policy=no-user-gesture-required",
            ])
            context = browser.new_context(viewport={"width": 1280, "height": 900}, device_scale_factor=1)
            context.grant_permissions(["microphone"], origin=BASE_URL.split("/index.html", 1)[0])
            host, guest = context.new_page(), context.new_page()
            load_game(host, "host", result["sourceHashes"], result)
            load_game(guest, "guest", result["sourceHashes"], result)

            room = str(int(time.time() * 1000) % 900_000 + 100_000)
            connect_room(host, guest, room)
            result["room"] = room
            result["roomReady"] = {"host": snapshot(host), "guest": snapshot(guest)}

            # Host-first reproduces the early-offer case: the host creates an
            # offer before the guest has granted/opened its fake microphone.
            result["phases"].append("host_first_guest_late")
            enable(host, "host")
            host.wait_for_timeout(500)
            enable(guest, "guest")
            first_pair = wait_media_pair(host, guest, "host_first_guest_late")
            result["hostFirstMedia"] = first_pair

            # Close/reopen one side. The remote microphone stream should be
            # retired, then a fresh RTCPeerConnection should carry RTP again.
            host_before_restart = snapshot(host)
            host.evaluate("() => window.GomokuVoice.toggle()")
            stopped = wait_pair(host, guest,
                lambda pair: not pair["host"]["enabled"] and
                    pair["host"]["pc"] and pair["host"]["pc"]["connectionState"] == "closed" and
                    all(track["readyState"] == "ended" for track in pair["host"]["pc"]["senders"]) and
                    not pair["host"]["remoteAudio"]["hasStream"] and
                    not pair["guest"]["remoteAudio"]["hasStream"],
                "host_toggle_off_cleanup", timeout_s=10.0)
            result["hostToggleOff"] = {"before": host_before_restart, "after": stopped}
            enable(host, "host_restart")
            restarted = wait_media_pair(host, guest, "host_restart")
            if restarted["connected"]["host"]["pc"]["id"] == host_before_restart["pc"]["id"]:
                raise AssertionError("host restart reused the retired voice RTCPeerConnection")
            result["hostRestartMedia"] = restarted

            # Ordinary in-game room exit must synchronously close voice before
            # the app clears its room connection and changes game mode.
            before_leave = snapshot(host)
            host.evaluate("() => window.leaveOnlineRoom(true)")
            host.wait_for_function("() => gameMode !== 'online' && !conn", timeout=10_000)
            after_leave = snapshot(host)
            if after_leave["enabled"] or after_leave["remoteAudio"]["hasStream"] or not after_leave["pc"] or \
                    after_leave["pc"]["connectionState"] != "closed" or not after_leave["pc"]["senders"] or \
                    not all(track["readyState"] == "ended" for track in after_leave["pc"]["senders"]):
                raise AssertionError(json.dumps({"phase": "normal_room_exit_voice_cleanup",
                                                 "before": before_leave, "after": after_leave}, ensure_ascii=False))
            result["normalRoomExit"] = {"before": before_leave, "after": after_leave}

            # Reverse the opening order in a fresh local room: the guest may
            # create an offerless voice peer before the host assigns a session.
            host.close()
            guest.close()
            reverse_host, reverse_guest = context.new_page(), context.new_page()
            host, guest = reverse_host, reverse_guest
            load_game(host, "host", result["sourceHashes"], result, "host_reverse")
            load_game(guest, "guest", result["sourceHashes"], result, "guest_reverse")
            reverse_room = str(int(time.time() * 1000) % 900_000 + 100_000)
            connect_room(host, guest, reverse_room)
            result["reverseRoom"] = reverse_room
            result["phases"].append("guest_first_host_late")
            enable(guest, "guest_reverse")
            guest.wait_for_timeout(500)
            enable(host, "host_reverse")
            result["guestFirstMedia"] = wait_media_pair(host, guest, "guest_first_host_late")

            # Retain warnings/errors as diagnostic evidence. JS exceptions and
            # browser console errors fail the run; warnings remain recorded.
            browser_errors = {
                role: {
                    "pageErrors": result["browser"][role]["pageErrors"],
                    "consoleErrors": [entry for entry in result["browser"][role]["console"]
                                      if entry["type"] == "error"],
                }
                for role in ("host", "guest")
            }
            if any(value["pageErrors"] or value["consoleErrors"] for value in browser_errors.values()):
                raise AssertionError(json.dumps({"phase": "browser_errors", "errors": browser_errors}, ensure_ascii=False))
            result["pass"] = True
    except Exception as error:
        result["failure"] = str(error)
        if host and guest:
            try:
                result["failureStates"] = {"host": snapshot(host), "guest": snapshot(guest)}
            except Exception as snapshot_error:
                result["failureSnapshotError"] = str(snapshot_error)
    finally:
        # sync_playwright owns the browser lifecycle and closes it on context
        # exit. Do not call Browser.close() after its event loop has stopped.
        (DIAGNOSTICS / "voice-dual-peer-browser-smoke.json").write_text(
            json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")

    print(json.dumps(result, ensure_ascii=False, indent=2))
    if not result["pass"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
