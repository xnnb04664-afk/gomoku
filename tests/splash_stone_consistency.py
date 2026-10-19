"""Check shared heart colors and the actual web animation's early pixels.

Android is checked for layout parity; browser pixels do not replace a device
check of the native Canvas renderer.
"""
import json
import re
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]


def main():
    web = (ROOT / 'js/startup-splash.js').read_text(encoding='utf-8')
    native = (ROOT / 'android_src/src/com/gomoku/master/GomokuSplashView.java').read_text(encoding='utf-8')
    app = (ROOT / 'js/app.js').read_text(encoding='utf-8')
    web_layout = web.split('const stones = Object.freeze([', 1)[1].split('].map(', 1)[0]
    native_layout = native.split('private static final int[][] STONES = {', 1)[1].split('};', 1)[0]
    web_stones = [tuple(map(int, values)) for values in re.findall(r'\[(\d+),\s*(\d+),\s*([01])\]', web_layout)]
    native_stones = [tuple(map(int, values)) for values in re.findall(r'\{(\d+),\s*(\d+),\s*([01])\}', native_layout)]
    assert len(web_stones) == 26 and web_stones == native_stones
    assert len({(row, col) for row, col, _ in web_stones}) == 26
    assert sum(color == 0 for _, _, color in web_stones) == 13
    assert sum(color == 1 for _, _, color in web_stones) == 13
    home = app.split('function renderHomeBoardPreview(canvas) {', 1)[1].split('window.GomokuBoardPreview', 1)[0]
    assert 'window.GOMOKU_HEART_STONES' in home and 'heartStones.forEach' in home
    assert 'color === 0 ? BLACK : WHITE' in home
    assert 'STONES[index][2] == 0' in native

    helpers = web[web.index('  function clamp('):web.index('  function dismiss(')]
    drawing = web[web.index('  function drawStone('):web.index('  function drawBoard(')]
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        page = browser.new_page()
        pixels = page.evaluate("""source => {
          const canvas = document.createElement('canvas');
          canvas.width = canvas.height = 140;
          const context = canvas.getContext('2d');
          const sprites = [null, null];
          const functions = new Function('context', 'stoneSprites',
            source + '; return {drawStone, createStoneSprite, easeOut};')(context, sprites);
          sprites[0] = functions.createStoneSprite(0);
          sprites[1] = functions.createStoneSprite(1);
          const result = [];
          const originalDrawImage = context.drawImage.bind(context);
          let imageAlpha = null;
          context.drawImage = (...args) => {
            imageAlpha = context.globalAlpha;
            originalDrawImage(...args);
          };
          for (const color of [0, 1]) for (const progress of [.01, .1, .5, 1]) {
            context.fillStyle = '#8cd63e';
            context.fillRect(0, 0, 140, 140);
            functions.drawStone(60, 50, 22, color, progress);
            const centerY = 50 + (1-functions.easeOut(progress))*22*1.15;
            result.push({color, progress, imageAlpha,
              pixel: Array.from(context.getImageData(60, Math.round(centerY), 1, 1).data)});
          }
          return result;
        }""", helpers + drawing)
        browser.close()
    for frame in pixels:
        assert frame['imageAlpha'] == 1, frame
        rgb = frame['pixel'][:3]
        if frame['color'] == 1:
            assert min(rgb) > 190, ('white must already be white on its first frame', frame)
        else:
            assert max(rgb) < 160, ('black must remain black', frame)
    print(json.dumps({'pass': True, 'black': 13, 'white': 13,
                      'nativeWebLayoutEqual': True, 'pixelFrames': pixels,
                      'nativeDeviceTested': False}))


if __name__ == '__main__':
    main()
