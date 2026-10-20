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
    # The board/grid is cached on a static layer; only the transparent stone
    # layer should redraw on animation frames.
    scene_layer = splash.split("private final class SceneLayer", 1)[1].split("private final class HeartLayer", 1)[0]
    heart_layer = splash.split("private final class HeartLayer", 1)[1].split("private static Bitmap loadBitmap", 1)[0]
    animation = splash.split("private void beginAnimation()", 1)[1].split("public void pauseAnimation()", 1)[0]
    assert "drawStaticScene(canvas," in scene_layer
    assert "drawHeartStones(canvas, progress)" in heart_layer
    assert "drawStaticScene" not in heart_layer and "drawHeartStones" not in scene_layer
    assert "drawGrid(canvas, boardRect, density)" in splash
    assert splash.index("addView(sceneLayer,") < splash.index("addView(heartLayer,")
    assert "postInvalidateHeartRegionOnAnimation();" in animation
    assert "sceneLayer.invalidate()" not in animation
    assert "heartLayer.postInvalidateOnAnimation(" in splash
    assert "heartDirtyBounds.left, heartDirtyBounds.top" in splash
    assert "RadialGradient" in splash
    assert "loadArtworkAsync" in splash and "inJustDecodeBounds" in splash
    assert "inSampleSize" in splash and "animationRequested" in splash
    assert "private boolean paused" in splash
    assert "if ((!artworkReady && !artworkFailed) || stopped || paused || animationStarted) return;" in animation
    assert "if (finalSky == null || finalBoard == null || finalBlack == null || finalWhite == null)" in splash
    # A failed decode keeps the opening poster (artworkReady remains false),
    # but must start the same presentation clock as a successful load. Before
    # this guard the Activity waited forever for a start notification.
    failed_load = splash.split("if (finalSky == null || finalBoard == null || finalBlack == null || finalWhite == null)", 1)[1].split("skyBitmap = finalSky", 1)[0]
    assert "artworkFailed = true;" in failed_load
    assert "showLoadingHint = true;" in failed_load and "sceneLayer.invalidate();" in failed_load
    assert "artworkReady = true" not in failed_load
    assert "setBackground(null)" not in failed_load
    successful_load = splash.split("skyBitmap = finalSky", 1)[1].split("if (!posted)", 1)[0]
    assert successful_load.index("artworkReady = true;") < successful_load.index("setBackground(null);")
    assert "if (skyBitmap == null || skyBitmap.isRecycled()) canvas.drawColor(backgroundColor);" in splash
    assert "if (animationRequested && !paused) beginAnimation();" in failed_load
    assert animation.index("animationStartedListener.onAnimationStarted(") < animation.index("if (artworkFailed) return;")
    start_animation = splash.split("public void startAnimation()", 1)[1].split("private void beginAnimation()", 1)[0]
    assert "if (!artworkReady && !artworkFailed) return;" in start_animation
    assert "beginAnimation();" in start_animation
    resume_animation = splash.split("public void resumeAnimation()", 1)[1].split("public void stopAnimation()", 1)[0]
    assert "animationRequested && (artworkReady || artworkFailed) && !animationStarted" in resume_animation
    assert "beginAnimation();" in resume_animation
    assert "requestedWidth * 1.5f" in splash
    assert "for (int index = 0; index < 15; index++)" in splash
    assert "firstX + 14f * step" in splash and "firstY + 14f * step" in splash
    assert "STONES[index][2] == 0" in splash  # explicit colors shared with the web heart layout
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
    dismiss = activity.split("private void dismissNativeSplash()", 1)[1].split("private void requestNativeSplashDismiss()", 1)[0]
    assert dismiss.index("if (!mHasVisibleWebContent) return;") < dismiss.index("mRootLayout.removeView(splash)")
    assert "splash.stopAnimation();" in dismiss
    on_pause = activity.split("protected void onPause()", 1)[1].split("private void notifyWebMusicLifecycle", 1)[0]
    on_resume = activity.split("protected void onResume()", 1)[1].split("public void onTrimMemory", 1)[0]
    on_destroy = activity.split("protected void onDestroy()", 1)[1]
    assert "mSplashView.pauseAnimation();" in on_pause
    assert "mSplashView.resumeAnimation();" in on_resume
    assert "mSplashView.stopAnimation();" in on_destroy
    assert "removeCallbacks(mInitializeWebViewTask)" in on_destroy
    assert "removeCallbacks(mSplashLoadWarning)" in on_destroy
    assert "removeCallbacks(mSplashContentDismiss)" in on_destroy
    # The splash must not introduce the prohibited memory/cache-clearing path.
    assert "System.gc()" not in activity
    assert "clearCache()" not in activity

    print("android splash smoke: PASS")


if __name__ == "__main__":
    main()
