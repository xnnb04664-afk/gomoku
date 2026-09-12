import json
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
VARIANTS = (
    ROOT / "index.html",
    ROOT / "五子棋大师_单文件版.html",
    ROOT / "android_src" / "assets" / "index.html",
)
BUTTON_IDS = (
    "btnGameFriends", "btnGameRecent", "btnGameRank", "btnGameBag",
    "btnGameTasks", "btnGameAchievements", "btnGameActivity", "btnGameSettings",
)


def extract_button_ids(source):
    # 收放入口也使用 btnGame 前缀，但它不属于八宫格；只提取八个固定功能按钮。
    return tuple(re.findall(
        r'<button[^>]*id="(btnGame(?:Friends|Recent|Rank|Bag|Tasks|Achievements|Activity|Settings))"',
        source,
    ))


def main():
    version = json.loads((ROOT / "version.json").read_text(encoding="utf-8"))
    internal = f"v{version['versionName']}"
    patch = int(str(version["versionName"]).split(".")[-1])
    # The display convention is v1.2.3 for internal v1.0.123.
    display = f"v1.{max(0, patch // 10 - 10)}.{patch % 10}" if patch >= 100 else internal

    for path in VARIANTS:
        source = path.read_text(encoding="utf-8")
        assert source.count('id="gameSocialDock"') == 1, path
        assert extract_button_ids(source) == BUTTON_IDS, f"{path}: 八宫格顺序不一致"
        assert 'id="socialAffinitySummary"' in source, f"{path}: 好感度摘要缺失"
        assert "/api/economy/summary" in source, f"{path}: 经济摘要接口缺失"
        assert "openGameCheckIn" in source and "openGameAffinity" in source, f"{path}: 签到/好友入口缺失"
        assert "gameRechargeStatus" in source and "gameFeatureOrderList" in source, f"{path}: 充值或排序设置缺失"
        assert internal in source and display in source, f"{path}: 版本文字未同步"
        # Sky Island visual layer is embedded in every offline-capable variant.
        for marker in ("skyIslandEnhancementsStyle", "skyIslandEnhancements", "sky-victory-afterglow", "sky-replay-insights", "SKY_ISLAND_FEATURE_FLAGS"):
            assert marker in source, f"{path}: 天空棋岛增强缺失 {marker}"
        assert re.search(r"doubleStarEndgame\\s*:\\s*false", source) and re.search(r"weatherSeason\\s*:\\s*false", source), f"{path}: 未启用未来功能钩子"
        assert re.search(r"prefers-reduced-motion\\s*:\\s*reduce", source), f"{path}: reduced-motion 降级缺失"
        assert "low-spec-mode" in source, f"{path}: low-spec 降级缺失"
        assert "候选标记" in source and "结果标记" in source, f"{path}: 复盘候选文案未声明降级"
        assert 'aria-current' in source and 'gameDockUnreadBadge' in source, f"{path}: 浮岛 aria/红点缺失"

    backend = (ROOT / "backend" / "worker.js").read_text(encoding="utf-8")
    pages_worker = (ROOT / "pages_build" / "_worker.js").read_text(encoding="utf-8")
    for marker in (
        "/api/economy/summary", "/api/economy/checkin", "/api/economy/catalog",
        "/api/economy/orders", "/api/user/game-layout", "daily_checkin_claims",
        "claim_nonce", "premium_wallets", "social_affinity",
    ):
        assert marker in backend, f"backend 缺少 {marker}"
        assert marker in pages_worker, f"Pages Worker 缺少 {marker}"
    for marker in ("/api/messages", "client_message_id", "SOCIAL_AFFINITY_MAX_POINTS", "social_affinity.points + 1", "requireRegisteredUser"):
        assert marker in backend, f"好友私聊/正式账号守卫缺少 {marker}"
        assert marker in pages_worker, f"Pages Worker 缺少 {marker}"

    # Offline private messages are inserted before affinity/notification work.
    post = backend.index("/api/messages")
    ins = backend.find("INSERT OR IGNORE INTO private_messages", post)
    affinity = backend.find("social_affinity", ins)
    notify = backend.find("notifySocialUser", affinity)
    assert post >= 0 and ins > post and affinity > ins and notify > affinity
    print("game social variants smoke: PASS")


if __name__ == "__main__":
    main()
