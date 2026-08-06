import { ITEM_DEFINITIONS, type InventoryItem, type Player } from "./content.ts";

const INVENTORY_CAPACITY = 8;
const MAX_COMBAT_MESSAGES = 4;

export type InventoryView = Readonly<{
  player: Player;
  attack: number;
  defense: number;
  disabled: boolean;
  onUse(index: number): void;
}>;

export type HudView = Readonly<{
  player: Player;
  direction: string;
  attack: number;
  defense: number;
}>;

function requiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`UI element ${selector} was not found`);
  return element;
}

function itemStats(item: InventoryItem): string {
  const definition = ITEM_DEFINITIONS[item.definitionId];
  if (definition.kind === "weapon") return `WEAPON · ATK +${definition.attack ?? 0}`;
  if (definition.kind === "armor") return `ARMOR · DEF +${definition.defense ?? 0}`;
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

  private readonly sampleLabel = requiredElement<HTMLElement>("#samples");
  private readonly messageLabel = requiredElement<HTMLElement>("#message");
  private readonly positionLabel = requiredElement<HTMLElement>("#position");
  private readonly healthLabel = requiredElement<HTMLElement>("#health");
  private readonly combatLog = requiredElement<HTMLElement>("#combat-log");
  private readonly inventoryItems = requiredElement<HTMLElement>("#inventory-items");
  private readonly inventoryStats = requiredElement<HTMLElement>("#inventory-stats");
  private readonly inventoryCapacity = requiredElement<HTMLElement>("#inventory-capacity");
  private readonly tooltip = requiredElement<HTMLElement>("#inventory-tooltip");
  private readonly tooltipName = requiredElement<HTMLElement>("#inventory-tooltip-name");
  private readonly tooltipStats = requiredElement<HTMLElement>("#inventory-tooltip-stats");
  private readonly tooltipDescription = requiredElement<HTMLElement>("#inventory-tooltip-description");

  private readonly combatMessages: string[] = [];
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

  renderHud(now: number, { player, direction, attack, defense }: HudView): void {
    this.positionLabel.textContent = `${direction} · ${player.column},${player.row} · T${player.turns}`;
    this.healthLabel.textContent = `HP ${player.health}/${player.maxHealth} · ATK ${attack} · DEF ${defense}`;
    this.messageLabel.textContent = this.statusUntil >= now
      ? this.statusMessage
      : player.dead ? "YOU DIED · PRESS R TO RESTART"
      : player.won ? "TREASURE FOUND" : "Find the treasure";
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

  setInventoryOpen(open: boolean): void {
    this.inventoryPanel.hidden = !open;
    if (!open) this.hideTooltip();
  }

  /** Ricostruisce la griglia di sole icone e collega hover, focus e click. */
  renderInventory({ player, attack, defense, disabled, onUse }: InventoryView): void {
    this.inventoryStats.textContent = `HP ${player.health}/${player.maxHealth} · ATK ${attack} · DEF ${defense}`;
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
