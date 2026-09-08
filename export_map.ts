import fs from 'fs';
import path from 'path';
import { getTerrainHeight } from './src/simulation/constants';
import treesData from './src/graphics/scenery/treesData.json';
import rocksData from './src/graphics/scenery/rocksData.json';

const OUT_JSON = '/home/yoga/Dokumen/game_3d/multi-trade-server-go/map_colliders.json';

interface ObstacleData {
  x: number;
  z: number;
  type: string;
  scale: number;
  rotation: number;
}

const colliders: Array<{ size: number[]; pos: number[] }> = [];

// 1. Process Trees
// Sub-sample treesData (1 tree out of 4) and filter out trees below water
const activeTrees = (treesData as ObstacleData[]).filter((data, idx) => {
  if (idx % 4 !== 0) return false;
  const h = getTerrainHeight(data.x, data.z);
  return h >= 0.2;
});

// Procedurally generate the outskirts trees (matching Trees.ts)
let treeSeed = 98765;
const treePrng = () => {
  const x = Math.sin(treeSeed++) * 10000;
  return x - Math.floor(x);
};

const treeTypes = ["Pine_1", "BirchTree_2", "MapleTree_1"];
for (let i = 0; i < 350; i++) {
  const rx = (treePrng() - 0.5) * 820;
  const rz = (treePrng() - 0.5) * 820;
  if (Math.abs(rx) < 50 && Math.abs(rz) < 50) continue;
  
  const h = getTerrainHeight(rx, rz);
  if (h < 0.2) continue;

  activeTrees.push({
    x: rx,
    z: rz,
    type: treeTypes[Math.floor(treePrng() * treeTypes.length)],
    scale: 1.5 + treePrng() * 2.2,
    rotation: treePrng() * Math.PI * 2
  });
}

// Convert trees to BoxObstacles
// A tree trunk has a width of approx 0.6 * scale
activeTrees.forEach(t => {
  const h = getTerrainHeight(t.x, t.z);
  const size = [0.6 * t.scale, 12 * t.scale, 0.6 * t.scale];
  const pos = [t.x, h + (size[1] / 2), t.z];
  colliders.push({ size, pos });
});

// 2. Process Rocks
// Sub-sample rocksData (1 rock out of 2)
const activeRocks = (rocksData as ObstacleData[]).filter((data, idx) => {
  if (idx % 2 !== 0) return false;
  const h = getTerrainHeight(data.x, data.z);
  return h >= 0.2;
});

// Procedurally generate the outskirts rocks (matching Rocks.ts)
let rockSeed = 54321;
const rockPrng = () => {
  const x = Math.sin(rockSeed++) * 10000;
  return x - Math.floor(x);
};

const rockTypes = Array.from(new Set((rocksData as ObstacleData[]).map(r => r.type)));
if (rockTypes.length > 0) {
  for (let i = 0; i < 200; i++) {
    const rx = (rockPrng() - 0.5) * 820;
    const rz = (rockPrng() - 0.5) * 820;
    if (Math.abs(rx) < 100 && Math.abs(rz) < 100) continue;

    const h = getTerrainHeight(rx, rz);
    if (h < 0.2) continue;

    activeRocks.push({
      x: rx,
      z: rz,
      type: rockTypes[Math.floor(rockPrng() * rockTypes.length)],
      scale: 0.8 + rockPrng() * 1.4,
      rotation: rockPrng() * Math.PI * 2
    });
  }
}

// Convert rocks to BoxObstacles
// A rock has a size of approx 2.8 * scale
activeRocks.forEach(r => {
  const h = getTerrainHeight(r.x, r.z);
  const size = [2.8 * r.scale, 2.8 * r.scale, 2.8 * r.scale];
  const pos = [r.x, h + (size[1] / 2) - 0.25 * r.scale, r.z]; // match sink offset
  colliders.push({ size, pos });
});

// 3. Write output to map_colliders.json
fs.writeFileSync(OUT_JSON, JSON.stringify(colliders, null, 2));
console.log(`✅ Successfully exported ${colliders.length} tree trunk & rock colliders to ${OUT_JSON}`);
