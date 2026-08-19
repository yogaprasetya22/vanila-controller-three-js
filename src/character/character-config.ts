export const CHARACTER_CONFIG = {
  // Movement & Physics parameters
  physics: {
    speed: 6.0,                  // Base walk speed (m/s)
    sprintMultiplier: 1.2,       // Speed multiplier when Shift is held
    jumpForce: 10.0,             // Vertical impulse force on jump
    gravity: -28.0,              // Gravity acceleration (m/s^2)
    friction: 12.0,              // Rotation interpolation alignment lerp speed
    dodgeCooldown: 1.0,          // Cooldown between dodges (seconds)
  },

  // Combat stats
  combat: {
    baseAttackSpeed: 193,         // Target MMORPG Attack Speed rating (193 ASPD)
    rateOfFire: 0.14,            // Cooldown between basic attacks (seconds, 7 attacks/sec)
    autoAimRange: 30.0,          // Auto-aim dummy search range limit (meters)
    attackAnimScale: 6.0,        // Speed multiplier for basic attack animation clip
    attackLockDuration: 0.12,    // Animation lock duration for basic attacks (seconds)
    damage: 18000,                 // Damage for basic attack arrow
    critChance: 0.60,            // Hero critical strike chance (60%)
    critDamage: 2.0,             // Hero critical strike multiplier (2.0x)
  },

  // Projectile system parameters
  projectiles: {
    speed: 40.0,                 // Flight speed of arrow (m/s)
    maxDistance: 60.0,           // Range limit before projectile dissolves (meters)
    heightOffset: 1.1,           // Height offset from character origin to spawn arrow (meters)
    homingSteerForce: 8.0,       // Interpolation steer strength towards target dummy
    glowColor: 0x00d2ff,         // Hex glow color of GLSL projectile
  },

  // Skills configs
  skills: {
    tornado: {
      cooldown: 12.0,             // Cooldown in seconds (disesuaikan)
      key: 'Digit3',
      hudColor: '#00d2ff',       // Cyan/Blue border color for tornado
      damage: 120000,              // AoE damage
      radius: 6.0,               // AoE radius
    },
    gasExplosion: {
      cooldown: 6.0,             // Cooldown in seconds (disesuaikan)
      key: 'Digit1',
      forwardOffset: 4.0,        // Distance in front of character to spawn explosion
      hudColor: '#00ffaa',       // Bright Teal/Green for gas explosion
      damage: 35000,              // AoE damage
      radius: 5.0,               // AoE radius
    },
    flamethrower: {
      cooldown: 18.0,             // Cooldown in seconds (disesuaikan)
      key: 'Digit2',
      forwardOffset: 1.5,        // Distance offset
      activeDuration: 12.0,      // Duration of the flamethrower spray (seconds)
      speedMultiplier: 1.5,      // Speed multiplier when casting
      hudColor: '#ffaa00',       // Orange/Yellow for flamethrower
      damage: 8000,               // AoE damage
      radius: 3.0,               // AoE radius
    }
  }
};
