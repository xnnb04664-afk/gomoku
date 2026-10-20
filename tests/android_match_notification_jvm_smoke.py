"""Run the production matchmaking notification state machine on a plain JVM."""

from pathlib import Path
import subprocess
import tempfile


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "android_src/src/com/gomoku/master/MatchmakingNotificationState.java"


RUNNER = r'''package com.gomoku.master;
public final class MatchmakingNotificationStateSmoke {
    private static void check(boolean condition, String message) {
        if (!condition) throw new AssertionError(message);
    }
    public static void main(String[] args) {
        long start = 1_000_000L;
        MatchmakingNotificationState state = new MatchmakingNotificationState();
        state.restore(false, 0L);
        state.setForeground(true);
        check(state.update(true, start, start), "active match should be accepted");
        MatchmakingNotificationState.Update foreground = state.reconcile(start);
        check(foreground.action == MatchmakingNotificationState.Action.POST, "first state should post");
        check("正在匹配，点击查看".equals(foreground.text), "foreground copy");
        check(foreground.timeoutAfterMs == MatchmakingNotificationState.MAX_DURATION_MS, "one-hour initial timeout");

        state.update(true, start, start + 15 * 60_000L);
        MatchmakingNotificationState.Update duplicate = state.reconcile(start + 15 * 60_000L);
        check(duplicate.action == MatchmakingNotificationState.Action.NONE, "same state must not repost");
        check(duplicate.timeoutAfterMs == 45 * 60_000L, "repeated tick must use original start time");

        state.setForeground(false);
        MatchmakingNotificationState.Update paused = state.reconcile(start + 16 * 60_000L);
        check(paused.action == MatchmakingNotificationState.Action.POST, "foreground transition should update once");
        check("匹配已挂起，点击返回继续".equals(paused.text), "background copy");
        check(state.reconcile(start + 16 * 60_000L).action == MatchmakingNotificationState.Action.NONE,
                "unchanged background state must not repost");

        state.update(false, 0L, start + 17 * 60_000L);
        check(state.reconcile(start + 17 * 60_000L).action == MatchmakingNotificationState.Action.CANCEL,
                "cancel or successful match must clear its notification");
        check(state.reconcile(start + 17 * 60_000L).action == MatchmakingNotificationState.Action.NONE,
                "repeated inactive updates must not repeatedly cancel");

        MatchmakingNotificationState restored = new MatchmakingNotificationState();
        restored.restore(true, start);
        restored.setForeground(false);
        MatchmakingNotificationState.Update lastSecond = restored.reconcile(
                start + MatchmakingNotificationState.MAX_DURATION_MS - 1L);
        check(lastSecond.action == MatchmakingNotificationState.Action.POST && lastSecond.timeoutAfterMs == 1L,
                "restored state retains its original one-hour deadline");
        check(restored.reconcile(start + MatchmakingNotificationState.MAX_DURATION_MS).action
                        == MatchmakingNotificationState.Action.CANCEL,
                "the original one-hour deadline must expire without being extended");

        MatchmakingNotificationState expiredOnRestore = new MatchmakingNotificationState();
        expiredOnRestore.restore(true, start);
        check(expiredOnRestore.reconcile(start + MatchmakingNotificationState.MAX_DURATION_MS).action
                        == MatchmakingNotificationState.Action.CANCEL,
                "expired persisted state must cancel a notification left by the previous process");
        check(expiredOnRestore.reconcile(start + MatchmakingNotificationState.MAX_DURATION_MS).action
                        == MatchmakingNotificationState.Action.NONE,
                "restored expiration cancels only once");

        MatchmakingNotificationState canceledBeforeFirstPost = new MatchmakingNotificationState();
        canceledBeforeFirstPost.restore(true, start);
        canceledBeforeFirstPost.update(false, 0L, start + 1L);
        check(canceledBeforeFirstPost.reconcile(start + 1L).action == MatchmakingNotificationState.Action.CANCEL,
                "restored active state canceled before posting must clear a prior OS notification");
        check(canceledBeforeFirstPost.reconcile(start + 1L).action == MatchmakingNotificationState.Action.NONE,
                "restored cancellation before post is one-shot");

        MatchmakingNotificationState emptyRestore = new MatchmakingNotificationState();
        emptyRestore.restore(false, 0L);
        check(emptyRestore.reconcile(start).action == MatchmakingNotificationState.Action.CANCEL,
                "empty restore clears any stale notification id once");
        check(emptyRestore.reconcile(start).action == MatchmakingNotificationState.Action.NONE,
                "empty restore does not repeatedly cancel");

        check(MatchmakingNotificationState.shouldRequestPermission(true, true), "user start may request permission");
        check(!MatchmakingNotificationState.shouldRequestPermission(true, false), "restore/tick must not prompt");
        check(!MatchmakingNotificationState.shouldRequestPermission(false, true), "inactive state must not prompt");
        check("denied".equals(MatchmakingNotificationState.permissionState(35, false, true, true)),
                "permission denial is reported without changing match state");
        check("granted".equals(MatchmakingNotificationState.permissionState(32, false, true, true)),
                "pre-runtime-permission Android versions remain supported");
        check(MatchmakingNotificationState.shouldOpenMatchStatus(true), "notification route is accepted");
        check(!MatchmakingNotificationState.shouldOpenMatchStatus(false), "unrelated intents are ignored");
        System.out.println("android match notification JVM smoke: PASS");
    }
}'''


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="gomoku-match-notification-") as temp:
        work = Path(temp)
        package = work / "com/gomoku/master"
        package.mkdir(parents=True)
        runner = package / "MatchmakingNotificationStateSmoke.java"
        runner.write_text(RUNNER, encoding="utf-8")
        subprocess.run(
            ["javac", "-encoding", "UTF-8", "-d", str(work), str(SOURCE), str(runner)],
            check=True,
        )
        subprocess.run(
            ["java", "-cp", str(work), "com.gomoku.master.MatchmakingNotificationStateSmoke"],
            check=True,
        )

    activity = (ROOT / "android_src/src/com/gomoku/master/MainActivity.java").read_text(encoding="utf-8")
    manifest = (ROOT / "android_src/AndroidManifest.xml").read_text(encoding="utf-8")
    assert "updateMatchmakingNotification(boolean active, long startedAt, boolean userInitiated)" in activity
    assert "getMatchmakingNotificationPermissionState()" in activity
    assert 'window.__gomokuPendingOpenMatchStatus=true' in activity
    assert "gomoku-match-notification-permission-change" in activity
    assert '"matchmaking_status"' in activity
    assert "IMPORTANCE_LOW" in activity
    assert 'android.permission.POST_NOTIFICATIONS' in manifest
    print("android match notification bridge smoke: PASS")


if __name__ == "__main__":
    main()
