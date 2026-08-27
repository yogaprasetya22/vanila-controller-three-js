import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { getTerrainHeight, TURRET_MAX_HP, TURRET_A_X, TURRET_B_X, TURRET_Z, TURRET_ATTACK_RANGE } from '../../simulation/constants';

function formatHp(hp: number): string {
  if (hp >= 1000000) {
    const mVal = hp / 1000000;
    return mVal.toFixed(mVal % 1 === 0 ? 0 : 1) + "M";
  }
  if (hp >= 1000) {
    const kVal = hp / 1000;
    return kVal.toFixed(kVal % 1 === 0 ? 0 : 1) + "K";
  }
  return hp.toString();
}

function createTerrainFollowingRingGeometry(
  centerX: number,
  centerZ: number,
  innerRadius: number,
  outerRadius: number,
  segments: number
): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  const vertices: number[] = [];
  const indices: number[] = [];

  for (let j = 0; j <= segments; j++) {
    const theta = (j / segments) * Math.PI * 2;
    const cos = Math.cos(theta);
    const sin = Math.sin(theta);

    const ix = centerX + cos * innerRadius;
    const iz = centerZ + sin * innerRadius;
    const iy = getTerrainHeight(ix, iz) + 0.05;

    const ox = centerX + cos * outerRadius;
    const oz = centerZ + sin * outerRadius;
    const oy = getTerrainHeight(ox, oz) + 0.05;

    // Relative to the mesh position (centerX, 0, centerZ)
    vertices.push(ix - centerX, iy, iz - centerZ);
    vertices.push(ox - centerX, oy, oz - centerZ);
  }

  for (let j = 0; j < segments; j++) {
    const curr = j * 2;
    const next = (j + 1) * 2;

    // Triangle 1: inner_curr, outer_curr, inner_next
    indices.push(curr, curr + 1, next);
    // Triangle 2: outer_curr, outer_next, inner_next
    indices.push(curr + 1, next + 1, next);
  }

  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

export class Turrets {
  turretA: THREE.Group | null = null;
  turretB: THREE.Group | null = null;

  hpA = TURRET_MAX_HP;
  hpB = TURRET_MAX_HP;

  // Visual lerped HP values to show delayed damage reduction
  private visualHpA = TURRET_MAX_HP;
  private visualHpB = TURRET_MAX_HP;

  // Visual recoil values (1.0 = max recoil, decays to 0)
  private recoilA = 0;
  private recoilB = 0;

  // Targeting positions for turrets to look at
  private targetPosA = new THREE.Vector3(30, 0, 0);
  private targetPosB = new THREE.Vector3(-30, 0, 0);

  // 3D sprites for health bars
  private spriteA!: THREE.Sprite;
  private spriteB!: THREE.Sprite;
  private canvasA!: HTMLCanvasElement;
  private canvasB!: HTMLCanvasElement;
  private textureA!: THREE.CanvasTexture;
  private textureB!: THREE.CanvasTexture;

  // Range indicators
  private rangeRingA!: THREE.Mesh;
  private rangeRingB!: THREE.Mesh;

  private scene: THREE.Scene;

  constructor(scene: THREE.Scene, gltfLoader: GLTFLoader) {
    this.scene = scene;
    const baseUrl = import.meta.env.BASE_URL;

    this.createHpSprites();
    this.createRangeRings();

    // Load Turret A
    gltfLoader.load(`${baseUrl}turrets/Turret(Tower_Defens)-0.glb`, (gltf) => {
      this.turretA = gltf.scene;
      
      // Calculate local bounding box to center children horizontally
      const localBox = new THREE.Box3().setFromObject(this.turretA);
      const localCenter = new THREE.Vector3();
      localBox.getCenter(localCenter);

      // Offset children so that the visual center is exactly at (0, y, 0) - only X and Z
      const horizontalOffset = new THREE.Vector3(localCenter.x, 0, localCenter.z);
      this.turretA.children.forEach((child) => {
        child.position.sub(horizontalOffset);
      });

      // Now set actual world transforms
      this.turretA.position.set(TURRET_A_X, getTerrainHeight(TURRET_A_X, TURRET_Z) - 0.2, TURRET_Z);
      this.turretA.scale.setScalar(1.6);
      this.turretA.rotation.y = Math.PI / 2;
      this.turretA.updateMatrixWorld(true);

      // Position sprite exactly at parent's origin horizontally (0, 0) and at local height 2.8
      this.spriteA.position.set(0, 2.8, 0);
      this.turretA.add(this.spriteA);

      scene.add(this.turretA);
    });

    // Load Turret B
    gltfLoader.load(`${baseUrl}models/turrets/Turret(Tower_Defens)-8.glb`, (gltf) => {
      this.turretB = gltf.scene;

      // Calculate local bounding box to center children horizontally
      const localBox = new THREE.Box3().setFromObject(this.turretB);
      const localCenter = new THREE.Vector3();
      localBox.getCenter(localCenter);

      // Offset children so that the visual center is exactly at (0, y, 0) - only X and Z
      const horizontalOffset = new THREE.Vector3(localCenter.x, 0, localCenter.z);
      this.turretB.children.forEach((child) => {
        child.position.sub(horizontalOffset);
      });

      // Now set actual world transforms
      this.turretB.position.set(TURRET_B_X, getTerrainHeight(TURRET_B_X, TURRET_Z) - 0.2, TURRET_Z);
      this.turretB.scale.setScalar(1.6);
      this.turretB.rotation.y = -Math.PI / 2;
      this.turretB.updateMatrixWorld(true);

      // Position sprite exactly at parent's origin horizontally (0, 0) and at local height 2.8
      this.spriteB.position.set(0, 2.8, 0);
      this.turretB.add(this.spriteB);

      scene.add(this.turretB);
    });
  }

  private createHpSprites() {
    this.canvasA = document.createElement('canvas');
    this.canvasA.width = 256;
    this.canvasA.height = 64;
    this.drawHpCanvas(this.canvasA, this.hpA, this.visualHpA, "TURRET TIM A");
    this.textureA = new THREE.CanvasTexture(this.canvasA);
    const matA = new THREE.SpriteMaterial({ map: this.textureA, depthTest: true, depthWrite: false });
    this.spriteA = new THREE.Sprite(matA);
    this.spriteA.scale.set(3.0, 0.75, 1.0);
    this.spriteA.renderOrder = 999;

    this.canvasB = document.createElement('canvas');
    this.canvasB.width = 256;
    this.canvasB.height = 64;
    this.drawHpCanvas(this.canvasB, this.hpB, this.visualHpB, "TURRET TIM B");
    this.textureB = new THREE.CanvasTexture(this.canvasB);
    const matB = new THREE.SpriteMaterial({ map: this.textureB, depthTest: true, depthWrite: false });
    this.spriteB = new THREE.Sprite(matB);
    this.spriteB.scale.set(3.0, 0.75, 1.0);
    this.spriteB.renderOrder = 999;
  }

  private createRangeRings() {
    // Range Ring A (Tim A - Neon Green)
    const rangeGeoA = createTerrainFollowingRingGeometry(TURRET_A_X, TURRET_Z, TURRET_ATTACK_RANGE - 0.2, TURRET_ATTACK_RANGE, 64);
    const rangeMatA = new THREE.MeshBasicMaterial({
      color: 0x33ff66,
      transparent: true,
      opacity: 0.15,
      side: THREE.DoubleSide,
      depthWrite: false
    });
    this.rangeRingA = new THREE.Mesh(rangeGeoA, rangeMatA);
    this.rangeRingA.position.set(TURRET_A_X, 0, TURRET_Z);
    this.scene.add(this.rangeRingA);

    // Range Ring B (Tim B - Neon Pink)
    const rangeGeoB = createTerrainFollowingRingGeometry(TURRET_B_X, TURRET_Z, TURRET_ATTACK_RANGE - 0.2, TURRET_ATTACK_RANGE, 64);
    const rangeMatB = new THREE.MeshBasicMaterial({
      color: 0xff11bb,
      transparent: true,
      opacity: 0.15,
      side: THREE.DoubleSide,
      depthWrite: false
    });
    this.rangeRingB = new THREE.Mesh(rangeGeoB, rangeMatB);
    this.rangeRingB.position.set(TURRET_B_X, 0, TURRET_Z);
    this.scene.add(this.rangeRingB);
  }

  private drawHpCanvas(canvas: HTMLCanvasElement, hp: number, visualHp: number, label: string) {
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw background (dark gray)
    ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
    ctx.beginPath();
    ctx.roundRect(10, 40, 236, 20, 10);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // 1. Draw delayed red damage bar first (using visualHp)
    const delayedWidth = Math.max(0, (visualHp / TURRET_MAX_HP) * 232);
    if (delayedWidth > 0) {
      ctx.fillStyle = '#ff3300'; // Red highlight color
      ctx.beginPath();
      ctx.roundRect(12, 42, delayedWidth, 16, 8);
      ctx.fill();
    }

    // 2. Draw actual HP green/pink bar on top
    const fillWidth = Math.max(0, (hp / TURRET_MAX_HP) * 232);
    if (fillWidth > 0) {
      ctx.fillStyle = label.includes("TIM A") ? '#33ff66' : '#ff11bb';
      ctx.beginPath();
      ctx.roundRect(12, 42, fillWidth, 16, 8);
      ctx.fill();
    }

    // Draw text above the bar (Title only, e.g., "TURRET TIM A")
    ctx.font = 'bold 20px monospace';
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 4;
    ctx.strokeText(label, 128, 20);
    ctx.fillText(label, 128, 20);

    // Draw HP values inside the bar (centered at Y=50)
    const hpText = `${formatHp(hp)} / ${formatHp(TURRET_MAX_HP)}`;
    ctx.font = 'bold 12px monospace';
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 3;
    ctx.strokeText(hpText, 128, 50);
    ctx.fillText(hpText, 128, 50);
  }

  public shoot(team: number, tx: number, ty: number, tz: number) {
    if (team === 0) {
      this.targetPosA.set(tx, ty, tz);
      this.recoilA = 1.0;
      if (this.turretA) {
        const dir = new THREE.Vector3().subVectors(this.targetPosA, this.turretA.position);
        dir.y = 0;
        if (dir.lengthSq() > 0.01) {
          this.turretA.rotation.y = Math.atan2(dir.x, dir.z);
        }
      }
    } else {
      this.targetPosB.set(tx, ty, tz);
      this.recoilB = 1.0;
      if (this.turretB) {
        const dir = new THREE.Vector3().subVectors(this.targetPosB, this.turretB.position);
        dir.y = 0;
        if (dir.lengthSq() > 0.01) {
          this.turretB.rotation.y = Math.atan2(dir.x, dir.z);
        }
      }
    }
  }

  public getMuzzlePosition(team: number): THREE.Vector3 | null {
    const turret = team === 0 ? this.turretA : this.turretB;
    if (!turret) return null;
    turret.updateMatrixWorld(true);
    // Local muzzle position: X=0 (center), Y=1.44 (height of barrel), Z=2.6 (forward along the barrel)
    const localMuzzle = new THREE.Vector3(0, 1.44, 1.2);
    return localMuzzle.applyMatrix4(turret.matrixWorld);
  }

  public takeDamage(team: 0 | 1, damage: number): boolean {
    if (team === 0) {
      this.hpA = Math.max(0, this.hpA - damage);
      this.drawHpCanvas(this.canvasA, this.hpA, this.visualHpA, "TURRET TIM A");
      this.textureA.needsUpdate = true;
      if (this.hpA <= 0 && this.turretA) {
        this.scene.remove(this.turretA);
        this.scene.remove(this.rangeRingA);
        return true;
      }
    } else {
      this.hpB = Math.max(0, this.hpB - damage);
      this.drawHpCanvas(this.canvasB, this.hpB, this.visualHpB, "TURRET TIM B");
      this.textureB.needsUpdate = true;
      if (this.hpB <= 0 && this.turretB) {
        this.scene.remove(this.turretB);
        this.scene.remove(this.rangeRingB);
        return true;
      }
    }
    return false;
  }

  public reset() {
    this.hpA = TURRET_MAX_HP;
    this.hpB = TURRET_MAX_HP;
    this.visualHpA = TURRET_MAX_HP;
    this.visualHpB = TURRET_MAX_HP;
    this.recoilA = 0;
    this.recoilB = 0;
    this.targetPosA.set(30, 0, 0);
    this.targetPosB.set(-30, 0, 0);

    this.drawHpCanvas(this.canvasA, this.hpA, this.visualHpA, "TURRET TIM A");
    this.textureA.needsUpdate = true;
    this.drawHpCanvas(this.canvasB, this.hpB, this.visualHpB, "TURRET TIM B");
    this.textureB.needsUpdate = true;

    // Re-add turret models if reset
    if (this.turretA && !this.turretA.parent && this.scene) {
      this.scene.add(this.turretA);
    }
    if (this.turretB && !this.turretB.parent && this.scene) {
      this.scene.add(this.turretB);
    }

    // Re-add range indicators if reset
    if (this.rangeRingA && !this.rangeRingA.parent && this.scene) {
      this.scene.add(this.rangeRingA);
    }
    if (this.rangeRingB && !this.rangeRingB.parent && this.scene) {
      this.scene.add(this.rangeRingB);
    }
  }

  public update(camera: THREE.Camera, delta: number = 0.016) {
    const dir = new THREE.Vector3();

    // Decay recoil values
    if (this.recoilA > 0) this.recoilA = Math.max(0, this.recoilA - delta * 4.0);
    if (this.recoilB > 0) this.recoilB = Math.max(0, this.recoilB - delta * 4.0);

    // Smoothly lerp visual HP to actual HP for red delayed damage transition
    let needUpdateA = false;
    if (Math.abs(this.visualHpA - this.hpA) > 1.0) {
      this.visualHpA += (this.hpA - this.visualHpA) * Math.min(1.0, delta * 5.0); // smooth lerp
      needUpdateA = true;
    } else if (this.visualHpA !== this.hpA) {
      this.visualHpA = this.hpA;
      needUpdateA = true;
    }

    let needUpdateB = false;
    if (Math.abs(this.visualHpB - this.hpB) > 1.0) {
      this.visualHpB += (this.hpB - this.visualHpB) * Math.min(1.0, delta * 5.0);
      needUpdateB = true;
    } else if (this.visualHpB !== this.hpB) {
      this.visualHpB = this.hpB;
      needUpdateB = true;
    }

    // Redraw canvases if health levels are transitioning
    if (needUpdateA) {
      this.drawHpCanvas(this.canvasA, this.hpA, this.visualHpA, "TURRET TIM A");
      this.textureA.needsUpdate = true;
    }
    if (needUpdateB) {
      this.drawHpCanvas(this.canvasB, this.hpB, this.visualHpB, "TURRET TIM B");
      this.textureB.needsUpdate = true;
    }

    // Update Turret A (Tim A)
    if (this.turretA && this.hpA > 0) {
      const scaleVal = 1.6 * (1.0 - this.recoilA * 0.15);
      this.turretA.scale.set(scaleVal, scaleVal * (1.0 + this.recoilA * 0.1), scaleVal);

      // Rotate turret to face target (horizontal Y-rotation) - smooth lerp
      dir.subVectors(this.targetPosA, this.turretA.position);
      dir.y = 0; // rotate only on horizontal plane
      if (dir.lengthSq() > 0.01) {
        const targetAngle = Math.atan2(dir.x, dir.z);
        let diff = targetAngle - this.turretA.rotation.y;
        diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        this.turretA.rotation.y += diff * Math.min(1, delta * 3.0); // reduced speed for smoother rotation
      }
    }

    // Update Turret B (Tim B)
    if (this.turretB && this.hpB > 0) {
      const scaleVal = 1.6 * (1.0 - this.recoilB * 0.15);
      this.turretB.scale.set(scaleVal, scaleVal * (1.0 + this.recoilB * 0.1), scaleVal);

      // Rotate turret to face target (horizontal Y-rotation) - smooth lerp
      dir.subVectors(this.targetPosB, this.turretB.position);
      dir.y = 0;
      if (dir.lengthSq() > 0.01) {
        const targetAngle = Math.atan2(dir.x, dir.z);
        let diff = targetAngle - this.turretB.rotation.y;
        diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        this.turretB.rotation.y += diff * Math.min(1, delta * 3.0); // reduced speed for smoother rotation
      }
    }
  }

  public dispose() {
    if (this.textureA) this.textureA.dispose();
    if (this.textureB) this.textureB.dispose();
    if (this.spriteA) {
      this.spriteA.material.dispose();
    }
    if (this.spriteB) {
      this.spriteB.material.dispose();
    }
    if (this.rangeRingA) {
      this.rangeRingA.geometry.dispose();
      if (Array.isArray(this.rangeRingA.material)) {
        this.rangeRingA.material.forEach(m => m.dispose());
      } else {
        this.rangeRingA.material.dispose();
      }
      this.scene.remove(this.rangeRingA);
    }
    if (this.rangeRingB) {
      this.rangeRingB.geometry.dispose();
      if (Array.isArray(this.rangeRingB.material)) {
        this.rangeRingB.material.forEach(m => m.dispose());
      } else {
        this.rangeRingB.material.dispose();
      }
      this.scene.remove(this.rangeRingB);
    }
  }
}
