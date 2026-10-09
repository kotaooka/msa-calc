# アプリアイコンを作る（ダイヤルゲージの図案）。python tools/make_icons.py（Pillow が必要）
import math
from pathlib import Path
from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / 'icons'
BG, WHITE, ORANGE, GREEN = (29, 92, 150), (255, 255, 255), (255, 168, 120), (87, 196, 131)

def draw(size, maskable=False):
    s = 4 * size  # 4 倍で描いて縮小（縁を滑らかにする）
    im = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    if maskable:
        d.rectangle([0, 0, s, s], fill=BG)
        scale = 0.72  # 円形に切り抜かれても収まる大きさ
    else:
        d.rounded_rectangle([0, 0, s - 1, s - 1], radius=s * 0.2, fill=BG)
        scale = 1.0
    c = s / 2
    R = s * 0.33 * scale
    w = max(2, round(s * 0.035 * scale))
    d.ellipse([c - R, c - R, c + R, c + R], outline=WHITE, width=w)
    # 目盛り（上側 270° に 11 本）
    for i in range(11):
        a = math.radians(135 + i * 27)
        r1, r2 = R * (0.70 if i % 5 == 0 else 0.80), R * 0.90
        d.line([c + r1 * math.cos(a), c + r1 * math.sin(a), c + r2 * math.cos(a), c + r2 * math.sin(a)], fill=WHITE, width=max(2, round(w * (0.8 if i % 5 == 0 else 0.5))))
    # 合格範囲の弧（中央付近）
    d.arc([c - R * 0.6, c - R * 0.6, c + R * 0.6, c + R * 0.6], start=250, end=290, fill=GREEN, width=round(w * 1.2))
    # 針
    a = math.radians(-80)
    d.line([c, c, c + R * 0.78 * math.cos(a), c + R * 0.78 * math.sin(a)], fill=ORANGE, width=round(w * 1.1))
    r0 = R * 0.12
    d.ellipse([c - r0, c - r0, c + r0, c + r0], fill=ORANGE)
    return im.resize((size, size), Image.LANCZOS)

OUT.mkdir(exist_ok=True)
draw(512).save(OUT / 'icon-512.png')
draw(192).save(OUT / 'icon-192.png')
draw(512, maskable=True).save(OUT / 'icon-maskable-512.png')
im = draw(180, maskable=True).convert('RGB')
im.save(OUT / 'apple-touch-icon.png')
print('icons/ に書き出しました')
