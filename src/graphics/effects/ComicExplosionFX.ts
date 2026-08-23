import * as THREE from "three";
import { activeFX } from "./FXCore";

interface ActiveExplosion {
    sprite: THREE.Sprite;
    age: number;
    active: boolean;
}

const EXPLOSION_POOL_SIZE = 24;
const activeExplosions: ActiveExplosion[] = [];
let explosionTexture: THREE.CanvasTexture | null = null;

function createExplosionSpriteSheet(): THREE.CanvasTexture {
    const canvas = document.createElement("canvas");
    canvas.width = 1024;
    canvas.height = 1024;
    const ctx = canvas.getContext("2d")!;

    const cols = 4;
    const rows = 4;
    const cellSize = 256;

    for (let frame = 0; frame < 16; frame++) {
        const col = frame % cols;
        const row = Math.floor(frame / cols);
        const x = col * cellSize + cellSize / 2;
        const y = row * cellSize + cellSize / 2;

        const progress = frame / 15; // 0 to 1

        ctx.save();
        ctx.translate(x, y);

        // Draw puff cloud (overlapping circles)
        if (progress > 0.0 && progress < 0.95) {
            const maxRadius = 80;
            const size = progress < 0.4 
                ? (progress / 0.4) * maxRadius 
                : (1.0 - (progress - 0.4) / 0.6) * maxRadius;

            ctx.fillStyle = "#ffffff";
            ctx.strokeStyle = "#1a1a1a";
            ctx.lineWidth = 10;

            ctx.beginPath();
            const numCircles = 6;
            for (let c = 0; c < numCircles; c++) {
                const angle = (c / numCircles) * Math.PI * 2;
                const dist = size * 0.45;
                const cx = Math.cos(angle) * dist;
                const cy = Math.sin(angle) * dist;
                const cr = size * 0.55;
                ctx.arc(cx, cy, cr, 0, Math.PI * 2);
            }
            ctx.closePath();
            ctx.fill();
            ctx.stroke();

            // Inner shading (light blue-ish)
            ctx.fillStyle = "#e6f7ff";
            ctx.beginPath();
            for (let c = 0; c < numCircles; c++) {
                const angle = (c / numCircles) * Math.PI * 2;
                const dist = size * 0.4;
                const cx = Math.cos(angle) * dist;
                const cy = Math.sin(angle) * dist;
                const cr = size * 0.45;
                ctx.arc(cx, cy, cr, 0, Math.PI * 2);
            }
            ctx.closePath();
            ctx.fill();
        }

        // Draw stars flying out
        if (progress > 0.1 && progress < 0.9) {
            const starProgress = (progress - 0.1) / 0.8;
            const dist = starProgress * 110;
            const starSize = starProgress < 0.5 ? 24 * (starProgress / 0.5) : 24 * (1.0 - (starProgress - 0.5) / 0.5);

            ctx.fillStyle = "#ffd700";
            ctx.strokeStyle = "#1a1a1a";
            ctx.lineWidth = 4;

            const numStars = 6;
            for (let s = 0; s < numStars; s++) {
                const angle = (s / numStars) * Math.PI * 2 + starProgress * 2.0;
                const sx = Math.cos(angle) * dist;
                const sy = Math.sin(angle) * dist;

                ctx.save();
                ctx.translate(sx, sy);
                ctx.rotate(angle);
                
                ctx.beginPath();
                for (let i = 0; i < 5; i++) {
                    ctx.lineTo(
                        Math.cos(((18 + i * 72) * Math.PI) / 180) * starSize,
                        Math.sin(((18 + i * 72) * Math.PI) / 180) * starSize
                    );
                    ctx.lineTo(
                        Math.cos(((54 + i * 72) * Math.PI) / 180) * (starSize * 0.4),
                        Math.sin(((54 + i * 72) * Math.PI) / 180) * (starSize * 0.4)
                    );
                }
                ctx.closePath();
                ctx.fill();
                ctx.stroke();
                ctx.restore();
            }
        }

        // Draw bold comic text "BANG!" in the center
        if (progress > 0.35 && progress < 0.75) {
            const textProgress = (progress - 0.35) / 0.4;
            const scaleText = textProgress < 0.2 
                ? (textProgress / 0.2) * 1.3 
                : 1.3 - (textProgress - 0.2) * 0.3;

            ctx.save();
            ctx.scale(scaleText, scaleText);

            ctx.font = "bold 42px 'Impact', sans-serif";
            const text = "BANG!";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";

            ctx.fillStyle = "#1a1a1a";
            ctx.fillText(text, 2, 6);

            ctx.strokeStyle = "#1a1a1a";
            ctx.lineWidth = 12;
            ctx.strokeText(text, 0, 0);

            ctx.fillStyle = "#ffff00";
            ctx.fillText(text, 0, 0);

            ctx.restore();
        }

        ctx.restore();
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.repeat.set(1 / cols, 1 / rows);
    return texture;
}

function initExplosionPool(scene: THREE.Scene) {
    if (explosionTexture) return;
    explosionTexture = createExplosionSpriteSheet();

    for (let i = 0; i < EXPLOSION_POOL_SIZE; i++) {
        const tex = explosionTexture.clone();
        tex.needsUpdate = true;

        const mat = new THREE.SpriteMaterial({
            map: tex,
            transparent: true,
            depthWrite: false,
        });

        const sprite = new THREE.Sprite(mat);
        sprite.scale.set(7.0, 7.0, 1.0);
        sprite.visible = false;
        sprite.renderOrder = 1000;
        scene.add(sprite);

        activeExplosions.push({
            sprite,
            age: 0,
            active: false,
        });
    }
}

export function spawnComicExplosion(scene: THREE.Scene, x: number, y: number, z: number) {
    initExplosionPool(scene);

    const exp = activeExplosions.find((e) => !e.active);
    if (!exp) return;

    exp.sprite.position.set(x, y, z);
    exp.sprite.visible = true;
    exp.age = 0;
    exp.active = true;

    const map = exp.sprite.material.map!;
    map.offset.set(0, 0.75);

    activeFX.push({
        update(delta) {
            exp.age += delta;
            const frameDelay = 0.028; // ~28ms per frame
            const frameIdx = Math.floor(exp.age / frameDelay);

            if (frameIdx >= 16) {
                exp.sprite.visible = false;
                exp.active = false;
                return false;
            }

            const col = frameIdx % 4;
            const row = Math.floor(frameIdx / 4);
            map.offset.x = col / 4;
            map.offset.y = 1.0 - (row + 1) / 4;
            return true;
        }
    });
}
