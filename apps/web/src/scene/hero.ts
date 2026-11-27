import * as THREE from "three";
import { HDRLoader } from "three/addons/loaders/HDRLoader.js";

export interface HeroOptions {
  canvas: HTMLCanvasElement;
  display: HTMLCanvasElement;
  /** Poster mode: one frame, no idle motion. Used to render the fallback image. */
  still?: boolean;
  onReady?: () => void;
}

export interface Hero {
  setDisplay(): void;
  flyIn(): Promise<void>;
  flyOut(): Promise<void>;
  pause(): void;
  resume(): void;
  dispose(): void;
}

const HDR_URL = "media/scene/bryanston-park-sunrise-1k.hdr";
const SCENE_URL = "media/scene/outdoor-scene.jpg";
const FRAME_COLOR = 0x3c4145;
const LENS_GREEN = 0x8dffb5;

const easeInOut = (t: number): number =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

function asset(path: string): string {
  return new URL(path, document.baseURI).toString();
}

function gradientTexture(
  size: number,
  stops: Array<[number, string]>,
): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D is unavailable");
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [offset, color] of stops) gradient.addColorStop(offset, color);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function brushedTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D is unavailable");
  ctx.fillStyle = "#8a8a86";
  ctx.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 2200; i++) {
    const y = Math.random() * 512;
    const length = 20 + Math.random() * 210;
    const x = Math.random() * 512;
    const tone = 105 + Math.floor(Math.random() * 70);
    ctx.strokeStyle = `rgba(${tone}, ${tone}, ${tone - 2}, ${0.06 + Math.random() * 0.14})`;
    ctx.lineWidth = 0.6 + Math.random() * 0.8;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + length, y + (Math.random() - 0.5) * 1.2);
    ctx.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(2, 1);
  return texture;
}

function contactShadowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D is unavailable");
  const gradient = ctx.createRadialGradient(128, 128, 2, 128, 128, 126);
  gradient.addColorStop(0, "rgba(0, 0, 0, 0.72)");
  gradient.addColorStop(0.28, "rgba(0, 0, 0, 0.4)");
  gradient.addColorStop(0.62, "rgba(0, 0, 0, 0.12)");
  gradient.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 256, 256);
  return new THREE.CanvasTexture(canvas);
}

/** Rounded rectangle with a different radius on each corner: [topLeft, topRight, bottomRight, bottomLeft]. */
function cornerRect(w: number, h: number, radii: [number, number, number, number]): THREE.Shape {
  const [tl, tr, br, bl] = radii;
  const x = -w / 2;
  const y = -h / 2;
  const shape = new THREE.Shape();
  shape.moveTo(x + tl, y + h);
  shape.lineTo(x + w - tr, y + h);
  shape.quadraticCurveTo(x + w, y + h, x + w, y + h - tr);
  shape.lineTo(x + w, y + br);
  shape.quadraticCurveTo(x + w, y, x + w - br, y);
  shape.lineTo(x + bl, y);
  shape.quadraticCurveTo(x, y, x, y + bl);
  shape.lineTo(x, y + h - tl);
  shape.quadraticCurveTo(x, y + h, x + tl, y + h);
  return shape;
}

function shapeToPath(shape: THREE.Shape, offsetY = 0): THREE.Path {
  const path = new THREE.Path();
  path.setFromPoints(shape.getPoints(48).map((p) => new THREE.Vector2(p.x, p.y + offsetY)));
  return path;
}

/**
 * Our own pair of smart glasses: a thin graphite browline frame with a slightly heavier brow, a
 * faint waveguide window in the wearer's right lens and a small projector on that temple.
 * Units are centimetres. Everything is geometry plus physical materials, no downloaded model.
 * The wearer's right lens is at -x, which is the lens on the left when the front faces you.
 */
function buildGlasses(desktop: boolean): { group: THREE.Group; displayAnchor: THREE.Object3D } {
  const group = new THREE.Group();
  const frameMaterial = new THREE.MeshPhysicalMaterial({
    color: 0x1d2123,
    metalness: 0.4,
    roughness: 0.34,
    clearcoat: 0.7,
    clearcoatRoughness: 0.22,
    envMapIntensity: 1.5,
  });
  const detailMaterial = new THREE.MeshPhysicalMaterial({
    color: 0x2a2f32,
    metalness: 0.85,
    roughness: 0.22,
    envMapIntensity: 1.6,
  });

  const lensW = 5.15;
  const lensH = 2.95;
  const rim = 0.1;
  const brow = 0.2;
  const centerX = lensW / 2 + 0.28;

  for (const side of [-1, 1]) {
    const outer = cornerRect(lensW, lensH, [0.55, 0.95, 1.55, 1.5]);
    const innerW = lensW - rim * 2;
    const innerH = lensH - rim - brow;
    const inner = cornerRect(innerW, innerH, [0.45, 0.85, 1.45, 1.4]);
    outer.holes.push(shapeToPath(inner, (brow - rim) / -2));
    const geometry = new THREE.ExtrudeGeometry(outer, {
      depth: 0.16,
      bevelEnabled: true,
      bevelThickness: 0.03,
      bevelSize: 0.03,
      bevelSegments: 4,
      curveSegments: 28,
    });
    geometry.center();
    const rimMesh = new THREE.Mesh(geometry, frameMaterial);
    rimMesh.position.set(side * centerX, 0, 0);
    group.add(rimMesh);

    const lensShape = cornerRect(innerW + 0.04, innerH + 0.04, [0.45, 0.85, 1.45, 1.4]);
    const lensGeometry = new THREE.ShapeGeometry(lensShape, 28);
    const position = lensGeometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < position.count; i++) {
      const x = position.getX(i);
      const y = position.getY(i);
      position.setZ(i, 0.07 * (1 - 0.5 * (x / (lensW / 2)) ** 2 - 0.3 * (y / (lensH / 2)) ** 2));
    }
    lensGeometry.computeVertexNormals();
    const lensMaterial = desktop
      ? new THREE.MeshPhysicalMaterial({
        color: 0xe3efe7,
        metalness: 0,
        roughness: 0.03,
        transmission: 0.96,
        thickness: 0.35,
        ior: 1.5,
        transparent: true,
        clearcoat: 1,
        clearcoatRoughness: 0.04,
        attenuationColor: new THREE.Color(0x9ec3a9),
        attenuationDistance: 2.4,
        envMapIntensity: 0.7,
      })
      : new THREE.MeshPhysicalMaterial({
        color: 0x0d1a12,
        metalness: 0.1,
        roughness: 0.05,
        transparent: true,
        opacity: 0.5,
        clearcoat: 1,
        envMapIntensity: 1.8,
      });
    const lens = new THREE.Mesh(lensGeometry, lensMaterial);
    lens.position.set(side * centerX, -(brow - rim) / 2 + 0.02, 0.02);
    lens.renderOrder = 1;
    group.add(lens);

    const sheenCanvas = document.createElement("canvas");
    sheenCanvas.width = 256;
    sheenCanvas.height = 128;
    const sheenCtx = sheenCanvas.getContext("2d");
    if (sheenCtx) {
      const g = sheenCtx.createLinearGradient(0, 0, 256, 128);
      g.addColorStop(0, "rgba(255,255,255,0.0)");
      g.addColorStop(0.32, "rgba(255,255,255,0.0)");
      g.addColorStop(0.42, "rgba(255,255,255,0.32)");
      g.addColorStop(0.5, "rgba(255,255,255,0.05)");
      g.addColorStop(0.56, "rgba(255,255,255,0.16)");
      g.addColorStop(0.66, "rgba(255,255,255,0)");
      g.addColorStop(1, "rgba(255,255,255,0)");
      sheenCtx.fillStyle = g;
      sheenCtx.fillRect(0, 0, 256, 128);
    }
    const sheen = new THREE.Mesh(
      new THREE.ShapeGeometry(lensShape, 12),
      new THREE.MeshBasicMaterial({
        map: new THREE.CanvasTexture(sheenCanvas),
        transparent: true,
        opacity: 0.22,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    // Map the gradient over the lens outline.
    const sheenPosition = sheen.geometry.attributes.position as THREE.BufferAttribute;
    const sheenUv = new Float32Array(sheenPosition.count * 2);
    for (let i = 0; i < sheenPosition.count; i++) {
      sheenUv[i * 2] = (sheenPosition.getX(i) + lensW / 2) / lensW;
      sheenUv[i * 2 + 1] = (sheenPosition.getY(i) + lensH / 2) / lensH;
    }
    sheen.geometry.setAttribute("uv", new THREE.BufferAttribute(sheenUv, 2));
    sheen.position.copy(lens.position);
    sheen.position.z += 0.11;
    sheen.renderOrder = 4;
    group.add(sheen);
  }

  /* Brow bar and bridge. */
  const browBar = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.075, centerX * 2 - lensW + 0.9, 6, 16),
    frameMaterial,
  );
  browBar.rotation.z = Math.PI / 2;
  browBar.position.set(0, lensH / 2 - 0.12, 0.0);
  group.add(browBar);
  const bridge = new THREE.Mesh(
    new THREE.TubeGeometry(
      new THREE.CatmullRomCurve3([
        new THREE.Vector3(-0.5, lensH / 2 - 0.3, 0),
        new THREE.Vector3(-0.2, lensH / 2 - 0.62, 0.05),
        new THREE.Vector3(0.2, lensH / 2 - 0.62, 0.05),
        new THREE.Vector3(0.5, lensH / 2 - 0.3, 0),
      ]),
      24,
      0.05,
      10,
    ),
    frameMaterial,
  );
  group.add(bridge);
  for (const side of [-1, 1]) {
    const pad = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.035, 0.28, 4, 8),
      new THREE.MeshPhysicalMaterial({ color: 0xc8c8c4, roughness: 0.4, transparent: true, opacity: 0.55 }),
    );
    pad.position.set(side * 0.46, lensH / 2 - 0.95, -0.12);
    pad.rotation.z = side * 0.35;
    group.add(pad);
  }

  /* Temples: hinge, a slim arm that sweeps back and bends behind the ear. */
  for (const side of [-1, 1]) {
    const hx = side * (centerX + lensW / 2 + 0.02);
    const hy = lensH / 2 - 0.34;
    const hinge = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.26, 18), detailMaterial);
    hinge.position.set(hx, hy, -0.04);
    group.add(hinge);
    const points = [
      new THREE.Vector3(hx, hy, -0.06),
      new THREE.Vector3(hx + side * 0.05, hy - 0.02, -1.2),
      new THREE.Vector3(hx + side * 0.08, hy - 0.06, -3.4),
      new THREE.Vector3(hx + side * 0.02, hy - 0.2, -5.4),
      new THREE.Vector3(hx - side * 0.1, hy - 0.62, -6.7),
      new THREE.Vector3(hx - side * 0.26, hy - 1.2, -7.1),
    ];
    const curve = new THREE.CatmullRomCurve3(points);
    const arm = new THREE.Mesh(new THREE.TubeGeometry(curve, 90, 0.075, 12), frameMaterial);
    group.add(arm);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.075, 14, 10), frameMaterial);
    tip.position.copy(points[points.length - 1] as THREE.Vector3);
    group.add(tip);
  }

  /* The projector module on the wearer's right temple (-x), with a point of green light. */
  const hxRight = -(centerX + lensW / 2 + 0.02);
  const module = new THREE.Mesh(new THREE.CapsuleGeometry(0.15, 1.6, 8, 18), detailMaterial);
  module.rotation.x = Math.PI / 2;
  module.scale.set(1, 1, 0.78);
  module.position.set(hxRight - 0.07, lensH / 2 - 0.5, -1.05);
  group.add(module);
  const led = new THREE.Mesh(
    new THREE.SphereGeometry(0.03, 12, 8),
    new THREE.MeshBasicMaterial({ color: LENS_GREEN, toneMapped: false }),
  );
  led.position.set(hxRight - 0.2, lensH / 2 - 0.5, -0.45);
  group.add(led);
  const ledGlow = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: gradientTexture(64, [
        [0, "rgba(141,255,181,0.9)"],
        [0.4, "rgba(100,255,160,0.25)"],
        [1, "rgba(70,255,140,0)"],
      ]),
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
      toneMapped: false,
    }),
  );
  ledGlow.scale.set(0.42, 0.42, 1);
  ledGlow.position.copy(led.position);
  group.add(ledGlow);

  const displayAnchor = new THREE.Object3D();
  displayAnchor.position.set(-centerX + 0.04, 0.0, 0.12);
  group.add(displayAnchor);
  return { group, displayAnchor };
}

function buildRing(desktop: boolean): { group: THREE.Group; led: THREE.Object3D } {
  const group = new THREE.Group();
  const profile: THREE.Vector2[] = [
    new THREE.Vector2(0.86, 0.2),
    new THREE.Vector2(0.855, -0.2),
    new THREE.Vector2(0.885, -0.31),
    new THREE.Vector2(0.955, -0.345),
    new THREE.Vector2(1.025, -0.31),
    new THREE.Vector2(1.06, -0.18),
    new THREE.Vector2(1.06, 0.18),
    new THREE.Vector2(1.025, 0.31),
    new THREE.Vector2(0.955, 0.345),
    new THREE.Vector2(0.885, 0.31),
    new THREE.Vector2(0.86, 0.2),
  ];
  const geometry = new THREE.LatheGeometry(profile, desktop ? 180 : 96);
  const material = new THREE.MeshPhysicalMaterial({
    color: 0x8e8b83,
    metalness: 1,
    roughness: 0.7,
    roughnessMap: brushedTexture(),
    bumpMap: brushedTexture(),
    bumpScale: 0.012,
    envMapIntensity: 1.05,
    clearcoat: 0.1,
    clearcoatRoughness: 0.38,
  });
  const band = new THREE.Mesh(geometry, material);
  band.rotation.x = Math.PI / 2;
  group.add(band);

  const sensor = new THREE.Mesh(
    new THREE.SphereGeometry(0.15, 22, 16),
    new THREE.MeshPhysicalMaterial({
      color: 0x0e1711,
      metalness: 0.4,
      roughness: 0.12,
      clearcoat: 1,
      clearcoatRoughness: 0.08,
      envMapIntensity: 1.2,
    }),
  );
  sensor.scale.set(1.45, 0.62, 0.8);
  sensor.position.set(0, -0.84, 0.01);
  group.add(sensor);

  const led = new THREE.Mesh(
    new THREE.SphereGeometry(0.043, 16, 12),
    new THREE.MeshBasicMaterial({ color: LENS_GREEN, toneMapped: false }),
  );
  led.position.set(0.18, 0.97, 0.24);
  group.add(led);

  const glow = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: gradientTexture(128, [
        [0, "rgba(141, 255, 181, 0.95)"],
        [0.25, "rgba(100, 255, 160, 0.42)"],
        [0.6, "rgba(70, 255, 140, 0.12)"],
        [1, "rgba(70, 255, 140, 0)"],
      ]),
      color: 0xffffff,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
      toneMapped: false,
    }),
  );
  glow.scale.set(0.42, 0.42, 1);
  glow.position.copy(led.position);
  group.add(glow);

  return { group, led };
}

export async function createHero(options: HeroOptions): Promise<Hero> {
  const desktop = !matchMedia("(max-width: 720px)").matches;
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const renderer = new THREE.WebGLRenderer({
    canvas: options.canvas,
    antialias: desktop,
    alpha: false,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.14;
  renderer.setClearColor(0x070807, 1);
  renderer.transmissionResolutionScale = desktop ? 0.55 : 0.35;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(desktop ? 30 : 34, 1, 0.1, 120);

  const [backdropTexture, hdr] = await Promise.all([
    new THREE.TextureLoader().loadAsync(asset(SCENE_URL)),
    new HDRLoader().loadAsync(asset(HDR_URL)),
  ]);
  backdropTexture.colorSpace = THREE.SRGBColorSpace;
  const backdrop = new THREE.Mesh(
    new THREE.PlaneGeometry(110, 61.875),
    new THREE.MeshBasicMaterial({
      map: backdropTexture,
      color: 0xffffff,
      toneMapped: false,
      depthWrite: false,
    }),
  );
  backdrop.position.set(0, 0, -42);
  backdrop.renderOrder = -10;
  scene.add(backdrop);

  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const envMap = pmrem.fromEquirectangular(hdr).texture;
  scene.environment = envMap;
  scene.environmentIntensity = 1.1;
  hdr.dispose();
  pmrem.dispose();

  const key = new THREE.DirectionalLight(0xfff0d8, 3.4);
  key.position.set(-7, 9, 10);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xc8ddff, 3.4);
  rim.position.set(8, 4, -9);
  scene.add(rim);
  const bounce = new THREE.HemisphereLight(0xe8f1df, 0x47543d, 0.55);
  scene.add(bounce);
  const faceFill = new THREE.DirectionalLight(0xfff6e8, 1.5);
  faceFill.position.set(2, 3, 12);
  scene.add(faceFill);

  const product = new THREE.Group();
  scene.add(product);

  const { group: glasses, displayAnchor } = buildGlasses(desktop);
  glasses.rotation.set(0.12, 0.62, -0.035);
  product.add(glasses);

  const { group: ring } = buildRing(desktop);
  ring.rotation.set(0.42, -0.72, 0.18);
  product.add(ring);

  if (desktop) {
    product.position.set(4.6, 1.5, 0);
    product.scale.setScalar(0.9);
    ring.position.set(2.6, -3.4, 3.4);
    ring.scale.setScalar(0.92);
  } else {
    product.position.set(0.1, 1.4, 0);
    product.scale.setScalar(0.62);
    glasses.rotation.y = 0.5;
    ring.position.set(2.4, -3.9, 2.6);
    ring.scale.setScalar(0.95);
  }

  const shadowTexture = contactShadowTexture();
  const shadowMaterial = new THREE.MeshBasicMaterial({
    map: shadowTexture,
    transparent: true,
    depthWrite: false,
    opacity: 0.62,
    toneMapped: false,
  });
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(13, 6), shadowMaterial);
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.set(1.4, -4.4, 0.2);
  scene.add(shadow);
  const ringShadow = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 2.1), shadowMaterial);
  ringShadow.rotation.x = -Math.PI / 2;
  ringShadow.position.set(ring.position.x + product.position.x, -4.4, ring.position.z);
  scene.add(ringShadow);

  const displayTexture = new THREE.CanvasTexture(options.display);
  displayTexture.colorSpace = THREE.SRGBColorSpace;
  displayTexture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  displayTexture.needsUpdate = true;

  const displayGeometry = new THREE.PlaneGeometry(3.78, 1.89, 24, 12);
  const displayPosition = displayGeometry.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < displayPosition.count; i++) {
    const x = displayPosition.getX(i);
    const y = displayPosition.getY(i);
    displayPosition.setZ(i, 0.018 * (1 - 0.35 * (x / 1.79) ** 2 - 0.35 * (y / 0.9) ** 2));
  }
  displayGeometry.computeVertexNormals();
  const display = new THREE.Mesh(
    displayGeometry,
    new THREE.MeshBasicMaterial({
      map: displayTexture,
      transparent: true,
      opacity: 1,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
      side: THREE.DoubleSide,
    }),
  );
  display.position.copy(displayAnchor.position);
  display.renderOrder = 3;
  glasses.add(display);

  const waveguideGlow = new THREE.Mesh(
    new THREE.PlaneGeometry(4.1, 2.2),
    new THREE.MeshBasicMaterial({
      map: gradientTexture(256, [
        [0, "rgba(141, 255, 181, 0.26)"],
        [0.5, "rgba(70, 220, 120, 0.08)"],
        [1, "rgba(70, 220, 120, 0)"],
      ]),
      transparent: true,
      opacity: 0.5,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
      side: THREE.DoubleSide,
    }),
  );
  waveguideGlow.position.copy(displayAnchor.position);
  waveguideGlow.position.z -= 0.01;
  waveguideGlow.renderOrder = 2;
  glasses.add(waveguideGlow);

  /* The faint edge of the waveguide window, the way a lit combiner shows in the lens. */
  const windowCanvas = document.createElement("canvas");
  windowCanvas.width = 512;
  windowCanvas.height = 288;
  const windowCtx = windowCanvas.getContext("2d");
  if (windowCtx) {
    windowCtx.shadowColor = "rgba(141,255,181,0.9)";
    windowCtx.shadowBlur = 14;
    windowCtx.strokeStyle = "rgba(160,255,196,0.55)";
    windowCtx.lineWidth = 2;
    windowCtx.beginPath();
    windowCtx.roundRect(26, 26, 460, 236, 26);
    windowCtx.stroke();
  }
  const windowTexture = new THREE.CanvasTexture(windowCanvas);
  windowTexture.colorSpace = THREE.SRGBColorSpace;
  const waveguideWindow = new THREE.Mesh(
    new THREE.PlaneGeometry(4.3, 2.42),
    new THREE.MeshBasicMaterial({
      map: windowTexture,
      transparent: true,
      opacity: 0.42,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
      side: THREE.DoubleSide,
    }),
  );
  waveguideWindow.position.copy(displayAnchor.position);
  waveguideWindow.position.z -= 0.005;
  waveguideWindow.renderOrder = 2;
  glasses.add(waveguideWindow);

  const homePosition = new THREE.Vector3(
    desktop ? 0 : 0.2,
    desktop ? 1.25 : 1.0,
    desktop ? 21.5 : 28.5,
  );
  const homeTarget = new THREE.Vector3(desktop ? 1.15 : 0.15, desktop ? 0.1 : 0.25, 0);
  const focusPosition = new THREE.Vector3();
  const focusTarget = new THREE.Vector3();
  const cameraPosition = homePosition.clone();
  const cameraTarget = homeTarget.clone();
  const desiredPosition = homePosition.clone();
  const desiredTarget = homeTarget.clone();

  let pointerX = 0;
  let pointerY = 0;
  let ready = false;
  let running = false;
  let flying: { from: "home" | "lens"; start: number; duration: number; resolve: () => void } | null = null;
  let paused = false;
  const startTime = performance.now();

  function resize(): void {
    const width = options.canvas.clientWidth || window.innerWidth;
    const height = options.canvas.clientHeight || window.innerHeight;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height, false);
    camera.aspect = width / Math.max(1, height);
    camera.updateProjectionMatrix();
    scene.updateMatrixWorld(true);
  }

  const restRotation = glasses.rotation.clone();
  const restPosition = new THREE.Vector3();

  function computeFocus(): void {
    // Straighten the glasses first: the first-person view looks at the display head on.
    const keep = glasses.rotation.clone();
    glasses.rotation.set(0, 0, 0);
    scene.updateMatrixWorld(true);
    const world = new THREE.Vector3();
    displayAnchor.getWorldPosition(world);
    const normal = new THREE.Vector3(0, 0, 1);
    const widthWorld = 3.78 * product.scale.x;
    const halfFov = THREE.MathUtils.degToRad(camera.fov / 2);
    const visibleWidth = (widthWorld / 0.6);
    const distance = visibleWidth / (2 * Math.tan(halfFov) * Math.max(0.4, camera.aspect));
    focusTarget.copy(world);
    focusPosition.copy(world).addScaledVector(normal, distance);
    restPosition.copy(world);
    glasses.rotation.copy(keep);
    scene.updateMatrixWorld(true);
  }

  function applyPointer(): void {
    if (!desktop || reduceMotion || flying) return;
    desiredPosition.copy(homePosition);
    desiredTarget.copy(homeTarget);
    desiredPosition.x += pointerX * 0.62;
    desiredPosition.y += pointerY * 0.34;
    desiredTarget.x += pointerX * 0.18;
    desiredTarget.y += pointerY * 0.1;
  }

  function frame(): void {
    if (!running) return;
    const now = performance.now();
    const t = (now - startTime) / 1000;
    if (!options.still && !flying) {
      product.rotation.y = Math.sin(t * 0.14) * (desktop ? 0.055 : 0.035);
      product.rotation.x = Math.sin(t * 0.1 + 1.7) * 0.012;
    }
    if (flying) {
      const progress = Math.min(1, (now - flying.start) / flying.duration);
      const eased = easeInOut(progress);
      const turn = flying.from === "home" ? eased : 1 - eased;
      glasses.rotation.set(
        restRotation.x * (1 - turn),
        restRotation.y * (1 - turn),
        restRotation.z * (1 - turn),
      );
      if (flying.from === "home") {
        cameraPosition.lerpVectors(homePosition, focusPosition, eased);
        cameraTarget.lerpVectors(homeTarget, focusTarget, eased);
      } else {
        cameraPosition.lerpVectors(focusPosition, homePosition, eased);
        cameraTarget.lerpVectors(focusTarget, homeTarget, eased);
      }
      if (progress >= 1) {
        const done = flying.resolve;
        flying = null;
        done();
      }
    } else if (!options.still) {
      applyPointer();
      cameraPosition.lerp(desiredPosition, 0.045);
      cameraTarget.lerp(desiredTarget, 0.045);
    }
    camera.position.copy(cameraPosition);
    camera.lookAt(cameraTarget);
    renderer.render(scene, camera);
  }

  function start(): void {
    if (running || paused) return;
    running = true;
    renderer.setAnimationLoop(frame);
  }

  function stop(): void {
    running = false;
    renderer.setAnimationLoop(null);
  }

  const observer = new IntersectionObserver(
    (entries) => {
      const visible = entries.some((entry) => entry.isIntersecting);
      if (visible) start();
      else stop();
    },
    { threshold: 0.01 },
  );
  observer.observe(options.canvas);

  const onVisibility = (): void => {
    if (document.visibilityState === "hidden") stop();
    else if (!paused) start();
  };
  document.addEventListener("visibilitychange", onVisibility);

  const onPointerMove = (event: PointerEvent): void => {
    if (event.pointerType !== "mouse") return;
    pointerX = (event.clientX / window.innerWidth) * 2 - 1;
    pointerY = (event.clientY / window.innerHeight) * 2 - 1;
  };
  window.addEventListener("pointermove", onPointerMove, { passive: true });

  const onResize = (): void => {
    resize();
    computeFocus();
    cameraPosition.copy(desiredPosition);
    cameraTarget.copy(desiredTarget);
    camera.position.copy(cameraPosition);
    camera.lookAt(cameraTarget);
    renderer.render(scene, camera);
  };
  window.addEventListener("resize", onResize);
  resize();
  computeFocus();
  camera.position.copy(homePosition);
  camera.lookAt(homeTarget);
  renderer.compile(scene, camera);
  renderer.render(scene, camera);
  ready = true;
  start();
  options.onReady?.();

  return {
    setDisplay() {
      displayTexture.needsUpdate = true;
    },
    flyIn(): Promise<void> {
      if (reduceMotion || !ready) return Promise.resolve();
      computeFocus();
      return new Promise((resolve) => {
        flying = { from: "home", start: performance.now(), duration: 920, resolve };
        start();
      });
    },
    flyOut(): Promise<void> {
      if (reduceMotion || !ready) return Promise.resolve();
      return new Promise((resolve) => {
        flying = { from: "lens", start: performance.now(), duration: 760, resolve };
        start();
      });
    },
    pause() {
      paused = true;
      stop();
    },
    resume() {
      paused = false;
      start();
    },
    dispose() {
      stop();
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("resize", onResize);
      renderer.dispose();
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          for (const material of materials) {
            for (const value of Object.values(material)) {
              if (value instanceof THREE.Texture) value.dispose();
            }
            material.dispose();
          }
        }
      });
    },
  };
}
