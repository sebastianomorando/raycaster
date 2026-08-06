import { v, type Vec3 } from "./math.ts";

export type Cell = { column: number; row: number };

export const TILE_SIZE = 2;

/**
 * Mappa logica del dungeon.
 *
 * `#` muro, `S` partenza, `G` obiettivo, `F` fuoco, `C` colonna,
 * `A` arco e `T` trappola.
 */
export const LEVEL = [
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

export const DIRECTIONS = [
  { column: 0, row: -1, name: "N" },
  { column: 1, row: 0, name: "E" },
  { column: 0, row: 1, name: "S" },
  { column: -1, row: 0, name: "O" },
] as const;

export function findCell(symbol: string): Cell {
  for (let row = 0; row < LEVEL.length; row += 1) {
    const column = LEVEL[row]?.indexOf(symbol) ?? -1;
    if (column >= 0) return { column, row };
  }
  throw new Error(`Cella ${symbol} non trovata`);
}

export function findCells(symbol: string): Cell[] {
  const cells: Cell[] = [];
  for (let row = 0; row < LEVEL.length; row += 1) {
    for (let column = 0; column < (LEVEL[row]?.length ?? 0); column += 1) {
      if (LEVEL[row]?.[column] === symbol) cells.push({ column, row });
    }
  }
  return cells;
}

export const startCell = findCell("S");
export const goalCell = findCell("G");
export const trapCell = findCell("T");

export function cellSymbol(column: number, row: number): string {
  return LEVEL[row]?.[column] ?? "#";
}

export function hasFloor(column: number, row: number): boolean {
  return cellSymbol(column, row) !== "#";
}

/** Una cella può avere pavimento ma essere occupata da un ostacolo statico. */
export function isWalkable(column: number, row: number): boolean {
  return !["#", "F", "C"].includes(cellSymbol(column, row));
}

/** Converte coordinate di griglia in coordinate mondo, relative alla partenza. */
export function cellPosition(column: number, row: number, height = 0): Vec3 {
  return v(
    (column - startCell.column) * TILE_SIZE,
    height,
    (row - startCell.row) * TILE_SIZE,
  );
}
