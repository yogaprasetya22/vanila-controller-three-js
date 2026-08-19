/**
 * bvh-types.d.ts — Augment THREE.BufferGeometry dengan property boundsTree dari three-mesh-bvh.
 * ponytail: declare only, tidak import runtime — tsc saja yang butuh ini.
 */
import type { MeshBVH } from 'three-mesh-bvh';
import type { BufferGeometry } from 'three';

declare module 'three' {
    interface BufferGeometry {
        boundsTree?: MeshBVH;
    }
}
