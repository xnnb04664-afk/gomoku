package com.gomoku.master;

import android.content.res.AssetManager;
import java.io.*;
import java.net.*;
import java.util.*;

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
    private       ServerSocket  serverSocket;
    private volatile boolean    running  = false;
    private static final int MAX_REQUEST_LINE = 8192;
    private static final int MAX_HEADER_LINES = 64;

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

    /** 启动服务并等待端口就绪（最多 500ms） */
    public boolean startAndWait() {
        start();
        long deadline = System.currentTimeMillis() + 500;
        while (System.currentTimeMillis() < deadline) {
            if (running) return true;
            try { Thread.sleep(20); } catch (InterruptedException e) { break; }
        }
        return running;
    }

    /** 安全停止服务器 */
    public void stopServer() {
        running = false;
        try { if (serverSocket != null) serverSocket.close(); } catch (IOException ignored) {}
    }

    public static int getPort() { return sActualPort; }

    // ── 主循环 ────────────────────────────────────────────────────
    @Override
    public void run() {
        int[] candidatePorts = {8080, 8081, 8082, 8088, 8888, 8989, 0};
        for (int p : candidatePorts) {
            try {
                serverSocket = new ServerSocket();
                serverSocket.setReuseAddress(true);
                serverSocket.bind(new InetSocketAddress(InetAddress.getByName("127.0.0.1"), p));
                sActualPort = serverSocket.getLocalPort();
                running = true;
                break;
            } catch (IOException e) {
                try { if (serverSocket != null) serverSocket.close(); } catch (Exception ignored) {}
            }
        }
        if (!running) {
            android.util.Log.e(TAG, "Server error: could not bind to any port");
            return;
        }

        while (running) {
            try {
                final Socket client = serverSocket.accept();
                // 每个请求用独立线程处理，避免阻塞
                Thread t = new Thread(() -> handleRequest(client));
                t.setDaemon(true);
                t.start();
            } catch (IOException e) {
                if (!running) break;
            }
        }
    }

    // ── 请求处理 ─────────────────────────────────────────────────
    private void handleRequest(Socket client) {
        try {
            client.setSoTimeout(8000);
            InputStream  rawIn  = client.getInputStream();
            OutputStream rawOut = client.getOutputStream();

            // 读取请求行
            String requestLine = readLine(rawIn, MAX_REQUEST_LINE);
            if (requestLine == null || requestLine.isEmpty()) {
                client.close();
                return;
            }

            // 耗尽请求头（必须读完，否则客户端无法接收响应）
            int headerLines = 0;
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
                // 热更新仅允许提供根目录 index.html，且必须位于沙盒目录内。
                if (updateDir != null && updateDir.exists() && path.equals("index.html")) {
                    try {
                        File baseDir = updateDir.getCanonicalFile();
                        File localFile = new File(baseDir, "index.html").getCanonicalFile();
                        if (localFile.getParentFile().equals(baseDir) && localFile.exists() && localFile.isFile() && localFile.length() > 0) {
                            assetIn = new FileInputStream(localFile);
                        }
                    } catch (Exception ignored) {
                    }
                }
                if (assetIn == null) {
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
                byte[] body = readFully(assetIn);
                assetIn.close();

                PrintWriter pw = new PrintWriter(new OutputStreamWriter(rawOut, "UTF-8"), false);
                pw.print("HTTP/1.1 200 OK\r\n");
                pw.print("Content-Type: " + mime + "\r\n");
                pw.print("Content-Length: " + body.length + "\r\n");
                pw.print("Cache-Control: no-cache\r\n");
                pw.print("Access-Control-Allow-Origin: *\r\n");
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
            try { client.close(); } catch (IOException ignored) {}
        }
    }

    // ── 工具方法 ─────────────────────────────────────────────────

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
