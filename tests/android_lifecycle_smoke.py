"""Static guardrails for the Android network/lifecycle bridge.

The project intentionally uses a dependency-free javac/aapt2 build instead of
an Android test runner.  Keep this check source-only so it can run on CI
without an emulator or network access.
"""

from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
ACTIVITY = ROOT / "android_src/src/com/gomoku/master/MainActivity.java"


def main():
    source = ACTIVITY.read_text(encoding="utf-8")

    # Android N+ must observe only the system default network.  Older devices
    # retain the request-based compatibility path.
    assert "registerDefaultNetworkCallback(mNetworkCallback)" in source
    assert "registerNetworkCallback(request, mNetworkCallback)" in source
    assert "mUsingDefaultNetworkCallback" in source
    assert "isRelevantNetwork(Network network)" in source

    # ConnectivityService may emit several callbacks for one Wi-Fi/mobile
    # transition; only one debounced evaluateJavascript should reach the page.
    assert "NETWORK_EVENT_DEBOUNCE_MS = 250L" in source
    assert "postDelayed(mDispatchNetworkChange, NETWORK_EVENT_DEBOUNCE_MS)" in source
    assert "dispatchPendingNetworkChange()" in source
    assert "mPendingNetworkReason" in source
    assert source.count("evaluateJavascript(") >= 1

    # Callbacks and delayed WebView work must be lifecycle guarded and cleaned
    # up when the activity leaves the foreground or is destroyed.
    assert "mActivityResumed = true" in source
    assert "mActivityResumed = false" in source
    assert "mDestroyed = true" in source
    assert "removeCallbacks(mDispatchNetworkChange)" in source
    assert "removeCallbacks(mOpenFriendsAfterNotificationTask)" in source
    assert "unregisterNetworkMonitor();" in source

    # Preserve the existing memory-safety contract: no forced GC or WebView
    # cache purge, which would hurt hot-update recovery and foreground latency.
    assert "System.gc()" not in source
    assert "clearCache()" not in source

    print("android lifecycle smoke: PASS")


if __name__ == "__main__":
    main()
