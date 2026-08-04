import type { PackedGpuScene } from "./mesh.ts";

export type GpuVec3 = Readonly<{ x: number; y: number; z: number }>;

export type GpuLightInput = Readonly<{
  position: GpuVec3;
  color: GpuVec3;
  intensity: number;
  radius: number;
  phase: number;
  flicker: number;
}>;

export type GpuFrame = Readonly<{
  position: GpuVec3;
  forward: GpuVec3;
  right: GpuVec3;
  up: GpuVec3;
  playerLightPosition: GpuVec3;
  playerLightColor: GpuVec3;
  playerLightIntensity: number;
  fov: number;
  time: number;
  reset: boolean;
  moving: boolean;
}>;

export type WebGpuRenderer = {
  render(frame: GpuFrame): number;
  destroy(): void;
};

const WIDTH = 64;
const HEIGHT = 64;

const computeShader = /* wgsl */ `
struct Uniforms {
  cameraPosition: vec4f,
  cameraForward: vec4f,
  cameraRight: vec4f,
  cameraUp: vec4f,
  playerLightPosition: vec4f,
  playerLightColorIntensity: vec4f,
  frameInfo: vec4u,
  renderInfo: vec4f,
}

struct Triangle {
  a: vec4f,
  b: vec4f,
  c: vec4f,
  normalA: vec4f,
  normalB: vec4f,
  normalC: vec4f,
  material: vec4u,
}

struct Material {
  colorKind: vec4f,
  params: vec4f,
}

struct BvhNode {
  minLeaf: vec4f,
  maxPad: vec4f,
  data: vec4u,
}

struct Instance {
  translationScale: vec4f,
  rotation: vec2f,
  root: u32,
  pad: u32,
}

struct Light {
  positionIntensity: vec4f,
  colorRadius: vec4f,
  params: vec4f,
}

struct Hit {
  distance: f32,
  normal: vec3f,
  material: u32,
  frontFace: u32,
  found: u32,
}

struct TriangleHit {
  distance: f32,
  u: f32,
  v: f32,
  found: u32,
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var<storage, read> triangles: array<Triangle>;
@group(0) @binding(2) var<storage, read> materials: array<Material>;
@group(0) @binding(3) var<storage, read> blasNodes: array<BvhNode>;
@group(0) @binding(4) var<storage, read> instances: array<Instance>;
@group(0) @binding(5) var<storage, read> tlasNodes: array<BvhNode>;
@group(0) @binding(6) var<storage, read> lights: array<Light>;
@group(0) @binding(7) var<storage, read_write> accumulation: array<vec4f>;

const EPSILON = 0.001;
const PI = 3.14159265359;

fn random(state: ptr<function, u32>) -> f32 {
  var value = *state;
  value = value ^ (value << 13u);
  value = value ^ (value >> 17u);
  value = value ^ (value << 5u);
  *state = value;
  return f32(value) / 4294967296.0;
}

fn randomUnitVector(state: ptr<function, u32>) -> vec3f {
  let z = random(state) * 2.0 - 1.0;
  let angle = random(state) * PI * 2.0;
  let radius = sqrt(max(0.0, 1.0 - z * z));
  return vec3f(radius * cos(angle), radius * sin(angle), z);
}

fn cosineHemisphere(normal: vec3f, state: ptr<function, u32>) -> vec3f {
  var helper = vec3f(1.0, 0.0, 0.0);
  if (abs(normal.x) > 0.9) { helper = vec3f(0.0, 1.0, 0.0); }
  let tangent = normalize(cross(helper, normal));
  let bitangent = cross(normal, tangent);
  let angle = random(state) * PI * 2.0;
  let radius = sqrt(random(state));
  let local = vec3f(radius * cos(angle), sqrt(max(0.0, 1.0 - radius * radius)), radius * sin(angle));
  return normalize(tangent * local.x + normal * local.y + bitangent * local.z);
}

fn rotateToLocal(value: vec3f, cosine: f32, sine: f32) -> vec3f {
  return vec3f(value.x * cosine - value.z * sine, value.y, value.x * sine + value.z * cosine);
}

fn rotateToWorld(value: vec3f, cosine: f32, sine: f32) -> vec3f {
  return vec3f(value.x * cosine + value.z * sine, value.y, -value.x * sine + value.z * cosine);
}

fn hitsBounds(origin: vec3f, direction: vec3f, minimum: vec3f, maximum: vec3f, maximumDistance: f32) -> bool {
  var nearDistance = EPSILON;
  var farDistance = maximumDistance;
  for (var axis = 0u; axis < 3u; axis += 1u) {
    let rayDirection = direction[axis];
    let rayOrigin = origin[axis];
    if (abs(rayDirection) < 0.0000001) {
      if (rayOrigin < minimum[axis] || rayOrigin > maximum[axis]) { return false; }
    } else {
      let inverse = 1.0 / rayDirection;
      var nearPlane = (minimum[axis] - rayOrigin) * inverse;
      var farPlane = (maximum[axis] - rayOrigin) * inverse;
      if (inverse < 0.0) {
        let swap = nearPlane;
        nearPlane = farPlane;
        farPlane = swap;
      }
      nearDistance = max(nearDistance, nearPlane);
      farDistance = min(farDistance, farPlane);
      if (farDistance <= nearDistance) { return false; }
    }
  }
  return true;
}

fn intersectTriangle(origin: vec3f, direction: vec3f, triangle: Triangle, maximumDistance: f32) -> TriangleHit {
  let edgeAB = triangle.b.xyz - triangle.a.xyz;
  let edgeAC = triangle.c.xyz - triangle.a.xyz;
  let perpendicular = cross(direction, edgeAC);
  let determinant = dot(edgeAB, perpendicular);
  if (abs(determinant) < 0.00000001) { return TriangleHit(maximumDistance, 0.0, 0.0, 0u); }
  let inverseDeterminant = 1.0 / determinant;
  let fromA = origin - triangle.a.xyz;
  let u = dot(fromA, perpendicular) * inverseDeterminant;
  if (u < 0.0 || u > 1.0) { return TriangleHit(maximumDistance, 0.0, 0.0, 0u); }
  let crossed = cross(fromA, edgeAB);
  let v = dot(direction, crossed) * inverseDeterminant;
  if (v < 0.0 || u + v > 1.0) { return TriangleHit(maximumDistance, 0.0, 0.0, 0u); }
  let distance = dot(edgeAC, crossed) * inverseDeterminant;
  if (distance <= EPSILON || distance >= maximumDistance) { return TriangleHit(maximumDistance, 0.0, 0.0, 0u); }
  return TriangleHit(distance, u, v, 1u);
}

fn hitBlas(origin: vec3f, direction: vec3f, root: u32, maximumDistance: f32, instance: Instance) -> Hit {
  var closest = Hit(maximumDistance, vec3f(0.0), 0u, 1u, 0u);
  var stack: array<u32, 64>;
  var stackSize = 1u;
  stack[0] = root;
  while (stackSize > 0u) {
    stackSize -= 1u;
    let node = blasNodes[stack[stackSize]];
    if (!hitsBounds(origin, direction, node.minLeaf.xyz, node.maxPad.xyz, closest.distance)) { continue; }
    if (node.minLeaf.w > 0.5) {
      for (var offset = 0u; offset < node.data.y; offset += 1u) {
        let triangle = triangles[node.data.x + offset];
        let triangleHit = intersectTriangle(origin, direction, triangle, closest.distance);
        if (triangleHit.found == 0u) { continue; }
        var normal = normalize(
          triangle.normalA.xyz * (1.0 - triangleHit.u - triangleHit.v) +
          triangle.normalB.xyz * triangleHit.u +
          triangle.normalC.xyz * triangleHit.v
        );
        let frontFace = select(0u, 1u, dot(direction, normal) < 0.0);
        if (frontFace == 0u) { normal = -normal; }
        closest = Hit(
          triangleHit.distance,
          normalize(rotateToWorld(normal, instance.rotation.x, instance.rotation.y)),
          triangle.material.x,
          frontFace,
          1u
        );
      }
    } else {
      if (stackSize + 2u < 64u) {
        stack[stackSize] = node.data.x;
        stack[stackSize + 1u] = node.data.y;
        stackSize += 2u;
      }
    }
  }
  return closest;
}

fn sceneHit(origin: vec3f, direction: vec3f, maximumDistance: f32) -> Hit {
  var closest = Hit(maximumDistance, vec3f(0.0), 0u, 1u, 0u);
  var stack: array<u32, 64>;
  var stackSize = 1u;
  stack[0] = 0u;
  while (stackSize > 0u) {
    stackSize -= 1u;
    let node = tlasNodes[stack[stackSize]];
    if (!hitsBounds(origin, direction, node.minLeaf.xyz, node.maxPad.xyz, closest.distance)) { continue; }
    if (node.minLeaf.w > 0.5) {
      for (var offset = 0u; offset < node.data.y; offset += 1u) {
        let instance = instances[node.data.x + offset];
        let localOrigin = rotateToLocal(origin - instance.translationScale.xyz, instance.rotation.x, instance.rotation.y) / instance.translationScale.w;
        let localDirection = rotateToLocal(direction, instance.rotation.x, instance.rotation.y) / instance.translationScale.w;
        let candidate = hitBlas(localOrigin, localDirection, instance.root, closest.distance, instance);
        if (candidate.found == 1u && candidate.distance < closest.distance) { closest = candidate; }
      }
    } else {
      if (stackSize + 2u < 64u) {
        stack[stackSize] = node.data.x;
        stack[stackSize + 1u] = node.data.y;
        stackSize += 2u;
      }
    }
  }
  return closest;
}

fn getLight(index: u32) -> Light {
  if (index == 0u) {
    return Light(
      vec4f(uniforms.playerLightPosition.xyz, uniforms.playerLightColorIntensity.w),
      vec4f(uniforms.playerLightColorIntensity.xyz, 0.05),
      vec4f(0.0)
    );
  }
  return lights[index - 1u];
}

fn lightWeight(light: Light, point: vec3f) -> f32 {
  let offset = light.positionIntensity.xyz - point;
  return light.positionIntensity.w / max(0.5, dot(offset, offset));
}

fn sampleLight(hitPoint: vec3f, hitNormal: vec3f, state: ptr<function, u32>) -> vec3f {
  let count = arrayLength(&lights) + 1u;
  var totalWeight = 0.0;
  for (var index = 0u; index < count; index += 1u) { totalWeight += lightWeight(getLight(index), hitPoint); }
  var threshold = random(state) * totalWeight;
  var selected = getLight(0u);
  var selectedWeight = lightWeight(selected, hitPoint);
  for (var index = 0u; index < count; index += 1u) {
    let light = getLight(index);
    let weight = lightWeight(light, hitPoint);
    threshold -= weight;
    if (threshold <= 0.0 || index + 1u == count) {
      selected = light;
      selectedWeight = weight;
      break;
    }
  }

  let lightPosition = selected.positionIntensity.xyz + randomUnitVector(state) * selected.colorRadius.w;
  let toLight = lightPosition - hitPoint;
  let distanceSquared = dot(toLight, toLight);
  let distanceToLight = sqrt(distanceSquared);
  let lightDirection = toLight / max(distanceToLight, EPSILON);
  let cosine = max(0.0, dot(hitNormal, lightDirection));
  if (cosine <= 0.0) { return vec3f(0.0); }
  let blocker = sceneHit(hitPoint + hitNormal * EPSILON * 3.0, lightDirection, distanceToLight);
  if (blocker.found == 1u && u32(round(materials[blocker.material].colorKind.w)) != 3u) { return vec3f(0.0); }

  let flicker = 1.0 + selected.params.y * (
    sin(uniforms.renderInfo.x * 8.7 + selected.params.x) * 0.65 +
    sin(uniforms.renderInfo.x * 17.3 + selected.params.x * 2.1) * 0.35
  );
  let probability = selectedWeight / max(totalWeight, 0.000001);
  return selected.colorRadius.xyz *
    (cosine * selected.positionIntensity.w * flicker) /
    (max(0.35, distanceSquared) * max(probability, 0.000001));
}

fn schlick(cosine: f32, ior: f32) -> f32 {
  let r = pow((1.0 - ior) / (1.0 + ior), 2.0);
  return r + (1.0 - r) * pow(1.0 - cosine, 5.0);
}

fn trace(initialOrigin: vec3f, initialDirection: vec3f, state: ptr<function, u32>) -> vec3f {
  var origin = initialOrigin;
  var direction = initialDirection;
  var throughput = vec3f(1.0);
  var radiance = vec3f(0.0);
  for (var bounce = 0u; bounce < 5u; bounce += 1u) {
    let hit = sceneHit(origin, direction, 100000.0);
    if (hit.found == 0u) {
      radiance += throughput * vec3f(0.004, 0.005, 0.009);
      break;
    }
    let material = materials[hit.material];
    let kind = u32(round(material.colorKind.w));
    let hitPoint = origin + direction * hit.distance;
    if (kind == 3u) {
      radiance += throughput * material.colorKind.xyz * material.params.z;
      break;
    }
    if (kind == 0u) {
      radiance += throughput * material.colorKind.xyz * sampleLight(hitPoint, hit.normal, state);
      throughput *= material.colorKind.xyz;
      origin = hitPoint + hit.normal * EPSILON * 3.0;
      direction = cosineHemisphere(hit.normal, state);
    } else if (kind == 1u) {
      let reflected = reflect(direction, hit.normal);
      direction = normalize(reflected + randomUnitVector(state) * material.params.x);
      if (dot(direction, hit.normal) <= 0.0) { break; }
      throughput *= material.colorKind.xyz;
      origin = hitPoint + hit.normal * EPSILON * 3.0;
    } else {
      let ior = material.params.y;
      let eta = select(ior, 1.0 / ior, hit.frontFace == 1u);
      let cosine = min(dot(-direction, hit.normal), 1.0);
      let cannotRefract = eta * sqrt(max(0.0, 1.0 - cosine * cosine)) > 1.0;
      if (cannotRefract || schlick(cosine, ior) > random(state)) {
        direction = reflect(direction, hit.normal);
      } else {
        direction = refract(direction, hit.normal, eta);
      }
      direction = normalize(direction);
      throughput *= material.colorKind.xyz;
      origin = hitPoint + direction * EPSILON * 3.0;
    }
    if (bounce >= 2u) {
      let survival = min(0.94, max(throughput.x, max(throughput.y, throughput.z)));
      if (random(state) > survival) { break; }
      throughput /= max(0.01, survival);
    }
  }
  return radiance;
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= uniforms.frameInfo.x || id.y >= uniforms.frameInfo.y) { return; }
  let pixel = id.y * uniforms.frameInfo.x + id.x;
  var previous = accumulation[pixel];
  if (uniforms.frameInfo.w == 1u) { previous = vec4f(0.0); }
  var sampleSum = vec3f(0.0);
  for (var sample = 0u; sample < uniforms.frameInfo.z; sample += 1u) {
    var state = (
      ((pixel + 1u) * 0x9e3779b1u) ^
      ((u32(uniforms.renderInfo.w) + sample + 1u) * 0x85ebca6bu)
    ) | 1u;
    var jitterX = random(&state);
    var jitterY = random(&state);
    if (uniforms.renderInfo.z > 0.5) { jitterX = 0.5; jitterY = 0.5; }
    let screenX = (2.0 * ((f32(id.x) + jitterX) / f32(uniforms.frameInfo.x)) - 1.0) * uniforms.renderInfo.y;
    let screenY = (1.0 - 2.0 * ((f32(id.y) + jitterY) / f32(uniforms.frameInfo.y))) * uniforms.renderInfo.y;
    let direction = normalize(
      uniforms.cameraForward.xyz +
      uniforms.cameraRight.xyz * screenX +
      uniforms.cameraUp.xyz * screenY
    );
    sampleSum += trace(uniforms.cameraPosition.xyz, direction, &state);
  }
  let accumulated = vec4f(
    previous.xyz + sampleSum,
    previous.w + f32(uniforms.frameInfo.z)
  );
  accumulation[pixel] = accumulated;
}
`;

const denoiseShader = /* wgsl */ `
struct Uniforms {
  cameraPosition: vec4f,
  cameraForward: vec4f,
  cameraRight: vec4f,
  cameraUp: vec4f,
  playerLightPosition: vec4f,
  playerLightColorIntensity: vec4f,
  frameInfo: vec4u,
  renderInfo: vec4f,
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var<storage, read> accumulation: array<vec4f>;
@group(0) @binding(2) var<storage, read_write> intermediate: array<vec4f>;
@group(0) @binding(3) var outputTexture: texture_storage_2d<rgba8unorm, write>;

fn accumulatedColor(index: u32) -> vec4f {
  let value = accumulation[index];
  return vec4f(value.xyz / max(1.0, value.w), value.w);
}

fn spatialWeight(offset: i32) -> f32 {
  if (offset == 0) { return 4.0; }
  if (abs(offset) == 1) { return 2.0; }
  return 1.0;
}

fn bilateralWeight(center: vec3f, sample: vec3f, spatial: f32, sigma: f32) -> f32 {
  let difference = sample - center;
  return spatial * exp(-dot(difference, difference) / max(0.001, sigma * sigma));
}

fn toneMap(color: vec3f) -> vec3f {
  let exposed = color * 1.35;
  let mapped = clamp(
    exposed * (2.51 * exposed + vec3f(0.03)) /
    (exposed * (2.43 * exposed + vec3f(0.59)) + vec3f(0.14)),
    vec3f(0.0), vec3f(1.0)
  );
  return sqrt(mapped);
}

@compute @workgroup_size(8, 8)
fn horizontal(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= uniforms.frameInfo.x || id.y >= uniforms.frameInfo.y) { return; }
  let pixel = id.y * uniforms.frameInfo.x + id.x;
  let center = accumulatedColor(pixel);
  let convergence = clamp(center.w / 20.0, 0.0, 1.0);
  let sigma = mix(1.6, 0.42, convergence);
  var color = vec3f(0.0);
  var totalWeight = 0.0;
  for (var offset = -2i; offset <= 2i; offset += 1i) {
    let sampleX = u32(clamp(i32(id.x) + offset, 0i, i32(uniforms.frameInfo.x) - 1i));
    let sample = accumulatedColor(id.y * uniforms.frameInfo.x + sampleX);
    let weight = bilateralWeight(center.xyz, sample.xyz, spatialWeight(offset), sigma);
    color += sample.xyz * weight;
    totalWeight += weight;
  }
  intermediate[pixel] = vec4f(color / max(totalWeight, 0.00001), center.w);
}

@compute @workgroup_size(8, 8)
fn vertical(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= uniforms.frameInfo.x || id.y >= uniforms.frameInfo.y) { return; }
  let pixel = id.y * uniforms.frameInfo.x + id.x;
  let original = accumulatedColor(pixel);
  let center = intermediate[pixel];
  let convergence = clamp(center.w / 20.0, 0.0, 1.0);
  let sigma = mix(1.6, 0.42, convergence);
  var color = vec3f(0.0);
  var totalWeight = 0.0;
  for (var offset = -2i; offset <= 2i; offset += 1i) {
    let sampleY = u32(clamp(i32(id.y) + offset, 0i, i32(uniforms.frameInfo.y) - 1i));
    let sample = intermediate[sampleY * uniforms.frameInfo.x + id.x];
    let weight = bilateralWeight(center.xyz, sample.xyz, spatialWeight(offset), sigma);
    color += sample.xyz * weight;
    totalWeight += weight;
  }
  let filtered = color / max(totalWeight, 0.00001);
  let strength = clamp(1.0 - original.w / 24.0, 0.0, 1.0);
  textureStore(outputTexture, vec2i(id.xy), vec4f(toneMap(mix(original.xyz, filtered, strength)), 1.0));
}
`;

const displayShader = /* wgsl */ `
@group(0) @binding(0) var rendered: texture_2d<f32>;

@vertex
fn vertexMain(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f {
  let positions = array(
    vec2f(-1.0, -1.0),
    vec2f(3.0, -1.0),
    vec2f(-1.0, 3.0)
  );
  return vec4f(positions[index], 0.0, 1.0);
}

@fragment
fn fragmentMain(@builtin(position) position: vec4f) -> @location(0) vec4f {
  return textureLoad(rendered, vec2i(position.xy), 0);
}
`;

function createDataBuffer(device: any, contents: ArrayBuffer, usage: number): any {
  const size = Math.max(4, Math.ceil(contents.byteLength / 4) * 4);
  const buffer = device.createBuffer({ size, usage, mappedAtCreation: true });
  new Uint8Array(buffer.getMappedRange()).set(new Uint8Array(contents));
  buffer.unmap();
  return buffer;
}

function packLights(lights: readonly GpuLightInput[]): ArrayBuffer {
  const buffer = new ArrayBuffer(Math.max(1, lights.length) * 48);
  const view = new DataView(buffer);
  lights.forEach((light, index) => {
    const offset = index * 48;
    view.setFloat32(offset, light.position.x, true);
    view.setFloat32(offset + 4, light.position.y, true);
    view.setFloat32(offset + 8, light.position.z, true);
    view.setFloat32(offset + 12, light.intensity, true);
    view.setFloat32(offset + 16, light.color.x, true);
    view.setFloat32(offset + 20, light.color.y, true);
    view.setFloat32(offset + 24, light.color.z, true);
    view.setFloat32(offset + 28, light.radius, true);
    view.setFloat32(offset + 32, light.phase, true);
    view.setFloat32(offset + 36, light.flicker, true);
  });
  return buffer;
}

export async function createWebGpuRenderer(
  canvas: HTMLCanvasElement,
  scene: PackedGpuScene,
  staticLights: readonly GpuLightInput[],
): Promise<WebGpuRenderer | null> {
  const gpu = (navigator as Navigator & { gpu?: any }).gpu;
  if (!gpu) return null;

  const adapter = await gpu.requestAdapter();
  if (!adapter) return null;
  const device = await adapter.requestDevice();
  const context = canvas.getContext("webgpu") as any;
  if (!context) return null;

  const bufferUsage = (globalThis as any).GPUBufferUsage;
  const textureUsage = (globalThis as any).GPUTextureUsage;
  const format = gpu.getPreferredCanvasFormat();
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  context.configure({ device, format, alphaMode: "opaque" });

  const uniformBuffer = device.createBuffer({
    size: 128,
    usage: bufferUsage.UNIFORM | bufferUsage.COPY_DST,
  });
  const trianglesBuffer = createDataBuffer(device, scene.triangles, bufferUsage.STORAGE);
  const materialsBuffer = createDataBuffer(device, scene.materials, bufferUsage.STORAGE);
  const blasBuffer = createDataBuffer(device, scene.blasNodes, bufferUsage.STORAGE);
  const instancesBuffer = createDataBuffer(device, scene.instances, bufferUsage.STORAGE);
  const tlasBuffer = createDataBuffer(device, scene.tlasNodes, bufferUsage.STORAGE);
  const lightsBuffer = createDataBuffer(device, packLights(staticLights), bufferUsage.STORAGE);
  const accumulationBuffer = device.createBuffer({
    size: WIDTH * HEIGHT * 16,
    usage: bufferUsage.STORAGE,
  });
  const denoisedBuffer = device.createBuffer({
    size: WIDTH * HEIGHT * 16,
    usage: bufferUsage.STORAGE,
  });
  const outputTexture = device.createTexture({
    size: [WIDTH, HEIGHT],
    format: "rgba8unorm",
    usage: textureUsage.STORAGE_BINDING | textureUsage.TEXTURE_BINDING,
  });

  const computeModule = device.createShaderModule({ label: "Dungeon path tracer", code: computeShader });
  const computeCompilation = await computeModule.getCompilationInfo?.();
  const computeErrors = computeCompilation?.messages?.filter((message: any) => message.type === "error") ?? [];
  if (computeErrors.length > 0) {
    throw new Error(`WGSL path tracer:\n${computeErrors.map((message: any) => message.message).join("\n")}`);
  }
  const computePipeline = await device.createComputePipelineAsync({
    label: "Dungeon path tracing pipeline",
    layout: "auto",
    compute: { module: computeModule, entryPoint: "main" },
  });
  const computeBindGroup = device.createBindGroup({
    layout: computePipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniformBuffer } },
      { binding: 1, resource: { buffer: trianglesBuffer } },
      { binding: 2, resource: { buffer: materialsBuffer } },
      { binding: 3, resource: { buffer: blasBuffer } },
      { binding: 4, resource: { buffer: instancesBuffer } },
      { binding: 5, resource: { buffer: tlasBuffer } },
      { binding: 6, resource: { buffer: lightsBuffer } },
      { binding: 7, resource: { buffer: accumulationBuffer } },
    ],
  });

  const denoiseModule = device.createShaderModule({ label: "Dungeon denoiser", code: denoiseShader });
  const denoiseCompilation = await denoiseModule.getCompilationInfo?.();
  const denoiseErrors = denoiseCompilation?.messages?.filter((message: any) => message.type === "error") ?? [];
  if (denoiseErrors.length > 0) {
    throw new Error(`WGSL denoise:\n${denoiseErrors.map((message: any) => message.message).join("\n")}`);
  }
  const horizontalPipeline = await device.createComputePipelineAsync({
    label: "Dungeon horizontal denoise",
    layout: "auto",
    compute: { module: denoiseModule, entryPoint: "horizontal" },
  });
  const verticalPipeline = await device.createComputePipelineAsync({
    label: "Dungeon vertical denoise",
    layout: "auto",
    compute: { module: denoiseModule, entryPoint: "vertical" },
  });
  const horizontalBindGroup = device.createBindGroup({
    layout: horizontalPipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniformBuffer } },
      { binding: 1, resource: { buffer: accumulationBuffer } },
      { binding: 2, resource: { buffer: denoisedBuffer } },
    ],
  });
  const verticalBindGroup = device.createBindGroup({
    layout: verticalPipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniformBuffer } },
      { binding: 1, resource: { buffer: accumulationBuffer } },
      { binding: 2, resource: { buffer: denoisedBuffer } },
      { binding: 3, resource: outputTexture.createView() },
    ],
  });

  const displayModule = device.createShaderModule({ label: "Dungeon display", code: displayShader });
  const displayCompilation = await displayModule.getCompilationInfo?.();
  const displayErrors = displayCompilation?.messages?.filter((message: any) => message.type === "error") ?? [];
  if (displayErrors.length > 0) {
    throw new Error(`WGSL display:\n${displayErrors.map((message: any) => message.message).join("\n")}`);
  }
  const displayPipeline = await device.createRenderPipelineAsync({
    label: "Dungeon display pipeline",
    layout: "auto",
    vertex: { module: displayModule, entryPoint: "vertexMain" },
    fragment: { module: displayModule, entryPoint: "fragmentMain", targets: [{ format }] },
    primitive: { topology: "triangle-list" },
  });
  const displayBindGroup = device.createBindGroup({
    layout: displayPipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: outputTexture.createView() }],
  });

  const resources = [
    uniformBuffer, trianglesBuffer, materialsBuffer, blasBuffer, instancesBuffer,
    tlasBuffer, lightsBuffer, accumulationBuffer, denoisedBuffer, outputTexture,
  ];
  let accumulatedSamples = 0;

  return {
    render(frame: GpuFrame): number {
      const samplesThisFrame = frame.moving ? 2 : 4;
      if (frame.reset) accumulatedSamples = 0;
      const uniforms = new ArrayBuffer(128);
      const floats = new Float32Array(uniforms);
      const uints = new Uint32Array(uniforms);
      const writeVector = (offset: number, vector: GpuVec3, fourth = 0): void => {
        floats[offset] = vector.x;
        floats[offset + 1] = vector.y;
        floats[offset + 2] = vector.z;
        floats[offset + 3] = fourth;
      };
      writeVector(0, frame.position);
      writeVector(4, frame.forward);
      writeVector(8, frame.right);
      writeVector(12, frame.up);
      writeVector(16, frame.playerLightPosition);
      writeVector(20, frame.playerLightColor, frame.playerLightIntensity);
      uints[24] = WIDTH;
      uints[25] = HEIGHT;
      uints[26] = samplesThisFrame;
      uints[27] = frame.reset ? 1 : 0;
      floats[28] = frame.time;
      floats[29] = Math.tan(frame.fov * 0.5);
      floats[30] = frame.moving ? 1 : 0;
      floats[31] = accumulatedSamples;
      device.queue.writeBuffer(uniformBuffer, 0, uniforms);

      const encoder = device.createCommandEncoder();
      const computePass = encoder.beginComputePass();
      computePass.setPipeline(computePipeline);
      computePass.setBindGroup(0, computeBindGroup);
      computePass.dispatchWorkgroups(Math.ceil(WIDTH / 8), Math.ceil(HEIGHT / 8));
      computePass.end();

      const horizontalPass = encoder.beginComputePass();
      horizontalPass.setPipeline(horizontalPipeline);
      horizontalPass.setBindGroup(0, horizontalBindGroup);
      horizontalPass.dispatchWorkgroups(Math.ceil(WIDTH / 8), Math.ceil(HEIGHT / 8));
      horizontalPass.end();

      const verticalPass = encoder.beginComputePass();
      verticalPass.setPipeline(verticalPipeline);
      verticalPass.setBindGroup(0, verticalBindGroup);
      verticalPass.dispatchWorkgroups(Math.ceil(WIDTH / 8), Math.ceil(HEIGHT / 8));
      verticalPass.end();

      const renderPass = encoder.beginRenderPass({
        colorAttachments: [{
          view: context.getCurrentTexture().createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: "clear",
          storeOp: "store",
        }],
      });
      renderPass.setPipeline(displayPipeline);
      renderPass.setBindGroup(0, displayBindGroup);
      renderPass.draw(3);
      renderPass.end();
      device.queue.submit([encoder.finish()]);
      accumulatedSamples += samplesThisFrame;
      return accumulatedSamples;
    },
    destroy(): void {
      for (const resource of resources) resource.destroy?.();
      device.destroy();
    },
  };
}
