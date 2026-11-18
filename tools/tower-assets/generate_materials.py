"""Deterministic Tower Rush materials. Python builds assets; WebGL renders play."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter, ImageOps
import math
import random
import json

OUT = Path(__file__).resolve().parents[2] / "artifacts/3d-game/public/media/tower-rush/materials"
OUT.mkdir(parents=True, exist_ok=True)
SIZE = 256
rng = random.Random(777)
source = Path(__file__).with_name("source-materials.webp")
atlas = Image.open(source).convert("RGB") if source.exists() else None
for kind in ("wood", "brick", "stone", "metal", "ground"):
    heights = []
    for y in range(SIZE):
        row = []
        for x in range(SIZE):
            grain = rng.gauss(0, 4)
            if kind == "wood":
                seam = y % 51
                wave = math.sin(x * .09 + math.sin(y * .035) * 4) * 6
                fine = math.sin(x * .65 + math.sin(y * .05) * 8) * 2
                v = 150 + wave + fine + grain if seam > 3 else 60 + seam * 14
            elif kind == "brick":
                seam = y % 43 < 4 or (x + (y // 43 % 2) * 43) % 86 < 4
                v = 78 + grain if seam else 157 + math.sin(x // 86 * 19 + y // 43 * 8) * 14 + grain * 1.8
            elif kind == "stone":
                seam = y % 64 < 2 or (x + (y // 64 % 2) * 64) % 128 < 2
                v = 90 if seam else 160 + math.sin(x * .045 + y * .028) * 9 + grain * 1.4
            elif kind == "metal":
                v = 146 + math.sin(x * math.pi / 16) * 22 + grain * .35
            else:
                v = 130 + grain * 3
            row.append(max(0, min(255, int(v))))
        heights.append(row)
    height = Image.new("L", (SIZE, SIZE))
    height.putdata([v for row in heights for v in row])
    albedo = Image.new("RGB", (SIZE, SIZE))
    albedo.putdata([(max(50, min(245, int(v * .55 + 130))),) * 3 for row in heights for v in row])
    if atlas:
        index = ("wood", "brick", "stone", "metal", "ground").index(kind)
        panel = atlas.crop((round(index * atlas.width / 5), 0, round((index + 1) * atlas.width / 5), atlas.height))
        albedo = ImageOps.fit(panel, (SIZE, SIZE), Image.Resampling.LANCZOS)
        # Derive detail from the same image so pores and seams stay aligned.
        height = ImageOps.grayscale(albedo)
    albedo.save(OUT / f"{kind}-color.webp", quality=88)
    smooth = height.filter(ImageFilter.GaussianBlur(.5))
    px = smooth.load()
    normal = Image.new("RGB", (SIZE, SIZE))
    normals = []
    for y in range(SIZE):
        for x in range(SIZE):
            dx = (px[(x + 1) % SIZE, y] - px[(x - 1) % SIZE, y]) / 95
            dy = (px[x, (y + 1) % SIZE] - px[x, (y - 1) % SIZE]) / 95
            length = math.sqrt(dx * dx + dy * dy + 1)
            normals.append((int(127.5 - dx / length * 127), int(127.5 + dy / length * 127), int(127.5 + 127 / length)))
    normal.putdata(normals)
    normal.save(OUT / f"{kind}-normal.png", optimize=True)
    roughness = height.point(lambda v: max(95, min(245, (190 if kind == "metal" else 225) - v // 6)))
    roughness.save(OUT / f"{kind}-roughness.webp", lossless=True)

dust = Image.new("RGBA", (64, 64))
dust.putdata([(228, 211, 177, int(100 * math.exp(-(((x-31.5)/15)**2 + ((y-31.5)/15)**2)))) for y in range(64) for x in range(64)])
dust.save(OUT / "dust.png", optimize=True)
clock = Image.new("RGB", (256, 256), "#eddfbd")
d = ImageDraw.Draw(clock)
d.ellipse((4, 4, 252, 252), outline="#856c43", width=7)
for n in range(60):
    angle = n * math.tau / 60 - math.pi / 2
    r = 100 if n % 5 == 0 else 110
    d.line((128 + math.cos(angle)*r, 128 + math.sin(angle)*r, 128 + math.cos(angle)*118, 128 + math.sin(angle)*118), fill="#3d403d", width=5 if n % 5 == 0 else 2)
d.line((128, 65, 128, 128, 175, 151), fill="#333d3f", width=8)
d.ellipse((119, 119, 137, 137), fill="#937347")
clock.save(OUT / "clock-face.webp", quality=92)
(OUT / "manifest.json").write_text(json.dumps({"generator": "tools/tower-assets/generate_materials.py", "source": "built-in imagegen atlas" if atlas else "procedural", "seed": 777, "size": SIZE, "materials": ["wood", "brick", "stone", "metal", "ground"], "maps": ["color", "normal", "roughness"]}, indent=2))
print(f"Generated {len(list(OUT.iterdir()))} reproducible material assets in {OUT}")
