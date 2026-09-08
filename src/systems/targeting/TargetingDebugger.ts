import * as THREE from 'three';
import { TargetingManager } from './TargetingManager';
import { PlayerManager } from '../PlayerManager';

export class TargetingDebugger {
  private scene: THREE.Scene;
  private isEnabled: boolean;
  private debugGroup: THREE.Group | null = null;
  private entityMeshes = new Map<string, THREE.LineSegments>();
  private aimLines: THREE.Line[] = [];

  private cylinderGeo = new THREE.CylinderGeometry(1, 1, 1, 16, 1, true);
  private lineGeo = new THREE.BufferGeometry();

  private playerMat = new THREE.LineBasicMaterial({
    color: 0x00ff88, // Neon green for players / bots
    transparent: true,
    opacity: 0.7,
    depthTest: false
  });

  private enemyMat = new THREE.LineBasicMaterial({
    color: 0xff0044, // Bright red for enemies / bosses
    transparent: true,
    opacity: 0.7,
    depthTest: false
  });

  private rayMat = new THREE.LineBasicMaterial({
    color: 0x00d2ff, // Cyan blue for auto-aim target rays
    transparent: true,
    opacity: 0.85,
    depthTest: false
  });

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.isEnabled = import.meta.env.VITE_DEBUG_TARGETING === 'true';

    if (this.isEnabled) {
      this.debugGroup = new THREE.Group();
      this.debugGroup.name = "targeting-debugger";
      this.debugGroup.renderOrder = 99999;
      this.scene.add(this.debugGroup);
    }
  }

  public update() {
    if (!this.isEnabled || !this.debugGroup) return;

    const allEntities = TargetingManager.getAllEntities();
    const activeIds = new Set<string>();

    for (const entity of allEntities) {
      activeIds.add(entity.id);
      let mesh = this.entityMeshes.get(entity.id);

      const r = entity.radius || 0.6;
      const h = (entity.torsoHeight ? entity.torsoHeight * 1.8 : 1.8);

      if (!mesh) {
        const wireGeo = new THREE.WireframeGeometry(this.cylinderGeo);
        const mat = entity.type === 'enemy' ? this.enemyMat : this.playerMat;
        mesh = new THREE.LineSegments(wireGeo, mat);
        this.debugGroup.add(mesh);
        this.entityMeshes.set(entity.id, mesh);
      }

      mesh.visible = entity.hp > 0;
      mesh.scale.set(r, h, r);
      mesh.position.set(entity.position.x, entity.position.y + h * 0.5, entity.position.z);
    }

    // Clean up removed entities
    for (const [id, mesh] of this.entityMeshes.entries()) {
      if (!activeIds.has(id)) {
        this.debugGroup.remove(mesh);
        mesh.geometry.dispose();
        this.entityMeshes.delete(id);
      }
    }

    // Draw Aim Target Lines for players/controllers
    let lineIdx = 0;
    for (const { controller } of PlayerManager.playersAndControllers) {
      const target = controller.getNearestTarget();
      if (target) {
        let line = this.aimLines[lineIdx];
        if (!line) {
          const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
          line = new THREE.Line(geo, this.rayMat);
          this.debugGroup.add(line);
          this.aimLines.push(line);
        }
        line.visible = true;
        const positions = line.geometry.attributes.position as THREE.BufferAttribute;
        positions.setXYZ(0, controller.position.x, controller.position.y + 1.1, controller.position.z);
        positions.setXYZ(1, target.position.x, target.position.y + 1.0, target.position.z);
        positions.needsUpdate = true;
        lineIdx++;
      }
    }

    // Hide extra lines
    for (let i = lineIdx; i < this.aimLines.length; i++) {
      this.aimLines[i].visible = false;
    }
  }

  public dispose() {
    if (this.debugGroup) {
      this.scene.remove(this.debugGroup);
      this.entityMeshes.clear();
      this.aimLines = [];
    }
  }
}
