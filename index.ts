const WIDTH = 64;
const HEIGHT = 64;
const MAX_BOUNCES = 5;
const MOTION_SAMPLES = 15;
const DENOISE_UNTIL_SAMPLES = 24;
const EPSILON = 0.001;

type Vec3 = Readonly<{ x: number; y: number; z: number }>;
type MaterialKind = "diffuse" | "metal" | "glass" | "emissive";

type Material = Readonly<{
  kind: MaterialKind;
  color: Vec3;
  roughness?: number;
  ior?: number;
  emission?: number;
}>;

type Sphere = Readonly<{
  center: Vec3;
  radius: number;
  material: Material;
}>;

type Ray = Readonly<{ origin: Vec3; direction: Vec3 }>;

type Hit = {
  distance: number;
  point: Vec3;
  normal: Vec3;
  frontFace: boolean;
  material: Material;
};

const v = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });
const add = (a: Vec3, b: Vec3): Vec3 => v(a.x + b.x, a.y + b.y, a.z + b.z);
const sub = (a: Vec3, b: Vec3): Vec3 => v(a.x - b.x, a.y - b.y, a.z - b.z);
const mul = (a: Vec3, scalar: number): Vec3 => v(a.x * scalar, a.y * scalar, a.z * scalar);
const multiply = (a: Vec3, b: Vec3): Vec3 => v(a.x * b.x, a.y * b.y, a.z * b.z);
const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: Vec3, b: Vec3): Vec3 =>
  v(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
const length = (a: Vec3): number => Math.sqrt(dot(a, a));
const normalize = (a: Vec3): Vec3 => mul(a, 1 / Math.max(length(a), Number.EPSILON));
const reflect = (direction: Vec3, normal: Vec3): Vec3 =>
  sub(direction, mul(normal, 2 * dot(direction, normal)));
const lerp = (a: Vec3, b: Vec3, amount: number): Vec3 =>
  add(mul(a, 1 - amount), mul(b, amount));

const materials = {
  coral: { kind: "diffuse", color: v(0.9, 0.16, 0.09) },
  blue: { kind: "diffuse", color: v(0.08, 0.25, 0.8) },
  gold: { kind: "metal", color: v(1.0, 0.67, 0.18), roughness: 0.12 },
  chrome: { kind: "metal", color: v(0.92, 0.96, 1.0), roughness: 0.025 },
  glass: { kind: "glass", color: v(0.93, 0.98, 1.0), ior: 1.5 },
  light: { kind: "emissive", color: v(1.0, 0.82, 0.58), emission: 9 },
} satisfies Record<string, Material>;

const lightSphere: Sphere = {
  center: v(-2.2, 3.2, 0.4),
  radius: 0.36,
  material: materials.light,
};

const spheres: readonly Sphere[] = [
  { center: v(-1.25, -0.18, -1.25), radius: 0.82, material: materials.coral },
  { center: v(0.15, -0.45, -0.45), radius: 0.55, material: materials.glass },
  { center: v(1.25, -0.35, -1.55), radius: 0.65, material: materials.gold },
  { center: v(0.05, 0.55, -2.25), radius: 0.48, material: materials.chrome },
  { center: v(2.25, -0.55, -2.75), radius: 0.45, material: materials.blue },
  lightSphere,
];

let randomState = 1;

function random(): number {
  randomState ^= randomState << 13;
  randomState ^= randomState >>> 17;
  randomState ^= randomState << 5;
  return (randomState >>> 0) / 4294967296;
}

function randomUnitVector(): Vec3 {
  const z = random() * 2 - 1;
  const angle = random() * Math.PI * 2;
  const radius = Math.sqrt(Math.max(0, 1 - z * z));
  return v(radius * Math.cos(angle), radius * Math.sin(angle), z);
}

function cosineHemisphere(normal: Vec3): Vec3 {
  const helper = Math.abs(normal.x) > 0.9 ? v(0, 1, 0) : v(1, 0, 0);
  const tangent = normalize(cross(helper, normal));
  const bitangent = cross(normal, tangent);
  const angle = random() * Math.PI * 2;
  const radius = Math.sqrt(random());
  const local = v(
    radius * Math.cos(angle),
    Math.sqrt(Math.max(0, 1 - radius * radius)),
    radius * Math.sin(angle),
  );
  return normalize(add(add(mul(tangent, local.x), mul(normal, local.y)), mul(bitangent, local.z)));
}

function sphereHit(ray: Ray, sphere: Sphere, minDistance: number, maxDistance: number): Hit | null {
  const offset = sub(ray.origin, sphere.center);
  const halfB = dot(offset, ray.direction);
  const discriminant = halfB * halfB - (dot(offset, offset) - sphere.radius * sphere.radius);

  if (discriminant < 0) return null;

  const root = Math.sqrt(discriminant);
  let distance = -halfB - root;
  if (distance <= minDistance || distance >= maxDistance) {
    distance = -halfB + root;
    if (distance <= minDistance || distance >= maxDistance) return null;
  }

  const point = add(ray.origin, mul(ray.direction, distance));
  const outwardNormal = mul(sub(point, sphere.center), 1 / sphere.radius);
  const frontFace = dot(ray.direction, outwardNormal) < 0;

  return {
    distance,
    point,
    normal: frontFace ? outwardNormal : mul(outwardNormal, -1),
    frontFace,
    material: sphere.material,
  };
}

function groundHit(ray: Ray, minDistance: number, maxDistance: number): Hit | null {
  if (Math.abs(ray.direction.y) < 1e-6) return null;
  const distance = (-1 - ray.origin.y) / ray.direction.y;
  if (distance <= minDistance || distance >= maxDistance) return null;

  const point = add(ray.origin, mul(ray.direction, distance));
  const tile = (Math.floor(point.x) + Math.floor(point.z)) & 1;
  const rings = Math.sin(point.x * 0.7) * Math.sin(point.z * 0.7) * 0.025;
  const base = tile === 0 ? 0.72 + rings : 0.13 + rings;
  const material: Material = { kind: "diffuse", color: v(base, base * 0.98, base * 0.92) };
  const outwardNormal = v(0, 1, 0);
  const frontFace = dot(ray.direction, outwardNormal) < 0;

  return {
    distance,
    point,
    normal: frontFace ? outwardNormal : mul(outwardNormal, -1),
    frontFace,
    material,
  };
}

function sceneHit(ray: Ray, minDistance = EPSILON, maxDistance = Infinity): Hit | null {
  let closest = maxDistance;
  let closestHit: Hit | null = groundHit(ray, minDistance, closest);
  if (closestHit) closest = closestHit.distance;

  for (const sphere of spheres) {
    const hit = sphereHit(ray, sphere, minDistance, closest);
    if (hit) {
      closest = hit.distance;
      closestHit = hit;
    }
  }

  return closestHit;
}

function refract(direction: Vec3, normal: Vec3, eta: number): Vec3 {
  const cosTheta = Math.min(dot(mul(direction, -1), normal), 1);
  const perpendicular = mul(add(direction, mul(normal, cosTheta)), eta);
  const parallel = mul(normal, -Math.sqrt(Math.abs(1 - dot(perpendicular, perpendicular))));
  return add(perpendicular, parallel);
}

function schlick(cosine: number, ior: number): number {
  const r = ((1 - ior) / (1 + ior)) ** 2;
  return r + (1 - r) * (1 - cosine) ** 5;
}

function directLight(hit: Hit, lightSample: Vec3): Vec3 {
  const toLight = sub(lightSample, hit.point);
  const distanceSquared = dot(toLight, toLight);
  const distanceToLight = Math.sqrt(distanceSquared);
  const lightDirection = mul(toLight, 1 / distanceToLight);
  const cosine = Math.max(0, dot(hit.normal, lightDirection));
  if (cosine <= 0) return v();

  const shadowOrigin = add(hit.point, mul(hit.normal, EPSILON * 2));
  const blocker = sceneHit({ origin: shadowOrigin, direction: lightDirection }, EPSILON, distanceToLight);
  if (blocker && blocker.material.kind !== "emissive") return v();

  const intensity = (lightSphere.material.emission ?? 0) * 3.2;
  return mul(lightSphere.material.color, (cosine * intensity) / Math.max(1, distanceSquared));
}

function sampleLight(hit: Hit): Vec3 {
  return directLight(hit, add(lightSphere.center, mul(randomUnitVector(), lightSphere.radius)));
}

function sky(direction: Vec3): Vec3 {
  const gradient = Math.max(0, direction.y * 0.5 + 0.5);
  const horizon = v(0.74, 0.82, 0.94);
  const zenith = v(0.06, 0.12, 0.25);
  return lerp(horizon, zenith, gradient ** 0.65);
}

function trace(initialRay: Ray): Vec3 {
  let ray = initialRay;
  let throughput = v(1, 1, 1);
  let radiance = v();

  for (let bounce = 0; bounce < MAX_BOUNCES; bounce += 1) {
    const hit = sceneHit(ray);
    if (!hit) {
      radiance = add(radiance, multiply(throughput, sky(ray.direction)));
      break;
    }

    if (hit.material.kind === "emissive") {
      radiance = add(
        radiance,
        mul(multiply(throughput, hit.material.color), hit.material.emission ?? 1),
      );
      break;
    }

    if (hit.material.kind === "diffuse") {
      const direct = sampleLight(hit);
      radiance = add(radiance, multiply(throughput, multiply(hit.material.color, direct)));
      throughput = multiply(throughput, hit.material.color);
      ray = {
        origin: add(hit.point, mul(hit.normal, EPSILON * 2)),
        direction: cosineHemisphere(hit.normal),
      };
    } else if (hit.material.kind === "metal") {
      const roughness = hit.material.roughness ?? 0;
      const reflected = reflect(ray.direction, hit.normal);
      const scattered = normalize(add(reflected, mul(randomUnitVector(), roughness)));
      if (dot(scattered, hit.normal) <= 0) break;
      throughput = multiply(throughput, hit.material.color);
      ray = {
        origin: add(hit.point, mul(hit.normal, EPSILON * 2)),
        direction: scattered,
      };
    } else {
      const ior = hit.material.ior ?? 1.5;
      const eta = hit.frontFace ? 1 / ior : ior;
      const cosine = Math.min(dot(mul(ray.direction, -1), hit.normal), 1);
      const cannotRefract = eta * Math.sqrt(Math.max(0, 1 - cosine * cosine)) > 1;
      const direction = cannotRefract || schlick(cosine, ior) > random()
        ? reflect(ray.direction, hit.normal)
        : refract(ray.direction, hit.normal, eta);
      throughput = multiply(throughput, hit.material.color);
      ray = {
        origin: add(hit.point, mul(direction, EPSILON * 2)),
        direction: normalize(direction),
      };
    }

    if (bounce >= 2) {
      const survival = Math.min(0.95, Math.max(throughput.x, throughput.y, throughput.z));
      if (random() > survival) break;
      throughput = mul(throughput, 1 / Math.max(survival, 0.01));
    }
  }

  return radiance;
}

const canvasElement = document.querySelector<HTMLCanvasElement>("#app");
const sampleLabel = document.querySelector<HTMLElement>("#samples");
if (!canvasElement) throw new Error("Canvas #app non trovato");
const canvas = canvasElement;

canvas.width = WIDTH;
canvas.height = HEIGHT;
const canvasContext = canvas.getContext("2d", { alpha: false });
if (!canvasContext) throw new Error("Contesto 2D non disponibile");
const context = canvasContext;
context.imageSmoothingEnabled = false;

const image = context.createImageData(WIDTH, HEIGHT);
const accumulation = new Float32Array(WIDTH * HEIGHT * 3);
const resolved = new Float32Array(WIDTH * HEIGHT * 3);
const denoisedA = new Float32Array(WIDTH * HEIGHT * 3);
const denoisedB = new Float32Array(WIDTH * HEIGHT * 3);
const pressed = new Set<string>();

const camera = {
  position: v(0, 0.55, 4.2),
  yaw: 0,
  pitch: -0.06,
  fov: 52 * (Math.PI / 180),
  aperture: 0.018,
  focusDistance: 5.25,
};

let samples = 0;
let lastTime = performance.now();
let cameraDirty = true;
let paused = false;

function resetAccumulation(): void {
  accumulation.fill(0);
  samples = 0;
}

function cameraBasis(): { forward: Vec3; right: Vec3; up: Vec3 } {
  const forward = normalize(v(
    Math.sin(camera.yaw) * Math.cos(camera.pitch),
    Math.sin(camera.pitch),
    -Math.cos(camera.yaw) * Math.cos(camera.pitch),
  ));
  const right = normalize(cross(forward, v(0, 1, 0)));
  const up = normalize(cross(right, forward));
  return { forward, right, up };
}

function cameraRay(
  x: number,
  y: number,
  { forward, right, up }: ReturnType<typeof cameraBasis>,
  stablePrimary = false,
): Ray {
  const scale = Math.tan(camera.fov * 0.5);
  const sampleX = stablePrimary ? 0.5 : random();
  const sampleY = stablePrimary ? 0.5 : random();
  const screenX = (2 * ((x + sampleX) / WIDTH) - 1) * scale;
  const screenY = (1 - 2 * ((y + sampleY) / HEIGHT)) * scale;
  const pinholeDirection = normalize(add(add(forward, mul(right, screenX)), mul(up, screenY)));

  if (stablePrimary) return { origin: camera.position, direction: pinholeDirection };

  const lensAngle = random() * Math.PI * 2;
  const lensRadius = Math.sqrt(random()) * camera.aperture;
  const lensOffset = add(
    mul(right, Math.cos(lensAngle) * lensRadius),
    mul(up, Math.sin(lensAngle) * lensRadius),
  );
  const focalPoint = add(camera.position, mul(pinholeDirection, camera.focusDistance));
  const origin = add(camera.position, lensOffset);
  return { origin, direction: normalize(sub(focalPoint, origin)) };
}

function aces(value: number): number {
  const a = 2.51;
  const b = 0.03;
  const c = 2.43;
  const d = 0.59;
  const e = 0.14;
  return Math.max(0, Math.min(1, (value * (a * value + b)) / (value * (c * value + d) + e)));
}

function renderSample(stablePrimary = false): void {
  const basis = cameraBasis();
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const pixel = y * WIDTH + x;
      randomState = ((pixel + 1) * 0x9e3779b1 ^ (samples + 1) * 0x85ebca6b) | 1;
      const color = trace(cameraRay(x, y, basis, stablePrimary));
      const accumulator = pixel * 3;
      accumulation[accumulator] = (accumulation[accumulator] ?? 0) + color.x;
      accumulation[accumulator + 1] = (accumulation[accumulator + 1] ?? 0) + color.y;
      accumulation[accumulator + 2] = (accumulation[accumulator + 2] ?? 0) + color.z;
    }
  }
  samples += 1;
}

function writePixel(pixel: number, color: Vec3): void {
  const output = pixel * 4;
  const exposure = 1.05;
  const red = aces(color.x * exposure);
  const green = aces(color.y * exposure);
  const blue = aces(color.z * exposure);
  image.data[output] = Math.round(Math.sqrt(red) * 255);
  image.data[output + 1] = Math.round(Math.sqrt(green) * 255);
  image.data[output + 2] = Math.round(Math.sqrt(blue) * 255);
  image.data[output + 3] = 255;
}

function setStatus(text: string): void {
  if (sampleLabel) sampleLabel.textContent = text;
}

function denoisePass(
  source: Float32Array,
  target: Float32Array,
  step: number,
  colorSigma: number,
): void {
  const sigmaSquared = colorSigma * colorSigma;

  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const center = (y * WIDTH + x) * 3;
      const centerR = source[center] ?? 0;
      const centerG = source[center + 1] ?? 0;
      const centerB = source[center + 2] ?? 0;
      let red = 0;
      let green = 0;
      let blue = 0;
      let totalWeight = 0;

      for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
        const sampleY = Math.max(0, Math.min(HEIGHT - 1, y + offsetY * step));
        for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
          const sampleX = Math.max(0, Math.min(WIDTH - 1, x + offsetX * step));
          const sample = (sampleY * WIDTH + sampleX) * 3;
          const sampleR = source[sample] ?? 0;
          const sampleG = source[sample + 1] ?? 0;
          const sampleB = source[sample + 2] ?? 0;
          const difference =
            (sampleR - centerR) ** 2 +
            (sampleG - centerG) ** 2 +
            (sampleB - centerB) ** 2;
          const spatialWeight = offsetX === 0 && offsetY === 0
            ? 4
            : offsetX === 0 || offsetY === 0 ? 2 : 1;
          const weight = spatialWeight * Math.exp(-difference / Math.max(0.001, sigmaSquared));
          red += sampleR * weight;
          green += sampleG * weight;
          blue += sampleB * weight;
          totalWeight += weight;
        }
      }

      target[center] = red / totalWeight;
      target[center + 1] = green / totalWeight;
      target[center + 2] = blue / totalWeight;
    }
  }
}

function presentAccumulation(): void {
  const inverseSamples = 1 / Math.max(1, samples);

  for (let pixel = 0; pixel < WIDTH * HEIGHT; pixel += 1) {
    const accumulator = pixel * 3;
    resolved[accumulator] = (accumulation[accumulator] ?? 0) * inverseSamples;
    resolved[accumulator + 1] = (accumulation[accumulator + 1] ?? 0) * inverseSamples;
    resolved[accumulator + 2] = (accumulation[accumulator + 2] ?? 0) * inverseSamples;
  }

  const denoiseStrength = Math.max(0, 1 - samples / DENOISE_UNTIL_SAMPLES);
  if (denoiseStrength > 0) {
    denoisePass(resolved, denoisedA, 1, 0.7);
    denoisePass(denoisedA, denoisedB, 2, 0.45);
  }

  for (let pixel = 0; pixel < WIDTH * HEIGHT; pixel += 1) {
    const accumulator = pixel * 3;
    writePixel(pixel, v(
      (resolved[accumulator] ?? 0) * (1 - denoiseStrength) +
        (denoisedB[accumulator] ?? 0) * denoiseStrength,
      (resolved[accumulator + 1] ?? 0) * (1 - denoiseStrength) +
        (denoisedB[accumulator + 1] ?? 0) * denoiseStrength,
      (resolved[accumulator + 2] ?? 0) * (1 - denoiseStrength) +
        (denoisedB[accumulator + 2] ?? 0) * denoiseStrength,
    ));
  }

  context.putImageData(image, 0, 0);
  setStatus(`${samples} spp`);
}

function markCameraChanged(): void {
  cameraDirty = true;
}

function updateCamera(delta: number): boolean {
  const { forward, right } = cameraBasis();
  const flatForward = normalize(v(forward.x, 0, forward.z));
  let movement = v();
  let changed = false;
  const speed = (pressed.has("ShiftLeft") || pressed.has("ShiftRight") ? 3.8 : 1.9) * delta;

  if (pressed.has("KeyW")) movement = add(movement, flatForward);
  if (pressed.has("KeyS")) movement = sub(movement, flatForward);
  if (pressed.has("KeyD")) movement = add(movement, right);
  if (pressed.has("KeyA")) movement = sub(movement, right);
  if (pressed.has("KeyE")) movement = add(movement, v(0, 1, 0));
  if (pressed.has("KeyQ")) movement = sub(movement, v(0, 1, 0));

  if (length(movement) > 0) {
    camera.position = add(camera.position, mul(normalize(movement), speed));
    changed = true;
  }

  const rotationSpeed = 1.35 * delta;
  if (pressed.has("ArrowLeft")) { camera.yaw -= rotationSpeed; changed = true; }
  if (pressed.has("ArrowRight")) { camera.yaw += rotationSpeed; changed = true; }
  if (pressed.has("ArrowUp")) { camera.pitch += rotationSpeed; changed = true; }
  if (pressed.has("ArrowDown")) { camera.pitch -= rotationSpeed; changed = true; }
  camera.pitch = Math.max(-1.45, Math.min(1.45, camera.pitch));
  return changed;
}

function frame(now: number): void {
  const delta = Math.min(0.05, (now - lastTime) / 1000);
  lastTime = now;
  if (updateCamera(delta)) markCameraChanged();

  if (cameraDirty) {
    resetAccumulation();
    for (let sample = 0; sample < MOTION_SAMPLES; sample += 1) renderSample(true);
    cameraDirty = false;
    presentAccumulation();
    setStatus(`${samples} spp · movimento`);
  } else if (!paused) {
    renderSample();
    presentAccumulation();
  } else {
    setStatus(`${samples} spp · pausa`);
  }
  requestAnimationFrame(frame);
}

function fitCanvas(): void {
  const available = Math.max(64, Math.min(window.innerWidth - 32, window.innerHeight - 112));
  const scale = Math.max(1, Math.floor(available / WIDTH));
  const displaySize = scale * WIDTH;
  canvas.style.width = `${displaySize}px`;
  canvas.style.height = `${displaySize}px`;
}

window.addEventListener("resize", fitCanvas);
window.addEventListener("keydown", (event) => {
  if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Space"].includes(event.code)) {
    event.preventDefault();
  }
  if (event.code === "Space" && !event.repeat) paused = !paused;
  if (event.code === "KeyR" && !event.repeat) {
    camera.position = v(0, 0.55, 4.2);
    camera.yaw = 0;
    camera.pitch = -0.06;
    markCameraChanged();
  }
  pressed.add(event.code);
});
window.addEventListener("keyup", (event) => pressed.delete(event.code));
window.addEventListener("blur", () => pressed.clear());

canvas.addEventListener("click", () => canvas.requestPointerLock());
document.addEventListener("mousemove", (event) => {
  if (document.pointerLockElement !== canvas) return;
  camera.yaw += event.movementX * 0.0025;
  camera.pitch = Math.max(-1.45, Math.min(1.45, camera.pitch - event.movementY * 0.0025));
  markCameraChanged();
});

fitCanvas();
requestAnimationFrame(frame);
