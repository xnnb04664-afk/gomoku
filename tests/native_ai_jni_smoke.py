"""Run the real Java/native AI boundary on the host JVM, without Android data.

Requires a full JDK and clang++. This verifies JNI binding and fallback; it does
not measure Android response time. Generated files stay in .codex-diagnostics.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
import shutil
import subprocess


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / ".codex-diagnostics/ai-speed-20261019/jni-smoke"
java_home = Path(os.environ.get("JAVA_HOME", ""))
JDK = java_home if (java_home / "include/jni.h").is_file() else Path("C:/Program Files/Eclipse Adoptium/jdk-17.0.20.101-hotspot")
if not (JDK / "include/jni.h").is_file():
    raise RuntimeError("A full JDK with JNI headers is required")
compiler = shutil.which("clang++")
if not compiler:
    raise RuntimeError("clang++ is required")
OUT.mkdir(parents=True, exist_ok=True)
package = OUT / "src/com/gomoku/master"
package.mkdir(parents=True, exist_ok=True)
log_dir = OUT / "src/android/util"
log_dir.mkdir(parents=True, exist_ok=True)
(log_dir / "Log.java").write_text("""
package android.util;
public final class Log {
    public static int w(String tag, String message) { return 0; }
    public static int w(String tag, String message, Throwable error) { return 0; }
}
""", encoding="utf-8")
shutil.copyfile(ROOT / "android_src/src/com/gomoku/master/NativeGomokuAI.java", package / "NativeGomokuAI.java")
(package / "NativeAiJniSmoke.java").write_text("""
package com.gomoku.master;
import java.util.Arrays;
public final class NativeAiJniSmoke {
    static void check(boolean ok, String message) {
        if (!ok) throw new AssertionError(message);
    }
    public static void main(String[] args) {
        boolean cpp = args[0].equals("cpp");
        check(NativeGomokuAI.warmUp() == cpp, "warmup engine availability");
        check(!NativeGomokuAI.warmUp(), "warmup must execute once");
        int[] board = new int[225];
        board[7 * 15 + 2] = 1;
        for (int c = 3; c <= 6; ++c) board[7 * 15 + c] = 2;
        int[] original = board.clone();
        NativeGomokuAI.Move move = NativeGomokuAI.chooseMove(board, 2, new boolean[225]);
        check(move != null && move.r == 7 && move.c == 7, "immediate winning move");
        check(move.engine.equals(cpp ? "cpp" : "java"), "actual engine tag");
        check(Arrays.equals(board, original), "JNI must not mutate the input board");
        int[] blackBoard = new int[225];
        blackBoard[7 * 15 + 2] = 2;
        for (int c = 3; c <= 6; ++c) blackBoard[7 * 15 + c] = 1;
        NativeGomokuAI.Move blackMove = NativeGomokuAI.chooseMove(blackBoard, 1, new boolean[225]);
        check(blackMove != null && blackMove.r == 7 && blackMove.c == 7, "black AI immediate winning move");
        check(blackMove.engine.equals(cpp ? "cpp" : "java"), "black AI engine tag");
        check(NativeGomokuAI.chooseMove(new int[224], 2, null) == null, "invalid board size");
        board[0] = 3;
        check(NativeGomokuAI.chooseMove(board, 2, null) == null, "invalid board value");
        System.out.println("JNI_SMOKE_PASS:" + move.engine);
    }
}
""", encoding="utf-8")


def run(args: list[str], timeout: int = 60) -> str:
    result = subprocess.run(args, capture_output=True, text=True, errors="replace", timeout=timeout)
    if result.returncode:
        raise RuntimeError(f"Command failed: {args!r}\n{result.stdout}\n{result.stderr}")
    return result.stdout + result.stderr


lib_dir = OUT / "native"
empty_dir = OUT / "no-native"
classes = OUT / "classes"
for directory in (lib_dir, empty_dir, classes):
    directory.mkdir(exist_ok=True)
platform = "win32" if os.name == "nt" else "linux"
library = lib_dir / ("gomoku_ai.dll" if os.name == "nt" else "libgomoku_ai.so")
run([compiler, "-std=c++17", "-O3", "-shared", "-static-libstdc++", "-static-libgcc",
     "-ffunction-sections", "-fdata-sections", "-Wl,--gc-sections",
     *([] if os.name == "nt" else ["-Wl,--exclude-libs,ALL"]),  # ELF-only; APK exports are checked separately.
     *([] if os.name == "nt" else ["-fPIC"]),
     "-I", str(JDK / "include"), "-I", str(JDK / "include" / platform),
     str(ROOT / "android_src/cpp/gomoku_ai.cpp"), "-o", str(library)])
suffix = ".exe" if os.name == "nt" else ""
run([str(JDK / "bin" / ("javac" + suffix)), "-encoding", "UTF-8", "-d", str(classes),
     str(log_dir / "Log.java"), str(package / "NativeGomokuAI.java"), str(package / "NativeAiJniSmoke.java")])
for mode, path in (("cpp", lib_dir), ("java", empty_dir)):
    output = run([str(JDK / "bin" / ("java" + suffix)), "-Xlog:class+init=info",
                  f"-Djava.library.path={path}", "-cp", str(classes), "com.gomoku.master.NativeAiJniSmoke", mode])
    assert f"JNI_SMOKE_PASS:{mode}" in output
    fallback_initialized = "Initializing 'com/gomoku/master/NativeGomokuAI$FallbackHolder'" in output
    assert fallback_initialized == (mode == "java"), "Java-only large tables must initialize only for fallback"
print(json.dumps({"realJniBoundary": True, "cppMove": True, "javaFallback": True,
                  "warmupOnce": True, "javaTablesLazy": True, "inputUnchanged": True,
                  "deviceAcceptance": False}))
