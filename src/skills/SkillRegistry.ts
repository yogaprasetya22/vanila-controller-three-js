import type { ISkill } from './ISkill';
import { ArrowVolleySkill } from './arrow-volley/ArrowVolleySkill';
import { DoubleShotSkill } from './double-shot/DoubleShotSkill';
import { EvasiveLeapSkill } from './evasive-leap/EvasiveLeapSkill';

export class SkillRegistry {
  private static registry = new Map<string, new () => ISkill>();

  public static register(id: string, skillClass: new () => ISkill) {
    this.registry.set(id, skillClass);
  }

  public static create(id: string): ISkill | null {
    const SkillClass = this.registry.get(id);
    if (!SkillClass) return null;
    return new SkillClass();
  }

  public static has(id: string): boolean {
    return this.registry.has(id);
  }
}

// Statically register modular skills
SkillRegistry.register('Digit1', ArrowVolleySkill);
SkillRegistry.register('Digit2', DoubleShotSkill);
SkillRegistry.register('Digit3', EvasiveLeapSkill);
