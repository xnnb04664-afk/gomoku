package com.gomoku.master;

/** Small deterministic state machine for the matchmaking status notification. */
final class MatchmakingNotificationState {
    static final long MAX_DURATION_MS = 60L * 60L * 1000L;

    enum Action { NONE, POST, CANCEL }

    static final class Update {
        final Action action;
        final String text;
        final long timeoutAfterMs;

        Update(Action action, String text, long timeoutAfterMs) {
            this.action = action;
            this.text = text;
            this.timeoutAfterMs = timeoutAfterMs;
        }
    }

    private boolean active;
    private boolean foreground;
    private boolean needsInitialCancel;
    private long startedAt;
    private String lastPostedText;

    static boolean shouldRequestPermission(boolean active, boolean userInitiated) {
        return active && userInitiated;
    }

    static boolean shouldOpenMatchStatus(boolean openExtra) {
        return openExtra;
    }

    static String permissionState(int sdkInt, boolean runtimePermissionGranted,
                                  boolean notificationsEnabled, boolean channelEnabled) {
        if ((sdkInt >= 33 && !runtimePermissionGranted) || !notificationsEnabled || !channelEnabled) {
            return "denied";
        }
        return "granted";
    }

    void restore(boolean active, long startedAt) {
        this.active = active && startedAt > 0L;
        this.startedAt = this.active ? startedAt : 0L;
        this.foreground = false;
        this.lastPostedText = null;
        // The OS may still own a notification from the previous process, including
        // on API 21-25 where it cannot expire itself after an hour.
        this.needsInitialCancel = true;
    }

    boolean update(boolean active, long startedAt, long now) {
        if (!active || startedAt <= 0L || startedAt > now
                || now - startedAt >= MAX_DURATION_MS) {
            boolean changed = this.active;
            this.active = false;
            this.startedAt = 0L;
            return changed;
        }
        boolean changed = !this.active || this.startedAt != startedAt;
        this.active = true;
        this.startedAt = startedAt;
        if (changed) this.lastPostedText = null;
        return changed;
    }

    boolean setForeground(boolean foreground) {
        if (this.foreground == foreground) return false;
        this.foreground = foreground;
        return true;
    }

    Update reconcile(long now) {
        if (active && (now < startedAt || now - startedAt >= MAX_DURATION_MS)) {
            active = false;
            startedAt = 0L;
        }
        if (!active) {
            if (lastPostedText == null && !needsInitialCancel) return new Update(Action.NONE, null, 0L);
            lastPostedText = null;
            needsInitialCancel = false;
            return new Update(Action.CANCEL, null, 0L);
        }

        String text = foreground ? "正在匹配，点击查看" : "匹配已挂起，点击返回继续";
        if (text.equals(lastPostedText)) return new Update(Action.NONE, text, remainingMs(now));
        lastPostedText = text;
        needsInitialCancel = false;
        return new Update(Action.POST, text, remainingMs(now));
    }

    boolean isActive() { return active; }
    long getStartedAt() { return startedAt; }
    void invalidatePostedState() { lastPostedText = null; }

    private long remainingMs(long now) {
        long elapsed = Math.max(0L, now - startedAt);
        return Math.max(1L, MAX_DURATION_MS - elapsed);
    }
}
