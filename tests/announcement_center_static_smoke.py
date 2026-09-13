import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
VARIANTS = (
    ROOT / "index.html",
    ROOT / "android_src" / "assets" / "index.html",
    ROOT / "五子棋大师_单文件版.html",
)
BUTTON_IDS = (
    "btnGameFriends", "btnGameRecent", "btnGameRank", "btnGameBag",
    "btnGameTasks", "btnGameAchievements", "btnGameActivity", "btnGameSettings",
)


def block(source, tag, ident):
    pattern = rf'<{tag} id="{re.escape(ident)}">.*?</{tag}>'
    match = re.search(pattern, source, re.S)
    assert match, f"{ident} block missing"
    return match.group(0)


def button_ids(source):
    return tuple(re.findall(
        r'<button[^>]*id="(btnGame(?:Friends|Recent|Rank|Bag|Tasks|Achievements|Activity|Settings))"',
        source,
    ))


def main():
    sources = {path: path.read_text(encoding="utf-8") for path in VARIANTS}

    for path, source in sources.items():
        assert button_ids(source) == BUTTON_IDS, f"{path}: eight-button order changed"
        for marker in (
            "btnAnnouncements", "announcementCenterPanel",
            "announcementCenterUnreadBadge", "announcementCenterEnhancementsStyle",
            "announcementCenterEnhancements", "GomokuSocialUnreadState",
            "GomokuSocialUnreadRefresh", "gomoku_announcements_cache_v1",
            "/api/announcements", "safeActionUrl", "textContent",
            "游客阅读不写入账号状态", "公告会保留在云端数据库",
        ):
            assert marker in source, f"{path}: missing announcement marker {marker}"
        announcement_tag = re.search(
            r'<script id="announcementCenterEnhancements"[^>]*>', source
        ).group(0)
        assert "defer" not in announcement_tag and "async" not in announcement_tag
        announcement = block(source, "script", "announcementCenterEnhancements")
        assert "world_message" not in announcement
        assert "private_messages" not in announcement
        assert "notifySocial" not in announcement
        assert "innerHTML" in announcement  # static shell only; dynamic fields use textContent
        assert "textContent" in announcement
        assert "safeActionUrl" in announcement
        assert "before" in announcement and "加载更早公告" in announcement
        assert "hidden" in announcement and "已过期或撤下" in announcement
        assert "window.GomokuSocialUnreadRefresh" in announcement
        assert "MutationObserver" in announcement
        assert "observer.observe(document.body, { childList: true, subtree: true });" in announcement
        assert "attributes: true" not in announcement
        assert "javascript:" not in announcement.lower()
        assert "data:" not in announcement.lower()
        assert "公告中心，" in announcement and "条未读" in announcement

        sky = block(source, "script", "skyIslandEnhancements")
        assert "skyObserverBound" in sky
        assert "bodyObserver.observe(document.body, { childList: true, subtree: true });" in sky
        assert "targetObserver.observe(target, { attributes: true" in sky
        assert "prefers-reduced-motion: reduce" in source
        assert "low-spec-mode" in source
        assert "非引擎判定" in sky
        result_gate = sky.index("result.classList.contains('show')")
        afterglow = sky.index("playVictoryAfterglow()", result_gate)
        assert afterglow > result_gate, f"{path}: victory glow runs before visible result gate"
        assert "doubleStarEndgame: false" in sky
        assert "weatherSeason: false" in sky

    for tag, ident in (
        ("style", "skyIslandEnhancementsStyle"),
        ("script", "skyIslandEnhancements"),
        ("style", "worldChatEnhancementsStyle"),
        ("script", "worldChatEnhancements"),
        ("style", "announcementCenterEnhancementsStyle"),
        ("script", "announcementCenterEnhancements"),
    ):
        variants = [block(source, tag, ident) for source in sources.values()]
        assert variants[1:] == variants[:-1], f"{ident}: three variants diverged"

    backend = (ROOT / "backend" / "worker.js").read_text(encoding="utf-8")
    pages = (ROOT / "pages_build" / "_worker.js").read_text(encoding="utf-8")
    assert backend == pages, "backend and Pages Worker must stay byte-identical"
    for marker in (
        "ANNOUNCEMENT_MAX_PAGE_SIZE", "ANNOUNCEMENT_HISTORY_WINDOW_MS",
        "ANNOUNCEMENT_ADMIN_UIDS_ENV", "cleanAnnouncementText",
        "safeAnnouncementActionUrl", "announcementAdminUidAllowed",
        "requireAnnouncementAdmin", "/api/announcements",
        "/api/announcements/unread", "/api/announcements/read",
        "/api/admin/announcements", "published_at >= ?",
        "expires_at = 0 OR expires_at > ?", "withdrawn",
        "INSERT INTO announcements", "UPDATE announcements",
        "ON CONFLICT(uid) DO UPDATE SET last_read_id = MAX",
        "lastReadId", "nextBefore",
    ):
        assert marker in backend, f"worker missing {marker}"
    assert "body.admin" not in backend and "body.isAdmin" not in backend
    assert "notifySocialWorld" not in backend[backend.index("if (url.pathname === '/api/announcements'"):backend.index("if (url.pathname === '/api/admin/announcements'")]
    migration = (ROOT / "migrations" / "0003_world_chat.sql").read_text(encoding="utf-8")
    for marker in (
        "CREATE TABLE IF NOT EXISTS announcements",
        "CREATE TABLE IF NOT EXISTS announcement_state",
        "idx_announcements_public", "expires_at", "status",
    ):
        assert marker in migration, f"migration missing {marker}"
    assert "DELETE FROM announcements" not in migration
    print("announcement center static smoke: PASS")


if __name__ == "__main__":
    main()
