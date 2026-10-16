import json
import os

from playwright.sync_api import sync_playwright


def main():
    url = os.environ.get("GOMOKU_TEST_URL", "http://127.0.0.1:3000/index.html")
    api_urls = [
        "https://gh-proxy.com/https://api.github.com/repos/xnnb04664-afk/gomoku/releases/latest",
        "https://gh-proxy.org/https://api.github.com/repos/xnnb04664-afk/gomoku/releases/latest",
        "https://api.github.com/repos/xnnb04664-afk/gomoku/releases/latest",
    ]
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        page = browser.new_page()
        page.goto(url, wait_until="domcontentloaded", timeout=30_000)
        results = []
        for api_url in api_urls:
            result = page.evaluate(
                """async apiUrl => {
                  const controller = new AbortController();
                  const timer = setTimeout(() => controller.abort(), 12000);
                  try {
                    const response = await fetch(apiUrl, {
                      headers: { Accept: 'application/vnd.github+json' },
                      cache: 'no-store', signal: controller.signal
                    });
                    const body = await response.json();
                    return { status: response.status, tag: body?.tag_name || '',
                      hasApk: Array.isArray(body?.assets) && body.assets.some(asset => asset.name === 'gomoku.apk') };
                  } catch (error) {
                    return { error: String(error?.message || error) };
                  } finally { clearTimeout(timer); }
                }""",
                api_url,
            )
            results.append({"endpoint": api_url.split("/")[2], **result})

        browser.close()
    successful = [item for item in results if item.get("status") == 200 and item.get("hasApk")]
    print(json.dumps({"results": results, "usableManifestEndpoints": len(successful)}, ensure_ascii=False, indent=2))
    if len(successful) < 1:
        raise SystemExit("No GitHub update manifest endpoint passed a real browser CORS fetch")


if __name__ == "__main__":
    main()
