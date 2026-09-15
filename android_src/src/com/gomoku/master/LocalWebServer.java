package com.gomoku.master;

import android.content.res.AssetManager;
import java.io.*;
import java.net.*;
import java.util.*;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * 内嵌轻量 HTTP 服务器 —— 从 assets 目录提供游戏文件
 *
 * 核心作用：让 WebView 从 http://localhost:8080 加载，而非 file:///android_asset/
 *   - 彻底解除 file:// 对 WebSocket / WebRTC DataChannel 的安全限制
 *   - PeerJS 信令 WSS 连接在 http:// 上下文中与普通浏览器行为完全一致
 *   - 零外部依赖，纯 Java Socket 实现
 */
public class LocalWebServer extends Thread {

    private static volatile int sActualPort = 8080;
    private static final String TAG     = "LocalWebServer";

    private final AssetManager  assets;
    private final File          updateDir;
    // APK 内的静态 JS/CSS 在一次启动期间不会变化，缓存可减少 WebView 重载时的 I/O。
    // 使用有界 LRU，避免主题、图片或未来新增资源把 Android 进程内存无限占满。
    private static final int MAX_CACHED_ASSET_BYTES = 4 * 1024 * 1024;
    private static final long MAX_ASSET_CACHE_BYTES = 8L * 1024L * 1024L;
    private final Object assetCacheLock = new Object();
    private final LinkedHashMap<String, CachedAsset> assetCache =
            new LinkedHashMap<>(16, 0.75f, true);
    private long assetCacheBytes = 0L;

    // 本地 WebView 请求数量有限；固定线程数 + 有界队列可防止异常连接耗尽进程线程资源。
    private static final int REQUEST_WORKER_THREADS = 4;
    private static final int REQUEST_QUEUE_CAPACITY = 32;
    private final AtomicInteger requestThreadSequence = new AtomicInteger();
    private final ThreadPoolExecutor requestExecutor = new ThreadPoolExecutor(
            REQUEST_WORKER_THREADS,
            REQUEST_WORKER_THREADS,
            0L,
            TimeUnit.MILLISECONDS,
            new ArrayBlockingQueue<Runnable>(REQUEST_QUEUE_CAPACITY),
            new ThreadFactory() {
                @Override
                public Thread newThread(Runnable runnable) {
                    Thread thread = new Thread(runnable,
                            "LocalWebServer-" + requestThreadSequence.incrementAndGet());
                    thread.setDaemon(true);
                    return thread;
                }
            },
            new ThreadPoolExecutor.AbortPolicy()
    );

    // stopServer 会关闭所有已接收连接，确保 shutdownNow 不会留下阻塞中的 Socket。
    private final Set<Socket> openClients =
            Collections.newSetFromMap(new ConcurrentHashMap<Socket, Boolean>());
    private final CountDownLatch readyLatch = new CountDownLatch(1);
    private final CountDownLatch stoppedLatch = new CountDownLatch(1);
    private volatile ServerSocket serverSocket;
    private volatile boolean running = false;
    private volatile boolean stopRequested = false;
    private boolean startRequested = false;
    private static final int MAX_REQUEST_LINE = 8192;
    private static final int MAX_HEADER_LINES = 64;

    private static final class CachedAsset {
        final byte[] body;
        final String etag;

        CachedAsset(byte[] body) {
            this.body = body;
            this.etag = buildEtag(body);
        }
    }

    // ── MIME 映射表 ─────────────────────────────────────────────────
    private static final Map<String, String> MIME = new HashMap<>();
    static {
        MIME.put("html",  "text/html; charset=utf-8");
        MIME.put("htm",   "text/html; charset=utf-8");
        MIME.put("js",    "application/javascript; charset=utf-8");
        MIME.put("mjs",   "application/javascript; charset=utf-8");
        MIME.put("css",   "text/css; charset=utf-8");
        MIME.put("json",  "application/json; charset=utf-8");
        MIME.put("png",   "image/png");
        MIME.put("jpg",   "image/jpeg");
        MIME.put("jpeg",  "image/jpeg");
        MIME.put("webp",  "image/webp");
        MIME.put("gif",   "image/gif");
        MIME.put("svg",   "image/svg+xml");
        MIME.put("ico",   "image/x-icon");
        MIME.put("mp3",   "audio/mpeg");
        MIME.put("wav",   "audio/wav");
        MIME.put("ogg",   "audio/ogg");
        MIME.put("woff",  "font/woff");
        MIME.put("woff2", "font/woff2");
        MIME.put("ttf",   "font/ttf");
        MIME.put("otf",   "font/otf");
    }

    public LocalWebServer(AssetManager assets, File updateDir) {
        this.assets = assets;
        this.updateDir = updateDir;
        setDaemon(true);  // JVM 退出时自动终止，无需手动管理
        setName("LocalWebServer");
    }

    /** 启动服务线程；调用方可在创建 WebView 的同时让端口后台绑定。 */
    public synchronized void startAsync() {
        if (startRequested || stopRequested) return;
        startRequested = true;
        start();
    }

    /** 等待端口就绪；通常会在 WebView 初始化期间完成，超时仅作为极端兜底。 */
    public boolean awaitReady(long timeoutMs) {
        startAsync();
        if (running) return true;
        if (stopRequested) return false;
        long safeTimeout = Math.max(0L, timeoutMs);
        try {
            readyLatch.await(safeTimeout, TimeUnit.MILLISECONDS);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return false;
        }
        return running;
    }

    /** 兼容旧调用：保留原有等待接口，但统一走可复用的异步启动实现。 */
    public boolean startAndWait() {
        return awaitReady(500);
    }

    /** 安全停止服务器 */
    public void stopServer() {
        final boolean wasStarted;
        synchronized (this) {
            stopRequested = true;
            running = false;
            wasStarted = startRequested;
        }
        ServerSocket socket = serverSocket;
        if (socket != null) {
            try { socket.close(); } catch (IOException ignored) {}
        }
        // 关闭排队和执行中的客户端，避免 shutdownNow 后仍有 Socket 阻塞到超时。
        for (Socket client : openClients) {
            try { client.close(); } catch (IOException ignored) {}
        }
        requestExecutor.shutdownNow();
        clearAssetCache();
        if (wasStarted && Thread.currentThread() != this) {
            try {
                // 有界等待让 Activity 销毁后不遗留服务线程；Socket 已先关闭，
                // 这里只是生命周期收尾，不会等待网络超时。
                stoppedLatch.await(500L, TimeUnit.MILLISECONDS);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
        }
    }

    public static int getPort() { return sActualPort; }

    // ── 主循环 ────────────────────────────────────────────────────
    @Override
    public void run() {
        int[] candidatePorts = {8080, 8081, 8082, 8088, 8888, 8989, 0};
        for (int p : candidatePorts) {
            if (stopRequested) break;
            ServerSocket candidate = null;
            try {
                candidate = new ServerSocket();
                candidate.setReuseAddress(true);
                serverSocket = candidate;
                candidate.bind(new InetSocketAddress(InetAddress.getByName("127.0.0.1"), p));
                if (stopRequested) {
                    candidate.close();
                    break;
                }
                sActualPort = candidate.getLocalPort();
                running = true;
                break;
            } catch (IOException e) {
                try { if (candidate != null) candidate.close(); } catch (Exception ignored) {}
                if (serverSocket == candidate) serverSocket = null;
            }
        }
        if (!running) {
            readyLatch.countDown();
            if (!stopRequested) {
                android.util.Log.e(TAG, "Server error: could not bind to any port");
            }
            requestExecutor.shutdownNow();
            stoppedLatch.countDown();
            return;
        }
        readyLatch.countDown();

        try {
            while (running && !stopRequested) {
                Socket client = null;
                try {
                    client = serverSocket.accept();
                    openClients.add(client);
                    if (!running || stopRequested) {
                        openClients.remove(client);
                        try { client.close(); } catch (IOException ignored) {}
                        break;
                    }
                    final Socket acceptedClient = client;
                    try {
                        requestExecutor.execute(() -> handleRequest(acceptedClient));
                    } catch (RejectedExecutionException rejected) {
                        openClients.remove(acceptedClient);
                        try { acceptedClient.close(); } catch (IOException ignored) {}
                    }
                } catch (IOException e) {
                    if (!running || stopRequested) break;
                }
            }
        } finally {
            running = false;
            ServerSocket socket = serverSocket;
            serverSocket = null;
            if (socket != null) {
                try { socket.close(); } catch (IOException ignored) {}
            }
            for (Socket client : openClients) {
                try { client.close(); } catch (IOException ignored) {}
            }
            requestExecutor.shutdown();
            stoppedLatch.countDown();
        }
    }

    // ── 请求处理 ─────────────────────────────────────────────────
    private void handleRequest(Socket client) {
        try {
            client.setTcpNoDelay(true);
            client.setKeepAlive(false);
            client.setSoTimeout(8000);
            InputStream  rawIn  = client.getInputStream();
            OutputStream rawOut = new BufferedOutputStream(client.getOutputStream(), 16 * 1024);

            // 读取请求行
            String requestLine = readLine(rawIn, MAX_REQUEST_LINE);
            if (requestLine == null || requestLine.isEmpty()) {
                client.close();
                return;
            }

            // 耗尽请求头（必须读完，否则客户端无法接收响应）
            int headerLines = 0;
            String ifNoneMatch = null;
            while (true) {
                if (++headerLines > MAX_HEADER_LINES) {
                    sendError(rawOut, 431, "Request Header Fields Too Large");
                    client.close();
                    return;
                }
                String hdr = readLine(rawIn, MAX_REQUEST_LINE);
                if (hdr == null) {
                    sendError(rawOut, 431, "Request Header Fields Too Large");
                    client.close();
                    return;
                }
                if (hdr.isEmpty()) break;
                int separator = hdr.indexOf(':');
                if (separator > 0 && "If-None-Match".equalsIgnoreCase(hdr.substring(0, separator).trim())) {
                    ifNoneMatch = hdr.substring(separator + 1).trim();
                }
            }

            String[] parts = requestLine.split(" ");
            if (parts.length < 2) { client.close(); return; }

            // 仅支持 GET / HEAD
            String method = parts[0];
            String rawPath = parts[1];
            if (!method.equals("GET") && !method.equals("HEAD")) {
                sendError(rawOut, 405, "Method Not Allowed");
                client.close();
                return;
            }

            // 去掉查询字符串，URL 解码
            String path = rawPath.split("\\?")[0];
            try { path = java.net.URLDecoder.decode(path, "UTF-8"); } catch (Exception ignored) {}
            if (path.equals("/")) path = "/index.html";
            if (path.startsWith("/")) path = path.substring(1);

            // 安全检查：禁止路径穿越
            if (path.contains("..") || path.indexOf('\0') >= 0 || path.indexOf('\\') >= 0) {
                sendError(rawOut, 403, "Forbidden");
                client.close();
                return;
            }

            String ext = "";
            int dotIdx = path.lastIndexOf('.');
            if (dotIdx >= 0) ext = path.substring(dotIdx + 1).toLowerCase();
            String mime = MIME.getOrDefault(ext, "application/octet-stream");

            try {
                InputStream assetIn = null;
                boolean fromHotUpdate = false;
                // 热更新仅允许提供根目录 index.html，且必须位于沙盒目录内。
                if (updateDir != null && updateDir.exists() && path.equals("index.html")) {
                    try {
                        File baseDir = updateDir.getCanonicalFile();
                        File localFile = new File(baseDir, "index.html").getCanonicalFile();
                        if (localFile.getParentFile().equals(baseDir) && localFile.exists() && localFile.isFile() && localFile.length() > 0) {
                            assetIn = new FileInputStream(localFile);
                            fromHotUpdate = true;
                        }
                    } catch (Exception ignored) {
                    }
                }
                CachedAsset cachedAsset = fromHotUpdate ? null : getCachedAsset(path);
                byte[] body = cachedAsset == null ? null : cachedAsset.body;
                String etag = cachedAsset == null ? null : cachedAsset.etag;
                if (body == null && assetIn == null) {
                    try {
                        assetIn = assets.open(path);
                    } catch (IOException e1) {
                        try {
                            assetIn = assets.open(path.replace('/', '\\'));
                        } catch (IOException e2) {
                            try {
                                assetIn = assets.open(path.replace('\\', '/'));
                            } catch (IOException e3) {
                                throw e1;
                            }
                        }
                    }
                }
                if (body == null) {
                    try {
                        body = readFully(assetIn);
                    } finally {
                        if (assetIn != null) {
                            try { assetIn.close(); } catch (IOException ignored) {}
                        }
                    }
                    etag = buildEtag(body);
                    if (!fromHotUpdate && isCacheableAsset(ext)) {
                        cacheAsset(path, body);
                    }
                }

                // 本地资源通常不会变化；ETag 可让 WebView 在回到前台或重载时直接收到 304，
                // 减少重复传输与首屏等待。弱校验值只用于缓存协商，不承担安全校验职责。
                if (etag == null) etag = buildEtag(body);
                if (matchesIfNoneMatch(ifNoneMatch, etag)) {
                    PrintWriter pw = new PrintWriter(new OutputStreamWriter(rawOut, "UTF-8"), false);
                    pw.print("HTTP/1.1 304 Not Modified\r\n");
                    pw.print("ETag: " + etag + "\r\n");
                    pw.print("Cache-Control: no-cache\r\n");
                    pw.print("X-Content-Type-Options: nosniff\r\n");
                    pw.print("Connection: close\r\n");
                    pw.print("\r\n");
                    pw.flush();
                    return;
                }

                PrintWriter pw = new PrintWriter(new OutputStreamWriter(rawOut, "UTF-8"), false);
                pw.print("HTTP/1.1 200 OK\r\n");
                pw.print("Content-Type: " + mime + "\r\n");
                pw.print("Content-Length: " + body.length + "\r\n");
                pw.print("ETag: " + etag + "\r\n");
                pw.print("Cache-Control: no-cache\r\n");
                pw.print("X-Content-Type-Options: nosniff\r\n");
                pw.print("Referrer-Policy: no-referrer\r\n");
                pw.print("X-Frame-Options: DENY\r\n");
                pw.print("Permissions-Policy: camera=(), microphone=()\r\n");
                pw.print("Connection: close\r\n");
                pw.print("\r\n");
                pw.flush();

                if (!method.equals("HEAD")) {
                    rawOut.write(body);
                }
                rawOut.flush();

            } catch (FileNotFoundException e) {
                sendError(rawOut, 404, "Not Found: " + path);
            }

        } catch (IOException ignored) {
        } finally {
            openClients.remove(client);
            try { client.close(); } catch (IOException ignored) {}
        }
    }

    // ── 工具方法 ─────────────────────────────────────────────────

    private CachedAsset getCachedAsset(String path) {
        synchronized (assetCacheLock) {
            return assetCache.get(path);
        }
    }

    private void cacheAsset(String path, byte[] body) {
        if (body == null || body.length > MAX_CACHED_ASSET_BYTES) return;
        CachedAsset entry = new CachedAsset(body);
        synchronized (assetCacheLock) {
            CachedAsset previous = assetCache.put(path, entry);
            if (previous != null) assetCacheBytes -= previous.body.length;
            assetCacheBytes += body.length;

            Iterator<Map.Entry<String, CachedAsset>> iterator = assetCache.entrySet().iterator();
            while (assetCacheBytes > MAX_ASSET_CACHE_BYTES && iterator.hasNext()) {
                Map.Entry<String, CachedAsset> eldest = iterator.next();
                assetCacheBytes -= eldest.getValue().body.length;
                iterator.remove();
            }
        }
    }

    private void clearAssetCache() {
        synchronized (assetCacheLock) {
            assetCache.clear();
            assetCacheBytes = 0L;
        }
    }

    private static boolean isCacheableAsset(String extension) {
        // 图片/字体/音频可能较大且首屏并不一定需要，交给 WebView 自身缓存；
        // 只缓存 APK 内最常重复读取的脚本和样式，避免本地服务重复持有媒体资源。
        return "js".equals(extension) || "mjs".equals(extension) || "css".equals(extension);
    }

    private static String buildEtag(byte[] body) {
        return "W/\"" + body.length + "-" + Integer.toHexString(Arrays.hashCode(body)) + "\"";
    }

    private static boolean matchesIfNoneMatch(String header, String etag) {
        if (header == null || header.isEmpty()) return false;
        String[] candidates = header.split(",");
        for (String candidate : candidates) {
            String value = candidate.trim();
            if ("*".equals(value) || etag.equals(value)) return true;
        }
        return false;
    }

    private static String readLine(InputStream in, int maxLength) throws IOException {
        StringBuilder sb = new StringBuilder();
        int b;
        while ((b = in.read()) != -1) {
            if (b == '\r') {
                int next = in.read();
                if (next != '\n') {
                    // 不应发生，容错处理
                }
                break;
            }
            if (b == '\n') break;
            if (sb.length() >= maxLength) return null;
            sb.append((char) b);
        }
        return sb.toString();
    }

    private static byte[] readFully(InputStream is) throws IOException {
        ByteArrayOutputStream baos = new ByteArrayOutputStream(8192);
        byte[] buf = new byte[8192];
        int n;
        while ((n = is.read(buf)) != -1) baos.write(buf, 0, n);
        return baos.toByteArray();
    }

    private static void sendError(OutputStream out, int code, String msg) {
        try {
            byte[] body = msg.getBytes("UTF-8");
            PrintWriter pw = new PrintWriter(new OutputStreamWriter(out, "UTF-8"), false);
            pw.print("HTTP/1.1 " + code + " " + msg + "\r\n");
            pw.print("Content-Type: text/plain; charset=utf-8\r\n");
            pw.print("Content-Length: " + body.length + "\r\n");
            pw.print("Connection: close\r\n");
            pw.print("\r\n");
            pw.flush();
            out.write(body);
            out.flush();
        } catch (IOException ignored) {}
    }
}
