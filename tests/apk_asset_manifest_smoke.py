"""Static smoke test for the production Android asset manifest.

The test intentionally calls the build script's manifest-only mode.  It does not
read signing credentials, invoke aapt2, or mutate android_src/assets.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
BUILD_SCRIPT = ROOT / "build_apk.js"

REQUIRED = {
    "js/app.min.js",
    "js/account.min.js",
    "js/replay.min.js",
    "js/settings.min.js",
    "js/online.min.js",
    "js/social.min.js",
    "js/ai_fast.js",
    "js/ai.js",
    "js/ai_worker.js",
    "js/voice.js",
    "js/cross.js",
    "js/assets/anime_avatars.js",
    "js/assets/cherry_bomb_audio.js",
    # Standalone themes still load the legacy adapter scripts when opened
    # directly from the APK's localhost asset server.
    "js/mqtt.min.js",
    "js/p2p-network.js",
    "js/peerjs.min.js",
    "img/anime_avatar_boy.jpg",
    "img/anime_avatar_girl.jpg",
    "img/avatar_boy.png",
    "img/avatar_girl.png",
    "theme1_zen_dark.html",
    "theme2_neo_traditional.html",
    "theme3_luxury_glass.html",
    "theme4_clean_ios.html",
    "theme5_sweet_romance.html",
}

LEGACY = {
    "js/app.js",
    "js/account.js",
    "js/online.js",
    "js/replay.js",
    "js/settings.js",
    "js/social.js",
}

THEME_ADAPTERS = {
    "js/mqtt.min.js",
    "js/peerjs.min.js",
    "js/p2p-network.js",
}


def manifest(mode: str | None = None) -> dict:
    env = os.environ.copy()
    for key in (
        "GOMOKU_APK_RESOURCE_MODE",
        "GOMOKU_APK_INCLUDE_LEGACY_COMPAT",
        "GOMOKU_APK_INCLUDE_LEGACY_MQTT",
        "GOMOKU_APK_INCLUDE_ALL_ASSETS",
    ):
        env.pop(key, None)
    if mode:
        env["GOMOKU_APK_RESOURCE_MODE"] = mode
    result = subprocess.run(
        ["node", str(BUILD_SCRIPT), "--print-resource-manifest"],
        cwd=ROOT,
        env=env,
        check=True,
        capture_output=True,
        text=True,
    )
    return json.loads(result.stdout)


def all_web_assets() -> set[str]:
    files = {"favicon.png"}
    files.update(p.relative_to(ROOT).as_posix() for p in (ROOT / "js").rglob("*") if p.is_file())
    files.update(p.relative_to(ROOT).as_posix() for p in (ROOT / "img").rglob("*") if p.is_file())
    files.update(REQUIRED - {"favicon.png"} - {x for x in REQUIRED if x.startswith("js/") or x.startswith("img/")})
    return files


def main() -> None:
    source = BUILD_SCRIPT.read_text(encoding="utf-8")
    assert "copyRecursiveSync(srcD, path.join(SRC_DIR, 'assets', dir))" in source
    assert "copyAssetManifest(resourceManifest.files, path.join(TEMP_BUILD, 'assets'))" in source
    assert "injectAiWorkerSource" in source

    minimal = manifest()
    minimal_files = set(minimal["files"])
    assert minimal["mode"] == "minimal"
    assert minimal["entry"] == "index.html"
    assert not minimal["missing"], minimal["missing"]
    assert REQUIRED <= minimal_files, sorted(REQUIRED - minimal_files)
    assert not (LEGACY & minimal_files), sorted(LEGACY & minimal_files)
    assert minimal["sourceBytes"] > 0

    # Every local entry advertised by the current lazy resource loader must be
    # either packaged or explicitly classified as legacy compatibility.  This
    # catches a new loader entry being silently omitted from the APK manifest.
    index_source = (ROOT / "index.html").read_text(encoding="utf-8")
    loader_refs = set(re.findall(r"local:\s*['\"]([^'\"]+)['\"]", index_source))
    assert loader_refs - minimal_files <= LEGACY, sorted((loader_refs - minimal_files) - LEGACY)
    assert THEME_ADAPTERS <= minimal_files

    conservative = manifest("conservative")
    conservative_files = set(conservative["files"])
    assert LEGACY <= conservative_files, sorted(LEGACY - conservative_files)
    assert REQUIRED <= conservative_files
    assert conservative["sourceBytes"] > minimal["sourceBytes"]

    full = manifest("all")
    assert set(full["files"]) == all_web_assets()
    assert not full["missing"], full["missing"]

    print(
        "apk asset manifest smoke: PASS "
        f"(minimal={len(minimal_files)} files/{minimal['sourceBytes']} bytes, "
        f"conservative={len(conservative_files)} files/{conservative['sourceBytes']} bytes)"
    )


if __name__ == "__main__":
    main()
