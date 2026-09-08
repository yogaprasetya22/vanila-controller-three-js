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
    { cx: -136, cz: -124, rx: 18, rz: 13, depth: 1.4 },
    { cx: 136,  cz: -124, rx: 17, rz: 12, depth: 1.3 },
    { cx: -136, cz: 124,  rx: 16, rz: 13, depth: 1.2 },
    { cx: 136,  cz: 124,  rx: 18, rz: 12, depth: 1.5 },
    { cx: -176, cz: 0,    rx: 12, rz: 10, depth: 1.0 },
    { cx: 176,  cz: 0,    rx: 12, rz: 10, depth: 1.0 },
    { cx: 0,    cz: -148, rx: 11, rz: 8,  depth: 1.1 },
    { cx: 0,    cz: 148,  rx: 11, rz: 8,  depth: 1.2 },
];

export const BF_HALF_X = 84;
export const BF_HALF_Z = 76;
export const BF_BLEND = 14;

// ponytail: Pure analytical math calculation (continuous floating-point, zero grid stepping, zero cache collision artifacts).
export function getTerrainHeight(x: number, z: number): number {
    const dxEdge = Math.max(0, Math.abs(x) - BF_HALF_X);
    const dzEdge = Math.max(0, Math.abs(z) - BF_HALF_Z);
    if (dxEdge === 0 && dzEdge === 0) {
        return 0.0; // Flat battlefield center
    }

    const edgeDist = Math.sqrt(dxEdge * dxEdge + dzEdge * dzEdge);
    const forestFactor = smoothstep(0, BF_BLEND, edgeDist);

    // Primary smooth flowing mountain ridges
    const mountainH = Math.sin(x * 0.010) * Math.cos(z * 0.012 + 0.3) * 32.0 +
                      Math.cos(x * 0.025) * Math.sin(z * 0.022) * 14.0;

    // Secondary smooth hill harmonics
    const h1 = Math.sin(x * 0.12 + 0.5) * Math.cos(z * 0.12) * 3.0;
    const h2 = Math.sin(x * 0.28) * Math.sin(z * 0.22 + 1.2) * 1.0;
    const h3 = Math.sin(x * 0.06 + 1.1) * Math.cos(z * 0.055 + 0.8) * 7.5;
    const h4 = Math.cos(x * 0.09) * Math.sin(z * 0.075 + 2.0) * 4.5;

    // Winding River Bed: wider and deeper for 2x map
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

export function invalidateTerrainCache(): void {
    // No-op kept for backwards-compatibility with tests/callers
}

export const HERO_UNIT_INDEX = 0;
