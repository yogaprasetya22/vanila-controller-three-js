import * as THREE from "three";
import {
    getTerrainHeight,
    LAKES,
    BF_HALF_X,
    BF_HALF_Z,
    BF_BLEND,
} from "../../simulation/constants";

function smoothstep(e0: number, e1: number, x: number): number {
    const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
}

// How deep a point is inside a lake (0 = outside, 1 = deepest center)
function lakeWetness(x: number, z: number): number {
    let maxWet = 0;
    for (const lake of LAKES) {
        const dx = (x - lake.cx) / lake.rx;
        const dz = (z - lake.cz) / lake.rz;
        const distSq = dx * dx + dz * dz;
        const wet = Math.exp(-distSq * 0.5);
        if (wet > maxWet) maxWet = wet;
    }
    return maxWet;
}

export class Floor {
    mesh: THREE.Mesh;

    constructor(scene: THREE.Scene) {
        // ponytail: expanded from 240x180 to 900x900 to give an endless MMORPG landscape feel
        const groundGeo = new THREE.PlaneGeometry(900, 900, 300, 300);
        const groundPos = groundGeo.attributes.position;
        const colors: number[] = [];

        const cBattleDry = new THREE.Color(0x556b2f); // Dark olive forest grass base
        const cBattleEdge = new THREE.Color(0x6b8e23); // Olive drab
        const cForest = new THREE.Color(0x228b22); // Forest green
        const cForestRock = new THREE.Color(0x555555); // Slate gray mountain peak
        const cLakeBed = new THREE.Color(0x1a332d); // Dark teal muddy bed
        const cLakeDeep = new THREE.Color(0x0e241f); // Deep abyss water color
        const cLakeShore = new THREE.Color(0x8fbc8f); // Soft sea green shore

        const work = new THREE.Color();

        for (let i = 0; i < groundPos.count; i++) {
            const vx = groundPos.getX(i);
            const vz = -groundPos.getY(i);
            const h = getTerrainHeight(vx, vz);

            groundPos.setZ(i, h);

            const dxEdge = Math.max(0, Math.abs(vx) - BF_HALF_X);
            const dzEdge = Math.max(0, Math.abs(vz) - BF_HALF_Z);
            const edgeDist = Math.sqrt(dxEdge * dxEdge + dzEdge * dzEdge);
            const forestFactor = smoothstep(0, BF_BLEND, edgeDist);

            const wetness = lakeWetness(vx, vz);

            if (wetness > 0.15) {
                if (wetness > 0.7) {
                    const t = Math.min(1, (wetness - 0.7) / 0.3);
                    work.copy(cLakeBed).lerp(cLakeDeep, t);
                } else if (wetness > 0.35) {
                    work.copy(cLakeBed);
                } else {
                    const t = (wetness - 0.15) / 0.2;
                    work.copy(cLakeShore).lerp(cLakeBed, t);
                }
            } else if (forestFactor < 0.1) {
                work.copy(cBattleDry);
            } else if (forestFactor < 0.35) {
                const t = (forestFactor - 0.1) / 0.25;
                work.copy(cBattleEdge).lerp(cForest, t);
            } else {
                // ponytail: increased H thresholds from (1.5, 3.5) to (6.0, 18.0) to match high mountain scales
                const steepT = smoothstep(6.0, 18.0, h);
                work.copy(cForest).lerp(cForestRock, steepT);
            }

            colors.push(work.r, work.g, work.b);
        }

        groundGeo.setAttribute(
            "color",
            new THREE.Float32BufferAttribute(colors, 3),
        );
        groundGeo.computeVertexNormals();

        this.mesh = new THREE.Mesh(
            groundGeo,
            new THREE.MeshStandardMaterial({
                vertexColors: true,
                roughness: 0.9,
                metalness: 0.03,
            }),
        );
        this.mesh.name = "terrain";
        this.mesh.userData.excludeOcclusion = true;
        this.mesh.rotation.x = -Math.PI / 2;
        scene.add(this.mesh);
    }
}
