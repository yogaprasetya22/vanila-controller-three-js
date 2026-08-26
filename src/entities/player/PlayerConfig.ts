export const CHARACTER_CONFIG = {
  // Movement & Physics parameters
  physics: {
    speed: 6.0,                  // Base walk speed (m/s)
    sprintMultiplier: 1.2,       // Speed multiplier when Shift is held
    jumpForce: 10.0,             // Vertical impulse force on jump
    gravity: -28.0,              // Gravity acceleration (m/s^2)
    friction: 12.0,              // Rotation interpolation alignment lerp speed
    dodgeCooldown: 0.5,          // Cooldown between dodges (seconds)
  },

  // Combat stats (Authoritative, synced dynamically from Go server on handshake)
  combat: {
    baseAttackSpeed: 0,
    rateOfFire: 0,
    autoAimRange: 0,
    attackAnimScale: 0,
    attackLockDuration: 0,
  },

  // Projectile system parameters
  projectiles: {
    speed: 40.0,                 // Flight speed of arrow (m/s)
    maxDistance: 15.0,           // Range limit before projectile dissolves (meters)
    heightOffset: 1.1,           // Height offset from character origin to spawn arrow (meters)
    homingSteerForce: 8.0,       // Interpolation steer strength towards target dummy
    glowColor: 0x00d2ff,         // Hex glow color of GLSL projectile
  },

  // Skills configs
  skills: {
    arrowVolley: {
      cooldown: 0,
      key: 'Digit1',
      hudColor: '#ef4444',       // Red for Arrow Volley
      damage: 150000,
      radius: 4.5,
      forwardOffset: 6.0,
    },
    doubleShot: {
      cooldown: 0,
      key: 'Digit2',
      hudColor: '#10b981',       // Green for Double Shot
      damage: 60000,
      forwardOffset: 1.0,
    },
    evasiveLeap: {
      cooldown: 0,
      key: 'Digit3',
      hudColor: '#3b82f6',       // Blue for Evasive Leap
      damage: 0,
      forwardOffset: 3.0,
      activeDuration: 0.6,
      speedMultiplier: 2.2,
    },
    tornado: {
      cooldown: 12.0,
      key: 'Digit3',
      hudColor: '#00d2ff',
      damage: 180000,
      radius: 3.0,
      activeDuration: 13.5,
    },
    gasExplosion: {
      cooldown: 6.0,
      key: 'Digit1',
      forwardOffset: 4.0,
      hudColor: '#00ffaa',
      damage: 90000,
      radius: 5.0,
    },
    flamethrower: {
      cooldown: 18.0,
      key: 'Digit2',
      forwardOffset: 1.5,
      activeDuration: 12.0,
      speedMultiplier: 1.5,
      hudColor: '#ffaa00',
      damage: 8000,
      radius: 3.0,
    }
  },
  // NPCs configs
  npcs: {
    mob: {
      modelPath: '/character/characters/Skeleton_Minion.glb',
      scale: 1.0,
      hudColor: '#10b981', // Green for mob
    },
    raid_boss: {
      modelPath: '/character/characters/Knight.glb',
      scale: 2.0,
      hudColor: '#f59e0b', // Orange for Raid Boss
    },
    world_boss: {
      modelPath: '/character/characters/Barbarian.glb',
      scale: 3.5,
      hudColor: '#ef4444', // Red for World Boss
    }
  }
};
