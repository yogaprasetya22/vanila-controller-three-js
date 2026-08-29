import { LocalPlayer } from '../entities/player/LocalPlayer';
import { SkillsSystem } from './combat/SkillsSystem';
import { RPC, myPlayer } from '../network/NetworkManager';

export class InputManager {
  public static isShooting = false;

  public static init(characterProvider: () => LocalPlayer | null, skillsSystem: SkillsSystem) {
    const rendererEl = document.querySelector('canvas');

    window.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      if (document.pointerLockElement !== rendererEl) return;
      this.isShooting = true;
    });

    window.addEventListener('pointerup', (e) => {
      if (e.button === 0) this.isShooting = false;
    });

    window.addEventListener('contextmenu', (e) => e.preventDefault());

    const resetInputs = () => {
      this.isShooting = false;
      const char = characterProvider();
      if (char) char.resetInputs();
    };

    window.addEventListener('blur', resetInputs);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) resetInputs();
    });

    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      const char = characterProvider();
      if (!char) return;
      if (document.pointerLockElement !== rendererEl) return;

      const playerPos = char.position;
      const forward = char.getForwardVector();
      if (skillsSystem.handleInput(e.code, playerPos, forward, char)) {
        RPC.call('cast_skill', {
          skillCode: e.code,
          playerPos: { x: playerPos.x, y: playerPos.y, z: playerPos.z },
          forward: { x: forward.x, y: forward.y, z: forward.z },
          playerId: myPlayer().id,
        }, RPC.Mode.OTHERS);
      }
    });
  }
}
