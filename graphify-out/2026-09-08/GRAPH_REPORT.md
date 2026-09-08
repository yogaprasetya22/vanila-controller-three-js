# Graph Report - .  (2026-09-08)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 903 nodes · 1710 edges · 64 communities (48 shown, 16 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `d25ae303`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- FXCore.ts
- ArrowVolleySkill.ts
- NetworkManager
- package.json
- quarks-to-native.mjs
- main.ts
- DamageHUDBatcher.ts
- getTerrainHeight
- vfx_main.ts
- animate
- compilerOptions
- generate-trees.mjs
- BaseEnemyController
- QuantizedPayload.ts
- LocalPlayer
- CameraOcclusionManager.ts
- native-vfx.ts
- BaseEnemyController.ts
- BossController.ts
- generate-docs.mjs
- Leaves.ts
- LocalPlayer.ts
- CartoonBlueFlamethrowerNative.ts
- DayCycleManager
- CartoonTornadoNativeVFX
- World.ts
- World
- ProjectileSystem.ts
- .playAnimationState
- myPlayer
- SkillsSystem
- NetworkDebugger
- export_map.js
- NetworkManager.ts
- BossGroundSlamFX.ts
- export_map.ts
- AssetLoader.ts
- Grass.ts
- compress-models.mjs
- download-deaths.mjs
- download-sounds.mjs
- ProjectileSystem
- Rocks
- WaterSurface
- CombatTracker
- MovementInterpolator
- ComicExplosionFX.ts
- WindEffectManager
- inspect-assets.mjs
- setCamera
- Floor.ts
- test_clone.mjs
- Wind
- TargetingDebugger
- bvh-types.d.ts
- RemotePlayer.ts
- Subemitter2NativeVFX
- CartoonBlueFlamethrower.ts
- CartoonBlueGasExplosion.ts

## God Nodes (most connected - your core abstractions)
1. `LocalPlayer` - 47 edges
2. `getTerrainHeight()` - 37 edges
3. `getPooledMaterial()` - 36 edges
4. `BaseEnemyController` - 36 edges
5. `dispatchSkillFX()` - 32 edges
6. `NetworkManager` - 26 edges
7. `myPlayer()` - 26 edges
8. `pooledRing()` - 25 edges
9. `activeFX` - 25 edges
10. `releasePooledMaterial()` - 18 edges

## Surprising Connections (you probably didn't know these)
- `RemotePlayer` --inherits--> `LocalPlayer`  [EXTRACTED]
  src/entities/player/RemotePlayer.ts → src/entities/player/LocalPlayer.ts
- `dispatchSkillFX()` --calls--> `spawnArrowVolleyFX()`  [EXTRACTED]
  src/graphics/effects/FXRouter.ts → src/graphics/effects/ArrowVolleyFX.ts
- `dispatchSkillFX()` --calls--> `spawnDoubleShotFX()`  [EXTRACTED]
  src/graphics/effects/FXRouter.ts → src/graphics/effects/DoubleShotFX.ts
- `dispatchSkillFX()` --calls--> `spawnEvasiveLeapFX()`  [EXTRACTED]
  src/graphics/effects/FXRouter.ts → src/graphics/effects/EvasiveLeapFX.ts
- `dispatchSkillFX()` --calls--> `getTerrainHeight()`  [EXTRACTED]
  src/graphics/effects/FXRouter.ts → src/simulation/constants.ts

## Import Cycles
- None detected.

## Communities (64 total, 16 thin omitted)

### Community 0 - "FXCore.ts"
Cohesion: 0.07
Nodes (74): camera, getLODLevelAt(), scene, soundFX, spawnArcaneNovaFX(), spawnBackstabFX(), spawnBasicAttackFX(), spawnBlizzardFX() (+66 more)

### Community 1 - "ArrowVolleySkill.ts"
Cohesion: 0.07
Nodes (21): BaseEntity, _flipbookMatCache, getFlipbookMat(), makeFlipbookMat(), spawnArrowVolleyFX(), subSmokeTex, texLoader, spawnEvasiveLeapFX() (+13 more)

### Community 2 - "NetworkManager"
Cohesion: 0.10
Nodes (6): getNPCConfig(), insertCoin(), NetworkManager, Player, send(), setState()

### Community 3 - "package.json"
Cohesion: 0.07
Nodes (28): gsap, @msgpack/msgpack, dependencies, gsap, @msgpack/msgpack, three, three-mesh-bvh, @types/three (+20 more)

### Community 4 - "quarks-to-native.mjs"
Cohesion: 0.08
Nodes (21): absInput, baseName, className, collectEmitters(), data, emitterByUUID, emitters, endIdx (+13 more)

### Community 5 - "main.ts"
Cohesion: 0.10
Nodes (20): clock, colliderMesh, container, dayCycle, flamethrowerNative, fpsEl, gasExplosionNative, gltfLoader (+12 more)

### Community 6 - "DamageHUDBatcher.ts"
Cohesion: 0.09
Nodes (19): buildAtlas(), buildStarTexture(), C_CRIT_DIGIT, C_DEBUFF_DIGIT, C_HEAL_DIGIT, C_MAGIC_DIGIT, C_MISS_DIGIT, C_NORMAL_DIGIT (+11 more)

### Community 7 - "getTerrainHeight"
Cohesion: 0.12
Nodes (13): SceneryWindLines, Flowers, SceneryWindLines, _sharedWindGeo, _sharedWindMat, WindLineState, getCacheIndex(), getTerrainHeight() (+5 more)

### Community 8 - "vfx_main.ts"
Cohesion: 0.09
Nodes (24): referencePosition, setScene(), updateFX(), ambientLight, animate(), camera, clock, colliderMesh (+16 more)

### Community 9 - "animate"
Cohesion: 0.13
Nodes (6): Minimap, animate(), world, getState(), NPCManager, UIManager

### Community 10 - "compilerOptions"
Cohesion: 0.09
Nodes (22): DOM, ES2023, src, src/vfx_main.ts, vite/client, compilerOptions, allowArbitraryExtensions, allowImportingTsExtensions (+14 more)

### Community 11 - "generate-trees.mjs"
Cohesion: 0.13
Nodes (22): checkOverlap(), __dirname, __filename, generateRocks(), generateScenery(), getSlope(), getTerrainHeight(), isInsideBattlefield() (+14 more)

### Community 12 - "BaseEnemyController"
Cohesion: 0.13
Nodes (4): BaseEnemyController, loadGLTFWithCache(), IAttackBehavior, MeleeAttackBehavior

### Community 13 - "QuantizedPayload.ts"
Cohesion: 0.09
Nodes (14): ACTION_INDEX, EntityState, INDEX_ACTION, _moveBuf, _moveBytes, _moveView, _pingBuf, _pingBytes (+6 more)

### Community 15 - "CameraOcclusionManager.ts"
Cohesion: 0.13
Nodes (16): CameraOcclusionConfig, CameraOcclusionManager, _center, _closest, DEFAULTS, _instMatrix, _instPos, isLeaf() (+8 more)

### Community 16 - "native-vfx.ts"
Cohesion: 0.16
Nodes (15): addInstMesh(), bez(), DARK_BLUE_TO_GRAY, evalAlpha(), evalColor(), flushAttribs(), GLOW_COLOR, HIDE (+7 more)

### Community 17 - "BaseEnemyController.ts"
Cohesion: 0.30
Nodes (5): gltfCache, gltfLoader, CHARACTER_CONFIG, SmokeParticle, VFXInterface

### Community 18 - "BossController.ts"
Cohesion: 0.10
Nodes (14): RangedAttackBehavior, BossController, _lightningPoints, ENEMY_PRESETS, IEnemyConfig, EnemyFactory, blueEmbersTex, blueExplosionTex (+6 more)

### Community 19 - "generate-docs.mjs"
Cohesion: 0.12
Nodes (10): attributesMatch, configContent, configPath, docsDir, parsedAttributes, rawArmor, rawAttributes, rawHp (+2 more)

### Community 20 - "Leaves.ts"
Cohesion: 0.16
Nodes (6): createLeafGeometry(), LEAF_COLORS, LeafParticle, Leaves, treePositions, Trees

### Community 21 - "LocalPlayer.ts"
Cohesion: 0.13
Nodes (14): _camIdealPos, _camOffset, _camRaycaster, _camRayDir, _fallbackOffset, _forwardVec, gltfCache, gltfLoader (+6 more)

### Community 22 - "CartoonBlueFlamethrowerNative.ts"
Cohesion: 0.35
Nodes (10): _col, AlphaKey, bezier3(), ColorKey, evalAlpha(), evalColor(), evalColorOut(), evalPiecewise() (+2 more)

### Community 23 - "DayCycleManager"
Cohesion: 0.21
Nodes (3): DayCycleManager, PRESETS, TimePreset

### Community 24 - "CartoonTornadoNativeVFX"
Cohesion: 0.24
Nodes (3): AssetLoader, CartoonTornadoNativeVFX, spawnActiveVFX()

### Community 25 - "World.ts"
Cohesion: 0.36
Nodes (6): Clouds, createCartoonCloudMaterial(), createLowPolyCloudGeometry(), mulberry32(), VisualTornado, globalWind

### Community 26 - "World"
Cohesion: 0.18
Nodes (4): Vegetation, getCleanGeometry(), World, invalidateTerrainCache()

### Community 27 - "ProjectileSystem.ts"
Cohesion: 0.17
Nodes (10): _gravity, _movementVec, Projectile, _raycaster, _rayOrigin, _targetLook, _targetLookAt, _targetPos (+2 more)

### Community 29 - "myPlayer"
Cohesion: 0.27
Nodes (4): LODManager, myPlayer(), onPlayerJoin(), PlayerManager

### Community 30 - "SkillsSystem"
Cohesion: 0.27
Nodes (3): RPC, SkillsSystem, InputManager

### Community 32 - "export_map.js"
Cohesion: 0.20
Nodes (9): arrayMatch, fs, jsonObstacles, MAIN_TS_PATH, OUT_JSON, OUT_OBJ, path, rawArray (+1 more)

### Community 33 - "NetworkManager.ts"
Cohesion: 0.15
Nodes (7): isHost(), onBossDamaged(), onPlayerDamaged(), onPlayerRespawned(), PlayerStateCallback, RPCMode, MovementSnapshot

### Community 34 - "BossGroundSlamFX.ts"
Cohesion: 0.20
Nodes (4): BossGroundSlamFX, SHADERS, _sharedGeo, SlamState

### Community 35 - "export_map.ts"
Cohesion: 0.22
Nodes (6): activeRocks, activeTrees, colliders, ObstacleData, rockTypes, treeTypes

### Community 36 - "AssetLoader.ts"
Cohesion: 0.25
Nodes (3): CartoonBlueFlamethrowerNativeVFX, CartoonBlueGasExplosionNativeVFX, Particle

### Community 37 - "Grass.ts"
Cohesion: 0.36
Nodes (5): Grass, lakeWetness(), mulberry32(), Patch, smoothstep()

### Community 38 - "compress-models.mjs"
Cohesion: 0.33
Nodes (6): ANIMATIONS_FOLDER, CONFIGS, __dirname, ROOT_DIR, runCommand(), start()

### Community 39 - "download-deaths.mjs"
Cohesion: 0.33
Nodes (5): __dirname, OUT_DIR, processTarget(), scrapeDetailUrls(), TARGETS

### Community 40 - "download-sounds.mjs"
Cohesion: 0.33
Nodes (5): __dirname, OUT_DIR, processTarget(), scrapeDetailUrls(), TARGETS

### Community 43 - "WaterSurface"
Cohesion: 0.38
Nodes (3): WaterSurface, LakeDef, LAKES

### Community 46 - "ComicExplosionFX.ts"
Cohesion: 0.47
Nodes (5): ActiveExplosion, activeExplosions, createExplosionSpriteSheet(), initExplosionPool(), spawnComicExplosion()

### Community 48 - "inspect-assets.mjs"
Cohesion: 0.40
Nodes (3): animations, output, weapons

### Community 51 - "Floor.ts"
Cohesion: 0.60
Nodes (3): Floor, lakeWetness(), smoothstep()

### Community 52 - "test_clone.mjs"
Cohesion: 0.50
Nodes (3): data, loader, template

## Knowledge Gaps
- **279 isolated node(s):** `cartoonBlueFlamethrower`, `cartoonBlueGasExplosion`, `data`, `loader`, `template` (+274 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **16 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `getTerrainHeight()` connect `getTerrainHeight` to `FXCore.ts`, `ArrowVolleySkill.ts`, `BossGroundSlamFX.ts`, `export_map.ts`, `Grass.ts`, `WindEffectManager`, `Floor.ts`, `Leaves.ts`, `World.ts`, `World`?**
  _High betweenness centrality (0.097) - this node is a cross-community bridge._
- **Why does `CHARACTER_CONFIG` connect `BaseEnemyController.ts` to `NetworkManager.ts`, `ArrowVolleySkill.ts`, `main.ts`, `BossController.ts`, `LocalPlayer.ts`, `CartoonBlueFlamethrowerNative.ts`, `ProjectileSystem.ts`, `myPlayer`?**
  _High betweenness centrality (0.060) - this node is a cross-community bridge._
- **Why does `LocalPlayer` connect `LocalPlayer` to `main.ts`, `ProjectileSystem`, `.die`, `LocalPlayer.ts`, `RemotePlayer.ts`, `.playAnimationState`, `myPlayer`, `SkillsSystem`?**
  _High betweenness centrality (0.055) - this node is a cross-community bridge._
- **What connects `cartoonBlueFlamethrower`, `cartoonBlueGasExplosion`, `data` to the rest of the system?**
  _279 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `FXCore.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.06758775205377147 - nodes in this community are weakly interconnected._
- **Should `ArrowVolleySkill.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.0707070707070707 - nodes in this community are weakly interconnected._
- **Should `NetworkManager` be split into smaller, more focused modules?**
  _Cohesion score 0.1010752688172043 - nodes in this community are weakly interconnected._