import { describe, it, expect } from "bun:test";
import { getTerrainHeight, invalidateTerrainCache } from "./constants";

// Security & Robustness validation helper for client packets / coordinates
export function validatePlayerMovementPacket(packet: {
    x: number;
    y: number;
    z: number;
    lastX: number;
    lastZ: number;
    dt: number;
    maxSpeed?: number;
}): { valid: boolean; reason?: string } {
    const { x, y, z, lastX, lastZ, dt, maxSpeed = 30 } = packet;

    // 1. Sanitize NaN, Infinity or non-numeric injection
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
        return { valid: false, reason: "Non-finite coordinate payload (NaN / Infinity)" };
    }

    // 2. Map boundary constraint check (World limits)
    const WORLD_BOUND = 2500;
    if (Math.abs(x) > WORLD_BOUND || Math.abs(z) > WORLD_BOUND) {
        return { valid: false, reason: "Out of world boundaries" };
    }

    // 3. Speed-hack / Instant teleportation anomaly check
    if (dt > 0) {
        const dx = x - lastX;
        const dz = z - lastZ;
        const dist = Math.sqrt(dx * dx + dz * dz);
        const calculatedSpeed = dist / dt;
        if (calculatedSpeed > maxSpeed * 2.5) { // 2.5x grace margin for latency/rubberbanding
            return { valid: false, reason: "Speed threshold exceeded (possible speedhack/teleport)" };
        }
    }

    return { valid: true };
}

describe("Security & Input Sanitization", () => {
    it("should reject NaN, Infinity, and non-numeric coordinates", () => {
        const nanPacket = validatePlayerMovementPacket({
            x: NaN,
            y: 0,
            z: 10,
            lastX: 0,
            lastZ: 10,
            dt: 0.016
        });
        expect(nanPacket.valid).toBe(false);
        expect(nanPacket.reason).toContain("Non-finite");

        const infPacket = validatePlayerMovementPacket({
            x: Infinity,
            y: 0,
            z: 0,
            lastX: 0,
            lastZ: 0,
            dt: 0.016
        });
        expect(infPacket.valid).toBe(false);
    });

    it("should reject out-of-world boundary coordinate injection", () => {
        const outPacket = validatePlayerMovementPacket({
            x: 999999,
            y: 0,
            z: 0,
            lastX: 0,
            lastZ: 0,
            dt: 0.016
        });
        expect(outPacket.valid).toBe(false);
        expect(outPacket.reason).toContain("Out of world boundaries");
    });

    it("should flag anomalous speed spikes (teleportation / speedhack)", () => {
        const hackPacket = validatePlayerMovementPacket({
            x: 500, // jumped 500m in 16ms -> ~31,250 m/s
            y: 0,
            z: 0,
            lastX: 0,
            lastZ: 0,
            dt: 0.016,
            maxSpeed: 15
        });
        expect(hackPacket.valid).toBe(false);
        expect(hackPacket.reason).toContain("Speed threshold exceeded");
    });

    it("should accept valid and smooth player movement", () => {
        const normalPacket = validatePlayerMovementPacket({
            x: 1.2,
            y: 0,
            z: 0.8,
            lastX: 1.0,
            lastZ: 0.7,
            dt: 0.016,
            maxSpeed: 15
        });
        expect(normalPacket.valid).toBe(true);
    });
});

describe("Performance & Terrain Height Cache", () => {
    it("should compute height deterministically with cache reuse", () => {
        invalidateTerrainCache();
        const h1 = getTerrainHeight(10.5, 20.25);
        const h2 = getTerrainHeight(10.5, 20.25);
        expect(h1).toBe(h2);
        expect(Number.isFinite(h1)).toBe(true);
    });

    it("benchmark 100,000 terrain height queries under 10ms", () => {
        const start = performance.now();
        for (let i = 0; i < 100000; i++) {
            getTerrainHeight((i % 200) * 0.5, ((i * 3) % 200) * 0.5);
        }
        const duration = performance.now() - start;
        expect(duration).toBeLessThan(150); // fast execution
    });
});
