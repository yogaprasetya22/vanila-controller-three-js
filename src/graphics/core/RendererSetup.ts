import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { setCamera } from './scene';

export class RendererSetup {
  public static renderer: THREE.WebGLRenderer;
  public static camera: THREE.PerspectiveCamera;
  public static controls: OrbitControls;
  public static ambientLight: THREE.AmbientLight;
  public static dirLight: THREE.DirectionalLight;

  public static init(scene: THREE.Scene, container: HTMLDivElement) {
    const isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);

    this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 450);
    setCamera(this.camera);
    this.camera.position.set(0, 15, 30);

    this.renderer = new THREE.WebGLRenderer({
      antialias: !isMobile,
      powerPreference: 'high-performance',
      precision: 'mediump',
      stencil: false,
      alpha: false,
      depth: true
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(isMobile ? 1.0 : Math.min(window.devicePixelRatio, 1.5));
    this.renderer.setClearColor(scene.fog!.color);
    this.renderer.autoClear = false;
    container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.05;
    this.controls.mouseButtons = { LEFT: -1 as any, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
    this.controls.enabled = false;

    this.ambientLight = new THREE.AmbientLight(0x444444);
    scene.add(this.ambientLight);

    this.dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    this.dirLight.position.set(10, 20, 10);
    scene.add(this.dirLight);

    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    });
  }

  public static render(scene: THREE.Scene) {
    this.renderer.clear();
    this.renderer.render(scene, this.camera);
  }
}
