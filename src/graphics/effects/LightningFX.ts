import * as THREE from "three";
import { camera } from "../core/scene";
import { activeFX } from "./FXCore";

// ponytail: Use THREE.Line (no cylinder GC) + a single ShaderMaterial shared
// per call. Rewrite is deliberately minimal: 0 new geometries per-update,
// no mat.dispose races, no meshes.forEach per frame.
// Ceiling: no fractal rebake, branch flicker is opacity-only not shape. Upgrade: pre-built jagged VBO.

function buildJaggedLine(
    from: THREE.Vector3,
    to: THREE.Vector3,
    segments: number,
    jitter: number,
): THREE.Vector3[] {
    const pts: THREE.Vector3[] = [from.clone()];
    for (let s = 1; s < segments; s++) {
        const t = s / segments;
        const x = from.x + (to.x - from.x) * t + (Math.random() - 0.5) * jitter;
        const y = from.y + (to.y - from.y) * t + (Math.random() - 0.5) * jitter * 0.5;
        const z = from.z + (to.z - from.z) * t + (Math.random() - 0.5) * jitter;
        pts.push(new THREE.Vector3(x, y, z));
    }
    pts.push(to.clone());
    return pts;
}

export function spawnLightningFX(
    scene: THREE.Scene,
    points: THREE.Vector3[],
    team?: number,
    scale = 1,
): void {
    if (points.length < 2) return;

    const SEGMENTS = 10;
    const isBlue = team === 1;
    const lineColor = isBlue ? 0x44ddff : 0xffaa44;
    const coreColor = isBlue ? 0xffffff : 0xffffff;

    const from = points[0].clone(); from.y += 1.0;
    const to   = points[points.length - 1].clone(); to.y += 1.0;

    // ── Outer glow line ──
    const outerMat = new THREE.LineBasicMaterial({
        color: lineColor,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        linewidth: 1, // ponytail: linewidth >1 ignored outside WebGL1 — acceptable
    });
    const outerGeo = new THREE.BufferGeometry().setFromPoints(buildJaggedLine(from, to, SEGMENTS, 0.7 * scale));
    const outerLine = new THREE.Line(outerGeo, outerMat);
    outerLine.frustumCulled = false;
    scene.add(outerLine);

    // ── Core bright line ──
    const coreMat = new THREE.LineBasicMaterial({
        color: coreColor,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
    });
    const coreGeo = new THREE.BufferGeometry().setFromPoints(buildJaggedLine(from, to, SEGMENTS, 0.3 * scale));
    const coreLine = new THREE.Line(coreGeo, coreMat);
    coreLine.frustumCulled = false;
    scene.add(coreLine);

    let age = 0;
    const duration = 0.28;

    activeFX.push({
        update(delta: number) {
            age += delta;
            const t = Math.min(1, age / duration);
            if (t >= 1) {
                scene.remove(outerLine); scene.remove(coreLine);
                outerGeo.dispose(); coreGeo.dispose();
                outerMat.dispose(); coreMat.dispose();
                return false;
            }
            // Rapid flicker via opacity — no geometry rebuild needed
            const flicker = Math.random() > 0.3 ? 1.0 : 0.1;
            const alpha = (1.0 - t) * flicker;
            outerMat.opacity = alpha * 0.75;
            coreMat.opacity  = alpha;
            return true;
        },
    });
}
