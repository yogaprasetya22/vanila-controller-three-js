export const TEAM_SIZE = 25;
export const UNIT_COUNT = TEAM_SIZE * 2;
export const STRIDE = 15;
export const IDX_X = 0;
export const IDX_Y = 1;
export const IDX_Z = 2;
export const IDX_HP = 3;
export const IDX_TARGET = 4;
export const IDX_TEAM = 5;
export const IDX_ANIM = 6;
export const IDX_TYPE = 7;
export const IDX_SKILL1_CD = 8;
export const IDX_SKILL2_CD = 9;
export const IDX_SKILL3_CD = 10;
export const IDX_MAX_HP = 11;
export const IDX_ATTACK_CD = 12;
export const IDX_EFFECT_STATE = 13;
export const IDX_IMMUNE_CD = 14;

export const UNIT_LOD_DIST_SQ = 90000;
export const WEAPON_LOD_DIST_SQ = 1600;

export const TYPE_BARBARIAN = 0;
export const TYPE_TANK = 0;
export const TYPE_ARCHER = 1;
export const TYPE_MAGE = 2;
export const TYPE_HEALER = 3;
export const TYPE_ACOLYTE = 3;
export const TYPE_GUNSLINGER = 4;
export const TYPE_ASSASSIN = 5;
export const TYPE_MERCHANT = 6;
export const TYPE_DRUID = 7;
export const TYPE_KNIGHT = 12;

export const TEAM_A = 0;
export const TEAM_B = 1;

export const TURRET_A_X = -37.5;
export const TURRET_B_X = 37.5;
export const TURRET_Z = 0;
export const TURRET_MAX_HP = 5000000;
export const TURRET_ATTACK_RANGE = 20;
export const TURRET_ATTACK_RANGE_SQ = TURRET_ATTACK_RANGE * TURRET_ATTACK_RANGE;
export const TURRET_DAMAGE = 5000;
export const TURRET_ATTACK_INTERVAL = 8;
export const TARGET_TURRET = -2;

export const SPAWN_A_X = -36;
export const SPAWN_B_X = 36;
export const SPAWN_SPREAD = 68;

export const BUFFER_BYTES = UNIT_COUNT * STRIDE * Float32Array.BYTES_PER_ELEMENT;

const GRID = 0.5;
const CACHE_SIZE = 4096;
const _hCacheKeys = new Int32Array(CACHE_SIZE).fill(-1);
const _hCacheVals = new Float32Array(CACHE_SIZE);

function getCacheIndex(x: number, z: number, keyOut: { key: number }): number {
    const ix = Math.round(x / GRID);
    const iz = Math.round(z / GRID);
    const key = (ix << 16) | (iz & 0xffff);
    keyOut.key = key;
    return Math.abs(key) & (CACHE_SIZE - 1);
}

function smoothstep(edge0: number, edge1: number, x: number): number {
    const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
    return t * t * (3 - 2 * t);
}

function mixVal(a: number, b: number, t: number): number {
    return a * (1.0 - t) + b * t;
}

export interface LakeDef {
    cx: number;
    cz: number;
    rx: number;
    rz: number;
    depth: number;
}

export const LAKES: LakeDef[] = [
    { cx: -68, cz: -62, rx: 22, rz: 15, depth: 1.4 },
    { cx: 68, cz: -62, rx: 20, rz: 14, depth: 1.3 },
    { cx: -68, cz: 62, rx: 19, rz: 15, depth: 1.2 },
    { cx: 68, cz: 62, rx: 22, rz: 14, depth: 1.5 },
    { cx: -88, cz: 0, rx: 14, rz: 11, depth: 1.0 },
    { cx: 88, cz: 0, rx: 14, rz: 11, depth: 1.0 },
];

export const BF_HALF_X = 42;
export const BF_HALF_Z = 38;
export const BF_BLEND = 8;

const _keyRef = { key: 0 };

export function getTerrainHeight(x: number, z: number): number {
    const idx = getCacheIndex(x, z, _keyRef);
    const key = _keyRef.key;
    if (_hCacheKeys[idx] === key) {
        return _hCacheVals[idx];
    }

    const dxEdge = Math.max(0, Math.abs(x) - BF_HALF_X);
    const dzEdge = Math.max(0, Math.abs(z) - BF_HALF_Z);
    const edgeDist = Math.sqrt(dxEdge * dxEdge + dzEdge * dzEdge);
    const forestFactor = smoothstep(0, BF_BLEND, edgeDist);

    // High mountain ridges (low frequency, high amplitude) + fine hills detail
    const mountainH = Math.sin(x * 0.015) * Math.cos(z * 0.018 + 0.3) * 22.0 + Math.cos(x * 0.04) * Math.sin(z * 0.035) * 8.0;
    const h1 = Math.sin(x * 0.12 + 0.5) * Math.cos(z * 0.12) * 3.5;
    const h2 = Math.sin(x * 0.28) * Math.sin(z * 0.22 + 1.2) * 1.2;
    
    // Winding River Bed: a sine curve winding across the terrain
    const riverPath = Math.sin(x * 0.02) * 45; // amplitude of wind
    const riverDist = Math.abs(z - riverPath);
    let riverDepth = 0;
    if (riverDist < 18) {
        // carve a deep river channel
        const rT = 1.0 - (riverDist / 18); // 0 at edges, 1 at river center
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
    const result = forestTerrain * forestFactor;

    _hCacheKeys[idx] = key;
    _hCacheVals[idx] = result;
    return result;
}

export function invalidateTerrainCache(): void {
    _hCacheKeys.fill(-1);
    _hCacheVals.fill(0);
}

export const HERO_UNIT_INDEX = 0;
