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

    assert "class GomokuSplashView" in splash
    assert "ValueAnimator" in splash
    assert "isReducedMotion" in splash
    assert "setDismissListener" in splash
    assert "onTouchEvent" in splash and "performClick" in splash
    assert "splash_board" in colors and "splash_accent" in colors
    assert "splash_bg" in night_colors and "splash_stone_dark" in night_colors
    assert "splash_content_description" in strings

    assert "showNativeSplash();" in activity
    assert "onPageCommitVisible" in activity
    assert "onWebContentVisible();" in activity
    assert "postDelayed(mSplashFailSafe, 1400L)" in activity
    assert "setContentView(mRootLayout)" in activity
    # The splash must not introduce the prohibited memory/cache-clearing path.
    assert "System.gc()" not in activity
    assert "clearCache()" not in activity

    print("android splash smoke: PASS")


if __name__ == "__main__":
    main()
