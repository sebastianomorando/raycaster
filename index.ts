import archSource from "./ModularDungeon/OBJ/Arch.obj" with { type: "text" };
import chestSource from "./ModularDungeon/OBJ/Chest.obj" with { type: "text" };
import columnSource from "./ModularDungeon/OBJ/Column.obj" with { type: "text" };
import floorSource from "./ModularDungeon/OBJ/Floor_Modular.obj" with { type: "text" };
import spikesSource from "./ModularDungeon/OBJ/Trap_spikes.obj" with { type: "text" };
import torchSource from "./ModularDungeon/OBJ/Torch.obj" with { type: "text" };
import wallSource from "./ModularDungeon/OBJ/Wall_Modular.obj" with { type: "text" };
import woodfireSource from "./ModularDungeon/OBJ/Woodfire.obj" with { type: "text" };
import {
  createMeshInstance,
  createMeshScene,
  createObjMesh,
  hitMeshScene,
  type MeshInstance,
} from "./mesh.ts";

const WIDTH = 64;
const HEIGHT = 64;
const TILE_SIZE = 2;
const EYE_HEIGHT = 0.68;
const MAX_BOUNCES = 5;
const MOTION_SAMPLES = 1;
const DENOISE_UNTIL_SAMPLES = 20;
const MOVE_DURATION = 210;
const TURN_DURATION = 180;
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

type Ray = Readonly<{ origin: Vec3; direction: Vec3 }>;

type Hit = {
  distance: number;
  point: Vec3;
  normal: Vec3;
  frontFace: boolean;
  material: Material;
};

type Cell = { column: number; row: number };
type QueuedAction =
  | { kind: "move"; relativeDirection: number }
  | { kind: "turn"; amount: -1 | 1 };
type ActiveAction =
  | {
      kind: "move";
      startedAt: number;
      from: Cell;
      to: Cell;
    }
  | {
      kind: "turn";
      startedAt: number;
      fromYaw: number;
      toYaw: number;
      targetFacing: number;
    };

type SceneLight = {
  position: Vec3;
  color: Vec3;
  intensity: number;
  radius: number;
  phase: number;
  flicker: number;
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
const ease = (amount: number): number => amount * amount * (3 - 2 * amount);

const LEVEL = [
  "###############",
  "#S....#.......#",
  "#..F..#..C.F..#",
  "#.....A.......#",
  "###.#######.###",
  "#...#.....#...#",
  "#.#.#..T..#.#.#",
  "#.#.#..F..#.#.#",
  "#.#.###.###.#.#",
  "#.#.........#.#",
  "#.#####.#####.#",
  "#.....#...G...#",
  "#..C..#...F...#",
  "#.....#.......#",
  "###############",
] as const;

const DIRECTIONS = [
  { column: 0, row: -1, name: "N" },
  { column: 1, row: 0, name: "E" },
  { column: 0, row: 1, name: "S" },
  { column: -1, row: 0, name: "O" },
] as const;

function findCell(symbol: string): Cell {
  for (let row = 0; row < LEVEL.length; row += 1) {
    const column = LEVEL[row]?.indexOf(symbol) ?? -1;
    if (column >= 0) return { column, row };
  }
  throw new Error(`Cella ${symbol} non trovata`);
}

function findCells(symbol: string): Cell[] {
  const cells: Cell[] = [];
  for (let row = 0; row < LEVEL.length; row += 1) {
    for (let column = 0; column < (LEVEL[row]?.length ?? 0); column += 1) {
      if (LEVEL[row]?.[column] === symbol) cells.push({ column, row });
    }
  }
  return cells;
}

const startCell = findCell("S");
const goalCell = findCell("G");
const trapCell = findCell("T");

function cellSymbol(column: number, row: number): string {
  return LEVEL[row]?.[column] ?? "#";
}

function hasFloor(column: number, row: number): boolean {
  return cellSymbol(column, row) !== "#";
}

function isWalkable(column: number, row: number): boolean {
  return !["#", "F", "C"].includes(cellSymbol(column, row));
}

function cellPosition(column: number, row: number, height = 0): Vec3 {
  return v(
    (column - startCell.column) * TILE_SIZE,
    height,
    (row - startCell.row) * TILE_SIZE,
  );
}

const wallMaterials = {
  Wall_Dark: { kind: "diffuse", color: v(0.2, 0.105, 0.045) },
  Wall_Medium: { kind: "diffuse", color: v(0.31, 0.165, 0.07) },
  Wall_Highlights: { kind: "diffuse", color: v(0.46, 0.28, 0.12) },
} satisfies Record<string, Material>;

const floorMaterials = {
  Grey_Floor: { kind: "diffuse", color: v(0.12, 0.115, 0.15) },
} satisfies Record<string, Material>;

const chestMaterials = {
  DarkWood: { kind: "diffuse", color: v(0.17, 0.05, 0.022) },
  Wood: { kind: "diffuse", color: v(0.5, 0.15, 0.045) },
  Metal: { kind: "metal", color: v(0.42, 0.43, 0.5), roughness: 0.22 },
} satisfies Record<string, Material>;

const spikeMaterials = {
  DarkMetal: { kind: "metal", color: v(0.16, 0.17, 0.22), roughness: 0.35 },
  Metal: { kind: "metal", color: v(0.45, 0.48, 0.56), roughness: 0.18 },
} satisfies Record<string, Material>;

const fireMaterials = {
  DarkWood: { kind: "diffuse", color: v(0.12, 0.035, 0.012) },
  Wood: { kind: "diffuse", color: v(0.34, 0.095, 0.025) },
  DarkMetal: { kind: "metal", color: v(0.18, 0.19, 0.24), roughness: 0.38 },
  Fire: { kind: "emissive", color: v(1, 0.22, 0.025), emission: 13 },
} satisfies Record<string, Material>;

const columnMaterials = {
  DarkGrey_Floor: { kind: "diffuse", color: v(0.07, 0.065, 0.095) },
  Grey_Floor: { kind: "diffuse", color: v(0.17, 0.16, 0.21) },
} satisfies Record<string, Material>;

function baseMesh(source: string, materials: Record<string, Material>, fallback: Material) {
  return createObjMesh(source, {
    translation: v(),
    scale: 1,
    materials,
    fallbackMaterial: fallback,
  });
}

const wallMesh = baseMesh(wallSource, wallMaterials, wallMaterials.Wall_Medium);
const floorMesh = baseMesh(floorSource, floorMaterials, floorMaterials.Grey_Floor);
const archMesh = baseMesh(archSource, wallMaterials, wallMaterials.Wall_Medium);
const chestMesh = baseMesh(chestSource, chestMaterials, chestMaterials.Wood);
const spikesMesh = baseMesh(spikesSource, spikeMaterials, spikeMaterials.DarkMetal);
const torchMesh = baseMesh(torchSource, fireMaterials, fireMaterials.DarkMetal);
const woodfireMesh = baseMesh(woodfireSource, fireMaterials, fireMaterials.Wood);
const columnMesh = baseMesh(columnSource, columnMaterials, columnMaterials.Grey_Floor);

const torchPlacements = [
  { column: 5, row: 2, offset: v(0.9, 0.78, 0), lightOffset: v(0.64, 1.25, 0), rotation: Math.PI / 2 },
  { column: 7, row: 2, offset: v(-0.9, 0.78, 0), lightOffset: v(-0.64, 1.25, 0), rotation: -Math.PI / 2 },
  { column: 5, row: 6, offset: v(-0.9, 0.78, 0), lightOffset: v(-0.64, 1.25, 0), rotation: -Math.PI / 2 },
  { column: 9, row: 7, offset: v(0.9, 0.78, 0), lightOffset: v(0.64, 1.25, 0), rotation: Math.PI / 2 },
  { column: 5, row: 12, offset: v(0.9, 0.78, 0), lightOffset: v(0.64, 1.25, 0), rotation: Math.PI / 2 },
  { column: 7, row: 12, offset: v(-0.9, 0.78, 0), lightOffset: v(-0.64, 1.25, 0), rotation: -Math.PI / 2 },
] as const;

function buildDungeon(): MeshInstance[] {
  const instances: MeshInstance[] = [];
  for (let row = 0; row < LEVEL.length; row += 1) {
    for (let column = 0; column < (LEVEL[row]?.length ?? 0); column += 1) {
      if (!hasFloor(column, row)) continue;
      const center = cellPosition(column, row);

      // Il modulo pavimento è spesso 0.26: duplicato in alto chiude il soffitto.
      instances.push(createMeshInstance(floorMesh, add(center, v(0, -0.13, 0))));
      instances.push(createMeshInstance(floorMesh, add(center, v(0, 2.13, 0))));

      if (!hasFloor(column, row - 1)) {
        instances.push(createMeshInstance(wallMesh, add(center, v(0, 1, -1))));
      }
      if (!hasFloor(column, row + 1)) {
        instances.push(createMeshInstance(wallMesh, add(center, v(0, 1, 1)), 1, Math.PI));
      }
      if (!hasFloor(column - 1, row)) {
        instances.push(createMeshInstance(wallMesh, add(center, v(-1, 1, 0)), 1, Math.PI / 2));
      }
      if (!hasFloor(column + 1, row)) {
        instances.push(createMeshInstance(wallMesh, add(center, v(1, 1, 0)), 1, -Math.PI / 2));
      }
    }
  }

  for (const archCell of findCells("A")) {
    instances.push(createMeshInstance(
      archMesh,
      cellPosition(archCell.column, archCell.row),
      0.5,
      Math.PI / 2,
    ));
  }

  for (const fireCell of findCells("F")) {
    instances.push(createMeshInstance(
      woodfireMesh,
      add(cellPosition(fireCell.column, fireCell.row), v(0, 0.04, 0)),
      0.92,
    ));
  }

  for (const columnCell of findCells("C")) {
    instances.push(createMeshInstance(
      columnMesh,
      cellPosition(columnCell.column, columnCell.row),
      0.49,
    ));
  }

  for (const torch of torchPlacements) {
    instances.push(createMeshInstance(
      torchMesh,
      add(cellPosition(torch.column, torch.row), torch.offset),
      0.78,
      torch.rotation,
    ));
  }

  const goal = cellPosition(goalCell.column, goalCell.row);
  instances.push(createMeshInstance(archMesh, add(goal, v(0, 0, -1)), 0.5));
  instances.push(createMeshInstance(chestMesh, add(goal, v(0, 0.01, 0.68)), 0.88, Math.PI));

  const trap = cellPosition(trapCell.column, trapCell.row);
  // Abbassati sotto l'altezza occhi: il giocatore può attraversare la cella ferendosi.
  instances.push(createMeshInstance(spikesMesh, add(trap, v(0, -0.2, 0)), 0.72));
  return instances;
}

const dungeonInstances = buildDungeon();
const dungeonScene = createMeshScene(dungeonInstances);

const staticLights: readonly SceneLight[] = [
  ...findCells("F").map((cell, index) => ({
    position: add(cellPosition(cell.column, cell.row), v(0, 0.52, 0)),
    color: v(1, 0.24, 0.035),
    intensity: 24,
    radius: 0.2,
    phase: index * 1.71,
    flicker: 0.16,
  })),
  ...torchPlacements.map((torch, index) => ({
    position: add(cellPosition(torch.column, torch.row), torch.lightOffset),
    color: v(1, 0.38, 0.08),
    intensity: 13,
    radius: 0.09,
    phase: 2.3 + index * 1.37,
    flicker: 0.11,
  })),
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

function sceneHit(ray: Ray, minDistance = EPSILON, maxDistance = Infinity): Hit | null {
  return hitMeshScene(ray, dungeonScene, minDistance, maxDistance);
}

function refract(direction: Vec3, normal: Vec3, eta: number): Vec3 {
  const cosine = Math.min(dot(mul(direction, -1), normal), 1);
  const perpendicular = mul(add(direction, mul(normal, cosine)), eta);
  const parallel = mul(normal, -Math.sqrt(Math.abs(1 - dot(perpendicular, perpendicular))));
  return add(perpendicular, parallel);
}

function schlick(cosine: number, ior: number): number {
  const reflectance = ((1 - ior) / (1 + ior)) ** 2;
  return reflectance + (1 - reflectance) * (1 - cosine) ** 5;
}

const camera = {
  position: cellPosition(startCell.column, startCell.row, EYE_HEIGHT),
  yaw: Math.PI,
  fov: 58 * (Math.PI / 180),
  aperture: 0.006,
  focusDistance: 4,
};

const playerLight: SceneLight = {
  position: add(camera.position, v(0, 0.14, 0)),
  color: v(1, 0.7, 0.4),
  intensity: 2.8,
  radius: 0.05,
  phase: 0,
  flicker: 0,
};

let renderTimeSeconds = 0;

function flickerMultiplier(light: SceneLight): number {
  return 1 + light.flicker * (
    Math.sin(renderTimeSeconds * 8.7 + light.phase) * 0.65 +
    Math.sin(renderTimeSeconds * 17.3 + light.phase * 2.1) * 0.35
  );
}

function directLight(hit: Hit, light: SceneLight, selectionProbability: number): Vec3 {
  const lightSample = add(light.position, mul(randomUnitVector(), light.radius));
  const toLight = sub(lightSample, hit.point);
  const distanceSquared = dot(toLight, toLight);
  const distanceToLight = Math.sqrt(distanceSquared);
  const lightDirection = mul(toLight, 1 / Math.max(distanceToLight, EPSILON));
  const cosine = Math.max(0, dot(hit.normal, lightDirection));
  if (cosine <= 0) return v();

  const shadowOrigin = add(hit.point, mul(hit.normal, EPSILON * 3));
  const blocker = sceneHit({ origin: shadowOrigin, direction: lightDirection }, EPSILON, distanceToLight);
  if (blocker && blocker.material.kind !== "emissive") return v();

  const intensity = light.intensity * flickerMultiplier(light);
  return mul(
    light.color,
    (cosine * intensity) /
      (Math.max(0.35, distanceSquared) * Math.max(selectionProbability, 1e-6)),
  );
}

function sampleLight(hit: Hit): Vec3 {
  const lightCount = staticLights.length + 1;
  let totalWeight = 0;
  for (let index = 0; index < lightCount; index += 1) {
    const light = index === 0 ? playerLight : staticLights[index - 1];
    if (!light) continue;
    const offset = sub(light.position, hit.point);
    const distanceSquared = dot(offset, offset);
    totalWeight += light.intensity / Math.max(0.5, distanceSquared);
  }

  let threshold = random() * totalWeight;
  for (let index = 0; index < lightCount; index += 1) {
    const light = index === 0 ? playerLight : staticLights[index - 1];
    if (!light) continue;
    const offset = sub(light.position, hit.point);
    const weight = light.intensity / Math.max(0.5, dot(offset, offset));
    threshold -= weight;
    if (threshold <= 0 || index === lightCount - 1) {
      return directLight(hit, light, weight / Math.max(totalWeight, 1e-6));
    }
  }
  return v();
}

function dungeonDarkness(direction: Vec3): Vec3 {
  const lift = Math.max(0, direction.y) * 0.008;
  return v(0.004 + lift, 0.005 + lift, 0.009 + lift * 1.5);
}

function trace(initialRay: Ray): Vec3 {
  let ray = initialRay;
  let throughput = v(1, 1, 1);
  let radiance = v();

  for (let bounce = 0; bounce < MAX_BOUNCES; bounce += 1) {
    const hit = sceneHit(ray);
    if (!hit) {
      radiance = add(radiance, multiply(throughput, dungeonDarkness(ray.direction)));
      break;
    }

    if (hit.material.kind === "emissive") {
      radiance = add(radiance, mul(multiply(throughput, hit.material.color), hit.material.emission ?? 1));
      break;
    }

    if (hit.material.kind === "diffuse") {
      radiance = add(
        radiance,
        multiply(throughput, multiply(hit.material.color, sampleLight(hit))),
      );
      throughput = multiply(throughput, hit.material.color);
      ray = {
        origin: add(hit.point, mul(hit.normal, EPSILON * 3)),
        direction: cosineHemisphere(hit.normal),
      };
    } else if (hit.material.kind === "metal") {
      const reflected = reflect(ray.direction, hit.normal);
      const scattered = normalize(add(reflected, mul(randomUnitVector(), hit.material.roughness ?? 0)));
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
      const direction = cannotRefract || schlick(cosine, ior) > random()
        ? reflect(ray.direction, hit.normal)
        : refract(ray.direction, hit.normal, eta);
      throughput = multiply(throughput, hit.material.color);
      ray = {
        origin: add(hit.point, mul(direction, EPSILON * 3)),
        direction: normalize(direction),
      };
    }

    if (bounce >= 2) {
      const survival = Math.min(0.94, Math.max(throughput.x, throughput.y, throughput.z));
      if (random() > survival) break;
      throughput = mul(throughput, 1 / Math.max(0.01, survival));
    }
  }
  return radiance;
}

const canvasElement = document.querySelector<HTMLCanvasElement>("#app");
const sampleLabel = document.querySelector<HTMLElement>("#samples");
const messageLabel = document.querySelector<HTMLElement>("#message");
const positionLabel = document.querySelector<HTMLElement>("#position");
const healthLabel = document.querySelector<HTMLElement>("#health");
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

const player = {
  column: startCell.column,
  row: startCell.row,
  facing: 2,
  health: 100,
  won: false,
};

const actionQueue: QueuedAction[] = [];
const triggeredTraps = new Set<string>();
let activeAction: ActiveAction | null = null;
let statusMessage = "Trova il baule oltre il labirinto";
let statusUntil = 0;
let samples = 0;
let lastTime = performance.now();
let cameraDirty = true;
let paused = false;

function resetAccumulation(): void {
  accumulation.fill(0);
  samples = 0;
}

function cameraBasis(): { forward: Vec3; right: Vec3; up: Vec3 } {
  const forward = normalize(v(Math.sin(camera.yaw), 0, -Math.cos(camera.yaw)));
  const right = normalize(cross(forward, v(0, 1, 0)));
  return { forward, right, up: v(0, 1, 0) };
}

function cameraRay(
  x: number,
  y: number,
  { forward, right, up }: ReturnType<typeof cameraBasis>,
  stablePrimary = false,
): Ray {
  const sampleX = stablePrimary ? 0.5 : random();
  const sampleY = stablePrimary ? 0.5 : random();
  const scale = Math.tan(camera.fov * 0.5);
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
  const focusPoint = add(camera.position, mul(pinholeDirection, camera.focusDistance));
  const origin = add(camera.position, lensOffset);
  return { origin, direction: normalize(sub(focusPoint, origin)) };
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
  const red = aces(color.x * 1.35);
  const green = aces(color.y * 1.35);
  const blue = aces(color.z * 1.35);
  image.data[output] = Math.round(Math.sqrt(red) * 255);
  image.data[output + 1] = Math.round(Math.sqrt(green) * 255);
  image.data[output + 2] = Math.round(Math.sqrt(blue) * 255);
  image.data[output + 3] = 255;
}

function denoisePass(source: Float32Array, target: Float32Array, step: number, sigma: number): void {
  const sigmaSquared = sigma * sigma;
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
          const spatial = offsetX === 0 && offsetY === 0 ? 4 : offsetX === 0 || offsetY === 0 ? 2 : 1;
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

function present(): void {
  const inverseSamples = 1 / Math.max(1, samples);
  for (let pixel = 0; pixel < WIDTH * HEIGHT; pixel += 1) {
    const index = pixel * 3;
    resolved[index] = (accumulation[index] ?? 0) * inverseSamples;
    resolved[index + 1] = (accumulation[index + 1] ?? 0) * inverseSamples;
    resolved[index + 2] = (accumulation[index + 2] ?? 0) * inverseSamples;
  }

  const denoiseStrength = Math.max(0, 1 - samples / DENOISE_UNTIL_SAMPLES);
  if (denoiseStrength > 0) {
    denoisePass(resolved, denoisedA, 1, 0.7);
    denoisePass(denoisedA, denoisedB, 2, 0.45);
  }

  for (let pixel = 0; pixel < WIDTH * HEIGHT; pixel += 1) {
    const index = pixel * 3;
    writePixel(pixel, v(
      (resolved[index] ?? 0) * (1 - denoiseStrength) + (denoisedB[index] ?? 0) * denoiseStrength,
      (resolved[index + 1] ?? 0) * (1 - denoiseStrength) + (denoisedB[index + 1] ?? 0) * denoiseStrength,
      (resolved[index + 2] ?? 0) * (1 - denoiseStrength) + (denoisedB[index + 2] ?? 0) * denoiseStrength,
    ));
  }
  context.putImageData(image, 0, 0);
  if (sampleLabel) sampleLabel.textContent = `${samples} spp`;
}

function markCameraChanged(): void {
  cameraDirty = true;
}

function showMessage(message: string, duration = 1400): void {
  statusMessage = message;
  statusUntil = performance.now() + duration;
}

function enqueue(action: QueuedAction): void {
  if (player.won || actionQueue.length >= 2) return;
  actionQueue.push(action);
}

function beginNextAction(now: number): void {
  const action = actionQueue.shift();
  if (!action) return;

  if (action.kind === "turn") {
    activeAction = {
      kind: "turn",
      startedAt: now,
      fromYaw: camera.yaw,
      toYaw: camera.yaw + action.amount * (Math.PI / 2),
      targetFacing: (player.facing + action.amount + 4) % 4,
    };
    return;
  }

  const directionIndex = (player.facing + action.relativeDirection + 4) % 4;
  const direction = DIRECTIONS[directionIndex];
  if (!direction) return;
  const to = {
    column: player.column + direction.column,
    row: player.row + direction.row,
  };
  if (!isWalkable(to.column, to.row)) {
    const obstacle = cellSymbol(to.column, to.row);
    showMessage(
      obstacle === "F"
        ? "Il fuoco ti sbarra la strada."
        : obstacle === "C" ? "Una colonna blocca il passaggio." : "La parete non si muove.",
      850,
    );
    return;
  }
  activeAction = {
    kind: "move",
    startedAt: now,
    from: { column: player.column, row: player.row },
    to,
  };
}

function enteredCell(): void {
  const symbol = cellSymbol(player.column, player.row);
  if (symbol === "T") {
    const key = `${player.column},${player.row}`;
    if (!triggeredTraps.has(key)) {
      triggeredTraps.add(key);
      player.health = Math.max(0, player.health - 25);
      showMessage("CLANG! Gli spuntoni ti feriscono: −25", 2200);
    }
  }
  if (symbol === "G") {
    player.won = true;
    actionQueue.length = 0;
    showMessage("TESORO TROVATO · Hai vinto!", Infinity);
  }
}

function updateGame(now: number): void {
  if (!activeAction) beginNextAction(now);
  if (!activeAction) return;

  const duration = activeAction.kind === "move" ? MOVE_DURATION : TURN_DURATION;
  const linearProgress = Math.min(1, (now - activeAction.startedAt) / duration);
  const progress = ease(linearProgress);

  if (activeAction.kind === "move") {
    const from = cellPosition(activeAction.from.column, activeAction.from.row, EYE_HEIGHT);
    const to = cellPosition(activeAction.to.column, activeAction.to.row, EYE_HEIGHT);
    camera.position = add(lerp(from, to, progress), v(0, Math.sin(linearProgress * Math.PI) * 0.035, 0));
  } else {
    camera.yaw = activeAction.fromYaw + (activeAction.toYaw - activeAction.fromYaw) * progress;
  }
  markCameraChanged();

  if (linearProgress < 1) return;
  if (activeAction.kind === "move") {
    player.column = activeAction.to.column;
    player.row = activeAction.to.row;
    camera.position = cellPosition(player.column, player.row, EYE_HEIGHT);
    enteredCell();
  } else {
    player.facing = activeAction.targetFacing;
    camera.yaw = activeAction.toYaw;
  }
  activeAction = null;
}

function updateHud(now: number): void {
  const direction = DIRECTIONS[player.facing]?.name ?? "?";
  if (positionLabel) positionLabel.textContent = `${direction} · ${player.column},${player.row}`;
  if (healthLabel) healthLabel.textContent = `VITA ${player.health}`;
  if (messageLabel) {
    messageLabel.textContent = statusUntil >= now
      ? statusMessage
      : player.won ? "TESORO TROVATO" : "Trova il baule";
    messageLabel.classList.toggle("won", player.won);
  }
}

function frame(now: number): void {
  lastTime = now;
  renderTimeSeconds = now / 1000;
  updateGame(now);
  updateHud(now);
  playerLight.position = add(camera.position, v(0, 0.14, 0));

  if (cameraDirty) {
    resetAccumulation();
    for (let sample = 0; sample < MOTION_SAMPLES; sample += 1) renderSample(true);
    cameraDirty = false;
    present();
  } else if (!paused) {
    renderSample();
    present();
  } else if (sampleLabel) {
    sampleLabel.textContent = `${samples} spp · pausa`;
  }
  requestAnimationFrame(frame);
}

function restart(): void {
  player.column = startCell.column;
  player.row = startCell.row;
  player.facing = 2;
  player.health = 100;
  player.won = false;
  triggeredTraps.clear();
  actionQueue.length = 0;
  activeAction = null;
  camera.position = cellPosition(startCell.column, startCell.row, EYE_HEIGHT);
  camera.yaw = Math.PI;
  showMessage("Trova il baule oltre il labirinto", 2200);
  markCameraChanged();
}

function fitCanvas(): void {
  const available = Math.max(64, Math.min(window.innerWidth - 28, window.innerHeight - 150));
  const displaySize = Math.max(1, Math.floor(available / WIDTH)) * WIDTH;
  canvas.style.width = `${displaySize}px`;
  canvas.style.height = `${displaySize}px`;
}

window.addEventListener("resize", fitCanvas);
window.addEventListener("keydown", (event) => {
  const handled = [
    "KeyW", "KeyS", "KeyA", "KeyD", "KeyQ", "KeyE",
    "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "KeyR", "Space",
  ].includes(event.code);
  if (handled) event.preventDefault();
  if (event.repeat) return;

  if (event.code === "KeyW" || event.code === "ArrowUp") enqueue({ kind: "move", relativeDirection: 0 });
  if (event.code === "KeyS" || event.code === "ArrowDown") enqueue({ kind: "move", relativeDirection: 2 });
  if (event.code === "KeyQ") enqueue({ kind: "move", relativeDirection: -1 });
  if (event.code === "KeyE") enqueue({ kind: "move", relativeDirection: 1 });
  if (event.code === "KeyA" || event.code === "ArrowLeft") enqueue({ kind: "turn", amount: -1 });
  if (event.code === "KeyD" || event.code === "ArrowRight") enqueue({ kind: "turn", amount: 1 });
  if (event.code === "KeyR") restart();
  if (event.code === "Space") paused = !paused;
});

fitCanvas();
updateHud(performance.now());
requestAnimationFrame(frame);
