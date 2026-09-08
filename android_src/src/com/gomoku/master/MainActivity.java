package com.gomoku.master;

import android.app.Activity;
import android.app.DownloadManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.graphics.Color;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.NetworkRequest;
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
import android.provider.Settings;
import android.widget.Toast;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;

public class MainActivity extends Activity {

    // 🛡️ 原厂官方数字签名 SHA-256 指纹（严密防止第三方重打包）
    private static final String OFFICIAL_SIGNATURE_SHA256 = "9895769979e7cf5a91243968464872dbd7320d8ff4b1448b382e5d02e676940e";
    // 客户端只保留 Cloudflare 中转出口；仓库地址和 GitHub 直链不进入 APK。
    private static final String UPDATE_PROXY_HOST = "gomoku-api.pages.dev";
    private static final String UPDATE_PROXY_VERSION_URL = "https://gomoku-api.pages.dev/api/version";
    private static final String UPDATE_PROXY_APK_URL = "https://gomoku-api.pages.dev/api/update/apk";
    private static final String UPDATE_PROXY_VERSION_PATH = "/api/version";
    private static final String UPDATE_PROXY_APK_PATH = "/api/update/apk";
    private static final String UPDATE_CLIENT_HEADER = "X-Gomoku-Client";
    private static final String UPDATE_CLIENT_HEADER_VALUE = "gomoku-app-client-v2";
    private static final String UPDATE_TICKET_HEADER = "X-Gomoku-Update-Ticket";
    private static final int MAX_APK_BYTES = 50 * 1024 * 1024;
    private static volatile String sExpectedApkSha256 = null;

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
        return false;
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
            return false;
        }
    }

    
    // 🛡️ 手机端防逆向安全套件：动态调试检测 + 动态 Hook 注入防御 + 切断远程调试
    private boolean enforceAntiReverseProtection() {
        // 1. 发布包彻底禁用 WebView 远程 USB 调试，避免运行时读取页面与会话数据。
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT) {
            WebView.setWebContentsDebuggingEnabled(false);
        }

        // 2. 动态调试器附着拦截（JDWP / GDB / IDA Pro 调试检测）
        if (android.os.Debug.isDebuggerConnected()
                || android.os.Debug.waitingForDebugger()
                || (getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
            android.util.Log.e("SecurityGuard", "检测到非法调试器挂载，阻止应用启动");
            showSecurityFailureDialog("应用运行异常", "检测到调试环境，应用无法继续运行。\n请安装未被修改的官方版本。\n错误码：DEBUG_ENV");
            return true;
        }

        // 3. 动态 Hook 框架检测（Frida / Xposed / Substrate 注入探测）
        if (detectHookFramework()) {
            android.util.Log.e("SecurityGuard", "检测到系统底层注入框架，阻止应用启动");
            showSecurityFailureDialog("应用运行异常", "检测到应用运行环境被修改或注入，应用无法继续运行。\n请关闭调试/注入工具后重新启动。\n错误码：HOOK_ENV");
            return true;
        }
        return false;
    }

    private void showSecurityFailureDialog(String title, String message) {
        try {
            new android.app.AlertDialog.Builder(this)
                    .setTitle(title)
                    .setMessage(message)
                    .setCancelable(false)
                    .setPositiveButton("退出应用", (dialog, which) -> terminateApplication())
                    .show();
        } catch (Exception error) {
            android.util.Log.e("SecurityGuard", "无法显示安全提示", error);
            Toast.makeText(this, message, Toast.LENGTH_LONG).show();
            finish();
        }
    }

    private void terminateApplication() {
        try {
            finishAndRemoveTask();
        } catch (Exception ignored) {
            finish();
        }
        android.os.Process.killProcess(android.os.Process.myPid());
        System.exit(0);
    }

    private static boolean detectHookFramework() {
        // 已加载的 Java Hook 框架类：仅命中明确框架类名时才拦截，避免把普通 Root 设备误判。
        String[] suspiciousClasses = {
                "de.robv.android.xposed.XposedBridge",
                "de.robv.android.xposed.XposedHelpers",
                "com.saurik.substrate.MS",
                "com.saurik.substrate.MSC"
        };
        for (String className : suspiciousClasses) {
            try {
                Class.forName(className, false, MainActivity.class.getClassLoader());
                return true;
            } catch (Throwable ignored) {}
        }

        // Frida/Gum 等通常以 native 库形式注入；扫描当前进程映射表中的明确特征名。
        try (java.io.BufferedReader reader = new java.io.BufferedReader(new java.io.FileReader("/proc/self/maps"))) {
            String line;
            while ((line = reader.readLine()) != null) {
                String lower = line.toLowerCase();
                if (lower.contains("frida") || lower.contains("gum-js-loop")
                        || lower.contains("xposed") || lower.contains("substrate")) {
                    return true;
                }
            }
        } catch (Exception ignored) {}

        // 某些注入框架只会在调用栈中留下特征类名。
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

    private WebView       mWebView;
    private LocalWebServer mLocalServer;
    private long          mLastBackPressTime = 0;
    private ValueCallback<Uri[]> mFilePathCallback;
    private static final int FILE_CHOOSER_REQUEST_CODE = 1001;
    private static final int CHAT_EXPORT_REQUEST_CODE = 1002;
    private String mPendingChatExportContent;
    private ConnectivityManager mConnectivityManager;
    private ConnectivityManager.NetworkCallback mNetworkCallback;
    private long mNetworkEventSequence = 0L;

    private void registerNetworkMonitor() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.LOLLIPOP) return;
        try {
            mConnectivityManager = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
            if (mConnectivityManager == null) return;
            NetworkRequest request = new NetworkRequest.Builder()
                    .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                    .build();
            mNetworkCallback = new ConnectivityManager.NetworkCallback() {
                @Override
                public void onAvailable(Network network) {
                    notifyWebNetworkChanged("network_available");
                }

                @Override
                public void onLost(Network network) {
                    notifyWebNetworkChanged("network_lost");
                }

                @Override
                public void onCapabilitiesChanged(Network network, NetworkCapabilities capabilities) {
                    notifyWebNetworkChanged("network_capabilities_changed");
                }
            };
            mConnectivityManager.registerNetworkCallback(request, mNetworkCallback);
        } catch (Exception e) {
            android.util.Log.w("MainActivity", "Network monitor unavailable: " + e.getMessage());
            mNetworkCallback = null;
        }
    }

    private void unregisterNetworkMonitor() {
        if (mConnectivityManager == null || mNetworkCallback == null) return;
        try {
            mConnectivityManager.unregisterNetworkCallback(mNetworkCallback);
        } catch (Exception ignored) {}
        mNetworkCallback = null;
        mConnectivityManager = null;
    }

    private void notifyWebNetworkChanged(final String reason) {
        final long sequence = ++mNetworkEventSequence;
        runOnUiThread(() -> {
            if (mWebView == null) return;
            String safeReason = org.json.JSONObject.quote(reason == null ? "network_changed" : reason);
            String safeSequence = org.json.JSONObject.quote("android-network-" + sequence);
            mWebView.evaluateJavascript(
                    "if (window.__gomokuNativeNetworkChanged) window.__gomokuNativeNetworkChanged(" +
                            safeReason + "," + safeSequence + ");", null);
        });
    }

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
        unlockHighRefreshRate();
        try {
            if (enforceAntiReverseProtection()) {
                return;
            }
            if (!verifyApkSignatureIntegrity()) {
                showSecurityFailureDialog("应用运行异常", "检测到应用签名异常，可能是 APK 被修改或重新打包。\n请重新安装官方版本。\n错误码：SIGNATURE_INVALID");
                return;
            }
        } catch (Exception e) {
            android.util.Log.e("MainActivity", "Security check failed; refusing to start", e);
            showSecurityFailureDialog("应用运行异常", "安全校验失败，应用无法继续运行。\n错误码：SECURITY_CHECK_FAILED");
            return;
        }

        // 4. 版本升级时自动清理旧热更新缓存，确保以最新安装包为准
        int currentCode = 0;
        try {
            currentCode = getPackageManager().getPackageInfo(getPackageName(), 0).versionCode;
        } catch (Exception ignored) {}
        SharedPreferences sp = getSharedPreferences("app_prefs", MODE_PRIVATE);
        int lastCode = sp.getInt("last_version_code", 0);
        File updateDir = new File(getFilesDir(), "hot_update");
        // 🌟 仅当真正安装了更高版本号的原生 APK 时，才清理热更新沙盒，避免日常热更新在冷启动后被误删
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

        // 先在后台绑定本地端口，再创建 WebView；两段初始化并行，避免冷启动白屏时额外等待 500ms。
        mLocalServer.startAsync();

        mWebView = new WebView(this);
        // 使用浅色首屏底色，避免 WebView 冷启动期间整屏显示深蓝空白。
        mWebView.setBackgroundColor(Color.parseColor("#eef8ff"));
        setContentView(mWebView);

        setupWebView();
        registerNetworkMonitor();

        // WebView 初始化期间通常已经完成端口绑定；仅保留 120ms 极端兜底等待。
        boolean serverReady = mLocalServer.awaitReady(120);

        if (serverReady) {
            mWebView.loadUrl("http://localhost:" + LocalWebServer.getPort() + "/index.html");
        } else {
            // 极罕见情况：服务器未能及时就绪，回退到 file:// 并提示
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

    private void unlockHighRefreshRate() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            try {
                android.view.Display display = getDisplay();
                if (display != null) {
                    android.view.Display.Mode[] modes = display.getSupportedModes();
                    android.view.Display.Mode maxMode = null;
                    float maxRate = 60.0f;
                    for (android.view.Display.Mode m : modes) {
                        if (m.getRefreshRate() > maxRate) {
                            maxRate = m.getRefreshRate();
                            maxMode = m;
                        }
                    }
                    if (maxMode != null) {
                        WindowManager.LayoutParams lp = getWindow().getAttributes();
                        lp.preferredDisplayModeId = maxMode.getModeId();
                        getWindow().setAttributes(lp);
                    }
                }
            } catch (Exception ignored) {}
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            try {
                WindowManager.LayoutParams lp = getWindow().getAttributes();
                android.view.Display.Mode[] modes = getWindowManager().getDefaultDisplay().getSupportedModes();
                float maxRate = 60.0f;
                int bestModeId = 0;
                for (android.view.Display.Mode m : modes) {
                    if (m.getRefreshRate() > maxRate) {
                        maxRate = m.getRefreshRate();
                        bestModeId = m.getModeId();
                    }
                }
                if (bestModeId != 0) {
                    lp.preferredDisplayModeId = bestModeId;
                    getWindow().setAttributes(lp);
                }
            } catch (Exception ignored) {}
        }
    }

    private static String getMimeTypeFromPath(String path) {
        if (path.endsWith(".html") || path.endsWith(".htm")) return "text/html";
        if (path.endsWith(".js") || path.endsWith(".mjs")) return "application/javascript";
        if (path.endsWith(".css")) return "text/css";
        if (path.endsWith(".json")) return "application/json";
        if (path.endsWith(".png")) return "image/png";
        if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return "image/jpeg";
        if (path.endsWith(".webp")) return "image/webp";
        if (path.endsWith(".svg")) return "image/svg+xml";
        if (path.endsWith(".mp3")) return "audio/mpeg";
        if (path.endsWith(".wav")) return "audio/wav";
        return "application/octet-stream";
    }

    private static boolean isTrustedLocalUrl(Uri uri) {
        if (uri == null || uri.getUserInfo() != null) return false;
        String scheme = uri.getScheme();
        if ("file".equalsIgnoreCase(scheme)) {
            String host = uri.getHost();
            String path = uri.getPath();
            // 只允许本应用的固定 APK asset 入口，拒绝任意 file:/// 本地路径导航。
            return (host == null || host.isEmpty())
                    && ("/android_asset/index.html".equals(path));
        }
        if (!"http".equalsIgnoreCase(scheme)) return false;
        String host = uri.getHost();
        return ("localhost".equalsIgnoreCase(host) || "127.0.0.1".equals(host) || "::1".equals(host))
                && uri.getPort() == LocalWebServer.getPort();
    }

    private static boolean isTrustedApkUrl(Uri uri) {
        return uri != null
                && "https".equalsIgnoreCase(uri.getScheme())
                && UPDATE_PROXY_HOST.equalsIgnoreCase(uri.getHost())
                && uri.getUserInfo() == null
                && (uri.getPort() == -1 || uri.getPort() == 443)
                && UPDATE_PROXY_APK_PATH.equals(uri.getPath());
    }

    private boolean handleWebViewNavigation(WebView view, Uri uri) {
        if (isTrustedLocalUrl(uri)) {
            // 返回 false 让 WebView 自己加载可信本地页面，避免重复触发导航回调。
            return false;
        }
        if (isTrustedApkUrl(uri)) {
            // 不能通过地址栏或普通导航绕过应用内短时票据。
            Toast.makeText(MainActivity.this, "请从应用内更新入口操作", Toast.LENGTH_SHORT).show();
            return true;
        }
        if (uri == null || (!"http".equalsIgnoreCase(uri.getScheme()) && !"https".equalsIgnoreCase(uri.getScheme()))) {
            // javascript:, data:, intent: 等协议一律不交给 WebView 执行。
            return true;
        }
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri));
        } catch (Exception ignored) {
        }
        // 外部页面交给系统浏览器；即使设备没有浏览器，也不让它回流到带原生桥的 WebView。
        return true;
    }

    private static boolean isRedirectResponse(int responseCode) {
        return responseCode == HttpURLConnection.HTTP_MOVED_PERM
                || responseCode == HttpURLConnection.HTTP_MOVED_TEMP
                || responseCode == HttpURLConnection.HTTP_SEE_OTHER
                || responseCode == 307 || responseCode == 308;
    }

    private static boolean isTrustedUpdateUrl(URL url, String expectedPath) {
        return url != null
                && "https".equalsIgnoreCase(url.getProtocol())
                && UPDATE_PROXY_HOST.equalsIgnoreCase(url.getHost())
                && (url.getPort() == -1 || url.getPort() == 443)
                && url.getUserInfo() == null
                && expectedPath.equals(url.getPath());
    }

    private HttpURLConnection openTrustedConnection(String rawUrl, String expectedPath) throws Exception {
        return openTrustedConnection(rawUrl, expectedPath, "");
    }

    private HttpURLConnection openTrustedConnection(String rawUrl, String expectedPath, String updateTicket) throws Exception {
        String cleanTicket = updateTicket == null ? "" : updateTicket.trim();
        if (UPDATE_PROXY_APK_PATH.equals(expectedPath) && cleanTicket.isEmpty()) {
            throw new SecurityException("缺少更新下载授权");
        }
        URL current = new URL(rawUrl);
        for (int redirectCount = 0; redirectCount <= 3; redirectCount++) {
            if (!isTrustedUpdateUrl(current, expectedPath)) {
                throw new SecurityException("拒绝连接非官方更新地址");
            }
            HttpURLConnection connection = (HttpURLConnection) current.openConnection();
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(15000);
            connection.setReadTimeout(40000);
            connection.setRequestProperty("User-Agent", "GomokuMasterApp/1");
            connection.setRequestProperty(UPDATE_CLIENT_HEADER, UPDATE_CLIENT_HEADER_VALUE);
            if (UPDATE_PROXY_APK_PATH.equals(expectedPath)) {
                connection.setRequestProperty(UPDATE_TICKET_HEADER, cleanTicket);
            }
            int responseCode = connection.getResponseCode();
            if (!isRedirectResponse(responseCode)) return connection;
            if (redirectCount == 3) {
                connection.disconnect();
                throw new SecurityException("更新地址重定向次数过多");
            }
            String location = connection.getHeaderField("Location");
            connection.disconnect();
            if (location == null || location.trim().isEmpty()) {
                throw new SecurityException("更新服务返回了无效重定向");
            }
            current = new URL(current, location.trim());
        }
        throw new SecurityException("更新地址解析失败");
    }

    private static String readLimitedText(InputStream input, int maxBytes) throws Exception {
        java.io.ByteArrayOutputStream output = new java.io.ByteArrayOutputStream();
        byte[] buffer = new byte[4096];
        int total = 0;
        int len;
        while ((len = input.read(buffer)) != -1) {
            total += len;
            if (total > maxBytes) throw new SecurityException("更新元数据过大");
            output.write(buffer, 0, len);
        }
        return output.toString("UTF-8");
    }

    private String fetchExpectedApkSha256() throws Exception {
        HttpURLConnection connection = null;
        try {
            connection = openTrustedConnection(UPDATE_PROXY_VERSION_URL, UPDATE_PROXY_VERSION_PATH);
            int responseCode = connection.getResponseCode();
            if (responseCode < 200 || responseCode >= 300) throw new SecurityException("版本接口不可用");
            try (InputStream input = connection.getInputStream()) {
                String raw = readLimitedText(input, 64 * 1024);
                org.json.JSONObject json = new org.json.JSONObject(raw);
                if (json.optInt("code", -1) != 0) throw new SecurityException("版本接口未返回成功状态");
                String digest = json.optString("apkSha256", "").trim();
                if (!digest.matches("(?i)[0-9a-f]{64}")) throw new SecurityException("版本接口缺少有效 APK 摘要");
                return digest;
            }
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private static String sha256File(File file) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (InputStream input = new FileInputStream(file)) {
            byte[] buffer = new byte[8192];
            int len;
            while ((len = input.read(buffer)) != -1) digest.update(buffer, 0, len);
        }
        byte[] bytes = digest.digest();
        StringBuilder result = new StringBuilder(bytes.length * 2);
        for (byte value : bytes) {
            String hex = Integer.toHexString(value & 0xff);
            if (hex.length() == 1) result.append('0');
            result.append(hex);
        }
        return result.toString();
    }

    private static boolean isVerifiedApk(File apkFile, String expectedSha256) {
        if (apkFile == null || expectedSha256 == null || !expectedSha256.matches("(?i)[0-9a-f]{64}")
                || !apkFile.exists() || !apkFile.isFile()) return false;
        long size = apkFile.length();
        if (size < 500000L || size > MAX_APK_BYTES) return false;
        try {
            return expectedSha256.equalsIgnoreCase(sha256File(apkFile));
        } catch (Exception ignored) {
            return false;
        }
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
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            // 当前 WebView 全屏可见，不需要为不可见区域预栅格化，减少冷启动内存与绘制开销。
            settings.setOffscreenPreRaster(false);
        }

        // 缓存策略
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            CookieManager.getInstance().setAcceptThirdPartyCookies(mWebView, false);
            settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
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
        settings.setAllowContentAccess(false);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.JELLY_BEAN) {
            settings.setAllowFileAccessFromFileURLs(false);
            settings.setAllowUniversalAccessFromFileURLs(false);
        }

        // 注入原生交互接口：仅允许写入固定热更新文件，避免路径穿越与任意文件覆盖。
        mWebView.addJavascriptInterface(new Object() {
            @android.webkit.JavascriptInterface
            public boolean isNativeApp() {
                return true;
            }

            @android.webkit.JavascriptInterface
            public boolean saveHotUpdateFile(String fileName, String content) {
                if (!"index.html".equals(fileName) || content == null) {
                    return false;
                }
                try {
                    byte[] contentBytes = content.getBytes("UTF-8");
                    if (contentBytes.length < 50000 || contentBytes.length > 4 * 1024 * 1024) return false;
                    File dir = new File(getFilesDir(), "hot_update");
                    if (!dir.exists()) dir.mkdirs();
                    File target = new File(dir, "index.html");
                    File temp = new File(dir, "index.html.tmp");
                    try (FileOutputStream fos = new FileOutputStream(temp)) {
                        fos.write(contentBytes);
                        fos.flush();
                    }
                    if (target.exists() && !target.delete()) {
                        temp.delete();
                        return false;
                    }
                    if (!temp.renameTo(target)) {
                        temp.delete();
                        return false;
                    }
                    return true;
                } catch (Exception e) {
                    android.util.Log.e("MainActivity", "Hot update save failed: " + e.getMessage());
                    return false;
                }
            }

            @android.webkit.JavascriptInterface
            public boolean exportChatText(String content, String fileName) {
                return launchChatExport(content, fileName);
            }

            @android.webkit.JavascriptInterface
            public void downloadAndInstallApk(String ignoredUrl) {
                // 旧版网页桥接保留但不再具备下载权限，防止旧调用绕过票据校验。
                startApkDownload("");
            }

            @android.webkit.JavascriptInterface
            public void downloadAndInstallApkWithTicket(String updateTicket) {
                startApkDownload(updateTicket);
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

            // Refresh Token 单独写入，兼容旧版 WebView 的五参数 saveUserLogin 桥接。
            @android.webkit.JavascriptInterface
            public void saveUserRefreshToken(String refreshToken) {
                try {
                    getSharedPreferences("app_user_login", MODE_PRIVATE).edit()
                        .putString("refreshToken", refreshToken != null ? refreshToken : "")
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
                    obj.put("refreshToken", sp.getString("refreshToken", ""));
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
            public android.webkit.WebResourceResponse shouldInterceptRequest(WebView view, android.webkit.WebResourceRequest request) {
                // localhost 流量 100% 交由成熟完善的 LocalWebServer HTTP 协议栈处理（原生返回标准的 200 OK 与 Content-Type，避免 WebView 解析异常）
                // 仅当协议为 file:// 时（极罕见端口完全被占用的极端兜底），才通过内存流拦截
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                    Uri uri = request.getUrl();
                    if (uri != null && "file".equals(uri.getScheme())) {
                        String path = uri.getPath();
                        if (path == null || path.equals("/") || path.isEmpty()) path = "index.html";
                        if (path.startsWith("/")) path = path.substring(1);
                        if (path.startsWith("android_asset/")) path = path.substring("android_asset/".length());

                        // 1. 热更新只允许覆盖根目录 index.html，并使用规范化路径防止目录穿越。
                        File updateDir = new File(getFilesDir(), "hot_update");
                        if (updateDir.exists() && "index.html".equals(path)) {
                            try {
                                File baseDir = updateDir.getCanonicalFile();
                                File localFile = new File(baseDir, "index.html").getCanonicalFile();
                                if (localFile.getParentFile().equals(baseDir) && localFile.exists() && localFile.isFile() && localFile.length() > 0) {
                                    return new android.webkit.WebResourceResponse("text/html", "UTF-8", new FileInputStream(localFile));
                                }
                            } catch (Exception ignored) {
                            }
                        }
                        // 2. 内存直通读取原生 APK assets 资源
                        try {
                            InputStream in = getAssets().open(path);
                            String mime = getMimeTypeFromPath(path);
                            return new android.webkit.WebResourceResponse(mime, "UTF-8", in);
                        } catch (Exception ignored) {}
                    }
                }
                return super.shouldInterceptRequest(view, request);
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                try {
                    return handleWebViewNavigation(view, url == null ? null : Uri.parse(url));
                } catch (Exception ignored) {
                    return true;
                }
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, android.webkit.WebResourceRequest request) {
                if (request == null || !request.isForMainFrame()) return false;
                return handleWebViewNavigation(view, request.getUrl());
            }
        });

        // 当前游戏不使用摄像头/麦克风；不向 Web 内容自动授予敏感媒体权限。
        mWebView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                runOnUiThread(request::deny);
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

    private static String safeChatExportFileName(String fileName) {
        String clean = fileName == null ? "五子棋聊天记录.txt" : fileName;
        clean = clean.replaceAll("[\\\\/:*?\\\"<>|\\r\\n]", "_").trim();
        if (clean.isEmpty()) clean = "五子棋聊天记录.txt";
        if (!clean.toLowerCase(java.util.Locale.US).endsWith(".txt")) clean += ".txt";
        if (clean.length() > 96) clean = clean.substring(0, 92) + ".txt";
        return clean;
    }

    private boolean launchChatExport(String content, String fileName) {
        if (content == null || content.isEmpty()) return false;
        try {
            byte[] contentBytes = content.getBytes("UTF-8");
            if (contentBytes.length > 512 * 1024) return false;
            mPendingChatExportContent = content;
            Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
            intent.addCategory(Intent.CATEGORY_OPENABLE);
            intent.setType("text/plain");
            intent.putExtra(Intent.EXTRA_TITLE, safeChatExportFileName(fileName));
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
            runOnUiThread(() -> {
                try {
                    startActivityForResult(intent, CHAT_EXPORT_REQUEST_CODE);
                } catch (Exception error) {
                    mPendingChatExportContent = null;
                    Toast.makeText(this, "无法打开系统保存位置，请稍后重试", Toast.LENGTH_SHORT).show();
                    android.util.Log.w("MainActivity", "Chat export activity failed", error);
                }
            });
            return true;
        } catch (Exception error) {
            mPendingChatExportContent = null;
            Toast.makeText(this, "无法打开系统保存位置，请稍后重试", Toast.LENGTH_SHORT).show();
            android.util.Log.w("MainActivity", "Chat export launch failed", error);
            return false;
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == CHAT_EXPORT_REQUEST_CODE) {
            String content = mPendingChatExportContent;
            mPendingChatExportContent = null;
            if (resultCode != RESULT_OK || data == null || data.getData() == null) {
                if (resultCode != RESULT_CANCELED) {
                    Toast.makeText(this, "TXT 导出未完成", Toast.LENGTH_SHORT).show();
                }
                return;
            }
            if (content == null) return;
            try (OutputStream output = getContentResolver().openOutputStream(data.getData())) {
                if (output == null) throw new java.io.IOException("保存位置不可写");
                output.write(content.getBytes("UTF-8"));
                output.flush();
                Toast.makeText(this, "🎉 聊天记录 TXT 已保存", Toast.LENGTH_SHORT).show();
            } catch (Exception error) {
                Toast.makeText(this, "TXT 保存失败，请换一个文件夹重试", Toast.LENGTH_LONG).show();
                android.util.Log.w("MainActivity", "Chat export write failed", error);
            }
            return;
        }
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
        if (mWebView != null) {
            mWebView.evaluateJavascript("typeof window.handleAndroidBack === 'function' ? window.handleAndroidBack() : false", new ValueCallback<String>() {
                @Override
                public void onReceiveValue(String value) {
                    if ("true".equals(value)) {
                        mLastBackPressTime = 0;
                        return;
                    }
                    handleExitBackPressed();
                }
            });
            return;
        }
        handleExitBackPressed();
    }

    private void handleExitBackPressed() {
        long now = System.currentTimeMillis();
        if (now - mLastBackPressTime < 2000) {
            MainActivity.super.onBackPressed();
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
            notifyWebNetworkChanged("android_resume");
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
        // 让网页按告警级别释放粒子、Canvas 缓存和空闲 Worker。不要在这里清理
        // WebView HTTP 缓存：缓存中可能包含热更新资源，清理后反而会增加恢复耗时和流量。
        final int trimLevel = level;
        runOnUiThread(() -> {
            if (mWebView == null) return;
            mWebView.evaluateJavascript(
                    "try{if(typeof window.__gomokuTrimMemory==='function')" +
                            "window.__gomokuTrimMemory(" + trimLevel + ");}catch(e){}",
                    null);

            // COMPLETE 表示后台进程已接近被系统回收。此时只暂停定时器；onResume
            // 会恢复它们。避免 freeMemory/System.gc 造成前台卡顿或破坏热更新缓存。
            if (trimLevel >= TRIM_MEMORY_COMPLETE && !hasWindowFocus()) {
                mWebView.pauseTimers();
            }
        });
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
                String safeStatus = org.json.JSONObject.quote(status == null ? "" : status);
                mWebView.evaluateJavascript("if (window.onApkDownloadProgress) window.onApkDownloadProgress(" + percent + ", " + safeStatus + ");", null);
            }
        });
    }

    public void startApkDownload() {
        startApkDownload("");
    }

    public void startApkDownload(String updateTicket) {
        final String cleanUpdateTicket = updateTicket == null ? "" : updateTicket.trim();
        if (cleanUpdateTicket.isEmpty()) {
            runOnUiThread(() -> Toast.makeText(MainActivity.this, "更新授权已失效，请重新检查更新", Toast.LENGTH_LONG).show());
            return;
        }
        // 防重入锁必须先于删除旧文件，避免第二次点击破坏正在进行的下载。
        if (sIsDownloading) {
            runOnUiThread(() -> Toast.makeText(MainActivity.this, "🚀 正在全自动下载更新中，请稍候...", Toast.LENGTH_SHORT).show());
            return;
        }
        File destDir = getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
        if (destDir == null) destDir = getFilesDir();
        if (!destDir.exists() && !destDir.mkdirs()) {
            Toast.makeText(MainActivity.this, "更新目录不可用，请稍后重试", Toast.LENGTH_SHORT).show();
            return;
        }
        final File destFile = new File(destDir, "gomoku_latest.apk");

        // 每次重新下载前清理旧缓存，确保进度条 100% 完整展示
        if (destFile.exists()) {
            destFile.delete();
        }

        sIsDownloading = true;

        runOnUiThread(() -> {
            Toast.makeText(MainActivity.this, "🚀 正在全自动下载最新版，完成后将自动弹出安装...", Toast.LENGTH_LONG).show();
            notifyWebProgress(5, "downloading");
        });

        new Thread(() -> {
            boolean handedOffToDownloadManager = false;
            String expectedHash = null;
            try {
                if (destFile.exists()) destFile.delete();

                // 先读取 Worker 发布清单中的摘要，再下载；摘要接口与下载接口均严格限制为官方 HTTPS 出口。
                expectedHash = fetchExpectedApkSha256();
                sExpectedApkSha256 = expectedHash;

                HttpURLConnection connection = null;
                try {
                    connection = openTrustedConnection(UPDATE_PROXY_APK_URL, UPDATE_PROXY_APK_PATH, cleanUpdateTicket);
                    int responseCode = connection.getResponseCode();
                    if (responseCode < 200 || responseCode >= 300) throw new SecurityException("更新文件接口不可用");
                    int declaredSize = connection.getContentLength();
                    if (declaredSize > MAX_APK_BYTES) throw new SecurityException("更新文件超过大小限制");

                    try (InputStream input = connection.getInputStream(); FileOutputStream output = new FileOutputStream(destFile)) {
                        byte[] buffer = new byte[8192];
                        int len;
                        long downloaded = 0;
                        int lastPercent = 5;
                        while ((len = input.read(buffer)) != -1) {
                            downloaded += len;
                            if (downloaded > MAX_APK_BYTES) throw new SecurityException("更新文件超过大小限制");
                            output.write(buffer, 0, len);
                            if (declaredSize > 0) {
                                int percent = Math.min(99, (int) ((downloaded * 100L) / declaredSize));
                                if (percent - lastPercent >= 5) {
                                    lastPercent = percent;
                                    notifyWebProgress(percent, "downloading");
                                }
                            }
                        }
                        output.flush();
                    }
                } finally {
                    if (connection != null) connection.disconnect();
                }

                if (!isVerifiedApk(destFile, expectedHash)) {
                    if (destFile.exists()) destFile.delete();
                    throw new SecurityException("更新包完整性校验失败");
                }
                notifyWebProgress(100, "done");
                runOnUiThread(() -> installDownloadedApk(destFile));
                return;
            } catch (Exception e) {
                if (destFile.exists()) destFile.delete();
                android.util.Log.e("MainActivity", "Direct download or integrity check failed: " + e.getMessage());
                if (expectedHash != null && !expectedHash.isEmpty()) {
                    handedOffToDownloadManager = fallbackDownloadManager(expectedHash, cleanUpdateTicket);
                } else {
                    runOnUiThread(() -> Toast.makeText(MainActivity.this, "更新清单校验失败，已停止安装", Toast.LENGTH_LONG).show());
                }
            } finally {
                if (!handedOffToDownloadManager) sIsDownloading = false;
            }
        }).start();
    }

    private void installDownloadedApk(File apkFile) {
        try {
            if (!isVerifiedApk(apkFile, sExpectedApkSha256)) {
                if (apkFile != null && apkFile.exists()) apkFile.delete();
                Toast.makeText(MainActivity.this, "更新包完整性校验失败，已拒绝安装", Toast.LENGTH_LONG).show();
                return;
            }
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
            startActivity(installIntent);
            Toast.makeText(MainActivity.this, "🎉 正在唤起系统安装更新，请点击确认！", Toast.LENGTH_LONG).show();
        } catch (Exception e) {
            Toast.makeText(MainActivity.this, "自动呼起安装失败，已停止安装: " + e.getMessage(), Toast.LENGTH_SHORT).show();
        }
    }

    private boolean fallbackDownloadManager(final String expectedHash, final String updateTicket) {
        if (expectedHash == null || !expectedHash.matches("(?i)[0-9a-f]{64}")
                || updateTicket == null || updateTicket.trim().isEmpty()) return false;
        runOnUiThread(() -> {
            try {
                final DownloadManager dm = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
                if (dm == null) throw new IllegalStateException("系统下载服务不可用");
                DownloadManager.Request req = new DownloadManager.Request(Uri.parse(UPDATE_PROXY_APK_URL));
                req.addRequestHeader(UPDATE_CLIENT_HEADER, UPDATE_CLIENT_HEADER_VALUE);
                req.addRequestHeader(UPDATE_TICKET_HEADER, updateTicket.trim());
                req.setMimeType("application/vnd.android.package-archive");
                req.setTitle("五子棋 最新版全自动更新");
                req.setDescription("正在极速下载安装包...");
                req.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);

                File destDir = getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
                if (destDir == null) throw new IllegalStateException("系统下载目录不可用");
                if (!destDir.exists() && !destDir.mkdirs()) throw new IllegalStateException("更新目录不可用");
                final File destFile = new File(destDir, "gomoku_latest.apk");
                if (destFile.exists()) destFile.delete();
                // 使用 DownloadManager 的应用专属目录接口，不构造 file:// URI，避免跨进程文件 URI 暴露。
                req.setDestinationInExternalFilesDir(MainActivity.this, Environment.DIRECTORY_DOWNLOADS, "gomoku_latest.apk");

                final long downloadId = dm.enqueue(req);

                registerReceiver(new BroadcastReceiver() {
                    @Override
                    public void onReceive(Context context, Intent intent) {
                        long id = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1);
                        if (id == downloadId) {
                            try { unregisterReceiver(this); } catch (Exception ignored) {}
                            sIsDownloading = false;
                            if (isVerifiedApk(destFile, expectedHash)) {
                                notifyWebProgress(100, "done");
                                installDownloadedApk(destFile);
                            } else {
                                if (destFile.exists()) destFile.delete();
                                Toast.makeText(MainActivity.this, "下载完成但完整性校验失败，已拒绝安装", Toast.LENGTH_LONG).show();
                            }
                        }
                    }
                }, new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE));

            } catch (Exception e) {
                sIsDownloading = false;
                Toast.makeText(MainActivity.this, "备用下载启动失败，已停止安装: " + e.getMessage(), Toast.LENGTH_SHORT).show();
            }
        });
        return true;
    }

    @Override
    protected void onDestroy() {
        unregisterNetworkMonitor();
        mPendingChatExportContent = null;
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
