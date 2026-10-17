package com.gomoku.master;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Native port of the production GomokuFastAI master search.
 *
 * The WebView remains the owner of the board and applies the returned move via
 * makeMove().  This class mirrors the JS engine's candidate selection, local
 * pattern table, threat-space proof, iterative deepening, alpha-beta search,
 * transposition table, killer/history ordering and tactical leaf evaluation.
 */
final class NativeGomokuAI {
    static final int SIZE = 15;
    private static final int EMPTY = 0, BLACK = 1, WHITE = 2;
    private static final int WIN = 100000000;
    private static final int OPEN_FOUR = 12000000;
    private static final int FOUR = 1800000;
    private static final int DOUBLE_THREE = 650000;
    private static final int OPEN_THREE = 85000;
    private static final int BROKEN_THREE = 18000;
    private static final int OPEN_TWO = 1800;
    private static final int TWO = 220;
    private static final int ONE = 12;
    private static final int MATE_DISTANCE = 32;
    private static final int MAX_TACTICAL_CANDIDATES = 64;
    private static final int MAX_GLOBAL_CANDIDATES = 8;
    private static final int MAX_DEPTH = 12;
    private static final int ROOT_LIMIT = 24;
    private static final int CANDIDATE_LIMIT = 96;
    private static final int THREAT_PLY = 10;
    private static final int TACTICAL_LEAF_LIMIT = 3200;
    private static final long SEARCH_BUDGET_NS = 1100_000_000L;
    private static final int LOCAL_LENGTH = 11;
    private static final int LOCAL_CODE_COUNT = 177147;
    private static final int[][] DIRECTIONS = {{0, 1}, {1, 0}, {1, 1}, {1, -1}};
    private static final int[][] FOUR_PATTERNS = {
            {0, 1, 1, 1, 1, 2}, {2, 1, 1, 1, 1, 0},
            {1, 0, 1, 1, 1}, {1, 1, 0, 1, 1}, {1, 1, 1, 0, 1}
    };
    private static final int[][] OPEN_THREE_PATTERNS = {
            {0, 1, 1, 1, 0}, {0, 1, 0, 1, 1, 0}, {0, 1, 1, 0, 1, 0}
    };
    private static final int[][] BROKEN_THREE_PATTERNS = {
            {0, 0, 1, 1, 1, 0, 0}, {0, 0, 1, 0, 1, 1, 0},
            {0, 1, 1, 0, 1, 0, 0}, {0, 1, 0, 1, 1, 0, 0}
    };
    private static final int[] OPEN_FOUR_PATTERN = {0, 1, 1, 1, 1, 0};
    private static final int[] OPEN_TWO_PATTERN = {0, 1, 1, 0};
    private static final Geometry GEOMETRY = new Geometry(SIZE);
    private static final class LineStatsHolder { static final LineStats INSTANCE = new LineStats(); }
    private static final int[] ZOBRIST_A = new int[SIZE * SIZE * 3];
    private static final int[] ZOBRIST_B = new int[SIZE * SIZE * 3];

    static {
        int state = 0x9e3779b9;
        for (int i = 0; i < ZOBRIST_A.length; i++) {
            state = nextRandom(state); ZOBRIST_A[i] = state;
            state = nextRandom(state); ZOBRIST_B[i] = state;
        }
    }

    static final class Move {
        final int r, c, index;
        final double score;
        final int depth, nodes;

        Move(int index, double score, int depth, int nodes) {
            this.index = index;
            this.r = index / SIZE;
            this.c = index % SIZE;
            this.score = score;
            this.depth = depth;
            this.nodes = nodes;
        }
    }

    private static final class Position {
        final int[] board;
        final boolean[] forbidden;
        final short[] nearTwo = new short[SIZE * SIZE];
        final short[] nearThree = new short[SIZE * SIZE];
        int stones;
        int hashA, hashB;

        Position(int[] input, boolean[] blocked) {
            board = input.clone();
            forbidden = blocked == null || blocked.length != input.length ? new boolean[input.length] : blocked;
            for (int i = 0; i < board.length; i++) {
                int color = board[i];
                if (color == BLACK || color == WHITE) {
                    stones++;
                    hashA ^= ZOBRIST_A[i * 3 + color];
                    hashB ^= ZOBRIST_B[i * 3 + color];
                    updateNeighborhood(i, 1);
                }
            }
        }

        boolean empty(int index) { return board[index] == EMPTY; }

        boolean put(int index, int color) {
            if (index < 0 || index >= board.length || board[index] != EMPTY) return false;
            board[index] = color;
            hashA ^= ZOBRIST_A[index * 3 + color];
            hashB ^= ZOBRIST_B[index * 3 + color];
            stones++;
            updateNeighborhood(index, 1);
            return true;
        }

        void remove(int index, int color) {
            if (board[index] != color) return;
            updateNeighborhood(index, -1);
            board[index] = EMPTY;
            hashA ^= ZOBRIST_A[index * 3 + color];
            hashB ^= ZOBRIST_B[index * 3 + color];
            stones--;
        }

        private void updateNeighborhood(int index, int delta) {
            int row = index / SIZE, col = index % SIZE;
            for (int dr = -3; dr <= 3; dr++) for (int dc = -3; dc <= 3; dc++) {
                if (dr == 0 && dc == 0) continue;
                int r = row + dr, c = col + dc;
                if (!valid(r, c)) continue;
                int target = r * SIZE + c;
                nearThree[target] = (short) (nearThree[target] + delta);
                if (Math.abs(dr) <= 2 && Math.abs(dc) <= 2) nearTwo[target] = (short) (nearTwo[target] + delta);
            }
        }
    }

    private static final class Pattern {
        final int five, openFour, four, openThree, brokenThree, openTwo;
        final double score;
        Pattern(int five, int openFour, int four, int openThree, int brokenThree, int openTwo, double score) {
            this.five = five; this.openFour = openFour; this.four = four;
            this.openThree = openThree; this.brokenThree = brokenThree;
            this.openTwo = openTwo; this.score = score;
        }
        boolean tactical() {
            return five > 0 || openFour > 0 || four > 0 || openThree > 0 || brokenThree > 0;
        }
    }

    private static final class Candidate {
        final int index, r, c;
        final Pattern own, opp;
        final boolean tactical;
        final double score;
        Candidate(int index, Pattern own, Pattern opp, boolean tactical, double score) {
            this.index = index; this.r = index / SIZE; this.c = index % SIZE;
            this.own = own; this.opp = opp; this.tactical = tactical; this.score = score;
        }
    }

    private static final class Geometry {
        final int[] rows = new int[SIZE * SIZE];
        final int[] cols = new int[SIZE * SIZE];
        final int[] positionValues = new int[SIZE * SIZE];
        final short[] lineIndexes = new short[SIZE * SIZE * 4 * LOCAL_LENGTH];
        final int[][] lines;

        Geometry(int size) {
            Arrays.fill(lineIndexes, (short) -1);
            double center = (size - 1) / 2.0;
            for (int index = 0; index < size * size; index++) {
                int r = index / size, c = index % size;
                rows[index] = r; cols[index] = c;
                positionValues[index] = Math.max(0, (int) (size * 2 - Math.abs(r - center) - Math.abs(c - center)));
                for (int d = 0; d < 4; d++) {
                    int base = (index * 4 + d) * LOCAL_LENGTH;
                    for (int offset = -5; offset <= 5; offset++) {
                        if (offset == 0) continue;
                        int nr = r + offset * DIRECTIONS[d][0];
                        int nc = c + offset * DIRECTIONS[d][1];
                        if (valid(nr, nc)) lineIndexes[base + offset + 5] = (short) (nr * size + nc);
                    }
                }
            }
            List<int[]> all = new ArrayList<>();
            for (int r = 0; r < size; r++) { int[] line = new int[size]; for (int c = 0; c < size; c++) line[c] = r * size + c; all.add(line); }
            for (int c = 0; c < size; c++) { int[] line = new int[size]; for (int r = 0; r < size; r++) line[r] = r * size + c; all.add(line); }
            for (int start = 0; start < size; start++) {
                addDiagonal(all, 0, start, 1);
                addDiagonal(all, 0, start, -1);
            }
            for (int start = 1; start < size; start++) {
                addDiagonal(all, start, 0, 1);
                addDiagonal(all, start, size - 1, -1);
            }
            lines = all.toArray(new int[0][]);
        }

        private void addDiagonal(List<int[]> output, int startR, int startC, int dc) {
            int[] temp = new int[SIZE]; int count = 0;
            for (int r = startR, c = startC; r < SIZE && c >= 0 && c < SIZE; r++, c += dc) temp[count++] = r * SIZE + c;
            if (count >= 5) output.add(Arrays.copyOf(temp, count));
        }
    }

    /** Precomputed counterpart of ai_fast.js's 3^11 local line pattern table. */
    private static final class LineStats {
        final short[] five = new short[LOCAL_CODE_COUNT];
        final short[] openFour = new short[LOCAL_CODE_COUNT];
        final short[] four = new short[LOCAL_CODE_COUNT];
        final short[] openThree = new short[LOCAL_CODE_COUNT];
        final short[] brokenThree = new short[LOCAL_CODE_COUNT];
        final short[] openTwo = new short[LOCAL_CODE_COUNT];
        final int[] values = new int[LOCAL_LENGTH];

        LineStats() {
            for (int code = 0; code < LOCAL_CODE_COUNT; code++) {
                int value = code, longest = 0, run = 0;
                for (int i = LOCAL_LENGTH - 1; i >= 0; i--) { values[i] = value % 3; value /= 3; }
                for (int cell : values) {
                    if (cell == 1) { run++; longest = Math.max(longest, run); } else run = 0;
                }
                five[code] = (short) (longest >= 5 ? 1 : 0);
                openFour[code] = (short) (matches(values, OPEN_FOUR_PATTERN) ? 1 : 0);
                int count = 0; for (int[] pattern : FOUR_PATTERNS) if (matches(values, pattern)) count++;
                four[code] = (short) count;
                count = 0; for (int[] pattern : OPEN_THREE_PATTERNS) if (matches(values, pattern)) count++;
                openThree[code] = (short) count;
                count = 0; for (int[] pattern : BROKEN_THREE_PATTERNS) if (matches(values, pattern)) count++;
                brokenThree[code] = (short) count;
                openTwo[code] = (short) (matches(values, OPEN_TWO_PATTERN) ? 1 : 0);
            }
        }
    }

    private static final class Context {
        final int aiColor, opponent;
        final Position position;
        final long deadline;
        final TranspositionTable table = SHARED_TABLE;
        final TTEntry ttScratch = new TTEntry();
        final int[][] killers = new int[32][2];
        final int[] history = new int[SIZE * SIZE];
        int nodes, tacticalLeaves, completedDepth, rootMove = -1;
        final int tacticalLeafLimit;
        Context(Position position, int aiColor, long deadline, int tacticalLeafLimit) {
            this.position = position; this.aiColor = aiColor;
            this.opponent = aiColor == BLACK ? WHITE : BLACK;
            this.deadline = deadline; this.tacticalLeafLimit = tacticalLeafLimit;
            table.beginSearch();
            for (int[] pair : killers) Arrays.fill(pair, -1);
        }
    }

    private static final class TTEntry {
        int key, hashA, hashB, turn, depth, move, bound;
        double score;
    }

    /** Fixed-size direct-mapped table bounds Android memory while retaining the JS TT semantics. */
    private static final class TranspositionTable {
        final int mask;
        final int[] key, hashA, hashB, turn, depth, move, bound, generations;
        final double[] score;
        int generation;
        TranspositionTable(int capacity) {
            mask = capacity - 1; key = new int[capacity]; hashA = new int[capacity]; hashB = new int[capacity];
            turn = new int[capacity]; depth = new int[capacity]; move = new int[capacity]; bound = new int[capacity];
            score = new double[capacity]; generations = new int[capacity];
        }
        void beginSearch() {
            generation++;
            if (generation == 0) { Arrays.fill(generations, 0); generation = 1; }
        }
        int key(int a, int b, int color) {
            int value = a ^ Integer.rotateLeft(b, 13) ^ color * 0x85ebca6b;
            value ^= value >>> 16; value *= 0x7feb352d; value ^= value >>> 15;
            value *= 0x846ca68b; return value ^ (value >>> 16);
        }
        boolean get(int hash, int a, int b, int color, TTEntry entry) {
            int slot = hash & mask;
            if (generations[slot] != generation || key[slot] != hash || hashA[slot] != a || hashB[slot] != b || turn[slot] != color) return false;
            entry.key = hash; entry.hashA = a; entry.hashB = b;
            entry.turn = color; entry.depth = depth[slot]; entry.move = move[slot]; entry.bound = bound[slot]; entry.score = score[slot];
            return true;
        }
        void put(int hash, int a, int b, int color, int newDepth, double newScore, int newMove, int newBound) {
            int slot = hash & mask;
            if (generations[slot] == generation && key[slot] != hash && depth[slot] > newDepth) return;
            generations[slot] = generation; key[slot] = hash; hashA[slot] = a; hashB[slot] = b;
            turn[slot] = color; depth[slot] = newDepth; score[slot] = newScore; move[slot] = newMove; bound[slot] = newBound;
        }
    }

    private static final class ThreatEntry {
        final int hashA, hashB, attacker, remaining;
        final int status, move;
        ThreatEntry(int a, int b, int attacker, int remaining, int status, int move) {
            this.hashA = a; this.hashB = b; this.attacker = attacker;
            this.remaining = remaining; this.status = status; this.move = move;
        }
    }
    private static final int THREAT_FAIL = 0, THREAT_WIN = 1, THREAT_UNKNOWN = 2;
    private static final TranspositionTable SHARED_TABLE = new TranspositionTable(1 << 17);

    private NativeGomokuAI() {}

    static synchronized Move chooseMove(int[] board, int aiColor, boolean[] forbidden) {
        if (board == null || board.length != SIZE * SIZE || (aiColor != BLACK && aiColor != WHITE)) return null;
        for (int value : board) if (value < EMPTY || value > WHITE) return null;
        long started = System.nanoTime();
        long deadline = started + SEARCH_BUDGET_NS;
        Position position = new Position(board, forbidden);
        int opponent = aiColor == BLACK ? WHITE : BLACK;
        List<Candidate> legal = candidates(position, aiColor, CANDIDATE_LIMIT);
        if (legal.isEmpty()) {
            int first = firstEmpty(position);
            return first < 0 ? null : new Move(first, 0, 0, 0);
        }
        if (position.stones == 0) return new Move(7 * SIZE + 7, 0, 0, 0);

        List<Candidate> ownWins = winningMoves(position, aiColor, SIZE * SIZE);
        if (!ownWins.isEmpty()) return new Move(ownWins.get(0).index, WIN, 0, 0);
        List<Candidate> opponentWins = winningMoves(position, opponent, SIZE * SIZE);
        if (opponentWins.size() == 1) return new Move(opponentWins.get(0).index, WIN * 0.92, 0, 0);

        Context context = new Context(position, aiColor, deadline, TACTICAL_LEAF_LIMIT);
        Candidate forcing = findThreatSpaceMove(position, aiColor, legal, THREAT_PLY, deadline);
        if (forcing != null) return new Move(forcing.index, WIN, 0, 0);

        List<Candidate> roots = rootCandidates(position, aiColor, opponent, legal);
        Candidate best = roots.isEmpty() ? legal.get(0) : roots.get(0);
        double bestScore = best.score;
        int previousBestIndex = best.index, stableIterations = 0;
        for (int depth = 1; depth <= MAX_DEPTH; depth++) {
            context.tacticalLeaves = 0;
            sortMoves(roots, context, 0, context.rootMove, -1);
            SearchResult result = searchRoot(position, roots, depth, context);
            if (result.aborted) break;
            if (result.move != null) {
                best = result.move; bestScore = result.score; context.rootMove = best.index;
            }
            context.completedDepth = depth;
            if (result.score >= WIN - 1000) break;
            if (best.index == previousBestIndex) stableIterations++;
            else stableIterations = 0;
            previousBestIndex = best.index;
            // Save time only in quiet positions. Tactical roots keep searching so a
            // deeper defense or forcing continuation is not skipped for responsiveness.
            if (depth >= 5 && stableIterations >= 2 && !hasTacticalCandidate(roots)
                    && System.nanoTime() - started >= 180_000_000L) break;
        }
        return new Move(best.index, bestScore, context.completedDepth, context.nodes);
    }

    private static int firstEmpty(Position p) {
        for (int i = 0; i < p.board.length; i++) if (p.empty(i) && !p.forbidden[i]) return i;
        return -1;
    }

    private static boolean hasTacticalCandidate(List<Candidate> candidates) {
        for (Candidate candidate : candidates) if (candidate.tactical) return true;
        return false;
    }

    private static boolean nearStone(Position p, int index, int radius) {
        return radius >= 3 ? p.nearThree[index] > 0 : p.nearTwo[index] > 0;
    }

    private static List<Candidate> candidates(Position p, int color, int limit) {
        if (p.stones == 0) {
            int center = 7 * SIZE + 7;
            return p.forbidden[center] ? new ArrayList<>() : singletonCandidate(p, color, center);
        }
        int opponent = color == BLACK ? WHITE : BLACK;
        int radius = p.stones <= 12 ? 3 : 2;
        List<Candidate> raw = new ArrayList<>(160);
        for (int index = 0; index < p.board.length; index++) {
            int r = GEOMETRY.rows[index], c = GEOMETRY.cols[index];
            boolean openingAnchor = p.stones <= 4 && Math.abs(r - 7) <= 3 && Math.abs(c - 7) <= 3;
            if (!p.empty(index) || p.forbidden[index] || (!openingAnchor && !nearStone(p, index, radius))) continue;
            Pattern own = analyzeMove(p, index, color), opp = analyzeMove(p, index, opponent);
            boolean tactical = own.five > 0 || opp.five > 0 || own.openFour > 0 || opp.openFour > 0 ||
                    own.four > 0 || opp.four > 0 || own.openThree > 0 || opp.openThree > 0 ||
                    own.brokenThree > 0 || opp.brokenThree > 0;
            raw.add(new Candidate(index, own, opp, tactical, moveOrderingScore(own, opp) + GEOMETRY.positionValues[index]));
        }
        if (raw.isEmpty()) {
            for (int i = 0; i < p.board.length; i++) if (p.empty(i) && !p.forbidden[i]) {
                raw.add(new Candidate(i, null, null, false, GEOMETRY.positionValues[i]));
            }
        }
        raw.sort(CANDIDATE_ORDER);
        List<Candidate> selected = new ArrayList<>(Math.min(raw.size(), Math.max(1, limit) + 80));
        boolean[] seen = new boolean[p.board.length];
        int requested = Math.max(1, limit);
        for (int i = 0; i < raw.size() && i < requested; i++) { Candidate m = raw.get(i); selected.add(m); seen[m.index] = true; }
        int tacticalCount = 0;
        for (Candidate m : raw) if (m.tactical && !seen[m.index]) {
            selected.add(m); seen[m.index] = true;
            if (++tacticalCount >= MAX_TACTICAL_CANDIDATES) break;
        }
        int globalLimit = p.stones <= 8 ? MAX_GLOBAL_CANDIDATES : MAX_GLOBAL_CANDIDATES / 2;
        for (Candidate m : globalStrategicMoves(p, color, opponent, globalLimit)) if (!seen[m.index]) {
            selected.add(m); seen[m.index] = true;
        }
        return selected;
    }

    private static List<Candidate> singletonCandidate(Position p, int color, int index) {
        List<Candidate> one = new ArrayList<>(1);
        Pattern own = analyzeMove(p, index, color), opp = analyzeMove(p, index, color == BLACK ? WHITE : BLACK);
        one.add(new Candidate(index, own, opp, own.tactical() || opp.tactical(), moveOrderingScore(own, opp)));
        return one;
    }

    private static List<Candidate> globalStrategicMoves(Position p, int color, int opponent, int limit) {
        boolean[] seen = new boolean[p.board.length];
        List<Candidate> anchors = new ArrayList<>();
        addAnchor(p, anchors, seen, 7, 7);
        int[] offsets = {2, 3, 5, 7};
        for (int offset : offsets) {
            addAnchor(p, anchors, seen, 7 - offset, 7); addAnchor(p, anchors, seen, 7 + offset, 7);
            addAnchor(p, anchors, seen, 7, 7 - offset); addAnchor(p, anchors, seen, 7, 7 + offset);
            addAnchor(p, anchors, seen, 7 - offset, 7 - offset); addAnchor(p, anchors, seen, 7 - offset, 7 + offset);
            addAnchor(p, anchors, seen, 7 + offset, 7 - offset); addAnchor(p, anchors, seen, 7 + offset, 7 + offset);
        }
        int step = Math.max(2, SIZE / 4);
        for (int r = 1; r < SIZE; r += step) for (int c = 1; c < SIZE; c += step) addAnchor(p, anchors, seen, r, c);
        anchors.sort((a, b) -> {
            int order = Integer.compare(GEOMETRY.positionValues[b.index], GEOMETRY.positionValues[a.index]);
            if (order != 0) return order;
            order = Integer.compare(a.r, b.r);
            return order != 0 ? order : Integer.compare(a.c, b.c);
        });
        if (anchors.size() > limit) anchors = new ArrayList<>(anchors.subList(0, limit));
        List<Candidate> result = new ArrayList<>(anchors.size());
        for (Candidate m : anchors) {
            Pattern own = analyzeMove(p, m.index, color), opp = analyzeMove(p, m.index, opponent);
            boolean tactical = own.tactical() || opp.tactical();
            result.add(new Candidate(m.index, own, opp, tactical, moveOrderingScore(own, opp) + GEOMETRY.positionValues[m.index]));
        }
        return result;
    }

    private static void addAnchor(Position p, List<Candidate> list, boolean[] seen, int r, int c) {
        if (!valid(r, c)) return;
        int index = r * SIZE + c;
        if (!seen[index] && p.empty(index) && !p.forbidden[index]) {
            seen[index] = true; list.add(new Candidate(index, null, null, false, GEOMETRY.positionValues[index]));
        }
    }

    private static List<Candidate> rootCandidates(Position p, int color, int opponent, List<Candidate> legal) {
        List<Candidate> result = new ArrayList<>();
        boolean[] seen = new boolean[p.board.length];
        int count = Math.min(ROOT_LIMIT, legal.size());
        for (int i = 0; i < count; i++) addRoot(p, result, seen, legal.get(i), color, opponent);
        List<Candidate> tacticalPool = candidates(p, color, Math.max(CANDIDATE_LIMIT, MAX_TACTICAL_CANDIDATES));
        for (Candidate move : tacticalPool) if (move.tactical) addRoot(p, result, seen, move, color, opponent);
        for (Candidate move : winningMoves(p, opponent, SIZE * SIZE)) addRoot(p, result, seen, move, color, opponent);
        result.sort((a, b) -> {
            int tactical = Boolean.compare(b.tactical, a.tactical);
            return tactical != 0 ? tactical : CANDIDATE_ORDER.compare(a, b);
        });
        return result.isEmpty() ? legal : result;
    }

    private static void addRoot(Position p, List<Candidate> out, boolean[] seen, Candidate source, int color, int opponent) {
        int index = source.index;
        if (index < 0 || index >= p.board.length || !p.empty(index) || p.forbidden[index] || seen[index]) return;
        Pattern own = analyzeMove(p, index, color), opp = analyzeMove(p, index, opponent);
        boolean tactical = own.tactical() || opp.tactical();
        double score = Double.isFinite(source.score) ? source.score : moveOrderingScore(own, opp) + GEOMETRY.positionValues[index];
        out.add(new Candidate(index, own, opp, tactical, score)); seen[index] = true;
    }

    private static List<Candidate> winningMoves(Position p, int color, int limit) {
        List<Candidate> wins = new ArrayList<>(4);
        for (int index = 0; index < p.board.length; index++) {
            if (p.empty(index) && !p.forbidden[index] && winsAt(p, index, color)) {
                wins.add(new Candidate(index, null, null, true, WIN));
            }
        }
        return wins;
    }

    private static boolean winsAt(Position p, int index, int color) {
        int row = index / SIZE, col = index % SIZE;
        for (int[] direction : DIRECTIONS) {
            int count = 1 + countExisting(p, row, col, direction[0], direction[1], color)
                    + countExisting(p, row, col, -direction[0], -direction[1], color);
            if (count >= 5) return true;
        }
        return false;
    }

    private static int countExisting(Position p, int row, int col, int dr, int dc, int color) {
        int count = 0, r = row + dr, c = col + dc;
        while (valid(r, c) && p.board[r * SIZE + c] == color) { count++; r += dr; c += dc; }
        return count;
    }

    private static Candidate findThreatSpaceMove(Position p, int color, List<Candidate> candidates, int maxPly, long threatDeadline) {
        Map<Long, ThreatEntry> table = new HashMap<>();
        Map<Integer, Candidate> roots = new HashMap<>();
        for (Candidate m : candidates) addThreatRoot(p, roots, m, color);
        for (Candidate m : forcingCandidates(p, color)) addThreatRoot(p, roots, m, color);
        List<Candidate> rootList = new ArrayList<>(roots.values());
        SearchThreat result = searchThreat(p, color, maxPly, threatDeadline, table, rootList, 0);
        if (result.status != THREAT_WIN) return null;
        return result.move;
    }

    private static void addThreatRoot(Position p, Map<Integer, Candidate> roots, Candidate source, int color) {
        if (source == null || !p.empty(source.index) || p.forbidden[source.index] || roots.containsKey(source.index)) return;
        int opponent = color == BLACK ? WHITE : BLACK;
        Pattern own = analyzeMove(p, source.index, color), opp = analyzeMove(p, source.index, opponent);
        if (!(own.tactical() || opp.tactical())) return;
        roots.put(source.index, new Candidate(source.index, own, opp, true,
                Double.isFinite(source.score) ? source.score : moveOrderingScore(own, opp)));
    }

    private static List<Candidate> forcingCandidates(Position p, int color) {
        List<Candidate> all = candidates(p, color, Math.max(64, MAX_TACTICAL_CANDIDATES));
        List<Candidate> force = new ArrayList<>();
        for (Candidate m : all) if (m.tactical) force.add(m);
        force.sort(CANDIDATE_ORDER);
        if (force.size() > MAX_TACTICAL_CANDIDATES) return new ArrayList<>(force.subList(0, MAX_TACTICAL_CANDIDATES));
        return force;
    }

    private static final class SearchThreat { final int status; final Candidate move; SearchThreat(int s, Candidate m) { status = s; move = m; } }

    private static SearchThreat searchThreat(Position p, int attacker, int remaining, long deadline,
                                               Map<Long, ThreatEntry> table, List<Candidate> roots, int ply) {
        if (System.nanoTime() >= deadline) return new SearchThreat(THREAT_UNKNOWN, null);
        if (remaining <= 0) return new SearchThreat(THREAT_FAIL, null);
        int key = p.hashA ^ Integer.rotateLeft(p.hashB, 11) ^ attacker * 0x85ebca6b ^ remaining * 0xc2b2ae35;
        long mapKey = key & 0xffffffffL;
        ThreatEntry cached = table.get(mapKey);
        if (cached != null && cached.hashA == p.hashA && cached.hashB == p.hashB && cached.attacker == attacker && cached.remaining == remaining) {
            return new SearchThreat(cached.status, cached.move < 0 ? null : candidateForIndex(p, cached.move, attacker));
        }
        List<Candidate> direct = winningMoves(p, attacker, SIZE * SIZE);
        if (!direct.isEmpty()) return new SearchThreat(THREAT_WIN, direct.get(0));
        int defender = attacker == BLACK ? WHITE : BLACK;
        List<Candidate> moves = ply == 0 && roots != null && !roots.isEmpty() ? roots : forcingCandidates(p, attacker);
        boolean unknown = false;
        for (Candidate move : moves) {
            if (System.nanoTime() >= deadline) { unknown = true; break; }
            if (!p.put(move.index, attacker)) continue;
            int branch = THREAT_FAIL;
            if (hasFive(p, move.index, attacker)) branch = THREAT_WIN;
            else if (winningMoves(p, defender, SIZE * SIZE).isEmpty()) {
                List<Candidate> ownWins = winningMoves(p, attacker, SIZE * SIZE);
                if (ownWins.size() >= 2) branch = THREAT_WIN;
                else if (ownWins.size() == 1) {
                    int block = ownWins.get(0).index;
                    if (p.forbidden[block] || !p.empty(block)) branch = THREAT_WIN;
                    else if (remaining >= 3 && p.put(block, defender)) {
                        SearchThreat child = searchThreat(p, attacker, remaining - 2, deadline, table, roots, ply + 2);
                        p.remove(block, defender);
                        if (child.status == THREAT_WIN) branch = THREAT_WIN;
                        else if (child.status == THREAT_UNKNOWN) unknown = true;
                    }
                }
            }
            p.remove(move.index, attacker);
            if (branch == THREAT_WIN) {
                table.put(mapKey, new ThreatEntry(p.hashA, p.hashB, attacker, remaining, THREAT_WIN, move.index));
                return new SearchThreat(THREAT_WIN, move);
            }
        }
        int status = unknown ? THREAT_UNKNOWN : THREAT_FAIL;
        if (status == THREAT_FAIL) table.put(mapKey, new ThreatEntry(p.hashA, p.hashB, attacker, remaining, status, -1));
        return new SearchThreat(status, null);
    }

    private static Candidate candidateForIndex(Position p, int index, int color) {
        return new Candidate(index, analyzeMove(p, index, color), analyzeMove(p, index, color == BLACK ? WHITE : BLACK), true, 0);
    }

    private static Pattern analyzeMove(Position p, int index, int color) {
        if (index < 0 || index >= p.board.length || !p.empty(index)) return new Pattern(0, 0, 0, 0, 0, 0, Double.NEGATIVE_INFINITY);
        int five = 0, openFour = 0, four = 0, openThree = 0, brokenThree = 0, openTwo = 0;
        int opponent = color == BLACK ? WHITE : BLACK;
        int base = index * 4 * LOCAL_LENGTH;
        LineStats stats = LineStatsHolder.INSTANCE;
        for (int d = 0; d < 4; d++) {
            int code = 0, lineBase = base + d * LOCAL_LENGTH;
            for (int offset = 0; offset < LOCAL_LENGTH; offset++) {
                int cellIndex = GEOMETRY.lineIndexes[lineBase + offset];
                int value;
                if (offset == 5) value = 1;
                else if (cellIndex < 0) value = 2;
                else { int cell = p.board[cellIndex]; value = cell == EMPTY ? 0 : cell == color ? 1 : cell == opponent ? 2 : 2; }
                code = code * 3 + value;
            }
            five += stats.five[code]; openFour += stats.openFour[code]; four += stats.four[code];
            openThree += stats.openThree[code]; brokenThree += stats.brokenThree[code]; openTwo += stats.openTwo[code];
        }
        double score = five > 0 ? WIN : openFour > 0 ? OPEN_FOUR : four >= 2 ? FOUR * 7.0 :
                four > 0 && openThree > 0 ? FOUR * 5.0 : openThree >= 2 ? DOUBLE_THREE :
                        four > 0 ? FOUR : openThree > 0 ? OPEN_THREE : brokenThree > 0 ? BROKEN_THREE : openTwo > 0 ? OPEN_TWO : ONE;
        return new Pattern(five, openFour, four, openThree, brokenThree, openTwo, score);
    }

    private static double moveOrderingScore(Pattern own, Pattern opp) {
        if (own.five > 0) return WIN;
        if (opp.five > 0) return WIN * 0.92;
        if (own.openFour > 0) return OPEN_FOUR;
        if (opp.openFour > 0) return OPEN_FOUR * 0.9;
        if (own.four >= 2) return FOUR * 7.0;
        if (opp.four >= 2) return FOUR * 6.5;
        if (own.four > 0 && own.openThree > 0) return FOUR * 5.0;
        if (opp.four > 0 && opp.openThree > 0) return FOUR * 4.5;
        if (own.openThree >= 2) return DOUBLE_THREE;
        if (opp.openThree >= 2) return DOUBLE_THREE * 0.92;
        return own.score * 1.18 + opp.score * 1.08;
    }

    private static boolean hasFive(Position p, int index, int color) {
        for (int[] direction : DIRECTIONS) {
            int count = 1 + countDirection(p, index, direction[0], direction[1], color) +
                    countDirection(p, index, -direction[0], -direction[1], color);
            if (count >= 5) return true;
        }
        return false;
    }

    private static int countDirection(Position p, int index, int dr, int dc, int color) {
        int r = index / SIZE + dr, c = index % SIZE + dc, count = 0;
        while (valid(r, c) && p.board[r * SIZE + c] == color) { count++; r += dr; c += dc; }
        return count;
    }

    private static final Comparator<Candidate> CANDIDATE_ORDER = (a, b) -> {
        int order = Double.compare(b.score, a.score);
        if (order != 0) return order;
        order = Boolean.compare(b.tactical, a.tactical);
        if (order != 0) return order;
        order = Integer.compare(a.r, b.r);
        return order != 0 ? order : Integer.compare(a.c, b.c);
    };

    private static void sortMoves(List<Candidate> moves, Context context, int ply, int preferred, int ttMove) {
        final int killer0 = ply < context.killers.length ? context.killers[ply][0] : -1;
        final int killer1 = ply < context.killers.length ? context.killers[ply][1] : -1;
        moves.sort((a, b) -> {
            double pa = movePriority(a, context, ply, preferred, ttMove, killer0, killer1);
            double pb = movePriority(b, context, ply, preferred, ttMove, killer0, killer1);
            int order = Double.compare(pb, pa);
            if (order != 0) return order;
            order = Integer.compare(a.r, b.r);
            return order != 0 ? order : Integer.compare(a.c, b.c);
        });
    }

    private static double movePriority(Candidate m, Context context, int ply, int preferred, int ttMove, int killer0, int killer1) {
        double value = Double.isFinite(m.score) ? m.score : 0;
        if (m.index == ttMove) value += WIN * 2.0;
        if (ply == 0 && m.index == context.rootMove) value += WIN;
        if (m.index == killer0) value += OPEN_FOUR;
        else if (m.index == killer1) value += FOUR;
        value += context.history[m.index];
        if (m.own != null && m.own.five > 0) value += WIN;
        if (m.opp != null && m.opp.five > 0) value += WIN * 0.96;
        if (m.index == preferred) value += WIN * 2.0;
        return value;
    }

    private static double evaluateBoard(Position p, int aiColor, int opponent) {
        double ai = 0, other = 0;
        for (int[] line : GEOMETRY.lines) { ai += evaluateLine(p, line, aiColor); other += evaluateLine(p, line, opponent); }
        double positional = 0;
        for (int i = 0; i < p.board.length; i++) if (p.board[i] != EMPTY) {
            positional += p.board[i] == aiColor ? GEOMETRY.positionValues[i] : -GEOMETRY.positionValues[i];
        }
        return ai - other * 1.12 + positional;
    }

    private static double evaluateLine(Position p, int[] line, int color) {
        double score = 0;
        for (int i = 0; i < line.length;) {
            if (p.board[line[i]] != color) { i++; continue; }
            int start = i;
            while (i < line.length && p.board[line[i]] == color) i++;
            int length = i - start;
            boolean openLeft = start > 0 && p.board[line[start - 1]] == EMPTY;
            boolean openRight = i < line.length && p.board[line[i]] == EMPTY;
            int opens = (openLeft ? 1 : 0) + (openRight ? 1 : 0);
            if (length >= 5) score += WIN;
            else if (length == 4) score += opens == 2 ? OPEN_FOUR : opens > 0 ? FOUR : 0;
            else if (length == 3) score += opens == 2 ? OPEN_THREE : opens > 0 ? BROKEN_THREE : 0;
            else if (length == 2) score += opens == 2 ? OPEN_TWO : opens > 0 ? TWO : 0;
            else if (length == 1 && opens == 2) score += ONE;
        }
        int opponent = color == BLACK ? WHITE : BLACK;
        for (int start = 0; start <= line.length - 5; start++) {
            int own = 0, other = 0, empty = 0, longest = 0, run = 0;
            for (int offset = 0; offset < 5; offset++) {
                int cell = p.board[line[start + offset]];
                if (cell == color) { own++; run++; longest = Math.max(longest, run); }
                else { run = 0; if (cell == opponent) other++; else empty++; }
            }
            if (other > 0) continue;
            if (own == 4 && empty == 1 && longest < 4) score += FOUR * 0.78;
            else if (own == 3 && empty == 2 && longest < 3) score += BROKEN_THREE * 0.9;
            else if (own == 2 && empty == 3 && longest < 2) score += TWO * 0.55;
        }
        return score;
    }

    private static final class SearchResult {
        final double score; final Candidate move; final boolean aborted;
        SearchResult(double score, Candidate move, boolean aborted) { this.score = score; this.move = move; this.aborted = aborted; }
    }

    private static SearchResult searchRoot(Position p, List<Candidate> candidates, int depth, Context context) {
        Candidate bestMove = null; double bestScore = Double.NEGATIVE_INFINITY, alpha = Double.NEGATIVE_INFINITY;
        for (Candidate move : candidates) {
            if (System.nanoTime() >= context.deadline) return new SearchResult(0, null, true);
            if (!p.put(move.index, context.aiColor)) continue;
            double score;
            if (hasFive(p, move.index, context.aiColor)) score = WIN - MATE_DISTANCE;
            else {
                SearchResult child = search(p, depth - 1, alpha, Double.POSITIVE_INFINITY, context.opponent, context, 1);
                if (child.aborted) { p.remove(move.index, context.aiColor); return child; }
                score = child.score;
            }
            p.remove(move.index, context.aiColor);
            if (score > bestScore) { bestScore = score; bestMove = move; }
            alpha = Math.max(alpha, bestScore);
        }
        return new SearchResult(bestScore, bestMove, false);
    }

    private static SearchResult search(Position p, int depth, double alpha, double beta, int turn, Context context, int ply) {
        context.nodes++;
        if (System.nanoTime() >= context.deadline) return new SearchResult(0, null, true);
        if (depth <= 0) return new SearchResult(evaluateLeaf(p, turn, context, ply), null, false);
        double alphaStart = alpha, betaStart = beta;
        int key = context.table.key(p.hashA, p.hashB, turn);
        TTEntry cached = context.ttScratch;
        boolean hasCached = context.table.get(key, p.hashA, p.hashB, turn, cached);
        int ttMove = hasCached ? cached.move : -1;
        if (hasCached && cached.depth >= depth) {
            if (cached.bound == 0) return new SearchResult(cached.score, cached.move < 0 ? null : candidateForIndex(p, cached.move, turn), false);
            if (cached.bound == 1) alpha = Math.max(alpha, cached.score);
            else if (cached.bound == 2) beta = Math.min(beta, cached.score);
            if (alpha >= beta) return new SearchResult(cached.score, cached.move < 0 ? null : candidateForIndex(p, cached.move, turn), false);
        }
        boolean maximizing = turn == context.aiColor;
        int limit = depth >= 4 ? 12 : depth >= 2 ? 18 : 24;
        List<Candidate> moves = candidates(p, turn, limit);
        sortMoves(moves, context, ply, -1, ttMove);
        if (moves.isEmpty()) return new SearchResult(0, null, false);
        double best = maximizing ? Double.NEGATIVE_INFINITY : Double.POSITIVE_INFINITY;
        Candidate bestMove = null; boolean cutoff = false;
        int next = turn == BLACK ? WHITE : BLACK;
        for (Candidate move : moves) {
            if (System.nanoTime() >= context.deadline) return new SearchResult(0, null, true);
            if (!p.put(move.index, turn)) continue;
            double score;
            if (hasFive(p, move.index, turn)) score = maximizing ? WIN - ply * MATE_DISTANCE : -WIN + ply * MATE_DISTANCE;
            else {
                SearchResult child = search(p, depth - 1, alpha, beta, next, context, ply + 1);
                if (child.aborted) { p.remove(move.index, turn); return child; }
                score = child.score;
            }
            p.remove(move.index, turn);
            if (maximizing) { if (score > best) { best = score; bestMove = move; } alpha = Math.max(alpha, best); }
            else { if (score < best) { best = score; bestMove = move; } beta = Math.min(beta, best); }
            if (beta <= alpha) { cutoff = true; break; }
        }
        int bound = best <= alphaStart ? 2 : best >= betaStart ? 1 : 0;
        context.table.put(key, p.hashA, p.hashB, turn, depth, best, bestMove == null ? -1 : bestMove.index, bound);
        if (cutoff && bestMove != null && ply < context.killers.length) {
            int[] killer = context.killers[ply];
            if (killer[0] != bestMove.index) { killer[1] = killer[0]; killer[0] = bestMove.index; }
            long value = (long) context.history[bestMove.index] + (long) depth * depth * 64;
            context.history[bestMove.index] = (int) Math.min(1_000_000L, value);
        }
        return new SearchResult(best, bestMove, false);
    }

    private static double evaluateLeaf(Position p, int turnColor, Context context, int ply) {
        double base = evaluateBoard(p, context.aiColor, context.opponent);
        if (++context.tacticalLeaves > context.tacticalLeafLimit) return base;
        List<Candidate> current = winningMoves(p, turnColor, SIZE * SIZE);
        double mate = WIN - ply * MATE_DISTANCE;
        if (!current.isEmpty()) return turnColor == context.aiColor ? mate : -mate;
        int other = turnColor == BLACK ? WHITE : BLACK;
        List<Candidate> opponentWins = winningMoves(p, other, SIZE * SIZE);
        if (opponentWins.size() >= 2) return other == context.aiColor ? mate : -mate;
        if (opponentWins.size() == 1) return base + (other == context.aiColor ? FOUR * 0.92 : -FOUR * 0.92);
        return base;
    }

    private static boolean valid(int r, int c) { return r >= 0 && r < SIZE && c >= 0 && c < SIZE; }

    private static boolean matches(int[] values, int[] pattern) {
        if (pattern.length > values.length) return false;
        for (int start = 0; start <= values.length - pattern.length; start++) {
            int i = 0; while (i < pattern.length && values[start + i] == pattern[i]) i++;
            if (i == pattern.length) return true;
        }
        return false;
    }

    private static int nextRandom(int seed) {
        seed ^= seed >>> 16; seed *= 0x21f0aaad;
        seed ^= seed >>> 15; seed *= 0x735a2d97;
        return seed ^ (seed >>> 15);
    }
}
