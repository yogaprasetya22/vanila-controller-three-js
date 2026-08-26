export interface SkillConfigData {
  id: string;
  name: string;
  cooldown: number;
  damage: number;
  radius: number;
  range: number;
  hudColor: string;
  iconPath: string;
}

export const SKILL_CONFIGS: Record<string, SkillConfigData> = {
  Digit1: {
    id: 'Digit1',
    name: 'Arrow Volley',
    cooldown: 0,
    damage: 12000,
    radius: 4.5,
    range: 15.0,
    hudColor: '#22c55e',
    iconPath: '/assets-image-skills/PNG/3.png'
  },
  Digit2: {
    id: 'Digit2',
    name: 'Double Shot',
    cooldown: 0,
    damage: 12000,
    radius: 1.0,
    range: 16.0,
    hudColor: '#3b82f6',
    iconPath: '/assets-image-skills/PNG/6.png'
  },
  Digit3: {
    id: 'Digit3',
    name: 'Evasive Leap',
    cooldown: 0,
    damage: 0,
    radius: 0,
    range: 8.0,
    hudColor: '#eab308',
    iconPath: '/assets-image-skills/PNG/4.png'
  }
};
