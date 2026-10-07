"""Draws the page's "Rather do it on your phone?" QR code as inline SVG.

Run it after changing the page's address, then paste the output over the
<svg class="qr"> in index.html:

    python3 -m pip install qrcode
    python3 scripts/make-qr.py https://pitch.dog/email-my-deck/

Error correction is at its highest (H, 30%), which pays for the logomark in
the middle. Data modules are dots, the three finder squares are drawn whole
with a pitch.dog pink ring, and the CSS supplies the light margin a camera
needs around it. The dots take their colour from the #qr-ink gradient.
"""

import sys

import qrcode

url = sys.argv[1] if len(sys.argv) > 1 else "https://pitch.dog/email-my-deck/"
code = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_H, border=0)
code.add_data(url)
code.make(fit=True)
matrix = code.get_matrix()
size = len(matrix)

finders = [(0, 0), (size - 7, 0), (0, size - 7)]
# Alignment patterns (version 2 and up), from the library's own table.
aligns = []
centres = qrcode.util.pattern_position(code.version)
for row in centres:
    for col in centres:
        if any(fx <= col < fx + 7 and fy <= row < fy + 7 for fx, fy in finders):
            continue
        if any(fx - 2 <= col < fx + 9 and fy - 2 <= row < fy + 9 for fx, fy in finders):
            continue
        aligns.append((col - 2, row - 2))

# The middle square, left clear for the logomark.
hole = 9 if size >= 33 else 7
lo = (size - hole) // 2
hi = lo + hole


def skip(x, y):
    if any(fx <= x < fx + 7 and fy <= y < fy + 7 for fx, fy in finders):
        return True
    if any(ax <= x < ax + 5 and ay <= y < ay + 5 for ax, ay in aligns):
        return True
    return lo <= x < hi and lo <= y < hi


dots = []
for y, row in enumerate(matrix):
    for x, on in enumerate(row):
        if on and not skip(x, y):
            dots.append(f"M{x + 0.5},{y + 0.06}a.44,.44 0 1 0 .001 0")

parts = [
    f'<svg class="qr" viewBox="0 0 {size} {size}" role="img" aria-label="QR code that opens this page: {url}">',
    # Ink that warms toward pitch.dog pink across the code, dark enough
    # everywhere for a camera to read.
    '<defs><linearGradient id="qr-ink" x1="0" y1="0" x2="1" y2="1">'
    '<stop offset="0" stop-color="#0b0c0e"/><stop offset=".5" stop-color="#3a1030"/><stop offset="1" stop-color="#96236a"/>'
    '</linearGradient></defs>',
    f'<path class="qr-dots" d="{"".join(dots)}"/>',
]
for fx, fy in finders:
    parts.append(f'<rect class="qr-eye" x="{fx + 0.5}" y="{fy + 0.5}" width="6" height="6" rx="1.7"/>')
    parts.append(f'<rect class="qr-pupil" x="{fx + 2}" y="{fy + 2}" width="3" height="3" rx="0.9"/>')
for ax, ay in aligns:
    parts.append(f'<rect class="qr-align" x="{ax + 0.5}" y="{ay + 0.5}" width="4" height="4" rx="1.2"/>')
    parts.append(f'<circle class="qr-pupil" cx="{ax + 2.5}" cy="{ay + 2.5}" r="0.55"/>')
pad = 0.6
parts.append(f'<rect class="qr-hole" x="{lo + pad}" y="{lo + pad}" width="{hole - 2 * pad}" height="{hole - 2 * pad}" rx="1.6"/>')
mark = hole - 2 * pad - 2
parts.append(f'<image href="/assets/pitchdog-logomark.svg" x="{lo + pad + 1}" y="{lo + pad + 1}" width="{mark}" height="{mark}"/>')
parts.append("</svg>")
print("".join(parts))
