import * as THREE from 'three';
import { CHARACTER_CONFIG } from './character-config';

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
          target.getWorldPosition(targetPos);
          gasVFX.spawn(targetPos.x, targetPos.y + 0.1, targetPos.z);
        } else {
          const spawnPos = playerPos.clone().addScaledVector(forward, gasConf.forwardOffset);
          gasVFX.spawn(spawnPos.x, spawnPos.y + 0.5, spawnPos.z);
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
          target.getWorldPosition(targetPos);
          tornadoVFX.spawn(targetPos.x, targetPos.y + 0.1, targetPos.z);
        } else {
          tornadoVFX.spawn(playerPos.x, playerPos.y, playerPos.z);
        }
      }
    };

    // Create a beautiful, subtle overlay for cooldowns on the HUD (Spirit Vale style, centered horizontally)
    this.cdIndicator = document.createElement('div');
    this.cdIndicator.style.cssText = `
      position: absolute;
      bottom: 25px;
      left: 50%;
      transform: translateX(-50%);
      display: flex;
      gap: 10px;
      z-index: 9999;
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      pointer-events: none;
      background: rgba(15, 15, 20, 0.75);
      padding: 8px 12px;
      border-radius: 10px;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.6);
      border: 1px solid rgba(255, 255, 255, 0.15);
      backdrop-filter: blur(10px);
    `;
    document.body.appendChild(this.cdIndicator);
    this.updateUI();

    // Key listener
    window.addEventListener('keydown', (e) => {
      if (this.skills[e.code]) {
        // Find player position and direction from active character controller globally or passed via triggers
      }
    });
  }

  public setVisible(visible: boolean) {
    this.cdIndicator.style.display = visible ? 'flex' : 'none';
  }

  public handleInput(code: string, playerPos: THREE.Vector3, forward: THREE.Vector3, character?: any) {
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
    }
  }

  public update(delta: number) {
    let cdUpdated = false;
    for (const key in this.skills) {
      const s = this.skills[key];
      if (s.currentCD > 0) {
        s.currentCD -= delta;
        if (s.currentCD < 0) s.currentCD = 0;
        cdUpdated = true;
      }
    }
    if (cdUpdated) {
      this.updateUI();
    }
  }

  private updateUI() {
    this.cdIndicator.innerHTML = '';
    
    // Bind mappings for human-readable key guides dynamically from config keys
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
      const s = this.skills[key];
      const iconUrl = skillIcons[key] || '/assets-image-skills/PNG/1.png';
      const activeColor = skillColors[key] || '#ffffff';
      
      const item = document.createElement('div');
      item.style.cssText = `
        width: 48px;
        height: 48px;
        background-image: url('${iconUrl}');
        background-size: cover;
        background-position: center;
        border: 2px solid ${s.currentCD > 0 ? 'rgba(239, 68, 68, 0.7)' : activeColor};
        border-radius: 8px;
        position: relative;
        box-shadow: inset 0 0 10px rgba(0, 0, 0, 0.8), 0 2px 4px rgba(0,0,0,0.5);
        transition: border-color 0.15s ease;
      `;

      // Hotkey Badge in top-right corner
      const keyLabel = document.createElement('div');
      keyLabel.innerText = keyLabels[idx];
      keyLabel.style.cssText = `
        position: absolute;
        top: -6px;
        right: -6px;
        background: rgba(10, 10, 15, 0.95);
        color: #ffffff;
        border: 1px solid rgba(255, 255, 255, 0.3);
        border-radius: 4px;
        padding: 1px 4px;
        font-size: 9px;
        font-weight: 800;
        z-index: 5;
        box-shadow: 0 1px 3px rgba(0,0,0,0.4);
      `;
      item.appendChild(keyLabel);

      // Cooldown Overlay (Spirit Vale style)
      if (s.currentCD > 0) {
        const overlay = document.createElement('div');
        overlay.style.cssText = `
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          background: rgba(0, 0, 0, 0.65);
          border-radius: 6px;
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 2;
        `;
        
        const cdText = document.createElement('span');
        cdText.innerText = s.currentCD.toFixed(1);
        cdText.style.cssText = `
          color: #ffffff;
          font-size: 13px;
          font-weight: 900;
          text-shadow: 0 1px 4px rgba(0, 0, 0, 0.9);
        `;
        overlay.appendChild(cdText);
        item.appendChild(overlay);
      }

      this.cdIndicator.appendChild(item);
    });
  }
}
