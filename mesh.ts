export type MeshVec3 = Readonly<{ x: number; y: number; z: number }>;

export type MeshMaterial = Readonly<{
  kind: "diffuse" | "metal" | "glass" | "emissive";
  color: MeshVec3;
  roughness?: number;
  ior?: number;
  emission?: number;
}>;

export type MeshRay = Readonly<{ origin: MeshVec3; direction: MeshVec3 }>;

export type MeshHit = {
  distance: number;
  point: MeshVec3;
  normal: MeshVec3;
  frontFace: boolean;
  material: MeshMaterial;
};

type Triangle = {
  a: MeshVec3;
  b: MeshVec3;
  c: MeshVec3;
  normalA: MeshVec3;
  normalB: MeshVec3;
  normalC: MeshVec3;
  material: MeshMaterial;
  min: MeshVec3;
  max: MeshVec3;
  centroid: MeshVec3;
};

type BvhNode = {
  min: MeshVec3;
  max: MeshVec3;
  left?: BvhNode;
  right?: BvhNode;
  triangles?: number[];
};

export type TriangleMesh = {
  triangles: Triangle[];
  root: BvhNode;
  vertexCount: number;
};

export type MeshInstance = {
  mesh: TriangleMesh;
  translation: MeshVec3;
  scale: number;
  rotationY: number;
  min: MeshVec3;
  max: MeshVec3;
};

type SceneBvhNode = {
  min: MeshVec3;
  max: MeshVec3;
  left?: SceneBvhNode;
  right?: SceneBvhNode;
  instances?: number[];
};

export type MeshScene = {
  instances: MeshInstance[];
  root: SceneBvhNode;
};

export type PackedGpuScene = {
  triangles: ArrayBuffer;
  materials: ArrayBuffer;
  blasNodes: ArrayBuffer;
  instances: ArrayBuffer;
  tlasNodes: ArrayBuffer;
  triangleCount: number;
  materialCount: number;
  instanceCount: number;
};

type ObjOptions = {
  translation: MeshVec3;
  scale: number;
  rotationY?: number;
  materials: Record<string, MeshMaterial>;
  fallbackMaterial: MeshMaterial;
};

const vec = (x = 0, y = 0, z = 0): MeshVec3 => ({ x, y, z });
const add = (a: MeshVec3, b: MeshVec3): MeshVec3 => vec(a.x + b.x, a.y + b.y, a.z + b.z);
const sub = (a: MeshVec3, b: MeshVec3): MeshVec3 => vec(a.x - b.x, a.y - b.y, a.z - b.z);
const mul = (a: MeshVec3, scalar: number): MeshVec3 => vec(a.x * scalar, a.y * scalar, a.z * scalar);
const dot = (a: MeshVec3, b: MeshVec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: MeshVec3, b: MeshVec3): MeshVec3 =>
  vec(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
const normalize = (a: MeshVec3): MeshVec3 => {
  const inverseLength = 1 / Math.max(Math.sqrt(dot(a, a)), Number.EPSILON);
  return mul(a, inverseLength);
};

function transformPosition(position: MeshVec3, options: ObjOptions): MeshVec3 {
  const angle = options.rotationY ?? 0;
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const rotated = vec(
    position.x * cosine + position.z * sine,
    position.y,
    -position.x * sine + position.z * cosine,
  );
  return add(mul(rotated, options.scale), options.translation);
}

function transformNormal(normal: MeshVec3, rotationY: number): MeshVec3 {
  const cosine = Math.cos(rotationY);
  const sine = Math.sin(rotationY);
  return normalize(vec(
    normal.x * cosine + normal.z * sine,
    normal.y,
    -normal.x * sine + normal.z * cosine,
  ));
}

function objIndex(rawIndex: string | undefined, length: number): number | null {
  if (!rawIndex) return null;
  const parsed = Number.parseInt(rawIndex, 10);
  if (!Number.isFinite(parsed) || parsed === 0) return null;
  return parsed > 0 ? parsed - 1 : length + parsed;
}

function triangleBounds(a: MeshVec3, b: MeshVec3, c: MeshVec3): Pick<Triangle, "min" | "max" | "centroid"> {
  const padding = 1e-6;
  return {
    min: vec(
      Math.min(a.x, b.x, c.x) - padding,
      Math.min(a.y, b.y, c.y) - padding,
      Math.min(a.z, b.z, c.z) - padding,
    ),
    max: vec(
      Math.max(a.x, b.x, c.x) + padding,
      Math.max(a.y, b.y, c.y) + padding,
      Math.max(a.z, b.z, c.z) + padding,
    ),
    centroid: mul(add(add(a, b), c), 1 / 3),
  };
}

function buildBvh(triangles: Triangle[], indices: number[]): BvhNode {
  let min = vec(Infinity, Infinity, Infinity);
  let max = vec(-Infinity, -Infinity, -Infinity);
  let centroidMin = vec(Infinity, Infinity, Infinity);
  let centroidMax = vec(-Infinity, -Infinity, -Infinity);

  for (const index of indices) {
    const triangle = triangles[index];
    if (!triangle) continue;
    min = vec(Math.min(min.x, triangle.min.x), Math.min(min.y, triangle.min.y), Math.min(min.z, triangle.min.z));
    max = vec(Math.max(max.x, triangle.max.x), Math.max(max.y, triangle.max.y), Math.max(max.z, triangle.max.z));
    centroidMin = vec(
      Math.min(centroidMin.x, triangle.centroid.x),
      Math.min(centroidMin.y, triangle.centroid.y),
      Math.min(centroidMin.z, triangle.centroid.z),
    );
    centroidMax = vec(
      Math.max(centroidMax.x, triangle.centroid.x),
      Math.max(centroidMax.y, triangle.centroid.y),
      Math.max(centroidMax.z, triangle.centroid.z),
    );
  }

  if (indices.length <= 8) return { min, max, triangles: indices };

  const extent = sub(centroidMax, centroidMin);
  const axis: "x" | "y" | "z" = extent.x >= extent.y && extent.x >= extent.z
    ? "x"
    : extent.y >= extent.z ? "y" : "z";
  indices.sort((left, right) =>
    (triangles[left]?.centroid[axis] ?? 0) - (triangles[right]?.centroid[axis] ?? 0));
  const middle = Math.floor(indices.length / 2);
  return {
    min,
    max,
    left: buildBvh(triangles, indices.slice(0, middle)),
    right: buildBvh(triangles, indices.slice(middle)),
  };
}

export function createObjMesh(source: string, options: ObjOptions): TriangleMesh {
  const positions: MeshVec3[] = [];
  const normals: MeshVec3[] = [];
  const triangles: Triangle[] = [];
  let material = options.fallbackMaterial;

  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const parts = line.split(/\s+/);
    const command = parts[0];

    if (command === "v") {
      positions.push(transformPosition(
        vec(Number(parts[1]), Number(parts[2]), Number(parts[3])),
        options,
      ));
    } else if (command === "vn") {
      normals.push(transformNormal(
        vec(Number(parts[1]), Number(parts[2]), Number(parts[3])),
        options.rotationY ?? 0,
      ));
    } else if (command === "usemtl") {
      material = options.materials[parts[1] ?? ""] ?? options.fallbackMaterial;
    } else if (command === "f") {
      const face = parts.slice(1).map((token) => {
        const [positionIndex, , normalIndex] = token?.split("/") ?? [];
        return {
          position: objIndex(positionIndex, positions.length),
          normal: objIndex(normalIndex, normals.length),
        };
      });

      for (let corner = 1; corner < face.length - 1; corner += 1) {
        const vertices = [face[0], face[corner], face[corner + 1]];
        if (vertices.some((vertex) => vertex?.position === null || vertex?.position === undefined)) continue;
        const a = positions[vertices[0]?.position ?? -1];
        const b = positions[vertices[1]?.position ?? -1];
        const c = positions[vertices[2]?.position ?? -1];
        if (!a || !b || !c) continue;
        const flatNormal = normalize(cross(sub(b, a), sub(c, a)));
        const normalA = normals[vertices[0]?.normal ?? -1] ?? flatNormal;
        const normalB = normals[vertices[1]?.normal ?? -1] ?? flatNormal;
        const normalC = normals[vertices[2]?.normal ?? -1] ?? flatNormal;
        triangles.push({
          a,
          b,
          c,
          normalA,
          normalB,
          normalC,
          material,
          ...triangleBounds(a, b, c),
        });
      }
    }
  }

  if (triangles.length === 0) throw new Error("The OBJ contains no valid triangles");
  return {
    triangles,
    root: buildBvh(triangles, triangles.map((_, index) => index)),
    vertexCount: positions.length,
  };
}

function hitsBounds(ray: MeshRay, node: BvhNode, minDistance: number, maxDistance: number): boolean {
  for (const axis of ["x", "y", "z"] as const) {
    const direction = ray.direction[axis];
    const origin = ray.origin[axis];
    if (Math.abs(direction) < 1e-9) {
      if (origin < node.min[axis] || origin > node.max[axis]) return false;
      continue;
    }
    const inverse = 1 / direction;
    let near = (node.min[axis] - origin) * inverse;
    let far = (node.max[axis] - origin) * inverse;
    if (inverse < 0) [near, far] = [far, near];
    minDistance = Math.max(minDistance, near);
    maxDistance = Math.min(maxDistance, far);
    if (maxDistance <= minDistance) return false;
  }
  return true;
}

function rotateY(vector: MeshVec3, angle: number): MeshVec3 {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return vec(
    vector.x * cosine + vector.z * sine,
    vector.y,
    -vector.x * sine + vector.z * cosine,
  );
}

export function createMeshInstance(
  mesh: TriangleMesh,
  translation: MeshVec3,
  scale = 1,
  rotationY = 0,
): MeshInstance {
  let min = vec(Infinity, Infinity, Infinity);
  let max = vec(-Infinity, -Infinity, -Infinity);
  for (const x of [mesh.root.min.x, mesh.root.max.x]) {
    for (const y of [mesh.root.min.y, mesh.root.max.y]) {
      for (const z of [mesh.root.min.z, mesh.root.max.z]) {
        const point = add(mul(rotateY(vec(x, y, z), rotationY), scale), translation);
        min = vec(Math.min(min.x, point.x), Math.min(min.y, point.y), Math.min(min.z, point.z));
        max = vec(Math.max(max.x, point.x), Math.max(max.y, point.y), Math.max(max.z, point.z));
      }
    }
  }
  return { mesh, translation, scale, rotationY, min, max };
}

function hitMeshInstance(
  ray: MeshRay,
  instance: MeshInstance,
  minDistance: number,
  maxDistance: number,
): MeshHit | null {
  if (!hitsBounds(ray, instance, minDistance, maxDistance)) return null;
  const inverseScale = 1 / instance.scale;
  const localRay: MeshRay = {
    origin: mul(rotateY(sub(ray.origin, instance.translation), -instance.rotationY), inverseScale),
    direction: mul(rotateY(ray.direction, -instance.rotationY), inverseScale),
  };
  const localHit = hitMesh(localRay, instance.mesh, minDistance, maxDistance);
  if (!localHit) return null;
  return {
    ...localHit,
    point: add(ray.origin, mul(ray.direction, localHit.distance)),
    normal: normalize(rotateY(localHit.normal, instance.rotationY)),
  };
}

function buildSceneBvh(instances: MeshInstance[], indices: number[]): SceneBvhNode {
  let min = vec(Infinity, Infinity, Infinity);
  let max = vec(-Infinity, -Infinity, -Infinity);
  let centroidMin = vec(Infinity, Infinity, Infinity);
  let centroidMax = vec(-Infinity, -Infinity, -Infinity);

  for (const index of indices) {
    const instance = instances[index];
    if (!instance) continue;
    min = vec(Math.min(min.x, instance.min.x), Math.min(min.y, instance.min.y), Math.min(min.z, instance.min.z));
    max = vec(Math.max(max.x, instance.max.x), Math.max(max.y, instance.max.y), Math.max(max.z, instance.max.z));
    const centroid = mul(add(instance.min, instance.max), 0.5);
    centroidMin = vec(
      Math.min(centroidMin.x, centroid.x),
      Math.min(centroidMin.y, centroid.y),
      Math.min(centroidMin.z, centroid.z),
    );
    centroidMax = vec(
      Math.max(centroidMax.x, centroid.x),
      Math.max(centroidMax.y, centroid.y),
      Math.max(centroidMax.z, centroid.z),
    );
  }

  if (indices.length <= 4) return { min, max, instances: indices };
  const extent = sub(centroidMax, centroidMin);
  const axis: "x" | "y" | "z" = extent.x >= extent.y && extent.x >= extent.z
    ? "x"
    : extent.y >= extent.z ? "y" : "z";
  indices.sort((left, right) => {
    const leftInstance = instances[left];
    const rightInstance = instances[right];
    const leftCenter = leftInstance ? (leftInstance.min[axis] + leftInstance.max[axis]) * 0.5 : 0;
    const rightCenter = rightInstance ? (rightInstance.min[axis] + rightInstance.max[axis]) * 0.5 : 0;
    return leftCenter - rightCenter;
  });
  const middle = Math.floor(indices.length / 2);
  return {
    min,
    max,
    left: buildSceneBvh(instances, indices.slice(0, middle)),
    right: buildSceneBvh(instances, indices.slice(middle)),
  };
}

export function createMeshScene(instances: MeshInstance[]): MeshScene {
  if (instances.length === 0) throw new Error("The mesh scene contains no instances");
  return {
    instances,
    root: buildSceneBvh(instances, instances.map((_, index) => index)),
  };
}

export function hitMeshScene(
  ray: MeshRay,
  scene: MeshScene,
  minDistance: number,
  maxDistance: number,
): MeshHit | null {
  let closest = maxDistance;
  let closestHit: MeshHit | null = null;
  const stack: SceneBvhNode[] = [scene.root];

  while (stack.length > 0) {
    const node = stack.pop();
    if (!node || !hitsBounds(ray, node, minDistance, closest)) continue;
    if (node.instances) {
      for (const index of node.instances) {
        const instance = scene.instances[index];
        if (!instance) continue;
        const hit = hitMeshInstance(ray, instance, minDistance, closest);
        if (hit) {
          closest = hit.distance;
          closestHit = hit;
        }
      }
    } else {
      if (node.left) stack.push(node.left);
      if (node.right) stack.push(node.right);
    }
  }

  return closestHit;
}

type PackedNode = {
  min: MeshVec3;
  max: MeshVec3;
  leaf: boolean;
  first: number;
  countOrRight: number;
};

const materialKinds: Record<MeshMaterial["kind"], number> = {
  diffuse: 0,
  metal: 1,
  glass: 2,
  emissive: 3,
};

export function packMeshScene(scene: MeshScene): PackedGpuScene {
  const packedTriangles: Triangle[] = [];
  const packedMaterials: MeshMaterial[] = [];
  const materialIndices = new Map<MeshMaterial, number>();
  const blasNodes: PackedNode[] = [];
  const meshRoots = new Map<TriangleMesh, number>();

  const materialIndex = (material: MeshMaterial): number => {
    const existing = materialIndices.get(material);
    if (existing !== undefined) return existing;
    const index = packedMaterials.length;
    packedMaterials.push(material);
    materialIndices.set(material, index);
    return index;
  };

  const packBlasNode = (node: BvhNode, mesh: TriangleMesh): number => {
    const nodeIndex = blasNodes.length;
    blasNodes.push({ min: node.min, max: node.max, leaf: false, first: 0, countOrRight: 0 });
    if (node.triangles) {
      const first = packedTriangles.length;
      for (const index of node.triangles) {
        const triangle = mesh.triangles[index];
        if (triangle) {
          materialIndex(triangle.material);
          packedTriangles.push(triangle);
        }
      }
      blasNodes[nodeIndex] = {
        min: node.min,
        max: node.max,
        leaf: true,
        first,
        countOrRight: packedTriangles.length - first,
      };
    } else {
      const left = node.left ? packBlasNode(node.left, mesh) : 0;
      const right = node.right ? packBlasNode(node.right, mesh) : 0;
      blasNodes[nodeIndex] = {
        min: node.min,
        max: node.max,
        leaf: false,
        first: left,
        countOrRight: right,
      };
    }
    return nodeIndex;
  };

  for (const instance of scene.instances) {
    if (!meshRoots.has(instance.mesh)) meshRoots.set(instance.mesh, packBlasNode(instance.mesh.root, instance.mesh));
  }

  const orderedInstances: MeshInstance[] = [];
  const tlasNodes: PackedNode[] = [];
  const packTlasNode = (node: SceneBvhNode): number => {
    const nodeIndex = tlasNodes.length;
    tlasNodes.push({ min: node.min, max: node.max, leaf: false, first: 0, countOrRight: 0 });
    if (node.instances) {
      const first = orderedInstances.length;
      for (const index of node.instances) {
        const instance = scene.instances[index];
        if (instance) orderedInstances.push(instance);
      }
      tlasNodes[nodeIndex] = {
        min: node.min,
        max: node.max,
        leaf: true,
        first,
        countOrRight: orderedInstances.length - first,
      };
    } else {
      const left = node.left ? packTlasNode(node.left) : 0;
      const right = node.right ? packTlasNode(node.right) : 0;
      tlasNodes[nodeIndex] = {
        min: node.min,
        max: node.max,
        leaf: false,
        first: left,
        countOrRight: right,
      };
    }
    return nodeIndex;
  };
  packTlasNode(scene.root);

  const triangleBuffer = new ArrayBuffer(packedTriangles.length * 112);
  const triangleView = new DataView(triangleBuffer);
  packedTriangles.forEach((triangle, index) => {
    const offset = index * 112;
    const vectors = [triangle.a, triangle.b, triangle.c, triangle.normalA, triangle.normalB, triangle.normalC];
    vectors.forEach((vector, vectorIndex) => {
      const base = offset + vectorIndex * 16;
      triangleView.setFloat32(base, vector.x, true);
      triangleView.setFloat32(base + 4, vector.y, true);
      triangleView.setFloat32(base + 8, vector.z, true);
      triangleView.setFloat32(base + 12, 0, true);
    });
    triangleView.setUint32(offset + 96, materialIndex(triangle.material), true);
  });

  const materialBuffer = new ArrayBuffer(packedMaterials.length * 32);
  const materialView = new DataView(materialBuffer);
  packedMaterials.forEach((material, index) => {
    const offset = index * 32;
    materialView.setFloat32(offset, material.color.x, true);
    materialView.setFloat32(offset + 4, material.color.y, true);
    materialView.setFloat32(offset + 8, material.color.z, true);
    materialView.setFloat32(offset + 12, materialKinds[material.kind], true);
    materialView.setFloat32(offset + 16, material.roughness ?? 0, true);
    materialView.setFloat32(offset + 20, material.ior ?? 1.5, true);
    materialView.setFloat32(offset + 24, material.emission ?? 0, true);
  });

  const packNodes = (nodes: PackedNode[]): ArrayBuffer => {
    const buffer = new ArrayBuffer(nodes.length * 48);
    const view = new DataView(buffer);
    nodes.forEach((node, index) => {
      const offset = index * 48;
      view.setFloat32(offset, node.min.x, true);
      view.setFloat32(offset + 4, node.min.y, true);
      view.setFloat32(offset + 8, node.min.z, true);
      view.setFloat32(offset + 12, node.leaf ? 1 : 0, true);
      view.setFloat32(offset + 16, node.max.x, true);
      view.setFloat32(offset + 20, node.max.y, true);
      view.setFloat32(offset + 24, node.max.z, true);
      view.setFloat32(offset + 28, 0, true);
      view.setUint32(offset + 32, node.first, true);
      view.setUint32(offset + 36, node.countOrRight, true);
    });
    return buffer;
  };

  const instanceBuffer = new ArrayBuffer(orderedInstances.length * 32);
  const instanceView = new DataView(instanceBuffer);
  orderedInstances.forEach((instance, index) => {
    const offset = index * 32;
    instanceView.setFloat32(offset, instance.translation.x, true);
    instanceView.setFloat32(offset + 4, instance.translation.y, true);
    instanceView.setFloat32(offset + 8, instance.translation.z, true);
    instanceView.setFloat32(offset + 12, instance.scale, true);
    instanceView.setFloat32(offset + 16, Math.cos(instance.rotationY), true);
    instanceView.setFloat32(offset + 20, Math.sin(instance.rotationY), true);
    instanceView.setUint32(offset + 24, meshRoots.get(instance.mesh) ?? 0, true);
  });

  return {
    triangles: triangleBuffer,
    materials: materialBuffer,
    blasNodes: packNodes(blasNodes),
    instances: instanceBuffer,
    tlasNodes: packNodes(tlasNodes),
    triangleCount: packedTriangles.length,
    materialCount: packedMaterials.length,
    instanceCount: orderedInstances.length,
  };
}

function hitTriangle(
  ray: MeshRay,
  triangle: Triangle,
  minDistance: number,
  maxDistance: number,
): MeshHit | null {
  const edgeAB = sub(triangle.b, triangle.a);
  const edgeAC = sub(triangle.c, triangle.a);
  const perpendicular = cross(ray.direction, edgeAC);
  const determinant = dot(edgeAB, perpendicular);
  if (Math.abs(determinant) < 1e-9) return null;
  const inverseDeterminant = 1 / determinant;
  const fromA = sub(ray.origin, triangle.a);
  const u = dot(fromA, perpendicular) * inverseDeterminant;
  if (u < 0 || u > 1) return null;
  const crossed = cross(fromA, edgeAB);
  const w = dot(ray.direction, crossed) * inverseDeterminant;
  if (w < 0 || u + w > 1) return null;
  const distance = dot(edgeAC, crossed) * inverseDeterminant;
  if (distance <= minDistance || distance >= maxDistance) return null;

  const normal = normalize(add(
    add(mul(triangle.normalA, 1 - u - w), mul(triangle.normalB, u)),
    mul(triangle.normalC, w),
  ));
  const frontFace = dot(ray.direction, normal) < 0;
  return {
    distance,
    point: add(ray.origin, mul(ray.direction, distance)),
    normal: frontFace ? normal : mul(normal, -1),
    frontFace,
    material: triangle.material,
  };
}

export function hitMesh(
  ray: MeshRay,
  mesh: TriangleMesh,
  minDistance: number,
  maxDistance: number,
): MeshHit | null {
  let closest = maxDistance;
  let closestHit: MeshHit | null = null;
  const stack: BvhNode[] = [mesh.root];

  while (stack.length > 0) {
    const node = stack.pop();
    if (!node || !hitsBounds(ray, node, minDistance, closest)) continue;
    if (node.triangles) {
      for (const index of node.triangles) {
        const triangle = mesh.triangles[index];
        if (!triangle) continue;
        const hit = hitTriangle(ray, triangle, minDistance, closest);
        if (hit) {
          closest = hit.distance;
          closestHit = hit;
        }
      }
    } else {
      if (node.left) stack.push(node.left);
      if (node.right) stack.push(node.right);
    }
  }

  return closestHit;
}
