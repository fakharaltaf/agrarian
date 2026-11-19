"""Custom AGRARIAN letterforms, built from centre-lines and flattened to SVG paths.

Letters are drawn on a cap-height grid of H=100 (y up), buffered with mitred joins so every
corner is a straight cut, like the flat-shaded faces of the game's low-poly models, then clipped
to the cap box. Only five glyphs are needed: A G R I N.
"""
from shapely.geometry import LineString, Polygon, box, MultiPolygon
from shapely.ops import unary_union
from shapely.geometry.polygon import orient

H = 100.0


def stroke(pts, w):
    return LineString(pts).buffer(w / 2, cap_style='flat', join_style='mitre', mitre_limit=8)


def glyph(ch, w, c, slab=0.0, wide=1.0):
    """Return (shape, advance). w=stroke weight, c=chamfer, slab=slab length (0 = sans)."""
    h = w / 2
    parts = []
    if ch == 'A':
        W = 82 * wide
        ext = 60
        # legs meet above the cap line; clipping leaves a small flat apex (a cut corner)
        apex = (W / 2, H + 16 + w * 0.2)
        for x0 in (h * 0.9, W - h * 0.9):
            dx, dy = apex[0] - x0, apex[1]
            parts.append(stroke([(x0 - dx * ext / dy, -ext), apex], w))
        parts.append(box(W * 0.2, H * 0.2, W * 0.8, H * 0.2 + w * 0.72))
        if slab:
            t = w * 0.42
            parts += [box(-slab * 0.3, 0, w * 1.15 + slab * 0.5, t), box(W - w * 1.15 - slab * 0.5, 0, W + slab * 0.3, t)]
    elif ch == 'G':
        W = 86 * wide
        x0, x1, y0, y1 = h, W - h, h, H - h
        parts.append(stroke([(x1 - c * 0.2, y1), (x0 + c, y1), (x0, y1 - c), (x0, y0 + c), (x0 + c, y0),
                             (x1 - c * 0.6, y0), (x1, y0 + c * 0.6), (x1, H * 0.47), (W * 0.5, H * 0.47)], w))
        # the top terminal is cut on a diagonal, like a chamfer
        parts.append(Polygon([(W * 0.62, H - w), (W, H - w), (W, H), (W * 0.62, H)]).intersection(box(0, 0, W, H)))
    elif ch == 'R':
        W = 78 * wide
        ym = H * 0.40
        parts.append(stroke([(h, -10), (h, H + 10)], w))
        parts.append(stroke([(h, H - h), (W - h - c, H - h), (W - h, H - h - c), (W - h, ym + h + c), (W - h - c, ym + h),
                             (h, ym + h)], w))
        parts.append(stroke([(W * 0.42, ym + h), (W - h * 0.9, -10)], w * 1.04))
        if slab:
            t = w * 0.42
            parts += [box(-slab * 0.3, 0, w + slab * 0.6, t), box(-slab * 0.3, H - t, w, H), box(W - w * 1.1 - slab * 0.4, 0, W + slab * 0.3, t)]
    elif ch == 'I':
        W = w
        parts.append(box(0, 0, w, H))
        if slab:
            t = w * 0.42
            W = w + slab * 1.2
            parts = [box(slab * 0.6, 0, slab * 0.6 + w, H), box(0, 0, W, t), box(0, H - t, W, H)]
    elif ch == 'N':
        W = 82 * wide
        parts.append(box(0, 0, w, H))
        parts.append(box(W - w, 0, W, H))
        parts.append(stroke([(h * 0.8, H + 6), (W - h * 0.8, -6)], w * 1.08))
        if slab:
            t = w * 0.42
            parts += [box(-slab * 0.3, 0, w + slab * 0.5, t), box(-slab * 0.3, H - t, w, H), box(W - w - slab * 0.5, H - t, W + slab * 0.3, H)]
    else:
        raise ValueError(ch)
    pad = slab * 0.3 if ch in 'ARN' or (ch == 'I' and False) else 0
    shape = unary_union(parts).intersection(box(-pad - 0.01, 0, W + pad + 0.01, H))
    return shape, W


def to_path(geom, dx=0.0, dy=0.0, s=1.0, nd=1):
    """Shapely (y up) -> SVG path d (y down), with nonzero-safe winding."""
    polys = list(geom.geoms) if isinstance(geom, MultiPolygon) else [geom]
    out = []
    f = lambda x, y: f"{round(dx + x * s, nd):g} {round(dy + (H - y) * s, nd):g}"
    for p in polys:
        if p.is_empty:
            continue
        p = orient(p.simplify(0.05), 1.0)
        for ring in [p.exterior, *p.interiors]:
            pts = list(ring.coords)[:-1]
            out.append('M' + 'L'.join(f(*q) for q in pts) + 'Z')
    return ''.join(out)


KERN = {'AG': -0.1, 'RA': 0.0, 'IA': 0.0, 'AR': 0.0, 'AN': 0.0, 'GR': 0.1}


def word(text, w, c, track, slab=0.0, wide=1.0):
    """Lay out a word. Returns (path_d, width) at cap height 100."""
    x, shapes = 0.0, []
    from shapely import affinity
    for i, ch in enumerate(text):
        g, adv = glyph(ch, w, c, slab, wide)
        # A next to R/G gets optical kerning: its diagonal leaves air
        x += KERN.get(text[i - 1:i + 1], 0) * w if i else 0
        shapes.append(affinity.translate(g, xoff=x))
        x += adv + track
    geom = unary_union(shapes)
    minx, _, maxx, _ = geom.bounds
    from shapely import affinity as af
    geom = af.translate(geom, xoff=-minx)
    return geom, maxx - minx
