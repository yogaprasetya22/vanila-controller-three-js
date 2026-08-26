import type { ISkill, CastContext } from './ISkill';
import { SkillRegistry } from './SkillRegistry';
import { SKILL_CONFIGS } from './SkillConfig';

export class SkillManager {
  private caster: any;
  private activeSkills = new Map<string, ISkill>();
  private cooldowns = new Map<string, number>();

  constructor(caster: any) {
    this.caster = caster;
  }

  public registerSkill(id: string) {
    const skill = SkillRegistry.create(id);
    if (skill) {
      this.activeSkills.set(id, skill);
      this.cooldowns.set(id, 0);
    }
  }

  public getSkill(id: string): ISkill | undefined {
    return this.activeSkills.get(id);
  }

  public getCooldown(id: string): number {
    return this.cooldowns.get(id) || 0;
  }

  public isReady(id: string): boolean {
    return this.getCooldown(id) <= 0;
  }

  public use(id: string, context: CastContext): boolean {
    const skill = this.activeSkills.get(id);
    if (!skill) return false;

    if (!this.isReady(id)) return false;

    const success = skill.cast(this.caster, context);
    if (success) {
      const conf = SKILL_CONFIGS[id];
      const cd = conf ? conf.cooldown : skill.cooldown;
      this.cooldowns.set(id, cd);
      return true;
    }
    return false;
  }

  public update(delta: number) {
    for (const [id, cd] of this.cooldowns.entries()) {
      if (cd > 0) {
        const nextCd = Math.max(0, cd - delta);
        this.cooldowns.set(id, nextCd);
      }
    }
  }
}
