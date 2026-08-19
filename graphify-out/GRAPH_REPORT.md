# Graph Report - .  (2026-08-19)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 209 nodes · 253 edges · 16 communities (14 shown, 2 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Community 0
- Community 1
- Community 2
- Community 3
- Community 4
- Community 5
- Community 6
- Community 7
- Community 8
- Community 9
- Community 10
- Community 11
- Community 12
- Community 13

## God Nodes (most connected - your core abstractions)
1. `compilerOptions` - 16 edges
2. `animate()` - 9 edges
3. `VFXManager` - 8 edges
4. `CartoonTornadoNativeVFX` - 6 edges
5. `CartoonBlueFlamethrowerNativeVFX` - 5 edges
6. `CartoonBlueFlamethrowerQuarksVFX` - 5 edges
7. `CartoonBlueGasExplosionNativeVFX` - 5 edges
8. `CartoonBlueGasExplosionQuarksVFX` - 5 edges
9. `Subemitter2NativeVFX` - 5 edges
10. `Subemitter2QuarksVFX` - 5 edges

## Surprising Connections (you probably didn't know these)
- None detected - all connections are within the same source files.

## Import Cycles
- None detected.

## Communities (16 total, 2 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.07
Nodes (24): ambientLight, camera, clock, container, controls, dirLight, flamethrowerNative, flamethrowerQuarks (+16 more)

### Community 1 - "Community 1"
Cohesion: 0.08
Nodes (21): absInput, baseName, className, collectEmitters(), data, emitterByUUID, emitters, endIdx (+13 more)

### Community 2 - "Community 2"
Cohesion: 0.09
Nodes (22): gsap, dependencies, gsap, three, three.quarks, @types/three, devDependencies, typescript (+14 more)

### Community 3 - "Community 3"
Cohesion: 0.09
Nodes (21): DOM, ES2023, src, vite/client, compilerOptions, allowArbitraryExtensions, allowImportingTsExtensions, erasableSyntaxOnly (+13 more)

### Community 4 - "Community 4"
Cohesion: 0.16
Nodes (15): addInstMesh(), bez(), DARK_BLUE_TO_GRAY, evalAlpha(), evalColor(), flushAttribs(), GLOW_COLOR, HIDE (+7 more)

### Community 5 - "Community 5"
Cohesion: 0.22
Nodes (9): AlphaKey, bezier3(), CartoonBlueFlamethrowerNativeVFX, ColorKey, evalAlpha(), evalColor(), evalPiecewise(), PiecewiseCurve (+1 more)

### Community 6 - "Community 6"
Cohesion: 0.22
Nodes (9): AlphaKey, bezier3(), CartoonBlueGasExplosionNativeVFX, ColorKey, evalAlpha(), evalColor(), evalPiecewise(), PiecewiseCurve (+1 more)

### Community 7 - "Community 7"
Cohesion: 0.22
Nodes (9): AlphaKey, bezier3(), ColorKey, evalAlpha(), evalColor(), evalPiecewise(), PiecewiseCurve, rng() (+1 more)

### Community 8 - "Community 8"
Cohesion: 0.20
Nodes (3): cartoonBlueGasExplosion, QuarksVFXManager, CartoonBlueGasExplosionQuarksVFX

### Community 9 - "Community 9"
Cohesion: 0.25
Nodes (3): cartoonBlueFlamethrower, animate(), CartoonBlueFlamethrowerQuarksVFX

### Community 10 - "Community 10"
Cohesion: 0.29
Nodes (6): lastTime, SpawnData, startSimulationLoop(), updatePhysics(), WorkerInitData, WorkerMessage

### Community 13 - "Community 13"
Cohesion: 0.50
Nodes (3): data, loader, template

## Knowledge Gaps
- **90 isolated node(s):** `name`, `private`, `version`, `type`, `dev` (+85 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **2 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `VFXManager` connect `Community 11` to `Community 0`, `Community 9`?**
  _High betweenness centrality (0.025) - this node is a cross-community bridge._
- **Why does `animate()` connect `Community 9` to `Community 0`, `Community 5`, `Community 6`, `Community 7`, `Community 8`, `Community 12`?**
  _High betweenness centrality (0.019) - this node is a cross-community bridge._
- **Why does `CartoonTornadoNativeVFX` connect `Community 12` to `Community 0`?**
  _High betweenness centrality (0.015) - this node is a cross-community bridge._
- **What connects `name`, `private`, `version` to the rest of the system?**
  _90 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.07142857142857142 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.082010582010582 - nodes in this community are weakly interconnected._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.08695652173913043 - nodes in this community are weakly interconnected._