import type { Enemy, Player } from "./content.ts";
import type { TorchPlacement } from "./dungeon.ts";
import { DIRECTIONS, cellPosition, isWalkable, type Cell } from "./level.ts";

const GHOST_TORCH_REPEL_DISTANCE = 5.5;

function nearestTorchDistanceSquared(cell: Cell, torches: readonly TorchPlacement[]): number {
  const position = cellPosition(cell.column, cell.row, 0.8);
  let closest = Infinity;
  for (const torch of torches) {
    const x = position.x - torch.lightPosition.x;
    const z = position.z - torch.lightPosition.z;
    closest = Math.min(closest, x * x + z * z);
  }
  return closest;
}

/**
 * Restituisce il passo che porta il Ghost più lontano dalla torcia vicina.
 * La luce ha precedenza su inseguimento e attacco per l'intero turno del mostro.
 */
export function ghostFleeStep(
  enemy: Enemy,
  player: Player,
  enemies: readonly Enemy[],
  torches: readonly TorchPlacement[],
): Cell | null {
  if (enemy.name !== "Ghost") return null;
  const current = { column: enemy.column, row: enemy.row };
  const currentDistance = nearestTorchDistanceSquared(current, torches);
  if (currentDistance > GHOST_TORCH_REPEL_DISTANCE ** 2) return null;

  const candidates = DIRECTIONS.map((direction) => ({
    column: enemy.column + direction.column,
    row: enemy.row + direction.row,
  })).filter((cell) =>
    isWalkable(cell.column, cell.row) &&
    !(cell.column === player.column && cell.row === player.row) &&
    !enemies.some((candidate) =>
      candidate.alive && candidate.id !== enemy.id &&
      candidate.column === cell.column && candidate.row === cell.row)
  ).sort((left, right) =>
    nearestTorchDistanceSquared(right, torches) - nearestTorchDistanceSquared(left, torches));

  const best = candidates[0];
  return best && nearestTorchDistanceSquared(best, torches) > currentDistance + 0.01
    ? best
    : null;
}
