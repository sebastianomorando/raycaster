/**
 * Entry point del gioco.
 *
 * Qui rimangono lo stato della partita, le regole a turni, il loop principale e
 * il collegamento con il DOM. Dati, scena 3D e renderer vivono nei moduli `game/`.
 */
import { cameraBasis, projectPoint, type Camera } from "./game/camera.ts";
import {
  GameEntityFactory,
  ITEM_DEFINITIONS,
  createEnemies,
  type Enemy,
  type GroundItem,
  type InventoryItem,
} from "./game/content.ts";
import { resolveAttack, type DamageRoll } from "./game/combat.ts";
import { CpuPathTracer } from "./game/cpu-path-tracer.ts";
import { ghostFleeStep } from "./game/enemy-ai.ts";
import {
  attachTorch,
  detachTorch,
  dungeonScene,
  resetDungeonState,
  staticLights,
  torches,
  type SceneLight,
} from "./game/dungeon.ts";
import { renderImpostors as drawImpostors } from "./game/impostor-renderer.ts";
import { GameInputController, type InputAction } from "./game/input.ts";
import { resolveInteraction, type InteractionTarget } from "./game/interactions.ts";
import {
  DIRECTIONS,
  LEVEL,
  cellPosition,
  cellSymbol,
  isWalkable,
  startCell,
  type Cell,
} from "./game/level.ts";
import { add, ease, lerp, v } from "./game/math.ts";
import { GameUi } from "./game/ui.ts";
import { packMeshScene } from "./mesh.ts";
import { createWebGpuRenderer, type WebGpuRenderer } from "./renderer-webgpu.ts";

const RESOLUTIONS = [32, 64, 128, 256] as const;
type RenderResolution = typeof RESOLUTIONS[number];
let renderSize: RenderResolution = 64;
const EYE_HEIGHT = 0.68;
const MOTION_SAMPLES = 1;
const MOVE_DURATION = 210;
const TURN_DURATION = 180;
const VIEW_RESET_DURATION = 160;
const LOOK_SENSITIVITY = 0.006;
const MAX_LOOK_PITCH = 70 * (Math.PI / 180);
const DEFAULT_FOV = 58 * (Math.PI / 180);
const MIN_FOV = 30 * (Math.PI / 180);
const MAX_FOV = 90 * (Math.PI / 180);
const ZOOM_SENSITIVITY = 0.0008;
const INVENTORY_CAPACITY = 8;
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

type ViewSnap = {
  startedAt: number;
  fromYaw: number;
  fromPitch: number;
  fromFov: number;
  toYaw: number;
};

// Stato camera e riferimenti all'interfaccia.
const camera: Camera = {
  position: cellPosition(startCell.column, startCell.row, EYE_HEIGHT),
  yaw: Math.PI,
  pitch: 0,
  fov: DEFAULT_FOV,
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

const ui = new GameUi();
const viewFrame = ui.frame;
const spriteCanvas = ui.spriteCanvas;
let canvas = ui.canvas;
canvas.width = renderSize;
canvas.height = renderSize;

const canvasContext = canvas.getContext("2d", { alpha: false });
if (!canvasContext) throw new Error("2D rendering context is unavailable");
const context = canvasContext;
context.imageSmoothingEnabled = false;
const impostorContextValue = spriteCanvas.getContext("2d");
if (!impostorContextValue) throw new Error("2D impostor context is unavailable");
const impostorContext = impostorContextValue;
impostorContext.imageSmoothingEnabled = true;

const entityFactory = new GameEntityFactory();
let enemies = createEnemies();
let player = entityFactory.createPlayer();
let groundItems = entityFactory.createGroundItems();
let chestLoot: InventoryItem[] = [
  entityFactory.createItem("bone_mail"),
  entityFactory.createItem("spirit_tonic"),
];
const cpuRenderer = new CpuPathTracer(context, renderSize, staticLights);

// Stato transitorio della partita e del loop.
const actionQueue: InputAction[] = [];
const triggeredTraps = new Set<string>();
let activeAction: ActiveAction | null = null;
let viewSnap: ViewSnap | null = null;
let samples = 0;
let cameraDirty = true;
let paused = false;
let gpuRenderer: WebGpuRenderer | null = null;
let packedSceneCache: ReturnType<typeof packMeshScene> | null = null;
let resolutionChanging = false;
let inventoryOpen = false;
let gameplayRandomState = 0x51f15e;
let inputController: GameInputController;
let carriedTorches = 0;
let pointerPosition: { clientX: number; clientY: number } | null = null;
let interactionTarget: InteractionTarget | null = null;

function markCameraChanged(): void {
  cameraDirty = true;
}

function showMessage(message: string, duration = 1400): void {
  ui.showMessage(message, duration);
}

function gameplayRandom(): number {
  gameplayRandomState ^= gameplayRandomState << 13;
  gameplayRandomState ^= gameplayRandomState >>> 17;
  gameplayRandomState ^= gameplayRandomState << 5;
  return (gameplayRandomState >>> 0) / 4294967296;
}

function inventoryItem(instanceId: number | null): InventoryItem | null {
  return player.inventory.find((item) => item.instanceId === instanceId) ?? null;
}

function playerAttackBonus(): number {
  const weapon = inventoryItem(player.weaponInstanceId);
  return player.baseAttackBonus +
    (weapon ? ITEM_DEFINITIONS[weapon.definitionId].attackBonus ?? 0 : 0);
}

function playerArmorClass(): number {
  const armor = inventoryItem(player.armorInstanceId);
  return player.baseArmorClass +
    (armor ? ITEM_DEFINITIONS[armor.definitionId].armorClassBonus ?? 0 : 0);
}

function playerDamageRoll(): DamageRoll {
  const weapon = inventoryItem(player.weaponInstanceId);
  return weapon
    ? ITEM_DEFINITIONS[weapon.definitionId].damage ?? { bonus: 0, dice: 1, sides: 2 }
    : { bonus: 0, dice: 1, sides: 2 };
}

function addCombatMessage(message: string, duration = 1800): void {
  ui.addCombatMessage(message);
  showMessage(message, duration);
}

/** Ricostruisce il pannello a partire dall'inventario corrente. */
function renderInventoryPanel(): void {
  ui.renderInventory({
    player,
    attackBonus: playerAttackBonus(),
    armorClass: playerArmorClass(),
    torches: carriedTorches,
    disabled: activeAction !== null || viewSnap !== null || player.dead || player.won,
    onUse: useInventorySlot,
  });
}

function setInventoryOpen(open: boolean): void {
  inventoryOpen = open;
  ui.setInventoryOpen(open);
  if (open) ui.setInteraction(null);
  if (open) renderInventoryPanel();
}

function enemyAt(column: number, row: number, excludedId?: number): Enemy | null {
  return enemies.find((enemy) =>
    enemy.alive && enemy.id !== excludedId && enemy.column === column && enemy.row === row) ?? null;
}

function killPlayer(): void {
  player.dead = true;
  actionQueue.length = 0;
  setInventoryOpen(false);
  showMessage("YOU DIED · PRESS R TO RESTART", Infinity);
  ui.addCombatMessage("You died in the dungeon.");
}

function damagePlayer(amount: number, source: string, attackDetail?: string): void {
  const damage = Math.max(1, amount);
  player.health = Math.max(0, player.health - damage);
  addCombatMessage(`${source} hits you${attackDetail ? ` (${attackDetail})` : ""}: −${damage}`);
  if (player.health <= 0) killPlayer();
}

function showEnemyCombatPopup(enemy: Enemy, text: string, kind: "damage" | "miss"): void {
  const projected = projectPoint(
    cellPosition(enemy.column, enemy.row, Math.max(0.58, enemy.height * 0.72)),
    camera,
    cameraBasis(camera),
    renderSize,
  );
  ui.showCombatPopup(
    text,
    projected ? projected.x / renderSize : 0.5,
    projected ? projected.y / renderSize : 0.38,
    kind,
  );
}

function attackEnemy(enemy: Enemy): void {
  const attack = resolveAttack(
    gameplayRandom,
    playerAttackBonus(),
    enemy.armorClass,
    playerDamageRoll(),
  );
  enemy.alerted = true;
  const now = performance.now();
  if (!attack.hit) {
    showEnemyCombatPopup(enemy, "MISS", "miss");
    addCombatMessage(
      `You miss ${enemy.name}: d20 ${attack.naturalRoll} + ${playerAttackBonus()} = ${attack.total} vs AC ${enemy.armorClass}.`,
    );
    return;
  }

  enemy.currentHealth = Math.max(0, enemy.currentHealth - attack.damage);
  enemy.hitFlashUntil = now + 520;
  showEnemyCombatPopup(enemy, `−${attack.damage}`, "damage");
  addCombatMessage(
    `You hit ${enemy.name}: ${attack.total} vs AC ${enemy.armorClass}, −${attack.damage} HP${
      attack.critical ? " · CRITICAL" : ""
    }`,
  );
  if (enemy.currentHealth > 0) return;

  enemy.alive = false;
  groundItems.push({ ...entityFactory.createItem(enemy.drop), column: enemy.column, row: enemy.row });
  addCombatMessage(`${enemy.name} dies and drops ${ITEM_DEFINITIONS[enemy.drop].name}.`, 2400);
}

/** Trova con BFS il primo passo di un nemico verso il giocatore. */
function findEnemyPath(enemy: Enemy): { step: Cell; distance: number } | null {
  const startKey = `${enemy.column},${enemy.row}`;
  const queue: Array<{ cell: Cell; first: Cell | null; distance: number }> = [{
    cell: { column: enemy.column, row: enemy.row },
    first: null,
    distance: 0,
  }];
  const visited = new Set([startKey]);
  const maximumDistance = enemy.alerted ? LEVEL.length * LEVEL[0].length : enemy.sight;

  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index];
    if (!current || current.distance >= maximumDistance) continue;
    for (const direction of DIRECTIONS) {
      const next = {
        column: current.cell.column + direction.column,
        row: current.cell.row + direction.row,
      };
      const key = `${next.column},${next.row}`;
      if (visited.has(key)) continue;
      visited.add(key);
      const first = current.first ?? next;
      const distance = current.distance + 1;
      if (next.column === player.column && next.row === player.row) return { step: first, distance };
      if (!isWalkable(next.column, next.row) || enemyAt(next.column, next.row, enemy.id)) continue;
      queue.push({ cell: next, first, distance });
    }
  }
  return null;
}

function runEnemyTurns(): void {
  for (const enemy of enemies) {
    if (!enemy.alive || player.dead || player.won) continue;
    const fleeStep = ghostFleeStep(enemy, player, enemies, torches);
    if (fleeStep) {
      enemy.column = fleeStep.column;
      enemy.row = fleeStep.row;
      enemy.alerted = false;
      ui.addCombatMessage("The Ghost recoils from the torchlight.");
      continue;
    }
    const distance = Math.abs(enemy.column - player.column) + Math.abs(enemy.row - player.row);
    if (distance === 1) {
      const attack = resolveAttack(
        gameplayRandom,
        enemy.attackBonus,
        playerArmorClass(),
        enemy.damage,
      );
      if (!attack.hit) {
        addCombatMessage(
          `${enemy.name} misses: d20 ${attack.naturalRoll} + ${enemy.attackBonus} = ${attack.total} vs AC ${playerArmorClass()}.`,
        );
        continue;
      }
      damagePlayer(
        attack.damage,
        enemy.name,
        `${attack.total} vs AC ${playerArmorClass()}`,
      );
      if (attack.critical) ui.addCombatMessage(`${enemy.name} scores a critical hit!`);
      continue;
    }

    const path = findEnemyPath(enemy);
    if (!path) continue;
    enemy.alerted = true;
    if (path.step.column === player.column && path.step.row === player.row) continue;
    enemy.column = path.step.column;
    enemy.row = path.step.row;
  }
}

/** Chiude il turno del giocatore ed esegue, in ordine, tutti i nemici vivi. */
function finishPlayerTurn(): void {
  player.turns += 1;
  if (!player.dead && !player.won) runEnemyTurns();
  renderInventoryPanel();
}

function pickupGroundItems(): void {
  const remaining: GroundItem[] = [];
  let inventoryFullReported = false;
  for (const item of groundItems) {
    if (item.column !== player.column || item.row !== player.row) {
      remaining.push(item);
      continue;
    }
    if (player.inventory.length >= INVENTORY_CAPACITY) {
      remaining.push(item);
      if (!inventoryFullReported) addCombatMessage("Inventory full: you cannot carry anything else.");
      inventoryFullReported = true;
      continue;
    }
    player.inventory.push({ instanceId: item.instanceId, definitionId: item.definitionId });
    addCombatMessage(`You pick up ${ITEM_DEFINITIONS[item.definitionId].name}.`);
  }
  groundItems = remaining;
  renderInventoryPanel();
}

function interactionAt(clientX: number, clientY: number): InteractionTarget | null {
  return resolveInteraction({
    camera,
    canvas,
    renderSize,
    clientX,
    clientY,
    enemies,
    groundItems,
    carriedTorches,
    chestLootRemaining: chestLoot.length,
  });
}

/** Invalida sia l'accumulo CPU sia i buffer GPU dopo una modifica al dungeon. */
function dungeonGeometryChanged(): void {
  packedSceneCache = null;
  interactionTarget = null;
  markCameraChanged();
  if (gpuRenderer) void initializeWebGpu(renderSize);
}

function updateInteractionTarget(): void {
  if (
    !pointerPosition || inventoryOpen || inputController.isLooking || activeAction || viewSnap ||
    paused || player.dead || player.won || resolutionChanging
  ) {
    interactionTarget = null;
    ui.setInteraction(null);
    return;
  }
  interactionTarget = interactionAt(pointerPosition.clientX, pointerPosition.clientY);
  ui.setInteraction(
    interactionTarget?.kind ?? null,
    interactionTarget?.label,
    pointerPosition.clientX,
    pointerPosition.clientY,
  );
}

function pickupPointedItem(instanceId: number): boolean {
  const index = groundItems.findIndex((item) => item.instanceId === instanceId);
  const item = groundItems[index];
  if (!item) return false;
  if (player.inventory.length >= INVENTORY_CAPACITY) {
    addCombatMessage("Inventory full: you cannot carry anything else.");
    return false;
  }
  groundItems.splice(index, 1);
  player.inventory.push({ instanceId: item.instanceId, definitionId: item.definitionId });
  addCombatMessage(`You pick up ${ITEM_DEFINITIONS[item.definitionId].name}.`);
  return true;
}

function lootChest(): boolean {
  if (chestLoot.length === 0) {
    showMessage("The chest is empty.");
    return false;
  }
  const freeSlots = INVENTORY_CAPACITY - player.inventory.length;
  if (freeSlots <= 0) {
    addCombatMessage("Inventory full: the treasure remains in the chest.");
    return false;
  }
  const looted = chestLoot.splice(0, freeSlots);
  player.inventory.push(...looted);
  const names = looted.map((item) => ITEM_DEFINITIONS[item.definitionId].name).join(" and ");
  addCombatMessage(`You loot the chest: ${names}.`, 2600);
  if (chestLoot.length > 0) ui.addCombatMessage("There is still treasure inside.");
  return true;
}

/** Esegue l'azione contestuale risolta dallo stesso raggio usato per il cursore. */
function interactAt(clientX: number, clientY: number): void {
  if (
    inventoryOpen || activeAction || viewSnap || paused || player.dead || player.won ||
    resolutionChanging
  ) return;
  const target = interactionAt(clientX, clientY);
  if (!target) return;

  let consumedTurn = false;
  if (target.kind === "attack" && target.enemyId !== undefined) {
    const enemy = enemies.find((candidate) => candidate.id === target.enemyId && candidate.alive);
    if (enemy) {
      attackEnemy(enemy);
      consumedTurn = true;
    }
  } else if (target.kind === "pickup" && target.itemInstanceId !== undefined) {
    consumedTurn = pickupPointedItem(target.itemInstanceId);
  } else if (target.kind === "take-torch" && target.torchId !== undefined) {
    if (detachTorch(target.torchId)) {
      carriedTorches += 1;
      addCombatMessage("You take the torch. Darkness fills the empty corner.");
      dungeonGeometryChanged();
      consumedTurn = true;
    }
  } else if (target.kind === "place-torch" && target.point && target.normal) {
    const torch = carriedTorches > 0 ? attachTorch(target.point, target.normal) : null;
    if (torch) {
      carriedTorches -= 1;
      addCombatMessage("You fix the torch to the wall. Shadows retreat.");
      dungeonGeometryChanged();
      consumedTurn = true;
    } else {
      showMessage("The torch will not hold there.");
    }
  } else if (target.kind === "loot") {
    consumedTurn = lootChest();
  } else if (target.kind === "inspect") {
    showMessage(target.label);
  }

  if (consumedTurn) finishPlayerTurn();
  renderInventoryPanel();
  updateInteractionTarget();
}

function useInventorySlot(index: number): void {
  if (activeAction || viewSnap || inputController.isLooking || player.dead || player.won) return;
  const item = player.inventory[index];
  if (!item) return;
  const definition = ITEM_DEFINITIONS[item.definitionId];

  if (definition.kind === "consumable") {
    if (player.health >= player.maxHealth) {
      addCombatMessage("You are already at full health.");
      return;
    }
    const healing = Math.min(definition.healing ?? 0, player.maxHealth - player.health);
    player.health += healing;
    player.inventory.splice(index, 1);
    addCombatMessage(`You use ${definition.name}: +${healing} HP.`);
  } else if (definition.kind === "weapon") {
    if (player.weaponInstanceId === item.instanceId) return;
    player.weaponInstanceId = item.instanceId;
    addCombatMessage(`You equip ${definition.name}.`);
  } else {
    if (player.armorInstanceId === item.instanceId) return;
    player.armorInstanceId = item.instanceId;
    addCombatMessage(`You equip ${definition.name}.`);
  }

  setInventoryOpen(false);
  finishPlayerTurn();
}

function enqueue(action: InputAction): void {
  if (player.dead || player.won || inventoryOpen || actionQueue.length >= 2) return;
  actionQueue.push(action);
}

/** Traduce il prossimo comando accodato in movimento, rotazione o attacco. */
function beginNextAction(now: number): void {
  const action = actionQueue.shift();
  if (!action) return;

  if (action.kind === "wait") {
    addCombatMessage("You wait and listen to the dungeon.");
    finishPlayerTurn();
    return;
  }

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

  const snappedTurns = Math.round(camera.yaw / (Math.PI / 2));
  const targetFacing = ((snappedTurns % 4) + 4) % 4;
  const directionIndex = (targetFacing + action.relativeDirection + 4) % 4;
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
        ? "The fire blocks your way."
        : obstacle === "C" ? "A pillar blocks your way." : "The wall does not move.",
      850,
    );
    return;
  }
  player.facing = targetFacing;
  viewSnap = {
    startedAt: now,
    fromYaw: camera.yaw,
    fromPitch: camera.pitch,
    fromFov: camera.fov,
    toYaw: snappedTurns * (Math.PI / 2),
  };
  const targetEnemy = enemyAt(to.column, to.row);
  if (targetEnemy) {
    attackEnemy(targetEnemy);
    finishPlayerTurn();
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
      damagePlayer(5, "The spikes");
    }
  }
  if (player.dead) return;
  pickupGroundItems();
  if (symbol === "G" && chestLoot.length > 0) {
    showMessage("TREASURE CHEST · CLICK IT TO LOOT", 2600);
  }
}

/** Riallinea visuale e zoom alla griglia soltanto quando inizia un movimento. */
function updateViewSnap(now: number): void {
  if (!viewSnap) return;
  const linearProgress = Math.min(1, (now - viewSnap.startedAt) / VIEW_RESET_DURATION);
  const progress = ease(linearProgress);
  camera.yaw = viewSnap.fromYaw + (viewSnap.toYaw - viewSnap.fromYaw) * progress;
  camera.pitch = viewSnap.fromPitch * (1 - progress);
  camera.fov = viewSnap.fromFov + (DEFAULT_FOV - viewSnap.fromFov) * progress;
  markCameraChanged();

  if (linearProgress < 1) return;
  camera.yaw = viewSnap.toYaw;
  camera.pitch = 0;
  camera.fov = DEFAULT_FOV;
  viewSnap = null;
}

function updateGame(now: number): void {
  updateViewSnap(now);
  if (!activeAction && !inputController.isLooking && !viewSnap) beginNextAction(now);
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
  const completedAction = activeAction;
  if (completedAction.kind === "move") {
    player.column = completedAction.to.column;
    player.row = completedAction.to.row;
    camera.position = cellPosition(player.column, player.row, EYE_HEIGHT);
    enteredCell();
  } else {
    player.facing = completedAction.targetFacing;
    camera.yaw = completedAction.toYaw;
  }
  activeAction = null;
  if (completedAction.kind === "move") finishPlayerTurn();
}

function updateHud(now: number): void {
  const direction = DIRECTIONS[player.facing]?.name ?? "?";
  ui.renderHud(now, {
    player,
    direction,
    attackBonus: playerAttackBonus(),
    armorClass: playerArmorClass(),
    torches: carriedTorches,
    objective: chestLoot.length > 0 ? "Find and loot the treasure" : "Explore the dungeon",
  });
}

/** Loop principale: simulazione, renderer disponibile, overlay e nuovo frame. */
function frame(now: number): void {
  renderTimeSeconds = now / 1000;
  updateGame(now);
  updateHud(now);
  updateInteractionTarget();
  playerLight.position = add(camera.position, v(0, 0.14, 0));

  if (resolutionChanging) {
    ui.setSamples(`${samples} spp · changing resolution`);
  } else if (gpuRenderer && !paused) {
    const basis = cameraBasis(camera);
    samples = gpuRenderer.render({
      position: camera.position,
      forward: basis.forward,
      right: basis.right,
      up: basis.up,
      playerLightPosition: playerLight.position,
      playerLightColor: playerLight.color,
      playerLightIntensity: playerLight.intensity,
      fov: camera.fov,
      time: renderTimeSeconds,
      reset: cameraDirty,
      moving: cameraDirty || activeAction !== null,
    });
    cameraDirty = false;
    ui.setSamples(`${samples} spp · GPU`);
  } else if (gpuRenderer && paused) {
    ui.setSamples(`${samples} spp · GPU · paused`);
  } else if (cameraDirty) {
    cpuRenderer.reset();
    for (let sample = 0; sample < MOTION_SAMPLES; sample += 1) {
      cpuRenderer.renderSample(camera, playerLight, renderTimeSeconds, true);
    }
    samples = cpuRenderer.samples;
    cameraDirty = false;
    cpuRenderer.present();
    ui.setSamples(`${samples} spp`);
  } else if (!paused) {
    cpuRenderer.renderSample(camera, playerLight, renderTimeSeconds);
    samples = cpuRenderer.samples;
    cpuRenderer.present();
    ui.setSamples(`${samples} spp`);
  } else {
    ui.setSamples(`${samples} spp · paused`);
  }
  drawImpostors({ context: impostorContext, renderSize, camera, now, enemies, groundItems });
  requestAnimationFrame(frame);
}

function updateResolutionButton(): void {
  ui.setResolution(renderSize);
}

function resizeCpuRenderer(resolution: RenderResolution): void {
  renderSize = resolution;
  canvas.width = renderSize;
  canvas.height = renderSize;
  spriteCanvas.width = renderSize;
  spriteCanvas.height = renderSize;
  context.imageSmoothingEnabled = false;
  impostorContext.imageSmoothingEnabled = true;
  cpuRenderer.resize(renderSize);
  samples = 0;
  cameraDirty = true;
  updateResolutionButton();
  fitCanvas();
}

async function initializeWebGpu(resolution: RenderResolution = renderSize): Promise<boolean> {
  if (!(navigator as Navigator & { gpu?: unknown }).gpu || resolutionChanging) return false;
  resolutionChanging = true;
  ui.setResolutionBusy(true);
  const previousCanvas = canvas;
  const gpuCanvas = canvas.cloneNode(true) as HTMLCanvasElement;
  gpuCanvas.width = resolution;
  gpuCanvas.height = resolution;

  try {
    packedSceneCache ??= packMeshScene(dungeonScene);
    const renderer = await createWebGpuRenderer(gpuCanvas, packedSceneCache, staticLights, resolution);
    if (!renderer) return false;
    const previousRenderer = gpuRenderer;
    previousCanvas.replaceWith(gpuCanvas);
    canvas = gpuCanvas;
    gpuRenderer = renderer;
    renderSize = resolution;
    spriteCanvas.width = renderSize;
    spriteCanvas.height = renderSize;
    impostorContext.imageSmoothingEnabled = true;
    samples = 0;
    cameraDirty = true;
    previousRenderer?.destroy();
    updateResolutionButton();
    fitCanvas();
    return true;
  } catch (error) {
    console.warn("WebGPU is unavailable; keeping the CPU renderer.", error);
    return false;
  } finally {
    resolutionChanging = false;
    ui.setResolutionBusy(false);
  }
}

async function cycleResolution(): Promise<void> {
  if (resolutionChanging) return;
  const currentIndex = RESOLUTIONS.indexOf(renderSize);
  const nextResolution = RESOLUTIONS[(currentIndex + 1) % RESOLUTIONS.length] ?? 64;
  if (gpuRenderer) {
    await initializeWebGpu(nextResolution);
  } else {
    resizeCpuRenderer(nextResolution);
  }
}

function restart(): void {
  entityFactory.reset();
  player = entityFactory.createPlayer();
  groundItems = entityFactory.createGroundItems();
  chestLoot = [
    entityFactory.createItem("bone_mail"),
    entityFactory.createItem("spirit_tonic"),
  ];
  enemies = createEnemies();
  carriedTorches = 0;
  resetDungeonState();
  gameplayRandomState = 0x51f15e;
  triggeredTraps.clear();
  ui.clearCombatLog();
  actionQueue.length = 0;
  activeAction = null;
  viewSnap = null;
  paused = false;
  setInventoryOpen(false);
  ui.setInteraction(null);
  camera.position = cellPosition(startCell.column, startCell.row, EYE_HEIGHT);
  camera.yaw = Math.PI;
  camera.pitch = 0;
  camera.fov = DEFAULT_FOV;
  addCombatMessage("You enter the dungeon. Every step could be your last.", 2200);
  renderInventoryPanel();
  dungeonGeometryChanged();
}

function fitCanvas(): void {
  const displaySize = ui.frameDisplaySize(renderSize);
  canvas.style.width = `${displaySize}px`;
  canvas.style.height = `${displaySize}px`;
  spriteCanvas.style.width = `${displaySize}px`;
  spriteCanvas.style.height = `${displaySize}px`;
}

inputController = new GameInputController({
  frame: viewFrame,
  inventoryPanel: ui.inventoryPanel,
  resolutionButton: ui.resolutionButton,
  camera,
  lookSensitivity: LOOK_SENSITIVITY,
  maxLookPitch: MAX_LOOK_PITCH,
  minFov: MIN_FOV,
  maxFov: MAX_FOV,
  zoomSensitivity: ZOOM_SENSITIVITY,
  isInventoryOpen: () => inventoryOpen,
  canStartLook: () => activeAction?.kind !== "turn",
  onLookStart: () => { viewSnap = null; },
  onCameraChanged: markCameraChanged,
  onPointerPosition: (clientX, clientY) => {
    pointerPosition = { clientX, clientY };
    updateInteractionTarget();
  },
  onPointerLeave: () => {
    pointerPosition = null;
    interactionTarget = null;
    ui.setInteraction(null);
  },
  onInteract: interactAt,
  onAction: enqueue,
  onInventory: setInventoryOpen,
  onInventorySlot: useInventorySlot,
  onRestart: restart,
  onTogglePause: () => { paused = !paused; },
  onResize: fitCanvas,
  onCycleResolution: () => { void cycleResolution(); },
});
fitCanvas();
updateResolutionButton();
updateHud(performance.now());
addCombatMessage("You enter the dungeon. Every step could be your last.", 2200);
renderInventoryPanel();
requestAnimationFrame(frame);
void initializeWebGpu();
