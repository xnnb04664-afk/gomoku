package com.gomoku.master;

import android.animation.Animator;
import android.animation.AnimatorListenerAdapter;
import android.animation.ValueAnimator;
import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.LinearGradient;
import android.graphics.Paint;
import android.graphics.RadialGradient;
import android.graphics.RectF;
import android.graphics.Shader;
import android.graphics.Typeface;
import android.os.Build;
import android.os.SystemClock;
import android.provider.Settings;
import android.util.DisplayMetrics;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.animation.LinearInterpolator;
import android.widget.FrameLayout;

/**
 * Native version of the Sky Island opening: a cached dawn scene and cloudstone
 * board, followed by a heart-shaped black-and-white stone animation.
 */
public final class GomokuSplashView extends FrameLayout {
    public interface DismissListener {
        void onDismissRequested();
    }

    public interface AnimationStartedListener {
        void onAnimationStarted(long uptimeMs);
    }

    private static final long ANIMATION_DURATION_MS = 3600L;
    private static final String SKY_ASSET = "img/startup/sky-cloudsea-v2.webp";
    private static final String BOARD_ASSET = "img/game/sky-board-cloudstone.webp";
    private static final int[] STAR_POINTS = {3, 7, 11};
    private static final float[] STONE_GRADIENT_STOPS = {0f, 0.42f, 1f};
    private static final int[] ATMOSPHERE_COLORS = {0x240b3b63, 0x020b3b63, 0x06154962, 0x37154962};
    private static final float[] ATMOSPHERE_STOPS = {0f, 0.28f, 0.63f, 1f};
    private static final Typeface TYPEFACE_MEDIUM = Typeface.create("sans-serif-medium", Typeface.NORMAL);
    private static final Typeface TYPEFACE_BOLD = Typeface.create("sans-serif", Typeface.BOLD);
    private static final int[][] STONES = {
            {2, 4}, {2, 10}, {2, 5}, {2, 9},
            {3, 3}, {3, 11}, {3, 6}, {3, 8},
            {4, 2}, {4, 12}, {4, 7},
            {5, 1}, {5, 13}, {6, 1}, {6, 13},
            {7, 2}, {7, 12}, {8, 3}, {8, 11},
            {9, 4}, {9, 10}, {10, 5}, {10, 9},
            {11, 6}, {11, 8}, {12, 7}
    };

    private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint textPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint stoneBitmapPaint = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.FILTER_BITMAP_FLAG);
    private final RectF boardRect = new RectF();
    private final RectF footerRect = new RectF();
    private final RectF skyRect = new RectF();
    private final RectF stoneRect = new RectF();
    private final boolean reducedMotion;
    private final int backgroundColor;
    private final int inkColor;
    private final int stoneLightColor;
    private final int stoneDarkColor;
    private final String splashTitle;
    private final String splashSubtitle;
    private final String splashSkipLabel;
    private final SceneLayer sceneLayer;
    private final HeartLayer heartLayer;
    private Bitmap skyBitmap;
    private Bitmap boardBitmap;
    private Bitmap blackStoneBitmap;
    private Bitmap whiteStoneBitmap;
    private Shader atmosphereShader;
    private int atmosphereShaderHeight = -1;
    private ValueAnimator animator;
    private float progress;
    private boolean showLoadingHint;
    private boolean artworkReady;
    private boolean animationRequested;
    private boolean animationStarted;
    private boolean paused;
    private volatile boolean stopped;
    private DismissListener dismissListener;
    private AnimationStartedListener animationStartedListener;
    private long animationStartedAtUptimeMs;

    public GomokuSplashView(Context context) {
        super(context);
        backgroundColor = context.getResources().getColor(R.color.splash_bg);
        inkColor = context.getResources().getColor(R.color.splash_ink);
        stoneLightColor = context.getResources().getColor(R.color.splash_stone_light);
        stoneDarkColor = context.getResources().getColor(R.color.splash_stone_dark);
        splashTitle = context.getString(R.string.splash_title);
        splashSubtitle = context.getString(R.string.splash_subtitle);
        splashSkipLabel = context.getString(R.string.splash_skip);
        reducedMotion = isReducedMotion(context);

        setClickable(true);
        setFocusable(true);
        // Show the empty-board composition immediately while large WebP files
        // decode off the UI thread.
        setBackgroundResource(R.drawable.splash_opening_poster);
        setContentDescription(context.getString(R.string.splash_content_description));
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            setElevation(2f * getResources().getDisplayMetrics().density);
        }
        textPaint.setTypeface(TYPEFACE_BOLD);

        sceneLayer = new SceneLayer(context);
        heartLayer = new HeartLayer(context);
        FrameLayout.LayoutParams fillScreen = new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT);
        addView(sceneLayer, fillScreen);
        addView(heartLayer, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        loadArtworkAsync(context.getApplicationContext(), getResources().getDisplayMetrics());
    }

    public void setDismissListener(DismissListener listener) {
        dismissListener = listener;
    }

    public void setAnimationStartedListener(AnimationStartedListener listener) {
        animationStartedListener = listener;
    }

    public long getMinimumDisplayDurationMs() {
        return reducedMotion ? 850L : ANIMATION_DURATION_MS;
    }

    public void showLoadingHint() {
        if (showLoadingHint) return;
        showLoadingHint = true;
        sceneLayer.invalidate();
    }

    public void startAnimation() {
        animationRequested = true;
        if (!artworkReady) return;
        beginAnimation();
    }

    private void beginAnimation() {
        if (!artworkReady || stopped || paused || animationStarted) return;
        animationStarted = true;
        animationStartedAtUptimeMs = SystemClock.uptimeMillis();
        if (animationStartedListener != null) {
            animationStartedListener.onAnimationStarted(animationStartedAtUptimeMs);
        }
        if (reducedMotion) {
            progress = 1f;
            heartLayer.invalidate();
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
            heartLayer.postInvalidateOnAnimation();
        });
        animator.addListener(new AnimatorListenerAdapter() {
            @Override
            public void onAnimationEnd(Animator animation) {
                progress = 1f;
                heartLayer.postInvalidateOnAnimation();
            }
        });
        animator.start();
    }

    public void pauseAnimation() {
        paused = true;
        if (animator != null && animator.isRunning() && Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT) {
            animator.pause();
        }
    }

    public void resumeAnimation() {
        paused = false;
        if (animator != null && animator.isPaused() && Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT) {
            animator.resume();
        } else if (animationRequested && artworkReady && !animationStarted) {
            beginAnimation();
        }
    }

    public void stopAnimation() {
        stopped = true;
        paused = true;
        if (animator != null) {
            animator.cancel();
            animator = null;
        }
        releaseBitmaps();
    }

    private void drawStaticScene(Canvas canvas, float width, float height, float density) {
        if (!artworkReady) {
            drawBrand(canvas, width, height, density, 1f);
            drawFooter(canvas, width, height, density);
            return;
        }
        canvas.drawColor(backgroundColor);
        drawSky(canvas, width, height);
        drawAtmosphere(canvas, width, height);
        drawBrand(canvas, width, height, density, 1f);
        drawBoard(canvas, width, height, density);
        drawFooter(canvas, width, height, density);
    }

    private void drawSky(Canvas canvas, float width, float height) {
        if (skyBitmap == null || skyBitmap.isRecycled()) return;
        float cover = Math.max(width / skyBitmap.getWidth(), height / skyBitmap.getHeight());
        // Keep the sky still while the stones move. This lets Android cache the
        // large background layer instead of repainting the full screen every frame.
        float breathingZoom = 1.025f;
        float drawWidth = skyBitmap.getWidth() * cover * breathingZoom;
        float drawHeight = skyBitmap.getHeight() * cover * breathingZoom;
        float driftX = 0f;
        float driftY = -height * 0.003f;
        skyRect.set(
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
        int shaderHeight = Math.max(1, Math.round(height));
        if (atmosphereShader == null || atmosphereShaderHeight != shaderHeight) {
            atmosphereShader = new LinearGradient(
                    0f, 0f, 0f, shaderHeight,
                    ATMOSPHERE_COLORS,
                    ATMOSPHERE_STOPS,
                    Shader.TileMode.CLAMP
            );
            atmosphereShaderHeight = shaderHeight;
        }
        paint.setStyle(Paint.Style.FILL);
        paint.setShader(atmosphereShader);
        canvas.drawRect(0f, 0f, width, height, paint);
        paint.setShader(null);
    }

    private void drawBrand(Canvas canvas, float width, float height, float density, float reveal) {
        final float centerX = width * 0.5f;
        final float kickerReveal = reveal;
        final float titleReveal = reveal;
        final float subtitleReveal = reveal;
        textPaint.setTextAlign(Paint.Align.CENTER);
        textPaint.setTypeface(TYPEFACE_MEDIUM);
        textPaint.setColor(Color.WHITE);
        textPaint.setAlpha((int) (238f * kickerReveal));
        textPaint.setTextSize(9.5f * density);
        textPaint.setShadowLayer(5f * density, 0f, 1f * density, 0x66345570);
        canvas.drawText("SKY ISLAND  ·  GOMOKU", centerX, height * 0.078f, textPaint);

        textPaint.setTypeface(TYPEFACE_BOLD);
        textPaint.setColor(0xfffffdf3);
        textPaint.setAlpha((int) (255f * titleReveal));
        textPaint.setTextSize(Math.max(30f * density, Math.min(39f * density, width * 0.105f)));
        textPaint.setShadowLayer(2f * density, 0f, 2f * density, 0x33244f62);
        canvas.drawText(splashTitle, centerX,
                height * 0.145f + (1f - titleReveal) * 14f * density, textPaint);

        textPaint.setTypeface(TYPEFACE_MEDIUM);
        textPaint.setColor(0xfff6fbf2);
        textPaint.setAlpha((int) (242f * subtitleReveal));
        textPaint.setTextSize(12.5f * density);
        textPaint.setShadowLayer(4f * density, 0f, 1f * density, 0x66345570);
        canvas.drawText(splashSubtitle, centerX, height * 0.192f, textPaint);
        textPaint.clearShadowLayer();
        textPaint.setAlpha(255);
        textPaint.setTypeface(TYPEFACE_BOLD);
    }

    private void drawBoard(Canvas canvas, float width, float height, float density) {
        float boardSide = Math.min(Math.min(width * 0.82f, height * 0.41f), 480f * density);
        float centerX = width * 0.5f;
        float centerY = height * 0.515f;
        float drawnSide = boardSide;
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
            paint.setAlpha(255);
            paint.setFilterBitmap(true);
            canvas.drawBitmap(boardBitmap, null, boardRect, paint);
            paint.setAlpha(255);
        } else {
            paint.setColor(0xff91c875);
            canvas.drawRoundRect(boardRect, 16f * density, 16f * density, paint);
        }

        drawGrid(canvas, boardRect, density);
    }

    private void drawGrid(Canvas canvas, RectF board, float density) {
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
        // The empty grid is static. Android can retain this layer's display list
        // while the transparent heart layer below redraws only the moving stones.
        paint.setShader(null);
        paint.setStyle(Paint.Style.STROKE);
        paint.setColor(0xff354c30);
        paint.setAlpha(175);
        paint.setStrokeWidth(Math.max(1f, step * 0.026f));
        for (int index = 0; index < 15; index++) {
            float x = firstX + index * step;
            float y = firstY + index * step;
            canvas.drawLine(x, firstY, x, lastY, paint);
            canvas.drawLine(firstX, y, lastX, y, paint);
        }
        paint.setStyle(Paint.Style.FILL);
        paint.setColor(0xff344b2e);
        paint.setAlpha(170);
        for (int row : STAR_POINTS) {
            for (int col : STAR_POINTS) {
                canvas.drawCircle(firstX + col * step, firstY + row * step,
                        Math.max(1.5f * density, step * 0.055f), paint);
            }
        }

        paint.setAlpha(255);
        paint.setShader(null);
        paint.setStyle(Paint.Style.FILL);
    }

    private void drawHeartStones(Canvas canvas, float animationProgress) {
        float side = boardRect.width();
        if (side <= 0f) return;
        float grassLeft = boardRect.left + side * 0.130f;
        float grassRight = boardRect.left + side * 0.869f;
        float grassTop = boardRect.top + side * 0.132f;
        float grassBottom = boardRect.top + side * 0.785f;
        float step = Math.min((grassRight - grassLeft) / 15f, (grassBottom - grassTop) / 15f);
        float firstX = (grassLeft + grassRight) * 0.5f - 7f * step;
        float firstY = grassTop + 0.5f * step;
        for (int index = 0; index < STONES.length; index++) {
            float start = 0.22f + index * 0.027f;
            float stoneProgress = clamp((animationProgress - start) / 0.09f);
            drawStone(
                    canvas,
                    firstX + STONES[index][1] * step,
                    firstY + STONES[index][0] * step,
                    step * 0.43f,
                    STONES[index][1] < 7,
                    stoneProgress
            );
        }
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
        paint.setAlpha(255);
        paint.setColor(0x55344843);
        canvas.drawOval(x - stoneRadius, y + radius * 0.16f, x + stoneRadius, y + radius * 0.88f, paint);
        Bitmap stoneBitmap = black ? blackStoneBitmap : whiteStoneBitmap;
        if (stoneBitmap == null || stoneBitmap.isRecycled()) return;
        stoneRect.set(x - stoneRadius, centerY - stoneRadius, x + stoneRadius, centerY + stoneRadius);
        stoneBitmapPaint.setAlpha((int) (255f * Math.min(1f, stoneProgress * 1.4f)));
        canvas.drawBitmap(stoneBitmap, null, stoneRect, stoneBitmapPaint);
        stoneBitmapPaint.setAlpha(255);
    }

    private void drawFooter(Canvas canvas, float width, float height, float density) {
        float centerX = width * 0.5f;
        float statusY = height - 69f * density;
        paint.setShader(null);
        paint.setStyle(Paint.Style.FILL);
        paint.setColor(0xffffdc88);
        canvas.drawCircle(centerX - 78f * density, statusY - 4f * density, 3.3f * density, paint);

        textPaint.setTextAlign(Paint.Align.CENTER);
        textPaint.setTypeface(TYPEFACE_MEDIUM);
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
        textPaint.setTypeface(TYPEFACE_BOLD);
        textPaint.setShadowLayer(3f * density, 0f, 1f * density, 0x55345570);
        canvas.drawText(splashSkipLabel, centerX, height - 27f * density, textPaint);
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

    private void loadArtworkAsync(Context context, DisplayMetrics metrics) {
        final int screenWidth = Math.max(1, metrics.widthPixels);
        final int screenHeight = Math.max(1, metrics.heightPixels);
        final float density = metrics.density;
        final int boardSide = Math.max(1, Math.round(Math.min(
                Math.min(screenWidth * 0.82f, screenHeight * 0.41f), 480f * density)));
        final int spriteSize = Math.max(96, Math.round(64f * density));
        Thread loader = new Thread(() -> {
            Bitmap loadedSky = null;
            Bitmap loadedBoard = null;
            Bitmap loadedBlack = null;
            Bitmap loadedWhite = null;
            try {
                loadedSky = loadBitmap(context, SKY_ASSET, Bitmap.Config.RGB_565,
                        screenWidth, screenHeight);
                loadedBoard = loadBitmap(context, BOARD_ASSET, Bitmap.Config.ARGB_8888,
                        boardSide, boardSide);
                loadedBlack = createStoneBitmap(spriteSize, true, stoneLightColor, stoneDarkColor);
                loadedWhite = createStoneBitmap(spriteSize, false, stoneLightColor, stoneDarkColor);
            } catch (OutOfMemoryError error) {
                android.util.Log.e("GomokuSplash", "Not enough memory to decode splash artwork", error);
            } catch (RuntimeException error) {
                android.util.Log.e("GomokuSplash", "Could not decode splash artwork", error);
            }
            final Bitmap finalSky = loadedSky;
            final Bitmap finalBoard = loadedBoard;
            final Bitmap finalBlack = loadedBlack;
            final Bitmap finalWhite = loadedWhite;
            boolean posted = post(() -> {
                if (stopped) {
                    recycle(finalSky);
                    recycle(finalBoard);
                    recycle(finalBlack);
                    recycle(finalWhite);
                    return;
                }
                if (finalSky == null || finalBoard == null || finalBlack == null || finalWhite == null) {
                    recycle(finalSky);
                    recycle(finalBoard);
                    recycle(finalBlack);
                    recycle(finalWhite);
                    android.util.Log.e("GomokuSplash", "Splash assets unavailable; keeping opening poster fallback");
                    showLoadingHint = true;
                    sceneLayer.invalidate();
                    return;
                }
                skyBitmap = finalSky;
                boardBitmap = finalBoard;
                blackStoneBitmap = finalBlack;
                whiteStoneBitmap = finalWhite;
                artworkReady = true;
                if (animationRequested && !paused) beginAnimation();
                sceneLayer.invalidate();
                heartLayer.invalidate();
            });
            if (!posted) {
                recycle(finalSky);
                recycle(finalBoard);
                recycle(finalBlack);
                recycle(finalWhite);
            }
        }, "gomoku-splash-assets");
        loader.setDaemon(true);
        loader.start();
    }

    private final class SceneLayer extends View {
        SceneLayer(Context context) {
            super(context);
            setClickable(false);
            setFocusable(false);
        }

        @Override
        protected void onDraw(Canvas canvas) {
            super.onDraw(canvas);
            drawStaticScene(canvas, getWidth(), getHeight(),
                    getResources().getDisplayMetrics().density);
        }
    }

    private final class HeartLayer extends View {
        HeartLayer(Context context) {
            super(context);
            setClickable(false);
            setFocusable(false);
        }

        @Override
        protected void onDraw(Canvas canvas) {
            super.onDraw(canvas);
            if (artworkReady) {
                drawHeartStones(canvas, progress);
            }
        }
    }

    private static Bitmap loadBitmap(Context context, String path, Bitmap.Config config,
                                     int requestedWidth, int requestedHeight) {
        try (java.io.InputStream boundsInput = context.getAssets().open(path)) {
            BitmapFactory.Options options = new BitmapFactory.Options();
            options.inJustDecodeBounds = true;
            BitmapFactory.decodeStream(boundsInput, null, options);

            int sampleSize = 1;
            // Retain sharper board texture on high-density screens; the sky can
            // still downsample, while a near-target board stays at full source size.
            while (options.outWidth / sampleSize > requestedWidth * 1.5f
                    || options.outHeight / sampleSize > requestedHeight * 1.5f) {
                sampleSize *= 2;
            }

            BitmapFactory.Options decodeOptions = new BitmapFactory.Options();
            decodeOptions.inPreferredConfig = config;
            decodeOptions.inScaled = false;
            decodeOptions.inSampleSize = sampleSize;
            try (java.io.InputStream input = context.getAssets().open(path)) {
                return BitmapFactory.decodeStream(input, null, decodeOptions);
            }
        } catch (Exception ignored) {
            return null;
        }
    }

    private static void recycle(Bitmap bitmap) {
        if (bitmap != null && !bitmap.isRecycled()) bitmap.recycle();
    }

    private void releaseBitmaps() {
        recycle(skyBitmap);
        recycle(boardBitmap);
        recycle(blackStoneBitmap);
        recycle(whiteStoneBitmap);
        skyBitmap = null;
        boardBitmap = null;
        blackStoneBitmap = null;
        whiteStoneBitmap = null;
    }

    private static Bitmap createStoneBitmap(int size, boolean black, int lightColor, int darkColor) {
        Bitmap bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(bitmap);
        Paint stonePaint = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.DITHER_FLAG);
        float center = size * 0.5f;
        float radius = center * 0.94f;
        int[] colors = black
                ? new int[]{0xff7f8c96, darkColor, 0xff07121c}
                : new int[]{0xffffffff, lightColor, 0xffa6b5bc};
        stonePaint.setShader(new RadialGradient(
                center - radius * 0.32f, center - radius * 0.38f,
                radius * 1.48f, colors, STONE_GRADIENT_STOPS, Shader.TileMode.CLAMP
        ));
        canvas.drawCircle(center, center, radius, stonePaint);
        stonePaint.setShader(null);
        if (!black) {
            stonePaint.setStyle(Paint.Style.STROKE);
            stonePaint.setColor(0x7788989f);
            stonePaint.setStrokeWidth(Math.max(1f, radius * 0.07f));
            canvas.drawCircle(center, center, radius * 0.96f, stonePaint);
        }
        stonePaint.setStyle(Paint.Style.FILL);
        stonePaint.setColor(black ? 0x66ffffff : 0xddffffff);
        canvas.drawOval(center - radius * 0.56f, center - radius * 0.70f,
                center - radius * 0.06f, center - radius * 0.37f, stonePaint);
        return bitmap;
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
        float inverse = 1f - t;
        return 1f - inverse * inverse * inverse;
    }

}
