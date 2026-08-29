import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.join(__dirname, '..');

// Define boundaries and zones based on constants.ts
const MAP_MIN_X = -430;
const MAP_MAX_X = 430;
const MAP_MIN_Z = -430;
const MAP_MAX_Z = 430;

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
    "BirchTree_1",
    "BirchTree_2",
    "BirchTree_3",
    "BirchTree_4",
    "BirchTree_5",
    "CommonTree_1",
    "CommonTree_2",
    "MapleTree_1",
    "MapleTree_2",
    "MapleTree_3",
    "MapleTree_4",
    "Pine_1",
    "Pine_2",
    "Pine_3",
    "Pine_5",
    "TwistedTree_2",
    "TwistedTree_3",
];

const ROCK_TYPES = [
  'Rock_Medium_1', 'Rock_Medium_2', 'Rock_Medium_3',
  'Pebble_Round_1', 'Pebble_Round_2', 'Pebble_Round_3', 'Pebble_Round_4', 'Pebble_Round_5',
  'Pebble_Square_1', 'Pebble_Square_2', 'Pebble_Square_3', 'Pebble_Square_4', 'Pebble_Square_5', 'Pebble_Square_6',
  'RockPath_Round_Small_1', 'RockPath_Round_Small_2', 'RockPath_Round_Small_3',
  'RockPath_Round_Thin', 'RockPath_Round_Wide',
  'RockPath_Square_Small_1', 'RockPath_Square_Small_2', 'RockPath_Square_Small_3',
  'RockPath_Square_Thin', 'RockPath_Square_Wide'
];

const MEDIUM_ROCKS = ['Rock_Medium_1', 'Rock_Medium_2', 'Rock_Medium_3'];
const PEBBLES = [
  'Pebble_Round_1', 'Pebble_Round_2', 'Pebble_Round_3', 'Pebble_Round_4', 'Pebble_Round_5',
  'Pebble_Square_1', 'Pebble_Square_2', 'Pebble_Square_3', 'Pebble_Square_4', 'Pebble_Square_5', 'Pebble_Square_6',
];

const VEGETATION_TYPES = [
  'Bush', 'Bush_Common', 'Bush_Common_Flowers',
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

function getSlope(x, z) {
  const h = getTerrainHeight(x, z);
  const hX = getTerrainHeight(x + 2.0, z);
  const hZ = getTerrainHeight(x, z + 2.0);
  const dx = (hX - h) / 2.0;
  const dz = (hZ - h) / 2.0;
  return Math.sqrt(dx * dx + dz * dz);
}

function generateScenery(types, spacing, minDistanceSq, scaleMin, scaleMax, allowBattlefield = false) {
  const items = [];
  const jitterRange = spacing * 0.35;
  const BF_BLEND = 14;

  for (let x = MAP_MIN_X + spacing / 2; x < MAP_MAX_X; x += spacing) {
    for (let z = MAP_MIN_Z + spacing / 2; z < MAP_MAX_Z; z += spacing) {
      // Jitter position within cell
      const jx = parseFloat((x + (Math.random() * 2 - 1) * jitterRange).toFixed(1));
      const jz = parseFloat((z + (Math.random() * 2 - 1) * jitterRange).toFixed(1));

      // Height boundary check: Trees use Y >= 0.2. Vegetation uses Y between -0.05 and 12.0 (same as grass).
      const h = getTerrainHeight(jx, jz);
      const heightOk = (types === VEGETATION_TYPES) ? (h >= -0.05 && h <= 12.0) : (h >= 0.2);

      // Must be outside lake, on dry land/valid height, and optionally outside battlefield
      if ((!allowBattlefield && isInsideBattlefield(jx, jz)) || isInsideLake(jx, jz) || !heightOk) {
        continue;
      }

      // ponytail: ensure vegetation only spawns in dense grass/forest regions (forestFactor > 0.45)
      const dxEdge = Math.max(0, Math.abs(jx) - BF_HALF_X);
      const dzEdge = Math.max(0, Math.abs(jz) - BF_HALF_Z);
      const edgeDist = Math.sqrt(dxEdge * dxEdge + dzEdge * dzEdge);
      const forestFactor = smoothstep(0, BF_BLEND, edgeDist);
      if (types === VEGETATION_TYPES && forestFactor < 0.45) {
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

// 1. Generate Trees (spacing: ~12.5 units, min distance: ~7.0 units)
const trees = generateScenery(TREE_TYPES, 12.5, 49.0, 2.0, 4.0);
fs.writeFileSync(
  path.join(ROOT_DIR, 'src/graphics/scenery/treesData.json'),
  JSON.stringify(trees, null, 2),
  'utf-8'
);
console.log(`🌲 Generated ${trees.length} trees.`);

function generateRocks() {
  const items = [];
  const spacing = 16.0; // Slightly larger spacing to make room for clusters
  const jitterRange = spacing * 0.35;

  for (let x = MAP_MIN_X + spacing / 2; x < MAP_MAX_X; x += spacing) {
    for (let z = MAP_MIN_Z + spacing / 2; z < MAP_MAX_Z; z += spacing) {
      // Jitter position within cell
      const cx = x + (Math.random() * 2 - 1) * jitterRange;
      const cz = z + (Math.random() * 2 - 1) * jitterRange;

      // Must be outside any lake and on dry land (generate everywhere including battlefield!)
      if (isInsideLake(cx, cz) || getTerrainHeight(cx, cz) < 0.2) {
        continue;
      }

      // ponytail: bias rock placement to hills/mountainsides (steeper slope) for realism
      const slope = getSlope(cx, cz);
      if (slope < 0.12 && Math.random() > 0.08) {
        continue; // Skip 92% of flat areas
      }

      // Check distance against already generated items to guarantee spacing between clusters/single rocks
      let tooClose = false;
      for (const item of items) {
        const dx = cx - item.x;
        const dz = cz - item.z;
        if (dx * dx + dz * dz < 12.0 * 12.0) { // spacing between independent formations
          tooClose = true;
          break;
        }
      }
      if (tooClose) continue;

      // 45% chance to spawn a cluster, 55% to spawn a single rock
      const isCluster = Math.random() < 0.45;
      
      if (isCluster) {
        // Spawn exactly 3 rocks in a cluster
        const numRocks = 3;
        const mainScale = parseFloat((Math.random() * 1.5 + 2.5).toFixed(2)); // Large central boulder (2.5 - 4.0)
        
        for (let i = 0; i < numRocks; i++) {
          let rx, rz, rScale, type;
          if (i === 0) {
            // Main central large rock
            rx = cx;
            rz = cz;
            rScale = mainScale;
            type = MEDIUM_ROCKS[Math.floor(Math.random() * MEDIUM_ROCKS.length)];
          } else {
            // Smaller rocks clustered around it
            const angle = Math.random() * Math.PI * 2;
            const dist = 1.2 + Math.random() * 2.2; // close cluster distance
            rx = cx + Math.cos(angle) * dist;
            rz = cz + Math.sin(angle) * dist;
            // Scale is 20% to 60% of the main rock scale (pebbles/stepping stones)
            rScale = parseFloat((mainScale * (0.2 + Math.random() * 0.4)).toFixed(2));
            type = PEBBLES[Math.floor(Math.random() * PEBBLES.length)];
          }

          // Ensure cluster components don't clip into lake or underwater
          if (isInsideLake(rx, rz) || getTerrainHeight(rx, rz) < 0.2) {
            continue;
          }

          const rotation = parseFloat((Math.random() * Math.PI * 2).toFixed(2));

          items.push({
            x: parseFloat(rx.toFixed(1)),
            z: parseFloat(rz.toFixed(1)),
            type,
            scale: rScale,
            rotation
          });
        }
      } else {
        // Spawn a single standalone rock
        const isMedium = Math.random() < 0.40;
        const type = isMedium 
          ? MEDIUM_ROCKS[Math.floor(Math.random() * MEDIUM_ROCKS.length)]
          : PEBBLES[Math.floor(Math.random() * PEBBLES.length)];
        const scale = isMedium
          ? parseFloat((Math.random() * 1.5 + 2.5).toFixed(2)) // Large standalone boulder
          : parseFloat((Math.random() * 1.0 + 0.5).toFixed(2)); // Small standalone pebble
        const rotation = parseFloat((Math.random() * Math.PI * 2).toFixed(2));

        items.push({
          x: parseFloat(cx.toFixed(1)),
          z: parseFloat(cz.toFixed(1)),
          type,
          scale,
          rotation
        });
      }
    }
  }
  return items;
}

// 2. Generate Rocks (with clustering support)
const rocks = generateRocks();
fs.writeFileSync(
  path.join(ROOT_DIR, 'src/graphics/scenery/rocksData.json'),
  JSON.stringify(rocks, null, 2),
  'utf-8'
);
console.log(`🪨 Generated ${rocks.length} rocks.`);

// 3. Generate Vegetation (spacing: ~8.0 units, min distance: ~4.5 units, forest grass only)
const vegetation = generateScenery(VEGETATION_TYPES, 8.0, 20.25, 0.8, 1.8, false);
fs.writeFileSync(
  path.join(ROOT_DIR, 'src/graphics/scenery/vegetationData.json'),
  JSON.stringify(vegetation, null, 2),
  'utf-8'
);
console.log(`🌿 Generated ${vegetation.length} vegetation.`);

console.log(`\n✨ Successfully generated all environment files in src/graphics/scenery/!`);
