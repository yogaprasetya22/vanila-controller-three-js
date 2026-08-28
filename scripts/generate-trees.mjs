import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.join(__dirname, '..');

// Define boundaries and zones based on constants.ts
const MAP_MIN_X = -230;
const MAP_MAX_X = 230;
const MAP_MIN_Z = -170;
const MAP_MAX_Z = 170;

const BF_HALF_X = 92; // Buffered slightly to prevent overlapping onto the battlefield
const BF_HALF_Z = 82;

const LAKES = [
  { cx: -136, cz: -124, rx: 18, rz: 13, depth: 1.4 },
  { cx: 136,  cz: -124, rx: 17, rz: 12, depth: 1.3 },
  { cx: -136, cz: 124,  rx: 16, rz: 13, depth: 1.2 },
  { cx: 136,  cz: 124,  rx: 18, rz: 12, depth: 1.5 },
  { cx: -176, cz: 0,    rx: 12, rz: 10, depth: 1.0 },
  { cx: 176,  cz: 0,    rx: 12, rz: 10, depth: 1.0 },
  { cx: 0,    cz: -148, rx: 11, rz: 8,  depth: 1.1 },
  { cx: 0,    cz: 148,  rx: 11, rz: 8,  depth: 1.2 },
];

const TREE_TYPES = [
  'BirchTree_1', 'BirchTree_2', 'BirchTree_3', 'BirchTree_4', 'BirchTree_5',
  'MapleTree_1', 'MapleTree_2', 'MapleTree_3', 'MapleTree_4',
  'Pine_1', 'Pine_2', 'Pine_3', 'Pine_5',
  'TwistedTree_1', 'TwistedTree_3'
];

const ROCK_TYPES = [
  'Rock_Medium_1', 'Rock_Medium_2', 'Rock_Medium_3',
  'Pebble_Round_1', 'Pebble_Round_2', 'Pebble_Round_3', 'Pebble_Round_4', 'Pebble_Round_5',
  'Pebble_Square_1', 'Pebble_Square_2', 'Pebble_Square_3', 'Pebble_Square_4', 'Pebble_Square_5', 'Pebble_Square_6'
];

const VEGETATION_TYPES = [
  'Bush', 'Bush_Common', 'Bush_Common_Flowers', 'Bush_Flowers', 'Bush_Large', 'Bush_Large_Flowers', 'Bush_Small', 'Bush_Small_Flowers',
  'Clover_1', 'Clover_2', 'Fern_1',
  'Flower_1', 'Flower_1_Clump', 'Flower_2', 'Flower_2_Clump', 'Flower_3_Clump', 'Flower_5_Clump',
  'Mushroom_Common', 'Mushroom_Laetiporus',
  'Plant_1', 'Plant_1_Big', 'Plant_7', 'Plant_7_Big'
];

function isInsideBattlefield(x, z) {
  return Math.abs(x) < BF_HALF_X && Math.abs(z) < BF_HALF_Z;
}

function isInsideLake(x, z) {
  for (const lake of LAKES) {
    const dx = (x - lake.cx) / lake.rx;
    const dz = (z - lake.cz) / lake.rz;
    // We add a safety margin of 1.15 to avoid placing items on the shore/inside water
    if (dx * dx + dz * dz < 1.15) {
      return true;
    }
  }
  return false;
}

function smoothstep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function mixVal(a, b, t) {
  return a * (1.0 - t) + b * t;
}

function getTerrainHeight(x, z) {
  const BF_HALF_X = 84;
  const BF_HALF_Z = 76;
  const BF_BLEND = 14;

  const dxEdge = Math.max(0, Math.abs(x) - BF_HALF_X);
  const dzEdge = Math.max(0, Math.abs(z) - BF_HALF_Z);
  const edgeDist = Math.sqrt(dxEdge * dxEdge + dzEdge * dzEdge);
  const forestFactor = smoothstep(0, BF_BLEND, edgeDist);

  const mountainH = Math.sin(x * 0.010) * Math.cos(z * 0.012 + 0.3) * 32.0 + Math.cos(x * 0.025) * Math.sin(z * 0.022) * 14.0;
  const h1 = Math.sin(x * 0.12 + 0.5) * Math.cos(z * 0.12) * 3.5;
  const h2 = Math.sin(x * 0.28) * Math.sin(z * 0.22 + 1.2) * 1.2;
  const h3 = Math.sin(x * 0.06 + 1.1) * Math.cos(z * 0.055 + 0.8) * 9.0;
  const h4 = Math.cos(x * 0.09) * Math.sin(z * 0.075 + 2.0) * 5.5;
  
  const riverPath = Math.sin(x * 0.013) * 75;
  const riverDist = Math.abs(z - riverPath);
  let riverDepth = 0;
  if (riverDist < 28) {
    const rT = 1.0 - (riverDist / 28);
    riverDepth = -7.0 * Math.sin(rT * Math.PI * 0.5);
  }

  let hills = mountainH + h1 + h2 + h3 + h4 + riverDepth;

  const WATER_LEVEL = -3.0;

  let maxWetness = 0;
  let lakeBowlDepth = 0;
  for (const lake of LAKES) {
    const dx = (x - lake.cx) / lake.rx;
    const dz = (z - lake.cz) / lake.rz;
    const distSq = dx * dx + dz * dz;
    const wet = Math.exp(-distSq * 0.5);
    if (wet > maxWetness) {
      maxWetness = wet;
    }
    lakeBowlDepth -= (lake.depth * 2.2) * wet;
  }

  hills = mixVal(hills, WATER_LEVEL, smoothstep(0.0, 0.8, maxWetness));
  const forestTerrain = hills + lakeBowlDepth;
  return forestTerrain * forestFactor;
}

function generateScenery(types, spacing, minDistanceSq, scaleMin, scaleMax) {
  const items = [];
  const jitterRange = spacing * 0.35;

  for (let x = MAP_MIN_X + spacing / 2; x < MAP_MAX_X; x += spacing) {
    for (let z = MAP_MIN_Z + spacing / 2; z < MAP_MAX_Z; z += spacing) {
      // Jitter position within cell
      const jx = parseFloat((x + (Math.random() * 2 - 1) * jitterRange).toFixed(1));
      const jz = parseFloat((z + (Math.random() * 2 - 1) * jitterRange).toFixed(1));

      // Must be outside the battlefield, outside any lake, and on dry land (Y >= 0.2)
      if (isInsideBattlefield(jx, jz) || isInsideLake(jx, jz) || getTerrainHeight(jx, jz) < 0.2) {
        continue;
      }

      // Check distance against already generated items to guarantee spacing
      let tooClose = false;
      for (const item of items) {
        const dx = jx - item.x;
        const dz = jz - item.z;
        if (dx * dx + dz * dz < minDistanceSq) {
          tooClose = true;
          break;
        }
      }
      if (tooClose) continue;

      const type = types[Math.floor(Math.random() * types.length)];
      
      let scale;
      if (type.startsWith('TwistedTree')) {
        scale = parseFloat((Math.random() * 1.0 + 2.0).toFixed(2)); // min 2, max 3
      } else {
        scale = parseFloat((Math.random() * (scaleMax - scaleMin) + scaleMin).toFixed(2));
      }
      
      const rotation = parseFloat((Math.random() * Math.PI * 2).toFixed(2));

      items.push({
        x: jx,
        z: jz,
        type,
        scale,
        rotation
      });
    }
  }

  return items;
}

// 1. Generate Trees (spacing: ~10.0 units, min distance: ~6.0 units)
const trees = generateScenery(TREE_TYPES, 10.0, 36.0, 2.0, 4.0);
fs.writeFileSync(
  path.join(ROOT_DIR, 'src/graphics/scenery/treesData.json'),
  JSON.stringify(trees, null, 2),
  'utf-8'
);
console.log(`🌲 Generated ${trees.length} trees.`);

// 2. Generate Rocks (spacing: ~14.0 units, min distance: ~7.5 units)
const rocks = generateScenery(ROCK_TYPES, 14.0, 56.25, 0.8, 2.2);
fs.writeFileSync(
  path.join(ROOT_DIR, 'src/graphics/scenery/rocksData.json'),
  JSON.stringify(rocks, null, 2),
  'utf-8'
);
console.log(`🪨 Generated ${rocks.length} rocks.`);

// 3. Generate Vegetation (spacing: ~8.0 units, min distance: ~4.5 units)
const vegetation = generateScenery(VEGETATION_TYPES, 8.0, 20.25, 0.8, 1.8);
fs.writeFileSync(
  path.join(ROOT_DIR, 'src/graphics/scenery/vegetationData.json'),
  JSON.stringify(vegetation, null, 2),
  'utf-8'
);
console.log(`🌿 Generated ${vegetation.length} vegetation.`);

console.log(`\n✨ Successfully generated all environment files in src/graphics/scenery/!`);
