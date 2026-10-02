"""Verify that a failed native hot update automatically falls back to APK install."""

import hashlib
import json
import os
from pathlib import Path

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]


def main():
    url = os.environ.get("GOMOKU_TEST_URL", "http://127.0.0.1:3000/index.html")
    latest_html = (ROOT / "index.html").read_bytes()
    manifest = {
        "code": 0,
        "tag": "v1.0.128",
        "apkPath": "/api/update/apk",
        "htmlPath": "/api/update/html",
        "apkTicket": "apk-fallback-ticket",
        "htmlTicket": "html-hot-update-ticket",
        "htmlSha256": hashlib.sha256(latest_html).hexdigest(),
        "updateLog": "测试热更新失败后的 APK 安装降级",
    }
    errors = []

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        context = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=1)
        context.add_init_script(
            """
            window.__updateFallbackProbe = { hotWrites: 0, apkTickets: [] };
            window.AndroidNativeApp = {
              isNativeApp: () => true,
              saveHotUpdateFile: () => {
                window.__updateFallbackProbe.hotWrites += 1;
                return false;
              },
              downloadAndInstallApkWithTicket: (ticket) => {
                window.__updateFallbackProbe.apkTickets.push(String(ticket || ''));
              }
            };
            localStorage.setItem('gomoku_last_seen_version', 'v1.0.127');
            """
        )
        page = context.new_page()
        page.on("pageerror", lambda error: errors.append(f"pageerror:{error}"))
        page.on("console", lambda message: errors.append(f"console:{message.text}") if message.type == "error" else None)

        def fulfill_manifest(route):
            route.fulfill(
                status=200,
                content_type="application/json",
                headers={"Access-Control-Allow-Origin": "*"},
                body=json.dumps(manifest),
            )

        def fulfill_html(route):
            if route.request.method == "OPTIONS":
                route.fulfill(
                    status=204,
                    headers={
                        "Access-Control-Allow-Origin": "*",
                        "Access-Control-Allow-Headers": "*",
                        "Access-Control-Allow-Methods": "GET, OPTIONS",
                    },
                )
                return
            route.fulfill(
                status=200,
                content_type="text/html",
                headers={"Access-Control-Allow-Origin": "*"},
                body=latest_html,
            )

        page.route("https://gomoku-api.pages.dev/api/version**", fulfill_manifest)
        page.route("https://gomoku-api.pages.dev/api/update/html**", fulfill_html)
        page.goto(url, wait_until="domcontentloaded", timeout=30_000)
        page.wait_for_selector("#skyLobby", state="visible", timeout=15_000)
        page.evaluate("window.checkAppUpdate(true)")
        page.wait_for_selector("#appUpdateModal.show", state="visible", timeout=15_000)
        page.locator("#btnFastDownload").click()
        page.wait_for_function(
            "window.__updateFallbackProbe.apkTickets.length === 1",
            timeout=15_000,
        )

        probe = page.evaluate("window.__updateFallbackProbe")
        assert probe["hotWrites"] == 1, probe
        assert probe["apkTickets"] == ["apk-fallback-ticket"], probe
        page.evaluate("window.onApkDownloadProgress(0, 'error')")
        assert page.locator("#btnFastDownload").is_enabled()
        assert "重试 APK 安装更新" in page.locator("#btnFastDownload").inner_text()
        assert not errors, errors
        browser.close()

    print("update fallback smoke: PASS")


if __name__ == "__main__":
    main()
