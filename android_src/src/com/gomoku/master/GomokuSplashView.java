package com.gomoku.master;

import android.animation.Animator;
import android.animation.AnimatorListenerAdapter;
import android.animation.ValueAnimator;
import android.content.Context;
import android.content.res.AssetManager;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.LinearGradient;
import android.graphics.Paint;
import android.graphics.RadialGradient;
import android.graphics.RectF;
import android.graphics.Shader;
import android.os.Build;
import android.provider.Settings;
import android.view.MotionEvent;
import android.view.View;
import android.view.animation.LinearInterpolator;

import java.io.InputStream;

/**
 * Native version of the Sky Island opening: dawn clouds, the live cloudstone
 * board, a center-out grid reveal, and a heart-shaped black-and-white stone pattern.
 */
public final class GomokuSplashView extends View {
    public interface DismissListener {
        void onDismissRequested();
    }

    private static final long ANIMATION_DURATION_MS = 3600L;
    private static final String SKY_ASSET = "img/startup/sky-cloudsea-v2.webp";
    private static final String BOARD_ASSET = "img/game/sky-board-cloudstone.webp";
    private static final int[][] STONES = {
            {2, 4, 0}, {2, 10, 0}, {2, 5, 1}, {2, 9, 1},
            {3, 3, 1}, {3, 11, 1}, {3, 6, 0}, {3, 8, 0},
            {4, 2, 0}, {4, 12, 0}, {4, 7, 1},
            {5, 1, 1}, {5, 13, 1}, {6, 1, 0}, {6, 13, 0},
            {7, 2, 1}, {7, 12, 1}, {8, 3, 0}, {8, 11, 0},
            {9, 4, 1}, {9, 10, 1}, {10, 5, 0}, {10, 9, 0},
            {11, 6, 1}, {11, 8, 1}, {12, 7, 0}
    };

    private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint textPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final RectF boardRect = new RectF();
    private final RectF footerRect = new RectF();
    private final boolean reducedMotion;
    private final int backgroundColor;
    private final int inkColor;
    private final int stoneLightColor;
    private final int stoneDarkColor;
    private Bitmap skyBitmap;
    private Bitmap boardBitmap;
    private ValueAnimator animator;
    private float progress;
    private boolean showLoadingHint;
    private DismissListener dismissListener;

    public GomokuSplashView(Context context) {
        super(context);
        backgroundColor = context.getResources().getColor(R.color.splash_bg);
        inkColor = context.getResources().getColor(R.color.splash_ink);
        stoneLightColor = context.getResources().getColor(R.color.splash_stone_light);
        stoneDarkColor = context.getResources().getColor(R.color.splash_stone_dark);
        reducedMotion = isReducedMotion(context);
        skyBitmap = loadBitmap(context, SKY_ASSET, Bitmap.Config.RGB_565);
        boardBitmap = loadBitmap(context, BOARD_ASSET, Bitmap.Config.ARGB_8888);

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

    public long getMinimumDisplayDurationMs() {
        return reducedMotion ? 850L : ANIMATION_DURATION_MS;
    }

    public void showLoadingHint() {
        if (showLoadingHint) return;
        showLoadingHint = true;
        postInvalidate();
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
        // Keep the stone-by-stone timeline evenly paced; each individual stone
        // still eases into place in drawStone().
        animator.setInterpolator(new LinearInterpolator());
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
        releaseBitmaps();
    }

    @Override
    protected void onDraw(Canvas canvas) {
        super.onDraw(canvas);
        final float width = getWidth();
        final float height = getHeight();
        final float density = getResources().getDisplayMetrics().density;
        canvas.drawColor(backgroundColor);
        drawSky(canvas, width, height);
        drawAtmosphere(canvas, width, height);
        drawBrand(canvas, width, height, density);
        drawBoard(canvas, width, height, density);
        drawFooter(canvas, width, height, density);
    }

    private void drawSky(Canvas canvas, float width, float height) {
        if (skyBitmap == null || skyBitmap.isRecycled()) return;
        float cover = Math.max(width / skyBitmap.getWidth(), height / skyBitmap.getHeight());
        float breathingZoom = 1.05f - 0.025f * easeOut(progress);
        float drawWidth = skyBitmap.getWidth() * cover * breathingZoom;
        float drawHeight = skyBitmap.getHeight() * cover * breathingZoom;
        float driftX = (float) Math.sin(progress * Math.PI) * width * 0.004f;
        float driftY = (0.5f - progress) * height * 0.006f;
        RectF skyRect = new RectF(
                (width - drawWidth) * 0.5f + driftX,
                (height - drawHeight) * 0.5f + driftY,
                (width + drawWidth) * 0.5f + driftX,
                (height + drawHeight) * 0.5f + driftY
        );
        paint.setShader(null);
        paint.setStyle(Paint.Style.FILL);
        paint.setAlpha(255);
        paint.setFilterBitmap(true);
        canvas.drawBitmap(skyBitmap, null, skyRect, paint);
    }

    private void drawAtmosphere(Canvas canvas, float width, float height) {
        paint.setStyle(Paint.Style.FILL);
        paint.setShader(new LinearGradient(
                0f, 0f, 0f, height,
                new int[]{0x240b3b63, 0x020b3b63, 0x06154962, 0x37154962},
                new float[]{0f, 0.28f, 0.63f, 1f},
                Shader.TileMode.CLAMP
        ));
        canvas.drawRect(0f, 0f, width, height, paint);
        paint.setShader(null);
    }

    private void drawBrand(Canvas canvas, float width, float height, float density) {
        final float centerX = width * 0.5f;
        final float kickerReveal = easeOut(progress / 0.18f);
        final float titleReveal = easeOut((progress - 0.06f) / 0.24f);
        final float subtitleReveal = easeOut((progress - 0.15f) / 0.24f);
        textPaint.setTextAlign(Paint.Align.CENTER);
        textPaint.setTypeface(android.graphics.Typeface.create("sans-serif-medium", android.graphics.Typeface.NORMAL));
        textPaint.setColor(Color.WHITE);
        textPaint.setAlpha((int) (238f * kickerReveal));
        textPaint.setTextSize(9.5f * density);
        textPaint.setShadowLayer(5f * density, 0f, 1f * density, 0x66345570);
        canvas.drawText("SKY ISLAND  ·  GOMOKU", centerX, height * 0.078f, textPaint);

        textPaint.setTypeface(android.graphics.Typeface.create("sans-serif", android.graphics.Typeface.BOLD));
        textPaint.setColor(0xfffffdf3);
        textPaint.setAlpha((int) (255f * titleReveal));
        textPaint.setTextSize(Math.max(30f * density, Math.min(39f * density, width * 0.105f)));
        textPaint.setShadowLayer(2f * density, 0f, 2f * density, 0x33244f62);
        canvas.drawText(getResources().getString(R.string.splash_title), centerX,
                height * 0.145f + (1f - titleReveal) * 14f * density, textPaint);

        textPaint.setTypeface(android.graphics.Typeface.create("sans-serif-medium", android.graphics.Typeface.NORMAL));
        textPaint.setColor(0xfff6fbf2);
        textPaint.setAlpha((int) (242f * subtitleReveal));
        textPaint.setTextSize(12.5f * density);
        textPaint.setShadowLayer(4f * density, 0f, 1f * density, 0x66345570);
        canvas.drawText(getResources().getString(R.string.splash_subtitle), centerX, height * 0.192f, textPaint);
        textPaint.clearShadowLayer();
        textPaint.setAlpha(255);
        textPaint.setTypeface(android.graphics.Typeface.create("sans-serif", android.graphics.Typeface.BOLD));
    }

    private void drawBoard(Canvas canvas, float width, float height, float density) {
        float boardSide = Math.min(Math.min(width * 0.82f, height * 0.41f), 480f * density);
        float entrance = easeOut(progress / 0.24f);
        float scale = 0.89f + 0.11f * entrance;
        float verticalOffset = height * 0.045f * (1f - entrance);
        float centerX = width * 0.5f;
        float centerY = height * 0.515f + verticalOffset;
        float drawnSide = boardSide * scale;
        boardRect.set(centerX - drawnSide * 0.5f, centerY - drawnSide * 0.5f,
                centerX + drawnSide * 0.5f, centerY + drawnSide * 0.5f);

        paint.setShader(null);
        paint.setStyle(Paint.Style.FILL);
        paint.setColor(0x44365360);
        canvas.drawOval(
                boardRect.left + drawnSide * 0.10f,
                boardRect.bottom - drawnSide * 0.045f,
                boardRect.right - drawnSide * 0.10f,
                boardRect.bottom + drawnSide * 0.035f,
                paint
        );
        if (boardBitmap != null && !boardBitmap.isRecycled()) {
            paint.setAlpha((int) (255f * entrance));
            paint.setFilterBitmap(true);
            canvas.drawBitmap(boardBitmap, null, boardRect, paint);
            paint.setAlpha(255);
        } else {
            paint.setColor(0xff91c875);
            canvas.drawRoundRect(boardRect, 16f * density, 16f * density, paint);
        }

        drawGridAndStones(canvas, boardRect, progress, density);
    }

    private void drawGridAndStones(Canvas canvas, RectF board, float animationProgress, float density) {
        float side = board.width();
        float grassLeft = board.left + side * 0.130f;
        float grassRight = board.left + side * 0.869f;
        float grassTop = board.top + side * 0.132f;
        float grassBottom = board.top + side * 0.785f;
        float step = Math.min((grassRight - grassLeft) / 15f, (grassBottom - grassTop) / 15f);
        float firstX = (grassLeft + grassRight) * 0.5f - 7f * step;
        float firstY = grassTop + 0.5f * step;
        float lastX = firstX + 14f * step;
        float lastY = firstY + 14f * step;
        float centerX = (firstX + lastX) * 0.5f;
        float centerY = (firstY + lastY) * 0.5f;
        float gridReveal = easeOut((animationProgress - 0.11f) / 0.45f);

        if (gridReveal > 0f) {
            paint.setShader(null);
            paint.setStyle(Paint.Style.STROKE);
            paint.setColor(0xff354c30);
            paint.setAlpha((int) (175f * gridReveal));
            paint.setStrokeWidth(Math.max(1f, step * 0.026f));
            for (int index = 0; index < 15; index++) {
                float centerDistance = Math.abs(index - 7f) / 7f;
                float span = easeOut((gridReveal - centerDistance * 0.11f) / 0.9f);
                if (span <= 0f) continue;
                float halfHeight = (lastY - firstY) * 0.5f * span;
                float halfWidth = (lastX - firstX) * 0.5f * span;
                float x = firstX + index * step;
                float y = firstY + index * step;
                canvas.drawLine(x, centerY - halfHeight, x, centerY + halfHeight, paint);
                canvas.drawLine(centerX - halfWidth, y, centerX + halfWidth, y, paint);
            }
            paint.setStyle(Paint.Style.FILL);
            paint.setColor(0xff344b2e);
            paint.setAlpha((int) (170f * easeOut((animationProgress - 0.38f) / 0.16f)));
            for (int row : new int[]{3, 7, 11}) {
                for (int col : new int[]{3, 7, 11}) {
                    canvas.drawCircle(firstX + col * step, firstY + row * step,
                            Math.max(1.5f * density, step * 0.055f), paint);
                }
            }
        }

        for (int index = 0; index < STONES.length; index++) {
            float start = 0.22f + index * 0.027f;
            float stoneProgress = clamp((animationProgress - start) / 0.09f);
            drawStone(
                    canvas,
                    firstX + STONES[index][1] * step,
                    firstY + STONES[index][0] * step,
                    step * 0.43f,
                    STONES[index][2] == 0,
                    stoneProgress
            );
        }

        paint.setAlpha(255);
        paint.setShader(null);
        paint.setStyle(Paint.Style.FILL);
    }

    private void drawStone(Canvas canvas, float x, float y, float radius, boolean black,
                           float stoneProgress) {
        if (stoneProgress <= 0f) return;
        float pop = easeOut(stoneProgress);
        float stoneRadius = radius * (0.68f + 0.32f * pop);
        float drop = (1f - pop) * radius * 1.15f;
        float centerY = y + drop;

        paint.setShader(null);
        paint.setStyle(Paint.Style.FILL);
        paint.setColor(0x55344843);
        canvas.drawOval(x - stoneRadius, y + radius * 0.16f, x + stoneRadius, y + radius * 0.88f, paint);
        int[] colors = black
                ? new int[]{0xff7f8c96, stoneDarkColor, 0xff07121c}
                : new int[]{0xffffffff, stoneLightColor, 0xffa6b5bc};
        RadialGradient stoneGradient = new RadialGradient(
                x - stoneRadius * 0.32f, centerY - stoneRadius * 0.38f,
                stoneRadius * 1.48f, colors, new float[]{0f, 0.42f, 1f}, Shader.TileMode.CLAMP
        );
        paint.setStyle(Paint.Style.FILL);
        paint.setShader(stoneGradient);
        paint.setAlpha((int) (255f * Math.min(1f, stoneProgress * 1.4f)));
        canvas.drawCircle(x, centerY, stoneRadius, paint);
        paint.setShader(null);
        if (!black) {
            paint.setStyle(Paint.Style.STROKE);
            paint.setColor(0x7788989f);
            paint.setStrokeWidth(Math.max(0.7f, stoneRadius * 0.07f));
            canvas.drawCircle(x, centerY, stoneRadius * 0.96f, paint);
        }
        paint.setStyle(Paint.Style.FILL);
        paint.setColor(black ? 0x66ffffff : 0xddffffff);
        canvas.drawOval(x - stoneRadius * 0.56f, centerY - stoneRadius * 0.70f,
                x - stoneRadius * 0.06f, centerY - stoneRadius * 0.37f, paint);
        paint.setAlpha(255);
        paint.setShader(null);
    }

    private void drawFooter(Canvas canvas, float width, float height, float density) {
        float centerX = width * 0.5f;
        float statusY = height - 69f * density;
        paint.setShader(null);
        paint.setStyle(Paint.Style.FILL);
        paint.setColor(0xffffdc88);
        canvas.drawCircle(centerX - 78f * density, statusY - 4f * density, 3.3f * density, paint);

        textPaint.setTextAlign(Paint.Align.CENTER);
        textPaint.setTypeface(android.graphics.Typeface.create("sans-serif-medium", android.graphics.Typeface.NORMAL));
        textPaint.setColor(Color.WHITE);
        textPaint.setAlpha(235);
        textPaint.setTextSize(11f * density);
        textPaint.setShadowLayer(4f * density, 0f, 1f * density, 0x66345570);
        String status = showLoadingHint ? "棋台正在就位，请稍候…" : "云海棋局 · 即将开启";
        canvas.drawText(status, centerX, statusY, textPaint);
        textPaint.clearShadowLayer();

        float pillWidth = 96f * density;
        float pillHeight = 34f * density;
        footerRect.set(centerX - pillWidth * 0.5f, height - 49f * density,
                centerX + pillWidth * 0.5f, height - 15f * density);
        paint.setColor(0x55305c6b);
        canvas.drawRoundRect(footerRect, pillHeight * 0.5f, pillHeight * 0.5f, paint);
        paint.setStyle(Paint.Style.STROKE);
        paint.setStrokeWidth(Math.max(1f, density));
        paint.setColor(0x99ffffff);
        canvas.drawRoundRect(footerRect, pillHeight * 0.5f, pillHeight * 0.5f, paint);

        textPaint.setColor(Color.WHITE);
        textPaint.setAlpha(245);
        textPaint.setTextSize(10.5f * density);
        textPaint.setTypeface(android.graphics.Typeface.create("sans-serif", android.graphics.Typeface.BOLD));
        textPaint.setShadowLayer(3f * density, 0f, 1f * density, 0x55345570);
        canvas.drawText(getResources().getString(R.string.splash_skip), centerX, height - 27f * density, textPaint);
        textPaint.clearShadowLayer();
        textPaint.setAlpha(255);
        paint.setAlpha(255);
        paint.setStyle(Paint.Style.FILL);
    }

    @Override
    public boolean onTouchEvent(MotionEvent event) {
        // Dismiss while letting the first real gesture reach the WebView below.
        if (event != null && event.getAction() == MotionEvent.ACTION_DOWN && dismissListener != null) {
            dismissListener.onDismissRequested();
        }
        return false;
    }

    @Override
    public boolean performClick() {
        super.performClick();
        return true;
    }

    private static Bitmap loadBitmap(Context context, String path, Bitmap.Config config) {
        AssetManager assets = context.getAssets();
        try (InputStream input = assets.open(path)) {
            BitmapFactory.Options options = new BitmapFactory.Options();
            options.inPreferredConfig = config;
            options.inScaled = false;
            return BitmapFactory.decodeStream(input, null, options);
        } catch (Exception ignored) {
            return null;
        }
    }

    private void releaseBitmaps() {
        if (skyBitmap != null && !skyBitmap.isRecycled()) skyBitmap.recycle();
        if (boardBitmap != null && !boardBitmap.isRecycled()) boardBitmap.recycle();
        skyBitmap = null;
        boardBitmap = null;
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

    private static float clamp(float value) {
        return Math.max(0f, Math.min(1f, value));
    }

    private static float easeOut(float value) {
        float t = clamp(value);
        return 1f - (float) Math.pow(1f - t, 3f);
    }

}
