/**
 * FXQuarksHelpers.ts — Shared bezier/curve/color helpers extracted from
 * auto-generated *Native.ts files. Eliminates ~50 lines of duplication
 * per generated VFX class.
 *
 * Used by: quarks-to-native.mjs converter output.
 */

export interface PiecewiseCurve {
    start: number;
    end: number;
    p0: number;
    p1: number;
    p2: number;
    p3: number;
}

export interface ColorKey {
    value: { r: number; g: number; b: number };
    pos: number;
}

export interface AlphaKey {
    value: number;
    pos: number;
}

export function bezier3(
    p0: number,
    p1: number,
    p2: number,
    p3: number,
    t: number,
): number {
    const u = 1 - t;
    return (
        u * u * u * p0 +
        3 * u * u * t * p1 +
        3 * u * t * t * p2 +
        t * t * t * p3
    );
}

export function evalPiecewise(curves: PiecewiseCurve[], t: number): number {
    if (curves.length === 0) return 0;
    for (let i = 0; i < curves.length; i++) {
        const c = curves[i];
        if (t >= c.start && t <= c.end) {
            const nt =
                c.end === c.start ? 0 : (t - c.start) / (c.end - c.start);
            return bezier3(c.p0, c.p1, c.p2, c.p3, nt);
        }
    }
    if (t < curves[0].start)
        return bezier3(
            curves[0].p0,
            curves[0].p1,
            curves[0].p2,
            curves[0].p3,
            0,
        );
    const last = curves[curves.length - 1];
    return bezier3(last.p0, last.p1, last.p2, last.p3, 1.0);
}

export function evalAlpha(keys: AlphaKey[], t: number): number {
    for (let i = 0; i < keys.length - 1; i++) {
        if (t <= keys[i + 1].pos) {
            const lt = (t - keys[i].pos) / (keys[i + 1].pos - keys[i].pos);
            return keys[i].value + lt * (keys[i + 1].value - keys[i].value);
        }
    }
    return keys[keys.length - 1].value;
}

export function evalColor(
    keys: ColorKey[],
    t: number,
): { r: number; g: number; b: number } {
    for (let i = 0; i < keys.length - 1; i++) {
        if (t <= keys[i + 1].pos) {
            const lt = (t - keys[i].pos) / (keys[i + 1].pos - keys[i].pos);
            return {
                r:
                    keys[i].value.r +
                    lt * (keys[i + 1].value.r - keys[i].value.r),
                g:
                    keys[i].value.g +
                    lt * (keys[i + 1].value.g - keys[i].value.g),
                b:
                    keys[i].value.b +
                    lt * (keys[i + 1].value.b - keys[i].value.b),
            };
        }
    }
    return keys[keys.length - 1].value;
}

// ponytail: out-param variant avoids {r,g,b} heap alloc per particle per frame.
// Use when updating InstancedMesh color buffers in hot loops (60fps, many particles).
export function evalColorOut(
    keys: ColorKey[],
    t: number,
    out: { r: number; g: number; b: number },
): void {
    for (let i = 0; i < keys.length - 1; i++) {
        if (t <= keys[i + 1].pos) {
            const lt = (t - keys[i].pos) / (keys[i + 1].pos - keys[i].pos);
            out.r =
                keys[i].value.r + lt * (keys[i + 1].value.r - keys[i].value.r);
            out.g =
                keys[i].value.g + lt * (keys[i + 1].value.g - keys[i].value.g);
            out.b =
                keys[i].value.b + lt * (keys[i + 1].value.b - keys[i].value.b);
            return;
        }
    }
    const last = keys[keys.length - 1].value;
    out.r = last.r;
    out.g = last.g;
    out.b = last.b;
}

export function rng(a: number, b: number): number {
    return a + Math.random() * (b - a);
}
