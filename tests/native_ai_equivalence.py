"""Compare native AI revisions at identical work, without an Android device.

Example: python tests/native_ai_equivalence.py --baseline path/to/gomoku_ai.cpp
Each revision is compiled in its own executable. Only Engine's private access
label is exposed in a generated test copy; production JNI source is also
compiled verbatim. Geometry/tables and one complete search suite are warmed
before allocation counting and timing. No time-budget/depth speedup inference.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import statistics
import subprocess
import time


ROOT = Path(__file__).resolve().parents[1]
HARNESS = r'''
#include <cstdlib>
#include <cstring>
#include <iomanip>
#include <iostream>
#include <new>
#include <stdexcept>
#include <string>
static bool countAllocations = false;
static unsigned long long allocations = 0, allocatedBytes = 0;
void* operator new(std::size_t size) {
    if (countAllocations) { ++allocations; allocatedBytes += size; }
    if (void* p = std::malloc(size ? size : 1)) return p;
    throw std::bad_alloc();
}
void* operator new[](std::size_t size) { return ::operator new(size); }
void operator delete(void* p) noexcept { std::free(p); }
void operator delete[](void* p) noexcept { std::free(p); }
void operator delete(void* p, std::size_t) noexcept { std::free(p); }
void operator delete[](void* p, std::size_t) noexcept { std::free(p); }
// The entire production source follows, including its unmodified JNI body.
@@SOURCE@@

struct Fixture {
    std::array<int, kCells> board{};
    std::array<uint8_t, kCells> forbidden{};
    int color = kBlack;
};
struct Digest {
    uint64_t value = 14695981039346656037ULL;
    template<class T> void add(const T& item) {
        const auto* bytes = reinterpret_cast<const unsigned char*>(&item);
        for (size_t i = 0; i < sizeof(T); ++i) { value ^= bytes[i]; value *= 1099511628211ULL; }
    }
    void candidate(const Candidate& c) {
        add(c.index); add(c.ownPattern); add(c.opponentPattern); add(c.tactical); add(c.score);
    }
    void moves(const std::vector<Candidate>& list) {
        int length = static_cast<int>(list.size()); add(length);
        for (const auto& c : list) candidate(c);
    }
};
uint32_t randomState = 0x10c2026;
int randomIndex(int count = kCells) {
    randomState ^= randomState << 13;
    randomState ^= randomState >> 17;
    randomState ^= randomState << 5;
    return static_cast<int>(randomState % count);
}
void require(bool condition, const char* message) {
    if (!condition) throw std::runtime_error(message);
}
Digest snapshot(Position& p) {
    // Reconstructing independently also detects stale incremental data after undo.
    Position fresh(p.board, p.forbidden);
    require(p.stones == fresh.stones && p.hashA == fresh.hashA && p.hashB == fresh.hashB
        && p.nearTwo == fresh.nearTwo && p.nearThree == fresh.nearThree, "position/undo mismatch");
    Digest d;
    for (int color : {kBlack, kWhite}) {
        for (int i = 0; i < kCells; ++i) if (p.empty(i)) {
            int actual = Engine::analyzeMove(p, i, color);
            int rebuilt = Engine::analyzeMove(fresh, i, color);
            require(actual == rebuilt, "stale analyzeMove after put/remove");
            d.add(i); d.add(actual);
        }
        const int opponent = 3 - color;
        for (int limit : {1, 18, kCandidateLimit}) {
            auto moves = Engine::candidates(p, color, limit);
            Digest a, b; a.moves(moves); b.moves(Engine::candidates(fresh, color, limit));
            require(a.value == b.value, "stale candidate attributes/order");
            d.moves(moves);
            d.moves(Engine::rootCandidates(p, color, opponent, moves));
        }
        double evaluation = Engine::evaluateBoard(p, color, opponent);
        require(evaluation == Engine::evaluateBoard(fresh, color, opponent), "stale evaluation");
        d.add(evaluation);
        d.moves(Engine::winningMoves(p, color));
        d.moves(Engine::forcingCandidates(p, color));
    }
    return d;
}
std::vector<Fixture> searchFixtures() {
    std::vector<Fixture> result(4);
    auto set = [&](int which, int row, int col, int color) { result[which].board[row * kSize + col] = color; };
    set(0,7,7,1); set(0,6,7,2); set(0,8,8,1); set(0,6,6,2);
    for (auto s : {std::array<int,3>{7,7,1}, {7,8,2}, {6,6,1}, {8,8,2},
                   {6,8,1}, {8,6,2}, {5,9,1}, {9,5,2}, {5,5,1}, {9,9,2}}) set(1,s[0],s[1],s[2]);
    result[1].color = kWhite;
    set(2,0,0,1); set(2,0,1,1); set(2,0,2,1); set(2,1,1,2); set(2,2,2,2); set(2,3,3,2);
    result[2].forbidden[3] = 1;
    set(3,7,4,1); set(3,7,5,1); set(3,7,6,1); set(3,6,6,2); set(3,8,6,2); set(3,9,6,2);
    result[3].forbidden[7*kSize+7] = 1; result[3].color = kWhite;
    return result;
}
void regressChoose() {
    Engine engine;
    Fixture f;
    require(engine.chooseMove(f.board, 1, f.forbidden).index == 112, "empty-board center regression");
    f.board[7*kSize+2] = 2;
    for (int col = 3; col <= 6; ++col) f.board[7*kSize+col] = 1;
    auto win = engine.chooseMove(f.board,1,f.forbidden);
    require(win.index == 7*kSize+7 && win.score == kWin && win.depth == 0, "direct win regression");
    f = Fixture{};
    for (int col = 0; col <= 3; ++col) f.board[col] = 2;
    auto block = engine.chooseMove(f.board,1,f.forbidden);
    require(block.index == 4 && block.score == kWin*0.92 && block.depth == 0, "unique block regression");
    std::cout << "{\"kind\":\"choose\",\"empty\":112,\"win\":" << win.index
              << ",\"block\":" << block.index << "}\n";
}
void verifyPatterns() {
    auto fixed = searchFixtures();
    std::vector<Fixture> fixtures = fixed;
    fixtures.push_back(Fixture{});
    Fixture allBlocked; allBlocked.forbidden.fill(1); fixtures.push_back(allBlocked);
    for (int n = 0; n < 16; ++n) {
        Fixture f;
        int stones = n == 15 ? 205 : 1 + randomIndex(72);
        for (int j = 0; j < stones;) { int i = randomIndex(); if (!f.board[i]) { f.board[i] = 1 + j%2; ++j; } }
        for (int j = 0; j < 14; ++j) f.forbidden[randomIndex()] = 1;
        fixtures.push_back(f);
    }
    int snapshots = 0;
    for (size_t n = 0; n < fixtures.size(); ++n) {
        Position p(fixtures[n].board, fixtures[n].forbidden);
        Digest combined;
        auto record = [&]() { auto d = snapshot(p); combined.add(d.value); ++snapshots; };
        record();
        for (int round = 0; round < 3; ++round) {
            std::vector<std::pair<int,int>> undo;
            for (int nesting = 0; nesting < 4; ++nesting) {
                int index = randomIndex();
                for (int scan = 0; scan < kCells && (!p.empty(index) || p.forbidden[index]); ++scan) index = (index+1)%kCells;
                if (!p.empty(index) || p.forbidden[index]) break;
                int color = 1 + randomIndex(2);
                require(p.put(index,color), "legal put failed");
                undo.emplace_back(index,color); record();
            }
            while (!undo.empty()) { auto move = undo.back(); undo.pop_back(); p.remove(move.first,move.second); record(); }
            require(p.board == fixtures[n].board, "nested undo changed board");
        }
        std::cout << "{\"kind\":\"patterns\",\"fixture\":" << n << ",\"digest\":\"" << combined.value << "\"}\n";
    }
    std::cout << "{\"kind\":\"coverage\",\"fixtures\":" << fixtures.size() << ",\"snapshots\":" << snapshots << "}\n";
}
void fixedSearch(const Fixture& f, int fixture, bool report, Digest& digest) {
    Position p(f.board,f.forbidden);
    Context context(p,f.color,std::chrono::steady_clock::now()+std::chrono::hours(1));
    auto legal = Engine::candidates(p,f.color,kCandidateLimit);
    auto roots = Engine::rootCandidates(p,f.color,3-f.color,legal);
    for (int depth = 1; depth <= 3; ++depth) {
        context.tacticalLeaves = 0;
        Engine::sortMoves(roots,context,0,context.rootMove,-1);
        auto result = Engine::searchRoot(p,roots,depth,context);
        require(!result.aborted && !context.aborted && result.hasMove, "fixed search aborted or no move");
        context.rootMove = result.move.index;
        if (depth >= 2) {
            digest.add(result.move.index); digest.add(result.score); digest.add(context.nodes);
            if (report) std::cout << "{\"kind\":\"search\",\"fixture\":" << fixture << ",\"color\":" << f.color
                << ",\"depth\":" << depth << ",\"move\":" << result.move.index << ",\"score\":" << result.score
                << ",\"nodes\":" << context.nodes << "}\n";
        }
    }
    require(p.board == f.board, "search failed to undo");
}
int main(int argc, char** argv) {
    try {
        std::cout << std::setprecision(17);
        // Exclude one-time geometry, pattern-table, Zobrist and TT initialization.
        (void)geometry(); (void)lineStats(); (void)zobrist(); (void)sharedTable();
        regressChoose(); verifyPatterns();
        const auto fixtures = searchFixtures();
        Digest warm;
        for (size_t n = 0; n < fixtures.size(); ++n) fixedSearch(fixtures[n],static_cast<int>(n),true,warm);
        const int repeats = argc > 1 ? std::atoi(argv[1]) : 5;
        const int batch = argc > 2 ? std::atoi(argv[2]) : 10;
        for (int repeat = 0; repeat < repeats; ++repeat) {
            allocations = 0; allocatedBytes = 0;
            Digest digest;
            auto start = std::chrono::steady_clock::now();
            countAllocations = true;
            for (int iteration = 0; iteration < batch; ++iteration) {
                digest = Digest{};
                for (size_t n = 0; n < fixtures.size(); ++n) fixedSearch(fixtures[n],static_cast<int>(n),false,digest);
                require(digest.value == warm.value, "fixed workload changed across batch iterations");
            }
            countAllocations = false;
            auto elapsed = std::chrono::duration<double,std::milli>(std::chrono::steady_clock::now()-start).count();
            require(digest.value == warm.value, "fixed workload changed across timing repetitions");
            std::cout << "{\"kind\":\"timing\",\"repeat\":" << repeat << ",\"ms\":" << elapsed
                << ",\"allocations\":" << allocations << ",\"allocated_bytes\":" << allocatedBytes
                << ",\"digest\":\"" << digest.value << "\"}\n";
        }
    } catch (const std::exception& e) { std::cerr << e.what() << '\n'; return 1; }
}
'''


def run(command: list[str], *, timeout: int = 180) -> str:
    result = subprocess.run(command, capture_output=True, text=True, timeout=timeout)
    if result.returncode:
        raise RuntimeError(f"Command failed ({result.returncode}): {command!r}\n{result.stdout}\n{result.stderr}")
    return result.stdout


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--baseline", type=Path, default=ROOT / ".codex-diagnostics/ai-speed-20261019/baseline/android_src/cpp/gomoku_ai.cpp")
    parser.add_argument("--source", type=Path, default=ROOT / "android_src/cpp/gomoku_ai.cpp")
    parser.add_argument("--output", type=Path, default=ROOT / ".codex-diagnostics/ai-speed-20261019/native-equivalence")
    parser.add_argument("--compiler", default=shutil.which("clang++") or "clang++")
    parser.add_argument("--optimization", choices=("O2", "O3"), default="O3", help="match the APK's -O3 build by default")
    java_home = Path(os.environ.get("JAVA_HOME", ""))
    default_jdk = java_home if (java_home / "include/jni.h").is_file() else Path("C:/Program Files/Eclipse Adoptium/jdk-17.0.20.101-hotspot")
    parser.add_argument("--jdk", type=Path, default=default_jdk)
    parser.add_argument("--repeats", type=int, default=5)
    parser.add_argument("--batch", type=int, default=10, help="identical four-position search suites per timing sample")
    args = parser.parse_args()
    if args.repeats < 1 or args.batch < 1:
        parser.error("--repeats and --batch must be positive")
    for source in (args.baseline, args.source):
        if not source.is_file():
            parser.error(f"Source does not exist: {source}. Supply --baseline pointing to the saved, pre-optimization source.")
    if not (args.jdk / "include/jni.h").is_file():
        parser.error(f"JDK JNI headers missing: {args.jdk}. Supply --jdk pointing to a full JDK.")
    args.output.mkdir(parents=True, exist_ok=True)
    compiler_version = run([args.compiler, "--version"]).splitlines()[0]
    flags = ["-std=c++17", f"-{args.optimization}", "-DNDEBUG", "-I", str(args.jdk / "include"), "-I", str(args.jdk / "include" / ("win32" if os.name == "nt" else "linux"))]
    reports = {}
    for label, source in (("baseline", args.baseline.resolve()), ("optimized", args.source.resolve())):
        raw = source.read_bytes()
        text = raw.decode("utf-8-sig")
        # Access-label replacement only, scoped to the one Engine class.
        start = text.index("class Engine {")
        access = text.index("private:", start)
        exposed = text[:access] + "public:" + text[access+len("private:"):]
        generated = args.output / f"{label}_harness.cpp"
        generated.write_text(HARNESS.replace("@@SOURCE@@", exposed), encoding="utf-8")
        production_object = args.output / f"{label}_production.o"
        run([args.compiler, *flags, "-c", str(source), "-o", str(production_object)])
        executable = args.output / f"{label}_harness.exe"
        run([args.compiler, *flags, str(generated), "-o", str(executable)])
        started = time.perf_counter()
        output = run([str(executable), str(args.repeats), str(args.batch)])
        if source.read_bytes() != raw:
            raise RuntimeError(f"Source changed during testing; rerun after edits finish: {source}")
        (args.output / f"{label}.jsonl").write_text(output, encoding="utf-8")
        records = [json.loads(line) for line in output.splitlines() if line.strip()]
        timings = [r for r in records if r["kind"] == "timing"]
        reports[label] = {
            "source": str(source), "source_sha256": hashlib.sha256(raw).hexdigest(),
            "generated_sha256": hashlib.sha256(generated.read_bytes()).hexdigest(),
            "production_jni_compile": True,
            "records": [r for r in records if r["kind"] != "timing"],
            "timings": timings, "median_ms": statistics.median(r["ms"] for r in timings),
            "harness_wall_seconds": time.perf_counter() - started,
        }
    baseline, optimized = reports["baseline"], reports["optimized"]
    if baseline["records"] != optimized["records"]:
        for left, right in zip(baseline["records"], optimized["records"]):
            if left != right:
                raise AssertionError(f"Native equivalence failed:\nbaseline={left}\noptimized={right}")
        raise AssertionError("Native equivalence record count differs")
    if [r["digest"] for r in baseline["timings"]] != [r["digest"] for r in optimized["timings"]]:
        raise AssertionError("Timed fixed-workload result differs")
    summary = {
        "equivalent": True, "compiler": compiler_version, "flags": flags,
        "harness_script_sha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        "fixture_seed": "0x10c2026", "fixed_depths": [1, 2, 3],
        "timing_repeats": args.repeats, "suites_per_sample": args.batch,
        "timing_scope": "four positions, iterative depths 1/2/3, fresh Context per position; excludes one-time initialization and warm-up; operator new/new[] calls and requested bytes",
        "speedup": baseline["median_ms"] / optimized["median_ms"],
        "device_acceptance": False, **reports,
    }
    output = args.output / "benchmark.json"
    output.write_text(json.dumps(summary, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps({"equivalent": True, "baseline_median_ms": baseline["median_ms"], "optimized_median_ms": optimized["median_ms"], "speedup": summary["speedup"], "report": str(output)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
