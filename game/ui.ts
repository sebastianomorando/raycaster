import { ITEM_DEFINITIONS, type InventoryItem, type Player } from "./content.ts";
import { formatDamageRoll } from "./combat.ts";
import type { InteractionKind } from "./interactions.ts";

const INVENTORY_CAPACITY = 8;
const MAX_COMBAT_MESSAGES = 4;

export type InventoryView = Readonly<{
  player: Player;
  attackBonus: number;
  armorClass: number;
  torches: number;
  disabled: boolean;
  onUse(index: number): void;
}>;

export type HudView = Readonly<{
  player: Player;
  direction: string;
  attackBonus: number;
  armorClass: number;
  torches: number;
  objective: string;
}>;

function requiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`UI element ${selector} was not found`);
  return element;
}

function itemStats(item: InventoryItem): string {
  const definition = ITEM_DEFINITIONS[item.definitionId];
  if (definition.kind === "weapon") {
    const damage = definition.damage ? formatDamageRoll(definition.damage) : "1d2";
    return `WEAPON · DMG ${damage} · HIT +${definition.attackBonus ?? 0}`;
  }
  if (definition.kind === "armor") return `ARMOR · AC +${definition.armorClassBonus ?? 0}`;
  return `CONSUMABLE · HEALS ${definition.healing ?? 0} HP`;
}

/**
 * Facciata DOM della UI di gioco.
 *
 * Mantiene query, messaggi temporanei e rendering dell'inventario fuori dal loop
 * principale. La scena resta su canvas: testo e controlli restano DOM per avere
 * tooltip, focus e semantica accessibile senza replicarli a mano.
 */
export class GameUi {
  readonly canvas = requiredElement<HTMLCanvasElement>("#app");
  readonly spriteCanvas = requiredElement<HTMLCanvasElement>("#impostors");
  readonly frame = requiredElement<HTMLElement>(".frame");
  readonly resolutionButton = requiredElement<HTMLButtonElement>("#resolution");
  readonly inventoryPanel = requiredElement<HTMLElement>("#inventory");

  private readonly titlebar = requiredElement<HTMLElement>(".titlebar");
  private readonly statusbar = requiredElement<HTMLElement>(".statusbar");
  private readonly sampleLabel = requiredElement<HTMLElement>("#samples");
  private readonly messageLabel = requiredElement<HTMLElement>("#message");
  private readonly positionLabel = requiredElement<HTMLElement>("#position");
  private readonly healthLabel = requiredElement<HTMLElement>("#health");
  private readonly combatLog = requiredElement<HTMLElement>("#combat-log");
  private readonly interactionHint = requiredElement<HTMLElement>("#interaction-hint");
  private readonly inventoryItems = requiredElement<HTMLElement>("#inventory-items");
  private readonly inventoryStats = requiredElement<HTMLElement>("#inventory-stats");
  private readonly inventoryCapacity = requiredElement<HTMLElement>("#inventory-capacity");
  private readonly tooltip = requiredElement<HTMLElement>("#inventory-tooltip");
  private readonly tooltipName = requiredElement<HTMLElement>("#inventory-tooltip-name");
  private readonly tooltipStats = requiredElement<HTMLElement>("#inventory-tooltip-stats");
  private readonly tooltipDescription = requiredElement<HTMLElement>("#inventory-tooltip-description");

  private readonly combatMessages: string[] = [];
  private interactionKey = "";
  private statusMessage = "Find the treasure beyond the maze";
  private statusUntil = 0;

  showMessage(message: string, duration = 1400): void {
    this.statusMessage = message;
    this.statusUntil = performance.now() + duration;
  }

  addCombatMessage(message: string): void {
    this.combatMessages.push(message);
    if (this.combatMessages.length > MAX_COMBAT_MESSAGES) this.combatMessages.shift();
    this.combatLog.replaceChildren(...this.combatMessages.map((entry) => {
      const line = document.createElement("div");
      line.textContent = entry;
      return line;
    }));
  }

  clearCombatLog(): void {
    this.combatMessages.length = 0;
    this.combatLog.replaceChildren();
  }

  /** Crea un numero temporaneo ancorato alla proiezione del bersaglio. */
  showCombatPopup(text: string, xRatio: number, yRatio: number, kind: "damage" | "miss"): void {
    const popup = document.createElement("div");
    popup.className = `combat-popup ${kind}`;
    popup.textContent = text;
    popup.style.left = `${Math.max(0.04, Math.min(0.96, xRatio)) * 100}%`;
    popup.style.top = `${Math.max(0.08, Math.min(0.9, yRatio)) * 100}%`;
    this.frame.append(popup);
    popup.addEventListener("animationend", () => popup.remove(), { once: true });
  }

  renderHud(
    now: number,
    { player, direction, attackBonus, armorClass, torches, objective }: HudView,
  ): void {
    this.positionLabel.textContent = `${direction} · ${player.column},${player.row} · T${player.turns}`;
    this.healthLabel.textContent =
      `HP ${player.health}/${player.maxHealth} · HIT +${attackBonus} · AC ${armorClass} · TORCH ${torches}`;
    this.messageLabel.textContent = this.statusUntil >= now
      ? this.statusMessage
      : player.dead ? "YOU DIED · PRESS R TO RESTART"
      : objective;
    this.messageLabel.classList.toggle("won", player.won);
  }

  setSamples(label: string): void {
    this.sampleLabel.textContent = label;
  }

  setResolution(resolution: number): void {
    this.resolutionButton.textContent = `${resolution}×${resolution}`;
  }

  setResolutionBusy(busy: boolean): void {
    this.resolutionButton.disabled = busy;
  }

  /** Aggiorna cursore contestuale e piccola etichetta accanto al puntatore. */
  setInteraction(
    kind: InteractionKind | null,
    label = "",
    clientX = 0,
    clientY = 0,
  ): void {
    if (!kind) {
      if (!this.interactionKey) return;
      this.interactionKey = "";
      delete this.frame.dataset.interaction;
      this.interactionHint.hidden = true;
      return;
    }
    const bounds = this.frame.getBoundingClientRect();
    const localX = clientX - bounds.left;
    const localY = clientY - bounds.top;
    const nextKey = `${kind}:${label}:${Math.round(localX)}:${Math.round(localY)}`;
    if (nextKey === this.interactionKey) return;
    this.interactionKey = nextKey;
    this.frame.dataset.interaction = kind;
    this.interactionHint.textContent = label;
    this.interactionHint.style.left = `${localX}px`;
    this.interactionHint.style.top = `${localY}px`;
    this.interactionHint.classList.toggle("flip-x", localX > bounds.width * 0.62);
    this.interactionHint.classList.toggle("flip-y", localY > bounds.height * 0.78);
    this.interactionHint.hidden = false;
  }

  /**
   * Calcola il lato visualizzato più grande che entra nella finestra e resta un
   * multiplo della risoluzione interna, così ogni texel conserva pixel interi.
   */
  frameDisplaySize(renderSize: number): number {
    const main = this.frame.parentElement;
    const mainStyle = main ? getComputedStyle(main) : null;
    const rowGap = Number.parseFloat(mainStyle?.rowGap ?? "0") || 0;
    const shortSide = Math.min(window.innerWidth, window.innerHeight);
    const viewportMargin = Math.max(12, shortSide * 0.025);
    const availableWidth = window.innerWidth - viewportMargin * 2;
    const availableHeight = window.innerHeight
      - this.titlebar.offsetHeight
      - this.statusbar.offsetHeight
      - rowGap * 2
      - viewportMargin * 2;
    const available = Math.max(renderSize, Math.min(availableWidth, availableHeight));
    return Math.max(1, Math.floor(available / renderSize)) * renderSize;
  }

  setInventoryOpen(open: boolean): void {
    this.inventoryPanel.hidden = !open;
    if (!open) this.hideTooltip();
  }

  /** Ricostruisce la griglia di sole icone e collega hover, focus e click. */
  renderInventory({ player, attackBonus, armorClass, torches, disabled, onUse }: InventoryView): void {
    this.inventoryStats.textContent =
      `HP ${player.health}/${player.maxHealth} · HIT +${attackBonus} · AC ${armorClass} · TORCH ${torches}`;
    this.inventoryCapacity.textContent = `${player.inventory.length}/${INVENTORY_CAPACITY}`;
    this.inventoryItems.replaceChildren();
    this.hideTooltip();

    if (player.inventory.length === 0) {
      const empty = document.createElement("div");
      empty.className = "inventory-empty";
      empty.textContent = "EMPTY";
      this.inventoryItems.append(empty);
      return;
    }

    player.inventory.forEach((item, index) => {
      const definition = ITEM_DEFINITIONS[item.definitionId];
      const equipped = item.instanceId === player.weaponInstanceId ||
        item.instanceId === player.armorInstanceId;
      const button = document.createElement("button");
      button.className = `inventory-item${equipped ? " is-equipped" : ""}`;
      button.type = "button";
      button.disabled = disabled;
      button.setAttribute("aria-label", `${index + 1}. ${definition.name}. ${itemStats(item)}`);
      button.setAttribute("aria-describedby", "inventory-tooltip");

      const icon = document.createElement("img");
      icon.className = "inventory-icon";
      icon.src = definition.icon;
      icon.alt = "";
      icon.width = 44;
      icon.height = 44;

      const slot = document.createElement("span");
      slot.className = "inventory-slot";
      slot.textContent = String(index + 1);
      button.append(icon, slot);
      button.addEventListener("pointerenter", () => this.showTooltip(item, equipped));
      button.addEventListener("pointerleave", () => this.hideTooltip());
      button.addEventListener("focus", () => this.showTooltip(item, equipped));
      button.addEventListener("blur", () => this.hideTooltip());
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        onUse(index);
      });
      this.inventoryItems.append(button);
    });
  }

  private showTooltip(item: InventoryItem, equipped: boolean): void {
    const definition = ITEM_DEFINITIONS[item.definitionId];
    this.tooltipName.textContent = definition.name;
    this.tooltipStats.textContent = `${itemStats(item)}${equipped ? " · EQUIPPED" : ""}`;
    this.tooltipDescription.textContent = definition.description;
    this.tooltip.hidden = false;
  }

  private hideTooltip(): void {
    this.tooltip.hidden = true;
  }
}
