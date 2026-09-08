import * as THREE from 'three';
import { NPCManager } from '../../systems/NPCManager';
import { PlayerManager } from '../../systems/PlayerManager';
import { myPlayer } from '../../network/NetworkManager';

const SIZE = 200;
const RADAR_RADIUS_WORLD = 65; // 65 meters view radius on radar
const RADAR_RADIUS_PX = SIZE / 2 - 8;
const CENTER = SIZE / 2;

export class Minimap {
  public static camera: THREE.OrthographicCamera;
  private static canvas2D: HTMLCanvasElement | null = null;
  private static ctx2D: CanvasRenderingContext2D | null = null;
  private static coordsEl: HTMLDivElement | null = null;
  private static lastDrawMs = 0;
  private static coordsText = '';
  static _minimapLight: THREE.AmbientLight;

  public static attachLight(_scene: THREE.Scene) {
    // Kept for backward compatibility
  }

  public static init() {
    this.camera = new THREE.OrthographicCamera(-85, 85, 85, -85, 1, 1000);
    this.camera.position.set(0, 150, 0);
    this.camera.rotation.x = -Math.PI / 2;
    this.camera.layers.set(1);

    this.canvas2D = document.createElement('canvas');
    this.canvas2D.id = 'minimap-canvas-2d';
    this.canvas2D.width = SIZE;
    this.canvas2D.height = SIZE;
    this.canvas2D.style.cssText = `
      position: absolute;
      top: 20px;
      right: 20px;
      width: 180px;
      height: 180px;
      border-radius: 50%;
      border: 2px solid rgba(0, 255, 200, 0.4);
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6), inset 0 0 15px rgba(0, 255, 200, 0.15);
      background: rgba(10, 14, 22, 0.75);
      backdrop-filter: blur(4px);
      pointer-events: none;
      z-index: 9998;
    `;
    document.body.appendChild(this.canvas2D);
    this.ctx2D = this.canvas2D.getContext('2d');

    this.coordsEl = document.createElement('div');
    this.coordsEl.id = 'minimap-coords';
    this.coordsEl.style.cssText = `
      position: absolute;
      top: 208px;
      right: 60px;
      background: rgba(10, 14, 22, 0.85);
      border: 1px solid rgba(0, 255, 200, 0.3);
      border-radius: 4px;
      padding: 2px 8px;
      font-family: monospace;
      font-size: 11px;
      color: #00ffcc;
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

  public static render(
    _renderer: THREE.WebGLRenderer, 
    _scene: THREE.Scene, 
    playerPos: THREE.Vector3 | null,
    playerRotY: number = 0
  ) {
    if (!playerPos || !this.ctx2D) return;

    // Coords: skip DOM write if unchanged
    if (this.coordsEl) {
      const text = `X: ${playerPos.x.toFixed(1)} | Z: ${playerPos.z.toFixed(1)}`;
      if (text !== this.coordsText) {
        this.coordsText = text;
        this.coordsEl.innerText = text;
      }
    }

    // Throttle radar redraw to ~30 FPS for minimal CPU impact
    const now = performance.now();
    if (now - this.lastDrawMs < 32) return;
    this.lastDrawMs = now;

    const ctx = this.ctx2D;
    ctx.clearRect(0, 0, SIZE, SIZE);

    // 1. Radar background circular clip
    ctx.save();
    ctx.beginPath();
    ctx.arc(CENTER, CENTER, RADAR_RADIUS_PX, 0, Math.PI * 2);
    ctx.clip();

    // 2. Radar grid circles & crosshairs
    ctx.strokeStyle = 'rgba(0, 255, 200, 0.15)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(CENTER, CENTER, RADAR_RADIUS_PX * 0.33, 0, Math.PI * 2);
    ctx.arc(CENTER, CENTER, RADAR_RADIUS_PX * 0.66, 0, Math.PI * 2);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(CENTER, 0);
    ctx.lineTo(CENTER, SIZE);
    ctx.moveTo(0, CENTER);
    ctx.lineTo(SIZE, CENTER);
    ctx.stroke();

    // 3. Cardinal Directions (N, S, E, W)
    ctx.fillStyle = 'rgba(0, 255, 200, 0.6)';
    ctx.font = 'bold 9px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('N', CENTER, 14);
    ctx.fillText('S', CENTER, SIZE - 14);
    ctx.fillText('E', SIZE - 14, CENTER);
    ctx.fillText('W', 14, CENTER);

    const scale = RADAR_RADIUS_PX / RADAR_RADIUS_WORLD;

    // 4. Remote Players (Cyan dots)
    const localId = myPlayer()?.id;
    for (const item of PlayerManager.playersAndControllers) {
      if (item.player.id === localId) continue;
      const rpos = item.controller.position;
      const dx = (rpos.x - playerPos.x) * scale;
      const dz = (rpos.z - playerPos.z) * scale;
      if (dx * dx + dz * dz > RADAR_RADIUS_PX * RADAR_RADIUS_PX) continue;

      ctx.fillStyle = '#00aaff';
      ctx.beginPath();
      ctx.arc(CENTER + dx, CENTER + dz, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // 5. Enemies & Bosses (Red / Gold dots)
    for (const ctrl of NPCManager.npcControllers.values()) {
      if (ctrl.hp <= 0) continue;
      const epos = ctrl.playerGroup.position;
      const dx = (epos.x - playerPos.x) * scale;
      const dz = (epos.z - playerPos.z) * scale;
      if (dx * dx + dz * dz > RADAR_RADIUS_PX * RADAR_RADIUS_PX) continue;

      const isBoss = ctrl.npcType === 'world_boss' || ctrl.npcType === 'raid_boss';
      if (isBoss) {
        ctx.fillStyle = '#ffaa00';
        ctx.beginPath();
        ctx.arc(CENTER + dx, CENTER + dz, 5.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1;
        ctx.stroke();
      } else {
        ctx.fillStyle = '#ff3344';
        ctx.beginPath();
        ctx.arc(CENTER + dx, CENTER + dz, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // 6. Local Player Arrow at Center
    ctx.save();
    ctx.translate(CENTER, CENTER);
    ctx.rotate(-playerRotY + Math.PI); // Orient to player view rotation
    ctx.fillStyle = '#00ffcc';
    ctx.beginPath();
    ctx.moveTo(0, -7);
    ctx.lineTo(5, 6);
    ctx.lineTo(0, 3);
    ctx.lineTo(-5, 6);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    ctx.restore();
  }
}

