"""Regression guard for the v1.0.127 visual-only UI port."""

from __future__ import annotations

import os
from pathlib import Path

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]


def assert_single_row(page, width: int, expected_controls: int) -> None:
    page.set_viewport_size({"width": width, "height": 844})
    geometry = page.evaluate(
        """() => {
          const controls = [...document.querySelectorAll('.bottom-controls .btn-ctrl')]
            .filter((node) => {
              const style = getComputedStyle(node);
              const rect = node.getBoundingClientRect();
              return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0;
            })
            .map((node) => ({ id: node.id, ...node.getBoundingClientRect().toJSON() }));
          const bar = document.querySelector('.bottom-controls');
          const barStyle = getComputedStyle(bar);
          return {
            controls,
            display: barStyle.display,
            flexWrap: barStyle.flexWrap,
            overflow: document.documentElement.scrollWidth - window.innerWidth,
          };
        }"""
    )
    assert geometry["display"] == "flex", geometry
    assert geometry["flexWrap"] == "nowrap", geometry
    assert len(geometry["controls"]) == expected_controls, geometry
    assert max(item["top"] for item in geometry["controls"]) - min(item["top"] for item in geometry["controls"]) <= 1, geometry
    assert geometry["overflow"] <= 1, geometry


def main() -> None:
    source = (ROOT / "index.html").read_text(encoding="utf-8")
    assert 'id="ui-visual-upgrade-port"' in source
    for protected_fragment in (
        'href="js/sky-island.css"',
        'href="js/startup-splash.css"',
        'src="js/startup-splash.js"',
        "openSkyExpedition",
        "openPublicGameAnnouncements",
        "ensure('social')",
    ):
        assert protected_fragment in source, protected_fragment

    url = os.environ.get("GOMOKU_TEST_URL", "http://127.0.0.1:3000/index.html")
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 390, "height": 844})
        page.goto(url, wait_until="domcontentloaded", timeout=30_000)
        page.wait_for_selector("#skyLobby", state="visible", timeout=15_000)
        page.locator("[data-sky-action='quick']").click()
        page.wait_for_selector("#skySheetBackdrop.show", state="visible")
        page.locator("[data-sheet-action='pvp']").click()
        page.wait_for_selector("#skyLobby", state="hidden", timeout=15_000)
        page.wait_for_selector(".bottom-controls", state="visible")
        # v1.0.127's standard-game state deliberately keeps the experimental
        # cross-chess entry hidden. Its four normal controls still stay on one row.
        assert_single_row(page, 390, 4)
        assert_single_row(page, 380, 4)

        # When the existing cross-chess entry is enabled, the port's five-control
        # layout must remain on a single row instead of the old grid's second row.
        page.evaluate("document.getElementById('btnCrossChess').style.setProperty('display', 'inline-flex', 'important')")
        assert_single_row(page, 390, 5)
        assert_single_row(page, 380, 5)
        browser.close()

    print("ui visual port smoke: PASS")


if __name__ == "__main__":
    main()
