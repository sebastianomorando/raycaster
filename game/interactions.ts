import { cameraBasis, cameraRay, type Camera } from "./camera.ts";
import { ITEM_DEFINITIONS, type Enemy, type GroundItem } from "./content.ts";
import { chestInteractionPosition, sceneHit, torches } from "./dungeon.ts";
import { cellPosition } from "./level.ts";
import { add, dot, mul, sub, v, type Ray, type Vec3 } from "./math.ts";

const MAX_SCAN_DISTANCE = 10;
const ATTACK_DISTANCE = 2.65;
const PICKUP_DISTANCE = 2.8;
const TORCH_DISTANCE = 3.4;
const CHEST_DISTANCE = 3.4;
const WALL_DISTANCE = 4.2;

export type InteractionKind = "attack" | "pickup" | "take-torch" | "place-torch" | "loot" | "inspect";

export type InteractionTarget = Readonly<{
  kind: InteractionKind;
  label: string;
  distance: number;
  enemyId?: number;
  itemInstanceId?: number;
  torchId?: number;
  point?: Vec3;
  normal?: Vec3;
}>;

export type InteractionQuery = Readonly<{
  camera: Camera;
  canvas: HTMLCanvasElement;
  renderSize: number;
  clientX: number;
  clientY: number;
  enemies: readonly Enemy[];
  groundItems: readonly GroundItem[];
  carriedTorches: number;
  chestLootRemaining: number;
}>;

type Candidate = InteractionTarget;

function pointerRay(query: InteractionQuery): Ray | null {
  const bounds = query.canvas.getBoundingClientRect();
  if (
    query.clientX < bounds.left || query.clientX > bounds.right ||
    query.clientY < bounds.top || query.clientY > bounds.bottom ||
    bounds.width <= 0 || bounds.height <= 0
  ) return null;
  const x = ((query.clientX - bounds.left) / bounds.width) * query.renderSize;
  const y = ((query.clientY - bounds.top) / bounds.height) * query.renderSize;
  return cameraRay(
    x,
    y,
    query.camera,
    cameraBasis(query.camera),
    query.renderSize,
    () => 0.5,
    true,
  );
}

function raySphereDistance(ray: Ray, center: Vec3, radius: number): number | null {
  const fromCenter = sub(ray.origin, center);
  const halfLinear = dot(fromCenter, ray.direction);
  const discriminant = halfLinear * halfLinear - (dot(fromCenter, fromCenter) - radius * radius);
  if (discriminant < 0) return null;
  const root = Math.sqrt(discriminant);
  const near = -halfLinear - root;
  if (near > 0.001) return near;
  const far = -halfLinear + root;
  return far > 0.001 ? far : null;
}

function rangedKind(distance: number, maximum: number, available: InteractionKind): InteractionKind {
  return distance <= maximum ? available : "inspect";
}

/**
 * Risolve ciò che si trova sotto il puntatore confrontando billboard, oggetti
 * dinamici e prima superficie della scena. Le mesh statiche fanno da occlusori.
 */
export function resolveInteraction(query: InteractionQuery): InteractionTarget | null {
  const ray = pointerRay(query);
  if (!ray) return null;
  const surface = sceneHit(ray, 0.001, MAX_SCAN_DISTANCE);
  const surfaceDistance = surface?.distance ?? MAX_SCAN_DISTANCE;
  const candidates: Candidate[] = [];

  for (const enemy of query.enemies) {
    if (!enemy.alive) continue;
    const center = cellPosition(enemy.column, enemy.row, enemy.height * 0.5);
    const distance = raySphereDistance(ray, center, Math.max(0.48, enemy.height * 0.42));
    if (distance === null || distance > MAX_SCAN_DISTANCE || distance > surfaceDistance + 0.08) continue;
    const kind = rangedKind(distance, ATTACK_DISTANCE, "attack");
    candidates.push({
      kind,
      label: kind === "attack" ? `Attack ${enemy.name}` : `${enemy.name} · too far`,
      distance,
      enemyId: enemy.id,
    });
  }

  for (const item of query.groundItems) {
    const center = cellPosition(item.column, item.row, 0.15);
    const distance = raySphereDistance(ray, center, 0.32);
    if (distance === null || distance > MAX_SCAN_DISTANCE || distance > surfaceDistance + 0.08) continue;
    const definition = ITEM_DEFINITIONS[item.definitionId];
    const kind = rangedKind(distance, PICKUP_DISTANCE, "pickup");
    candidates.push({
      kind,
      label: kind === "pickup" ? `Pick up ${definition.name}` : `${definition.name} · too far`,
      distance,
      itemInstanceId: item.instanceId,
    });
  }

  for (const torch of torches) {
    const center = add(torch.position, v(0, 0.22, 0));
    const distance = raySphereDistance(ray, center, 0.34);
    if (distance === null || distance > MAX_SCAN_DISTANCE || distance > surfaceDistance + 0.38) continue;
    const kind = rangedKind(distance, TORCH_DISTANCE, "take-torch");
    candidates.push({
      kind,
      label: kind === "take-torch" ? "Take torch" : "Torch · too far",
      distance,
      torchId: torch.id,
    });
  }

  const chestDistance = raySphereDistance(ray, chestInteractionPosition, 0.72);
  if (
    chestDistance !== null && chestDistance <= MAX_SCAN_DISTANCE &&
    chestDistance <= surfaceDistance + 0.55
  ) {
    const inRange = chestDistance <= CHEST_DISTANCE;
    candidates.push({
      kind: inRange && query.chestLootRemaining > 0 ? "loot" : "inspect",
      label: !inRange
        ? "Treasure chest · too far"
        : query.chestLootRemaining > 0 ? "Loot treasure chest" : "Empty chest",
      distance: chestDistance,
    });
  }

  const closest = candidates.sort((left, right) => left.distance - right.distance)[0];
  if (closest) return closest;

  if (
    query.carriedTorches > 0 && surface && surface.distance <= WALL_DISTANCE &&
    Math.abs(surface.normal.y) < 0.35
  ) {
    return {
      kind: "place-torch",
      label: "Place torch",
      distance: surface.distance,
      point: add(surface.point, mul(surface.normal, 0.002)),
      normal: surface.normal,
    };
  }
  return null;
}
