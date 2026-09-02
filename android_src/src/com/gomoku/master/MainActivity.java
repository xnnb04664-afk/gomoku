package com.gomoku.master;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

public class MainActivity extends Activity {

    private WebView       mWebView;
    private LocalWebServer mLocalServer;
    private long          mLastBackPressTime = 0;
    private ValueCallback<Uri[]> mFilePathCallback;
    private static final int FILE_CHOOSER_REQUEST_CODE = 1001;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // 1. 无标题栏 + Window 硬件加速
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        getWindow().setFlags(
            WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED,
            WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED
        );
        getWindow().setFlags(
            WindowManager.LayoutParams.FLAG_FULLSCREEN,
            WindowManager.LayoutParams.FLAG_FULLSCREEN
        );

        // 2. 常亮防灭屏
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        // 3. Sticky Immersive 全面屏
        applyImmersiveSticky();

        mWebView = new WebView(this);
        mWebView.setBackgroundColor(Color.parseColor("#1a1a2e"));
        setContentView(mWebView);

        setupWebView();

        // 4. 启动内嵌 HTTP 服务器（localhost:8080）
        //    目的：让 WebView 从 http://localhost 加载，彻底解除 file:// 协议
        //    对 WebSocket/WebRTC DataChannel 的各类安全限制，使联机与网页版行为完全一致。
        mLocalServer = new LocalWebServer(getAssets());
        boolean serverReady = mLocalServer.startAndWait();

        if (serverReady) {
            mWebView.loadUrl("http://localhost:" + LocalWebServer.getPort() + "/index.html");
        } else {
            // 极罕见情况：服务器未能在 500ms 内就绪，回退到 file:// 并提示
            android.util.Log.w("MainActivity", "LocalWebServer not ready, falling back to file://");
            mWebView.loadUrl("file:///android_asset/index.html");
        }
    }

    private void applyImmersiveSticky() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT) {
            getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_FULLSCREEN
                | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
            );
        }
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) applyImmersiveSticky();
    }

    private void setupWebView() {
        WebSettings settings = mWebView.getSettings();

        // JavaScript 与现代 Web 核心驱动
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);

        // 渲染优先级与硬件加速
        settings.setRenderPriority(WebSettings.RenderPriority.HIGH);
        mWebView.setLayerType(View.LAYER_TYPE_HARDWARE, null);
        mWebView.setScrollBarStyle(View.SCROLLBARS_INSIDE_OVERLAY);
        mWebView.setOverScrollMode(View.OVER_SCROLL_NEVER);

        // 缓存策略
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            CookieManager.getInstance().setAcceptThirdPartyCookies(mWebView, true);
        }

        // 视口自适应（禁止缩放消除 300ms 点击延迟）
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);

        // 音频自动播放
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.JELLY_BEAN_MR1) {
            settings.setMediaPlaybackRequiresUserGesture(false);
        }

        // 文件访问（用于回退兼容）
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.JELLY_BEAN) {
            settings.setAllowFileAccessFromFileURLs(true);
            settings.setAllowUniversalAccessFromFileURLs(true);
        }

        // 页面导航保持在 WebView 内部
        mWebView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                // localhost 内的跳转保持在 WebView；外链交给系统浏览器
                if (url.startsWith("http://localhost") || url.startsWith("file://")) {
                    view.loadUrl(url);
                    return true;
                }
                return false;
            }
        });

        // WebRTC 权限自动授予 + 相册照片上传支持
        mWebView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                    runOnUiThread(() -> request.grant(request.getResources()));
                }
            }

            @Override
            public boolean onShowFileChooser(WebView webView, ValueCallback<Uri[]> filePathCallback, FileChooserParams fileChooserParams) {
                if (mFilePathCallback != null) {
                    mFilePathCallback.onReceiveValue(null);
                }
                mFilePathCallback = filePathCallback;

                Intent intent = new Intent(Intent.ACTION_GET_CONTENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("image/*");
                try {
                    startActivityForResult(Intent.createChooser(intent, "选择头像照片"), FILE_CHOOSER_REQUEST_CODE);
                    return true;
                } catch (Exception e) {
                    mFilePathCallback = null;
                    return false;
                }
            }
        });
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == FILE_CHOOSER_REQUEST_CODE) {
            if (mFilePathCallback != null) {
                Uri[] results = null;
                if (resultCode == RESULT_OK && data != null) {
                    Uri dataUri = data.getData();
                    if (dataUri != null) {
                        results = new Uri[]{ dataUri };
                    } else if (data.getClipData() != null && data.getClipData().getItemCount() > 0) {
                        results = new Uri[]{ data.getClipData().getItemAt(0).getUri() };
                    }
                }
                mFilePathCallback.onReceiveValue(results);
                mFilePathCallback = null;
            }
        }
    }


    @Override
    public void onBackPressed() {
        long now = System.currentTimeMillis();
        if (now - mLastBackPressTime < 2000) {
            super.onBackPressed();
        } else {
            mLastBackPressTime = now;
            Toast.makeText(this, "再按一次退出游戏", Toast.LENGTH_SHORT).show();
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (mWebView != null) {
            mWebView.onResume();
            mWebView.resumeTimers();
        }
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (mWebView != null) {
            mWebView.onPause();
            mWebView.pauseTimers();
        }
    }

    @Override
    protected void onDestroy() {
        if (mFilePathCallback != null) {
            mFilePathCallback.onReceiveValue(null);
            mFilePathCallback = null;
        }
        // 停止本地服务器
        if (mLocalServer != null) {
            mLocalServer.stopServer();
            mLocalServer = null;
        }
        // 安全销毁 WebView
        if (mWebView != null) {
            ViewGroup parent = (ViewGroup) mWebView.getParent();
            if (parent != null) parent.removeView(mWebView);
            mWebView.stopLoading();
            mWebView.clearHistory();
            mWebView.removeAllViews();
            mWebView.destroy();
            mWebView = null;
        }
        super.onDestroy();
    }
}
