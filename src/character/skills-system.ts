import * as THREE from 'three';
import { CHARACTER_CONFIG } from './character-config';
import { getTerrainHeight } from '../simulation/constants';

export interface VFXInterface {
  spawn: (x: number, y: number, z: number, anchor?: THREE.Object3D, duration?: number) => void;
}

export class SkillsSystem {
  private skills: {
    [key: string]: {
      name: string;
      cooldown: number;
      currentCD: number;
      vfx: VFXInterface;
      trigger: (playerPos: THREE.Vector3, forward: THREE.Vector3, character?: any) => void;
    };
  } = {};

  // UI overlay representation
  private cdIndicator: HTMLDivElement;
  private skillElements: Array<{
    key: string;
    itemEl: HTMLDivElement;
    overlayEl: HTMLDivElement;
    cdTextEl: HTMLSpanElement;
    activeColor: string;
  }> = [];

  private passiveElement: {
    itemEl: HTMLDivElement;
    overlayEl: HTMLDivElement;
    cdTextEl: HTMLSpanElement;
  } | null = null;

  constructor(
    gasVFX: VFXInterface,
    flameVFX: VFXInterface,
    tornadoVFX: VFXInterface
  ) {
    // Skill 1: SubEmitter2 (Forward Spawn or Target Spawn)
    const gasConf = CHARACTER_CONFIG.skills.gasExplosion;
    this.skills[gasConf.key] = {
      name: 'SubEmitter2',
      cooldown: gasConf.cooldown,
      currentCD: 0,
      vfx: gasVFX,
      trigger: (playerPos, forward, character) => {
        const target = character ? character.getNearestTarget() : null;
        if (target) {
          const targetPos = new THREE.Vector3();
          targetPos.copy(target.position);
          // Clamp Y to terrain surface so explosion never spawns underground
          const floorY = getTerrainHeight(targetPos.x, targetPos.z);
          gasVFX.spawn(targetPos.x, Math.max(targetPos.y, floorY) + 0.1, targetPos.z);
        } else {
          const spawnPos = playerPos.clone().addScaledVector(forward, gasConf.forwardOffset);
          const floorY = getTerrainHeight(spawnPos.x, spawnPos.z);
          gasVFX.spawn(spawnPos.x, Math.max(spawnPos.y, floorY) + 0.1, spawnPos.z);
        }
      }
    };

    // Skill 2: Flamethrower (Forward Stream + Speed Buff + Body Follow)
    const flameConf = CHARACTER_CONFIG.skills.flamethrower;
    this.skills[flameConf.key] = {
      name: 'Flamethrower',
      cooldown: flameConf.cooldown,
      currentCD: 0,
      vfx: flameVFX,
      trigger: (playerPos, forward, character) => {
        const target = playerPos.clone().addScaledVector(forward, flameConf.forwardOffset);
        
        // Give character a speed buff matching the active duration
        if (character) {
          character.applySpeedBuff(flameConf.speedMultiplier || 1.8, flameConf.activeDuration);
        }

        // Spawn flamethrower visual attached to character chest/body with configured duration
        flameVFX.spawn(
          target.x,
          target.y + 1.0,
          target.z,
          (character && character.playerMesh) ? character.playerMesh : undefined,
          flameConf.activeDuration
        );
      }
    };

    // Skill 3: Cartoon Tornado (Local AoE or Target Spawn)
    const tornadoConf = CHARACTER_CONFIG.skills.tornado;
    this.skills[tornadoConf.key] = {
      name: 'Tornado',
      cooldown: tornadoConf.cooldown,
      currentCD: 0,
      vfx: tornadoVFX,
      trigger: (playerPos, forward, character) => {
        const target = character ? character.getNearestTarget() : null;
        if (target) {
          const targetPos = new THREE.Vector3();
          targetPos.copy(target.position);
          // Clamp Y to terrain surface
          const floorY = getTerrainHeight(targetPos.x, targetPos.z);
          tornadoVFX.spawn(targetPos.x, Math.max(targetPos.y, floorY) + 0.1, targetPos.z, target);
        } else {
          const floorY = getTerrainHeight(playerPos.x, playerPos.z);
          tornadoVFX.spawn(playerPos.x, Math.max(playerPos.y, floorY), playerPos.z);
        }
      }
    };

    // Skill HUD — di atas #controls bar (fixed bottom: 1.25rem)
    this.cdIndicator = document.createElement('div');
    this.cdIndicator.id = 'skill-hud';
    this.cdIndicator.style.cssText = `
      position: fixed;
      bottom: 1.25rem;
      left: 50%;
      transform: translateX(-50%);
      display: flex;
      gap: 6px;
      z-index: 11;
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      pointer-events: none;
      background: rgba(15, 23, 42, 0.3);
      padding: 6px 10px;
      border-radius: 12px;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
      border: 1px solid rgba(255, 255, 255, 0.05);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
    `;
    document.body.appendChild(this.cdIndicator);

    // Label "SKILLS" di atas container
    const label = document.createElement('div');
    label.style.cssText = `
      position: absolute;
      top: -20px;
      left: 0; right: 0;
      text-align: center;
      font-size: 9px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.2em;
      color: rgba(255,255,255,0.35);
    `;
    label.innerText = 'SKILLS';
    this.cdIndicator.style.position = 'fixed';
    this.cdIndicator.appendChild(label);

    const keys = [
      CHARACTER_CONFIG.skills.gasExplosion.key,
      CHARACTER_CONFIG.skills.flamethrower.key,
      CHARACTER_CONFIG.skills.tornado.key
    ];
    const keyLabels = keys.map(k => k.replace('Digit', '').replace('Key', ''));

    // Custom asset PNG icons mapping
    const skillIcons: { [key: string]: string } = {
      [CHARACTER_CONFIG.skills.gasExplosion.key]: '/assets-image-skills/PNG/3.png',
      [CHARACTER_CONFIG.skills.flamethrower.key]: '/assets-image-skills/PNG/6.png',
      [CHARACTER_CONFIG.skills.tornado.key]: '/assets-image-skills/PNG/4.png'
    };

    // Custom HUD border colors mapping from character config
    const skillColors: { [key: string]: string } = {
      [CHARACTER_CONFIG.skills.gasExplosion.key]: CHARACTER_CONFIG.skills.gasExplosion.hudColor,
      [CHARACTER_CONFIG.skills.flamethrower.key]: CHARACTER_CONFIG.skills.flamethrower.hudColor,
      [CHARACTER_CONFIG.skills.tornado.key]: CHARACTER_CONFIG.skills.tornado.hudColor
    };

    keys.forEach((key, idx) => {
      const iconUrl = skillIcons[key] || '/assets-image-skills/PNG/1.png';
      const activeColor = skillColors[key] || '#ffffff';

      const item = document.createElement('div');
      item.style.cssText = `
        width: 44px;
        height: 44px;
        background-image: url('${iconUrl}');
        background-size: cover;
        background-position: center;
        border: 2px solid ${activeColor};
        border-radius: 8px;
        position: relative;
        box-shadow: inset 0 0 10px rgba(0,0,0,0.6), 0 3px 8px rgba(0,0,0,0.3);
        transition: border-color 0.2s ease, opacity 0.2s ease;
        opacity: 1;
      `;

      // Hotkey Badge
      const keyLabel = document.createElement('div');
      keyLabel.innerText = keyLabels[idx];
      keyLabel.style.cssText = `
        position: absolute;
        top: -7px;
        right: -7px;
        background: rgba(10, 12, 20, 0.92);
        color: #e2e8f0;
        border: 1px solid rgba(255,255,255,0.25);
        border-radius: 5px;
        padding: 1px 5px;
        font-size: 9px;
        font-weight: 900;
        z-index: 5;
        font-family: 'Inter', monospace;
        box-shadow: 0 1px 4px rgba(0,0,0,0.5);
      `;
      item.appendChild(keyLabel);

      // Cooldown Overlay (Hidden by default)
      const overlay = document.createElement('div');
      overlay.style.cssText = `
        position: absolute;
        inset: 0;
        background: rgba(0,0,0,0.62);
        border-radius: 8px;
        display: none;
        align-items: center;
        justify-content: center;
        z-index: 2;
      `;
      const cdText = document.createElement('span');
      cdText.style.cssText = `
        color: #f87171;
        font-size: 14px;
        font-weight: 900;
        text-shadow: 0 1px 6px rgba(0,0,0,0.95);
        font-family: 'Inter', monospace;
      `;
      overlay.appendChild(cdText);
      item.appendChild(overlay);

      this.cdIndicator.appendChild(item);

      this.skillElements.push({
        key,
        itemEl: item,
        overlayEl: overlay,
        cdTextEl: cdText,
        activeColor
      });
    });

    // Create Passive Dodge Cooldown indicator once
    const passiveItem = document.createElement('div');
    passiveItem.style.cssText = `
      width: 44px;
      height: 44px;
      background-image: url('/assets-image-skills/PNG/1.png');
      background-size: cover;
      background-position: center;
      border: 2px solid #a855f7;
      border-radius: 8px;
      position: relative;
      box-shadow: inset 0 0 10px rgba(0,0,0,0.6), 0 3px 8px rgba(0,0,0,0.3);
      transition: border-color 0.2s ease, opacity 0.2s ease;
      opacity: 1;
    `;

    // Passive label badge
    const passiveLabel = document.createElement('div');
    passiveLabel.innerText = 'PASSIVE';
    passiveLabel.style.cssText = `
      position: absolute;
      bottom: -7px;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(10, 12, 20, 0.95);
      color: #e9d5ff;
      border: 1px solid rgba(168, 85, 247, 0.4);
      border-radius: 4px;
      padding: 0px 4px;
      font-size: 7px;
      font-weight: 900;
      z-index: 5;
      font-family: 'Segoe UI', monospace;
      letter-spacing: 0.05em;
      white-space: nowrap;
    `;
    passiveItem.appendChild(passiveLabel);

    // Key badge (E)
    const keyLabel = document.createElement('div');
    keyLabel.innerText = 'E';
    keyLabel.style.cssText = `
      position: absolute;
      top: -7px;
      right: -7px;
      background: rgba(10, 12, 20, 0.92);
      color: #e2e8f0;
      border: 1px solid rgba(255,255,255,0.25);
      border-radius: 5px;
      padding: 1px 5px;
      font-size: 9px;
      font-weight: 900;
      z-index: 5;
      font-family: 'Inter', monospace;
      box-shadow: 0 1px 4px rgba(0,0,0,0.5);
    `;
    passiveItem.appendChild(keyLabel);

    // Cooldown Overlay (Hidden by default)
    const passiveOverlay = document.createElement('div');
    passiveOverlay.style.cssText = `
      position: absolute;
      inset: 0;
      background: rgba(0,0,0,0.62);
      border-radius: 8px;
      display: none;
      align-items: center;
      justify-content: center;
      z-index: 2;
    `;
    const passiveCdText = document.createElement('span');
    passiveCdText.style.cssText = `
      color: #f87171;
      font-size: 14px;
      font-weight: 900;
      text-shadow: 0 1px 6px rgba(0,0,0,0.95);
      font-family: 'Inter', monospace;
    `;
    passiveOverlay.appendChild(passiveCdText);
    passiveItem.appendChild(passiveOverlay);

    this.cdIndicator.appendChild(passiveItem);

    this.passiveElement = {
      itemEl: passiveItem,
      overlayEl: passiveOverlay,
      cdTextEl: passiveCdText
    };

    this.updateUI();
  }

  public setVisible(visible: boolean) {
    this.cdIndicator.style.display = visible ? 'flex' : 'none';
  }

  public triggerNetworkVFX(skillId: string, x: number, z: number, targetMesh?: THREE.Object3D) {
    const skill = this.skills[skillId];
    if (skill) {
      const floorY = getTerrainHeight(x, z);
      const spawnY = Math.max(0, floorY) + 0.1;
      
      if (skillId === CHARACTER_CONFIG.skills.flamethrower.key) {
        skill.vfx.spawn(x, spawnY + 1.0, z, targetMesh, CHARACTER_CONFIG.skills.flamethrower.activeDuration);
      } else if (skillId === CHARACTER_CONFIG.skills.tornado.key) {
        // Tornado spawns at coordinates, do not anchor to caster (targetMesh)
        skill.vfx.spawn(x, spawnY, z, undefined);
      } else {
        skill.vfx.spawn(x, spawnY, z);
      }
    }
  }

  public handleInput(code: string, playerPos: THREE.Vector3, forward: THREE.Vector3, character?: any): boolean {
    const skill = this.skills[code];
    if (skill && skill.currentCD <= 0) {
      // Auto-Aim: Force character to face target dummy before casting any skill
      if (character) {
        character.faceNearestTarget();
        // Fetch fresh vectors pointing towards the newly auto-aimed target
        forward = character.getForwardVector();
        playerPos = character.position;
      }

      skill.trigger(playerPos, forward, character);
      skill.currentCD = skill.cooldown;
      this.updateUI();
      return true;
    }
    return false;
  }

  public update(delta: number, character?: any) {
    let cdUpdated = false;
    for (const key in this.skills) {
      const s = this.skills[key];
      if (s.currentCD > 0) {
        s.currentCD -= delta;
        if (s.currentCD < 0) s.currentCD = 0;
        cdUpdated = true;
      }
    }
    // Track dynamic character stats (dodge cooldown) for UI updates
    if (character && (character.dodgeCooldownLeft !== undefined || character.dodgeCooldownLeft >= 0)) {
      cdUpdated = true;
    }
    if (cdUpdated) {
      this.updateUI(character);
    }
  }

  private updateUI(character?: any) {
    // Update active skills UI state without rebuilding DOM
    this.skillElements.forEach((el) => {
      const s = this.skills[el.key];
      if (!s) return;
      
      const isReady = s.currentCD <= 0;
      el.itemEl.style.borderColor = isReady ? el.activeColor : 'rgba(239, 68, 68, 0.5)';
      el.itemEl.style.opacity = isReady ? '1' : '0.65';
      
      if (s.currentCD > 0) {
        el.overlayEl.style.display = 'flex';
        el.cdTextEl.innerText = s.currentCD.toFixed(1);
      } else {
        el.overlayEl.style.display = 'none';
      }
    });

    // Update passive dodge UI state
    if (this.passiveElement) {
      const dodgeCD = character ? (character.dodgeCooldownLeft ?? 0) : 0;
      const isReady = dodgeCD <= 0;
      
      this.passiveElement.itemEl.style.borderColor = isReady ? '#a855f7' : 'rgba(239, 68, 68, 0.5)';
      this.passiveElement.itemEl.style.opacity = isReady ? '1' : '0.65';
      
      if (dodgeCD > 0) {
        this.passiveElement.overlayEl.style.display = 'flex';
        this.passiveElement.cdTextEl.innerText = dodgeCD.toFixed(1);
      } else {
        this.passiveElement.overlayEl.style.display = 'none';
      }
    }
  }
}
