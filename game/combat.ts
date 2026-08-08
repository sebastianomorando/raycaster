export type DamageRoll = Readonly<{
  bonus: number;
  dice: number;
  sides: number;
}>;

export type AttackRoll = Readonly<{
  naturalRoll: number;
  total: number;
  hit: boolean;
  critical: boolean;
  damage: number;
}>;

function die(random: () => number, sides: number): number {
  return 1 + Math.floor(random() * Math.max(1, sides));
}

/** Formatta la notazione mostrata al giocatore, per esempio `2 + 1d4`. */
export function formatDamageRoll(roll: DamageRoll): string {
  const dice = `${roll.dice}d${roll.sides}`;
  return roll.bonus > 0 ? `${roll.bonus} + ${dice}` : dice;
}

/**
 * Risolve un attacco in stile D&D: d20 + bonus contro AC, 1 naturale manca e
 * 20 naturale colpisce sempre raddoppiando il numero di dadi danno.
 */
export function resolveAttack(
  random: () => number,
  attackBonus: number,
  armorClass: number,
  damageRoll: DamageRoll,
): AttackRoll {
  const naturalRoll = die(random, 20);
  const total = naturalRoll + attackBonus;
  const critical = naturalRoll === 20;
  const hit = critical || (naturalRoll !== 1 && total >= armorClass);
  if (!hit) return { naturalRoll, total, hit: false, critical: false, damage: 0 };

  let damage = damageRoll.bonus;
  const dice = damageRoll.dice * (critical ? 2 : 1);
  for (let index = 0; index < dice; index += 1) damage += die(random, damageRoll.sides);
  return { naturalRoll, total, hit: true, critical, damage };
}
