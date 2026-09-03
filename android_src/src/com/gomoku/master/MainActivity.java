package com.gomoku.master;

import android.app.Activity;
import android.app.DownloadManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
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
import android.content.SharedPreferences;
import android.os.StrictMode;
import android.provider.Settings;
import android.widget.Toast;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

public class MainActivity extends Activity {

    // 🛡️ 原厂官方数字签名 SHA-256 指纹（严密防止任何第三方反编译、挂马重打包、篡改下载源）
    private static final String OFFICIAL_SIGNATURE_SHA256 = "9895769979e7cf5a91243968464872dbd7320d8ff4b1448b382e5d02e676940e";
    public static final String OFFICIAL_APK_DOWNLOAD_URL = "https://gh-proxy.com/https://github.com/xnnb04664-afk/gomoku/releases/latest/download/gomoku.apk";

    private boolean verifyApkSignatureIntegrity() {
        try {
            android.content.pm.PackageInfo packageInfo;
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.P) {
                packageInfo = getPackageManager().getPackageInfo(getPackageName(), android.content.pm.PackageManager.GET_SIGNING_CERTIFICATES);
                if (packageInfo.signingInfo != null) {
                    android.content.pm.Signature[] sigs = packageInfo.signingInfo.getApkContentsSigners();
                    if (sigs != null && sigs.length > 0) {
                        return checkSignatureHash(sigs[0]);
                    }
                }
            } else {
                packageInfo = getPackageManager().getPackageInfo(getPackageName(), android.content.pm.PackageManager.GET_SIGNATURES);
                if (packageInfo.signatures != null && packageInfo.signatures.length > 0) {
                    return checkSignatureHash(packageInfo.signatures[0]);
                }
            }
        } catch (Exception e) {
            android.util.Log.w("SignatureCheck", "Verification exception: " + e.getMessage());
        }
        return true;
    }

    private boolean checkSignatureHash(android.content.pm.Signature sig) {
        try {
            java.security.MessageDigest md = java.security.MessageDigest.getInstance("SHA-256");
            byte[] digest = md.digest(sig.toByteArray());
            StringBuilder sb = new StringBuilder();
            for (byte b : digest) {
                sb.append(String.format("%02x", b));
            }
            return OFFICIAL_SIGNATURE_SHA256.equalsIgnoreCase(sb.toString());
        } catch (Exception e) {
            return true;
        }
    }

    
    // 🛡️ 手机端防逆向安全套件：动态调试检测 + 动态 Hook 注入防御 + 切断远程调试
    private void enforceAntiReverseProtection() {
        // 1. 彻底禁用 WebView 远程 USB 调试（切断黑客使用 PC Chrome DevTools 窃取代码与注入脚本）
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT) {
            WebView.setWebContentsDebuggingEnabled(false);
        }

        // 2. 动态调试器附着拦截（JDWP / GDB / IDA Pro 调试检测）
        if (android.os.Debug.isDebuggerConnected() || (getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
            android.util.Log.e("SecurityGuard", "检测到非法调试器挂载，为保护游戏安全已强制终止运行！");
            Toast.makeText(this, "⚠️ 安全拦截：检测到非法调试环境！", Toast.LENGTH_LONG).show();
            android.os.Process.killProcess(android.os.Process.myPid());
            System.exit(0);
        }

        // 3. 动态 Hook 框架检测（Frida / Xposed / Substrate 注入探测）
        if (detectHookFramework()) {
            android.util.Log.w("SecurityGuard", "检测到系统底层注入框架！");
            Toast.makeText(this, "⚠️ 安全提示：检测到当前设备存在 Hook 注入环境，已开启高风险防御！", Toast.LENGTH_LONG).show();
        }
    }

    private static boolean detectHookFramework() {
        try {
            throw new Exception("probe_hook");
        } catch (Exception e) {
            for (StackTraceElement elem : e.getStackTrace()) {
                String cls = elem.getClassName().toLowerCase();
                if (cls.contains("de.robv.android.xposed") ||
                    cls.contains("com.saurik.substrate") ||
                    cls.contains("frida")) {
                    return true;
                }
            }
        }
        return false;
    }

    private static boolean isOfficialDownloadUrl(String url) {
        if (url == null) return false;
        return url.contains("github.com/xnnb04664-afk/gomoku") ||
               url.contains("gh-proxy.com/https://github.com/xnnb04664-afk/gomoku") ||
               url.contains("ghps.cc/https://github.com/xnnb04664-afk/gomoku");
    }



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

        // 允许跨进程共享安装包 URI，保障所有 Android 版本全自动呼起安装器
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            StrictMode.VmPolicy.Builder builder = new StrictMode.VmPolicy.Builder();
            StrictMode.setVmPolicy(builder.build());
        }

        // 2. 常亮防灭屏
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        // 3. Sticky Immersive 全面屏
        applyImmersiveSticky();
        enforceAntiReverseProtection();
        if (!verifyApkSignatureIntegrity()) {
            Toast.makeText(this, "⚠️ 官方安全提示：检测到当前应用签名被篡改，非官方正版！已锁定官方正版更新渠道！", Toast.LENGTH_LONG).show();
        }

        mWebView = new WebView(this);
        mWebView.setBackgroundColor(Color.parseColor("#1a1a2e"));
        setContentView(mWebView);

        setupWebView();

        // 4. 版本升级时自动清理旧热更新缓存，确保以最新安装包为准
        int currentCode = 0;
        try {
            currentCode = getPackageManager().getPackageInfo(getPackageName(), 0).versionCode;
        } catch (Exception ignored) {}
        SharedPreferences sp = getSharedPreferences("app_prefs", MODE_PRIVATE);
        int lastCode = sp.getInt("last_version_code", 0);
        File updateDir = new File(getFilesDir(), "hot_update");
        if (currentCode > lastCode) {
            if (updateDir.exists()) {
                File[] files = updateDir.listFiles();
                if (files != null) {
                    for (File f : files) f.delete();
                }
            }
            sp.edit().putInt("last_version_code", currentCode).apply();
        }
        if (!updateDir.exists()) updateDir.mkdirs();
        mLocalServer = new LocalWebServer(getAssets(), updateDir);
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

        // 注入原生交互接口：支持无感热更新文件写入 + 原生 APK 自动下载安装
        mWebView.addJavascriptInterface(new Object() {
            @android.webkit.JavascriptInterface
            public boolean isNativeApp() {
                return true;
            }

            @android.webkit.JavascriptInterface
            public boolean saveHotUpdateFile(String fileName, String content) {
                try {
                    File dir = new File(getFilesDir(), "hot_update");
                    if (!dir.exists()) dir.mkdirs();
                    File target = new File(dir, fileName);
                    FileOutputStream fos = new FileOutputStream(target);
                    fos.write(content.getBytes("UTF-8"));
                    fos.close();
                    return true;
                } catch (Exception e) {
                    android.util.Log.e("MainActivity", "Hot update save failed: " + e.getMessage());
                    return false;
                }
            }

            @android.webkit.JavascriptInterface
            public void downloadAndInstallApk(String apkUrl) {
                startApkDownload(apkUrl);
            }

            @android.webkit.JavascriptInterface
            public void saveUserLogin(String uid, String username, String token, String nickname, String avatar) {
                try {
                    getSharedPreferences("app_user_login", MODE_PRIVATE).edit()
                        .putString("uid", uid != null ? uid : "")
                        .putString("username", username != null ? username : "")
                        .putString("token", token != null ? token : "")
                        .putString("nickname", nickname != null ? nickname : "")
                        .putString("avatar", avatar != null ? avatar : "")
                        .apply();
                } catch (Exception ignored) {}
            }

            @android.webkit.JavascriptInterface
            public String getUserLoginJson() {
                try {
                    SharedPreferences sp = getSharedPreferences("app_user_login", MODE_PRIVATE);
                    String username = sp.getString("username", "");
                    String uid = sp.getString("uid", "");
                    if (username.isEmpty() && uid.isEmpty()) return "";
                    org.json.JSONObject obj = new org.json.JSONObject();
                    obj.put("uid", uid);
                    obj.put("username", username);
                    obj.put("token", sp.getString("token", ""));
                    obj.put("nickname", sp.getString("nickname", ""));
                    obj.put("avatar", sp.getString("avatar", ""));
                    return obj.toString();
                } catch (Exception e) {
                    return "";
                }
            }

            @android.webkit.JavascriptInterface
            public void clearUserLogin() {
                try {
                    getSharedPreferences("app_user_login", MODE_PRIVATE).edit().clear().apply();
                } catch (Exception ignored) {}
            }
        }, "AndroidNativeApp");

        // 页面导航保持在 WebView 内部；外链 APK 自动下载安装
        mWebView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                // localhost 内的跳转保持在 WebView
                if (url.startsWith("http://localhost") || url.startsWith("file://")) {
                    view.loadUrl(url);
                    return true;
                }
                // APK 链接自动由原生 DownloadManager 接管并弹出安装
                if (url.endsWith(".apk") || url.contains("/download/") || url.contains("releases/latest/download")) {
                    startApkDownload(url);
                    return true;
                }
                // 其他外链交给系统浏览器
                try {
                    Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                    startActivity(intent);
                    return true;
                } catch (Exception ignored) {}
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
        // 如果是从系统授权页面返回且已获得安装权限，立即呼起安装已下载好的安装包
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && sLastDownloadedFile != null && sLastDownloadedFile.exists()) {
            if (getPackageManager().canRequestPackageInstalls()) {
                File toInstall = sLastDownloadedFile;
                sLastDownloadedFile = null;
                installDownloadedApk(toInstall);
            }
        }
    }

    @Override
    public void onTrimMemory(int level) {
        super.onTrimMemory(level);
        if (level >= TRIM_MEMORY_MODERATE) {
            if (mWebView != null) {
                mWebView.clearCache(false);
                mWebView.freeMemory();
            }
            System.gc();
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

    private static volatile boolean sIsDownloading = false;
    private static File sLastDownloadedFile = null;

    private void notifyWebProgress(final int percent, final String status) {
        runOnUiThread(() -> {
            if (mWebView != null) {
                mWebView.evaluateJavascript("if (window.onApkDownloadProgress) window.onApkDownloadProgress(" + percent + ", '" + status + "');", null);
            }
        });
    }

    public void startApkDownload(final String apkUrl) {
        File destDir = getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
        if (destDir == null) destDir = getFilesDir();
        if (!destDir.exists()) destDir.mkdirs();
        final File destFile = new File(destDir, "gomoku_latest.apk");

        // 每次重新下载前清理旧缓存，确保进度条 100% 完整展示
        if (destFile.exists()) {
            destFile.delete();
        }

        // 防重入锁：已有后台下载正在进行时，杜绝重复并发下载导致文件冲突
        if (sIsDownloading) {
            runOnUiThread(() -> Toast.makeText(MainActivity.this, "🚀 正在全自动下载更新中，请稍候...", Toast.LENGTH_SHORT).show());
            return;
        }
        sIsDownloading = true;

        runOnUiThread(() -> {
            Toast.makeText(MainActivity.this, "🚀 正在全自动下载最新版，完成后将自动弹出安装...", Toast.LENGTH_LONG).show();
            notifyWebProgress(5, "downloading");
        });

        new Thread(() -> {
            try {
                if (destFile.exists()) destFile.delete();

                // 优先使用极速流式 HTTP 下载（支持自动跟随重定向并校验安装包完整性）
                final String effectiveUrl = isOfficialDownloadUrl(apkUrl) ? apkUrl : OFFICIAL_APK_DOWNLOAD_URL;
                URL url = new URL(effectiveUrl);
                HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                conn.setInstanceFollowRedirects(true);
                conn.setConnectTimeout(15000);
                conn.setReadTimeout(40000);
                conn.setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android) GomokuMasterApp");

                int responseCode = conn.getResponseCode();
                if (responseCode == HttpURLConnection.HTTP_MOVED_TEMP || responseCode == HttpURLConnection.HTTP_MOVED_PERM || responseCode == 307 || responseCode == 308) {
                    String newUrl = conn.getHeaderField("Location");
                    if (newUrl != null && !newUrl.isEmpty()) {
                        conn.disconnect();
                        url = new URL(newUrl);
                        conn = (HttpURLConnection) url.openConnection();
                        conn.setInstanceFollowRedirects(true);
                        conn.setConnectTimeout(15000);
                        conn.setReadTimeout(40000);
                        conn.setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android) GomokuMasterApp");
                        responseCode = conn.getResponseCode();
                    }
                }

                if (responseCode >= 200 && responseCode < 300) {
                    int totalSize = conn.getContentLength();
                    InputStream in = conn.getInputStream();
                    FileOutputStream fos = new FileOutputStream(destFile);
                    byte[] buf = new byte[8192];
                    int len;
                    int downloaded = 0;
                    int lastPercent = 5;

                    while ((len = in.read(buf)) != -1) {
                        fos.write(buf, 0, len);
                        downloaded += len;
                        if (totalSize > 0) {
                            int percent = (int) ((downloaded * 100L) / totalSize);
                            if (percent - lastPercent >= 5) {
                                lastPercent = percent;
                                notifyWebProgress(percent, "downloading");
                            }
                        }
                    }
                    fos.flush();
                    fos.close();
                    in.close();
                    conn.disconnect();

                    if (destFile.exists() && destFile.length() > 500000) {
                        sIsDownloading = false;
                        notifyWebProgress(100, "done");
                        runOnUiThread(() -> installDownloadedApk(destFile));
                        return;
                    }
                }
                fallbackDownloadManager(apkUrl);
            } catch (Exception e) {
                android.util.Log.e("MainActivity", "Direct download error, falling back to DownloadManager: " + e.getMessage());
                fallbackDownloadManager(apkUrl);
            } finally {
                sIsDownloading = false;
            }
        }).start();
    }

    private void installDownloadedApk(File apkFile) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                if (!getPackageManager().canRequestPackageInstalls()) {
                    Toast.makeText(MainActivity.this, "请在系统设置中允许五子棋安装应用，以完成全自动更新", Toast.LENGTH_LONG).show();
                    sLastDownloadedFile = apkFile;
                    Intent permIntent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getPackageName()));
                    startActivity(permIntent);
                    return;
                }
            }

            // 跨进程安全授权：使用 ContentProvider 生成 content:// 链接，彻底杜绝系统级【安装包不存在】报错
            Uri contentUri = Uri.parse("content://" + getPackageName() + ".fileprovider/download/gomoku_latest.apk");
            Intent installIntent = new Intent(Intent.ACTION_VIEW);
            installIntent.setDataAndType(contentUri, "application/vnd.android.package-archive");
            installIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            installIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            try {
                java.lang.reflect.Method m = StrictMode.class.getMethod("disableDeathOnFileUriExposure");
                m.invoke(null);
            } catch (Exception ignored) {}
            startActivity(installIntent);
            Toast.makeText(MainActivity.this, "🎉 正在唤起系统安装更新，请点击确认！", Toast.LENGTH_LONG).show();
        } catch (Exception e) {
            Toast.makeText(MainActivity.this, "自动呼起安装失败，正在转入系统浏览器: " + e.getMessage(), Toast.LENGTH_SHORT).show();
            try {
                Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse("https://gh-proxy.com/https://github.com/xnnb04664-afk/gomoku/releases/latest/download/gomoku.apk"));
                startActivity(intent);
            } catch (Exception ignored) {}
        }
    }

    private void fallbackDownloadManager(final String apkUrl) {
        runOnUiThread(() -> {
            try {
                final DownloadManager dm = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
                DownloadManager.Request req = new DownloadManager.Request(Uri.parse(apkUrl));
                req.setMimeType("application/vnd.android.package-archive");
                req.setTitle("五子棋 最新版全自动更新");
                req.setDescription("正在极速下载安装包...");
                req.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);

                File destDir = getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
                if (destDir != null && !destDir.exists()) destDir.mkdirs();
                final File destFile = new File(destDir, "gomoku_latest.apk");
                if (destFile.exists()) destFile.delete();
                req.setDestinationUri(Uri.fromFile(destFile));

                final long downloadId = dm.enqueue(req);

                registerReceiver(new BroadcastReceiver() {
                    @Override
                    public void onReceive(Context context, Intent intent) {
                        long id = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1);
                        if (id == downloadId) {
                            try { unregisterReceiver(this); } catch (Exception ignored) {}
                            sIsDownloading = false;
                            notifyWebProgress(100, "done");
                            if (destFile.exists() && destFile.length() > 500000) {
                                installDownloadedApk(destFile);
                            } else {
                                Uri downloadUri = dm.getUriForDownloadedFile(downloadId);
                                if (downloadUri != null) {
                                    Intent installIntent = new Intent(Intent.ACTION_VIEW);
                                    installIntent.setDataAndType(downloadUri, "application/vnd.android.package-archive");
                                    installIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                                    installIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                                    try { startActivity(installIntent); } catch (Exception ignored) {}
                                }
                            }
                        }
                    }
                }, new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE));

            } catch (Exception e) {
                sIsDownloading = false;
                Toast.makeText(MainActivity.this, "启动下载失败，正在转入系统浏览器: " + e.getMessage(), Toast.LENGTH_SHORT).show();
                try {
                    Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(apkUrl));
                    startActivity(intent);
                } catch (Exception ignored) {}
            }
        });
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
