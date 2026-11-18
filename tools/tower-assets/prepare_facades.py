"""Crop the original imagegen facade atlas into six runtime architectural skins."""
from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parents[2]
source = Path(__file__).with_name("source-facades-v3.webp")
atlas = Image.open(source).convert("RGB")
out = root / "artifacts/3d-game/public/media/tower-rush/materials"
for index in range(6):
    x, y = index % 3, index // 3
    face = atlas.crop((round(x * atlas.width / 3), round(y * atlas.height / 2), round((x+1) * atlas.width / 3), round((y+1) * atlas.height / 2)))
    face.resize((512, 356), Image.Resampling.LANCZOS).save(out / f"facade-v3-{index}.webp", quality=92)
print("Prepared six 512px photographic facade textures")
