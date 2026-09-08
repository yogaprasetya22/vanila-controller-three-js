import * as THREE from 'three';
import { CHARACTER_CONFIG } from '../../entities/player/PlayerConfig';
import { getTerrainHeight } from '../../simulation/constants';
import { scene, getLODLevelAt } from '../../graphics/core/scene';
import { SkillManager } from '../../skills/SkillManager';
import { SkillRegistry } from '../../skills/SkillRegistry';
import { SKILL_CONFIGS } from '../../skills/SkillConfig';

export interface VFXInterface {
  spawn: (x: number, y: number, z: number, anchor?: THREE.Object3D, duration?: number) => void;
}

export class SkillsSystem {
  public skillManager: SkillManager;

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

  // ponytail: dirty-flag cache — avoids DOM writes (style mutation) every frame
  private _lastCdTexts: string[] = ['', '', ''];
  private _lastIsReady: boolean[] = [true, true, true];
  private _lastPassiveCd = '';
  private _lastPassiveReady = true;

  constructor(
    _gasVFX?: any,
    _flameVFX?: any,
    _tornadoVFX?: any
  ) {
    this.skillManager = new SkillManager(null);
    this.skillManager.registerSkill('Digit1');
    this.skillManager.registerSkill('Digit2');
    this.skillManager.registerSkill('Digit3');

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

    const keys = ['Digit1', 'Digit2', 'Digit3'];
    const keyLabels = keys.map(k => k.replace('Digit', '').replace('Key', ''));

    // Custom asset PNG icons mapping for Archer
    const skillIcons: { [key: string]: string } = {
      Digit1: '/assets-image-skills/PNG/3.png',
      Digit2: '/assets-image-skills/PNG/6.png',
      Digit3: '/assets-image-skills/PNG/4.png'
    };

    // Custom HUD border colors mapping from character config
    const skillColors: { [key: string]: string } = {
      Digit1: CHARACTER_CONFIG.skills.arrowVolley.hudColor,
      Digit2: CHARACTER_CONFIG.skills.doubleShot.hudColor,
      Digit3: CHARACTER_CONFIG.skills.evasiveLeap.hudColor
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
      border: 1px solid rgba(255, 255, 255, 0.25);
      border-radius: 5px;
      padding: 1px 5px;
      font-size: 9px;
      font-weight: 900;
      z-index: 5;
      font-family: 'Inter', monospace;
      box-shadow: 0 1px 4px rgba(0, 0, 0, 0.5);
    `;
    passiveItem.appendChild(keyLabel);

    // Cooldown Overlay (Hidden by default)
    const passiveOverlay = document.createElement('div');
    passiveOverlay.style.cssText = `
      position: absolute;
      inset: 0;
      background: rgba(0, 0, 0, 0.62);
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
      text-shadow: 0 1px 6px rgba(0, 0, 0, 0.95);
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

  public triggerNetworkVFX(skillId: string, x: number, z: number, forward?: THREE.Vector3, targetMesh?: THREE.Object3D) {
    const floorY = getTerrainHeight(x, z);
    const mockPos = new THREE.Vector3(x, floorY, z);
    if (getLODLevelAt(mockPos) !== 'full') return;

    const skill = SkillRegistry.create(skillId);
    if (skill) {
      const mockCaster = {
        position: mockPos
      };
      const fwd = forward ? forward.clone().normalize() : new THREE.Vector3(0, 0, -1);
      skill.cast(mockCaster, {
        scene,
        forward: fwd,
        target: targetMesh
      });
    }
  }

  public handleInput(code: string, playerPos: THREE.Vector3, forward: THREE.Vector3, character?: any): boolean {
    if (!this.skillManager.isReady(code)) return false;

    if (character) {
      character.faceNearestTarget();
      forward = character.getForwardVector();
      playerPos = character.position;
      (this.skillManager as any).caster = character;
    }

    const target = character ? character.getNearestTarget() : null;
    const success = this.skillManager.use(code, {
      scene,
      forward,
      target
    });

    if (success) {
      this.updateUI(character);
      return true;
    }
    return false;
  }

  public update(delta: number, character?: any) {
    this.skillManager.update(delta);
    if (character) {
      (this.skillManager as any).caster = character;
    }
    this.updateUI(character);
  }

  private updateUI(character?: any) {
    this.skillElements.forEach((el, idx) => {
      const isReady = this.skillManager.isReady(el.key);
      const cd = this.skillManager.getCooldown(el.key);
      const cdStr = cd > 0 ? cd.toFixed(1) : '';

      // ponytail: only write DOM when value changed — prevents forced reflow every frame
      if (this._lastIsReady[idx] !== isReady) {
        this._lastIsReady[idx] = isReady;
        el.itemEl.style.borderColor = isReady ? el.activeColor : 'rgba(239, 68, 68, 0.5)';
        el.itemEl.style.opacity = isReady ? '1' : '0.65';
      }

      if (cd > 0) {
        el.overlayEl.style.display = 'flex';
        if (this._lastCdTexts[idx] !== cdStr) {
          this._lastCdTexts[idx] = cdStr;
          el.cdTextEl.innerText = cdStr;
        }
      } else {
        if (this._lastCdTexts[idx] !== '') {
          this._lastCdTexts[idx] = '';
          el.overlayEl.style.display = 'none';
        }
      }
    });

    if (this.passiveElement) {
      const dodgeCD = character ? (character.dodgeCooldownLeft ?? 0) : 0;
      const isReady = dodgeCD <= 0;
      const cdStr   = dodgeCD > 0 ? dodgeCD.toFixed(1) : '';

      if (this._lastPassiveReady !== isReady) {
        this._lastPassiveReady = isReady;
        this.passiveElement.itemEl.style.borderColor = isReady ? '#a855f7' : 'rgba(239, 68, 68, 0.5)';
        this.passiveElement.itemEl.style.opacity = isReady ? '1' : '0.65';
      }

      if (dodgeCD > 0) {
        this.passiveElement.overlayEl.style.display = 'flex';
        if (this._lastPassiveCd !== cdStr) {
          this._lastPassiveCd = cdStr;
          this.passiveElement.cdTextEl.innerText = cdStr;
        }
      } else {
        if (this._lastPassiveCd !== '') {
          this._lastPassiveCd = '';
          this.passiveElement.overlayEl.style.display = 'none';
        }
      }
    }
  }
}
