"""Run the production PackageInstaller helper and result receiver on a JVM.

The Android API surface is replaced with small deterministic stubs. The Java
under test is copied verbatim from android_src; assertions observe session
contents, commit/abandon calls, persisted state, broadcasts, and confirmation
launches rather than matching implementation source text.
"""

from pathlib import Path
import shutil
import subprocess
import tempfile
import xml.etree.ElementTree as ET


ROOT = Path(__file__).resolve().parents[1]
PACKAGE = "com/gomoku/master"
ANDROID_NS = "{http://schemas.android.com/apk/res/android}"


STUBS = {
    "android/os/Build.java": r'''package android.os;
public final class Build {
    public static final class VERSION { public static int SDK_INT = 35; }
    public static final class VERSION_CODES { public static final int O = 26, P = 28, S = 31, TIRAMISU = 33; }
}''',
    "android/content/IntentSender.java": r'''package android.content;
public final class IntentSender {
    public final Object owner;
    public IntentSender(Object owner) { this.owner = owner; }
}''',
    "android/content/SharedPreferences.java": r'''package android.content;
import java.util.HashMap;
import java.util.Map;
public final class SharedPreferences {
    private final Map<String, Object> values = new HashMap<>();
    public boolean commitResult = true;
    public int getInt(String key, int fallback) {
        Object value = values.get(key); return value instanceof Integer ? (Integer) value : fallback;
    }
    public String getString(String key, String fallback) {
        Object value = values.get(key); return value instanceof String ? (String) value : fallback;
    }
    public Editor edit() { return new Editor(); }
    public final class Editor {
        private final Map<String, Object> puts = new HashMap<>();
        private final java.util.Set<String> removes = new java.util.HashSet<>();
        public Editor putInt(String key, int value) { puts.put(key, value); removes.remove(key); return this; }
        public Editor putString(String key, String value) { puts.put(key, value); removes.remove(key); return this; }
        public Editor remove(String key) { puts.remove(key); removes.add(key); return this; }
        public void apply() { for (String key : removes) values.remove(key); values.putAll(puts); }
        public boolean commit() { if (!commitResult) return false; apply(); return true; }
    }
}''',
    "android/content/Context.java": r'''package android.content;
import android.content.pm.PackageManager;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
public class Context {
    public static final int MODE_PRIVATE = 0;
    private final PackageManager packageManager = new PackageManager();
    private final Map<String, SharedPreferences> preferences = new HashMap<>();
    public final List<Intent> broadcasts = new ArrayList<>();
    public Context getApplicationContext() { return this; }
    public PackageManager getPackageManager() { return packageManager; }
    public String getPackageName() { return "com.gomoku.master"; }
    public SharedPreferences getSharedPreferences(String name, int mode) {
        return preferences.computeIfAbsent(name, ignored -> new SharedPreferences());
    }
    public void sendBroadcast(Intent intent) { broadcasts.add(intent); }
}''',
    "android/content/Intent.java": r'''package android.content;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;
public class Intent {
    public static final String ACTION_VIEW = "android.intent.action.VIEW";
    public static final String EXTRA_INTENT = "android.intent.extra.INTENT";
    public static final int URI_INTENT_SCHEME = 1;
    public static final int FLAG_ACTIVITY_NEW_TASK = 0x10000000;
    public static final int FLAG_GRANT_READ_URI_PERMISSION = 0x00000001;
    private static final AtomicInteger IDS = new AtomicInteger();
    private static final Map<String, Intent> SAVED = new ConcurrentHashMap<>();
    private final Map<String, Object> extras = new HashMap<>();
    private String action;
    private String packageName;
    private Class<?> targetClass;
    private int flags;
    public Intent(String action) { this.action = action; }
    public Intent(String action, android.net.Uri uri) { this.action = action; }
    public Intent(Context context, Class<?> targetClass) { this.targetClass = targetClass; }
    public Intent setAction(String action) { this.action = action; return this; }
    public String getAction() { return action; }
    public Intent setPackage(String packageName) { this.packageName = packageName; return this; }
    public String getPackage() { return packageName; }
    public Class<?> getTargetClass() { return targetClass; }
    public Intent setDataAndType(android.net.Uri uri, String mimeType) { return this; }
    public Intent addFlags(int flags) { this.flags |= flags; return this; }
    public int getFlags() { return flags; }
    public Intent putExtra(String key, int value) { extras.put(key, value); return this; }
    public Intent putExtra(String key, String value) { extras.put(key, value); return this; }
    public Intent putExtra(String key, Object value) { extras.put(key, value); return this; }
    public int getIntExtra(String key, int fallback) {
        Object value = extras.get(key); return value instanceof Integer ? (Integer) value : fallback;
    }
    @SuppressWarnings("unchecked") public <T> T getParcelableExtra(String key) { return (T) extras.get(key); }
    public <T> T getParcelableExtra(String key, Class<T> type) { return type.cast(extras.get(key)); }
    public String getStringExtra(String key) { Object value = extras.get(key); return value instanceof String ? (String) value : null; }
    public String toUri(int flags) {
        String uri = "intent://stub/" + IDS.incrementAndGet(); SAVED.put(uri, this); return uri;
    }
    public static Intent parseUri(String uri, int flags) { return SAVED.get(uri); }
}''',
    "android/content/BroadcastReceiver.java": r'''package android.content;
public abstract class BroadcastReceiver {
    public abstract void onReceive(Context context, Intent intent);
}''',
    "android/content/pm/PackageManager.java": r'''package android.content.pm;
public final class PackageManager {
    public static final int GET_SIGNATURES = 0x40;
    public static final int GET_SIGNING_CERTIFICATES = 0x08000000;
    private PackageInstaller installer = new PackageInstaller();
    public boolean canRequestPackageInstalls = true;
    public PackageInfo archivePackageInfo;
    public PackageInstaller getPackageInstaller() { return installer; }
    public void setPackageInstaller(PackageInstaller installer) { this.installer = installer; }
    public boolean canRequestPackageInstalls() { return canRequestPackageInstalls; }
    public PackageInfo getPackageArchiveInfo(String path, int flags) { return archivePackageInfo; }
}''',
    "android/content/pm/PackageInfo.java": r'''package android.content.pm;
public final class PackageInfo {
    public String packageName;
    public Signature[] signatures;
    public SigningInfo signingInfo;
}''',
    "android/content/pm/Signature.java": r'''package android.content.pm;
public final class Signature {
    private final byte[] bytes;
    public Signature(byte[] bytes) { this.bytes = bytes; }
    public byte[] toByteArray() { return bytes; }
}''',
    "android/content/pm/SigningInfo.java": r'''package android.content.pm;
public final class SigningInfo {
    private final Signature[] signers;
    public SigningInfo(Signature[] signers) { this.signers = signers; }
    public Signature[] getApkContentsSigners() { return signers; }
}''',
    "android/content/pm/PackageInstaller.java": r'''package android.content.pm;
import android.content.IntentSender;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.util.HashMap;
import java.util.Map;
public class PackageInstaller {
    public static final String EXTRA_SESSION_ID = "android.content.pm.extra.SESSION_ID";
    public static final String EXTRA_STATUS = "android.content.pm.extra.STATUS";
    public static final String EXTRA_STATUS_MESSAGE = "android.content.pm.extra.STATUS_MESSAGE";
    public static final int STATUS_SUCCESS = 0;
    public static final int STATUS_FAILURE = 1;
    public static final int STATUS_FAILURE_ABORTED = 3;
    public static final int STATUS_PENDING_USER_ACTION = -1;
    private final Map<Integer, Session> sessions = new HashMap<>();
    private int nextId = 41;
    public int createCount;
    public boolean failOpenWrite;
    public boolean failCommit;
    public int abandonSessionCount;
    public Session lastSession;
    public SessionParams lastParams;
    public int createSession(SessionParams params) {
        createCount++; lastParams = params; int id = nextId++; lastSession = new Session(id, this); sessions.put(id, lastSession); return id;
    }
    public Session openSession(int id) { return sessions.get(id); }
    public SessionInfo getSessionInfo(int id) { Session s = sessions.get(id); return s == null ? null : new SessionInfo(s.sealed, s.committed); }
    public void abandonSession(int id) { abandonSessionCount++; Session s = sessions.get(id); if (s != null) s.abandon(); }
    public void seedSession(int id, boolean sealed, boolean committed) { sessions.put(id, new Session(id, this, sealed, committed)); }
    public static final class SessionInfo {
        private final boolean sealed, committed;
        SessionInfo(boolean sealed, boolean committed) { this.sealed = sealed; this.committed = committed; }
        public boolean isSealed() { return sealed; }
        public boolean isCommitted() { return committed; }
    }
    public static final class SessionParams {
        public static final int MODE_FULL_INSTALL = 1;
        public static final int USER_ACTION_NOT_REQUIRED = 2;
        public final int mode;
        public String packageName;
        public int userAction = -1;
        public SessionParams(int mode) { this.mode = mode; }
        public void setAppPackageName(String packageName) { this.packageName = packageName; }
        public void setRequireUserAction(int userAction) { this.userAction = userAction; }
    }
    public static final class Session {
        private final int id;
        private final PackageInstaller owner;
        public final ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        public int fsyncCount, commitCount, abandonCount, closeCount;
        public IntentSender committedSender;
        public boolean sealed, committed;
        Session(int id, PackageInstaller owner) { this(id, owner, false, false); }
        Session(int id, PackageInstaller owner, boolean sealed, boolean committed) {
            this.id = id; this.owner = owner; this.sealed = sealed; this.committed = committed;
        }
        public OutputStream openWrite(String name, long offset, long length) throws IOException {
            if (owner.failOpenWrite) throw new IOException("injected write failure"); return bytes;
        }
        public void fsync(OutputStream output) { fsyncCount++; }
        public void commit(IntentSender sender) throws IOException {
            if (owner.failCommit) throw new IOException("injected commit failure");
            commitCount++; committedSender = sender; sealed = true; committed = true;
        }
        public void abandon() { abandonCount++; owner.sessions.remove(id); }
        public void close() { closeCount++; }
    }
}''',
    "android/app/PendingIntent.java": r'''package android.app;
import android.content.Context;
import android.content.Intent;
import android.content.IntentSender;
public final class PendingIntent {
    public static final int FLAG_UPDATE_CURRENT = 0x08000000;
    public static final int FLAG_MUTABLE = 0x02000000;
    public static PendingIntent last;
    public final Context context; public final int requestCode; public final Intent intent; public final int flags;
    private PendingIntent(Context context, int requestCode, Intent intent, int flags) {
        this.context = context; this.requestCode = requestCode; this.intent = intent; this.flags = flags;
    }
    public static PendingIntent getBroadcast(Context c, int requestCode, Intent i, int flags) {
        last = new PendingIntent(c, requestCode, i, flags); return last;
    }
    public IntentSender getIntentSender() { return new IntentSender(this); }
}''',
    "android/app/Activity.java": r'''package android.app;
import android.content.Context;
import android.content.Intent;
import java.util.ArrayList;
import java.util.List;
public class Activity extends Context {
    private final Context app;
    public final List<Intent> started = new ArrayList<>();
    public Activity() { this.app = null; }
    public Activity(Context app) { this.app = app; }
    @Override public Context getApplicationContext() { return app == null ? this : app; }
    @Override public android.content.pm.PackageManager getPackageManager() { return app == null ? super.getPackageManager() : app.getPackageManager(); }
    @Override public String getPackageName() { return app == null ? super.getPackageName() : app.getPackageName(); }
    @Override public android.content.SharedPreferences getSharedPreferences(String name, int mode) {
        return app == null ? super.getSharedPreferences(name, mode) : app.getSharedPreferences(name, mode);
    }
    public void startActivity(Intent intent) { started.add(intent); }
}''',
    "android/net/Uri.java": r'''package android.net;
public final class Uri { public static Uri parse(String value) { return new Uri(); } }''',
    "android/provider/Settings.java": r'''package android.provider;
public final class Settings {
    public static final String ACTION_MANAGE_UNKNOWN_APP_SOURCES = "android.settings.MANAGE_UNKNOWN_APP_SOURCES";
}''',
    "android/widget/Toast.java": r'''package android.widget;
import android.content.Context;
import java.util.ArrayList;
import java.util.List;
public final class Toast {
    public static final int LENGTH_LONG = 1;
    public static final int LENGTH_SHORT = 0;
    public static final List<String> shown = new ArrayList<>();
    private final String message;
    private Toast(String message) { this.message = message; }
    public static Toast makeText(Context c, CharSequence message, int duration) { return new Toast(String.valueOf(message)); }
    public void show() { shown.add(message); }
}''',
    "android/util/Log.java": r'''package android.util;
public final class Log {
    public static int w(String tag, String message) { return 0; }
    public static int w(String tag, String message, Throwable error) { return 0; }
}''',
}


HARNESS = r'''package com.gomoku.master;
import android.app.Activity;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.pm.PackageInstaller;
import android.content.pm.Signature;
import android.content.pm.SigningInfo;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.widget.Toast;
import java.nio.file.Files;
import java.nio.file.Path;
import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.security.MessageDigest;
import java.util.Arrays;

public final class ApkInstallBehaviorTest {
    private static void check(boolean value, String message) {
        if (!value) throw new AssertionError(message);
    }
    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(ApkSessionInstaller.PREFS_NAME, Context.MODE_PRIVATE);
    }
    private static Path apk(byte[] content) throws Exception {
        Path path = Files.createTempFile("gomoku-update-", ".apk"); Files.write(path, content); return path;
    }
    private static void successAndDuplicate(Path apkPath, byte[] content) throws Exception {
        Context context = new Context();
        PackageInstaller installer = context.getPackageManager().getPackageInstaller();
        check(ApkSessionInstaller.install(context, apkPath.toFile()) == ApkSessionInstaller.Result.STARTED,
                "first install must start a session");
        check(installer.createCount == 1 && installer.lastSession.commitCount == 1, "session must commit once");
        check(installer.lastSession.fsyncCount == 1 && installer.lastSession.abandonCount == 0, "successful session must fsync and stay active");
        check(Arrays.equals(content, installer.lastSession.bytes.toByteArray()), "session must contain the exact APK bytes");
        check(installer.lastParams.packageName.equals(context.getPackageName()), "session must target the app package");
        check(installer.lastParams.userAction == PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED,
                "API 31+ session must request no user action");
        int sessionId = prefs(context).getInt(ApkSessionInstaller.KEY_PENDING_SESSION_ID, -1);
        check(sessionId >= 0, "session ID must be persisted while pending");
        PendingIntent pending = PendingIntent.last;
        check(pending != null && pending.intent.getTargetClass() == ApkInstallStatusReceiver.class,
                "status PendingIntent must target the non-exported receiver explicitly");
        check((pending.flags & PendingIntent.FLAG_MUTABLE) != 0, "status PendingIntent must be mutable for system results");
        check((pending.flags & PendingIntent.FLAG_UPDATE_CURRENT) != 0, "status PendingIntent must replace stale extras");
        check(ApkSessionInstaller.install(context, apkPath.toFile()) == ApkSessionInstaller.Result.ALREADY_PENDING,
                "a second request while the system session exists must be suppressed");
        check(installer.createCount == 1 && installer.lastSession.commitCount == 1,
                "duplicate request must not create or commit another session");
        check(pending.requestCode == sessionId, "PendingIntent identity must be tied to the session ID");
    }
    private static void writeFailureAbandons(Path apkPath) throws Exception {
        Context context = new Context();
        PackageInstaller installer = context.getPackageManager().getPackageInstaller();
        installer.failOpenWrite = true;
        boolean threw = false;
        try { ApkSessionInstaller.install(context, apkPath.toFile()); }
        catch (java.io.IOException expected) { threw = true; }
        check(threw, "write failure must propagate to the caller for fallback");
        check(installer.lastSession.abandonCount == 1, "write failure must abandon its PackageInstaller session");
        check(installer.lastSession.commitCount == 0, "write failure must never commit");
        check(prefs(context).getInt(ApkSessionInstaller.KEY_PENDING_SESSION_ID, -1) == -1,
                "failed session must be removed from persisted pending state");
    }
    private static void commitFailureAbandons(Path apkPath) throws Exception {
        Context context = new Context();
        PackageInstaller installer = context.getPackageManager().getPackageInstaller();
        installer.failCommit = true;
        boolean threw = false;
        try { ApkSessionInstaller.install(context, apkPath.toFile()); }
        catch (java.io.IOException expected) { threw = true; }
        check(threw, "commit failure must propagate to the caller");
        check(installer.lastSession.abandonCount == 1 && installer.lastSession.commitCount == 0,
                "commit failure must abandon without committing a second time");
        check(prefs(context).getInt(ApkSessionInstaller.KEY_PENDING_SESSION_ID, -1) == -1,
                "commit failure must clear the pending session key");
    }
    private static void pendingActionAndFailureFinish(Path apkPath) throws Exception {
        Context context = new Context();
        PackageInstaller installer = context.getPackageManager().getPackageInstaller();
        ApkSessionInstaller.install(context, apkPath.toFile());
        int sessionId = prefs(context).getInt(ApkSessionInstaller.KEY_PENDING_SESSION_ID, -1);
        Intent confirmation = new Intent("android.intent.action.CONFIRM_INSTALL");
        Intent pending = new Intent(ApkSessionInstaller.ACTION_INSTALL_STATUS)
                .putExtra(ApkSessionInstaller.EXTRA_SESSION_ID, sessionId)
                .putExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_PENDING_USER_ACTION)
                .putExtra(Intent.EXTRA_INTENT, confirmation);
        new ApkInstallStatusReceiver().onReceive(context, pending);
        check(prefs(context).getInt(ApkSessionInstaller.KEY_PENDING_SESSION_ID, -1) == sessionId,
                "pending user action must leave the installer session pending");
        check(prefs(context).getString(ApkSessionInstaller.KEY_PENDING_USER_ACTION_URI, null) != null,
                "pending user action must survive process/background changes");
        check(context.broadcasts.size() == 1 &&
                ApkSessionInstaller.ACTION_RESUME_USER_ACTION.equals(context.broadcasts.get(0).getAction()),
                "pending user action must request foreground delivery, not retry installation");
        check(installer.createCount == 1 && installer.lastSession.commitCount == 1,
                "pending user action must not create or commit another session");
        Activity activity = new Activity(context);
        check(ApkInstallStatusReceiver.launchPendingUserAction(activity), "saved confirmation must launch on resume");
        check(activity.started.size() == 1 && activity.started.get(0).getAction().equals(confirmation.getAction()),
                "resume must launch the original system confirmation intent");
        check(!ApkInstallStatusReceiver.launchPendingUserAction(activity) && activity.started.size() == 1,
                "confirmation intent must not launch twice");

        Intent rejected = new Intent(ApkSessionInstaller.ACTION_INSTALL_STATUS)
                .putExtra(ApkSessionInstaller.EXTRA_SESSION_ID, sessionId)
                .putExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE_ABORTED)
                .putExtra(PackageInstaller.EXTRA_STATUS_MESSAGE, "user rejected");
        new ApkInstallStatusReceiver().onReceive(context, rejected);
        check(prefs(context).getInt(ApkSessionInstaller.KEY_PENDING_SESSION_ID, -1) == -1,
                "rejected terminal result must clear the pending session");
        check(prefs(context).getString(ApkSessionInstaller.KEY_PENDING_USER_ACTION_URI, null) == null,
                "terminal failure must clear stale confirmation state");
        check(!Toast.shown.isEmpty() && Toast.shown.get(Toast.shown.size() - 1).contains("未完成"),
                "rejected result must report a terminal failure");
        check(installer.createCount == 1 && installer.lastSession.commitCount == 1,
                "terminal failure handling must not retry installation");
    }
    private static void successResultFinishes(Path apkPath) throws Exception {
        Context context = new Context();
        ApkInstallStatusReceiver receiver = new ApkInstallStatusReceiver();
        ApkSessionInstaller.install(context, apkPath.toFile());
        int sessionId = prefs(context).getInt(ApkSessionInstaller.KEY_PENDING_SESSION_ID, -1);
        receiver.onReceive(context, new Intent(ApkSessionInstaller.ACTION_INSTALL_STATUS)
                .putExtra(ApkSessionInstaller.EXTRA_SESSION_ID, sessionId)
                .putExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_SUCCESS));
        check(prefs(context).getInt(ApkSessionInstaller.KEY_PENDING_SESSION_ID, -1) == -1,
                "successful terminal result must clear the pending session");
        check(!Toast.shown.isEmpty() && Toast.shown.get(Toast.shown.size() - 1).contains("已完成"),
                "success result must be reported as complete");
    }
    private static void unsealedSessionIsAbandonedAndSealedSessionIsReused(Path apkPath) throws Exception {
        Context recovering = new Context();
        PackageInstaller recoverInstaller = recovering.getPackageManager().getPackageInstaller();
        recoverInstaller.seedSession(7, false, false);
        prefs(recovering).edit().putInt(ApkSessionInstaller.KEY_PENDING_SESSION_ID, 7).apply();
        check(ApkSessionInstaller.install(recovering, apkPath.toFile()) == ApkSessionInstaller.Result.STARTED,
                "unsealed orphan session must be replaced");
        check(recoverInstaller.abandonSessionCount == 1 && recoverInstaller.createCount == 1,
                "unsealed orphan must be abandoned before creating a replacement");
        check(prefs(recovering).getInt(ApkSessionInstaller.KEY_PENDING_SESSION_ID, -1) != 7,
                "replacement session ID must replace the orphan ID");

        Context active = new Context();
        PackageInstaller activeInstaller = active.getPackageManager().getPackageInstaller();
        activeInstaller.seedSession(8, true, true);
        prefs(active).edit().putInt(ApkSessionInstaller.KEY_PENDING_SESSION_ID, 8).apply();
        check(ApkSessionInstaller.install(active, apkPath.toFile()) == ApkSessionInstaller.Result.ALREADY_PENDING,
                "sealed and committed session must remain pending without a duplicate install");
        check(activeInstaller.abandonSessionCount == 0 && activeInstaller.createCount == 0,
                "sealed session must not be abandoned or replaced");
    }
    private static void pendingMissingIntentReleasesSession(Path apkPath) throws Exception {
        Context context = new Context();
        PackageInstaller installer = context.getPackageManager().getPackageInstaller();
        ApkSessionInstaller.install(context, apkPath.toFile());
        int sessionId = prefs(context).getInt(ApkSessionInstaller.KEY_PENDING_SESSION_ID, -1);
        new ApkInstallStatusReceiver().onReceive(context, new Intent(ApkSessionInstaller.ACTION_INSTALL_STATUS)
                .putExtra(ApkSessionInstaller.EXTRA_SESSION_ID, sessionId)
                .putExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_PENDING_USER_ACTION));
        check(prefs(context).getInt(ApkSessionInstaller.KEY_PENDING_SESSION_ID, -1) == -1,
                "pending result without confirmation must release its stuck session");
        check(prefs(context).getString(ApkSessionInstaller.KEY_PENDING_USER_ACTION_URI, null) == null,
                "missing confirmation must not leave stale confirmation state");
        check(installer.abandonSessionCount == 1, "unfinishable session must be abandoned");
        check(!Toast.shown.isEmpty() && Toast.shown.get(Toast.shown.size() - 1).contains("不可用"),
                "missing confirmation must report an actionable terminal error");
        check(ApkSessionInstaller.install(context, apkPath.toFile()) == ApkSessionInstaller.Result.STARTED,
                "a later retry must be able to create a replacement session");
        check(installer.createCount == 2, "retry must create exactly one replacement session");
    }
    private static void staleTerminalResultPreservesCurrentSession(Path apkPath) throws Exception {
        Context context = new Context();
        PackageInstaller installer = context.getPackageManager().getPackageInstaller();
        ApkSessionInstaller.install(context, apkPath.toFile());
        int oldSessionId = prefs(context).getInt(ApkSessionInstaller.KEY_PENDING_SESSION_ID, -1);
        ApkSessionInstaller.clearPendingSession(context, oldSessionId);
        ApkSessionInstaller.install(context, apkPath.toFile());
        int currentSessionId = prefs(context).getInt(ApkSessionInstaller.KEY_PENDING_SESSION_ID, -1);
        check(currentSessionId != oldSessionId, "fixture must contain distinct current and old sessions");
        Intent currentConfirmation = new Intent("android.intent.action.CURRENT_CONFIRMATION");
        ApkInstallStatusReceiver receiver = new ApkInstallStatusReceiver();
        receiver.onReceive(context, new Intent(ApkSessionInstaller.ACTION_INSTALL_STATUS)
                .putExtra(ApkSessionInstaller.EXTRA_SESSION_ID, currentSessionId)
                .putExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_PENDING_USER_ACTION)
                .putExtra(Intent.EXTRA_INTENT, currentConfirmation));
        String savedCurrentAction = prefs(context).getString(ApkSessionInstaller.KEY_PENDING_USER_ACTION_URI, null);
        check(savedCurrentAction != null, "current session must have a saved confirmation");
        receiver.onReceive(context, new Intent(ApkSessionInstaller.ACTION_INSTALL_STATUS)
                .putExtra(ApkSessionInstaller.EXTRA_SESSION_ID, oldSessionId)
                .putExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE_ABORTED)
                .putExtra(PackageInstaller.EXTRA_STATUS_MESSAGE, "late old result"));
        check(prefs(context).getInt(ApkSessionInstaller.KEY_PENDING_SESSION_ID, -1) == currentSessionId,
                "stale terminal result must not clear the current session");
        check(savedCurrentAction.equals(prefs(context).getString(ApkSessionInstaller.KEY_PENDING_USER_ACTION_URI, null)),
                "stale terminal result must not clear the current confirmation");
        check(installer.createCount == 2, "stale result must not trigger another installation");
    }
    private static void pendingKeyCommitFailureAbandons(Path apkPath) throws Exception {
        Context context = new Context();
        PackageInstaller installer = context.getPackageManager().getPackageInstaller();
        prefs(context).commitResult = false;
        boolean threw = false;
        try { ApkSessionInstaller.install(context, apkPath.toFile()); }
        catch (java.io.IOException expected) { threw = true; }
        check(threw, "failure to persist session ID must stop installation");
        check(installer.createCount == 1 && installer.abandonSessionCount == 1,
                "session must be abandoned if its ID cannot be persisted");
        check(installer.lastSession.commitCount == 0 && installer.lastSession.bytes.size() == 0,
                "session must not receive APK bytes or commit before durable pending state");
        check(prefs(context).getInt(ApkSessionInstaller.KEY_PENDING_SESSION_ID, -1) == -1,
                "failed persistence must leave no pending session marker");
    }
    private static void signatureCheckAndInstallGate(Path apkPath, byte[] certificate) throws Exception {
        MainActivity activity = new MainActivity();
        activity.configureArchive("com.gomoku.master", certificate);
        MainActivity.sExpectedApkSha256 = MainActivity.sha256File(apkPath.toFile());
        check(activity.isVerifiedApk(apkPath.toFile(), MainActivity.sExpectedApkSha256),
                "matching package, official signing certificate, and SHA must verify");
        check(!activity.isVerifiedApk(apkPath.toFile(), "0".repeat(64)),
                "wrong APK digest must fail verification");
        activity.configureArchive("com.other.package", certificate);
        check(!activity.isVerifiedApk(apkPath.toFile(), MainActivity.sExpectedApkSha256),
                "a differently named package must fail verification even with the trusted signer");
        activity.configureArchive("com.gomoku.master", "untrusted signer".getBytes("UTF-8"));
        check(!activity.isVerifiedApk(apkPath.toFile(), MainActivity.sExpectedApkSha256),
                "an untrusted signing certificate must fail verification");

        MainActivity.resetInstallState();
        MainActivity blocked = new MainActivity();
        Path rejectedPath = apk(Files.readAllBytes(apkPath));
        blocked.configureArchive("com.other.package", certificate);
        MainActivity.sExpectedApkSha256 = MainActivity.sha256File(rejectedPath.toFile());
        Build.VERSION.SDK_INT = 35;
        blocked.installDownloadedApk(rejectedPath.toFile());
        check(blocked.getPackageManager().getPackageInstaller().createCount == 0 && blocked.started.isEmpty(),
                "failed signature/package verification must not enter either installer path");
        check(blocked.failureNotifications == 1 && !MainActivity.sIsInstalling,
                "verification failure must terminate and release the install lock");
        Files.deleteIfExists(rejectedPath);
    }
    private static void deniedUnknownSourceReturnUnlocksInstall(Path apkPath, byte[] certificate) throws Exception {
        MainActivity.resetInstallState();
        Build.VERSION.SDK_INT = 30;
        MainActivity activity = new MainActivity();
        activity.configureArchive("com.gomoku.master", certificate);
        MainActivity.sExpectedApkSha256 = MainActivity.sha256File(apkPath.toFile());
        activity.getPackageManager().canRequestPackageInstalls = false;
        activity.installDownloadedApk(apkPath.toFile());
        check(MainActivity.sIsInstalling && MainActivity.sWaitingForInstallPermission,
                "opening unknown-source settings must reserve the active attempt");
        check(activity.started.size() == 1, "unknown-source settings must be opened");
        activity.runResumeInstallBranch();
        check(!MainActivity.sIsInstalling && !MainActivity.sWaitingForInstallPermission,
                "returning without permission must unlock future attempts");
        check(MainActivity.sLastDownloadedFile == null,
                "returning without permission must clear the stale waiting-file pointer");
        activity.installDownloadedApk(apkPath.toFile());
        check(activity.started.size() == 2 && MainActivity.sIsInstalling,
                "a later retry must be able to open settings again");
    }
    private static void legacyAndModernApiRoutes(Path apkPath, byte[] certificate) throws Exception {
        MainActivity.resetInstallState();
        MainActivity legacy = new MainActivity();
        legacy.configureArchive("com.gomoku.master", certificate);
        MainActivity.sExpectedApkSha256 = MainActivity.sha256File(apkPath.toFile());
        Build.VERSION.SDK_INT = 30;
        legacy.installDownloadedApk(apkPath.toFile());
        check(legacy.started.size() == 1 && Intent.ACTION_VIEW.equals(legacy.started.get(0).getAction()),
                "pre-Android 12 updates must retain the ACTION_VIEW installer");
        check((legacy.started.get(0).getFlags() & Intent.FLAG_GRANT_READ_URI_PERMISSION) != 0,
                "legacy installer must receive read access to the APK content URI");
        check(MainActivity.sWaitingForInstallerReturn, "legacy installer return must release the in-progress guard on resume");
        check(legacy.getPackageManager().getPackageInstaller().createCount == 0,
                "pre-Android 12 must not create a PackageInstaller session");

        MainActivity.resetInstallState();
        MainActivity modern = new MainActivity();
        modern.configureArchive("com.gomoku.master", certificate);
        MainActivity.sExpectedApkSha256 = MainActivity.sha256File(apkPath.toFile());
        Build.VERSION.SDK_INT = 35;
        modern.installDownloadedApk(apkPath.toFile());
        long deadline = System.nanoTime() + java.util.concurrent.TimeUnit.SECONDS.toNanos(3);
        while ((modern.getPackageManager().getPackageInstaller().createCount == 0 || MainActivity.sIsInstalling)
                && System.nanoTime() < deadline) Thread.sleep(2);
        PackageInstaller installer = modern.getPackageManager().getPackageInstaller();
        check(installer.createCount == 1 && installer.lastSession.commitCount == 1,
                "Android 12+ install method must route through a committed PackageInstaller session");
        check(modern.started.isEmpty(), "Android 12+ must not launch the legacy ACTION_VIEW installer");
        check(!MainActivity.sIsInstalling, "finished session submission must release the activity install guard");
    }
    private static final class MainActivity extends Activity {
        private static final Object sDownloadLock = new Object();
        private static final int MAX_APK_BYTES = 50 * 1024 * 1024;
        private static final String OFFICIAL_SIGNATURE_SHA256 = "__OFFICIAL_SIGNATURE_SHA256__";
        private static boolean sIsInstalling, sWaitingForInstallPermission, sWaitingForInstallerReturn;
        private static File sLastDownloadedFile;
        private static String sExpectedApkSha256;
        int failureNotifications;
        MainActivity() { super(); }
        void configureArchive(String packageName, byte[] certificate) {
            PackageInfo info = new PackageInfo();
            info.packageName = packageName;
            Signature signature = new Signature(certificate);
            info.signatures = new Signature[] { signature };
            info.signingInfo = new SigningInfo(info.signatures);
            getPackageManager().archivePackageInfo = info;
        }
        void notifyWebDownloadFailure(String message) { failureNotifications++; }
        void notifyWebProgress(int percent, String status) {}
        void runOnUiThread(Runnable action) { action.run(); }
        private static void setInstallInProgress(boolean installing) {
__SET_INSTALLING_BODY__
        }
        private void installDownloadedApk(File apkFile) {
__INSTALL_BODY__
        }
        private void launchLegacyApkInstaller(File apkFile) {
__LEGACY_BODY__
        }
        private void runResumeInstallBranch() {
__RESUME_BODY__
        }
        private boolean checkSignatureHash(Signature sig) {
__CHECK_SIGNATURE_BODY__
        }
        private static String sha256File(File file) throws Exception {
__SHA256_BODY__
        }
        private boolean verifyDownloadedApkSignature(File apkFile) {
__VERIFY_SIGNATURE_BODY__
        }
        private boolean isVerifiedApk(File apkFile, String expectedSha256) {
__VERIFY_APK_BODY__
        }
        private static void resetInstallState() {
            sIsInstalling = false; sWaitingForInstallPermission = false; sWaitingForInstallerReturn = false;
            sLastDownloadedFile = null; sExpectedApkSha256 = null;
        }
    }
    public static void main(String[] args) throws Exception {
        Build.VERSION.SDK_INT = 35;
        byte[] content = new byte[512 * 1024 + 7];
        for (int i = 0; i < content.length; i++) content[i] = (byte) (i * 31);
        Path apkPath = apk(content);
        try {
            byte[] certificate = "gomoku-test-official-signing-certificate".getBytes("UTF-8");
            successAndDuplicate(apkPath, content);
            writeFailureAbandons(apkPath);
            commitFailureAbandons(apkPath);
            pendingActionAndFailureFinish(apkPath);
            successResultFinishes(apkPath);
            unsealedSessionIsAbandonedAndSealedSessionIsReused(apkPath);
            pendingMissingIntentReleasesSession(apkPath);
            staleTerminalResultPreservesCurrentSession(apkPath);
            pendingKeyCommitFailureAbandons(apkPath);
            signatureCheckAndInstallGate(apkPath, certificate);
            deniedUnknownSourceReturnUnlocksInstall(apkPath, certificate);
            legacyAndModernApiRoutes(apkPath, certificate);
        } finally { Files.deleteIfExists(apkPath); }
        System.out.println("Android self-update JVM smoke passed: session copy/commit, duplicate suppression, failure abandon, sealed recovery, pending confirmation/missing intent, stale result isolation, signature/package gate, API routing, permission-denial retry state");
    }
}'''


def test_manifest_security_boundary():
    manifest = ET.parse(ROOT / "android_src/AndroidManifest.xml").getroot()
    permissions = {node.attrib.get(ANDROID_NS + "name") for node in manifest.findall("uses-permission")}
    assert "android.permission.UPDATE_PACKAGES_WITHOUT_USER_ACTION" in permissions
    application = manifest.find("application")
    receiver = next(node for node in application.findall("receiver")
                    if node.attrib.get(ANDROID_NS + "name") == "com.gomoku.master.ApkInstallStatusReceiver")
    assert receiver.attrib.get(ANDROID_NS + "exported") == "false"


def test_production_helper_and_receiver_on_jvm():
    with tempfile.TemporaryDirectory(prefix="gomoku-self-update-jvm-") as directory:
        temp = Path(directory)
        sources = []
        for relative, content in STUBS.items():
            path = temp / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content, encoding="utf-8")
            sources.append(str(path))
        production = ROOT / "android_src/src/com/gomoku/master"
        for filename in ("ApkSessionInstaller.java", "ApkInstallStatusReceiver.java"):
            target = temp / PACKAGE / filename
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(production / filename, target)
            sources.append(str(target))
        activity_source = (production / "MainActivity.java").read_text(encoding="utf-8")
        declarations = {
            "SET_INSTALLING_BODY": "    private static void setInstallInProgress(boolean installing) {",
            "INSTALL_BODY": "    private void installDownloadedApk(File apkFile) {",
            "LEGACY_BODY": "    private void launchLegacyApkInstaller(File apkFile) {",
            "CHECK_SIGNATURE_BODY": "    private boolean checkSignatureHash(android.content.pm.Signature sig) {",
            "SHA256_BODY": "    private static String sha256File(File file) throws Exception {",
            "VERIFY_SIGNATURE_BODY": "    private boolean verifyDownloadedApkSignature(File apkFile) {",
            "VERIFY_APK_BODY": "    private boolean isVerifiedApk(File apkFile, String expectedSha256) {",
        }
        replacements = {key: method_body(activity_source, declaration)
                        for key, declaration in declarations.items()}
        replacements["RESUME_BODY"] = between_source(
            activity_source,
            "        // 如果是从系统授权页面返回且已获得安装权限",
            "        ApkInstallStatusReceiver.launchPendingUserAction(this);",
        )
        replacements["OFFICIAL_SIGNATURE_SHA256"] = __import__("hashlib").sha256(
            b"gomoku-test-official-signing-certificate").hexdigest()
        harness = temp / PACKAGE / "ApkInstallBehaviorTest.java"
        generated = HARNESS
        for key, value in replacements.items():
            placeholder = "__" + key + "__"
            generated = generated.replace(placeholder, value)
        harness.write_text(generated, encoding="utf-8")
        sources.append(str(harness))
        subprocess.run(["javac", "-encoding", "UTF-8", "-d", str(temp), *sources], check=True)
        subprocess.run(["java", "-cp", str(temp), "com.gomoku.master.ApkInstallBehaviorTest"],
                       check=True, timeout=20)


def between_source(source, start, end):
    begin = source.index(start)
    finish = source.index(end, begin)
    return source[begin:finish] + end


def method_body(source, declaration):
    method = extract_method(source, declaration)
    opening = method.index("{")
    return method[opening + 1:-1]


def extract_method(source, declaration):
    begin = source.index(declaration)
    opening = source.index("{", begin)
    depth = 0
    index = opening
    in_string = in_char = in_line_comment = in_block_comment = escaped = False
    while index < len(source):
        char = source[index]
        following = source[index + 1] if index + 1 < len(source) else ""
        if in_line_comment:
            if char == "\n": in_line_comment = False
        elif in_block_comment:
            if char == "*" and following == "/": in_block_comment = False; index += 1
        elif in_string or in_char:
            if escaped: escaped = False
            elif char == "\\": escaped = True
            elif (in_string and char == '"') or (in_char and char == "'"):
                in_string = in_char = False
        elif char == "/" and following == "/": in_line_comment = True; index += 1
        elif char == "/" and following == "*": in_block_comment = True; index += 1
        elif char == '"': in_string = True
        elif char == "'": in_char = True
        elif char == "{": depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0: return source[begin:index + 1]
        index += 1
    raise AssertionError(f"unterminated Java method: {declaration}")


if __name__ == "__main__":
    test_manifest_security_boundary()
    test_production_helper_and_receiver_on_jvm()
