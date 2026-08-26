/**
 * export_map.js
 * Reads obstacleConfigs directly from src/main.ts and writes:
 *   - map_colliders.json  (AABB boxes for Go backend physics + A* grid)
 *   - map.obj             (3D mesh for OBJ-based raycasting, optional)
 *
 * Usage: bun export_map.js
 * Run this whenever you modify obstacleConfigs in src/main.ts.
 */
const fs = require('fs');
const path = require('path');

const MAIN_TS_PATH = path.join(__dirname, 'src/main.ts');
const OUT_JSON = path.join('/home/yoga/Dokumen/game_3d/multi-trade-server-go', 'map_colliders.json');
const OUT_OBJ  = path.join('/home/yoga/Dokumen/game_3d/multi-trade-server-go', 'map.obj');

// ── 1. Parse obstacleConfigs from main.ts ──────────────────────────────────────
const src = fs.readFileSync(MAIN_TS_PATH, 'utf8');

// Match the obstacleConfigs array literal
const arrayMatch = src.match(/const obstacleConfigs\s*=\s*(\[[\s\S]*?\]);/);
if (!arrayMatch) {
  console.error('❌  Could not find `obstacleConfigs` array in src/main.ts');
  process.exit(1);
}

// Eval in a safe sandbox — strip trailing commas and TypeScript annotations
let rawArray = arrayMatch[1]
  .replace(/,\s*(\]|})/, '$1')   // trailing commas
  .replace(/0x[0-9a-fA-F]+/g, '0');  // hex color literals → 0 (JSON safe)

let obstacleConfigs;
try {
  obstacleConfigs = eval(rawArray); // eslint-disable-line no-eval
} catch (e) {
  console.error('❌  Failed to parse obstacleConfigs:', e.message);
  process.exit(1);
}

console.log(`✅  Parsed ${obstacleConfigs.length} obstacles from src/main.ts`);

// ── 2. Write map_colliders.json (size + pos only, no color) ───────────────────
const jsonObstacles = obstacleConfigs.map(cfg => ({
  size: cfg.size,
  pos:  cfg.pos,
}));
fs.writeFileSync(OUT_JSON, JSON.stringify(jsonObstacles, null, 2));
console.log(`✅  Wrote map_colliders.json → ${OUT_JSON}`);

// ── 3. Write map.obj (bounding boxes as 3D meshes) ───────────────────────────
let objContent = '# Auto-generated from src/main.ts obstacleConfigs\n';
let vOffset = 1;

for (const cfg of obstacleConfigs) {
  const [sx, sy, sz] = cfg.size;
  const [px, py, pz] = cfg.pos;
  const dx = sx / 2, dy = sy / 2, dz = sz / 2;

  const verts = [
    [px-dx, py-dy, pz-dz], [px+dx, py-dy, pz-dz],
    [px+dx, py+dy, pz-dz], [px-dx, py+dy, pz-dz],
    [px-dx, py-dy, pz+dz], [px+dx, py-dy, pz+dz],
    [px+dx, py+dy, pz+dz], [px-dx, py+dy, pz+dz],
  ];
  for (const v of verts) objContent += `v ${v[0].toFixed(4)} ${v[1].toFixed(4)} ${v[2].toFixed(4)}\n`;

  const faces = [
    [0,1,2,3],[1,5,6,2],[5,4,7,6],[4,0,3,7],[3,2,6,7],[4,5,1,0],
  ];
  for (const f of faces)
    objContent += `f ${f[0]+vOffset} ${f[1]+vOffset} ${f[2]+vOffset} ${f[3]+vOffset}\n`;

  vOffset += 8;
}
fs.writeFileSync(OUT_OBJ, objContent);
console.log(`✅  Wrote map.obj       → ${OUT_OBJ}`);
console.log('\n📦  Done. Restart the Go server (or Air will auto-reload) to pick up changes.');
