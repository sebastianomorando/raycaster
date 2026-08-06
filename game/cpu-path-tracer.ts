import { cameraBasis, cameraRay, type Camera } from "./camera.ts";
import { sceneHit, type SceneLight } from "./dungeon.ts";
import {
  add,
  cross,
  dot,
  mul,
  multiply,
  normalize,
  reflect,
  v,
  type Hit,
  type Ray,
  type Vec3,
} from "./math.ts";

const EPSILON = 0.001;
const MAX_BOUNCES = 5;
const DENOISE_UNTIL_SAMPLES = 20;

/**
 * Fallback CPU progressivo del renderer.
 *
 * La classe possiede buffer, generatore casuale e denoiser: `index.ts` deve solo
 * segnalare i cambi camera, richiedere campioni e presentare il risultato.
 */
export class CpuPathTracer {
  private image: ImageData;
  private accumulation: Float32Array;
  private resolved: Float32Array;
  private denoisedA: Float32Array;
  private denoisedB: Float32Array;
  private randomState = 1;
  private sampleCount = 0;

  constructor(
    private readonly context: CanvasRenderingContext2D,
    private renderSize: number,
    private readonly staticLights: readonly SceneLight[],
  ) {
    this.image = context.createImageData(renderSize, renderSize);
    this.accumulation = new Float32Array(renderSize * renderSize * 3);
    this.resolved = new Float32Array(renderSize * renderSize * 3);
    this.denoisedA = new Float32Array(renderSize * renderSize * 3);
    this.denoisedB = new Float32Array(renderSize * renderSize * 3);
  }

  get samples(): number {
    return this.sampleCount;
  }

  /** Ricrea i buffer interni quando cambia la risoluzione del canvas. */
  resize(renderSize: number): void {
    this.renderSize = renderSize;
    this.image = this.context.createImageData(renderSize, renderSize);
    this.accumulation = new Float32Array(renderSize * renderSize * 3);
    this.resolved = new Float32Array(renderSize * renderSize * 3);
    this.denoisedA = new Float32Array(renderSize * renderSize * 3);
    this.denoisedB = new Float32Array(renderSize * renderSize * 3);
    this.sampleCount = 0;
  }

  reset(): void {
    this.accumulation.fill(0);
    this.sampleCount = 0;
  }

  /** Accumula un campione completo della scena. */
  renderSample(
    camera: Camera,
    playerLight: SceneLight,
    renderTimeSeconds: number,
    stablePrimary = false,
  ): void {
    const basis = cameraBasis(camera);
    for (let y = 0; y < this.renderSize; y += 1) {
      for (let x = 0; x < this.renderSize; x += 1) {
        const pixel = y * this.renderSize + x;
        this.randomState = ((pixel + 1) * 0x9e3779b1 ^ (this.sampleCount + 1) * 0x85ebca6b) | 1;
        const ray = cameraRay(
          x,
          y,
          camera,
          basis,
          this.renderSize,
          () => this.random(),
          stablePrimary,
        );
        const color = this.trace(ray, playerLight, renderTimeSeconds);
        const accumulator = pixel * 3;
        this.accumulation[accumulator] = (this.accumulation[accumulator] ?? 0) + color.x;
        this.accumulation[accumulator + 1] = (this.accumulation[accumulator + 1] ?? 0) + color.y;
        this.accumulation[accumulator + 2] = (this.accumulation[accumulator + 2] ?? 0) + color.z;
      }
    }
    this.sampleCount += 1;
  }

  /** Risolve accumulo, denoise iniziale e tone mapping sul canvas. */
  present(): void {
    const inverseSamples = 1 / Math.max(1, this.sampleCount);
    for (let pixel = 0; pixel < this.renderSize * this.renderSize; pixel += 1) {
      const index = pixel * 3;
      this.resolved[index] = (this.accumulation[index] ?? 0) * inverseSamples;
      this.resolved[index + 1] = (this.accumulation[index + 1] ?? 0) * inverseSamples;
      this.resolved[index + 2] = (this.accumulation[index + 2] ?? 0) * inverseSamples;
    }

    const denoiseStrength = Math.max(0, 1 - this.sampleCount / DENOISE_UNTIL_SAMPLES);
    if (denoiseStrength > 0) {
      this.denoisePass(this.resolved, this.denoisedA, 1, 0.7);
      this.denoisePass(this.denoisedA, this.denoisedB, 2, 0.45);
    }

    for (let pixel = 0; pixel < this.renderSize * this.renderSize; pixel += 1) {
      const index = pixel * 3;
      this.writePixel(pixel, v(
        (this.resolved[index] ?? 0) * (1 - denoiseStrength) +
          (this.denoisedB[index] ?? 0) * denoiseStrength,
        (this.resolved[index + 1] ?? 0) * (1 - denoiseStrength) +
          (this.denoisedB[index + 1] ?? 0) * denoiseStrength,
        (this.resolved[index + 2] ?? 0) * (1 - denoiseStrength) +
          (this.denoisedB[index + 2] ?? 0) * denoiseStrength,
      ));
    }
    this.context.putImageData(this.image, 0, 0);
  }

  private random(): number {
    this.randomState ^= this.randomState << 13;
    this.randomState ^= this.randomState >>> 17;
    this.randomState ^= this.randomState << 5;
    return (this.randomState >>> 0) / 4294967296;
  }

  private randomUnitVector(): Vec3 {
    const z = this.random() * 2 - 1;
    const angle = this.random() * Math.PI * 2;
    const radius = Math.sqrt(Math.max(0, 1 - z * z));
    return v(radius * Math.cos(angle), radius * Math.sin(angle), z);
  }

  private cosineHemisphere(normal: Vec3): Vec3 {
    const helper = Math.abs(normal.x) > 0.9 ? v(0, 1, 0) : v(1, 0, 0);
    const tangent = normalize(cross(helper, normal));
    const bitangent = cross(normal, tangent);
    const angle = this.random() * Math.PI * 2;
    const radius = Math.sqrt(this.random());
    const local = v(
      radius * Math.cos(angle),
      Math.sqrt(Math.max(0, 1 - radius * radius)),
      radius * Math.sin(angle),
    );
    return normalize(add(
      add(mul(tangent, local.x), mul(normal, local.y)),
      mul(bitangent, local.z),
    ));
  }

  private flickerMultiplier(light: SceneLight, time: number): number {
    return 1 + light.flicker * (
      Math.sin(time * 8.7 + light.phase) * 0.65 +
      Math.sin(time * 17.3 + light.phase * 2.1) * 0.35
    );
  }

  private directLight(
    hit: Hit,
    light: SceneLight,
    selectionProbability: number,
    time: number,
  ): Vec3 {
    const lightSample = add(light.position, mul(this.randomUnitVector(), light.radius));
    const toLight = { x: lightSample.x - hit.point.x, y: lightSample.y - hit.point.y, z: lightSample.z - hit.point.z };
    const distanceSquared = dot(toLight, toLight);
    const distanceToLight = Math.sqrt(distanceSquared);
    const lightDirection = mul(toLight, 1 / Math.max(distanceToLight, EPSILON));
    const cosine = Math.max(0, dot(hit.normal, lightDirection));
    if (cosine <= 0) return v();

    const shadowOrigin = add(hit.point, mul(hit.normal, EPSILON * 3));
    const blocker = sceneHit({ origin: shadowOrigin, direction: lightDirection }, EPSILON, distanceToLight);
    if (blocker && blocker.material.kind !== "emissive") return v();

    const intensity = light.intensity * this.flickerMultiplier(light, time);
    return mul(
      light.color,
      (cosine * intensity) /
        (Math.max(0.35, distanceSquared) * Math.max(selectionProbability, 1e-6)),
    );
  }

  private sampleLight(hit: Hit, playerLight: SceneLight, time: number): Vec3 {
    const lights = [playerLight, ...this.staticLights];
    let totalWeight = 0;
    for (const light of lights) {
      const offset = {
        x: light.position.x - hit.point.x,
        y: light.position.y - hit.point.y,
        z: light.position.z - hit.point.z,
      };
      totalWeight += light.intensity / Math.max(0.5, dot(offset, offset));
    }

    let threshold = this.random() * totalWeight;
    for (let index = 0; index < lights.length; index += 1) {
      const light = lights[index];
      if (!light) continue;
      const offset = {
        x: light.position.x - hit.point.x,
        y: light.position.y - hit.point.y,
        z: light.position.z - hit.point.z,
      };
      const weight = light.intensity / Math.max(0.5, dot(offset, offset));
      threshold -= weight;
      if (threshold <= 0 || index === lights.length - 1) {
        return this.directLight(hit, light, weight / Math.max(totalWeight, 1e-6), time);
      }
    }
    return v();
  }

  private trace(initialRay: Ray, playerLight: SceneLight, time: number): Vec3 {
    let ray = initialRay;
    let throughput = v(1, 1, 1);
    let radiance = v();

    for (let bounce = 0; bounce < MAX_BOUNCES; bounce += 1) {
      const hit = sceneHit(ray);
      if (!hit) {
        const lift = Math.max(0, ray.direction.y) * 0.008;
        radiance = add(radiance, multiply(throughput, v(0.004 + lift, 0.005 + lift, 0.009 + lift * 1.5)));
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
        radiance = add(
          radiance,
          multiply(throughput, multiply(hit.material.color, this.sampleLight(hit, playerLight, time))),
        );
        throughput = multiply(throughput, hit.material.color);
        ray = {
          origin: add(hit.point, mul(hit.normal, EPSILON * 3)),
          direction: this.cosineHemisphere(hit.normal),
        };
      } else if (hit.material.kind === "metal") {
        const reflected = reflect(ray.direction, hit.normal);
        const scattered = normalize(add(reflected, mul(this.randomUnitVector(), hit.material.roughness ?? 0)));
        if (dot(scattered, hit.normal) <= 0) break;
        throughput = multiply(throughput, hit.material.color);
        ray = {
          origin: add(hit.point, mul(hit.normal, EPSILON * 3)),
          direction: scattered,
        };
      } else {
        const ior = hit.material.ior ?? 1.5;
        const eta = hit.frontFace ? 1 / ior : ior;
        const cosine = Math.min(dot(mul(ray.direction, -1), hit.normal), 1);
        const cannotRefract = eta * Math.sqrt(Math.max(0, 1 - cosine * cosine)) > 1;
        const reflectance = ((1 - ior) / (1 + ior)) ** 2;
        const schlick = reflectance + (1 - reflectance) * (1 - cosine) ** 5;
        const direction = cannotRefract || schlick > this.random()
          ? reflect(ray.direction, hit.normal)
          : this.refract(ray.direction, hit.normal, eta);
        throughput = multiply(throughput, hit.material.color);
        ray = {
          origin: add(hit.point, mul(direction, EPSILON * 3)),
          direction: normalize(direction),
        };
      }

      if (bounce >= 2) {
        const survival = Math.min(0.94, Math.max(throughput.x, throughput.y, throughput.z));
        if (this.random() > survival) break;
        throughput = mul(throughput, 1 / Math.max(0.01, survival));
      }
    }
    return radiance;
  }

  private refract(direction: Vec3, normal: Vec3, eta: number): Vec3 {
    const cosine = Math.min(dot(mul(direction, -1), normal), 1);
    const perpendicular = mul(add(direction, mul(normal, cosine)), eta);
    const parallel = mul(normal, -Math.sqrt(Math.abs(1 - dot(perpendicular, perpendicular))));
    return add(perpendicular, parallel);
  }

  private denoisePass(source: Float32Array, target: Float32Array, step: number, sigma: number): void {
    const sigmaSquared = sigma * sigma;
    for (let y = 0; y < this.renderSize; y += 1) {
      for (let x = 0; x < this.renderSize; x += 1) {
        const center = (y * this.renderSize + x) * 3;
        const centerR = source[center] ?? 0;
        const centerG = source[center + 1] ?? 0;
        const centerB = source[center + 2] ?? 0;
        let red = 0;
        let green = 0;
        let blue = 0;
        let totalWeight = 0;

        for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
          const sampleY = Math.max(0, Math.min(this.renderSize - 1, y + offsetY * step));
          for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
            const sampleX = Math.max(0, Math.min(this.renderSize - 1, x + offsetX * step));
            const sample = (sampleY * this.renderSize + sampleX) * 3;
            const sampleR = source[sample] ?? 0;
            const sampleG = source[sample + 1] ?? 0;
            const sampleB = source[sample + 2] ?? 0;
            const difference =
              (sampleR - centerR) ** 2 +
              (sampleG - centerG) ** 2 +
              (sampleB - centerB) ** 2;
            const spatial = offsetX === 0 && offsetY === 0
              ? 4
              : offsetX === 0 || offsetY === 0 ? 2 : 1;
            const weight = spatial * Math.exp(-difference / Math.max(0.001, sigmaSquared));
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

  private writePixel(pixel: number, color: Vec3): void {
    const output = pixel * 4;
    const red = this.aces(color.x * 1.35);
    const green = this.aces(color.y * 1.35);
    const blue = this.aces(color.z * 1.35);
    this.image.data[output] = Math.round(Math.sqrt(red) * 255);
    this.image.data[output + 1] = Math.round(Math.sqrt(green) * 255);
    this.image.data[output + 2] = Math.round(Math.sqrt(blue) * 255);
    this.image.data[output + 3] = 255;
  }

  private aces(value: number): number {
    const a = 2.51;
    const b = 0.03;
    const c = 2.43;
    const d = 0.59;
    const e = 0.14;
    return Math.max(0, Math.min(1, (value * (a * value + b)) / (value * (c * value + d) + e)));
  }
}
