import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { getTerrainHeight } from '../../simulation/constants';
import { globalWind } from './Wind';

export type WeatherType = 'fair' | 'storm';

interface CloudPuff {
  localOffset: THREE.Vector3;
  baseScale: THREE.Vector3;
  scale: THREE.Vector3;
  rotation: THREE.Quaternion;
  instanceIndex: number;
}

interface CloudCluster {
  type: WeatherType;
  center: THREE.Vector3;
  baseHeight: number;
  radius: number;
  speed: number;
  puffs: CloudPuff[];
}

interface SplashRipple {
  pos: THREE.Vector3;
  age: number;
  maxAge: number;
  scale: number;
}

export class Clouds {
  private fairMesh: THREE.InstancedMesh;
  private stormMesh: THREE.InstancedMesh;

  private clusters: CloudCluster[] = [];
  private totalFairPuffs = 0;
  private totalStormPuffs = 0;

  private worldSize = 2400; // Match the 2400x2400 world dimensions
  private halfSize = 1200;

  // Ultra-Lightweight Rain System
  private rainMesh: THREE.InstancedMesh;
  private rainCount = 350;
  private rainPositions: THREE.Vector3[] = [];
  private rainSpeeds: number[] = [];
  private isRainActive = false;

  // Ground Splash Ripple System
  private splashMesh: THREE.InstancedMesh;
  private splashCount = 90;
  private splashes: SplashRipple[] = [];

  private lastCamPos = new THREE.Vector3(9999, 9999, 9999);

  constructor(scene: THREE.Scene) {
    const cloudGeometry = createLowPolyCloudGeometry();

    // Dual materials for Fair (bright/fluffy) and Storm (dark/heavy/volumetric)
    const fairMaterial = createCartoonCloudMaterial('#ffffff', '#b5d0e8', 0.95);
    const stormMaterial = createCartoonCloudMaterial('#4e5564', '#20242e', 0.98);

    // Build 6 structured cloud clusters across the 2400x2400 map
    // 2 Storm Clusters (North-West & South-East) and 4 Fair Clusters
    const clusterConfigs: Array<{ type: WeatherType; x: number; z: number; radius: number; puffCount: number; speed: number }> = [
      { type: 'storm', x: -350, z: -400, radius: 150, puffCount: 32, speed: 1.2 },
      { type: 'storm', x: 480,  z: 360,  radius: 160, puffCount: 36, speed: 1.0 },
      { type: 'fair',  x: -550, z: 350,  radius: 130, puffCount: 26, speed: 1.8 },
      { type: 'fair',  x: 350,  z: -480, radius: 140, puffCount: 28, speed: 2.0 },
      { type: 'fair',  x: -40,  z: -200, radius: 120, puffCount: 24, speed: 2.2 },
      { type: 'fair',  x: 180,  z: 520,  radius: 150, puffCount: 30, speed: 1.6 },
    ];

    let fairIdx = 0;
    let stormIdx = 0;

    for (const conf of clusterConfigs) {
      const isStorm = conf.type === 'storm';
      const baseHeight = isStorm ? 36.0 : 42.0;
      const groundY = Math.max(getTerrainHeight(conf.x, conf.z), -3.0);
      const center = new THREE.Vector3(conf.x, groundY + baseHeight, conf.z);

      const puffs: CloudPuff[] = [];

      for (let p = 0; p < conf.puffCount; p++) {
        const angle = Math.random() * Math.PI * 2;
        const distFromCenter = Math.pow(Math.random(), 0.7) * conf.radius;
        const lx = Math.cos(angle) * distFromCenter;
        const lz = Math.sin(angle) * distFromCenter;
        const ly = (Math.random() - 0.4) * (isStorm ? 12.0 : 7.0);

        const edgeRatio = 1.0 - (distFromCenter / conf.radius);
        const sizeBase = (isStorm ? 2.8 : 2.2) + edgeRatio * 1.8 + Math.random() * 1.2;
        const scale = new THREE.Vector3(
          sizeBase * (1.6 + Math.random() * 0.4),
          sizeBase * (0.8 + Math.random() * 0.3),
          sizeBase * (1.4 + Math.random() * 0.4)
        );

        const rot = new THREE.Quaternion().setFromEuler(
          new THREE.Euler(0, Math.random() * Math.PI * 2, 0)
        );

        puffs.push({
          localOffset: new THREE.Vector3(lx, ly, lz),
          baseScale: scale.clone(),
          scale: scale.clone(),
          rotation: rot,
          instanceIndex: isStorm ? stormIdx++ : fairIdx++
        });
      }

      this.clusters.push({
        type: conf.type,
        center,
        baseHeight,
        radius: conf.radius,
        speed: conf.speed,
        puffs
      });
    }

    this.totalFairPuffs = fairIdx;
    this.totalStormPuffs = stormIdx;

    this.fairMesh = new THREE.InstancedMesh(cloudGeometry, fairMaterial, this.totalFairPuffs);
    this.fairMesh.castShadow = false;
    this.fairMesh.receiveShadow = false;
    this.fairMesh.frustumCulled = false;

    this.stormMesh = new THREE.InstancedMesh(cloudGeometry, stormMaterial, this.totalStormPuffs);
    this.stormMesh.castShadow = false;
    this.stormMesh.receiveShadow = false;
    this.stormMesh.frustumCulled = false;

    scene.add(this.fairMesh);
    scene.add(this.stormMesh);

    // ── Ultra-Thin Vertical Rain Streaks ──
    // Vertical thin ribbon quad (0.015m wide, 0.85m tall)
    const rainGeo = new THREE.PlaneGeometry(0.018, 0.9);
    // Center alignment
    rainGeo.translate(0, 0.45, 0);

    const rainMat = new THREE.MeshBasicMaterial({
      color: 0xcde5ff,
      transparent: true,
      opacity: 0.50,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false
    });

    this.rainMesh = new THREE.InstancedMesh(rainGeo, rainMat, this.rainCount);
    this.rainMesh.frustumCulled = false;
    this.rainMesh.visible = false;

    for (let i = 0; i < this.rainCount; i++) {
      this.rainPositions.push(new THREE.Vector3(0, -9999, 0));
      this.rainSpeeds.push(32.0 + Math.random() * 14.0);
    }

    scene.add(this.rainMesh);

    // ── Ground Splash Ripple System ──
    // Flat circular ring geometry on XZ plane
    const splashGeo = new THREE.RingGeometry(0.04, 0.22, 10);
    splashGeo.rotateX(-Math.PI / 2); // Lay flat on ground

    const splashMat = new THREE.MeshBasicMaterial({
      color: 0xdff0ff,
      transparent: true,
      opacity: 0.65,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false
    });

    this.splashMesh = new THREE.InstancedMesh(splashGeo, splashMat, this.splashCount);
    this.splashMesh.frustumCulled = false;
    this.splashMesh.visible = false;

    for (let i = 0; i < this.splashCount; i++) {
      this.splashes.push({
        pos: new THREE.Vector3(0, -9999, 0),
        age: 1.0,
        maxAge: 0.22 + Math.random() * 0.12,
        scale: 0.1
      });
    }

    scene.add(this.splashMesh);
  }

  public update(delta: number, camPos: THREE.Vector3) {
    const scratchMatrix = new THREE.Matrix4();
    const windX = globalWind.direction.x * globalWind.strength;
    const windZ = globalWind.direction.y * globalWind.strength;

    let nearestStormDist = 99999;
    let activeStormCluster: CloudCluster | null = null;

    for (const cluster of this.clusters) {
      // Drift cluster along wind direction
      cluster.center.x += windX * cluster.speed * delta * 4;
      cluster.center.z += windZ * cluster.speed * delta * 4;

      // Wrap around world bounds seamlessly
      if (cluster.center.x > this.halfSize) {
        cluster.center.x = -this.halfSize;
        cluster.center.z = (Math.random() - 0.5) * this.worldSize;
      } else if (cluster.center.x < -this.halfSize) {
        cluster.center.x = this.halfSize;
        cluster.center.z = (Math.random() - 0.5) * this.worldSize;
      }

      if (cluster.center.z > this.halfSize) {
        cluster.center.z = -this.halfSize;
        cluster.center.x = (Math.random() - 0.5) * this.worldSize;
      } else if (cluster.center.z < -this.halfSize) {
        cluster.center.z = this.halfSize;
        cluster.center.x = (Math.random() - 0.5) * this.worldSize;
      }

      const groundY = Math.max(getTerrainHeight(cluster.center.x, cluster.center.z), -3.0);
      cluster.center.y = THREE.MathUtils.lerp(cluster.center.y, groundY + cluster.baseHeight, 1.2 * delta);

      const dx = cluster.center.x - camPos.x;
      const dz = cluster.center.z - camPos.z;
      const distFromCam = Math.sqrt(dx * dx + dz * dz);

      if (cluster.type === 'storm') {
        const stormProximity = distFromCam - cluster.radius;
        if (stormProximity < nearestStormDist) {
          nearestStormDist = stormProximity;
          activeStormCluster = cluster;
        }
      }

      // ── Smooth panoramic LOD for Cloud Puffs across sky ──
      let lodFade = 1.0;
      if (distFromCam > 950) {
        lodFade = 0.0;
      } else if (distFromCam > 750) {
        lodFade = 1.0 - (distFromCam - 750) / 200;
      }

      const targetMesh = cluster.type === 'storm' ? this.stormMesh : this.fairMesh;

      for (const puff of cluster.puffs) {
        if (lodFade <= 0.0) {
          scratchMatrix.makeScale(0, 0, 0);
          targetMesh.setMatrixAt(puff.instanceIndex, scratchMatrix);
          continue;
        }

        const worldPuffPos = new THREE.Vector3(
          cluster.center.x + puff.localOffset.x,
          cluster.center.y + puff.localOffset.y,
          cluster.center.z + puff.localOffset.z
        );

        const finalScale = puff.baseScale.clone().multiplyScalar(lodFade);
        scratchMatrix.compose(worldPuffPos, puff.rotation, finalScale);
        targetMesh.setMatrixAt(puff.instanceIndex, scratchMatrix);
      }
    }

    this.fairMesh.instanceMatrix.needsUpdate = true;
    this.stormMesh.instanceMatrix.needsUpdate = true;

    // ── Localized Rain & Splash System Update ──
    if (activeStormCluster && nearestStormDist < 60) {
      this.rainMesh.visible = true;
      this.splashMesh.visible = true;
      this.isRainActive = true;
      this.updateRainAndSplashes(delta, camPos, activeStormCluster);
    } else {
      if (this.isRainActive) {
        this.rainMesh.visible = false;
        this.splashMesh.visible = false;
        this.isRainActive = false;
      }
    }
  }

  private updateRainAndSplashes(delta: number, camPos: THREE.Vector3, stormCluster: CloudCluster) {
    const scratchMatrix = new THREE.Matrix4();
    const rainRadius = Math.min(stormCluster.radius * 0.85, 60.0);
    const cloudBaseY = stormCluster.center.y - 3.0;

    // Rain tilt facing camera view direction with slight wind slant
    const windAngle = Math.atan2(globalWind.direction.y, globalWind.direction.x);
    const tiltZ = -globalWind.direction.x * 0.18;
    const tiltX = globalWind.direction.y * 0.18;
    const rainRot = new THREE.Quaternion().setFromEuler(new THREE.Euler(tiltX, windAngle, tiltZ));
    const rainScale = new THREE.Vector3(1, 1, 1);

    let nextSplashIdx = 0;

    for (let i = 0; i < this.rainCount; i++) {
      const pos = this.rainPositions[i];
      const speed = this.rainSpeeds[i];

      // Fall downwards vertically with slight wind drift
      pos.y -= speed * delta;
      pos.x += globalWind.direction.x * globalWind.strength * delta * 5.0;
      pos.z += globalWind.direction.y * globalWind.strength * delta * 5.0;

      const groundY = Math.max(getTerrainHeight(pos.x, pos.z), -3.0);

      // Trigger splash when hitting ground/water
      if (pos.y <= groundY + 0.1) {
        // Spawn ground splash ripple at point of impact
        if (nextSplashIdx < this.splashCount) {
          const splash = this.splashes[nextSplashIdx++];
          splash.pos.set(pos.x, groundY + 0.04, pos.z);
          splash.age = 0.0;
          splash.scale = 0.1 + Math.random() * 0.1;
        }

        // Respawn rain at top
        const angle = Math.random() * Math.PI * 2;
        const r = Math.sqrt(Math.random()) * rainRadius;
        pos.x = camPos.x + Math.cos(angle) * r;
        pos.z = camPos.z + Math.sin(angle) * r;
        pos.y = cloudBaseY - Math.random() * 6.0;
      } else {
        const dx = pos.x - camPos.x;
        const dz = pos.z - camPos.z;
        if (dx * dx + dz * dz > rainRadius * rainRadius || pos.y < groundY - 2.0) {
          const angle = Math.random() * Math.PI * 2;
          const r = Math.sqrt(Math.random()) * rainRadius;
          pos.x = camPos.x + Math.cos(angle) * r;
          pos.z = camPos.z + Math.sin(angle) * r;
          pos.y = cloudBaseY - Math.random() * 6.0;
        }
      }

      scratchMatrix.compose(pos, rainRot, rainScale);
      this.rainMesh.setMatrixAt(i, scratchMatrix);
    }

    this.rainMesh.instanceMatrix.needsUpdate = true;

    // ── Update Expanding Splash Rings ──
    const splashRot = new THREE.Quaternion();
    const splashScaleVec = new THREE.Vector3();

    for (let s = 0; s < this.splashCount; s++) {
      const splash = this.splashes[s];
      splash.age += delta;

      if (splash.age < splash.maxAge) {
        const progress = splash.age / splash.maxAge;
        // Expand ring from 0.2 to 1.8x scale
        const currentScale = splash.scale * (1.0 + progress * 2.5);
        splashScaleVec.set(currentScale, currentScale, currentScale);

        scratchMatrix.compose(splash.pos, splashRot, splashScaleVec);
        this.splashMesh.setMatrixAt(s, scratchMatrix);
      } else {
        scratchMatrix.makeScale(0, 0, 0);
        this.splashMesh.setMatrixAt(s, scratchMatrix);
      }
    }

    this.splashMesh.instanceMatrix.needsUpdate = true;
  }
}

export function createLowPolyCloudGeometry(): THREE.BufferGeometry {
  const geometries: THREE.BufferGeometry[] = [];
  
  // Core center sphere
  const sphere1 = new THREE.SphereGeometry(3.5, 8, 8);
  sphere1.translate(0, 0, 0);
  geometries.push(sphere1);
  
  // Left sphere
  const sphere2 = new THREE.SphereGeometry(2.6, 8, 8);
  sphere2.translate(-3.0, -0.4, 0);
  geometries.push(sphere2);
  
  // Right sphere
  const sphere3 = new THREE.SphereGeometry(2.6, 8, 8);
  sphere3.translate(3.0, -0.4, 0);
  geometries.push(sphere3);
  
  // Front sphere
  const sphere4 = new THREE.SphereGeometry(2.2, 8, 8);
  sphere4.translate(0, -0.5, 2.4);
  geometries.push(sphere4);
  
  // Back sphere
  const sphere5 = new THREE.SphereGeometry(2.2, 8, 8);
  sphere5.translate(0, -0.5, -2.4);
  geometries.push(sphere5);

  // Top bulge for puffy volumetric cumulus look
  const sphere6 = new THREE.SphereGeometry(2.5, 8, 8);
  sphere6.translate(0, 1.8, 0);
  geometries.push(sphere6);

  const cloudGeometry = BufferGeometryUtils.mergeGeometries(geometries);
  cloudGeometry.computeVertexNormals();
  cloudGeometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 45, 0), 2500);
  return cloudGeometry;
}

export function createCartoonCloudMaterial(topColorHex: string, bottomColorHex: string, opacity = 0.95): THREE.Material {
  const material = new THREE.MeshPhongMaterial({
    color: 0xffffff,
    flatShading: true,
    transparent: true,
    opacity: opacity,
    side: THREE.DoubleSide,
    depthWrite: true
  });

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTopColor = { value: new THREE.Color(topColorHex) };
    shader.uniforms.uBottomColor = { value: new THREE.Color(bottomColorHex) };

    shader.vertexShader = `
      varying vec3 vWorldNormal;
    ` + shader.vertexShader;

    shader.fragmentShader = `
      varying vec3 vWorldNormal;
      uniform vec3 uTopColor;
      uniform vec3 uBottomColor;
    ` + shader.fragmentShader;

    shader.vertexShader = shader.vertexShader.replace(
      '#include <defaultnormal_vertex>',
      `
      #include <defaultnormal_vertex>
      #ifdef USE_INSTANCING
        mat3 instMat = mat3(instanceMatrix);
        vWorldNormal = normalize((modelMatrix * vec4(instMat * objectNormal, 0.0)).xyz);
      #else
        vWorldNormal = normalize((modelMatrix * vec4(objectNormal, 0.0)).xyz);
      #endif
      `
    );

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <color_fragment>',
      `
      #include <color_fragment>
      float intensity = clamp(vWorldNormal.y * 0.5 + 0.5, 0.0, 1.0);
      diffuseColor.rgb = mix(uBottomColor, uTopColor, smoothstep(0.40, 0.58, intensity));
      `
    );
  };

  return material;
}
