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
    empty_board_art = ROOT / "android_src/res/drawable-nodpi/splash_empty_board_art.webp"
    opening_poster = ROOT / "android_src/res/drawable-nodpi/splash_opening_poster.webp"

    assert "class GomokuSplashView" in splash
    assert "ValueAnimator" in splash
    assert "isReducedMotion" in splash
    assert "setDismissListener" in splash
    assert "onTouchEvent" in splash and "performClick" in splash
    assert 'img/startup/sky-cloudsea-v2.webp' in splash
    assert 'img/game/sky-board-cloudstone.webp' in splash
    assert "drawGridAndStones" in splash and "RadialGradient" in splash
    assert "loadArtworkAsync" in splash and "inJustDecodeBounds" in splash
    assert "inSampleSize" in splash and "animationRequested" in splash
    assert "private boolean paused" in splash and "if (!artworkReady || stopped || paused || animationStarted) return;" in splash
    assert "if (finalSky == null || finalBoard == null || finalBlack == null || finalWhite == null)" in splash
    assert "requestedWidth * 1.5f" in splash
    assert "float gridReveal = 1f;" in splash
    assert "STONES[index][1] < 7" in splash  # black on the left, white on the right
    assert "setBackgroundResource(R.drawable.splash_opening_poster)" in splash
    assert "splash_ink" in colors and "splash_stone_dark" in colors
    assert "splash_bg" in night_colors and "splash_stone_dark" in night_colors
    assert "splash_content_description" in strings
    assert "windowSplashScreenAnimatedIcon" in theme
    assert "splash_empty_board_art" in theme
    assert "splash_opening_poster" in theme
    assert empty_board_art.is_file() and opening_poster.is_file()
    assert empty_board_art.read_bytes()[8:12] == b"WEBP"
    assert opening_poster.read_bytes()[8:12] == b"WEBP"

    assert "showNativeSplash();" in activity
    assert activity.index("showNativeSplash();") < activity.index("mMainHandler.postDelayed(mInitializeWebViewTask")
    assert "awaitLocalServerAndLoadPage();" in activity
    assert "private void awaitLocalServerAndLoadPage()" in activity
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
