"""Static guardrails for the native Android launch overlay.

The APK is assembled by build_apk.js without a Gradle project, so this smoke
test checks the source/resource contract that must remain true on every build.
It deliberately does not require an emulator or network access.
"""

from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def main():
    splash = (ROOT / "android_src/src/com/gomoku/master/GomokuSplashView.java").read_text(encoding="utf-8")
    activity = (ROOT / "android_src/src/com/gomoku/master/MainActivity.java").read_text(encoding="utf-8")
    colors = (ROOT / "android_src/res/values/colors.xml").read_text(encoding="utf-8")
    night_colors = (ROOT / "android_src/res/values-night/colors.xml").read_text(encoding="utf-8")
    strings = (ROOT / "android_src/res/values/strings.xml").read_text(encoding="utf-8")
    theme = (ROOT / "android_src/res/values/styles.xml").read_text(encoding="utf-8")
    launch_icon = (ROOT / "android_src/res/drawable/splash_heart_icon.xml").read_text(encoding="utf-8")
    launch_animators = [
        (ROOT / "android_src/res/animator" / name).read_text(encoding="utf-8")
        for name in (
            "splash_heart_outline.xml",
            "splash_stones_inner.xml",
            "splash_stones_middle.xml",
            "splash_stones_outer.xml",
        )
    ]

    assert "class GomokuSplashView" in splash
    assert "ValueAnimator" in splash
    assert "isReducedMotion" in splash
    assert "setDismissListener" in splash
    assert "onTouchEvent" in splash and "performClick" in splash
    assert 'img/startup/sky-cloudsea-v2.webp' in splash
    assert 'img/game/sky-board-cloudstone.webp' in splash
    assert "drawGridAndStones" in splash and "RadialGradient" in splash
    assert "splash_ink" in colors and "splash_stone_dark" in colors
    assert "splash_bg" in night_colors and "splash_stone_dark" in night_colors
    assert "splash_content_description" in strings
    assert "windowSplashScreenAnimatedIcon" in theme
    assert "splash_heart_icon_animated" in theme
    assert 'android:name="gomoku_grid"' in launch_icon
    assert 'android:trimPathEnd="0"' in launch_icon
    assert launch_icon.count('android:alpha="0"') == 3
    assert all('android:repeatCount="infinite"' in animator for animator in launch_animators)
    assert all('android:repeatMode="reverse"' in animator for animator in launch_animators)

    assert "showNativeSplash();" in activity
    assert activity.index("showNativeSplash();") < activity.index("mMainHandler.postDelayed(mInitializeWebViewTask")
    assert "onPageCommitVisible" in activity
    assert "onWebContentVisible();" in activity
    assert "getMinimumDisplayDurationMs()" in activity
    assert "mHasVisibleWebContent" in activity
    assert "requestNativeSplashDismiss();" in activity
    assert "postDelayed(mSplashLoadWarning, 1400L)" in activity
    assert "setContentView(mRootLayout)" in activity
    # The splash must not introduce the prohibited memory/cache-clearing path.
    assert "System.gc()" not in activity
    assert "clearCache()" not in activity

    print("android splash smoke: PASS")


if __name__ == "__main__":
    main()
