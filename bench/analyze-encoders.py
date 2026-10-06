"""Summarise bench/run-encoders.mjs rows: bytes each encoder needs to look as good as canvas.

Usage: python3 bench/analyze-encoders.py rows.jsonl [canvas qualities, e.g. 0.85,0.82,0.8,0.76,0.72,0.66]

For every image, size and canvas quality q, the target is the SSIMULACRA2 score
canvas reaches at q. For each other encoder family it reports:
- matched: bytes when the family's own setting is tuned per image to reach that
  score (log-bytes interpolated between bench points): what a per-image
  "looks the same?" search would get.
- fixed: the single setting that reaches the target on at least 90% of images,
  and the bytes it costs: what a fixed mapping gets without any search.
- to median: every image tuned to the canvas median score (an absolute "looks
  right" target), canvas included, so the search and the encoder can be told apart.
- on-average: the single setting whose mean score is at least canvas's and whose
  worst image is at most 3 points below it.
Totals are sums over images (deck-like), relative to canvas.
"""
import json, math, sys
from collections import defaultdict

rows = [json.loads(line) for line in open(sys.argv[1]) if line.strip()]
qualities = [float(q) for q in (sys.argv[2] if len(sys.argv) > 2 else '0.85,0.82,0.8,0.76,0.72,0.66').split(',')]
rows = [r for r in rows if r['label'] != 'resize' and r['score'] is not None and r['resizer'] == 'canvas']

def family(label):
    # "mozjpeg q75" -> "mozjpeg", "jpegli d1.5 444" -> "jpegli d 444"
    parts = label.split()
    return ' '.join([parts[0], parts[1][0]] + parts[2:]) if len(parts) > 1 else label

def setting(label):
    return float(label.split()[1][1:])

points = defaultdict(list)  # (image, edge, family) -> [(score, bytes, setting, ms)]
for r in rows:
    points[(r['image'], r['longEdge'], family(r['label']))].append((r['score'], r['bytes'], setting(r['label']), r['encodeMs']))
images = sorted({(r['image'], r['longEdge']) for r in rows})
families = sorted({family(r['label']) for r in rows} - {'canvas q'})

def bytes_at(pts, score):
    if not pts: return None
    pts = sorted(pts)
    if score <= pts[0][0]: return pts[0][1]
    if score > pts[-1][0]: return None
    for (s0, b0, *_), (s1, b1, *_) in zip(pts, pts[1:]):
        if s0 <= score <= s1:
            t = 0 if s1 == s0 else (score - s0) / (s1 - s0)
            return math.exp(math.log(b0) + t * (math.log(b1) - math.log(b0)))
    return None

for edge in sorted({e for _, e in images}):
    print(f'\n== long edge {edge} px ({sum(1 for _, e in images if e == edge)} images)')
    for q in qualities:
        targets = {}
        canvas_total = 0
        for image, e in images:
            if e != edge: continue
            # Only images every family has been run on, so totals compare like with like.
            if any(not points[(image, e, fam)] for fam in families): continue
            hit = [p for p in points[(image, e, 'canvas q')] if abs(p[2] - q) < 1e-6]
            if not hit: continue
            targets[image] = hit[0][0]
            canvas_total += hit[0][1]
        if not targets: continue
        scores = sorted(targets.values())
        median = scores[len(scores)//2]
        line = [f'canvas q{q}: {canvas_total/1e6:.2f} MB, score median {median:.1f} (min {scores[0]:.1f})']
        # Absolute target: every image searched to the canvas median score (canvas itself included).
        for fam in ['canvas q'] + families:
            total, missing = 0, 0
            for image in targets:
                b = bytes_at(points[(image, edge, fam)], median)
                if b is None: missing += 1
                else: total += b
            line.append(f'  {fam:<16} to median {median:.1f}: {total/canvas_total:.2f}' + (f' ({missing} out of range)' if missing else ''))
        for fam in families:
            matched, missing = 0, 0
            for image, target in targets.items():
                b = bytes_at(points[(image, edge, fam)], target)
                if b is None: missing += 1
                else: matched += b
            settings = sorted({p[2] for image in targets for p in points[(image, edge, fam)]})
            fixed = None
            for s in settings if not fam.endswith(' d') and ' d ' not in fam else sorted(settings, reverse=True):
                ok, total = 0, 0
                for image, target in targets.items():
                    hit = [p for p in points[(image, edge, fam)] if p[2] == s]
                    if hit:
                        total += hit[0][1]
                        ok += hit[0][0] >= target
                if ok >= 0.9 * len(targets):
                    fixed = (s, total)
                    break
            # Looser: a setting whose average score is no worse and whose worst image is at most 3 points worse.
            even = None
            for s in settings if not fam.endswith(' d') and ' d ' not in fam else sorted(settings, reverse=True):
                deltas, total = [], 0
                for image, target in targets.items():
                    hit = [p for p in points[(image, edge, fam)] if p[2] == s]
                    if hit:
                        total += hit[0][1]
                        deltas.append(hit[0][0] - target)
                if len(deltas) == len(targets) and sum(deltas) / len(deltas) >= 0 and min(deltas) >= -3:
                    even = (s, total)
                    break
            m = f'{matched/canvas_total:.2f}' + (f' ({missing} out of range)' if missing else '')
            f = f'{fam.split()[1]}{fixed[0]:g} → {fixed[1]/canvas_total:.2f}' if fixed else 'none ≥90%'
            e = f'{fam.split()[1]}{even[0]:g} → {even[1]/canvas_total:.2f}' if even else 'none'
            line.append(f'  {fam:<16} matched {m:<22} fixed {f:<16} on-average {e}')
        print('\n'.join(line))

print('\n== median encode ms by family and edge')
ms = defaultdict(list)
for r in rows:
    ms[(family(r['label']), r['longEdge'])].append(r['encodeMs'])
score_ms = defaultdict(list)
for r in rows:
    score_ms[r['longEdge']].append(r['scoreMs'])
for (fam, edge), values in sorted(ms.items()):
    values.sort()
    print(f'  {fam:<16} {edge:>5}px  {values[len(values)//2]:.0f} ms')
for edge, values in sorted(score_ms.items()):
    values.sort()
    print(f'  ssimulacra2      {edge:>5}px  {values[len(values)//2]:.0f} ms (+ decode)')
