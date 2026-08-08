import archSource from "../ModularDungeon/OBJ/Arch.obj" with { type: "text" };
import chestSource from "../ModularDungeon/OBJ/Chest.obj" with { type: "text" };
import columnSource from "../ModularDungeon/OBJ/Column.obj" with { type: "text" };
import floorSource from "../ModularDungeon/OBJ/Floor_Modular.obj" with { type: "text" };
import spikesSource from "../ModularDungeon/OBJ/Trap_spikes.obj" with { type: "text" };
import torchSource from "../ModularDungeon/OBJ/Torch.obj" with { type: "text" };
import wallSource from "../ModularDungeon/OBJ/Wall_Modular.obj" with { type: "text" };
import woodfireSource from "../ModularDungeon/OBJ/Woodfire.obj" with { type: "text" };
import {
  createMeshInstance,
  createMeshScene,
  createObjMesh,
  hitMeshScene,
  type MeshInstance,
} from "../mesh.ts";
import { LEVEL, cellPosition, findCells, goalCell, hasFloor, trapCell } from "./level.ts";
import { add, v, type Hit, type Material, type Ray, type Vec3 } from "./math.ts";

export type SceneLight = {
  position: Vec3;
  color: Vec3;
  intensity: number;
  radius: number;
  phase: number;
  flicker: number;
};

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

const initialTorchMounts = [
  { column: 5, row: 2, offset: v(0.9, 0.78, 0), lightOffset: v(0.64, 1.25, 0), rotation: Math.PI / 2 },
  { column: 7, row: 2, offset: v(-0.9, 0.78, 0), lightOffset: v(-0.64, 1.25, 0), rotation: -Math.PI / 2 },
  { column: 5, row: 6, offset: v(-0.9, 0.78, 0), lightOffset: v(-0.64, 1.25, 0), rotation: -Math.PI / 2 },
  { column: 9, row: 7, offset: v(0.9, 0.78, 0), lightOffset: v(0.64, 1.25, 0), rotation: Math.PI / 2 },
  { column: 5, row: 12, offset: v(0.9, 0.78, 0), lightOffset: v(0.64, 1.25, 0), rotation: Math.PI / 2 },
  { column: 7, row: 12, offset: v(-0.9, 0.78, 0), lightOffset: v(-0.64, 1.25, 0), rotation: -Math.PI / 2 },
] as const;

export type TorchPlacement = Readonly<{
  id: number;
  position: Vec3;
  lightPosition: Vec3;
  rotation: number;
}>;

let nextTorchId = 1;

function createInitialTorches(): TorchPlacement[] {
  return initialTorchMounts.map((torch) => ({
    id: nextTorchId++,
    position: add(cellPosition(torch.column, torch.row), torch.offset),
    lightPosition: add(cellPosition(torch.column, torch.row), torch.lightOffset),
    rotation: torch.rotation,
  }));
}

/** Torce attualmente fissate alle pareti, interrogabili dal raycast di gioco. */
export const torches: TorchPlacement[] = createInitialTorches();

const goal = cellPosition(goalCell.column, goalCell.row);
export const chestInteractionPosition = add(goal, v(0, 0.46, 0.68));

/** Traduce la mappa simbolica in istanze mesh statiche. */
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

  for (const cell of findCells("A")) {
    instances.push(createMeshInstance(archMesh, cellPosition(cell.column, cell.row), 0.5, Math.PI / 2));
  }
  for (const cell of findCells("F")) {
    instances.push(createMeshInstance(
      woodfireMesh,
      add(cellPosition(cell.column, cell.row), v(0, 0.04, 0)),
      0.92,
    ));
  }
  for (const cell of findCells("C")) {
    instances.push(createMeshInstance(columnMesh, cellPosition(cell.column, cell.row), 0.49));
  }
  for (const torch of torches) {
    instances.push(createMeshInstance(
      torchMesh,
      torch.position,
      0.78,
      torch.rotation,
    ));
  }

  instances.push(createMeshInstance(archMesh, add(goal, v(0, 0, -1)), 0.5));
  instances.push(createMeshInstance(chestMesh, add(goal, v(0, 0.01, 0.68)), 0.88, Math.PI));

  const trap = cellPosition(trapCell.column, trapCell.row);
  // Sotto l'altezza occhi: il giocatore può attraversare la cella ferendosi.
  instances.push(createMeshInstance(spikesMesh, add(trap, v(0, -0.2, 0)), 0.72));
  return instances;
}

function createSceneLights(): SceneLight[] {
  return [
    ...findCells("F").map((cell, index) => ({
      position: add(cellPosition(cell.column, cell.row), v(0, 0.52, 0)),
      color: v(1, 0.24, 0.035), intensity: 24, radius: 0.2,
      phase: index * 1.71, flicker: 0.16,
    })),
    ...torches.map((torch, index) => ({
      position: torch.lightPosition,
      color: v(1, 0.38, 0.08), intensity: 13, radius: 0.09,
      phase: 2.3 + index * 1.37, flicker: 0.11,
    })),
  ];
}

export let dungeonScene = createMeshScene(buildDungeon());

/** L'array resta stabile perché il path tracer CPU ne conserva il riferimento. */
export const staticLights: SceneLight[] = createSceneLights();

function rebuildDungeonScene(): void {
  dungeonScene = createMeshScene(buildDungeon());
  staticLights.splice(0, staticLights.length, ...createSceneLights());
}

/** Stacca una torcia dalla parete e aggiorna geometria e luci. */
export function detachTorch(torchId: number): boolean {
  const index = torches.findIndex((torch) => torch.id === torchId);
  if (index < 0) return false;
  torches.splice(index, 1);
  rebuildDungeonScene();
  return true;
}

/**
 * Fissa una nuova torcia sul punto colpito dal raycast.
 * La normale orienta la mesh e sposta fiamma e luce verso la stanza.
 */
export function attachTorch(point: Vec3, normal: Vec3): TorchPlacement | null {
  if (Math.abs(normal.y) > 0.35) return null;
  const horizontalLength = Math.hypot(normal.x, normal.z);
  if (horizontalLength < 0.8) return null;
  const wallNormal = v(normal.x / horizontalLength, 0, normal.z / horizontalLength);
  const height = Math.max(0.5, Math.min(1.42, point.y));
  const position = v(
    point.x + wallNormal.x * 0.035,
    height,
    point.z + wallNormal.z * 0.035,
  );
  if (torches.some((torch) => Math.hypot(
    torch.position.x - position.x,
    torch.position.y - position.y,
    torch.position.z - position.z,
  ) < 0.62)) return null;

  const torch: TorchPlacement = {
    id: nextTorchId++,
    position,
    lightPosition: add(position, v(
      wallNormal.x * 0.3,
      0.47,
      wallNormal.z * 0.3,
    )),
    rotation: Math.atan2(-wallNormal.x, wallNormal.z),
  };
  torches.push(torch);
  rebuildDungeonScene();
  return torch;
}

/** Ripristina le torce iniziali insieme alla scena, usato al restart. */
export function resetDungeonState(): void {
  nextTorchId = 1;
  torches.splice(0, torches.length, ...createInitialTorches());
  rebuildDungeonScene();
}

/** Intersezione centralizzata, condivisa da path tracer e impostori. */
export function sceneHit(ray: Ray, minDistance = 0.001, maxDistance = Infinity): Hit | null {
  return hitMeshScene(ray, dungeonScene, minDistance, maxDistance);
}
