import type { BaseEntity } from '../../entities/base/BaseEntity';
import * as THREE from 'three';

export class TargetingManager {
  private static entities = new Map<string, BaseEntity>();

  public static registerEntity(entity: BaseEntity) {
    this.entities.set(entity.id, entity);
  }

  public static unregisterEntity(id: string) {
    this.entities.delete(id);
  }

  public static getEntity(id: string): BaseEntity | undefined {
    return this.entities.get(id);
  }

  public static getAllEntities(): BaseEntity[] {
    return Array.from(this.entities.values());
  }

  /**
   * Fast Spatial Query using distance squared (no square root) to find the nearest target of a specific type.
   */
  public static getNearestTarget(
    sourcePosition: THREE.Vector3,
    targetType: 'player' | 'enemy',
    excludeId?: string
  ): BaseEntity | null {
    let nearest: BaseEntity | null = null;
    let minDistanceSq = Infinity;

    for (const entity of this.entities.values()) {
      if (entity.type !== targetType) continue;
      if (entity.hp <= 0) continue;
      if (excludeId && entity.id === excludeId) continue;

      const distSq = sourcePosition.distanceToSquared(entity.position);
      if (distSq < minDistanceSq) {
        minDistanceSq = distSq;
        nearest = entity;
      }
    }

    return nearest;
  }
}
