"""Execute the production warmup scheduler on a real bounded Java executor.

Only Android UI types are omitted. Scheduler methods and lifecycle entry/exit
statements are copied from MainActivity at test time, so assertions exercise
the current implementation rather than a second version of its state machine.
"""
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
activity = (ROOT / 'android_src/src/com/gomoku/master/MainActivity.java').read_text(encoding='utf-8')


def between(text, start, end):
    a = text.index(start)
    return text[a:text.index(end, a + len(start))]


executor = between(activity, '    private final ThreadPoolExecutor mNativeAiExecutor =', '    private boolean mNativeAiWarmUpWanted')
warmup_fields = next(line for line in activity.splitlines() if 'private boolean mNativeAiWarmUpWanted' in line)
scheduler = between(activity, '    private synchronized boolean requestNativeAiWarmUp()', '    private boolean enqueueNativeAiMove(')
resume = between(activity, '    protected void onResume()', '        mWebMusicLifecycleGeneration++;').split('super.onResume();', 1)[1]
pause = between(activity, '    protected void onPause()', '        final int generation =').split('{', 1)[1]
destroy = between(activity, '    protected void onDestroy()', '        mMainHandler.removeCallbacks(mInitializeWebViewTask);').split('{', 1)[1]

harness = '''
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;
public class MainActivity {
    private volatile boolean mActivityResumed, mDestroyed;
    private final ConcurrentHashMap<String, Boolean> mPendingNativeAiRequests = new ConcurrentHashMap<>();
''' + executor + warmup_fields + '\n' + scheduler + '\nvoid resume() {' + resume + '\n}\nvoid pause() {' + pause + '\n}\nvoid destroy() {' + destroy + '''
}
    static final AtomicInteger warms = new AtomicInteger();
    static final AtomicInteger active = new AtomicInteger();
    static final AtomicBoolean overlap = new AtomicBoolean();
    static final class NativeGomokuAI {
        static void warmUp() {
            if (active.incrementAndGet() != 1) overlap.set(true);
            warms.incrementAndGet();
            active.decrementAndGet();
        }
    }
    static void check(boolean ok, String message) { if (!ok) throw new AssertionError(message); }
    static void idle(MainActivity activity) throws Exception {
        long until = System.nanoTime() + TimeUnit.SECONDS.toNanos(3);
        while ((activity.mNativeAiExecutor.getActiveCount() != 0 || !activity.mNativeAiExecutor.getQueue().isEmpty()) && System.nanoTime() < until) Thread.sleep(1);
        check(activity.mNativeAiExecutor.getActiveCount() == 0 && activity.mNativeAiExecutor.getQueue().isEmpty(), "executor did not settle");
    }
    static CountDownLatch block(MainActivity activity) throws Exception {
        CountDownLatch entered = new CountDownLatch(1), release = new CountDownLatch(1);
        activity.mNativeAiExecutor.execute(() -> {
            if (active.incrementAndGet() != 1) overlap.set(true);
            entered.countDown();
            try { release.await(); } catch (InterruptedException stopped) { Thread.currentThread().interrupt(); }
            finally { active.decrementAndGet(); activity.scheduleNativeAiWarmUp(); }
        });
        check(entered.await(3, TimeUnit.SECONDS), "blocking move did not enter");
        return release;
    }
    public static void main(String[] args) throws Exception {
        MainActivity deferred = new MainActivity();
        check(deferred.requestNativeAiWarmUp(), "background request accepted for later");
        idle(deferred);
        check(warms.get() == 0, "background request must not run");
        deferred.resume(); idle(deferred);
        check(warms.get() == 1, "resume must run pending warmup");
        deferred.requestNativeAiWarmUp(); deferred.resume(); idle(deferred);
        check(warms.get() == 1, "warmup must be idempotent");
        deferred.destroy();
        check(!deferred.requestNativeAiWarmUp(), "destroyed activity rejects requests");

        MainActivity pausedQueue = new MainActivity(); pausedQueue.resume();
        CountDownLatch release = block(pausedQueue);
        pausedQueue.requestNativeAiWarmUp(); pausedQueue.pause();
        release.countDown(); idle(pausedQueue);
        check(warms.get() == 1, "warmup queued before pause must defer");
        pausedQueue.resume(); idle(pausedQueue);
        check(warms.get() == 2, "deferred queued warmup must run after resume");
        pausedQueue.destroy();

        MainActivity fullQueue = new MainActivity(); fullQueue.resume();
        release = block(fullQueue);
        AtomicInteger moves = new AtomicInteger();
        fullQueue.mNativeAiExecutor.execute(() -> { moves.incrementAndGet(); fullQueue.scheduleNativeAiWarmUp(); });
        check(fullQueue.requestNativeAiWarmUp(), "full queue still records warmup intent");
        release.countDown(); idle(fullQueue);
        check(warms.get() == 3 && moves.get() == 1, "queue rejection must preserve moves and retry warmup");
        check(!overlap.get(), "warmup and moves must use the same serial executor");
        fullQueue.destroy();

        MainActivity destroyedQueue = new MainActivity(); destroyedQueue.resume();
        release = block(destroyedQueue);
        destroyedQueue.requestNativeAiWarmUp(); destroyedQueue.destroy();
        release.countDown(); idle(destroyedQueue);
        check(warms.get() == 3, "destroy must discard queued warmup");
        System.out.println("Native AI lifecycle smoke passed: deferred, once, serial, bounded queue, pause/resume, destroy");
    }
}
'''

with tempfile.TemporaryDirectory(prefix='gomoku-ai-lifecycle-') as directory:
    temp = Path(directory)
    (temp / 'MainActivity.java').write_text(harness, encoding='utf-8')
    subprocess.run(['javac', '-encoding', 'UTF-8', '-d', str(temp), str(temp / 'MainActivity.java')], check=True)
    subprocess.run(['java', '-cp', str(temp), 'MainActivity'], check=True, timeout=15)
