import { add, cross, dot, mul, normalize, sub, v, type Ray, type Vec3 } from "./math.ts";

export type Camera = {
  position: Vec3;
  yaw: number;
  pitch: number;
  fov: number;
  aperture: number;
  focusDistance: number;
};

export type CameraBasis = Readonly<{ forward: Vec3; right: Vec3; up: Vec3 }>;

/** Calcola il sistema ortonormale della camera a partire da yaw e pitch. */
export function cameraBasis(camera: Camera): CameraBasis {
  const pitchCosine = Math.cos(camera.pitch);
  const forward = normalize(v(
    Math.sin(camera.yaw) * pitchCosine,
    Math.sin(camera.pitch),
    -Math.cos(camera.yaw) * pitchCosine,
  ));
  const right = normalize(cross(forward, v(0, 1, 0)));
  return { forward, right, up: normalize(cross(right, forward)) };
}

/** Proietta un punto mondo sul canvas quadrato a risoluzione interna. */
export function projectPoint(
  point: Vec3,
  camera: Camera,
  basis: CameraBasis,
  renderSize: number,
): { x: number; y: number; depth: number } | null {
  const relative = sub(point, camera.position);
  const depth = dot(relative, basis.forward);
  if (depth <= 0.03) return null;
  const scale = Math.tan(camera.fov * 0.5);
  return {
    x: (0.5 + dot(relative, basis.right) / (depth * scale * 2)) * renderSize,
    y: (0.5 - dot(relative, basis.up) / (depth * scale * 2)) * renderSize,
    depth,
  };
}

/**
 * Genera un raggio primario. Con `stablePrimary` usa il centro del pixel e
 * disattiva la profondità di campo, utile durante il movimento e per l'occlusione.
 */
export function cameraRay(
  x: number,
  y: number,
  camera: Camera,
  basis: CameraBasis,
  renderSize: number,
  random: () => number,
  stablePrimary = false,
): Ray {
  const sampleX = stablePrimary ? 0.5 : random();
  const sampleY = stablePrimary ? 0.5 : random();
  const scale = Math.tan(camera.fov * 0.5);
  const screenX = (2 * ((x + sampleX) / renderSize) - 1) * scale;
  const screenY = (1 - 2 * ((y + sampleY) / renderSize)) * scale;
  const pinholeDirection = normalize(add(
    add(basis.forward, mul(basis.right, screenX)),
    mul(basis.up, screenY),
  ));
  if (stablePrimary) return { origin: camera.position, direction: pinholeDirection };

  const lensAngle = random() * Math.PI * 2;
  const lensRadius = Math.sqrt(random()) * camera.aperture;
  const lensOffset = add(
    mul(basis.right, Math.cos(lensAngle) * lensRadius),
    mul(basis.up, Math.sin(lensAngle) * lensRadius),
  );
  const focusPoint = add(camera.position, mul(pinholeDirection, camera.focusDistance));
  const origin = add(camera.position, lensOffset);
  return { origin, direction: normalize(sub(focusPoint, origin)) };
}
