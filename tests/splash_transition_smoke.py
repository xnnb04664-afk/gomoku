"""Run the actual native splash dismissal/texture helper on the host JVM.

UI objects are test doubles; this checks lifecycle and resource ordering, not
GPU frame rate or Android's physical rendering.
"""
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
activity = (ROOT / 'android_src/src/com/gomoku/master/MainActivity.java').read_text(encoding='utf-8')
splash = (ROOT / 'android_src/src/com/gomoku/master/GomokuSplashView.java').read_text(encoding='utf-8')


def section(source, start, end):
    offset = source.index(start)
    return source[offset:source.index(end, offset + len(start))]


dismiss = section(activity, '    private void dismissNativeSplash() {', '    private void requestNativeSplashDismiss() {')
prepare = section(splash, '    private static void prepareBitmapForDrawing(', '    private final class SceneLayer')
destroy = section(activity, '    protected void onDestroy()', '        mRootLayout = null;')
destroy = destroy[destroy.index('        if (mSplashView != null) {'):]
java = r'''
public class SplashTransitionSmoke {
    static class View { static final int GONE = 8; }
    static class Handler { void removeCallbacks(Runnable r) {} }
    static class Root { int removed; void removeView(GomokuSplashView view) { removed++; } }
    static class FakeAnimator {
        int starts, cancels; long duration; float alpha; Runnable end;
        FakeAnimator alpha(float value) { alpha=value; return this; }
        FakeAnimator setDuration(long value) { duration=value; return this; }
        FakeAnimator withEndAction(Runnable value) { end=value; return this; }
        void start() { starts++; }
        void cancel() { cancels++; }
        void finish() { if (end!=null) end.run(); }
    }
    static class GomokuSplashView {
        FakeAnimator animation = new FakeAnimator(); int stops, visibility; long duration=180;
        FakeAnimator animate() { return animation; }
        long getDismissDurationMs() { return duration; }
        void stopAnimation() { stops++; }
        void setVisibility(int value) { visibility=value; }
    }
    static class Bitmap {
        boolean recycled, fail; int preparations;
        boolean isRecycled() { return recycled; }
        void prepareToDraw() { preparations++; if(fail) throw new IllegalStateException("GPU hint failed"); }
    }
    GomokuSplashView mSplashView = new GomokuSplashView();
    boolean mNativeSplashDismissing, mHasVisibleWebContent, mDestroyed;
    long mNativeSplashStartedAt = 123;
    Handler mMainHandler = new Handler(); Root mRootLayout = new Root();
    Runnable mSplashLoadWarning=()->{}, mSplashContentDismiss=()->{};
''' + dismiss + prepare + '''
    void destroy() { mDestroyed=true;
''' + destroy + r'''
        mRootLayout=null;
    }
    static void check(boolean ok, String message) { if(!ok) throw new AssertionError(message); }
    public static void main(String[] args) {
        SplashTransitionSmoke page = new SplashTransitionSmoke();
        GomokuSplashView overlay=page.mSplashView; Root root=page.mRootLayout;
        page.dismissNativeSplash();
        check(overlay.animation.starts==0, "early tap must not expose uncommitted WebView");
        page.mHasVisibleWebContent=true;
        page.dismissNativeSplash(); page.dismissNativeSplash();
        check(overlay.animation.starts==1, "repeat dismiss must not restart the fade");
        check(overlay.animation.duration==180 && overlay.animation.alpha==0f, "short opacity transition");
        check(overlay.stops==0 && root.removed==0 && page.mSplashView==overlay, "keep textures and overlay until fade completes");
        overlay.animation.finish(); overlay.animation.finish();
        check(overlay.stops==1 && root.removed==1 && page.mSplashView==null, "release/remove exactly once after final frame");
        check(!page.mNativeSplashDismissing && overlay.visibility==View.GONE, "completed state");

        SplashTransitionSmoke destroyed = new SplashTransitionSmoke();
        destroyed.mHasVisibleWebContent=true;
        GomokuSplashView old=destroyed.mSplashView;
        destroyed.dismissNativeSplash(); destroyed.destroy(); old.animation.finish();
        check(old.animation.cancels==1 && old.stops==1 && destroyed.mSplashView==null, "destroy cancels fade and stale completion does not double-release");

        SplashTransitionSmoke replaced = new SplashTransitionSmoke();
        replaced.mHasVisibleWebContent=true;
        GomokuSplashView previous=replaced.mSplashView;
        replaced.dismissNativeSplash();
        GomokuSplashView next=new GomokuSplashView(); replaced.mSplashView=next;
        previous.animation.finish();
        check(replaced.mSplashView==next && next.stops==0, "stale completion cannot remove another overlay");

        SplashTransitionSmoke reduced = new SplashTransitionSmoke();
        reduced.mHasVisibleWebContent=true; reduced.mSplashView.duration=0;
        reduced.dismissNativeSplash();
        check(reduced.mSplashView.animation.duration==0, "reduced-motion transition remains immediate");

        Bitmap valid=new Bitmap(), recycled=new Bitmap(), failed=new Bitmap();
        recycled.recycled=true; failed.fail=true;
        prepareBitmapForDrawing(null); prepareBitmapForDrawing(recycled);
        prepareBitmapForDrawing(valid); prepareBitmapForDrawing(failed);
        check(valid.preparations==1 && recycled.preparations==0 && failed.preparations==1, "optional upload hint handles missing/recycled/failing textures");
        System.out.println("PASS: actual native fade lifecycle, deferred release, stale callbacks, reduced motion and optional texture preparation");
    }
}
'''

with tempfile.TemporaryDirectory(prefix='gomoku-splash-jvm-') as directory:
    folder = Path(directory)
    (folder / 'SplashTransitionSmoke.java').write_text(java, encoding='utf-8')
    log = folder / 'android/util/Log.java'
    log.parent.mkdir(parents=True)
    log.write_text('package android.util; public class Log { public static int w(String a,String b,Throwable c){return 0;} }', encoding='utf-8')
    jdk = Path('C:/Program Files/Eclipse Adoptium/jdk-17.0.20.101-hotspot/bin')
    subprocess.run([str(jdk / 'javac.exe'), '-encoding', 'UTF-8', '-d', str(folder), str(log), str(folder / 'SplashTransitionSmoke.java')], check=True)
    subprocess.run([str(jdk / 'java.exe'), '-cp', str(folder), 'SplashTransitionSmoke'], check=True)
