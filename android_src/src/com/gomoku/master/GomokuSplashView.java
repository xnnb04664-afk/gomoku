package com.gomoku.master;

import android.animation.Animator;
import android.animation.AnimatorListenerAdapter;
import android.animation.TimeInterpolator;
import android.animation.ValueAnimator;
import android.content.Context;
import android.content.res.AssetManager;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.RectF;
import android.os.Build;
import android.provider.Settings;
import android.view.MotionEvent;
import android.view.View;
import android.view.animation.PathInterpolator;

import java.io.InputStream;

/**
 * A small, self-contained native splash.  It reads four compressed, local
 * opening frames from the APK assets and cross-fades them while WebView boots.
 * If an asset is unavailable, the original Canvas fallback remains available,
 * so a damaged update can never block first paint.
 */
public final class GomokuSplashView extends View {
    public interface DismissListener {
        void onDismissRequested();
    }

    private static final int GRID_SIZE = 9;
    private static final long ANIMATION_DURATION_MS = 820L;
    private static final float[][] STONES = {
            {2f, 2f, 0f}, {6f, 2f, 1f}, {3f, 4f, 0f},
            {5f, 4f, 1f}, {4f, 6f, 0f}, {4f, 3f, 1f}
    };
    private static final String[] STARTUP_FRAME_ASSETS = {
            "img/startup/startup-01.webp",
            "img/startup/startup-02.webp",
            "img/startup/startup-03.webp",
            "img/startup/startup-04.webp"
    };

    private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint textPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final RectF boardRect = new RectF();
    private final boolean reducedMotion;
    private final int backgroundColor;
    private final int boardColor;
    private final int gridColor;
    private final int inkColor;
    private final int lightStoneColor;
    private final int darkStoneColor;
    private final int accentColor;
    private final Bitmap[] startupFrames;
    private final boolean startupFramesAvailable;
    private final RectF startupFrameRect = new RectF();
    private ValueAnimator animator;
    private float progress;
    private DismissListener dismissListener;

    public GomokuSplashView(Context context) {
        super(context);
        backgroundColor = context.getResources().getColor(R.color.splash_bg);
        boardColor = context.getResources().getColor(R.color.splash_board);
        gridColor = context.getResources().getColor(R.color.splash_grid);
        inkColor = context.getResources().getColor(R.color.splash_ink);
        lightStoneColor = context.getResources().getColor(R.color.splash_stone_light);
        darkStoneColor = context.getResources().getColor(R.color.splash_stone_dark);
        accentColor = context.getResources().getColor(R.color.splash_accent);
        reducedMotion = isReducedMotion(context);
        startupFrames = loadStartupFrames(context);
        startupFramesAvailable = hasAllDecodedFrames(startupFrames);

        setClickable(true);
        setFocusable(true);
        setContentDescription(context.getString(R.string.splash_content_description));
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            setElevation(2f * getResources().getDisplayMetrics().density);
        }
        textPaint.setTypeface(android.graphics.Typeface.create("sans-serif", android.graphics.Typeface.BOLD));
    }

    public void setDismissListener(DismissListener listener) {
        dismissListener = listener;
    }

    public void startAnimation() {
        if (reducedMotion) {
            progress = 1f;
            invalidate();
            return;
        }
        if (animator != null) animator.cancel();
        progress = 0f;
        animator = ValueAnimator.ofFloat(0f, 1f);
        animator.setDuration(ANIMATION_DURATION_MS);
        animator.setInterpolator(createInterpolator());
        animator.addUpdateListener(valueAnimator -> {
            progress = (Float) valueAnimator.getAnimatedValue();
            invalidate();
        });
        animator.addListener(new AnimatorListenerAdapter() {
            @Override
            public void onAnimationEnd(Animator animation) {
                progress = 1f;
                invalidate();
            }
        });
        animator.start();
    }

    public void pauseAnimation() {
        if (animator != null && animator.isRunning() && Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT) {
            animator.pause();
        }
    }

    public void resumeAnimation() {
        if (animator != null && animator.isPaused() && Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT) {
            animator.resume();
        }
    }

    public void stopAnimation() {
        if (animator != null) {
            animator.cancel();
            animator = null;
        }
        releaseStartupFrames();
    }

    @Override
    protected void onDraw(Canvas canvas) {
        super.onDraw(canvas);
        final float density = getResources().getDisplayMetrics().density;
        final float width = getWidth();
        final float height = getHeight();
        canvas.drawColor(backgroundColor);

        if (startupFramesAvailable) {
            drawStartupFrames(canvas, width, height);
            drawStartupCopy(canvas, width, height, density);
            return;
        }

        final float centerX = width * 0.5f;
        final float boardSize = Math.min(Math.min(width * 0.72f, height * 0.43f), 360f * density);
        final float boardTop = height * 0.30f;
        boardRect.set(centerX - boardSize * 0.5f, boardTop,
                centerX + boardSize * 0.5f, boardTop + boardSize);

        paint.setStyle(Paint.Style.FILL);
        paint.setColor(boardColor);
        canvas.drawRoundRect(boardRect, 16f * density, 16f * density, paint);

        final float inset = boardSize * 0.085f;
        final float gridLeft = boardRect.left + inset;
        final float gridTop = boardRect.top + inset;
        final float gridSize = boardSize - inset * 2f;
        final float cell = gridSize / (GRID_SIZE - 1f);
        paint.setStyle(Paint.Style.STROKE);
        paint.setStrokeWidth(Math.max(1f, density));
        paint.setColor(gridColor);
        for (int i = 0; i < GRID_SIZE; i++) {
            float offset = i * cell;
            canvas.drawLine(gridLeft + offset, gridTop, gridLeft + offset, gridTop + gridSize, paint);
            canvas.drawLine(gridLeft, gridTop + offset, gridLeft + gridSize, gridTop + offset, paint);
        }

        // A small jade/coral crosshair evokes the experimental cross-board
        // mode without pulling any game code or WebView resources into startup.
        paint.setColor(accentColor);
        paint.setStrokeWidth(Math.max(2f, density * 2f));
        float crossX = gridLeft + cell * 4f;
        float crossY = gridTop + cell * 4f;
        canvas.drawLine(crossX - cell * 0.22f, crossY, crossX + cell * 0.22f, crossY, paint);
        canvas.drawLine(crossX, crossY - cell * 0.22f, crossX, crossY + cell * 0.22f, paint);

        for (int i = 0; i < STONES.length; i++) {
            float stoneProgress = clamp((progress * (STONES.length + 1f) - i) / 1.6f);
            if (stoneProgress <= 0f) continue;
            float x = gridLeft + cell * STONES[i][0];
            float y = gridTop + cell * STONES[i][1];
            float radius = cell * 0.36f * (0.80f + stoneProgress * 0.20f);
            paint.setStyle(Paint.Style.FILL);
            paint.setColor(STONES[i][2] == 0f ? darkStoneColor : lightStoneColor);
            paint.setAlpha((int) (255f * Math.min(1f, stoneProgress * 1.35f)));
            canvas.drawCircle(x, y, radius, paint);
            paint.setAlpha(255);
        }

        textPaint.setTextAlign(Paint.Align.CENTER);
        textPaint.setColor(inkColor);
        textPaint.setTextSize(Math.max(22f * density, Math.min(32f * density, width * 0.085f)));
        canvas.drawText(getResources().getString(R.string.splash_title), centerX, height * 0.17f, textPaint);
        textPaint.setTypeface(android.graphics.Typeface.create("sans-serif", android.graphics.Typeface.NORMAL));
        textPaint.setTextSize(12f * density);
        textPaint.setColor(inkColor);
        textPaint.setAlpha(185);
        canvas.drawText(getResources().getString(R.string.splash_subtitle), centerX, boardRect.bottom + 36f * density, textPaint);
        textPaint.setTextSize(11f * density);
        textPaint.setColor(inkColor);
        textPaint.setAlpha(150);
        canvas.drawText(getResources().getString(R.string.splash_skip), centerX, height - 32f * density, textPaint);
        textPaint.setAlpha(255);
        textPaint.setTypeface(android.graphics.Typeface.create("sans-serif", android.graphics.Typeface.BOLD));
    }

    private void drawStartupFrames(Canvas canvas, float width, float height) {
        float framePosition = clamp(progress) * (startupFrames.length - 1f);
        int frameIndex = Math.min(startupFrames.length - 1, (int) Math.floor(framePosition));
        int nextIndex = Math.min(startupFrames.length - 1, frameIndex + 1);
        float blend = framePosition - frameIndex;

        drawBitmapCover(canvas, startupFrames[frameIndex], width, height, 255);
        if (nextIndex != frameIndex && blend > 0f && startupFrames[nextIndex] != null) {
            drawBitmapCover(canvas, startupFrames[nextIndex], width, height, (int) (255f * blend));
        }
    }

    private void drawBitmapCover(Canvas canvas, Bitmap bitmap, float width, float height, int alpha) {
        if (bitmap == null || bitmap.isRecycled()) return;
        float scale = Math.max(width / bitmap.getWidth(), height / bitmap.getHeight());
        float drawWidth = bitmap.getWidth() * scale;
        float drawHeight = bitmap.getHeight() * scale;
        startupFrameRect.set(
                (width - drawWidth) * 0.5f,
                (height - drawHeight) * 0.5f,
                (width + drawWidth) * 0.5f,
                (height + drawHeight) * 0.5f
        );
        paint.setFilterBitmap(true);
        paint.setAlpha(Math.max(0, Math.min(255, alpha)));
        canvas.drawBitmap(bitmap, null, startupFrameRect, paint);
        paint.setAlpha(255);
    }

    private void drawStartupCopy(Canvas canvas, float width, float height, float density) {
        final float centerX = width * 0.5f;
        textPaint.setTextAlign(Paint.Align.CENTER);
        textPaint.setTypeface(android.graphics.Typeface.create("sans-serif", android.graphics.Typeface.BOLD));
        textPaint.setColor(0xffffffff);
        textPaint.setAlpha(245);
        textPaint.setShadowLayer(8f * density, 0f, 2f * density, 0x660b4770);
        textPaint.setTextSize(Math.max(24f * density, Math.min(38f * density, width * 0.095f)));
        canvas.drawText(getResources().getString(R.string.splash_title), centerX, height * 0.17f, textPaint);
        textPaint.setTypeface(android.graphics.Typeface.create("sans-serif", android.graphics.Typeface.NORMAL));
        textPaint.setTextSize(12f * density);
        textPaint.setAlpha(230);
        canvas.drawText(getResources().getString(R.string.splash_subtitle), centerX, height * 0.73f, textPaint);
        textPaint.setTextSize(11f * density);
        textPaint.setAlpha(190);
        canvas.drawText(getResources().getString(R.string.splash_skip), centerX, height - 32f * density, textPaint);
        textPaint.clearShadowLayer();
        textPaint.setAlpha(255);
        textPaint.setTypeface(android.graphics.Typeface.create("sans-serif", android.graphics.Typeface.BOLD));
    }

    @Override
    public boolean onTouchEvent(MotionEvent event) {
        // The native opening layer must never consume the first real game
        // gesture. WebView content can already be interactive underneath it;
        // dismissing here and returning false lets FrameLayout dispatch the
        // same pointer sequence to that content instead of forcing a second
        // tap. The web splash still owns its explicit skip control.
        if (event != null && event.getAction() == MotionEvent.ACTION_DOWN
                && dismissListener != null) {
            dismissListener.onDismissRequested();
        }
        return false;
    }

    @Override
    public boolean performClick() {
        super.performClick();
        return true;
    }

    private static float clamp(float value) {
        return Math.max(0f, Math.min(1f, value));
    }

    private static Bitmap[] loadStartupFrames(Context context) {
        Bitmap[] frames = new Bitmap[STARTUP_FRAME_ASSETS.length];
        AssetManager assets = context.getAssets();
        for (int i = 0; i < STARTUP_FRAME_ASSETS.length; i++) {
            try (InputStream input = assets.open(STARTUP_FRAME_ASSETS[i])) {
                BitmapFactory.Options options = new BitmapFactory.Options();
                options.inPreferredConfig = Bitmap.Config.RGB_565;
                options.inScaled = false;
                frames[i] = BitmapFactory.decodeStream(input, null, options);
            } catch (Exception ignored) {
                // Keep the Canvas fallback if a partially updated APK misses a frame.
            }
        }
        return frames;
    }

    private static boolean hasAllDecodedFrames(Bitmap[] frames) {
        if (frames == null) return false;
        for (Bitmap frame : frames) {
            if (frame == null || frame.isRecycled()) return false;
        }
        return true;
    }

    private void releaseStartupFrames() {
        for (Bitmap frame : startupFrames) {
            if (frame != null && !frame.isRecycled()) frame.recycle();
        }
    }

    private static boolean isReducedMotion(Context context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !ValueAnimator.areAnimatorsEnabled()) {
            return true;
        }
        try {
            float durationScale = Settings.Global.getFloat(
                    context.getContentResolver(), Settings.Global.ANIMATOR_DURATION_SCALE, 1f);
            return durationScale <= 0f;
        } catch (Exception ignored) {
            return false;
        }
    }

    private static TimeInterpolator createInterpolator() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            return new PathInterpolator(0.20f, 0.85f, 0.25f, 1f);
        }
        return input -> input;
    }
}
