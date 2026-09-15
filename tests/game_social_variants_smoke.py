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


def extract_block(source, tag, ident):
    pattern = rf'<{tag} id="{re.escape(ident)}">.*?</{tag}>'
    match = re.search(pattern, source, re.S)
    assert match, f"{ident} block missing"
    return match.group(0)


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
    # The display convention is v1.2.5 for internal v1.0.125.
    display = f"v1.{max(0, patch // 10 - 10)}.{patch % 10}" if patch >= 100 else internal

    sources = {}
    for path in VARIANTS:
        source = path.read_text(encoding="utf-8")
        sources[path] = source
        assert source.count('id="gameSocialDock"') == 1, path
        assert extract_button_ids(source) == BUTTON_IDS, f"{path}: 八宫格顺序不一致"
        assert 'id="socialAffinitySummary"' in source, f"{path}: 好感度摘要缺失"
        assert "/api/economy/summary" in source, f"{path}: 经济摘要接口缺失"
        assert "openGameCheckIn" in source and "openGameAffinity" in source, f"{path}: 签到/好友入口缺失"
        assert "gameRechargeStatus" in source and "gameFeatureOrderList" in source, f"{path}: 充值或排序设置缺失"
        assert internal in source and display in source, f"{path}: 版本文字未同步"

        for marker in (
            "skyIslandEnhancementsStyle", "skyIslandEnhancements",
            "sky-victory-afterglow", "sky-replay-insights",
            "SKY_ISLAND_FEATURE_FLAGS", "btnAnnouncements",
            "announcementCenterPanel", "announcementCenterUnreadBadge",
            "announcementCenterEnhancementsStyle", "announcementCenterEnhancements",
            "GomokuSocialUnreadState", "GomokuSocialUnreadRefresh",
            "gomoku_announcements_cache_v1", "/api/announcements",
            "safeActionUrl", "游客阅读不写入账号状态",
            "btnGameAnnouncementsPublic", "openPublicGameAnnouncements",
        ):
            assert marker in source, f"{path}: 天空/公告增强缺失 {marker}"
        assert re.search(r"doubleStarEndgame\s*:\s*false", source) and re.search(r"weatherSeason\s*:\s*false", source), f"{path}: 未启用未来功能钩子"
        assert re.search(r"prefers-reduced-motion\s*:\s*reduce", source), f"{path}: reduced-motion 降级缺失"
        assert "low-spec-mode" in source, f"{path}: low-spec 降级缺失"
        assert "候选标记" in source and "非引擎判定" in source and "结果标记" in source, f"{path}: 复盘候选文案未声明降级"
        assert 'aria-current' in source and 'gameDockUnreadBadge' in source, f"{path}: 浮岛 aria/红点缺失"

        announcement = extract_block(source, "script", "announcementCenterEnhancements")
        assert "world_message" not in announcement and "private_messages" not in announcement
        assert "notifySocial" not in announcement
        assert "textContent" in announcement and "safeActionUrl" in announcement
        assert "gomoku_announcements_cache_v1" in announcement
        assert "加载更早公告" in announcement and "已过期或撤下" in announcement
        assert "公告会保留在云端数据库" in announcement
        assert "panel.classList.add('show')" in announcement
        assert "panel.classList.remove('show')" in announcement
        assert "attributes: true" not in announcement
        announcement_tag = re.search(r'<script id="announcementCenterEnhancements"[^>]*>', source).group(0)
        assert "defer" not in announcement_tag and "async" not in announcement_tag

        sky = extract_block(source, "script", "skyIslandEnhancements")
        assert "skyObserverBound" in sky
        assert "bodyObserver.observe(document.body, { childList: true, subtree: true });" in sky
        assert "targetObserver.observe(target, { attributes: true" in sky
        assert "prefers-reduced-motion" in source and "low-spec-mode" in source
        result_gate = sky.index("result.classList.contains('show')")
        assert sky.index("playVictoryAfterglow()", result_gate) > result_gate
        assert "doubleStarEndgame: false" in sky and "weatherSeason: false" in sky

        world = extract_block(source, "script", "worldChatEnhancements")
        assert re.search(r"RETRY_DELAYS\s*=\s*\[0,\s*1000,\s*2000,\s*4000,\s*8000,\s*12000\]", world)
        assert "url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'" in world

    for tag, ident in (
        ("style", "skyIslandEnhancementsStyle"),
        ("script", "skyIslandEnhancements"),
        ("style", "worldChatEnhancementsStyle"),
        ("script", "worldChatEnhancements"),
        ("style", "announcementCenterEnhancementsStyle"),
        ("script", "announcementCenterEnhancements"),
    ):
        variants = [extract_block(source, tag, ident) for source in sources.values()]
        assert variants[1:] == variants[:-1], f"{ident}: 三端实现不一致"

    backend = (ROOT / "backend" / "worker.js").read_text(encoding="utf-8")
    pages_worker = (ROOT / "pages_build" / "_worker.js").read_text(encoding="utf-8")
    assert backend == pages_worker, "backend 与 Pages Worker 必须保持一致"
    for marker in (
        "/api/economy/summary", "/api/economy/checkin", "/api/economy/catalog",
        "/api/economy/orders", "/api/user/game-layout", "daily_checkin_claims",
        "claim_nonce", "premium_wallets", "social_affinity",
        "ANNOUNCEMENT_MAX_PAGE_SIZE", "ANNOUNCEMENT_HISTORY_WINDOW_MS",
        "ANNOUNCEMENT_ADMIN_UIDS_ENV", "requireAnnouncementAdmin",
        "safeAnnouncementActionUrl", "/api/announcements/unread",
        "/api/announcements/read", "/api/admin/announcements",
        "published_at >= ?", "withdrawn",
        "ON CONFLICT(uid) DO UPDATE SET last_read_id = MAX",
    ):
        assert marker in backend, f"backend 缺少 {marker}"
        assert marker in pages_worker, f"Pages Worker 缺少 {marker}"
    for marker in ("/api/messages", "client_message_id", "SOCIAL_AFFINITY_MAX_POINTS", "social_affinity.points + 1", "requireRegisteredUser"):
        assert marker in backend, f"好友私聊/正式账号守卫缺少 {marker}"
        assert marker in pages_worker, f"Pages Worker 缺少 {marker}"
    announcement_routes = backend[backend.index("if (url.pathname === '/api/announcements'"):backend.index("if (url.pathname === '/api/admin/announcements'")]
    assert "notifySocialWorld" not in announcement_routes
    assert "body.admin" not in backend and "body.isAdmin" not in backend

    migration = (ROOT / "migrations" / "0003_world_chat.sql").read_text(encoding="utf-8")
    for marker in ("CREATE TABLE IF NOT EXISTS announcements", "CREATE TABLE IF NOT EXISTS announcement_state", "idx_announcements_public"):
        assert marker in migration, f"迁移缺少 {marker}"
    assert "DELETE FROM announcements" not in migration

    social = (ROOT / "js" / "social.js").read_text(encoding="utf-8")
    android_social = (ROOT / "android_src" / "assets" / "js" / "social.js").read_text(encoding="utf-8")
    assert social == android_social, "Android 社交源文件必须与网页同步"
    assert "window.GomokuSocialUnreadState" in social
    assert "shared.world" in social and "shared.announcements" in social
    assert "friendTotal + worldTotal + announcementTotal" in social
    assert "shared.friends = Math.max(0, friendTotal)" in social
    assert "socialUnreadBase" in social and "GomokuSocialUnreadRefresh" in social

    # Offline private messages are inserted before affinity/notification work.
    post = backend.index("/api/messages")
    ins = backend.find("INSERT OR IGNORE INTO private_messages", post)
    affinity = backend.find("social_affinity", ins)
    notify = backend.find("notifySocialUser", affinity)
    assert post >= 0 and ins > post and affinity > ins and notify > affinity
    print("game social variants smoke: PASS")


if __name__ == "__main__":
    main()
