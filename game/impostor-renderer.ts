import { cameraBasis, cameraRay, projectPoint, type Camera } from "./camera.ts";
import {
  ITEM_DEFINITIONS,
  groundItemIconImages,
  type Enemy,
  type GroundItem,
} from "./content.ts";
import { sceneHit } from "./dungeon.ts";
import { cellPosition } from "./level.ts";
import { add, dot, length, mul, normalize, sub, v } from "./math.ts";

const EPSILON = 0.001;

export type ImpostorFrame = Readonly<{
  context: CanvasRenderingContext2D;
  renderSize: number;
  camera: Camera;
  enemies: readonly Enemy[];
  groundItems: readonly GroundItem[];
}>;

/**
 * Disegna nemici billboard e drop sopra il risultato 3D.
 *
 * L'occlusione dei nemici viene valutata colonna per colonna contro la scena,
 * mentre per i piccoli oggetti basta un singolo raggio verso il centro.
 */
export function renderImpostors({
  context,
  renderSize,
  camera,
  enemies,
  groundItems,
}: ImpostorFrame): void {
  context.clearRect(0, 0, renderSize, renderSize);
  context.imageSmoothingEnabled = true;
  const basis = cameraBasis(camera);
  const projected = enemies.flatMap((enemy) => {
    if (!enemy.alive || !enemy.image.complete || enemy.image.naturalWidth === 0) return [];
    const base = add(cellPosition(enemy.column, enemy.row), v(0, 0.015, 0));
    const center = add(base, v(0, enemy.height * 0.5, 0));
    const centerOnScreen = projectPoint(center, camera, basis, renderSize);
    const topOnScreen = projectPoint(add(base, v(0, enemy.height, 0)), camera, basis, renderSize);
    const bottomOnScreen = projectPoint(base, camera, basis, renderSize);
    if (!centerOnScreen || !topOnScreen || !bottomOnScreen) return [];
    const height = Math.abs(bottomOnScreen.y - topOnScreen.y);
    const width = height * (enemy.image.naturalWidth / enemy.image.naturalHeight);
    if (height < 0.5 || centerOnScreen.x + width < 0 || centerOnScreen.x - width > renderSize) return [];
    return [{
      enemy,
      image: enemy.image,
      center,
      depth: centerOnScreen.depth,
      x: centerOnScreen.x - width * 0.5,
      centerY: centerOnScreen.y,
      y: Math.min(topOnScreen.y, bottomOnScreen.y),
      width,
      height,
    }];
  }).sort((left, right) => right.depth - left.depth);

  for (const impostor of projected) {
    const brightness = Math.max(0.42, Math.min(0.88, 0.96 - impostor.depth * 0.035));
    context.filter = `brightness(${brightness}) saturate(0.88)`;
    const firstColumn = Math.max(0, Math.floor(impostor.x));
    const lastColumn = Math.min(renderSize, Math.ceil(impostor.x + impostor.width));
    const planeNormal = normalize(v(
      camera.position.x - impostor.center.x,
      0,
      camera.position.z - impostor.center.z,
    ));
    const planeDistance = dot(sub(impostor.center, camera.position), planeNormal);
    let visibleColumns = 0;

    for (let column = firstColumn; column < lastColumn; column += 1) {
      const ray = cameraRay(
        column,
        impostor.centerY - 0.5,
        camera,
        basis,
        renderSize,
        Math.random,
        true,
      );
      const denominator = dot(ray.direction, planeNormal);
      if (Math.abs(denominator) < 1e-5) continue;
      const spriteDistance = planeDistance / denominator;
      if (spriteDistance <= EPSILON) continue;
      const blocker = sceneHit(ray, EPSILON, spriteDistance);
      if (blocker && blocker.distance < spriteDistance - 0.025) continue;
      visibleColumns += 1;

      const sourceX = ((column - impostor.x) / impostor.width) * impostor.image.naturalWidth;
      const sourceWidth = impostor.image.naturalWidth / impostor.width;
      context.drawImage(
        impostor.image,
        sourceX,
        0,
        sourceWidth,
        impostor.image.naturalHeight,
        column,
        impostor.y,
        1,
        impostor.height,
      );
    }

    if (visibleColumns > 0 && impostor.enemy.currentHealth < impostor.enemy.health) {
      const barWidth = Math.max(3, impostor.width * 0.72);
      const barX = impostor.x + (impostor.width - barWidth) * 0.5;
      const barY = impostor.y - 2;
      context.filter = "none";
      context.fillStyle = "#170705";
      context.fillRect(barX - 0.5, barY - 0.5, barWidth + 1, 2);
      context.fillStyle = "#b94332";
      context.fillRect(
        barX,
        barY,
        barWidth * (impostor.enemy.currentHealth / impostor.enemy.health),
        1,
      );
    }
  }

  context.filter = "none";
  context.imageSmoothingEnabled = false;
  for (const groundItem of groundItems) {
    const point = add(cellPosition(groundItem.column, groundItem.row), v(0, 0.12, 0));
    const onScreen = projectPoint(point, camera, basis, renderSize);
    if (!onScreen) continue;
    const toItem = sub(point, camera.position);
    const distance = length(toItem);
    const blocker = sceneHit(
      { origin: camera.position, direction: mul(toItem, 1 / Math.max(distance, EPSILON)) },
      EPSILON,
      distance,
    );
    if (blocker && blocker.distance < distance - 0.025) continue;

    const definition = ITEM_DEFINITIONS[groundItem.definitionId];
    const icon = groundItemIconImages.get(groundItem.definitionId);
    const size = Math.max(3, Math.min(7, Math.round(13 / onScreen.depth)));
    const x = Math.round(onScreen.x - size * 0.5);
    const y = Math.round(onScreen.y - size * 0.72);
    if (icon) {
      context.drawImage(icon, x, y, size, size);
    } else {
      context.fillStyle = definition.kind === "consumable"
        ? "#b94332"
        : definition.kind === "weapon" ? "#c9b28c" : "#8c633d";
      context.fillRect(x, y, size, size);
    }
  }
  context.imageSmoothingEnabled = true;
}
