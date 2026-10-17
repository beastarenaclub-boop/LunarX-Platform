import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

// Original, photographed CC0 surfaces from Poly Haven. Keep original files;
// Unity imports the normal maps and supplies material tint/tiling at runtime.
const root = new URL('../../artifacts/unity-sports/Assets/Resources/Sports/', import.meta.url);
await mkdir(new URL('Textures/', root), { recursive: true });
const records = [];
for (const [asset, prefix] of [['concrete_wall_006', 'stadium-concrete'], ['metal_plate', 'stadium-metal']]) {
  const metadata = await fetch(`https://api.polyhaven.com/files/${asset}`).then(r => {
    if (!r.ok) throw new Error(`Poly Haven metadata: ${r.status}`);
    return r.json();
  });
  for (const [map, suffix] of [['Diffuse', 'color'], ['nor_gl', 'normal']]) {
    const entry = metadata[map]['1k'].jpg;
    const response = await fetch(entry.url);
    if (!response.ok) throw new Error(`Asset download: ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (createHash('md5').update(bytes).digest('hex') !== entry.md5) throw new Error('Source checksum mismatch');
    const filename = `${prefix}-${suffix}.jpg`;
    await writeFile(new URL(`Textures/${filename}`, root), bytes);
    records.push({ filename, source: `https://polyhaven.com/a/${asset}`, url: entry.url, license: 'CC0-1.0', sha256: createHash('sha256').update(bytes).digest('hex') });
    console.log(`${filename}: ${bytes.length} bytes, source checksum verified`);
  }
}
await writeFile(new URL('stadium-materials-provenance.json', root), JSON.stringify({ license: 'https://polyhaven.com/license', assets: records }, null, 2));
