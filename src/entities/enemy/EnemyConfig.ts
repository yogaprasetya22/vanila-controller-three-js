export interface IEnemyConfig {
  id: string;
  name: string;
  type: string;
  maxHp: number;
  speed: number;
  scale: number;
  hudColor: string;
  behaviorType: 'MELEE' | 'RANGED';
}

export const ENEMY_PRESETS: Record<string, Partial<IEnemyConfig>> = {
  mob: {
    maxHp: 100,
    speed: 3.5,
    scale: 0.85,
    hudColor: '#ef4444',
    behaviorType: 'MELEE'
  },
  elite: {
    maxHp: 250,
    speed: 3.2,
    scale: 1.25,
    hudColor: '#f97316',
    behaviorType: 'MELEE'
  },
  raid_boss: {
    maxHp: 2000,
    speed: 2.8,
    scale: 2.4,
    hudColor: '#a855f7',
    behaviorType: 'MELEE'
  },
  world_boss: {
    maxHp: 10000,
    speed: 2.2,
    scale: 4.2,
    hudColor: '#ec4899',
    behaviorType: 'MELEE'
  }
};
