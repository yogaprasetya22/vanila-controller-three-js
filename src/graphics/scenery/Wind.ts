import * as THREE from 'three';

export class Wind {
  private static instance: Wind | null = null;
  
  public direction = new THREE.Vector2(0.85, 0.52).normalize(); // Default wind direction
  public strength = 0.6;
  public localTime = 0;
  public timeFrequency = 1.2;

  constructor() {
    if (Wind.instance) return Wind.instance;
    Wind.instance = this;
  }

  public static getInstance(): Wind {
    if (!Wind.instance) {
      Wind.instance = new Wind();
    }
    return Wind.instance;
  }

  public update(delta: number) {
    // Accumulate time based on timeFrequency and wind strength
    this.localTime += delta * this.timeFrequency * (0.3 + this.strength * 0.7);
  }
}

export const globalWind = Wind.getInstance();
