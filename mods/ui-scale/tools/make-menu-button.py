#!/usr/bin/env python3
"""Draw the option menu's "UI Scale" button from the menu's own "Settings" one.

The option menu (Escape) draws its buttons from pictures with the label
painted in: esc_06a.bmp (at rest), esc_06b.bmp (under the pointer) and
esc_06c.bmp (pressed), 221 x 20. This takes those three, paints over their
label with the button's own background and writes a new label the way the
originals are lettered: Arial 12 px without anti-aliasing, a solid colour
taken from the original label, and the same faint shadow.

    python3 mods/ui-scale/tools/make-menu-button.py [--label "UI Scale"]

Needs Pillow and numpy. The pictures come from the English translation the
app vendors (vendor/ROenglishRE), so run `scripts/vendor-fetch.sh` (or a build)
first; Arial from Windows (C:\\Windows\\Fonts, or /mnt/c/... under WSL) or
macOS, or pass --font.
"""

import argparse
import os
import sys
from collections import Counter

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.normpath(os.path.join(HERE, '..', '..', '..'))
SOURCE = os.path.join(APP, 'vendor', 'ROenglishRE', 'Translation', 'Renewal', 'data', 'texture',
                      '\u00c0\u00af\u00c0\u00fa\u00c0\u00ce\u00c5\u00cd\u00c6\u00e4\u00c0\u00cc\u00bd\u00ba')
TARGET = os.path.join(HERE, '..', 'data', 'texture', 'ui')
FONTS = [
    '/mnt/c/Windows/Fonts/arial.ttf',
    'C:\\Windows\\Fonts\\arial.ttf',
    '/System/Library/Fonts/Supplemental/Arial.ttf',
    '/Library/Fonts/Arial.ttf',
]

# The original label, measured on esc_06a.bmp: its left edge and cap top.
ORIGINAL = ('Settings', 90, 5)
# Columns whose background is the same top to bottom; the rounded ends are outside.
FLAT = (8, 212)
SAMPLE = 20
# Shadow fitted to the original: a 0.8 px blur of the letters, one pixel right.
SHADOW_BLUR = 0.8
SHADOW_SHIFT = 1


def letters(font, text, left, top, size):
    """The label's pixels as a 0/1 array, its left edge at `left` and cap top at `top`."""
    image = Image.new('L', (size[0] * 2, size[1] * 2), 0)
    draw = ImageDraw.Draw(image)
    draw.fontmode = '1'
    draw.text((0, 0), text, font=font, fill=255)
    ys, xs = np.nonzero(np.array(image))
    out = np.zeros((size[1], size[0]))
    ys, xs = ys - ys.min() + top, xs - xs.min() + left
    keep = (ys >= 0) & (ys < size[1]) & (xs >= 0) & (xs < size[0])
    out[ys[keep], xs[keep]] = 1
    return out


def width(font, text):
    return int(letters(font, text, 0, 0, (400, 40)).any(axis=0).nonzero()[0].max()) + 1


def make(path, font, label):
    original = np.array(Image.open(path).convert('RGB')).astype(float)
    height, full = original.shape[:2]

    # The label's colour: the most common colour under the original letters.
    under = letters(font, *ORIGINAL, (full, height)) > 0
    colour = np.array(Counter(map(tuple, original[under].astype(int))).most_common(1)[0][0], dtype=float)

    # Paint the label out: the flat part of the button, one column repeated.
    button = original.copy()
    button[:, FLAT[0]:FLAT[1] + 1] = original[:, SAMPLE:SAMPLE + 1]
    background = button.copy()

    # How much darker the shadow makes the button, fitted on the original label.
    shadow_of = lambda mask: np.array(Image.fromarray((np.roll(mask, SHADOW_SHIFT, axis=1) * 255).astype('uint8'))
                                      .filter(ImageFilter.GaussianBlur(SHADOW_BLUR))) / 255.0
    around = ~under
    around[:, :FLAT[0]] = around[:, FLAT[1]:] = False
    darker = (background - original).mean(axis=2)
    shadow = shadow_of(under.astype(float))
    strength = (darker[around] * shadow[around]).sum() / max((shadow[around] ** 2).sum(), 1e-9)

    # The new label, centred where the original's centre is.
    left = ORIGINAL[1] + (width(font, ORIGINAL[0]) - width(font, label)) // 2
    mask = letters(font, label, left, ORIGINAL[2], (full, height))
    button -= (shadow_of(mask) * strength)[:, :, None]
    button[mask > 0] = colour
    return Image.fromarray(np.clip(button, 0, 255).round().astype('uint8'), 'RGB')


def main():
    parser = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    parser.add_argument('--label', default='UI Scale')
    parser.add_argument('--name', default='esc_uiscale', help='file name before _a/_b/_c.bmp')
    parser.add_argument('--source', default=SOURCE, help='folder holding esc_06a/b/c.bmp')
    parser.add_argument('--font', default=next((f for f in FONTS if os.path.exists(f)), None))
    parser.add_argument('--out', default=TARGET)
    args = parser.parse_args()

    if not args.font:
        sys.exit('Arial not found; pass --font /path/to/arial.ttf')
    font = ImageFont.truetype(args.font, 12)
    os.makedirs(args.out, exist_ok=True)
    for state in 'abc':
        source = os.path.join(args.source, f'esc_06{state}.bmp')
        if not os.path.exists(source):
            sys.exit(f'{source} not found; fetch the vendored translation first')
        target = os.path.join(args.out, f'{args.name}_{state}.bmp')
        make(source, font, args.label).save(target, 'BMP')
        print(target)


if __name__ == '__main__':
    main()
