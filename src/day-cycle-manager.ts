import * as THREE from "three";

interface TimePreset {
    lightColor: THREE.Color;
    lightIntensity: number;
    shadowColor: THREE.Color;
    fogColorA: THREE.Color;
    fogColorB: THREE.Color;
    fogDensity: number;
    ambientIntensity: number;
}

const PRESETS: Record<string, TimePreset> = {
    pagi: {
        lightColor: new THREE.Color("#ffb366"),
        lightIntensity: 0.8,
        shadowColor: new THREE.Color("#6d3fff"),
        fogColorA: new THREE.Color("#ffcc99"),
        fogColorB: new THREE.Color("#99ddff"),
        fogDensity: 0.002,
        ambientIntensity: 0.5,
    },
    siang: {
        lightColor: new THREE.Color("#ffffff"),
        lightIntensity: 1.2,
        shadowColor: new THREE.Color("#4466cc"),
        fogColorA: new THREE.Color("#5f7dff"),
        fogColorB: new THREE.Color("#9b89ff"),
        fogDensity: 0.001,
        ambientIntensity: 0.8,
    },
    sore: {
        lightColor: new THREE.Color("#ff8844"),
        lightIntensity: 0.9,
        shadowColor: new THREE.Color("#db004f"),
        fogColorA: new THREE.Color("#ff7d24"),
        fogColorB: new THREE.Color("#ff4ce4"),
        fogDensity: 0.002,
        ambientIntensity: 0.6,
    },
    malam: {
        lightColor: new THREE.Color("#3366ff"),
        lightIntensity: 0.4,
        shadowColor: new THREE.Color("#2f00db"),
        fogColorA: new THREE.Color("#10266f"),
        fogColorB: new THREE.Color("#490a42"),
        fogDensity: 0.003,
        ambientIntensity: 0.3,
    },
};

export class DayCycleManager {
    private cycleDuration: number;
    private startTime: number;
    private currentProgress: number = 0;

    public lightColor: THREE.Color = new THREE.Color();
    public lightIntensity: number = 1;
    public shadowColor: THREE.Color = new THREE.Color();
    public fogColorA: THREE.Color = new THREE.Color();
    public fogColorB: THREE.Color = new THREE.Color();
    public fogDensity: number = 0.008;
    public ambientIntensity: number = 0.5;

    private directionalLight: THREE.DirectionalLight | null = null;
    private ambientLight: THREE.Light | null = null;
    private heroAmbientLight: THREE.AmbientLight | null = null;
    private scene: THREE.Scene;

    private lastUpdateTime: number = 0;

    constructor(scene: THREE.Scene, cycleDurationSeconds: number = 60) {
        this.scene = scene;
        this.cycleDuration = cycleDurationSeconds;
        this.startTime = performance.now();
        this.scene.background = new THREE.Color();

        // Dedicated hero light on Layer 1 to keep player meshes bright at night/dark periods
        this.heroAmbientLight = new THREE.AmbientLight(0xffffff, 0.7);
        this.heroAmbientLight.layers.enable(1);
        this.scene.add(this.heroAmbientLight);

        this.initializeValues();
    }

    private initializeValues() {
        const pagi = PRESETS.pagi;
        this.lightColor.copy(pagi.lightColor);
        this.lightIntensity = pagi.lightIntensity;
        this.shadowColor.copy(pagi.shadowColor);
        this.fogColorA.copy(pagi.fogColorA);
        this.fogColorB.copy(pagi.fogColorB);
        this.fogDensity = pagi.fogDensity;
        this.ambientIntensity = pagi.ambientIntensity;
    }

    public setDirectionalLight(light: THREE.DirectionalLight) {
        this.directionalLight = light;
    }

    public setAmbientLight(light: THREE.Light) {
        this.ambientLight = light;
    }

    public update() {
        const now = performance.now();
        if (now - this.lastUpdateTime < 50) {
            return;
        }
        this.lastUpdateTime = now;

        const elapsed = (now - this.startTime) / 1000;
        this.currentProgress = (elapsed / this.cycleDuration) % 1;

        const keyframes = [
            { stop: 0.0, preset: PRESETS.pagi },
            { stop: 0.25, preset: PRESETS.siang },
            { stop: 0.5, preset: PRESETS.sore },
            { stop: 0.75, preset: PRESETS.malam },
            { stop: 1.0, preset: PRESETS.pagi },
        ];

        let prevKeyframe = keyframes[0];
        let nextKeyframe = keyframes[1];

        for (let i = 0; i < keyframes.length - 1; i++) {
            if (
                this.currentProgress >= keyframes[i].stop &&
                this.currentProgress < keyframes[i + 1].stop
            ) {
                prevKeyframe = keyframes[i];
                nextKeyframe = keyframes[i + 1];
                break;
            }
        }

        const mixRatio = (this.currentProgress - prevKeyframe.stop) / (nextKeyframe.stop - prevKeyframe.stop);

        this.interpolateColor(
            this.lightColor,
            prevKeyframe.preset.lightColor,
            nextKeyframe.preset.lightColor,
            mixRatio,
        );
        this.lightIntensity = this.lerp(
            prevKeyframe.preset.lightIntensity,
            nextKeyframe.preset.lightIntensity,
            mixRatio,
        );

        this.interpolateColor(
            this.shadowColor,
            prevKeyframe.preset.shadowColor,
            nextKeyframe.preset.shadowColor,
            mixRatio,
        );

        this.interpolateColor(
            this.fogColorA,
            prevKeyframe.preset.fogColorA,
            nextKeyframe.preset.fogColorB,
            mixRatio,
        );

        this.interpolateColor(
            this.fogColorB,
            prevKeyframe.preset.fogColorB,
            nextKeyframe.preset.fogColorA,
            mixRatio,
        );

        this.fogDensity = this.lerp(
            prevKeyframe.preset.fogDensity,
            nextKeyframe.preset.fogDensity,
            mixRatio,
        );

        this.ambientIntensity = this.lerp(
            prevKeyframe.preset.ambientIntensity,
            nextKeyframe.preset.ambientIntensity,
            mixRatio,
        );

        this.applyToLights();
    }

    private applyToLights() {
        if (this.directionalLight) {
            this.directionalLight.color.copy(this.lightColor);
            this.directionalLight.intensity = this.lightIntensity;
        }

        if (this.ambientLight) {
            this.ambientLight.intensity = this.ambientIntensity;
        }

        if (this.scene.fog instanceof THREE.Fog) {
            this.scene.fog.color.lerpColors(
                this.fogColorA,
                this.fogColorB,
                0.5,
            );
            // ponytail: Tighter atmospheric horizon fog (near 80m, far 240m) tightly synced with closer 220m LOD
            const densityRatio = this.fogDensity / 0.003;
            const targetFar = 230 + (1 - densityRatio) * 20; // 230m - 250m
            this.scene.fog.near = 80;
            this.scene.fog.far = targetFar;
        }

        if (this.scene.background instanceof THREE.Color) {
            this.scene.background.lerpColors(this.fogColorA, this.fogColorB, 0.5);
        }
    }

    public getCurrentPeriod(): string {
        if (this.currentProgress < 0.25) return "Pagi";
        if (this.currentProgress < 0.5) return "Siang";
        if (this.currentProgress < 0.75) return "Sore";
        return "Malam";
    }

    private lerp(a: number, b: number, t: number): number {
        return a + (b - a) * t;
    }

    private interpolateColor(
        target: THREE.Color,
        colorA: THREE.Color,
        colorB: THREE.Color,
        t: number,
    ) {
        target.lerpColors(colorA, colorB, t);
    }
}
