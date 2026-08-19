import * as THREE from 'three';
import { BatchedParticleRenderer, QuarksLoader } from 'three.quarks';
import { cartoonBlueGasExplosion } from '../../../quarks/CartoonBlueGasExplosion.ts';

export class CartoonBlueGasExplosionQuarksVFX {
  private scene: THREE.Scene;
  private batchRenderer: any;
  private pool: THREE.Object3D[] = [];
  private poolIndex = 0;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.batchRenderer = new BatchedParticleRenderer();
    this.scene.add(this.batchRenderer);
    const loader = new QuarksLoader();
    // Pre-parse 15 instances to avoid runtime parsing or clone reference sharing
    for (let i = 0; i < 15; i++) {
      this.pool.push(loader.parse(cartoonBlueGasExplosion as any));
    }
  }

  public spawn(x: number, y: number, z: number) {
    const explosionInstance = this.pool[this.poolIndex];
    this.poolIndex = (this.poolIndex + 1) % this.pool.length;

    // Remove from scene if already added
    this.scene.remove(explosionInstance);

    explosionInstance.position.set(x, y, z);
    explosionInstance.scale.setScalar(2.0);
    this.scene.add(explosionInstance);
    
    explosionInstance.traverse((child: any) => {
      if (child.type === 'ParticleEmitter') {
        child.system.restart();
        this.batchRenderer.addSystem(child.system);
        child.system.autoDestroy = true;
      }
    });

    if (explosionInstance.type === 'ParticleEmitter') {
      (explosionInstance as any).system.restart();
      this.batchRenderer.addSystem((explosionInstance as any).system);
      (explosionInstance as any).system.autoDestroy = true;
    }
  }

  public update(delta: number) {
    this.batchRenderer.update(delta);
  }
}
