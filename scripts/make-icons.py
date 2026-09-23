#!/usr/bin/env python3
"""生成 App 图标（主屏幕 / PWA 用）。改了配色后重新跑：python3 scripts/make-icons.py"""
import os
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'icons')
os.makedirs(OUT, exist_ok=True)

BG_TOP = (47, 107, 255)
BG_BOTTOM = (111, 155, 255)
SIZES = [(180, 'apple-touch-icon.png'), (192, 'icon-192.png'), (512, 'icon-512.png')]


def font_for(size):
    for path in ('/System/Library/Fonts/Helvetica.ttc',
                 '/System/Library/Fonts/SFNS.ttf',
                 '/System/Library/Fonts/Supplemental/Arial Bold.ttf'):
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, int(size * 0.62))
            except OSError:
                continue
    return ImageFont.load_default()


def make_icon(size):
    icon = Image.new('RGB', (size, size), BG_TOP)
    draw = ImageDraw.Draw(icon)
    for y in range(size):
        ratio = y / max(1, size - 1)
        color = tuple(int(BG_TOP[i] + (BG_BOTTOM[i] - BG_TOP[i]) * ratio) for i in range(3))
        draw.line([(0, y), (size, y)], fill=color)

    font = font_for(size)
    text = '¥'
    box = draw.textbbox((0, 0), text, font=font)
    width = box[2] - box[0]
    height = box[3] - box[1]
    draw.text(((size - width) / 2 - box[0], (size - height) / 2 - box[1] - size * 0.06),
              text, font=font, fill=(255, 255, 255))

    # 右侧三条横线，暗示「记账」
    line_color = (255, 255, 255, 210)
    line_width = max(2, int(size * 0.028))
    for index, offset in enumerate((0.30, 0.36, 0.42)):
        top = int(size * (0.72 + index * 0.05))
        left = int(size * offset)
        right = int(size * (0.86 - index * 0.06))
        draw.line([(left, top), (right, top)], fill=line_color, width=line_width)
    return icon


for size, name in SIZES:
    make_icon(size).save(os.path.join(OUT, name))
    print('生成', os.path.join('icons', name))
