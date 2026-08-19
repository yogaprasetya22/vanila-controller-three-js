import * as THREE from 'three';
import { BatchedParticleRenderer, QuarksLoader } from 'three.quarks';
import { cartoonBlueFlamethrower } from '../../../quarks/CartoonBlueFlamethrower.ts';

export class CartoonBlueFlamethrowerQuarksVFX {
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
      this.pool.push(loader.parse(cartoonBlueFlamethrower as any));
    }
  }

  public spawn(x: number, y: number, z: number) {
    const flamethrowerInstance = this.pool[this.poolIndex];
    this.poolIndex = (this.poolIndex + 1) % this.pool.length;

    // Remove from scene if already added
    this.scene.remove(flamethrowerInstance);

    flamethrowerInstance.position.set(x, y, z);
    flamethrowerInstance.scale.setScalar(2.0);
    this.scene.add(flamethrowerInstance);
    
    flamethrowerInstance.traverse((child: any) => {
      if (child.type === 'ParticleEmitter') {
        child.system.restart();
        this.batchRenderer.addSystem(child.system);
        child.system.autoDestroy = true;
      }
    });

    if (flamethrowerInstance.type === 'ParticleEmitter') {
      (flamethrowerInstance as any).system.restart();
      this.batchRenderer.addSystem((flamethrowerInstance as any).system);
      (flamethrowerInstance as any).system.autoDestroy = true;
    }
  }

  public update(delta: number) {
    this.batchRenderer.update(delta);
  }
}
