"""AGRARIAN logo, direction M5 ("cinematic line"): builds every logo file from code.

Run from the repo root:  python3 scripts/brand/build_m5.py [out_dir]   (needs: pip install shapely)
By default it rebuilds the live files: the SVGs in public/brand, public/favicon.svg and src/app/logoArt.ts.
With an out_dir, everything goes there instead (to compare before replacing). Uses glyphs.py (same folder) for the letters.

The idea: one A for the whole game (farm -> industry -> city -> war -> space). It is drawn as a
thin line; its outline changes per era (barn roof, chimney, spire, battlements, rocket fins), a
horizon line runs through the gap under the crossbar, and farm and space get one gold detail.

Two line weights, because a thin line breaks up when small:
  - "line": the real mark, for 48px and up (title screen, share image, brand files)
  - "bold": a heavier cut of the same drawing, for 32px and below (favicon, top bar)
"""
import json
import math
import os
import sys
from shapely.geometry import Polygon, box
from shapely.ops import unary_union
from shapely import affinity
from glyphs import word, to_path, H

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
CUSTOM = len(sys.argv) > 1
OUT = os.path.abspath(sys.argv[1]) if CUSTOM else os.path.join(ROOT, 'public', 'brand')

ERAS = ('farm', 'industry', 'city', 'war', 'space')
INK = {'light': '#3a2e25', 'dark': '#f4ebdc'}
GOLD = '#f4b63f'

# ---------------------------------------------------------------- the A, per era (64 grid, y down)
A_FLAT = Polygon([(28, 4), (36, 4), (60, 60), (4, 60)])
STAR = Polygon([(32, 16), (33.8, 21.2), (39, 23), (33.8, 24.8), (32, 30), (30.2, 24.8), (25, 23), (30.2, 21.2)])
OUTLINE = {
    'farm': Polygon([(32, 3), (45, 20), (60, 60), (4, 60), (19, 20)]),                       # barn roof
    'industry': unary_union([A_FLAT, box(42, 6, 48, 30)]),                                     # chimney
    'city': unary_union([Polygon([(30, 10), (34, 10), (60, 60), (4, 60)]), Polygon([(32, 0), (34.5, 10), (29.5, 10)])]),  # spire
    'war': Polygon([(24, 4), (27, 4), (27, 8), (30.5, 8), (30.5, 4), (33.5, 4), (33.5, 8), (37, 8), (37, 4), (40, 4), (60, 60), (4, 60)]),  # battlements
    'space': unary_union([Polygon([(32, 0), (39, 12), (54, 48), (54, 60), (10, 60), (10, 48), (25, 12)]),               # rocket
                          Polygon([(50, 40), (63, 54), (63, 62), (52, 62)]), Polygon([(14, 40), (1, 54), (1, 62), (12, 62)])]),
}
BAR = box(-10, 36, 80, 40)
COUNTER = {
    'farm': box(24, 48, 40, 70),                                                               # barn door
    'industry': Polygon([(20, 70), (20, 50), (28, 44), (28, 50), (36, 44), (36, 50), (44, 44), (44, 70)]),  # factory roof
    'city': unary_union([box(22, 44, 30, 50), box(34, 44, 42, 50), box(22, 54, 30, 70), box(34, 54, 42, 70)]),  # windows
    'war': Polygon([(24, 70), (24, 52), (32, 44), (40, 52), (40, 70)]),                        # gate
    'space': Polygon([(32 + 7.5 * math.cos(math.pi / 8 + k * math.pi / 4), 52 + 7.5 * math.sin(math.pi / 8 + k * math.pi / 4)) for k in range(8)]),  # porthole
}
ACCENT = {'farm': box(28, 22, 36, 30), 'space': STAR}
WEIGHT = {'line': dict(t=1.5, horizon=1.4, accent=.7), 'bold': dict(t=4.4, horizon=3.4, accent=1.0)}


def body(era):
    return OUTLINE[era].difference(unary_union([BAR, COUNTER[era]]).intersection(box(-10, -10, 80, 60.5)))


def mark_geom(era, weight):
    w = WEIGHT[weight]
    b = body(era)
    line = b.difference(b.buffer(-w['t'], join_style='mitre'))
    hy = 38 - w['horizon'] / 2
    horizon = box(0, hy, 64, hy + w['horizon']).difference(b.buffer(2.5))
    acc = ACCENT.get(era)
    if acc is not None:
        acc = affinity.scale(acc, w['accent'], w['accent'], origin=acc.centroid.coords[0])
    return unary_union([line, horizon]), acc


def d_of(geom):
    if geom is None:
        return ''
    return to_path(affinity.scale(geom, 1, -1, origin=(0, 0)), 0, -H, 1, 2)


MARKS = {e: {wt: dict(zip(('ink', 'accent'), map(d_of, mark_geom(e, wt)))) for wt in WEIGHT} for e in ERAS}

# ---------------------------------------------------------------- wordmark: very wide, light, cut corners
WORD_GEOM, WORD_W = word('AGRARIAN', w=7, c=4, track=34, wide=1.2)
WORD = to_path(WORD_GEOM, 0, 0, 1, 2)
H_CAP, H_GAP = 28.0, 16.0          # horizontal: letters 28 tall next to the 64-tall mark
S_CAP, S_GAP = 22.0, 16.0          # stacked: letters 22 tall, 16 below the mark
HW = 64 + H_GAP + WORD_W * H_CAP / 100
SW = max(64, WORD_W * S_CAP / 100)
SH = 64 + S_GAP + S_CAP


def mark_body(era, weight, ink, gold=GOLD):
    m = MARKS[era][weight]
    acc = f'<path d="{m["accent"]}" fill="{gold}"/>' if m['accent'] else ''
    return f'<path d="{m["ink"]}" fill="{ink}"/>' + acc


def word_path(x, y, cap, ink):
    return f'<path transform="translate({x:g} {y:g}) scale({cap / 100:g})" d="{WORD}" fill="{ink}"/>'


def svg(vb, inner, label='Agrarian'):
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vb}" role="img" aria-label="{label}"><title>{label}</title>{inner}</svg>\n'


def variant_colors(v):
    # mono: everything one colour (currentColor), gold detail included, for watermarks and one-colour print
    return ('currentColor', 'currentColor') if v == 'mono' else (INK[v], GOLD)


def horizontal(v, era='farm'):
    ink, gold = variant_colors(v)
    return svg(f'0 0 {HW:.2f} 64', mark_body(era, 'line', ink, gold) + word_path(64 + H_GAP, 32 - H_CAP / 2, H_CAP, ink))


def stacked(v, era='farm'):
    ink, gold = variant_colors(v)
    return svg(f'0 0 {SW:.2f} {SH:g}', f'<g transform="translate({(SW - 64) / 2:.2f} 0)">{mark_body(era, "line", ink, gold)}</g>' + word_path((SW - WORD_W * S_CAP / 100) / 2, 64 + S_GAP, S_CAP, ink))


def watermark():
    """For shared screenshots: cream lockup on a soft dark plate, so the thin line survives busy scenes."""
    pad = 14
    w, h = HW + pad * 2, 64 + pad * 2
    inner = (f'<rect width="{w:.2f}" height="{h}" rx="18" fill="#1f1a15" fill-opacity=".55"/>'
             f'<g transform="translate({pad} {pad})">{mark_body("farm", "line", "#f4ebdc")}{word_path(64 + H_GAP, 32 - H_CAP / 2, H_CAP, "#f4ebdc")}</g>')
    return svg(f'0 0 {w:.2f} {h}', inner)


def write(rel, text, mode='w'):
    # brand SVGs sit straight in public/brand; favicon and logoArt.ts go where the app reads them (or all into a custom out_dir)
    if rel.startswith('svg/'): rel = rel[4:]
    elif not CUSTOM: rel = os.path.join('..', 'favicon.svg') if rel == 'favicon.svg' else os.path.join('..', '..', 'src', 'app', rel)
    p = os.path.normpath(os.path.join(OUT, rel))
    os.makedirs(os.path.dirname(p), exist_ok=True)
    open(p, mode).write(text)
    return p


if __name__ == '__main__':
    for v in ('light', 'dark', 'mono'):
        write(f'svg/agrarian-horizontal-{v}.svg', horizontal(v))
        write(f'svg/agrarian-stacked-{v}.svg', stacked(v))
        for e in ERAS:
            ink, gold = variant_colors(v)
            for wt in WEIGHT:
                write(f'svg/eras/agrarian-mark-{e}-{wt}-{v}.svg', svg('0 0 64 64', mark_body(e, wt, ink, gold), f'Agrarian — {e}'))
    write('svg/agrarian-watermark.svg', watermark())
    # favicon: the bold cut (a 16px tab needs the heavier line); bark ink on a cream tile so it reads in light and dark tab bars
    write('favicon.svg', svg('0 0 64 64', f'<rect width="64" height="64" rx="14" fill="#fcf6e8"/><g transform="translate(5 5) scale(.84375)">{mark_body("farm", "bold", INK["light"])}</g>'))
    js = lambda o: json.dumps(o, indent=2, ensure_ascii=False).replace('"', "'")
    write('logoArt.ts', (
        "// Generated by scripts/brand/build_m5.py — edit that script, not this file.\n"
        "// AGRARIAN logo, direction M5: one A drawn as a thin line, its outline changing per era, plus the wordmark.\n\n"
        "export const ERAS = ['farm', 'industry', 'city', 'war', 'space'] as const;\n"
        "export type Era = (typeof ERAS)[number];\n"
        "/** line = the real mark (48px and up); bold = heavier cut of the same drawing (32px and below). */\n"
        "export type Weight = 'line' | 'bold';\n\n"
        "/** Per era and weight, on a 64×64 grid: `ink` (the A and its horizon line) and an optional gold `accent`. */\n"
        f"export const MARKS: Record<Era, Record<Weight, {{ ink: string; accent: string }}>> = {js(MARKS)};\n\n"
        "/** \"AGRARIAN\" at cap height 100, starting at x = 0. */\n"
        f"export const WORD = '{WORD}';\n"
        f"export const WORD_WIDTH = {WORD_W:.2f};\n\n"
        f"export const INK = {js(INK)} as const;\n"
        f"export const GOLD = '{GOLD}';\n\n"
        "/** Lockup spacing, in mark units (the mark is 64 tall). */\n"
        f"export const LOCKUP = {{ hCap: {H_CAP:g}, hGap: {H_GAP:g}, sCap: {S_CAP:g}, sGap: {S_GAP:g} }} as const;\n"))
    print('wrote kit to', OUT)
