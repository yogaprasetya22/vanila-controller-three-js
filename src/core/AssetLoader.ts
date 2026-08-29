import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
// @ts-ignore
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { CartoonBlueGasExplosionNativeVFX } from '../graphics/effects/CartoonBlueGasExplosionNative.ts';
import { CartoonBlueFlamethrowerNativeVFX } from '../graphics/effects/CartoonBlueFlamethrowerNative.ts';
import { Subemitter2NativeVFX } from '../graphics/effects/Subemitter2Native.ts';
import { CartoonTornadoNativeVFX } from '../graphics/effects/CartoonTornadoNative.ts';
import { BossGroundSlamFX } from '../graphics/effects/BossGroundSlamFX.ts';

export class AssetLoader {
  private static loadingOverlay: HTMLDivElement | null = null;

  public static init() {
    this.loadingOverlay = document.createElement('div');
    this.loadingOverlay.id = 'loading-overlay';
    this.loadingOverlay.style.cssText = `
      position: absolute;
      top: 0; left: 0; width: 100%; height: 100%;
      background: radial-gradient(circle at 50% 40%, #1a0505 0%, #050202 100%);
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      z-index: 100000;
      transition: opacity 0.5s ease-out;
      color: white;
      font-family: 'Outfit', sans-serif;
    `;
    this.loadingOverlay.innerHTML = `
      <div style="font-weight: 800; font-size: 22px; text-transform: uppercase; color: #ef4444; letter-spacing: 4px; text-shadow: 0 0 16px rgba(239, 68, 68, 0.7); margin-bottom: 18px; font-family: 'Press Start 2P', monospace;">Loading Game</div>
      <div style="font-size: 12px; color: rgba(255,255,255,0.6); letter-spacing: 2px; font-family: monospace; margin-bottom: 14px;" id="loading-status">Menghubungkan ke server...</div>
      <div style="width: 260px; height: 6px; background: rgba(255,255,255,0.08); border-radius: 4px; overflow: hidden; position: relative; border: 1px solid rgba(239,68,68,0.2);">
        <div id="loading-bar" style="height: 100%; width: 0%; background: linear-gradient(90deg, #b91c1c, #ef4444, #f87171); box-shadow: 0 0 12px #ef4444; border-radius: 4px; transition: width 0.25s ease-out;"></div>
      </div>
      <div id="loading-pct" style="font-size: 11px; color: rgba(255,255,255,0.35); margin-top: 8px; font-family: monospace;">0%</div>
    `;
    document.body.appendChild(this.loadingOverlay);
    this.setProgress(10, 'Memuat aset game...');
  }

  public static setProgress(pct: number, label: string) {
    const bar  = document.getElementById('loading-bar');
    const pctEl = document.getElementById('loading-pct');
    const statusEl = document.getElementById('loading-status');
    if (bar) bar.style.width = `${Math.round(pct)}%`;
    if (pctEl) pctEl.innerText = `${Math.round(pct)}%`;
    if (statusEl) statusEl.innerText = label;
  }

  public static async preloadGameAssets(renderer: THREE.WebGLRenderer, camera: THREE.Camera) {
    const assets = [
      '/character/characters/Ranger.glb',
      '/character/characters/Barbarian.glb',
      '/character/animation/Rig_Medium_General.glb',
      '/character/animation/Rig_Medium_MovementAdvanced.glb',
      '/character/animation/Rig_Medium_CombatRanged.glb',
      '/character/animation/Rig_Medium_CombatMelee.glb',
      '/character/animation/Rig_Medium_MovementBasic.glb',
      '/character/animation/Running_Forward_Flip.glb',
      '/character/weapons/bow_withString.glb',
      '/character/weapons/quiver.glb',
    ];
    const total = assets.length;
    let done = 0;

    // Parallel fetch with progress (fetches from 10% to 75% progress)
    await Promise.all(assets.map(url =>
      fetch(url)
        .then(r => r.arrayBuffer()) // force into browser cache
        .catch(() => {})
        .finally(() => {
          done++;
          this.setProgress(10 + (done / total) * 65, `Memuat aset: ${done}/${total}`);
        })
    ));

    // GPU Shader Pre-compilation / Pre-warming
    this.setProgress(80, 'Mengompilasi shader GPU...');

    const dummyScene = new THREE.Scene();
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);

    // Load models into dummy scene
    try {
      const gltfs = await Promise.all([
        loader.loadAsync('/character/characters/Ranger.glb'),
        loader.loadAsync('/character/characters/Barbarian.glb')
      ]);
      gltfs.forEach(gltf => {
        dummyScene.add(gltf.scene);
      });
    } catch (e) {
      console.warn("Shader pre-warm model load skipped:", e);
    }

    // Pre-warm active particle VFX
    const dummyGas = new CartoonBlueGasExplosionNativeVFX(dummyScene, camera);
    const dummyFlame = new CartoonBlueFlamethrowerNativeVFX(dummyScene, camera);
    const dummyTornado = new CartoonTornadoNativeVFX(dummyScene, camera);
    const dummySub = new Subemitter2NativeVFX(dummyScene, camera);

    dummyGas.spawn(0, 0, 0);
    dummyFlame.spawn(0, 0, 0);
    dummyTornado.spawn(0, 0, 0);

    // Pre-warm Boss telegraph SDF warning geometries/materials
    const dummyTelegraph = new BossGroundSlamFX(dummyScene);
    dummyTelegraph.spawn(0, 0, 8.0, 1.5, null, 0, false, 0, 0xff0000); // circle
    dummyTelegraph.spawn(0, 0, 8.0, 1.5, null, 1, false, 0, 0xff0000); // cone
    dummyTelegraph.spawn(0, 0, 8.0, 1.5, null, 2, false, 0, 0xff0000); // line
    dummyTelegraph.spawn(0, 0, 8.0, 1.5, null, 3, false, 0, 0xff0000); // ring
    dummyTelegraph.spawn(0, 0, 8.0, 1.5, null, 4, false, 0, 0xff0000); // cross

    // Force GPU driver to compile all shader code immediately
    renderer.compile(dummyScene, camera);

    // Safely dispose pre-warmed structures
    dummyScene.traverse((node) => {
      if (node instanceof THREE.Mesh) {
        if (node.geometry) node.geometry.dispose();
        if (Array.isArray(node.material)) {
          node.material.forEach(m => m.dispose());
        } else if (node.material) {
          node.material.dispose();
        }
      }
    });

    this.setProgress(90, 'Shader siap!');
  }

  public static fadeOut(callback?: () => void) {
    if (this.loadingOverlay) {
      this.loadingOverlay.style.opacity = '0';
      setTimeout(() => {
        this.loadingOverlay?.remove();
        this.loadingOverlay = null;
        if (callback) callback();
      }, 500);
    }
  }
}
