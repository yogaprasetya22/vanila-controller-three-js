import * as THREE from 'three';
// ponytail: dedicated white light on layer 1 — minimap always bright, zero per-frame overhead.
// Ceiling: swap to a DirectionalLight if shadows are needed on minimap.

// ponytail: wall-clock throttle gives consistent frame budget. Frame-count throttle
// causes heavy frames to cluster (frame 6 = render+readback = double cost), making
// FPS uneven. Ceiling: drop intervals to 50/100 if minimap needs to feel snappier.
const RENDER_MS   = 66;  // ~15fps GPU render
const READBACK_MS = 150; // ~6fps CPU readback (the costly op)

const SIZE = 128; // 128px: ~60% less readback cost vs 200px. Ceiling: bump to 200 if blurry.

export class Minimap {
  public static camera: THREE.OrthographicCamera;
  private static canvas2D: HTMLCanvasElement | null = null;
  private static ctx2D: CanvasRenderingContext2D | null = null;
  private static coordsEl: HTMLDivElement | null = null;
  private static renderTarget: THREE.WebGLRenderTarget;
  private static pixelBuffer: Uint8Array;
  private static clampedBuffer: Uint8ClampedArray;
  private static imageData: ImageData;
  private static lastRenderMs = 0;
  private static lastReadbackMs = 0;
  private static coordsText = '';
  static _minimapLight: THREE.AmbientLight;

  public static attachLight(scene: THREE.Scene) {
    scene.add(this._minimapLight);
  }

  public static init() {
    this.camera = new THREE.OrthographicCamera(-85, 85, 85, -85, 1, 1000);
    this.camera.position.set(0, 150, 0);
    this.camera.rotation.x = -Math.PI / 2;
    this.camera.layers.set(1);

    this.renderTarget = new THREE.WebGLRenderTarget(SIZE, SIZE, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
    });
    this.pixelBuffer = new Uint8Array(SIZE * SIZE * 4);
    this.clampedBuffer = new Uint8ClampedArray(SIZE * SIZE * 4);
    this.imageData = new ImageData(this.clampedBuffer as any, SIZE, SIZE);

    // White ambient only on layer 1 — minimap camera sees this, main camera doesn't
    const minimapLight = new THREE.AmbientLight(0xffffff, 2.0);
    minimapLight.layers.set(1);
    // scene not available here; attached externally via Minimap.attachLight(scene)
    Minimap._minimapLight = minimapLight;

    this.canvas2D = document.createElement('canvas');
    this.canvas2D.id = 'minimap-canvas-2d';
    this.canvas2D.width = SIZE;
    this.canvas2D.height = SIZE;
    this.canvas2D.style.cssText = `
      position: absolute;
      top: 20px;
      right: 20px;
      width: 200px;
      height: 200px;
      border-radius: 50%;
      border: 2.5px solid rgba(255, 255, 255, 0.45);
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
      pointer-events: none;
      z-index: 9998;
    `;
    document.body.appendChild(this.canvas2D);
    this.ctx2D = this.canvas2D.getContext('2d');

    this.coordsEl = document.createElement('div');
    this.coordsEl.id = 'minimap-coords';
    this.coordsEl.style.cssText = `
      position: absolute;
      top: 232px;
      right: 70px;
      background: rgba(18, 18, 20, 0.85);
      border: 1px solid rgba(255, 255, 255, 0.15);
      border-radius: 4px;
      padding: 2px 8px;
      font-family: monospace;
      font-size: 11px;
      color: #00ffaa;
      text-shadow: 0 1px 2px rgba(0,0,0,0.8);
      font-weight: bold;
      pointer-events: none;
      white-space: nowrap;
      box-shadow: 0 4px 6px rgba(0,0,0,0.3);
      z-index: 9999;
    `;
    this.coordsEl.innerText = 'X: 0.0 | Z: 0.0';
    document.body.appendChild(this.coordsEl);
  }

  public static render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, playerPos: THREE.Vector3 | null) {
    if (!playerPos) return;

    const now = performance.now();
    const doRender   = (now - this.lastRenderMs)   >= RENDER_MS;
    const doReadback = (now - this.lastReadbackMs) >= READBACK_MS;

    if (doRender) {
      this.lastRenderMs = now;
      this.camera.position.set(playerPos.x, 150, playerPos.z);

      const savedFog = scene.fog;
      const savedBg  = scene.background;
      scene.fog = null;
      scene.background = null;

      const prevTarget = renderer.getRenderTarget();
      renderer.setRenderTarget(this.renderTarget);
      renderer.clear();
      renderer.render(scene, this.camera);
      renderer.setRenderTarget(prevTarget);

      scene.fog = savedFog;
      scene.background = savedBg;
    }

    // GPU→CPU readback — only when both due and render already ran at least once
    if (doReadback && this.lastRenderMs > 0 && this.ctx2D) {
      this.lastReadbackMs = now;
      renderer.readRenderTargetPixels(this.renderTarget, 0, 0, SIZE, SIZE, this.pixelBuffer);

      // Flip Y: OpenGL bottom-left origin → canvas top-left
      const rowBytes = SIZE * 4;
      for (let y = 0; y < SIZE; y++) {
        const src = (SIZE - 1 - y) * rowBytes;
        this.clampedBuffer.set(this.pixelBuffer.subarray(src, src + rowBytes), y * rowBytes);
      }

      this.ctx2D.putImageData(this.imageData, 0, 0);
    }

    // Coords: skip DOM write if unchanged
    if (this.coordsEl) {
      const text = `X: ${playerPos.x.toFixed(1)} | Z: ${playerPos.z.toFixed(1)}`;
      if (text !== this.coordsText) {
        this.coordsText = text;
        this.coordsEl.innerText = text;
      }
    }
  }
}
