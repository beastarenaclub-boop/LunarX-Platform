import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

const cache = path.resolve('.cache/horse-realism');
const output = path.resolve('artifacts/3d-game/public/assets/horse-racing/realistic');
const humanRevision = 'bdecdcd537b4031fdd0fb299b7e4f93f084fffa0';
const records = [];
async function download(url, filename) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status}: ${url}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  await fs.mkdir(path.dirname(filename), { recursive: true });
  await fs.writeFile(filename, bytes);
  records.push({ url, file: path.relative(process.cwd(), filename), bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
}
await download('https://opengameart.org/sites/default/files/riggedHorse.blend', path.join(cache, 'riggedHorse.blend'));
const humanFiles = ['vitruvian_body.glb','vitruvian_head.glb','vit_body_bc.png','vit_body_n.png','vit_face_bc.png','vit_face_n.png','vit_fabric_n.png','vit_iris.png','vit_sclera.png','vit_mouth.png'];
await Promise.all(humanFiles.map(file => download(`https://raw.githubusercontent.com/ibrews/VitruvianGodot/${humanRevision}/godot_project/${file}`, path.join(cache, file))));
for (const surface of ['raked_dirt', 'grass_ground', 'aerial_rocks_02']) {
  const info = await (await fetch(`https://api.polyhaven.com/files/${surface}`)).json();
  await Promise.all([['Diffuse','diff'], ['nor_gl','nor_gl'], ['Rough','rough']].map(([source, suffix]) => download(info[source]['1k'].jpg.url, path.join(output, `${surface}-${suffix}.jpg`))));
}
const sky = await (await fetch('https://api.polyhaven.com/files/kloofendal_48d_partly_cloudy')).json();
await download(sky.hdri['1k'].hdr.url, path.join(output, 'daylight.hdr'));
const tree = (await (await fetch('https://api.polyhaven.com/files/island_tree_01')).json()).gltf['1k'].gltf;
await download(tree.url, path.join(cache, 'tree/island_tree_01.gltf'));
await Promise.all(Object.entries(tree.include).map(([file, asset]) => download(asset.url, path.join(cache, 'tree', file))));
await fs.writeFile(path.join(cache, 'sources.json'), JSON.stringify({ humanRevision, records }, null, 2));
console.log(`Downloaded ${records.length} source files; SHA-256 manifest: ${path.join(cache, 'sources.json')}`);
