# README 用のスクリーンショットを撮り直す（docs/screenshots/ に保存）
#   pip install playwright && python -m playwright install chromium
#   npm pack @fontsource/biz-udpgothic @fontsource/ibm-plex-mono  → 展開したフォルダを FONT_DIR に置く
#   python -m http.server 8765   （リポジトリのルートで起動しておく）
#   python tools/screenshots.py [FONT_DIR]
# 画面と同じ字体（BIZ UDPGothic・IBM Plex Mono）で撮るため、Google Fonts への要求を手元のフォントで返す
import sys, re
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'docs' / 'screenshots'
FONT_DIR = Path(sys.argv[1] if len(sys.argv) > 1 else 'fonts')
URL = 'http://localhost:8765/index.html'

def font_css():
    css = ''
    for pkg, files in [('biz-udpgothic', ['400.css', '700.css']), ('ibm-plex-mono', ['500.css'])]:
        base = next(FONT_DIR.glob(f'fontsource-{pkg}-*/package'))
        for f in files:
            css += re.sub(r'url\(\./files/([^)]+)\)', lambda m: f'url(https://fonts.local/{pkg}/{m.group(1)})', (base / f).read_text(encoding='utf-8'))
    return css

def route_fonts(page):
    css = font_css()
    page.route('https://fonts.googleapis.com/**', lambda r: r.fulfill(status=200, content_type='text/css', body=css))
    def serve(r):
        pkg, name = r.request.url.split('https://fonts.local/')[1].split('/', 1)
        path = next(FONT_DIR.glob(f'fontsource-{pkg}-*/package/files')) / name
        r.fulfill(status=200, content_type='font/woff2' if name.endswith('woff2') else 'font/woff', body=path.read_bytes())
    page.route('https://fonts.local/**', serve)

def shoot(page, selector, path, height):
    # 結果の表が切れないよう、撮影時だけ本文の最大幅を広げる
    page.add_style_tag(content='header.top{position:static!important}.wrap,.top-in{max-width:1280px!important}')
    page.mouse.move(0, 0)
    page.evaluate('document.fonts.ready')
    y = page.locator(selector).bounding_box()['y'] + page.evaluate('scrollY')
    page.screenshot(path=str(path), full_page=True, clip={'x': 0, 'y': y - 10, 'width': 1280, 'height': height})

with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={'width': 1280, 'height': 900})
    route_fonts(pg)
    pg.goto(URL); pg.wait_for_load_state('networkidle')
    pg.evaluate('localStorage.clear()'); pg.reload(); pg.wait_for_load_state('networkidle')
    pg.evaluate('document.fonts.ready')
    OUT.mkdir(parents=True, exist_ok=True)
    for tab, name, h in [('grr', 'grr', 1500), ('bias', 'bias', 900), ('lin', 'linearity', 1000), ('stab', 'stability', 800), ('t1', 'type1', 800), ('attr', 'attribute', 1150)]:
        pg.click(f'nav.tabs button[data-tab="{tab}"]')
        pg.click(f'[data-sample="{tab}"]')
        pg.wait_for_timeout(700)
        # 字体が読み込まれる前に描いたグラフを描き直す
        pg.click('#themeBtn'); pg.click('#themeBtn'); pg.click('#themeBtn')
        pg.evaluate("document.querySelector('#toast').hidden = true")
        shoot(pg, f'#{tab}Out', OUT / f'{name}.png', h)
    # 入力表
    pg.click('nav.tabs button[data-tab="grr"]'); pg.wait_for_timeout(300)
    pg.evaluate("document.querySelector('#toast').hidden = true")
    shoot(pg, 'section[data-panel="grr"] .setup-box', OUT / 'input.png', 640)
    b.close()
print('docs/screenshots/ に保存しました')
