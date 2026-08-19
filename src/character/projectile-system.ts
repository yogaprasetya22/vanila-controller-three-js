import * as THREE from 'three';
import { CHARACTER_CONFIG } from './character-config';

interface Projectile {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  age: number;
  maxAge: number;
  target: THREE.Object3D | null;
}

export class ProjectileSystem {
  private scene: THREE.Scene;
  private projectiles: Projectile[] = [];
  private arrowGeometry: THREE.CylinderGeometry;
  private arrowMaterial: THREE.ShaderMaterial;

  constructor(scene: THREE.Scene) {
    this.scene = scene;

    // 1. Procedural Cylinder Geometry (extremely lightweight)
    this.arrowGeometry = new THREE.CylinderGeometry(0.01, 0.04, 1.2, 8);
    this.arrowGeometry.rotateX(Math.PI / 2);

    // 2. Custom glowing GLSL ShaderMaterial (additive blended)
    this.arrowMaterial = new THREE.ShaderMaterial({
      uniforms: {
        glowColor: { value: new THREE.Color(CHARACTER_CONFIG.projectiles.glowColor) } // Vibrant Custom Energy color
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 glowColor;
        varying vec2 vUv;
        void main() {
          float sideGlow = sin(vUv.x * 3.14159);
          float tailFade = vUv.y;
          float alpha = sideGlow * tailFade;
          vec3 finalColor = mix(glowColor, vec3(1.0, 1.0, 1.0), pow(sideGlow, 4.0));
          gl_FragColor = vec4(finalColor, alpha);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide
    });
  }

  public spawn(startPosition: THREE.Vector3, direction: THREE.Vector3, speed = CHARACTER_CONFIG.projectiles.speed, target: THREE.Object3D | null = null) {
    const arrowMesh = new THREE.Mesh(this.arrowGeometry, this.arrowMaterial);
    arrowMesh.position.copy(startPosition);

    const targetLookAt = startPosition.clone().add(direction);
    arrowMesh.lookAt(targetLookAt);

    this.scene.add(arrowMesh);

    const velocity = direction.clone().normalize().multiplyScalar(speed);

    this.projectiles.push({
      mesh: arrowMesh,
      velocity: velocity,
      age: 0,
      maxAge: CHARACTER_CONFIG.projectiles.maxDistance / speed,
      target: target
    });
  }

  public update(delta: number, environmentMesh: THREE.Mesh | null, spawnVFXCallback?: (pos: THREE.Vector3) => void) {
    const gravity = new THREE.Vector3(0, -5.0, 0); // slightly floatier gravity for homing feel
    const targetPos = new THREE.Vector3();

    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.age += delta;

      // 1. Auto-Aim Homing / Target Seeking steering
      if (p.target) {
        p.target.getWorldPosition(targetPos);
        targetPos.y += 0.5; // Aim at target body center (not head-and-above)

        // Vector pointing directly from projectile to target center
        const toTarget = targetPos.clone().sub(p.mesh.position).normalize();
        const currentSpeed = p.velocity.length();
        const targetVelocity = toTarget.multiplyScalar(currentSpeed);

        // Interpolate velocity towards target direction using configured steer force
        p.velocity.lerp(targetVelocity, CHARACTER_CONFIG.projectiles.homingSteerForce * delta);
      } else {
        // Apply normal gravity drop if no active target
        p.velocity.addScaledVector(gravity, delta);
      }

      // Record old position for collision raycast
      const oldPosition = p.mesh.position.clone();

      // Move forward
      p.mesh.position.addScaledVector(p.velocity, delta);

      // Orient to follow velocity vector
      const targetLook = p.mesh.position.clone().add(p.velocity);
      p.mesh.lookAt(targetLook);

      let collided = false;

      // Collision Check against static environment BVH using Raycaster
      if (environmentMesh && environmentMesh.geometry.boundsTree) {
        const movementVec = p.mesh.position.clone().sub(oldPosition);
        const dist = movementVec.length();
        if (dist > 0.001) {
          const dir = movementVec.clone().normalize();
          const raycaster = new THREE.Raycaster(oldPosition, dir, 0, dist);
          
          const intersects = raycaster.intersectObject(environmentMesh);
          if (intersects.length > 0) {
            collided = true;
            p.mesh.position.copy(intersects[0].point);
            
            // Spawn hit impact visual
            if (spawnVFXCallback) {
              spawnVFXCallback(intersects[0].point);
            }
          }
        }
      }

      // Falls below floor fallback
      if (p.mesh.position.y < 0.1) {
        collided = true;
        p.mesh.position.y = 0.1;
        if (spawnVFXCallback) {
          spawnVFXCallback(p.mesh.position);
        }
      }

      // Cleanup if collided or aged out
      if (collided || p.age >= p.maxAge) {
        this.scene.remove(p.mesh);
        this.projectiles.splice(i, 1);
      }
    }
  }

  public dispose() {
    this.arrowGeometry.dispose();
    this.arrowMaterial.dispose();
  }
}
