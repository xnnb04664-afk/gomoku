package com.gomoku.master;

import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInstaller;
import android.os.Build;

import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;

/** Installs an already verified update APK through PackageInstaller on Android 12+. */
final class ApkSessionInstaller {
    enum Result { STARTED, ALREADY_PENDING }

    static final String PREFS_NAME = "apk_session_install";
    static final String KEY_PENDING_SESSION_ID = "pending_session_id";
    static final String KEY_PENDING_USER_ACTION_URI = "pending_user_action_uri";
    static final String ACTION_INSTALL_STATUS = "com.gomoku.master.action.INSTALL_STATUS";
    static final String ACTION_RESUME_USER_ACTION = "com.gomoku.master.action.RESUME_INSTALL_USER_ACTION";
    static final String EXTRA_SESSION_ID = "com.gomoku.master.extra.INSTALL_SESSION_ID";

    private static final Object INSTALL_LOCK = new Object();

    private ApkSessionInstaller() {}

    static Result install(Context context, File apkFile) throws Exception {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
            throw new IllegalStateException("PackageInstaller silent update requires Android 12+");
        }
        if (context == null || apkFile == null || !apkFile.isFile() || !apkFile.canRead()) {
            throw new IllegalArgumentException("Verified update APK is unavailable");
        }

        Context appContext = context.getApplicationContext();
        PackageInstaller installer = appContext.getPackageManager().getPackageInstaller();
        SharedPreferences preferences = appContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        synchronized (INSTALL_LOCK) {
            int existingSessionId = preferences.getInt(KEY_PENDING_SESSION_ID, -1);
            if (existingSessionId >= 0) {
                PackageInstaller.SessionInfo existingSession = installer.getSessionInfo(existingSessionId);
                if (existingSession != null && existingSession.isSealed() && existingSession.isCommitted()) {
                    return Result.ALREADY_PENDING;
                }
                if (existingSession != null) {
                    // The process may have died before commit(). An unsealed session cannot
                    // finish on its own, so abandon it before retrying the verified APK.
                    installer.abandonSession(existingSessionId);
                }
                preferences.edit().remove(KEY_PENDING_SESSION_ID).commit();
            }

            PackageInstaller.SessionParams params = new PackageInstaller.SessionParams(
                    PackageInstaller.SessionParams.MODE_FULL_INSTALL);
            params.setAppPackageName(appContext.getPackageName());
            params.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED);

            int sessionId = installer.createSession(params);
            if (!preferences.edit().putInt(KEY_PENDING_SESSION_ID, sessionId).commit()) {
                try { installer.abandonSession(sessionId); } catch (Exception ignored) {}
                preferences.edit().remove(KEY_PENDING_SESSION_ID).commit();
                throw new IOException("Could not persist the update session identifier");
            }
            PackageInstaller.Session session = null;
            boolean committed = false;
            try {
                session = installer.openSession(sessionId);
                try (InputStream input = new FileInputStream(apkFile);
                     OutputStream output = session.openWrite("base.apk", 0, apkFile.length())) {
                    byte[] buffer = new byte[64 * 1024];
                    int length;
                    while ((length = input.read(buffer)) != -1) output.write(buffer, 0, length);
                    session.fsync(output);
                }

                Intent statusIntent = new Intent(appContext, ApkInstallStatusReceiver.class)
                        .setAction(ACTION_INSTALL_STATUS)
                        .putExtra(EXTRA_SESSION_ID, sessionId);
                PendingIntent statusPendingIntent = PendingIntent.getBroadcast(
                        appContext,
                        sessionId,
                        statusIntent,
                        PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_MUTABLE);
                session.commit(statusPendingIntent.getIntentSender());
                committed = true;
                return Result.STARTED;
            } catch (Exception error) {
                try {
                    if (session != null) session.abandon();
                    else installer.abandonSession(sessionId);
                } catch (Exception abandonError) {
                    error.addSuppressed(abandonError);
                }
                preferences.edit().remove(KEY_PENDING_SESSION_ID).commit();
                throw error;
            } finally {
                if (session != null) {
                    try { session.close(); } catch (Exception ignored) {}
                }
                if (!committed) preferences.edit().remove(KEY_PENDING_SESSION_ID).commit();
            }
        }
    }

    static void clearPendingSession(Context context, int sessionId) {
        if (context == null || sessionId < 0) return;
        SharedPreferences preferences = context.getApplicationContext()
                .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        synchronized (INSTALL_LOCK) {
            if (preferences.getInt(KEY_PENDING_SESSION_ID, -1) == sessionId) {
                preferences.edit().remove(KEY_PENDING_SESSION_ID).commit();
            }
        }
    }
}
