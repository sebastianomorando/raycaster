/** Vettore tridimensionale immutabile condiviso da simulazione e renderer. */
export type Vec3 = Readonly<{ x: number; y: number; z: number }>;

export type MaterialKind = "diffuse" | "metal" | "glass" | "emissive";

/** Materiale fisico usato dal path tracer e dalle mesh del dungeon. */
export type Material = Readonly<{
  kind: MaterialKind;
  color: Vec3;
  roughness?: number;
  ior?: number;
  emission?: number;
}>;

export type Ray = Readonly<{ origin: Vec3; direction: Vec3 }>;

export type Hit = {
  distance: number;
  point: Vec3;
  normal: Vec3;
  frontFace: boolean;
  material: Material;
};

export const v = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });
export const add = (a: Vec3, b: Vec3): Vec3 => v(a.x + b.x, a.y + b.y, a.z + b.z);
export const sub = (a: Vec3, b: Vec3): Vec3 => v(a.x - b.x, a.y - b.y, a.z - b.z);
export const mul = (a: Vec3, scalar: number): Vec3 => v(a.x * scalar, a.y * scalar, a.z * scalar);
export const multiply = (a: Vec3, b: Vec3): Vec3 => v(a.x * b.x, a.y * b.y, a.z * b.z);
export const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const cross = (a: Vec3, b: Vec3): Vec3 =>
  v(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
export const length = (a: Vec3): number => Math.sqrt(dot(a, a));
export const normalize = (a: Vec3): Vec3 => mul(a, 1 / Math.max(length(a), Number.EPSILON));
export const reflect = (direction: Vec3, normal: Vec3): Vec3 =>
  sub(direction, mul(normal, 2 * dot(direction, normal)));
export const lerp = (a: Vec3, b: Vec3, amount: number): Vec3 =>
  add(mul(a, 1 - amount), mul(b, amount));

/** Curva smoothstep per movimenti a griglia e riallineamento della visuale. */
export const ease = (amount: number): number => amount * amount * (3 - 2 * amount);
