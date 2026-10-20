package com.gomoku.master;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInstaller;
import android.os.Build;
import android.widget.Toast;

/** Receives installer results even when MainActivity is paused or the app process was recreated. */
public final class ApkInstallStatusReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || !ApkSessionInstaller.ACTION_INSTALL_STATUS.equals(intent.getAction())) return;

        int sessionId = intent.getIntExtra(ApkSessionInstaller.EXTRA_SESSION_ID,
                intent.getIntExtra(PackageInstaller.EXTRA_SESSION_ID, -1));
        SharedPreferences preferences = context.getApplicationContext().getSharedPreferences(
                ApkSessionInstaller.PREFS_NAME, Context.MODE_PRIVATE);
        if (sessionId < 0 || preferences.getInt(ApkSessionInstaller.KEY_PENDING_SESSION_ID, -1) != sessionId) return;

        int status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS,
                PackageInstaller.STATUS_FAILURE);
        if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
            Intent confirmationIntent = getConfirmationIntent(intent);
            if (confirmationIntent == null || !savePendingUserAction(context, confirmationIntent)) {
                try { context.getPackageManager().getPackageInstaller().abandonSession(sessionId); }
                catch (Exception ignored) {}
                clearPendingUserAction(context);
                ApkSessionInstaller.clearPendingSession(context, sessionId);
                Toast.makeText(context.getApplicationContext(),
                        "系统要求确认但确认入口不可用，请重新检查更新", Toast.LENGTH_LONG).show();
                return;
            }
            // MainActivity receives this only while resumed; otherwise the saved intent is
            // launched from its next onResume after process/background restoration.
            Intent resumeIntent = new Intent(ApkSessionInstaller.ACTION_RESUME_USER_ACTION)
                    .setPackage(context.getPackageName());
            context.sendBroadcast(resumeIntent);
            return;
        }

        clearPendingUserAction(context);
        ApkSessionInstaller.clearPendingSession(context, sessionId);
        if (status == PackageInstaller.STATUS_SUCCESS) {
            Toast.makeText(context.getApplicationContext(), "更新已完成", Toast.LENGTH_LONG).show();
        } else {
            String message = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE);
            if (message == null || message.trim().isEmpty()) message = "系统安装未完成，请重新检查更新";
            Toast.makeText(context.getApplicationContext(), "更新未完成：" + message, Toast.LENGTH_LONG).show();
        }
    }

    @SuppressWarnings("deprecation")
    private static Intent getConfirmationIntent(Intent statusIntent) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                return statusIntent.getParcelableExtra(Intent.EXTRA_INTENT, Intent.class);
            }
            return statusIntent.getParcelableExtra(Intent.EXTRA_INTENT);
        } catch (RuntimeException ignored) {
            return null;
        }
    }

    private static boolean savePendingUserAction(Context context, Intent confirmationIntent) {
        String serialized;
        try {
            serialized = confirmationIntent.toUri(Intent.URI_INTENT_SCHEME);
        } catch (RuntimeException error) {
            return false;
        }
        if (serialized == null || serialized.isEmpty()) return false;
        return context.getApplicationContext().getSharedPreferences(ApkSessionInstaller.PREFS_NAME, Context.MODE_PRIVATE)
                .edit().putString(ApkSessionInstaller.KEY_PENDING_USER_ACTION_URI, serialized).commit();
    }

    private static void clearPendingUserAction(Context context) {
        context.getApplicationContext().getSharedPreferences(ApkSessionInstaller.PREFS_NAME, Context.MODE_PRIVATE)
                .edit().remove(ApkSessionInstaller.KEY_PENDING_USER_ACTION_URI).commit();
    }

    static boolean launchPendingUserAction(android.app.Activity activity) {
        SharedPreferences preferences = activity.getApplicationContext().getSharedPreferences(
                ApkSessionInstaller.PREFS_NAME, Context.MODE_PRIVATE);
        String serialized = preferences.getString(ApkSessionInstaller.KEY_PENDING_USER_ACTION_URI, null);
        if (serialized == null || serialized.isEmpty()) return false;
        try {
            Intent confirmationIntent = Intent.parseUri(serialized, Intent.URI_INTENT_SCHEME);
            activity.startActivity(confirmationIntent);
            preferences.edit().remove(ApkSessionInstaller.KEY_PENDING_USER_ACTION_URI).commit();
            return true;
        } catch (Exception error) {
            // Keep the saved action so the next foreground resume can retry it.
            return false;
        }
    }
}
