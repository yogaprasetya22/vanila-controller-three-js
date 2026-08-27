import fs from 'fs';
import path from 'path';

// Define boundaries and zones based on constants.ts
const MAP_MIN_X = -115; // Ground floor is 240 units wide (-120 to 120), so we stay inside at -115
const MAP_MAX_X = 115;
const MAP_MIN_Z = -85;  // Ground floor is 180 units tall (-90 to 90), so we stay inside at -85
const MAP_MAX_Z = 85;

const BF_HALF_X = 46; // Buffered slightly to prevent trees overlapping onto the battlefield
const BF_HALF_Z = 42;

const LAKES = [
  { cx: -68, cz: -62, rx: 22, rz: 15, depth: 1.4 },
  { cx: 68,  cz: -62, rx: 20, rz: 14, depth: 1.3 },
  { cx: -68, cz: 62,  rx: 19, rz: 15, depth: 1.2 },
  { cx: 68,  cz: 62,  rx: 22, rz: 14, depth: 1.5 },
  { cx: -88, cz: 0,   rx: 14, rz: 11, depth: 1.0 },
  { cx: 88,  cz: 0,   rx: 14, rz: 11, depth: 1.0 }
];

const TREE_TYPES = [
  // Birch trees (Highly optimized and matching the map style)
  'BirchTree_1', 'BirchTree_2', 'BirchTree_3', 'BirchTree_4', 'BirchTree_5',
  // Maple trees
  'MapleTree_1', 'MapleTree_2', 'MapleTree_3', 'MapleTree_4',
  // Pine trees
  'Pine_1', 'Pine_2', 'Pine_3', 'Pine_5',
  // Twisted trees
  'TwistedTree_1', 'TwistedTree_3'
];

function isInsideBattlefield(x, z) {
  return Math.abs(x) < BF_HALF_X && Math.abs(z) < BF_HALF_Z;
}

function isInsideLake(x, z) {
  for (const lake of LAKES) {
    const dx = (x - lake.cx) / lake.rx;
    const dz = (z - lake.cz) / lake.rz;
    // We add a safety margin of 1.15 to avoid placing trees on the shore/inside water
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
  const BF_HALF_X = 42;
  const BF_HALF_Z = 38;
  const BF_BLEND = 8;

  const dxEdge = Math.max(0, Math.abs(x) - BF_HALF_X);
  const dzEdge = Math.max(0, Math.abs(z) - BF_HALF_Z);
  const edgeDist = Math.sqrt(dxEdge * dxEdge + dzEdge * dzEdge);
  const forestFactor = smoothstep(0, BF_BLEND, edgeDist);

  const mountainH = Math.sin(x * 0.015) * Math.cos(z * 0.018 + 0.3) * 22.0 + Math.cos(x * 0.04) * Math.sin(z * 0.035) * 8.0;
  const h1 = Math.sin(x * 0.12 + 0.5) * Math.cos(z * 0.12) * 3.5;
  const h2 = Math.sin(x * 0.28) * Math.sin(z * 0.22 + 1.2) * 1.2;
  
  const riverPath = Math.sin(x * 0.02) * 45;
  const riverDist = Math.abs(z - riverPath);
  let riverDepth = 0;
  if (riverDist < 18) {
    const rT = 1.0 - (riverDist / 18);
    riverDepth = -5.5 * Math.sin(rT * Math.PI * 0.5);
  }

  let hills = mountainH + h1 + h2 + riverDepth;

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

function generateTreesGrid() {
  const targetCount = 10;
  let cellSize = 6.5;
  let jitterRange = 2.0;
  let trees = [];

  for (let attempt = 0; attempt < 100; attempt++) {
    trees = [];
    for (let x = MAP_MIN_X + cellSize / 2; x < MAP_MAX_X; x += cellSize) {
      for (let z = MAP_MIN_Z + cellSize / 2; z < MAP_MAX_Z; z += cellSize) {
        // Jitter the position within the cell
        const jx = parseFloat((x + (Math.random() * 2 - 1) * jitterRange).toFixed(1));
        const jz = parseFloat((z + (Math.random() * 2 - 1) * jitterRange).toFixed(1));

        // Must be outside the battlefield, outside any lake, and not in the water (Y >= 0.2)
        if (isInsideBattlefield(jx, jz) || isInsideLake(jx, jz) || getTerrainHeight(jx, jz) < 0.2) {
          continue;
        }

        // Check distance against already generated trees to guarantee spacing
        let tooClose = false;
        for (const tree of trees) {
          const dx = jx - tree.x;
          const dz = jz - tree.z;
          if (dx * dx + dz * dz < 12.25) { // Minimum distance of 3.5 units
            tooClose = true;
            break;
          }
        }
        if (tooClose) {
          continue;
        }

        const type = TREE_TYPES[Math.floor(Math.random() * TREE_TYPES.length)];
        
        // Scale range: min 2, max 4 (for TwistedTree max 3)
        let scale;
        if (type.startsWith('TwistedTree')) {
          scale = parseFloat((Math.random() * 1.0 + 2.0).toFixed(2)); // min 2, max 3
        } else {
          scale = parseFloat((Math.random() * 2.0 + 2.0).toFixed(2)); // min 2, max 4
        }
        
        // Random rotation in radians (0 to 2*PI)
        const rotation = parseFloat((Math.random() * Math.PI * 2).toFixed(2));

        trees.push({
          x: jx,
          z: jz,
          type,
          scale,
          rotation
        });
      }
    }

    if (Math.abs(trees.length - targetCount) <= 10) {
      break;
    }

    // Adjust cell size dynamically based on deviation from target
    if (trees.length < targetCount) {
      cellSize -= 0.05;
    } else {
      cellSize += 0.05;
    }
  }

  console.log(`Generated ${trees.length} trees using grid-jitter layout.`);
  return trees;
}

const treesData = generateTreesGrid();
const outputPath = path.resolve('src/graphics/scenery/treesData.json');

fs.writeFileSync(outputPath, JSON.stringify(treesData, null, 2), 'utf-8');
console.log(`Successfully saved trees data to ${outputPath}`);
