#include <jni.h>

#include <algorithm>
#include <array>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <limits>
#include <unordered_map>
#include <utility>
#include <vector>

namespace {

constexpr int kSize = 15;
constexpr int kCells = kSize * kSize;
constexpr int kEmpty = 0;
constexpr int kBlack = 1;
constexpr int kWhite = 2;
constexpr int kWin = 100000000;
constexpr int kOpenFour = 12000000;
constexpr int kFour = 1800000;
constexpr int kDoubleThree = 650000;
constexpr int kOpenThree = 85000;
constexpr int kBrokenThree = 18000;
constexpr int kOpenTwo = 1800;
constexpr int kTwo = 220;
constexpr int kOne = 12;
constexpr int kMateDistance = 32;
constexpr int kMaxTacticalCandidates = 64;
constexpr int kMaxGlobalCandidates = 8;
constexpr int kMaxDepth = 12;
constexpr int kRootLimit = 24;
constexpr int kCandidateLimit = 96;
constexpr int kThreatPly = 10;
constexpr int kTacticalLeafLimit = 3200;
constexpr int kLocalLength = 11;
constexpr int kLocalCodeCount = 177147;
constexpr int kLineSlots = kCells * 4;
constexpr int kMaxBoardLines = kSize * 6;
constexpr int kNoPattern = -1;
constexpr int32_t kInvalidPattern = 0x7fffffff;
constexpr uint32_t kPatternMask = 0x1f;
constexpr int kThreatFail = 0;
constexpr int kThreatWin = 1;
constexpr int kThreatUnknown = 2;
constexpr auto kSearchBudget = std::chrono::milliseconds(1100);

constexpr int kDirections[4][2] = {{0, 1}, {1, 0}, {1, 1}, {1, -1}};
constexpr int kFourPatterns[][6] = {
    {0, 1, 1, 1, 1, 2}, {2, 1, 1, 1, 1, 0},
    {1, 0, 1, 1, 1, -1}, {1, 1, 0, 1, 1, -1}, {1, 1, 1, 0, 1, -1}
};
constexpr int kFourPatternLengths[] = {6, 6, 5, 5, 5};
constexpr int kOpenThreePatterns[][6] = {
    {0, 1, 1, 1, 0, -1}, {0, 1, 0, 1, 1, 0}, {0, 1, 1, 0, 1, 0}
};
constexpr int kOpenThreePatternLengths[] = {5, 6, 6};
constexpr int kBrokenThreePatterns[][7] = {
    {0, 0, 1, 1, 1, 0, 0}, {0, 0, 1, 0, 1, 1, 0},
    {0, 1, 1, 0, 1, 0, 0}, {0, 1, 0, 1, 1, 0, 0}
};
constexpr int kOpenFourPattern[] = {0, 1, 1, 1, 1, 0};
constexpr int kOpenTwoPattern[] = {0, 1, 1, 0};

bool valid(int row, int col) {
    return row >= 0 && row < kSize && col >= 0 && col < kSize;
}

uint32_t rotateLeft(uint32_t value, unsigned shift) {
    return (value << shift) | (value >> (32U - shift));
}

uint32_t nextRandom(uint32_t seed) {
    seed ^= seed >> 16;
    seed *= 0x21f0aaadU;
    seed ^= seed >> 15;
    seed *= 0x735a2d97U;
    return seed ^ (seed >> 15);
}

struct Geometry {
    struct LineUpdate {
        int16_t slot = 0;
        int weight = 0;
    };
    std::array<int, kCells> rows{};
    std::array<int, kCells> cols{};
    std::array<int, kCells> positionValues{};
    std::array<int16_t, kCells * 4 * kLocalLength> lineIndexes{};
    std::array<std::array<LineUpdate, 40>, kCells> lineUpdates{};
    std::array<uint8_t, kCells> lineUpdateCounts{};
    std::array<std::array<int16_t, 4>, kCells> boardLineIds{};
    std::array<uint8_t, kCells> boardLineCounts{};
    std::vector<std::vector<int>> lines;

    Geometry() {
        lineIndexes.fill(-1);
        for (int index = 0; index < kCells; ++index) {
            const int row = index / kSize;
            const int col = index % kSize;
            rows[index] = row;
            cols[index] = col;
            positionValues[index] = std::max(0, kSize * 2 - std::abs(row - 7) - std::abs(col - 7));
            for (int direction = 0; direction < 4; ++direction) {
                const int base = (index * 4 + direction) * kLocalLength;
                for (int offset = -5; offset <= 5; ++offset) {
                    if (offset == 0) continue;
                    const int nextRow = row + offset * kDirections[direction][0];
                    const int nextCol = col + offset * kDirections[direction][1];
                    if (valid(nextRow, nextCol)) {
                        lineIndexes[base + offset + 5] = static_cast<int16_t>(nextRow * kSize + nextCol);
                    }
                }
            }
        }

        // A center is always treated as the hypothetical stone, so it never
        // depends on the actual occupant of that center.
        for (int slot = 0; slot < kLineSlots; ++slot) {
            int weight = 1;
            for (int offset = kLocalLength - 1; offset >= 0; --offset, weight *= 3) {
                const int cell = lineIndexes[slot * kLocalLength + offset];
                if (cell >= 0) {
                    lineUpdates[cell][lineUpdateCounts[cell]++] = {static_cast<int16_t>(slot), weight};
                }
            }
        }

        lines.reserve(kSize * 2 + 2 * (kSize - 4) * (kSize - 3));
        for (int row = 0; row < kSize; ++row) {
            std::vector<int> line;
            line.reserve(kSize);
            for (int col = 0; col < kSize; ++col) line.push_back(row * kSize + col);
            addLine(std::move(line));
        }
        for (int col = 0; col < kSize; ++col) {
            std::vector<int> line;
            line.reserve(kSize);
            for (int row = 0; row < kSize; ++row) line.push_back(row * kSize + col);
            addLine(std::move(line));
        }
        for (int start = 0; start < kSize; ++start) {
            addDiagonal(0, start, 1);
            addDiagonal(0, start, -1);
        }
        for (int start = 1; start < kSize; ++start) {
            addDiagonal(start, 0, 1);
            addDiagonal(start, kSize - 1, -1);
        }
    }

    void addLine(std::vector<int> line) {
        const int16_t id = static_cast<int16_t>(lines.size());
        for (int cell : line) boardLineIds[cell][boardLineCounts[cell]++] = id;
        lines.push_back(std::move(line));
    }

    void addDiagonal(int startRow, int startCol, int colDelta) {
        std::vector<int> line;
        for (int row = startRow, col = startCol; row < kSize && col >= 0 && col < kSize; ++row, col += colDelta) {
            line.push_back(row * kSize + col);
        }
        if (line.size() >= 5) addLine(std::move(line));
    }
};

const Geometry& geometry() {
    static const Geometry value;
    return value;
}

bool matches(const std::array<int, kLocalLength>& values, const int* pattern, int length) {
    if (length > kLocalLength) return false;
    for (int start = 0; start <= kLocalLength - length; ++start) {
        int offset = 0;
        while (offset < length && values[start + offset] == pattern[offset]) ++offset;
        if (offset == length) return true;
    }
    return false;
}

struct LineStats {
    std::array<uint8_t, kLocalCodeCount> five{};
    std::array<uint8_t, kLocalCodeCount> openFour{};
    std::array<uint8_t, kLocalCodeCount> four{};
    std::array<uint8_t, kLocalCodeCount> openThree{};
    std::array<uint8_t, kLocalCodeCount> brokenThree{};
    std::array<uint8_t, kLocalCodeCount> openTwo{};

    LineStats() {
        for (int code = 0; code < kLocalCodeCount; ++code) {
            int value = code;
            std::array<int, kLocalLength> cells{};
            int longest = 0;
            int run = 0;
            for (int i = kLocalLength - 1; i >= 0; --i) {
                cells[i] = value % 3;
                value /= 3;
            }
            for (int cell : cells) {
                if (cell == 1) {
                    ++run;
                    longest = std::max(longest, run);
                } else {
                    run = 0;
                }
            }
            five[code] = longest >= 5 ? 1 : 0;
            openFour[code] = matches(cells, kOpenFourPattern, 6) ? 1 : 0;
            int count = 0;
            for (int i = 0; i < 5; ++i) if (matches(cells, kFourPatterns[i], kFourPatternLengths[i])) ++count;
            four[code] = static_cast<uint8_t>(count);
            count = 0;
            for (int i = 0; i < 3; ++i) if (matches(cells, kOpenThreePatterns[i], kOpenThreePatternLengths[i])) ++count;
            openThree[code] = static_cast<uint8_t>(count);
            count = 0;
            for (const auto& pattern : kBrokenThreePatterns) if (matches(cells, pattern, 7)) ++count;
            brokenThree[code] = static_cast<uint8_t>(count);
            openTwo[code] = matches(cells, kOpenTwoPattern, 4) ? 1 : 0;
        }
    }
};

const LineStats& lineStats() {
    static const LineStats value;
    return value;
}

struct Zobrist {
    std::array<uint32_t, kCells * 3> a{};
    std::array<uint32_t, kCells * 3> b{};
    Zobrist() {
        uint32_t state = 0x9e3779b9U;
        for (int i = 0; i < kCells * 3; ++i) {
            state = nextRandom(state); a[i] = state;
            state = nextRandom(state); b[i] = state;
        }
    }
};

const Zobrist& zobrist() {
    static const Zobrist value;
    return value;
}

struct Position {
    std::array<int, kCells> board{};
    std::array<uint8_t, kCells> forbidden{};
    std::array<int16_t, kCells> nearTwo{};
    std::array<int16_t, kCells> nearThree{};
    std::array<std::array<int, kLineSlots>, 2> lineCodes{};
    std::array<std::array<int32_t, kCells>, 2> patterns{};
    mutable std::array<std::array<double, 2>, kMaxBoardLines> boardLineScores{};
    mutable std::array<uint8_t, kMaxBoardLines> boardLineValid{};
    int stones = 0;
    uint32_t hashA = 0;
    uint32_t hashB = 0;

    Position(const std::array<int, kCells>& input, const std::array<uint8_t, kCells>& blocked)
        : board(input), forbidden(blocked) {
        const Zobrist& z = zobrist();
        for (int i = 0; i < kCells; ++i) {
            const int color = board[i];
            if (color == kBlack || color == kWhite) {
                ++stones;
                hashA ^= z.a[i * 3 + color];
                hashB ^= z.b[i * 3 + color];
                updateNeighborhood(i, 1);
            }
        }
        const Geometry& g = geometry();
        for (int color = kBlack; color <= kWhite; ++color) {
            patterns[color - 1].fill(kInvalidPattern);
            for (int slot = 0; slot < kLineSlots; ++slot) {
                int code = 0;
                for (int offset = 0; offset < kLocalLength; ++offset) {
                    const int cell = g.lineIndexes[slot * kLocalLength + offset];
                    const int value = offset == 5 ? 1 : cell < 0 ? 2
                            : board[cell] == kEmpty ? 0 : board[cell] == color ? 1 : 2;
                    code = code * 3 + value;
                }
                lineCodes[color - 1][slot] = code;
            }
        }
    }

    bool empty(int index) const { return board[index] == kEmpty; }

    bool put(int index, int color) {
        if (index < 0 || index >= kCells || board[index] != kEmpty) return false;
        board[index] = color;
        hashA ^= zobrist().a[index * 3 + color];
        hashB ^= zobrist().b[index * 3 + color];
        ++stones;
        updateNeighborhood(index, 1);
        updateLines(index, color, 1);
        return true;
    }

    void remove(int index, int color) {
        if (board[index] != color) return;
        updateNeighborhood(index, -1);
        updateLines(index, color, -1);
        board[index] = kEmpty;
        hashA ^= zobrist().a[index * 3 + color];
        hashB ^= zobrist().b[index * 3 + color];
        --stones;
    }

    void updateLines(int index, int color, int delta) {
        const Geometry& g = geometry();
        const int blackDelta = delta * (color == kBlack ? 1 : 2);
        const int whiteDelta = delta * (color == kWhite ? 1 : 2);
        for (int i = 0; i < g.lineUpdateCounts[index]; ++i) {
            const auto& update = g.lineUpdates[index][i];
            lineCodes[0][update.slot] += blackDelta * update.weight;
            lineCodes[1][update.slot] += whiteDelta * update.weight;
            const int center = update.slot / 4;
            patterns[0][center] = patterns[1][center] = kInvalidPattern;
        }
        for (int i = 0; i < g.boardLineCounts[index]; ++i) {
            boardLineValid[g.boardLineIds[index][i]] = 0;
        }
    }

    void updateNeighborhood(int index, int delta) {
        const int row = index / kSize;
        const int col = index % kSize;
        for (int dr = -3; dr <= 3; ++dr) {
            for (int dc = -3; dc <= 3; ++dc) {
                if (dr == 0 && dc == 0) continue;
                const int r = row + dr;
                const int c = col + dc;
                if (!valid(r, c)) continue;
                const int target = r * kSize + c;
                nearThree[target] = static_cast<int16_t>(nearThree[target] + delta);
                if (std::abs(dr) <= 2 && std::abs(dc) <= 2) {
                    nearTwo[target] = static_cast<int16_t>(nearTwo[target] + delta);
                }
            }
        }
    }
};

struct Candidate {
    int index = -1;
    int ownPattern = kNoPattern;
    int opponentPattern = kNoPattern;
    bool tactical = false;
    double score = 0;
    int row() const { return index / kSize; }
    int col() const { return index % kSize; }
};

bool candidateOrder(const Candidate& a, const Candidate& b) {
    if (a.score != b.score) return a.score > b.score;
    if (a.tactical != b.tactical) return a.tactical;
    if (a.row() != b.row()) return a.row() < b.row();
    return a.col() < b.col();
}

struct TTEntry {
    uint32_t key = 0, hashA = 0, hashB = 0;
    int turn = 0, depth = 0, move = -1, bound = 0;
    double score = 0;
};

struct TranspositionTable {
    static constexpr uint32_t kCapacity = 1U << 17;
    static constexpr uint32_t kMask = kCapacity - 1;
    std::vector<uint32_t> key, hashA, hashB, generations;
    std::vector<int> turn, depth, move, bound;
    std::vector<double> score;
    uint32_t generation = 0;

    TranspositionTable()
        : key(kCapacity), hashA(kCapacity), hashB(kCapacity), generations(kCapacity),
          turn(kCapacity), depth(kCapacity), move(kCapacity, -1), bound(kCapacity), score(kCapacity) {}

    void beginSearch() {
        ++generation;
        if (generation == 0) {
            std::fill(generations.begin(), generations.end(), 0);
            generation = 1;
        }
    }

    uint32_t makeKey(uint32_t a, uint32_t b, int color) const {
        uint32_t value = a ^ rotateLeft(b, 13) ^ static_cast<uint32_t>(color) * 0x85ebca6bU;
        value ^= value >> 16; value *= 0x7feb352dU; value ^= value >> 15;
        value *= 0x846ca68bU; return value ^ (value >> 16);
    }

    bool get(uint32_t hash, uint32_t a, uint32_t b, int color, TTEntry& entry) const {
        const uint32_t slot = hash & kMask;
        if (generations[slot] != generation || key[slot] != hash || hashA[slot] != a
                || hashB[slot] != b || turn[slot] != color) return false;
        entry.key = hash; entry.hashA = a; entry.hashB = b;
        entry.turn = turn[slot]; entry.depth = depth[slot]; entry.move = move[slot];
        entry.bound = bound[slot]; entry.score = score[slot];
        return true;
    }

    void put(uint32_t hash, uint32_t a, uint32_t b, int color, int newDepth,
             double newScore, int newMove, int newBound) {
        const uint32_t slot = hash & kMask;
        if (generations[slot] == generation && key[slot] != hash && depth[slot] > newDepth) return;
        generations[slot] = generation; key[slot] = hash; hashA[slot] = a; hashB[slot] = b;
        turn[slot] = color; depth[slot] = newDepth; score[slot] = newScore;
        move[slot] = newMove; bound[slot] = newBound;
    }
};

TranspositionTable& sharedTable() {
    static TranspositionTable value;
    return value;
}

struct ThreatEntry {
    uint32_t hashA = 0, hashB = 0;
    int attacker = 0, remaining = 0, status = kThreatFail, move = -1;
};

struct SearchThreat {
    int status = kThreatUnknown;
    Candidate move;
    bool hasMove = false;
};

struct Context {
    int aiColor;
    int opponent;
    Position& position;
    std::chrono::steady_clock::time_point deadline;
    TranspositionTable& table;
    std::array<std::array<int, 2>, 32> killers{};
    std::array<int, kCells> history{};
    int nodes = 0, tacticalLeaves = 0, completedDepth = 0, rootMove = -1;
    bool aborted = false;
    int tacticalLeafLimit = kTacticalLeafLimit;

    Context(Position& p, int color, std::chrono::steady_clock::time_point end)
        : aiColor(color), opponent(color == kBlack ? kWhite : kBlack), position(p),
          deadline(end), table(sharedTable()) {
        table.beginSearch();
        for (auto& pair : killers) pair.fill(-1);
    }
};

struct SearchResult {
    double score = 0;
    Candidate move;
    bool hasMove = false;
    bool aborted = false;
};

struct MoveResult {
    int index = -1;
    double score = 0;
    int depth = 0;
    int nodes = 0;
};

class Engine {
public:
    MoveResult chooseMove(const std::array<int, kCells>& board, int aiColor,
                          const std::array<uint8_t, kCells>& forbidden) {
        const auto started = std::chrono::steady_clock::now();
        const auto deadline = started + kSearchBudget;
        Position position(board, forbidden);
        const int opponent = aiColor == kBlack ? kWhite : kBlack;
        std::vector<Candidate> legal = candidates(position, aiColor, kCandidateLimit);
        if (legal.empty()) {
            const int first = firstEmpty(position);
            return {first, 0, 0, 0};
        }
        if (position.stones == 0) return {7 * kSize + 7, 0, 0, 0};

        const std::vector<Candidate> ownWins = winningMoves(position, aiColor);
        if (!ownWins.empty()) return {ownWins.front().index, kWin, 0, 0};
        const std::vector<Candidate> opponentWins = winningMoves(position, opponent);
        if (opponentWins.size() == 1) return {opponentWins.front().index, kWin * 0.92, 0, 0};

        Context context(position, aiColor, deadline);
        const SearchThreat forcing = findThreatSpaceMove(position, aiColor, legal, kThreatPly, deadline);
        if (forcing.status == kThreatWin && forcing.hasMove) return {forcing.move.index, kWin, 0, 0};

        std::vector<Candidate> roots = rootCandidates(position, aiColor, opponent, legal);
        Candidate best = roots.empty() ? legal.front() : roots.front();
        double bestScore = best.score;
        int previousBestIndex = best.index;
        int stableIterations = 0;
        for (int depth = 1; depth <= kMaxDepth; ++depth) {
            context.tacticalLeaves = 0;
            sortMoves(roots, context, 0, context.rootMove, -1);
            SearchResult result = searchRoot(position, roots, depth, context);
            if (result.aborted) break;
            if (result.hasMove) {
                best = result.move; bestScore = result.score; context.rootMove = best.index;
            }
            context.completedDepth = depth;
            if (result.score >= kWin - 1000) break;
            if (best.index == previousBestIndex) ++stableIterations;
            else stableIterations = 0;
            previousBestIndex = best.index;
            if (depth >= 5 && stableIterations >= 2 && !hasTacticalCandidate(roots)
                    && std::chrono::steady_clock::now() - started >= std::chrono::milliseconds(180)) break;
        }
        return {best.index, bestScore, context.completedDepth, context.nodes};
    }

private:
    static bool expired(std::chrono::steady_clock::time_point deadline) {
        return std::chrono::steady_clock::now() >= deadline;
    }

    static int firstEmpty(const Position& p) {
        for (int i = 0; i < kCells; ++i) if (p.empty(i) && !p.forbidden[i]) return i;
        return -1;
    }

    static bool hasTacticalCandidate(const std::vector<Candidate>& moves) {
        return std::any_of(moves.begin(), moves.end(), [](const Candidate& move) { return move.tactical; });
    }

    static bool nearStone(const Position& p, int index, int radius) {
        return radius >= 3 ? p.nearThree[index] > 0 : p.nearTwo[index] > 0;
    }

    static std::vector<Candidate> candidates(Position& p, int color, int limit) {
        if (p.stones == 0) {
            const int center = 7 * kSize + 7;
            return p.forbidden[center] ? std::vector<Candidate>() : singletonCandidate(p, color, center);
        }
        const int opponent = color == kBlack ? kWhite : kBlack;
        const int radius = p.stones <= 12 ? 3 : 2;
        std::vector<Candidate> raw;
        raw.reserve(160);
        const Geometry& g = geometry();
        for (int index = 0; index < kCells; ++index) {
            const int row = g.rows[index], col = g.cols[index];
            const bool openingAnchor = p.stones <= 4 && std::abs(row - 7) <= 3 && std::abs(col - 7) <= 3;
            if (!p.empty(index) || p.forbidden[index] || (!openingAnchor && !nearStone(p, index, radius))) continue;
            const int own = analyzeMove(p, index, color), other = analyzeMove(p, index, opponent);
            const bool tactical = patternTactical(own) || patternTactical(other);
            raw.push_back({index, own, other, tactical,
                           moveOrderingScore(own, other) + g.positionValues[index]});
        }
        if (raw.empty()) {
            for (int i = 0; i < kCells; ++i) if (p.empty(i) && !p.forbidden[i]) {
                raw.push_back({i, kNoPattern, kNoPattern, false, static_cast<double>(g.positionValues[i])});
            }
        }
        std::sort(raw.begin(), raw.end(), candidateOrder);
        std::array<uint8_t, kCells> seen{};
        const int requested = std::max(1, limit);
        int selectedCount = std::min(static_cast<int>(raw.size()), requested);
        for (int i = 0; i < selectedCount; ++i) {
            seen[raw[i].index] = 1;
        }
        int tacticalCount = 0;
        // Compact forward without changing either sorted prefix or tactical
        // append order; the destination never overtakes the source.
        for (int i = selectedCount; i < static_cast<int>(raw.size()); ++i) {
            const Candidate move = raw[i];
            if (move.tactical && !seen[move.index]) {
                raw[selectedCount++] = move;
                seen[move.index] = 1;
                if (++tacticalCount >= kMaxTacticalCandidates) break;
            }
        }
        raw.resize(selectedCount);
        const int globalLimit = p.stones <= 8 ? kMaxGlobalCandidates : kMaxGlobalCandidates / 2;
        for (const Candidate& move : globalStrategicMoves(p, color, opponent, globalLimit)) {
            if (!seen[move.index]) { raw.push_back(move); seen[move.index] = 1; }
        }
        return raw;
    }

    static std::vector<Candidate> singletonCandidate(Position& p, int color, int index) {
        const int own = analyzeMove(p, index, color);
        const int other = analyzeMove(p, index, color == kBlack ? kWhite : kBlack);
        return {{index, own, other, patternTactical(own) || patternTactical(other), moveOrderingScore(own, other)}};
    }

    static void addAnchor(const Position& p, std::vector<Candidate>& list,
                          std::array<uint8_t, kCells>& seen, int row, int col) {
        if (!valid(row, col)) return;
        const int index = row * kSize + col;
        if (!seen[index] && p.empty(index) && !p.forbidden[index]) {
            seen[index] = 1;
            list.push_back({index, kNoPattern, kNoPattern, false,
                            static_cast<double>(geometry().positionValues[index])});
        }
    }

    static std::vector<Candidate> globalStrategicMoves(Position& p, int color, int opponent, int limit) {
        std::array<uint8_t, kCells> seen{};
        std::vector<Candidate> anchors;
        anchors.reserve(80);
        addAnchor(p, anchors, seen, 7, 7);
        constexpr int offsets[] = {2, 3, 5, 7};
        for (int offset : offsets) {
            addAnchor(p, anchors, seen, 7 - offset, 7); addAnchor(p, anchors, seen, 7 + offset, 7);
            addAnchor(p, anchors, seen, 7, 7 - offset); addAnchor(p, anchors, seen, 7, 7 + offset);
            addAnchor(p, anchors, seen, 7 - offset, 7 - offset); addAnchor(p, anchors, seen, 7 - offset, 7 + offset);
            addAnchor(p, anchors, seen, 7 + offset, 7 - offset); addAnchor(p, anchors, seen, 7 + offset, 7 + offset);
        }
        const int step = std::max(2, kSize / 4);
        for (int row = 1; row < kSize; row += step) for (int col = 1; col < kSize; col += step) {
            addAnchor(p, anchors, seen, row, col);
        }
        std::sort(anchors.begin(), anchors.end(), [](const Candidate& a, const Candidate& b) {
            if (geometry().positionValues[a.index] != geometry().positionValues[b.index]) {
                return geometry().positionValues[a.index] > geometry().positionValues[b.index];
            }
            if (a.row() != b.row()) return a.row() < b.row();
            return a.col() < b.col();
        });
        if (static_cast<int>(anchors.size()) > limit) anchors.resize(limit);
        for (Candidate& anchor : anchors) {
            const int own = analyzeMove(p, anchor.index, color);
            const int other = analyzeMove(p, anchor.index, opponent);
            const bool tactical = patternTactical(own) || patternTactical(other);
            anchor = {anchor.index, own, other, tactical,
                      moveOrderingScore(own, other) + geometry().positionValues[anchor.index]};
        }
        return anchors;
    }

    static void addRoot(Position& p, std::vector<Candidate>& out,
                        std::array<uint8_t, kCells>& seen, const Candidate& source,
                        int color, int opponent) {
        const int index = source.index;
        if (index < 0 || index >= kCells || !p.empty(index) || p.forbidden[index] || seen[index]) return;
        const int own = analyzeMove(p, index, color), other = analyzeMove(p, index, opponent);
        const bool tactical = patternTactical(own) || patternTactical(other);
        const double score = std::isfinite(source.score) ? source.score :
                moveOrderingScore(own, other) + geometry().positionValues[index];
        out.push_back({index, own, other, tactical, score});
        seen[index] = 1;
    }

    static std::vector<Candidate> rootCandidates(Position& p, int color, int opponent,
                                                  const std::vector<Candidate>& legal) {
        std::vector<Candidate> result;
        std::array<uint8_t, kCells> seen{};
        const int count = std::min(kRootLimit, static_cast<int>(legal.size()));
        for (int i = 0; i < count; ++i) addRoot(p, result, seen, legal[i], color, opponent);
        const auto tacticalPool = candidates(p, color, std::max(kCandidateLimit, kMaxTacticalCandidates));
        for (const Candidate& move : tacticalPool) if (move.tactical) addRoot(p, result, seen, move, color, opponent);
        for (const Candidate& move : winningMoves(p, opponent)) addRoot(p, result, seen, move, color, opponent);
        std::sort(result.begin(), result.end(), [](const Candidate& a, const Candidate& b) {
            if (a.tactical != b.tactical) return a.tactical;
            return candidateOrder(a, b);
        });
        return result.empty() ? legal : result;
    }

    static std::vector<Candidate> winningMoves(const Position& p, int color) {
        std::vector<Candidate> wins;
        for (int index = 0; index < kCells; ++index) {
            if (p.empty(index) && !p.forbidden[index] && winsAt(p, index, color)) {
                wins.push_back({index, kNoPattern, kNoPattern, true, static_cast<double>(kWin)});
            }
        }
        return wins;
    }

    static bool winsAt(const Position& p, int index, int color) {
        const int row = index / kSize, col = index % kSize;
        for (const auto& direction : kDirections) {
            const int count = 1 + countExisting(p, row, col, direction[0], direction[1], color)
                    + countExisting(p, row, col, -direction[0], -direction[1], color);
            if (count >= 5) return true;
        }
        return false;
    }

    static int countExisting(const Position& p, int row, int col, int dr, int dc, int color) {
        int count = 0;
        for (int r = row + dr, c = col + dc; valid(r, c) && p.board[r * kSize + c] == color; r += dr, c += dc) ++count;
        return count;
    }

    static std::vector<Candidate> forcingCandidates(Position& p, int color) {
        auto all = candidates(p, color, std::max(64, kMaxTacticalCandidates));
        all.erase(std::remove_if(all.begin(), all.end(), [](const Candidate& move) {
            return !move.tactical;
        }), all.end());
        std::sort(all.begin(), all.end(), candidateOrder);
        if (static_cast<int>(all.size()) > kMaxTacticalCandidates) all.resize(kMaxTacticalCandidates);
        return all;
    }

    static void addThreatRoot(Position& p, std::vector<Candidate>& roots,
                              std::array<uint8_t, kCells>& seen, const Candidate& source, int color) {
        const int index = source.index;
        if (index < 0 || index >= kCells || !p.empty(index) || p.forbidden[index] || seen[index]) return;
        const int opponent = color == kBlack ? kWhite : kBlack;
        const int own = analyzeMove(p, index, color), other = analyzeMove(p, index, opponent);
        if (!patternTactical(own) && !patternTactical(other)) return;
        const double score = std::isfinite(source.score) ? source.score : moveOrderingScore(own, other);
        roots.push_back({index, own, other, true, score});
        seen[index] = 1;
    }

    static SearchThreat findThreatSpaceMove(Position& p, int color,
                                             const std::vector<Candidate>& legal, int maxPly,
                                             std::chrono::steady_clock::time_point deadline) {
        std::unordered_map<uint32_t, ThreatEntry> table;
        table.reserve(4096);
        std::vector<Candidate> roots;
        std::array<uint8_t, kCells> seen{};
        for (const Candidate& move : legal) addThreatRoot(p, roots, seen, move, color);
        for (const Candidate& move : forcingCandidates(p, color)) addThreatRoot(p, roots, seen, move, color);
        SearchThreat result = searchThreat(p, color, maxPly, deadline, table, roots, 0);
        if (result.status != kThreatWin) return {};
        return result;
    }

    static Candidate candidateForIndex(Position& p, int index, int color) {
        const int opponent = color == kBlack ? kWhite : kBlack;
        return {index, analyzeMove(p, index, color), analyzeMove(p, index, opponent), true, 0};
    }

    static SearchThreat searchThreat(Position& p, int attacker, int remaining,
                                      std::chrono::steady_clock::time_point deadline,
                                      std::unordered_map<uint32_t, ThreatEntry>& table,
                                      const std::vector<Candidate>& roots, int ply) {
        if (expired(deadline)) return {kThreatUnknown, {}, false};
        if (remaining <= 0) return {kThreatFail, {}, false};
        const uint32_t key = p.hashA ^ rotateLeft(p.hashB, 11)
                ^ static_cast<uint32_t>(attacker) * 0x85ebca6bU
                ^ static_cast<uint32_t>(remaining) * 0xc2b2ae35U;
        auto cachedIt = table.find(key);
        if (cachedIt != table.end()) {
            const ThreatEntry& cached = cachedIt->second;
            if (cached.hashA == p.hashA && cached.hashB == p.hashB
                    && cached.attacker == attacker && cached.remaining == remaining) {
                if (cached.move < 0) return {cached.status, {}, false};
                return {cached.status, candidateForIndex(p, cached.move, attacker), true};
            }
        }
        const auto direct = winningMoves(p, attacker);
        if (!direct.empty()) return {kThreatWin, direct.front(), true};
        const int defender = attacker == kBlack ? kWhite : kBlack;
        const std::vector<Candidate> moves = ply == 0 && !roots.empty() ? roots : forcingCandidates(p, attacker);
        bool unknown = false;
        for (const Candidate& move : moves) {
            if (expired(deadline)) { unknown = true; break; }
            if (!p.put(move.index, attacker)) continue;
            int branch = kThreatFail;
            if (hasFive(p, move.index, attacker)) branch = kThreatWin;
            else if (winningMoves(p, defender).empty()) {
                const auto ownWins = winningMoves(p, attacker);
                if (ownWins.size() >= 2) branch = kThreatWin;
                else if (ownWins.size() == 1) {
                    const int block = ownWins.front().index;
                    if (p.forbidden[block] || !p.empty(block)) branch = kThreatWin;
                    else if (remaining >= 3 && p.put(block, defender)) {
                        const SearchThreat child = searchThreat(p, attacker, remaining - 2, deadline, table, roots, ply + 2);
                        p.remove(block, defender);
                        if (child.status == kThreatWin) branch = kThreatWin;
                        else if (child.status == kThreatUnknown) unknown = true;
                    }
                }
            }
            p.remove(move.index, attacker);
            if (branch == kThreatWin) {
                table[key] = {p.hashA, p.hashB, attacker, remaining, kThreatWin, move.index};
                return {kThreatWin, move, true};
            }
        }
        const int status = unknown ? kThreatUnknown : kThreatFail;
        if (status == kThreatFail) table[key] = {p.hashA, p.hashB, attacker, remaining, status, -1};
        return {status, {}, false};
    }

    static int analyzeMove(Position& p, int index, int color) {
        if (index < 0 || index >= kCells || !p.empty(index)) return kInvalidPattern;
        int32_t& cached = p.patterns[color - 1][index];
        if (cached != kInvalidPattern) return cached;
        int five = 0, openFour = 0, four = 0, openThree = 0, brokenThree = 0, openTwo = 0;
        const LineStats& stats = lineStats();
        for (int direction = 0; direction < 4; ++direction) {
            const int code = p.lineCodes[color - 1][index * 4 + direction];
            five += stats.five[code]; openFour += stats.openFour[code]; four += stats.four[code];
            openThree += stats.openThree[code]; brokenThree += stats.brokenThree[code]; openTwo += stats.openTwo[code];
        }
        cached = packPattern(five, openFour, four, openThree, brokenThree, openTwo);
        return cached;
    }

    static int32_t packPattern(int five, int openFour, int four, int openThree, int brokenThree, int openTwo) {
        const uint32_t value = static_cast<uint32_t>(five)
                | (static_cast<uint32_t>(openFour) << 5)
                | (static_cast<uint32_t>(four) << 10)
                | (static_cast<uint32_t>(openThree) << 15)
                | (static_cast<uint32_t>(brokenThree) << 20)
                | (static_cast<uint32_t>(openTwo) << 25);
        return static_cast<int32_t>(value);
    }

    static int patternCount(int32_t pattern, int shift) {
        if (pattern < 0 || pattern == kInvalidPattern) return 0;
        return static_cast<int>((static_cast<uint32_t>(pattern) >> shift) & kPatternMask);
    }

    static bool patternTactical(int32_t pattern) {
        return patternCount(pattern, 0) > 0 || patternCount(pattern, 5) > 0
                || patternCount(pattern, 10) > 0 || patternCount(pattern, 15) > 0
                || patternCount(pattern, 20) > 0;
    }

    static double patternScore(int32_t pattern) {
        if (pattern == kInvalidPattern) return -std::numeric_limits<double>::infinity();
        const int five = patternCount(pattern, 0), openFour = patternCount(pattern, 5);
        const int four = patternCount(pattern, 10), openThree = patternCount(pattern, 15);
        const int brokenThree = patternCount(pattern, 20), openTwo = patternCount(pattern, 25);
        return five > 0 ? kWin : openFour > 0 ? kOpenFour : four >= 2 ? kFour * 7.0
                : four > 0 && openThree > 0 ? kFour * 5.0 : openThree >= 2 ? kDoubleThree
                : four > 0 ? kFour : openThree > 0 ? kOpenThree : brokenThree > 0 ? kBrokenThree
                : openTwo > 0 ? kOpenTwo : kOne;
    }

    static double moveOrderingScore(int own, int opponent) {
        const int ownFive = patternCount(own, 0), opponentFive = patternCount(opponent, 0);
        const int ownOpenFour = patternCount(own, 5), opponentOpenFour = patternCount(opponent, 5);
        const int ownFour = patternCount(own, 10), opponentFour = patternCount(opponent, 10);
        const int ownOpenThree = patternCount(own, 15), opponentOpenThree = patternCount(opponent, 15);
        if (ownFive > 0) return kWin;
        if (opponentFive > 0) return kWin * 0.92;
        if (ownOpenFour > 0) return kOpenFour;
        if (opponentOpenFour > 0) return kOpenFour * 0.9;
        if (ownFour >= 2) return kFour * 7.0;
        if (opponentFour >= 2) return kFour * 6.5;
        if (ownFour > 0 && ownOpenThree > 0) return kFour * 5.0;
        if (opponentFour > 0 && opponentOpenThree > 0) return kFour * 4.5;
        if (ownOpenThree >= 2) return kDoubleThree;
        if (opponentOpenThree >= 2) return kDoubleThree * 0.92;
        return patternScore(own) * 1.18 + patternScore(opponent) * 1.08;
    }

    static bool hasFive(const Position& p, int index, int color) {
        for (const auto& direction : kDirections) {
            const int count = 1 + countDirection(p, index, direction[0], direction[1], color)
                    + countDirection(p, index, -direction[0], -direction[1], color);
            if (count >= 5) return true;
        }
        return false;
    }

    static int countDirection(const Position& p, int index, int dr, int dc, int color) {
        int count = 0;
        for (int row = index / kSize + dr, col = index % kSize + dc;
             valid(row, col) && p.board[row * kSize + col] == color; row += dr, col += dc) ++count;
        return count;
    }

    static double movePriority(const Candidate& move, const Context& context, int ply,
                               int preferred, int ttMove, int killer0, int killer1) {
        double value = std::isfinite(move.score) ? move.score : 0;
        if (move.index == ttMove) value += kWin * 2.0;
        if (ply == 0 && move.index == context.rootMove) value += kWin;
        if (move.index == killer0) value += kOpenFour;
        else if (move.index == killer1) value += kFour;
        value += context.history[move.index];
        if (move.ownPattern != kNoPattern && patternCount(move.ownPattern, 0) > 0) value += kWin;
        if (move.opponentPattern != kNoPattern && patternCount(move.opponentPattern, 0) > 0) value += kWin * 0.96;
        if (move.index == preferred) value += kWin * 2.0;
        return value;
    }

    static void sortMoves(std::vector<Candidate>& moves, const Context& context,
                          int ply, int preferred, int ttMove) {
        const int killer0 = ply < static_cast<int>(context.killers.size()) ? context.killers[ply][0] : -1;
        const int killer1 = ply < static_cast<int>(context.killers.size()) ? context.killers[ply][1] : -1;
        std::sort(moves.begin(), moves.end(), [&](const Candidate& a, const Candidate& b) {
            const double pa = movePriority(a, context, ply, preferred, ttMove, killer0, killer1);
            const double pb = movePriority(b, context, ply, preferred, ttMove, killer0, killer1);
            if (pa != pb) return pa > pb;
            if (a.row() != b.row()) return a.row() < b.row();
            return a.col() < b.col();
        });
    }

    static double evaluateLine(const Position& p, const std::vector<int>& line, int color) {
        double score = 0;
        for (int i = 0; i < static_cast<int>(line.size());) {
            if (p.board[line[i]] != color) { ++i; continue; }
            const int start = i;
            while (i < static_cast<int>(line.size()) && p.board[line[i]] == color) ++i;
            const int length = i - start;
            const bool openLeft = start > 0 && p.board[line[start - 1]] == kEmpty;
            const bool openRight = i < static_cast<int>(line.size()) && p.board[line[i]] == kEmpty;
            const int opens = (openLeft ? 1 : 0) + (openRight ? 1 : 0);
            if (length >= 5) score += kWin;
            else if (length == 4) score += opens == 2 ? kOpenFour : opens > 0 ? kFour : 0;
            else if (length == 3) score += opens == 2 ? kOpenThree : opens > 0 ? kBrokenThree : 0;
            else if (length == 2) score += opens == 2 ? kOpenTwo : opens > 0 ? kTwo : 0;
            else if (length == 1 && opens == 2) score += kOne;
        }
        const int opponent = color == kBlack ? kWhite : kBlack;
        for (int start = 0; start <= static_cast<int>(line.size()) - 5; ++start) {
            int own = 0, other = 0, empty = 0, longest = 0, run = 0;
            for (int offset = 0; offset < 5; ++offset) {
                const int cell = p.board[line[start + offset]];
                if (cell == color) { ++own; ++run; longest = std::max(longest, run); }
                else { run = 0; if (cell == opponent) ++other; else ++empty; }
            }
            if (other > 0) continue;
            if (own == 4 && empty == 1 && longest < 4) score += kFour * 0.78;
            else if (own == 3 && empty == 2 && longest < 3) score += kBrokenThree * 0.9;
            else if (own == 2 && empty == 3 && longest < 2) score += kTwo * 0.55;
        }
        return score;
    }

    static double evaluateBoard(const Position& p, int aiColor, int opponent) {
        double ai = 0, other = 0;
        int lineId = 0;
        for (const auto& line : geometry().lines) {
            if (!p.boardLineValid[lineId]) {
                p.boardLineScores[lineId][aiColor - 1] = evaluateLine(p, line, aiColor);
                p.boardLineScores[lineId][opponent - 1] = evaluateLine(p, line, opponent);
                p.boardLineValid[lineId] = 1;
            }
            // Keep the original line order and summation to preserve rounding.
            ai += p.boardLineScores[lineId][aiColor - 1];
            other += p.boardLineScores[lineId][opponent - 1];
            ++lineId;
        }
        double positional = 0;
        for (int i = 0; i < kCells; ++i) if (p.board[i] != kEmpty) {
            positional += p.board[i] == aiColor ? geometry().positionValues[i] : -geometry().positionValues[i];
        }
        return ai - other * 1.12 + positional;
    }

    static SearchResult searchRoot(Position& p, const std::vector<Candidate>& moves,
                                   int depth, Context& context) {
        SearchResult result;
        result.score = -std::numeric_limits<double>::infinity();
        double alpha = -std::numeric_limits<double>::infinity();
        for (const Candidate& move : moves) {
            if (expired(context.deadline)) { result.aborted = true; return result; }
            if (!p.put(move.index, context.aiColor)) continue;
            double score;
            if (hasFive(p, move.index, context.aiColor)) score = kWin - kMateDistance;
            else {
                score = search(p, depth - 1, alpha, std::numeric_limits<double>::infinity(),
                               context.opponent, context, 1);
                if (context.aborted) { p.remove(move.index, context.aiColor); result.aborted = true; return result; }
            }
            p.remove(move.index, context.aiColor);
            if (score > result.score) { result.score = score; result.move = move; result.hasMove = true; }
            alpha = std::max(alpha, result.score);
        }
        return result;
    }

    static double search(Position& p, int depth, double alpha, double beta,
                         int turn, Context& context, int ply) {
        ++context.nodes;
        if (expired(context.deadline)) { context.aborted = true; return 0; }
        if (depth <= 0) return evaluateLeaf(p, turn, context, ply);
        const double alphaStart = alpha, betaStart = beta;
        const uint32_t key = context.table.makeKey(p.hashA, p.hashB, turn);
        TTEntry cached;
        const bool hasCached = context.table.get(key, p.hashA, p.hashB, turn, cached);
        const int ttMove = hasCached ? cached.move : -1;
        if (hasCached && cached.depth >= depth) {
            if (cached.bound == 0) return cached.score;
            if (cached.bound == 1) alpha = std::max(alpha, cached.score);
            else if (cached.bound == 2) beta = std::min(beta, cached.score);
            if (alpha >= beta) return cached.score;
        }
        const bool maximizing = turn == context.aiColor;
        const int limit = depth >= 4 ? 12 : depth >= 2 ? 18 : 24;
        auto moves = candidates(p, turn, limit);
        sortMoves(moves, context, ply, -1, ttMove);
        if (moves.empty()) return 0;
        double best = maximizing ? -std::numeric_limits<double>::infinity() : std::numeric_limits<double>::infinity();
        Candidate bestMove;
        bool hasBestMove = false, cutoff = false;
        const int next = turn == kBlack ? kWhite : kBlack;
        for (const Candidate& move : moves) {
            if (expired(context.deadline)) { context.aborted = true; return 0; }
            if (!p.put(move.index, turn)) continue;
            double score;
            if (hasFive(p, move.index, turn)) {
                score = maximizing ? kWin - ply * kMateDistance : -kWin + ply * kMateDistance;
            } else {
                score = search(p, depth - 1, alpha, beta, next, context, ply + 1);
                if (context.aborted) { p.remove(move.index, turn); return 0; }
            }
            p.remove(move.index, turn);
            if (maximizing) {
                if (score > best) { best = score; bestMove = move; hasBestMove = true; }
                alpha = std::max(alpha, best);
            } else {
                if (score < best) { best = score; bestMove = move; hasBestMove = true; }
                beta = std::min(beta, best);
            }
            if (beta <= alpha) { cutoff = true; break; }
        }
        const int bound = best <= alphaStart ? 2 : best >= betaStart ? 1 : 0;
        context.table.put(key, p.hashA, p.hashB, turn, depth, best, hasBestMove ? bestMove.index : -1, bound);
        if (cutoff && hasBestMove && ply < static_cast<int>(context.killers.size())) {
            auto& killer = context.killers[ply];
            if (killer[0] != bestMove.index) { killer[1] = killer[0]; killer[0] = bestMove.index; }
            const int64_t value = static_cast<int64_t>(context.history[bestMove.index])
                    + static_cast<int64_t>(depth) * depth * 64;
            context.history[bestMove.index] = static_cast<int>(std::min<int64_t>(1000000, value));
        }
        return best;
    }

    static double evaluateLeaf(Position& p, int turnColor, Context& context, int ply) {
        const double base = evaluateBoard(p, context.aiColor, context.opponent);
        if (++context.tacticalLeaves > context.tacticalLeafLimit) return base;
        const auto current = winningMoves(p, turnColor);
        const double mate = kWin - ply * kMateDistance;
        if (!current.empty()) return turnColor == context.aiColor ? mate : -mate;
        const int other = turnColor == kBlack ? kWhite : kBlack;
        const auto opponentWins = winningMoves(p, other);
        if (opponentWins.size() >= 2) return other == context.aiColor ? mate : -mate;
        if (opponentWins.size() == 1) return base + (other == context.aiColor ? kFour * 0.92 : -kFour * 0.92);
        return base;
    }
};

}  // namespace

extern "C" JNIEXPORT jboolean JNICALL
Java_com_gomoku_master_NativeGomokuAI_warmUpNative(JNIEnv*, jclass) {
    try {
        (void)geometry();
        (void)lineStats();
        (void)zobrist();
        (void)sharedTable();
        return JNI_TRUE;
    } catch (...) {
        return JNI_FALSE;
    }
}

extern "C" JNIEXPORT jdoubleArray JNICALL
Java_com_gomoku_master_NativeGomokuAI_chooseMoveNative(JNIEnv* env, jclass,
                                                        jintArray boardArray, jint aiColor,
                                                        jbooleanArray forbiddenArray) {
    if (boardArray == nullptr || (aiColor != kBlack && aiColor != kWhite)
            || env->GetArrayLength(boardArray) != kCells) return nullptr;
    std::array<jint, kCells> input{};
    env->GetIntArrayRegion(boardArray, 0, kCells, input.data());
    if (env->ExceptionCheck()) return nullptr;
    std::array<int, kCells> board{};
    for (int i = 0; i < kCells; ++i) {
        if (input[i] < kEmpty || input[i] > kWhite) return nullptr;
        board[i] = input[i];
    }
    std::array<uint8_t, kCells> forbidden{};
    if (forbiddenArray != nullptr && env->GetArrayLength(forbiddenArray) == kCells) {
        std::array<jboolean, kCells> blocked{};
        env->GetBooleanArrayRegion(forbiddenArray, 0, kCells, blocked.data());
        if (env->ExceptionCheck()) return nullptr;
        for (int i = 0; i < kCells; ++i) forbidden[i] = blocked[i] == JNI_TRUE ? 1 : 0;
    }
    try {
        static Engine engine;
        const MoveResult move = engine.chooseMove(board, aiColor, forbidden);
        if (move.index < 0 || move.index >= kCells) return nullptr;
        const jdouble values[] = {static_cast<jdouble>(move.index), move.score,
                                  static_cast<jdouble>(move.depth), static_cast<jdouble>(move.nodes)};
        jdoubleArray result = env->NewDoubleArray(4);
        if (result == nullptr) return nullptr;
        env->SetDoubleArrayRegion(result, 0, 4, values);
        return env->ExceptionCheck() ? nullptr : result;
    } catch (...) {
        return nullptr;
    }
}
