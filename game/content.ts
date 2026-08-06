import ghostImpostorUrl from "../fantasycharacters/FantasyCharacters_ghost.png";
import impImpostorUrl from "../fantasycharacters/FantasyCharacters_imp.png";
import lichImpostorUrl from "../fantasycharacters/FantasyCharacters_lich.png";
import magmaDemonImpostorUrl from "../fantasycharacters/FantasyCharacters_magma_demon.png";
import boneMailIconUrl from "../icons/Armor/Head_Helmet_Dragon.png";
import leatherArmorIconUrl from "../icons/Armor/Chest_Cloth_Torn.png";
import healingPotionIconUrl from "../icons/Potions/Minor_Potion_health.png";
import spiritTonicIconUrl from "../icons/Potions/Major_Potion_mana.png";
import emberBladeIconUrl from "../icons/Weapons/Sword_fire.png";
import ironSwordIconUrl from "../icons/Weapons/Sword.png";
import rustySwordIconUrl from "../icons/Weapons/Sword_Rusty.png";
import { startCell, type Cell } from "./level.ts";

export type ItemId =
  | "rusty_sword"
  | "iron_sword"
  | "ember_blade"
  | "leather_armor"
  | "bone_mail"
  | "healing_potion"
  | "spirit_tonic";

export type ItemDefinition = Readonly<{
  name: string;
  kind: "weapon" | "armor" | "consumable";
  icon: string;
  attack?: number;
  defense?: number;
  healing?: number;
}>;

export type InventoryItem = Readonly<{
  instanceId: number;
  definitionId: ItemId;
}>;

export type GroundItem = InventoryItem & Cell;

export type EnemyTemplate = Readonly<{
  name: string;
  source: string;
  column: number;
  row: number;
  height: number;
  health: number;
  attack: number;
  defense: number;
  sight: number;
  drop: ItemId;
}>;

export type Enemy = Omit<EnemyTemplate, "column" | "row"> & {
  id: number;
  column: number;
  row: number;
  currentHealth: number;
  alerted: boolean;
  alive: boolean;
  image: HTMLImageElement;
};

export type Player = {
  column: number;
  row: number;
  facing: number;
  maxHealth: number;
  health: number;
  baseAttack: number;
  baseDefense: number;
  turns: number;
  dead: boolean;
  won: boolean;
  inventory: InventoryItem[];
  weaponInstanceId: number | null;
  armorInstanceId: number | null;
};

/** Catalogo centrale: statistiche, nomi e rappresentazione grafica degli oggetti. */
export const ITEM_DEFINITIONS: Readonly<Record<ItemId, ItemDefinition>> = {
  rusty_sword: {
    name: "Spada arrugginita", kind: "weapon", icon: rustySwordIconUrl, attack: 2,
  },
  iron_sword: {
    name: "Spada di ferro", kind: "weapon", icon: ironSwordIconUrl, attack: 4,
  },
  ember_blade: {
    name: "Lama di brace", kind: "weapon", icon: emberBladeIconUrl, attack: 6,
  },
  leather_armor: {
    name: "Armatura di cuoio", kind: "armor", icon: leatherArmorIconUrl, defense: 2,
  },
  bone_mail: {
    name: "Corazza d'ossa", kind: "armor", icon: boneMailIconUrl, defense: 4,
  },
  healing_potion: {
    name: "Pozione curativa", kind: "consumable", icon: healingPotionIconUrl, healing: 12,
  },
  spirit_tonic: {
    name: "Tonico spirituale", kind: "consumable", icon: spiritTonicIconUrl, healing: 18,
  },
};

/** Immagini precaricate e condivise dal renderer degli oggetti a terra. */
export const itemIconImages = new Map<ItemId, HTMLImageElement>();
for (const itemId of Object.keys(ITEM_DEFINITIONS) as ItemId[]) {
  const image = new Image();
  image.decoding = "async";
  image.src = ITEM_DEFINITIONS[itemId].icon;
  itemIconImages.set(itemId, image);
}

export const ENEMY_TEMPLATES: readonly EnemyTemplate[] = [
  {
    name: "Imp", source: impImpostorUrl, column: 2, row: 3, height: 1.25,
    health: 8, attack: 4, defense: 0, sight: 6, drop: "healing_potion",
  },
  {
    name: "Fantasma", source: ghostImpostorUrl, column: 13, row: 6, height: 1.5,
    health: 12, attack: 5, defense: 1, sight: 7, drop: "spirit_tonic",
  },
  {
    name: "Demone del magma", source: magmaDemonImpostorUrl, column: 9, row: 5, height: 1.55,
    health: 18, attack: 7, defense: 2, sight: 6, drop: "ember_blade",
  },
  {
    name: "Lich", source: lichImpostorUrl, column: 8, row: 13, height: 1.5,
    health: 24, attack: 8, defense: 3, sight: 8, drop: "bone_mail",
  },
];

/** Crea nemici con immagini e stato mutabile nuovi, adatto anche a un restart. */
export function createEnemies(): Enemy[] {
  return ENEMY_TEMPLATES.map((template, index) => {
    const image = new Image();
    image.decoding = "async";
    image.src = template.source;
    return {
      ...template,
      id: index + 1,
      currentHealth: template.health,
      alerted: false,
      alive: true,
      image,
    };
  });
}

/**
 * Genera entità con identificatori univoci per una singola partita.
 * Chiamare `reset()` prima di ricreare lo stato dopo un riavvio.
 */
export class GameEntityFactory {
  private nextItemInstanceId = 1;

  reset(): void {
    this.nextItemInstanceId = 1;
  }

  createPlayer(): Player {
    const weapon = this.createItem("rusty_sword");
    const armor = this.createItem("leather_armor");
    const potion = this.createItem("healing_potion");
    return {
      column: startCell.column,
      row: startCell.row,
      facing: 2,
      maxHealth: 30,
      health: 30,
      baseAttack: 3,
      baseDefense: 0,
      turns: 0,
      dead: false,
      won: false,
      inventory: [weapon, armor, potion],
      weaponInstanceId: weapon.instanceId,
      armorInstanceId: armor.instanceId,
    };
  }

  createGroundItems(): GroundItem[] {
    return [
      { ...this.createItem("iron_sword"), column: 5, row: 1 },
      { ...this.createItem("healing_potion"), column: 3, row: 9 },
    ];
  }

  createItem(definitionId: ItemId): InventoryItem {
    return { instanceId: this.nextItemInstanceId++, definitionId };
  }
}
