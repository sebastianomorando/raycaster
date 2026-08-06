/**
 * Entry point del gioco.
 *
 * Qui rimangono lo stato della partita, le regole a turni, il loop principale e
 * il collegamento con il DOM. Dati, scena 3D e renderer vivono nei moduli `game/`.
 */
import { cameraBasis, type Camera } from "./game/camera.ts";
import {
  GameEntityFactory,
  ITEM_DEFINITIONS,
  createEnemies,
  type Enemy,
  type GroundItem,
  type InventoryItem,
} from "./game/content.ts";
import { CpuPathTracer } from "./game/cpu-path-tracer.ts";
import { dungeonScene, staticLights, type SceneLight } from "./game/dungeon.ts";
import { renderImpostors as drawImpostors } from "./game/impostor-renderer.ts";
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
type QueuedAction =
  | { kind: "move"; relativeDirection: number }
  | { kind: "turn"; amount: -1 | 1 }
  | { kind: "wait" };
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

const canvasElement = document.querySelector<HTMLCanvasElement>("#app");
const impostorCanvas = document.querySelector<HTMLCanvasElement>("#impostors");
const sampleLabel = document.querySelector<HTMLElement>("#samples");
const messageLabel = document.querySelector<HTMLElement>("#message");
const positionLabel = document.querySelector<HTMLElement>("#position");
const healthLabel = document.querySelector<HTMLElement>("#health");
const combatLogElement = document.querySelector<HTMLElement>("#combat-log");
const inventoryPanelElement = document.querySelector<HTMLElement>("#inventory");
const inventoryItemsElement = document.querySelector<HTMLElement>("#inventory-items");
const equipmentElement = document.querySelector<HTMLElement>("#equipment");
const resolutionButton = document.querySelector<HTMLButtonElement>("#resolution");
const frameElement = document.querySelector<HTMLElement>(".frame");
if (!canvasElement) throw new Error("Canvas #app non trovato");
if (!impostorCanvas) throw new Error("Canvas #impostors non trovato");
if (!frameElement) throw new Error("Contenitore .frame non trovato");
if (!combatLogElement || !inventoryPanelElement || !inventoryItemsElement || !equipmentElement) {
  throw new Error("Interfaccia di combattimento non trovata");
}
const viewFrame = frameElement;
const spriteCanvas = impostorCanvas;
const combatLog = combatLogElement;
const inventoryPanel = inventoryPanelElement;
const inventoryItems = inventoryItemsElement;
const equipment = equipmentElement;
let canvas = canvasElement;
canvas.width = renderSize;
canvas.height = renderSize;

const canvasContext = canvas.getContext("2d", { alpha: false });
if (!canvasContext) throw new Error("Contesto 2D non disponibile");
const context = canvasContext;
context.imageSmoothingEnabled = false;
const impostorContextValue = spriteCanvas.getContext("2d");
if (!impostorContextValue) throw new Error("Contesto impostori 2D non disponibile");
const impostorContext = impostorContextValue;
impostorContext.imageSmoothingEnabled = true;

const entityFactory = new GameEntityFactory();
let enemies = createEnemies();
let player = entityFactory.createPlayer();
let groundItems = entityFactory.createGroundItems();
const cpuRenderer = new CpuPathTracer(context, renderSize, staticLights);

// Stato transitorio della partita e del loop.
const actionQueue: QueuedAction[] = [];
const triggeredTraps = new Set<string>();
const combatMessages: string[] = [];
let activeAction: ActiveAction | null = null;
let viewSnap: ViewSnap | null = null;
let lookPointerId: number | null = null;
let lastLookX = 0;
let lastLookY = 0;
let statusMessage = "Trova il baule oltre il labirinto";
let statusUntil = 0;
let samples = 0;
let cameraDirty = true;
let paused = false;
let gpuRenderer: WebGpuRenderer | null = null;
let packedSceneCache: ReturnType<typeof packMeshScene> | null = null;
let resolutionChanging = false;
let inventoryOpen = false;
let gameplayRandomState = 0x51f15e;

function markCameraChanged(): void {
  cameraDirty = true;
}

function showMessage(message: string, duration = 1400): void {
  statusMessage = message;
  statusUntil = performance.now() + duration;
}

function gameplayRandom(): number {
  gameplayRandomState ^= gameplayRandomState << 13;
  gameplayRandomState ^= gameplayRandomState >>> 17;
  gameplayRandomState ^= gameplayRandomState << 5;
  return (gameplayRandomState >>> 0) / 4294967296;
}

function rollDie(sides: number): number {
  return 1 + Math.floor(gameplayRandom() * Math.max(1, sides));
}

function inventoryItem(instanceId: number | null): InventoryItem | null {
  return player.inventory.find((item) => item.instanceId === instanceId) ?? null;
}

function playerAttackPower(): number {
  const weapon = inventoryItem(player.weaponInstanceId);
  return player.baseAttack + (weapon ? ITEM_DEFINITIONS[weapon.definitionId].attack ?? 0 : 0);
}

function playerDefensePower(): number {
  const armor = inventoryItem(player.armorInstanceId);
  return player.baseDefense + (armor ? ITEM_DEFINITIONS[armor.definitionId].defense ?? 0 : 0);
}

function addCombatMessage(message: string, duration = 1800): void {
  combatMessages.push(message);
  if (combatMessages.length > 4) combatMessages.shift();
  combatLog.replaceChildren(...combatMessages.map((entry) => {
    const line = document.createElement("div");
    line.textContent = entry;
    return line;
  }));
  showMessage(message, duration);
}

function itemDescription(item: InventoryItem): string {
  const definition = ITEM_DEFINITIONS[item.definitionId];
  if (definition.kind === "weapon") return `${definition.name} · ATK +${definition.attack ?? 0}`;
  if (definition.kind === "armor") return `${definition.name} · DIF +${definition.defense ?? 0}`;
  return `${definition.name} · cura ${definition.healing ?? 0}`;
}

/** Ricostruisce il pannello a partire dall'inventario corrente. */
function renderInventoryPanel(): void {
  const weapon = inventoryItem(player.weaponInstanceId);
  const armor = inventoryItem(player.armorInstanceId);
  equipment.textContent = [
    `Arma: ${weapon ? ITEM_DEFINITIONS[weapon.definitionId].name : "nessuna"}`,
    `Armatura: ${armor ? ITEM_DEFINITIONS[armor.definitionId].name : "nessuna"}`,
    `ATK ${playerAttackPower()} · DIF ${playerDefensePower()} · ${player.inventory.length}/${INVENTORY_CAPACITY}`,
  ].join("\n");
  equipment.style.whiteSpace = "pre-line";
  inventoryItems.replaceChildren();

  if (player.inventory.length === 0) {
    const empty = document.createElement("div");
    empty.className = "inventory-help";
    empty.textContent = "L'inventario è vuoto.";
    inventoryItems.append(empty);
    return;
  }

  player.inventory.forEach((item, index) => {
    const button = document.createElement("button");
    const definition = ITEM_DEFINITIONS[item.definitionId];
    const equipped = item.instanceId === player.weaponInstanceId || item.instanceId === player.armorInstanceId;
    button.className = "inventory-item";
    button.type = "button";
    button.disabled = activeAction !== null || viewSnap !== null || player.dead || player.won;

    const icon = document.createElement("img");
    icon.className = "inventory-icon";
    icon.src = definition.icon;
    icon.alt = "";
    icon.width = 20;
    icon.height = 20;

    const label = document.createElement("span");
    label.textContent = `${index + 1}. ${itemDescription(item)}${equipped ? " · equipaggiato" : ""}`;
    button.append(icon, label);
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      useInventorySlot(index);
    });
    inventoryItems.append(button);
  });
}

function setInventoryOpen(open: boolean): void {
  inventoryOpen = open;
  inventoryPanel.hidden = !open;
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
  showMessage("SEI MORTO · Premi R per ricominciare", Infinity);
  combatMessages.push("Sei morto nel dungeon.");
  if (combatMessages.length > 4) combatMessages.shift();
  combatLog.replaceChildren(...combatMessages.map((entry) => {
    const line = document.createElement("div");
    line.textContent = entry;
    return line;
  }));
}

function damagePlayer(amount: number, source: string): void {
  const damage = Math.max(1, amount);
  player.health = Math.max(0, player.health - damage);
  addCombatMessage(`${source} ti colpisce: −${damage}`);
  if (player.health <= 0) killPlayer();
}

function attackEnemy(enemy: Enemy): void {
  const damage = Math.max(1, rollDie(playerAttackPower()) - enemy.defense);
  enemy.currentHealth = Math.max(0, enemy.currentHealth - damage);
  enemy.alerted = true;
  addCombatMessage(`Colpisci ${enemy.name}: −${damage} PV`);
  if (enemy.currentHealth > 0) return;

  enemy.alive = false;
  groundItems.push({ ...entityFactory.createItem(enemy.drop), column: enemy.column, row: enemy.row });
  addCombatMessage(`${enemy.name} muore e lascia ${ITEM_DEFINITIONS[enemy.drop].name}.`, 2400);
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
    const distance = Math.abs(enemy.column - player.column) + Math.abs(enemy.row - player.row);
    if (distance === 1) {
      const damage = Math.max(1, rollDie(enemy.attack) - playerDefensePower());
      damagePlayer(damage, enemy.name);
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
      if (!inventoryFullReported) addCombatMessage("Inventario pieno: non puoi raccogliere altro.");
      inventoryFullReported = true;
      continue;
    }
    player.inventory.push({ instanceId: item.instanceId, definitionId: item.definitionId });
    addCombatMessage(`Raccogli ${ITEM_DEFINITIONS[item.definitionId].name}.`);
  }
  groundItems = remaining;
  renderInventoryPanel();
}

function useInventorySlot(index: number): void {
  if (activeAction || viewSnap || lookPointerId !== null || player.dead || player.won) return;
  const item = player.inventory[index];
  if (!item) return;
  const definition = ITEM_DEFINITIONS[item.definitionId];

  if (definition.kind === "consumable") {
    if (player.health >= player.maxHealth) {
      addCombatMessage("Sei già in piena salute.");
      return;
    }
    const healing = Math.min(definition.healing ?? 0, player.maxHealth - player.health);
    player.health += healing;
    player.inventory.splice(index, 1);
    addCombatMessage(`Usi ${definition.name}: +${healing} PV.`);
  } else if (definition.kind === "weapon") {
    if (player.weaponInstanceId === item.instanceId) return;
    player.weaponInstanceId = item.instanceId;
    addCombatMessage(`Equipaggi ${definition.name}.`);
  } else {
    if (player.armorInstanceId === item.instanceId) return;
    player.armorInstanceId = item.instanceId;
    addCombatMessage(`Indossi ${definition.name}.`);
  }

  setInventoryOpen(false);
  finishPlayerTurn();
}

function enqueue(action: QueuedAction): void {
  if (player.dead || player.won || inventoryOpen || actionQueue.length >= 2) return;
  actionQueue.push(action);
}

/** Traduce il prossimo comando accodato in movimento, rotazione o attacco. */
function beginNextAction(now: number): void {
  const action = actionQueue.shift();
  if (!action) return;

  if (action.kind === "wait") {
    addCombatMessage("Aspetti e ascolti il dungeon.");
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
        ? "Il fuoco ti sbarra la strada."
        : obstacle === "C" ? "Una colonna blocca il passaggio." : "La parete non si muove.",
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
      damagePlayer(5, "Gli spuntoni");
    }
  }
  if (player.dead) return;
  pickupGroundItems();
  if (symbol === "G") {
    player.won = true;
    actionQueue.length = 0;
    showMessage("TESORO TROVATO · Hai vinto!", Infinity);
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
  if (!activeAction && lookPointerId === null && !viewSnap) beginNextAction(now);
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
  if (positionLabel) positionLabel.textContent = `${direction} · ${player.column},${player.row} · T${player.turns}`;
  if (healthLabel) {
    healthLabel.textContent = `PV ${player.health}/${player.maxHealth} · ATK ${playerAttackPower()} · DIF ${playerDefensePower()}`;
  }
  if (messageLabel) {
    messageLabel.textContent = statusUntil >= now
      ? statusMessage
      : player.dead ? "SEI MORTO · R per ricominciare"
      : player.won ? "TESORO TROVATO" : "Trova il baule";
    messageLabel.classList.toggle("won", player.won);
  }
}

/** Loop principale: simulazione, renderer disponibile, overlay e nuovo frame. */
function frame(now: number): void {
  renderTimeSeconds = now / 1000;
  updateGame(now);
  updateHud(now);
  playerLight.position = add(camera.position, v(0, 0.14, 0));

  if (resolutionChanging) {
    if (sampleLabel) sampleLabel.textContent = `${samples} spp · cambio risoluzione`;
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
    if (sampleLabel) sampleLabel.textContent = `${samples} spp · GPU`;
  } else if (gpuRenderer && paused) {
    if (sampleLabel) sampleLabel.textContent = `${samples} spp · GPU · pausa`;
  } else if (cameraDirty) {
    cpuRenderer.reset();
    for (let sample = 0; sample < MOTION_SAMPLES; sample += 1) {
      cpuRenderer.renderSample(camera, playerLight, renderTimeSeconds, true);
    }
    samples = cpuRenderer.samples;
    cameraDirty = false;
    cpuRenderer.present();
    if (sampleLabel) sampleLabel.textContent = `${samples} spp`;
  } else if (!paused) {
    cpuRenderer.renderSample(camera, playerLight, renderTimeSeconds);
    samples = cpuRenderer.samples;
    cpuRenderer.present();
    if (sampleLabel) sampleLabel.textContent = `${samples} spp`;
  } else if (sampleLabel) {
    sampleLabel.textContent = `${samples} spp · pausa`;
  }
  drawImpostors({ context: impostorContext, renderSize, camera, enemies, groundItems });
  requestAnimationFrame(frame);
}

function updateResolutionButton(): void {
  if (resolutionButton) resolutionButton.textContent = `${renderSize}×${renderSize}`;
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
  if (resolutionButton) resolutionButton.disabled = true;
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
    console.warn("WebGPU non disponibile, mantengo il renderer CPU.", error);
    return false;
  } finally {
    resolutionChanging = false;
    if (resolutionButton) resolutionButton.disabled = false;
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
  enemies = createEnemies();
  gameplayRandomState = 0x51f15e;
  triggeredTraps.clear();
  combatMessages.length = 0;
  combatLog.replaceChildren();
  actionQueue.length = 0;
  activeAction = null;
  viewSnap = null;
  paused = false;
  setInventoryOpen(false);
  camera.position = cellPosition(startCell.column, startCell.row, EYE_HEIGHT);
  camera.yaw = Math.PI;
  camera.pitch = 0;
  camera.fov = DEFAULT_FOV;
  addCombatMessage("Entri nel dungeon. Ogni passo può essere l'ultimo.", 2200);
  renderInventoryPanel();
  markCameraChanged();
}

function fitCanvas(): void {
  const available = Math.max(64, Math.min(window.innerWidth - 28, window.innerHeight - 150));
  const displaySize = Math.max(1, Math.floor(available / renderSize)) * renderSize;
  canvas.style.width = `${displaySize}px`;
  canvas.style.height = `${displaySize}px`;
  spriteCanvas.style.width = `${displaySize}px`;
  spriteCanvas.style.height = `${displaySize}px`;
}

window.addEventListener("resize", fitCanvas);
resolutionButton?.addEventListener("click", () => void cycleResolution());

viewFrame.addEventListener("pointerdown", (event) => {
  if (inventoryOpen || event.button !== 0 || lookPointerId !== null || activeAction?.kind === "turn") return;
  event.preventDefault();
  lookPointerId = event.pointerId;
  lastLookX = event.clientX;
  lastLookY = event.clientY;
  viewSnap = null;
  viewFrame.classList.add("looking");
  viewFrame.setPointerCapture(event.pointerId);
});

viewFrame.addEventListener("pointermove", (event) => {
  if (event.pointerId !== lookPointerId) return;
  const movementX = event.clientX - lastLookX;
  const movementY = event.clientY - lastLookY;
  lastLookX = event.clientX;
  lastLookY = event.clientY;
  camera.yaw += movementX * LOOK_SENSITIVITY;
  camera.pitch = Math.max(
    -MAX_LOOK_PITCH,
    Math.min(MAX_LOOK_PITCH, camera.pitch - movementY * LOOK_SENSITIVITY),
  );
  markCameraChanged();
});

function finishMouseLook(event: PointerEvent): void {
  if (event.pointerId !== lookPointerId) return;
  lookPointerId = null;
  viewFrame.classList.remove("looking");
  if (viewFrame.hasPointerCapture(event.pointerId)) {
    viewFrame.releasePointerCapture(event.pointerId);
  }
}

viewFrame.addEventListener("pointerup", finishMouseLook);
viewFrame.addEventListener("pointercancel", finishMouseLook);
viewFrame.addEventListener("lostpointercapture", finishMouseLook);
viewFrame.addEventListener("wheel", (event) => {
  event.preventDefault();
  if (inventoryOpen) return;
  viewSnap = null;
  camera.fov = Math.max(
    MIN_FOV,
    Math.min(MAX_FOV, camera.fov + event.deltaY * ZOOM_SENSITIVITY),
  );
  markCameraChanged();
}, { passive: false });

window.addEventListener("keydown", (event) => {
  const handled = [
    "KeyW", "KeyS", "KeyA", "KeyD", "KeyQ", "KeyE",
    "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "KeyR", "KeyI",
    "KeyP", "Space", "Period", "Escape",
    "Digit1", "Digit2", "Digit3", "Digit4", "Digit5", "Digit6", "Digit7", "Digit8",
  ].includes(event.code);
  if (handled) event.preventDefault();
  if (event.repeat) return;

  if (event.code === "KeyR") {
    restart();
    return;
  }

  const digitMatch = /^Digit([1-8])$/.exec(event.code);
  if (inventoryOpen) {
    if (event.code === "KeyI" || event.code === "Escape") setInventoryOpen(false);
    if (digitMatch) useInventorySlot(Number(digitMatch[1]) - 1);
    return;
  }

  if (event.code === "KeyI") {
    setInventoryOpen(true);
    return;
  }

  if (event.code === "KeyW" || event.code === "ArrowUp") enqueue({ kind: "move", relativeDirection: 0 });
  if (event.code === "KeyS" || event.code === "ArrowDown") enqueue({ kind: "move", relativeDirection: 2 });
  if (event.code === "KeyQ") enqueue({ kind: "move", relativeDirection: -1 });
  if (event.code === "KeyE") enqueue({ kind: "move", relativeDirection: 1 });
  if (event.code === "KeyA" || event.code === "ArrowLeft") enqueue({ kind: "turn", amount: -1 });
  if (event.code === "KeyD" || event.code === "ArrowRight") enqueue({ kind: "turn", amount: 1 });
  if (event.code === "Space" || event.code === "Period") enqueue({ kind: "wait" });
  if (event.code === "KeyP") paused = !paused;
});

inventoryPanel.addEventListener("pointerdown", (event) => event.stopPropagation());
fitCanvas();
updateResolutionButton();
updateHud(performance.now());
addCombatMessage("Entri nel dungeon. Ogni passo può essere l'ultimo.", 2200);
renderInventoryPanel();
requestAnimationFrame(frame);
void initializeWebGpu();
