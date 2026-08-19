import * as THREE from 'three';
import { BatchedParticleRenderer, QuarksLoader } from 'three.quarks';
import { cartoonBlueGasExplosion } from '../quarks/CartoonBlueGasExplosion.ts';

// PONYTAIL: Simple self-contained Quarks VFX manager.
// Ceiling: Re-parses JSON on every spawn, which is robust but could have slight CPU overhead for hundreds of spawns per second.
// Upgrade path: implement a pool of pre-parsed Quarks Object3D instances.

export class QuarksVFXManager {
  private scene: THREE.Scene;
  private batchRenderer: any;
  private loader: QuarksLoader;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.batchRenderer = new BatchedParticleRenderer();
    this.scene.add(this.batchRenderer);
    
    this.loader = new QuarksLoader();
  }

  /**
   * Spawns a cartoon blue gas explosion at the target coordinates.
   * Re-parses the JSON on every call to avoid shared state bugs caused by .clone().
   */
  public spawnExplosion(x: number, y: number, z: number) {
    // Re-parse the JSON directly to get a completely fresh, independent particle system
    const explosionInstance = this.loader.parse(cartoonBlueGasExplosion as any);
    explosionInstance.position.set(x, y, z);
    explosionInstance.scale.setScalar(2.0);
    
    this.scene.add(explosionInstance);
    
    // Register all emitters under the fresh instance hierarchy
    explosionInstance.traverse((child: any) => {
      if (child.type === 'ParticleEmitter') {
        this.batchRenderer.addSystem(child.system);
        child.system.autoDestroy = true; // Auto-cleanup emitter system
      }
    });

    if (explosionInstance.type === 'ParticleEmitter') {
      this.batchRenderer.addSystem((explosionInstance as any).system);
      (explosionInstance as any).system.autoDestroy = true;
    }
  }

  /**
   * Updates the particle systems. Call this in the main requestAnimationFrame loop.
   * @param delta elapsed time in seconds
   */
  public update(delta: number) {
    this.batchRenderer.update(delta);
  }
}
