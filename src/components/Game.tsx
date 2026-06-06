// @ts-nocheck
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree, useLoader } from "@react-three/fiber";
import { useGame as useGameHook } from "@/game/store";
import * as THREE from "three";
import { GameEngine } from "@/game/engine";
import { store, useGame } from "@/game/store";
import { Input } from "@/game/input";
import { generateWorld, WORLD_SIZE, terrainHeightAt } from "@/game/world";
import HUD from "./HUD";
import drumTopUrl from "@/assets/drum_barrel_top.webp";
import treeLeavesUrl from "@/assets/tree_leaves.webp";

// High-quality PBR texture sets (diffuse + normal + roughness) used to make
// the map look far more realistic. These come from assets/new and replace /
// augment the flat single-map textures above on objects that use
// MeshStandardMaterial (so normal + roughness maps add real surface detail).
// --- Ground sand (gravelly sand) ---
import groundSandDiffUrl from "@/assets/new/gravelly_sand_diff_1k.webp";
// --- Cobblestone / road (gravel floor) ---
import roadStoneDiffUrl from "@/assets/new/gravel_floor_diff_1k.webp";
// --- Walls (layered concrete) ---
import wallDiffUrl from "@/assets/new/concrete_layers_02_diff_1k.webp";
import wallNorUrl from "@/assets/new/concrete_layers_02_nor_gl_1k.webp";
import wallRoughUrl from "@/assets/new/concrete_layers_02_rough_1k.webp";
// --- Ammo crates (wood table) ---
import crateDiffUrl from "@/assets/new/wood_table_diff_1k.webp";
import crateNorUrl from "@/assets/new/wood_table_nor_gl_1k.webp";
import crateRoughUrl from "@/assets/new/wood_table_rough_1k.webp";
// --- Barrels (rusty metal) ---
import barrelDiffUrl from "@/assets/new/rusty_metal_04_diff_1k.webp";
import barrelNorUrl from "@/assets/new/rusty_metal_04_nor_gl_1k.webp";
import barrelRoughUrl from "@/assets/new/rusty_metal_04_rough_1k.webp";
// --- Tree trunk (willow bark) ---
import barkDiffUrl from "@/assets/new/bark_willow_02_diff_1k.webp";
import barkNorUrl from "@/assets/new/bark_willow_02_nor_gl_1k.webp";
import barkRoughUrl from "@/assets/new/bark_willow_02_rough_1k.webp";
// --- Sandbags (sandy gravel) ---
import sandbagDiffUrl from "@/assets/new/sandy_gravel_02_diff_1k.webp";
import sandbagNorUrl from "@/assets/new/sandy_gravel_02_nor_gl_1k.webp";
import sandbagRoughUrl from "@/assets/new/sandy_gravel_02_rough_1k.webp";

const sharedWorld = generateWorld();

// All in-game textures. Kept here so they can be warmed into the browser /
// THREE cache while the menu is on screen — by the time the player presses
// Start, decoding is already done and the map appears almost instantly.
const TEXTURE_URLS = [
  drumTopUrl,
  treeLeavesUrl,
  // High-quality PBR sets from assets/new
  groundSandDiffUrl,
  roadStoneDiffUrl,
  wallDiffUrl,
  wallNorUrl,
  wallRoughUrl,
  crateDiffUrl,
  crateNorUrl,
  crateRoughUrl,
  barrelDiffUrl,
  barrelNorUrl,
  barrelRoughUrl,
  barkDiffUrl,
  barkNorUrl,
  barkRoughUrl,
  sandbagDiffUrl,
  sandbagNorUrl,
  sandbagRoughUrl,
];

let texturesWarmed = false;
function preloadTextures() {
  if (texturesWarmed || typeof window === "undefined") return;
  texturesWarmed = true;
  // Prime R3F's useLoader cache so the in-game <Suspense> resolves synchronously.
  try {
    (useLoader as any).preload?.(THREE.TextureLoader, TEXTURE_URLS);
  } catch {
    /* ignore — preload is a best-effort optimization */
  }
  // Also kick off the raw network fetch/decode immediately via the browser.
  for (const url of TEXTURE_URLS) {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
  }
}

// Texture cache helper for repeated tiling
function useTiledTexture(url: string, repeat: number, anisotropy = 16) {
  const tex = useLoader(THREE.TextureLoader, url);
  return useMemo(() => {
    const t = tex.clone();
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat, repeat);
    // High anisotropy keeps tiled ground/road sharp at grazing angles — this
    // recovers most of the perceived detail lost by down-scaling the maps,
    // for free on the GPU.
    t.anisotropy = anisotropy;
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.colorSpace = THREE.SRGBColorSpace;
    t.needsUpdate = true;
    return t;
  }, [tex, repeat, anisotropy]);
}

// PBR texture-set helper. Loads diffuse + normal + roughness maps from
// assets/new and returns ready-to-use, tiled THREE textures. The diffuse map
// is sRGB; normal/roughness are linear data maps. `repeatX`/`repeatY` control
// tiling so the physical scale of the material looks right on each object.
function useTiledPBR(
  diffUrl: string,
  norUrl: string,
  roughUrl: string,
  repeatX: number,
  repeatY: number = repeatX,
  anisotropy = 16,
) {
  const [diff, nor, rough] = useLoader(THREE.TextureLoader, [
    diffUrl,
    norUrl,
    roughUrl,
  ]) as THREE.Texture[];
  return useMemo(() => {
    const setup = (src: THREE.Texture, srgb: boolean) => {
      const t = src.clone();
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(repeatX, repeatY);
      // Anisotropic filtering + trilinear mipmaps keep surfaces crisp at steep
      // viewing angles and free of shimmer, compensating for the smaller
      // (half-res) normal/roughness maps we now ship.
      t.anisotropy = anisotropy;
      t.generateMipmaps = true;
      t.minFilter = THREE.LinearMipmapLinearFilter;
      t.magFilter = THREE.LinearFilter;
      t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.needsUpdate = true;
      return t;
    };
    return {
      map: setup(diff, true),
      normalMap: setup(nor, false),
      roughnessMap: setup(rough, false),
    };
  }, [diff, nor, rough, repeatX, repeatY, anisotropy]);
}

function Scene({ engine }: { engine: GameEngine }) {
  const { camera } = useThree();
  const lastTime = useRef(performance.now() / 1000);

  useFrame(() => {
    const now = performance.now() / 1000;
    const dt = Math.min(0.05, now - lastTime.current);
    lastTime.current = now;
    engine.update(dt, now);
    const p = engine.state.player;
    const sh = engine.state.shake;
    const shakeX = (Math.random() - 0.5) * sh * 0.15;
    const shakeY = (Math.random() - 0.5) * sh * 0.15;
    camera.position.set(p.pos.x + shakeX, p.pos.y + shakeY, p.pos.z);
    const e = new THREE.Euler(p.pitch, p.yaw, 0, "YXZ");
    camera.quaternion.setFromEuler(e);
    const baseFov = 78;
    const aimedFov = engine.state.currentWeapon === "sniper" ? 18 : engine.state.currentWeapon === "rifle" ? 32 : 50;
    const targetFov = baseFov + (aimedFov - baseFov) * engine.state.aimT;
    const persp = camera as THREE.PerspectiveCamera;
    if (Math.abs(persp.fov - targetFov) > 0.05) {
      persp.fov = targetFov;
      persp.updateProjectionMatrix();
    }
  });

  return (
    <>
      <fog attach="fog" args={["#efd29a", 120, 760]} />
      {/* Sky/ground hemisphere fill: cool sky blue from above, warm sand bounce
          from below — gives natural ambient occlusion-like shading on people,
          trees and façades without extra render cost. */}
      <hemisphereLight args={["#cfe6ff", "#ca996a", 1.05]} />
      <directionalLight
        position={[80, 160, 40]}
        intensity={2.8}
        color="#fff1cf"
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-left={-180}
        shadow-camera-right={180}
        shadow-camera-top={180}
        shadow-camera-bottom={-180}
        shadow-camera-near={1}
        shadow-camera-far={400}
        shadow-bias={-0.00018}
        shadow-normalBias={0.02}
      />
      <directionalLight
        position={[-40, 80, -60]}
        intensity={0.7}
        color="#d8e8ff"
      />
      <ambientLight intensity={0.55} color="#f0c98e" />

      <Sky />
      <Ground />
      <Roads />
      <Walls />
      <Roofs />
      <Crates />
      <Containers />
      <Barrels />
      <Sandbags />
      <Palms />
      <Tents />
      <Lamps />
      <Awnings />
      <Windows />
      <Rugs />
      <Fountain />
      <Pickups />
      <Soldiers />
      <Grenades />
      <Explosions />
      <SmokeCloudsScene />
      <DestructiblesScene />
      <RagdollsScene />
      <Hits />
      <BulletTrails />
      <MuzzleFlashes />
      <VehiclesScene />
      <ViewModel />
    </>
  );
}

function Sky() {
  const mat = useMemo(() => {
    return new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        topColor: { value: new THREE.Color("#5a9ed6") },
        midColor: { value: new THREE.Color("#c8daf0") },
        horizonColor: { value: new THREE.Color("#e8c090") },
        sunDir: { value: new THREE.Vector3(0.4, 0.7, 0.2).normalize() },
        sunColor: { value: new THREE.Color("#ffe8a0") },
      },
      vertexShader: `
        varying vec3 vWorldPos;
        varying vec3 vWorldDir;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorldPos = wp.xyz;
          vWorldDir = normalize(wp.xyz);
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: `
        uniform vec3 topColor;
        uniform vec3 midColor;
        uniform vec3 horizonColor;
        uniform vec3 sunDir;
        uniform vec3 sunColor;
        varying vec3 vWorldPos;
        varying vec3 vWorldDir;

        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float noise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          float a = hash(i), b = hash(i + vec2(1,0)), c = hash(i + vec2(0,1)), d = hash(i + vec2(1,1));
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(a,b,u.x), mix(c,d,u.x), u.y);
        }
        void main() {
          vec3 dir = normalize(vWorldDir);
          float h = dir.y;
          // Sky gradient with 3 stops
          float t1 = smoothstep(-0.05, 0.15, h);
          float t2 = smoothstep(0.15, 0.7, h);
          vec3 sky = mix(horizonColor, midColor, t1);
          sky = mix(sky, topColor, t2);
          // Sun disc and glow
          float sunDot = max(0.0, dot(dir, sunDir));
          float sunDisc = smoothstep(0.997, 0.999, sunDot);
          float sunGlow = pow(sunDot, 12.0) * 0.4;
          float sunHaze = pow(sunDot, 3.0) * 0.15;
          sky += sunColor * (sunDisc * 2.0 + sunGlow + sunHaze);
          // Wispy clouds
          if (h > 0.0) {
            vec2 cp = dir.xz / (h + 0.1) * 8.0;
            float cn = noise(cp * 0.3) * 0.5 + noise(cp * 0.7) * 0.3 + noise(cp * 1.5) * 0.2;
            float cloud = smoothstep(0.45, 0.7, cn) * smoothstep(0.0, 0.2, h) * 0.6;
            sky = mix(sky, vec3(1.0, 0.98, 0.95), cloud);
          }
          gl_FragColor = vec4(sky, 1.0);
        }
      `,
    });
  }, []);
  return (
    <mesh material={mat} renderOrder={-1000}>
      <sphereGeometry args={[500, 24, 12]} />
    </mesh>
  );
}

function Ground() {
  // Higher-detail gravelly-sand diffuse from assets/new for a more realistic
  // desert floor (sampled at two scales in the shader below).
  const sandTex = useTiledTexture(groundSandDiffUrl, 80, 16);
  const mat = useMemo(() => {
    return new THREE.ShaderMaterial({
      uniforms: {
        sandTex: { value: sandTex },
        sandLight: { value: new THREE.Color("#f4d49a") },
        sandDark: { value: new THREE.Color("#c89b5f") },
        sandRed: { value: new THREE.Color("#e1ad72") },
        rockColor: { value: new THREE.Color("#9b8468") },
        fogColor: { value: new THREE.Color("#efd29a") },
        fogNear: { value: 60 },
        fogFar: { value: 320 },
      },
      vertexShader: `
        varying vec2 vUv;
        varying vec3 vWorldPos;
        varying float vFogDepth;
        void main() {
          vUv = uv;
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorldPos = wp.xyz;
          vec4 mv = viewMatrix * wp;
          vFogDepth = -mv.z;
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: `
        uniform sampler2D sandTex;
        uniform vec3 sandLight;
        uniform vec3 sandDark;
        uniform vec3 sandRed;
        uniform vec3 rockColor;
        uniform vec3 fogColor;
        uniform float fogNear;
        uniform float fogFar;
        varying vec2 vUv;
        varying vec3 vWorldPos;
        varying float vFogDepth;

        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float noise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          float a = hash(i), b = hash(i + vec2(1,0)), c = hash(i + vec2(0,1)), d = hash(i + vec2(1,1));
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(a,b,u.x), mix(c,d,u.x), u.y);
        }
        float fbm(vec2 p) {
          float v = 0.0, a = 0.5;
          for (int i = 0; i < 4; i++) {
            v += a * noise(p);
            p *= 2.1;
            a *= 0.5;
          }
          return v;
        }
        void main() {
          vec2 p = vWorldPos.xz;
          // Sample real sand texture at two scales for variation
          vec3 sandTexCol = texture2D(sandTex, p * 0.08).rgb;
          vec3 sandTexFar = texture2D(sandTex, p * 0.015).rgb;
          vec3 baseSand = mix(sandTexCol, sandTexFar, 0.35);

          float n = fbm(p * 0.12);
          // Subtle tint variation around 1.0 so we don't darken the texture
          vec3 tint = mix(sandDark, sandLight, n) / sandLight;
          vec3 col = baseSand * mix(vec3(1.0), tint, 0.35);

          float redPatch = smoothstep(0.55, 0.7, noise(p * 0.04));
          col = mix(col, col * 1.08, redPatch * 0.2);
          float rockMask = smoothstep(0.78, 0.9, noise(p * 0.06));
          col = mix(col, col * 0.92, rockMask * 0.2);
          col *= 1.18;


          float fogF = clamp((vFogDepth - fogNear) / (fogFar - fogNear), 0.0, 1.0);
          col = mix(col, fogColor, fogF);
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
  }, [sandTex]);

  // Displaced height-field mesh so the whole desert is one continuous, rolling
  // surface. The detailed playable area uses a dense grid; a large flat skirt
  // extends to the horizon beyond it.
  const geometry = useMemo(() => {
    const extent = WORLD_SIZE * 1.5; // half-size of the detailed terrain patch
    const segments = 220; // resolution of the displaced grid
    const verts: number[] = [];
    const idx: number[] = [];
    for (let iz = 0; iz <= segments; iz++) {
      for (let ix = 0; ix <= segments; ix++) {
        const x = -extent + (ix / segments) * extent * 2;
        const z = -extent + (iz / segments) * extent * 2;
        const y = terrainHeightAt(sharedWorld, x, z);
        verts.push(x, y, z);
      }
    }
    const row = segments + 1;
    for (let iz = 0; iz < segments; iz++) {
      for (let ix = 0; ix < segments; ix++) {
        const a = iz * row + ix;
        const b = a + 1;
        const c = a + row;
        const d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    return geo;
  }, []);

  return (
    <group>
      {/* Far flat skirt to the horizon (sits under the detailed patch edges) */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.05, 0]} material={mat}>
        <planeGeometry args={[WORLD_SIZE * 6, WORLD_SIZE * 6, 1, 1]} />
      </mesh>
      {/* Detailed rolling terrain */}
      <mesh geometry={geometry} receiveShadow material={mat} />
    </group>
  );
}

// Atmospheric dust particles — very subtle, normal blending to avoid bright dot artifacts
function DustParticles() {
  const ref = useRef<THREE.Points>(null);
  const count = 60;
  const positions = useMemo(() => {
    const arr = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      arr[i * 3] = (Math.random() - 0.5) * 80;
      arr[i * 3 + 1] = Math.random() * 12 + 0.5;
      arr[i * 3 + 2] = (Math.random() - 0.5) * 80;
    }
    return arr;
  }, []);
  const mat = useMemo(() => new THREE.PointsMaterial({
    color: '#e8d4a8',
    size: 0.04,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.18,
    depthWrite: false,
    depthTest: true,
    blending: THREE.NormalBlending,
  }), []);

  useFrame(() => {
    const pts = ref.current;
    if (!pts) return;
    // Follow camera
    const cam = store.state.player.pos;
    pts.position.set(cam.x, 0, cam.z);
    // Gentle drift using time-based offset (no accumulation)
    const posAttr = pts.geometry.getAttribute('position') as THREE.BufferAttribute;
    const arr = posAttr.array as Float32Array;
    const t = performance.now() * 0.001;
    for (let i = 0; i < count; i++) {
      const baseX = positions[i * 3];
      const baseY = positions[i * 3 + 1];
      arr[i * 3] = baseX + Math.sin(t * 0.2 + i) * 2.0;
      arr[i * 3 + 1] = ((baseY + t * 0.3 + i * 0.1) % 16) + 0.5;
      arr[i * 3 + 2] = positions[i * 3 + 2] + Math.cos(t * 0.15 + i * 0.7) * 1.5;
    }
    posAttr.needsUpdate = true;
  });

  return (
    <points ref={ref} material={mat}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
    </points>
  );
}

function Roads() {
  // Gravel-floor diffuse from assets/new — a more believable packed-stone road.
  const stoneTex = useTiledTexture(roadStoneDiffUrl, 1, 12);
  const mat = useMemo(() => new THREE.ShaderMaterial({
    uniforms: {
      stoneTex: { value: stoneTex },
      fogColor: { value: new THREE.Color("#efd29a") },
      fogNear: { value: 60 },
      fogFar: { value: 320 },
    },
    vertexShader: `
      varying vec3 vWorldPos;
      varying float vFogDepth;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPos = wp.xyz;
        vec4 mv = viewMatrix * wp;
        vFogDepth = -mv.z;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      uniform sampler2D stoneTex;
      uniform vec3 fogColor;
      uniform float fogNear, fogFar;
      varying vec3 vWorldPos;
      varying float vFogDepth;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p); vec2 f = fract(p);
        float a = hash(i), b = hash(i+vec2(1,0)), c = hash(i+vec2(0,1)), d = hash(i+vec2(1,1));
        vec2 u = f*f*(3.0-2.0*f);
        return mix(mix(a,b,u.x), mix(c,d,u.x), u.y);
      }
      void main() {
        vec2 p = vWorldPos.xz;
        // Cobblestone texture tiled — show at full brightness
        vec3 stone = texture2D(stoneTex, p * 0.18).rgb;
        float dust = noise(p * 0.5) * 0.15;
        vec3 col = stone * (1.12 + dust * 0.12);
        // Tire marks slightly darken
        float tire = smoothstep(0.55, 0.7, noise(vec2(p.x * 0.4, p.z * 4.0)));
        col = mix(col, col * 0.95, tire * 0.18);
        float fogF = clamp((vFogDepth - fogNear) / (fogFar - fogNear), 0.0, 1.0);
        col = mix(col, fogColor, fogF);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  }), [stoneTex]);
  return (
    <group>
      {sharedWorld.roads.map((r, i) => (
        <mesh key={i} position={[r.pos.x, r.pos.y, r.pos.z]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow material={mat}>
          <planeGeometry args={[r.size.x, r.size.z]} />
        </mesh>
      ))}
    </group>
  );
}

function Walls() {
  const groups = useMemo(() => {
    const map = new Map<string, typeof sharedWorld.walls>();
    for (const w of sharedWorld.walls) {
      if (w.kind === "roof") continue;
      const arr = map.get(w.color) || [];
      arr.push(w);
      map.set(w.color, arr);
    }
    return Array.from(map.entries());
  }, []);
  return (
    <group>
      {groups.map(([color, walls]) => (
        <InstancedBoxes key={color} items={walls} color={color} castShadow receiveShadow textured />
      ))}
    </group>
  );
}

function Roofs() {
  const roofs = useMemo(() => sharedWorld.walls.filter((w) => w.kind === "roof"), []);
  const groups = useMemo(() => {
    const map = new Map<string, typeof roofs>();
    for (const r of roofs) {
      const arr = map.get(r.color) || [];
      arr.push(r);
      map.set(r.color, arr);
    }
    return Array.from(map.entries());
  }, [roofs]);
  return (
    <group>
      {groups.map(([color, items]) => (
        <InstancedBoxes key={color} items={items} color={color} castShadow receiveShadow />
      ))}
    </group>
  );
}

function InstancedBoxes({
  items,
  color,
  castShadow,
  receiveShadow,
  textured = false,
}: {
  items: { pos: THREE.Vector3; size: THREE.Vector3 }[];
  color: string;
  castShadow?: boolean;
  receiveShadow?: boolean;
  textured?: boolean;
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const dummy = new THREE.Object3D();
    items.forEach((it, i) => {
      dummy.position.copy(it.pos);
      dummy.scale.set(it.size.x, it.size.y, it.size.z);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.frustumCulled = false;
    mesh.computeBoundingBox();
    mesh.computeBoundingSphere();
  }, [items]);

  // Realistic layered-concrete PBR set (diffuse + normal + roughness) so walls
  // have genuine surface relief and varying glossiness instead of a flat image.
  const wallPBR = useTiledPBR(wallDiffUrl, wallNorUrl, wallRoughUrl, 2, 1, 8);
  const mat = useMemo(() => {
    if (!textured) {
      return new THREE.MeshStandardMaterial({ color, roughness: 0.85, side: THREE.DoubleSide, transparent: false, depthWrite: true, depthTest: true });
    }
    // Use white base color so the texture is shown at full brightness
    return new THREE.MeshStandardMaterial({
      map: wallPBR.map,
      normalMap: wallPBR.normalMap,
      roughnessMap: wallPBR.roughnessMap,
      normalScale: new THREE.Vector2(1.05, 1.05),
      color: "#ffffff",
      roughness: 1.0,
      metalness: 0.0,
      side: THREE.DoubleSide,
      transparent: false,
      depthWrite: true,
      depthTest: true,
    });
  }, [textured, color, wallPBR]);

  return (
    <instancedMesh
      ref={meshRef}
      args={[undefined, undefined, items.length]}
      castShadow={castShadow}
      receiveShadow={receiveShadow}
      material={mat}
      frustumCulled={false}
    >
      <boxGeometry args={[1, 1, 1]} />
    </instancedMesh>
  );
}

function Crates() {
  const items = sharedWorld.crates;
  const meshRef = useRef<THREE.InstancedMesh>(null);
  // Wooden crate PBR set so ammo boxes read as real timber with grain relief.
  const cratePBR = useTiledPBR(crateDiffUrl, crateNorUrl, crateRoughUrl, 1, 1, 8);
  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    items.forEach((c, i) => {
      dummy.position.copy(c.pos);
      dummy.scale.setScalar(c.size);
      dummy.rotation.set(0, (i % 7) * 0.3, 0);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      color.set(c.color);
      mesh.setColorAt(i, color);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [items]);
  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, items.length]} castShadow receiveShadow>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial
        map={cratePBR.map}
        normalMap={cratePBR.normalMap}
        roughnessMap={cratePBR.roughnessMap}
        normalScale={new THREE.Vector2(0.95, 0.95)}
        color="#ffffff"
        roughness={1.0}
        metalness={0.0}
      />
    </instancedMesh>
  );
}

function Barrels() {
  const items = sharedWorld.barrels;
  const meshRef = useRef<THREE.InstancedMesh>(null);
  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    items.forEach((b, i) => {
      dummy.position.set(b.pos.x, b.pos.y + 0.55, b.pos.z);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      color.set(b.color);
      mesh.setColorAt(i, color);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [items]);
  // Weathered rusty-metal PBR set for the barrel walls (normal + roughness give
  // dents, weld seams and patchy rust their proper shading), the painted-lid
  // texture is reused for the top/bottom caps.
  const drumPBR = useTiledPBR(barrelDiffUrl, barrelNorUrl, barrelRoughUrl, 1.4, 1, 8);
  const drumTop = useLoader(THREE.TextureLoader, drumTopUrl);
  const barrelMat = useMemo(() => {
    const top = drumTop.clone();
    top.colorSpace = THREE.SRGBColorSpace;
    top.needsUpdate = true;
    return [
      new THREE.MeshStandardMaterial({
        map: drumPBR.map,
        normalMap: drumPBR.normalMap,
        roughnessMap: drumPBR.roughnessMap,
        normalScale: new THREE.Vector2(0.6, 0.6),
        color: "#ffffff",
        roughness: 1.0,
        metalness: 0.65,
        side: THREE.DoubleSide,
        transparent: false,
        depthWrite: true,
      }),
      new THREE.MeshStandardMaterial({ map: top, color: "#ffffff", roughness: 0.58, metalness: 0.55, side: THREE.DoubleSide, transparent: false, depthWrite: true }),
      new THREE.MeshStandardMaterial({ map: top, color: "#ffffff", roughness: 0.58, metalness: 0.55, side: THREE.DoubleSide, transparent: false, depthWrite: true }),
    ];
  }, [drumPBR, drumTop]);
  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, items.length]} castShadow receiveShadow material={barrelMat} frustumCulled={false}>
      <cylinderGeometry args={[0.35, 0.35, 1.1, 24]} />
    </instancedMesh>
  );
}

function Sandbags() {
  const items = sharedWorld.sandbags;
  const meshRef = useRef<THREE.InstancedMesh>(null);
  // Sandy-gravel PBR set so sandbags have a gritty, bumpy fabric-of-sand look.
  const bagPBR = useTiledPBR(sandbagDiffUrl, sandbagNorUrl, sandbagRoughUrl, 1, 1, 8);
  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const dummy = new THREE.Object3D();
    items.forEach((it, i) => {
      dummy.position.copy(it.pos);
      dummy.scale.set(it.size.x, it.size.y, it.size.z);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.frustumCulled = false;
    mesh.computeBoundingBox();
    mesh.computeBoundingSphere();
  }, [items]);
  const mat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        map: bagPBR.map,
        normalMap: bagPBR.normalMap,
        roughnessMap: bagPBR.roughnessMap,
        normalScale: new THREE.Vector2(0.9, 0.9),
        color: "#cdb084",
        roughness: 1.0,
        metalness: 0.0,
        side: THREE.DoubleSide,
      }),
    [bagPBR],
  );
  return (
    <instancedMesh
      ref={meshRef}
      args={[undefined, undefined, items.length]}
      castShadow
      receiveShadow
      material={mat}
      frustumCulled={false}
    >
      <boxGeometry args={[1, 1, 1]} />
    </instancedMesh>
  );
}

function Palms() {
  // Shared geometries and materials to massively reduce draw calls
  // Willow-bark PBR set gives the palm trunks deep, realistic bark relief.
  const barkPBR = useTiledPBR(barkDiffUrl, barkNorUrl, barkRoughUrl, 1.4, 2.2, 12);
  const leavesTex = useTiledTexture(treeLeavesUrl, 1.2, 12);
  const trunkMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        map: barkPBR.map,
        normalMap: barkPBR.normalMap,
        roughnessMap: barkPBR.roughnessMap,
        normalScale: new THREE.Vector2(1.0, 1.0),
        color: "#c8a878",
        roughness: 1.0,
        metalness: 0.0,
      }),
    [barkPBR],
  );
  const coconutGeo = useMemo(() => new THREE.SphereGeometry(0.12, 6, 4), []);
  const coconutMat = useMemo(() => new THREE.MeshStandardMaterial({ color: "#3a2818", roughness: 0.8 }), []);
  const stemMat = useMemo(() => new THREE.MeshStandardMaterial({ color: "#3a5a26", roughness: 0.85 }), []);
  const leafMat = useMemo(() => new THREE.MeshStandardMaterial({ map: leavesTex, color: "#ffffff", roughness: 0.85, side: THREE.DoubleSide }), [leavesTex]);
  const trunkGeo = useMemo(() => new THREE.CylinderGeometry(0.75, 1, 1, 8), []);
  const stemGeo = useMemo(() => new THREE.BoxGeometry(0.08, 0.04, 1.9), []);
  const leafGeo = useMemo(() => new THREE.BoxGeometry(1.6, 0.03, 0.6), []);

  return (
    <group>
      {sharedWorld.palms.map((p, i) => {
        return (
          <group key={i} position={p.pos.toArray()}>
            <mesh castShadow position={[0, p.height / 2, 0]} scale={[0.28, p.height, 0.28]} geometry={trunkGeo} material={trunkMat} />
            {/* coconuts */}
            {[0, 1, 2].map((k) => {
              const a = (k / 3) * Math.PI * 2;
              return (
                <mesh key={`c${k}`} position={[Math.cos(a) * 0.18, p.height - 0.2, Math.sin(a) * 0.18]} geometry={coconutGeo} material={coconutMat} />
              );
            })}
            {/* fronds — reduced to 6 */}
            {Array.from({ length: 6 }).map((_, k) => {
              const a = (k / 6) * Math.PI * 2;
              const droop = -0.25 - (k % 2) * 0.15;
              return (
                <group key={`f${k}`} position={[Math.cos(a) * 0.25, p.height + 0.05, Math.sin(a) * 0.25]} rotation={[droop, a, 0]}>
                  <mesh castShadow geometry={stemGeo} material={stemMat} />
                  <mesh position={[0, 0, 0.95]} geometry={leafGeo} material={leafMat} />
                </group>
              );
            })}
          </group>
        );
      })}
    </group>
  );
}

function Tents() {
  return (
    <group>
      {sharedWorld.tents.map((t, i) => (
        <group key={i} position={[t.pos.x, t.pos.y, t.pos.z]} rotation={[0, (i * 0.7) % (Math.PI * 2), 0]}>
          {/* poles */}
          {[
            [-1.2, -1.2],
            [1.2, -1.2],
            [-1.2, 1.2],
            [1.2, 1.2],
          ].map((p, k) => (
            <mesh key={k} position={[p[0], 1.2, p[1]]} castShadow>
              <cylinderGeometry args={[0.06, 0.06, 2.4, 6]} />
              <meshStandardMaterial color="#3a2a1a" />
            </mesh>
          ))}
          {/* canopy (pyramid) */}
          <mesh position={[0, 2.5, 0]} castShadow>
            <coneGeometry args={[2.0, 0.9, 4]} />
            <meshStandardMaterial color={t.color} roughness={0.9} side={THREE.DoubleSide} />
          </mesh>
          {/* hanging cloth drape on one side */}
          <mesh position={[0, 1.7, -1.2]} castShadow>
            <planeGeometry args={[2.4, 1.2]} />
            <meshStandardMaterial color={t.color} roughness={0.95} side={THREE.DoubleSide} />
          </mesh>
          {/* table */}
          <mesh position={[0, 0.9, 0]} castShadow receiveShadow>
            <boxGeometry args={[2.0, 0.08, 1.4]} />
            <meshStandardMaterial color="#6b4a2b" roughness={0.9} />
          </mesh>
          {/* fruit/baskets on table */}
          {[
            [-0.6, 0],
            [0, 0],
            [0.6, 0],
          ].map((p, k) => (
            <group key={`g${k}`} position={[p[0], 1.05, p[1]]}>
              <mesh castShadow>
                <cylinderGeometry args={[0.22, 0.18, 0.18, 10]} />
                <meshStandardMaterial color="#7a5028" roughness={0.95} />
              </mesh>
              {/* fruit pile */}
              {[0, 1, 2, 3].map((j) => (
                <mesh key={j} position={[(j % 2 - 0.5) * 0.1, 0.16 + (j > 1 ? 0.07 : 0), (j > 1 ? 0 : 0.06)]} castShadow>
                  <sphereGeometry args={[0.07, 8, 6]} />
                  <meshStandardMaterial
                    color={["#c84028", "#d8a020", "#7a4a20", "#a06030"][k % 4]}
                    roughness={0.7}
                  />
                </mesh>
              ))}
            </group>
          ))}
        </group>
      ))}
    </group>
  );
}

function Lamps() {
  // Shared geometries and materials to reduce draw calls
  const poleGeo = useMemo(() => new THREE.CylinderGeometry(0.06, 0.08, 3.2, 6), []);
  const poleMat = useMemo(() => new THREE.MeshStandardMaterial({ color: "#2a2a30", metalness: 0.6, roughness: 0.5 }), []);
  const bulbGeo = useMemo(() => new THREE.SphereGeometry(0.18, 8, 6), []);
  const bulbMat = useMemo(() => new THREE.MeshStandardMaterial({ color: "#fff0b0", emissive: "#ffd070", emissiveIntensity: 0.9 }), []);
  return (
    <group>
      {sharedWorld.lamps.map((l, i) => (
        <group key={i} position={[l.pos.x, l.pos.y, l.pos.z]}>
          <mesh position={[0, 1.6, 0]} castShadow geometry={poleGeo} material={poleMat} />
          <mesh position={[0, 3.2, 0]} geometry={bulbGeo} material={bulbMat} />
        </group>
      ))}
    </group>
  );
}

function Fountain() {
  const fp = sharedWorld.fountainPos;
  return (
    <group position={[fp.x, 0, fp.z]}>
      <mesh position={[0, 0.3, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[4, 4.2, 0.6, 24]} />
        <meshStandardMaterial color="#7a6040" roughness={0.9} />
      </mesh>
      <mesh position={[0, 0.7, 0]}>
        <cylinderGeometry args={[3.6, 3.6, 0.1, 24]} />
        <meshStandardMaterial color="#3a6a90" roughness={0.2} metalness={0.1} />
      </mesh>
      <mesh position={[0, 1.4, 0]} castShadow>
        <cylinderGeometry args={[0.4, 0.6, 1.4, 12]} />
        <meshStandardMaterial color="#a8895a" roughness={0.9} />
      </mesh>
      <mesh position={[0, 2.3, 0]}>
        <sphereGeometry args={[0.4, 14, 14]} />
        <meshStandardMaterial color="#9ac8e8" emissive="#5a90b0" emissiveIntensity={0.3} />
      </mesh>
    </group>
  );
}

function DistantHills() {
  const hills = useMemo(() => {
    const arr: { x: number; z: number; r: number; h: number }[] = [];
    const count = 40;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + Math.random() * 0.1;
      const dist = WORLD_SIZE / 2 + 60 + Math.random() * 60;
      arr.push({
        x: Math.cos(a) * dist,
        z: Math.sin(a) * dist,
        r: 30 + Math.random() * 40,
        h: 12 + Math.random() * 18,
      });
    }
    return arr;
  }, []);
  return (
    <group>
      {hills.map((h, i) => (
        <mesh key={i} position={[h.x, h.h / 2 - 2, h.z]}>
          <sphereGeometry args={[h.r, 12, 8]} />
          <meshStandardMaterial color="#b89060" roughness={1} />
        </mesh>
      ))}
    </group>
  );
}

function Awnings() {
  return (
    <group>
      {sharedWorld.awnings.map((a, i) => (
        <group key={i} position={a.pos.toArray()}>
          <mesh castShadow>
            <boxGeometry args={[a.size.x, a.size.y, a.size.z]} />
            <meshStandardMaterial color={a.color} roughness={0.85} side={THREE.DoubleSide} />
          </mesh>
          {/* support poles */}
          <mesh position={[a.size.x / 2 - 0.05, -1.3, a.size.z / 2 - 0.05]} castShadow>
            <cylinderGeometry args={[0.04, 0.04, 2.6, 6]} />
            <meshStandardMaterial color="#1a1410" />
          </mesh>
          <mesh position={[-(a.size.x / 2 - 0.05), -1.3, a.size.z / 2 - 0.05]} castShadow>
            <cylinderGeometry args={[0.04, 0.04, 2.6, 6]} />
            <meshStandardMaterial color="#1a1410" />
          </mesh>
        </group>
      ))}
    </group>
  );
}

// Helper: instanced window glass/frame panes. With the much denser city this
// now renders tens of thousands of windows, so each layer (lit glass, dark
// glass, frame) is a single InstancedMesh instead of thousands of meshes.
function InstancedWindowPanes({
  items,
  material,
  inset,
  depthScale,
}: {
  items: typeof sharedWorld.windows;
  material: THREE.Material;
  inset: number; // scale factor applied to the pane (1 = full frame size)
  depthScale?: number; // z scale factor (glass slightly proud to avoid z-fight)
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const dummy = new THREE.Object3D();
    const dz = depthScale ?? 1;
    items.forEach((w, i) => {
      dummy.position.copy(w.pos);
      dummy.scale.set(
        w.size.x * inset,
        w.size.y * inset,
        Math.max(w.size.z, 0.04) * dz,
      );
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.frustumCulled = false;
    mesh.computeBoundingBox();
    mesh.computeBoundingSphere();
  }, [items, inset, depthScale]);
  return (
    <instancedMesh
      ref={meshRef}
      args={[undefined, undefined, Math.max(items.length, 1)]}
      material={material}
      frustumCulled={false}
    >
      <boxGeometry args={[1, 1, 1]} />
    </instancedMesh>
  );
}

function Windows() {
  // Two materials: lit (emissive warm) and dark glass
  const litMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: "#ffce6a",
        emissive: "#ffae40",
        emissiveIntensity: 0.6,
        roughness: 0.4,
      }),
    [],
  );
  const darkMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: "#1a2230",
        emissive: "#0a1018",
        emissiveIntensity: 0.2,
        roughness: 0.3,
        metalness: 0.4,
      }),
    [],
  );
  const frameMat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: "#3a2818", roughness: 0.8 }),
    [],
  );

  // Split windows into lit / dark so each glass colour is one instanced draw.
  const { lit, dark } = useMemo(() => {
    const lit: typeof sharedWorld.windows = [];
    const dark: typeof sharedWorld.windows = [];
    for (const w of sharedWorld.windows) (w.lit ? lit : dark).push(w);
    return { lit, dark };
  }, []);

  return (
    <group>
      {/* Window frames (one draw call for every window). */}
      <InstancedWindowPanes items={sharedWorld.windows} material={frameMat} inset={1} />
      {/* Lit glass panes (inset inside the frame, slightly proud to avoid z-fight). */}
      <InstancedWindowPanes items={lit} material={litMat} inset={0.82} depthScale={1.4} />
      {/* Dark glass panes. */}
      <InstancedWindowPanes items={dark} material={darkMat} inset={0.82} depthScale={1.4} />
    </group>
  );
}

function Rugs() {
  return (
    <group>
      {sharedWorld.rugs.map((r, i) => (
        <mesh
          key={i}
          position={[r.pos.x, r.pos.y, r.pos.z]}
          rotation={[-Math.PI / 2, 0, r.rot]}
          receiveShadow
        >
          <planeGeometry args={[r.size.x, r.size.z]} />
          <meshStandardMaterial color={r.color} roughness={1} />
        </mesh>
      ))}
    </group>
  );
}

function Pickups() {
  const ref = useRef<THREE.Group>(null);
  useFrame(() => {
    const g = ref.current;
    if (!g) return;
    const list = store.state.pickups.filter((p) => !p.taken);
    const ids = new Set(list.map((p) => p.id));
    for (let i = g.children.length - 1; i >= 0; i--) {
      const c = g.children[i] as any;
      if (!ids.has(c.userData.id)) g.remove(c);
    }
    for (const pk of list) {
      let m = g.children.find((c: any) => c.userData.id === pk.id) as THREE.Group | undefined;
      if (!m) {
        m = new THREE.Group();
        m.userData.id = pk.id;
        let color = "#ffd56b";
        let geo: THREE.BufferGeometry;
        if (pk.kind === "weapon") {
          color = "#ffaa20";
          geo = new THREE.BoxGeometry(0.7, 0.12, 0.18);
        } else if (pk.kind === "ammo") {
          color = "#c8c020";
          geo = new THREE.BoxGeometry(0.4, 0.25, 0.3);
        } else if (pk.kind === "health") {
          color = "#20d030";
          geo = new THREE.BoxGeometry(0.35, 0.35, 0.35);
        } else {
          color = "#3a5020";
          geo = new THREE.SphereGeometry(0.18, 10, 10);
        }
        const mesh = new THREE.Mesh(
          geo,
          new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.6, roughness: 0.4 }),
        );
        mesh.castShadow = true;
        m.add(mesh);
        g.add(m);
      }
      m.position.set(pk.pos.x, pk.pos.y + Math.sin(performance.now() / 500 + pk.id) * 0.1, pk.pos.z);
      m.rotation.y = performance.now() / 1000;
    }
  });
  return <group ref={ref} />;
}

// Soldiers (both teams)
function Soldiers() {
  const ref = useRef<THREE.Group>(null);
  useFrame(() => {
    const g = ref.current;
    if (!g) return;
    const ids = new Set(store.state.soldiers.map((e) => e.id));
    for (let i = g.children.length - 1; i >= 0; i--) {
      const c = g.children[i] as any;
      if (!ids.has(c.userData.id)) g.remove(c);
    }
    for (const e of store.state.soldiers) {
      let mesh = g.children.find((c: any) => c.userData.id === e.id) as THREE.Group | undefined;
      if (!mesh) {
        mesh = buildSoldierMesh(e.team);
        mesh.userData.id = e.id;
        g.add(mesh);
      }

      // ---- Locomotion animation ----
      // moveSpeedNorm: 0 idle, ~1 walk, ~1.5+ sprint. Drive a sinusoidal gait:
      // swing legs at the hip, counter-swing the arms a touch, and add a small
      // vertical bob whose frequency matches the (doubled) stride.
      const anim = (mesh.userData as any).anim;
      const spd = e.moveSpeedNorm ?? 0;
      const phase = e.animPhase ?? 0;
      let bob = 0;
      if (anim) {
        const moving = spd > 0.06;
        // Leg swing amplitude grows with speed (bigger strides when running).
        const legAmp = moving ? Math.min(0.95, 0.35 + spd * 0.5) : 0;
        const swing = Math.sin(phase) * legAmp;
        anim.legL.rotation.x = swing;
        anim.legR.rotation.x = -swing;
        // Subtle arm counter-swing so the upper body reads as running, not gliding.
        const armAmp = moving ? Math.min(0.35, 0.08 + spd * 0.16) : 0;
        anim.armL.rotation.x = anim.armLBaseX - Math.sin(phase) * armAmp;
        anim.armR.rotation.x = anim.armRBaseX + Math.sin(phase) * armAmp;
        // Vertical bob (twice the stride frequency since |sin| has half period).
        bob = moving ? Math.abs(Math.sin(phase)) * Math.min(0.12, 0.04 + spd * 0.06) : 0;
        anim.torso.position.y = anim.torsoBaseY;
      }

      mesh.position.set(e.pos.x, e.pos.y - 0.9 + bob, e.pos.z);
      mesh.rotation.y = e.yaw;
      mesh.renderOrder = 0;
      mesh.traverse((o: any) => {
        if (o.material && o.material.transparent) {
          o.material.transparent = false;
          o.material.depthWrite = true;
          o.material.opacity = 1;
        }
      });
    }
  });
  return <group ref={ref} />;
}

function buildSoldierMesh(team: "blue" | "red") {
  const mesh = new THREE.Group();
  const isRed = team === "red";
  const accent = isRed ? "#b02828" : "#2050b8";
  const accentEm = isRed ? "#3a0606" : "#04144a";
  const helmetCol = isRed ? "#7a3a28" : "#3a4a6a";
  const visorCol = isRed ? "#ff4040" : "#40b0ff";
  const skin = "#c89a72";
  const uniform = isRed ? "#5a3a2a" : "#3a4a3a"; // desert tan vs olive drab
  const uniformDark = isRed ? "#3a261a" : "#252e22";
  const boot = "#1a1410";
  const glove = "#2a1f18";

  // Slightly tuned PBR values give skin a soft sheen, cloth a matte look and
  // gear a believable hard-surface response — more lifelike soldiers at no
  // geometry/texture cost.
  const matSkin = new THREE.MeshStandardMaterial({ color: skin, roughness: 0.62, metalness: 0.0 });
  const matUniform = new THREE.MeshStandardMaterial({ color: uniform, roughness: 0.92 });
  const matUniformDark = new THREE.MeshStandardMaterial({ color: uniformDark, roughness: 0.96 });
  const matBoot = new THREE.MeshStandardMaterial({ color: boot, roughness: 0.55, metalness: 0.1 });
  const matGlove = new THREE.MeshStandardMaterial({ color: glove, roughness: 0.88 });
  const matVest = new THREE.MeshStandardMaterial({
    color: accent,
    roughness: 0.5,
    metalness: 0.15,
    emissive: accentEm,
    emissiveIntensity: 0.35,
  });
  const matHelm = new THREE.MeshStandardMaterial({ color: helmetCol, roughness: 0.42, metalness: 0.2 });
  const matMetal = new THREE.MeshStandardMaterial({ color: "#15151a", metalness: 0.6, roughness: 0.4 });

  // ===== Hips/Pelvis =====
  const pelvis = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.22, 0.32), matUniformDark);
  pelvis.position.y = -0.95;
  pelvis.castShadow = true;
  mesh.add(pelvis);

  // ===== Legs (separated, hip-pivoted for a walk/run cycle) =====
  // Each leg is built inside a pivot group anchored at the hip (y ≈ -1.05) so
  // rotating the group swings the whole leg + knee + boot about the hip joint.
  const HIP_Y = -1.05;
  const legGeo = new THREE.CylinderGeometry(0.11, 0.1, 0.7, 10);
  const kneeGeo = new THREE.SphereGeometry(0.11, 10, 8);
  const bootGeo = new THREE.BoxGeometry(0.16, 0.13, 0.28);

  const makeLeg = (side: number) => {
    const pivot = new THREE.Group();
    pivot.position.set(0.12 * side, HIP_Y, 0);
    const leg = new THREE.Mesh(legGeo, matUniform);
    leg.position.set(0, -0.35, 0); // top of the thigh at the hip pivot
    leg.castShadow = true;
    pivot.add(leg);
    const knee = new THREE.Mesh(kneeGeo, matUniformDark);
    knee.position.set(0, -0.35, 0.06);
    knee.scale.set(1, 0.5, 1);
    pivot.add(knee);
    const boot = new THREE.Mesh(bootGeo, matBoot);
    boot.position.set(0, -0.77, 0.04);
    boot.castShadow = true;
    pivot.add(boot);
    mesh.add(pivot);
    return pivot;
  };
  const legPivotL = makeLeg(-1);
  const legPivotR = makeLeg(1);

  // ===== Torso =====
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.65, 0.3), matUniform);
  torso.position.y = -0.5;
  torso.castShadow = true;
  mesh.add(torso);

  // Tactical vest (chest plate)
  const vestPlate = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.5, 0.34), matVest);
  vestPlate.position.set(0, -0.45, 0);
  vestPlate.castShadow = true;
  mesh.add(vestPlate);

  // Mag pouches on vest
  for (const px of [-0.13, 0, 0.13]) {
    const pouch = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.13, 0.06), matUniformDark);
    pouch.position.set(px, -0.62, 0.18);
    mesh.add(pouch);
  }
  // Team identifier patch on shoulder
  const patch = new THREE.Mesh(
    new THREE.BoxGeometry(0.08, 0.08, 0.02),
    new THREE.MeshBasicMaterial({ color: isRed ? "#ff4040" : "#40a0ff" }),
  );
  patch.position.set(-0.22, -0.3, 0.06);
  mesh.add(patch);

  // ===== Arms =====
  // Upper arms angled forward to hold rifle
  const upperArmGeo = new THREE.CylinderGeometry(0.07, 0.07, 0.42, 10);
  const upperL = new THREE.Mesh(upperArmGeo, matUniform);
  upperL.position.set(-0.3, -0.45, 0.05);
  upperL.rotation.x = -0.4;
  upperL.castShadow = true;
  mesh.add(upperL);
  const upperR = new THREE.Mesh(upperArmGeo, matUniform);
  upperR.position.set(0.3, -0.45, 0.05);
  upperR.rotation.x = -0.4;
  upperR.castShadow = true;
  mesh.add(upperR);

  // Forearms
  const forearmGeo = new THREE.CylinderGeometry(0.06, 0.07, 0.4, 10);
  const fArmL = new THREE.Mesh(forearmGeo, matUniform);
  fArmL.position.set(-0.18, -0.7, -0.22);
  fArmL.rotation.x = -1.0;
  mesh.add(fArmL);
  const fArmR = new THREE.Mesh(forearmGeo, matUniform);
  fArmR.position.set(0.18, -0.7, -0.22);
  fArmR.rotation.x = -1.0;
  mesh.add(fArmR);

  // Gloves (hands)
  const handGeo = new THREE.BoxGeometry(0.1, 0.1, 0.12);
  const handL = new THREE.Mesh(handGeo, matGlove);
  handL.position.set(-0.16, -0.85, -0.42);
  mesh.add(handL);
  const handR = new THREE.Mesh(handGeo, matGlove);
  handR.position.set(0.16, -0.85, -0.42);
  mesh.add(handR);

  // ===== Neck =====
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.1, 10), matSkin);
  neck.position.y = -0.1;
  mesh.add(neck);

  // ===== Head =====
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 14), matSkin);
  head.position.y = 0.08;
  head.scale.set(1, 1.1, 1.05);
  head.castShadow = true;
  mesh.add(head);

  // Eyes
  const eyeGeo = new THREE.SphereGeometry(0.018, 6, 6);
  const eyeMat = new THREE.MeshBasicMaterial({ color: "#1a1a1a" });
  const eyeL = new THREE.Mesh(eyeGeo, eyeMat);
  eyeL.position.set(-0.05, 0.1, 0.14);
  mesh.add(eyeL);
  const eyeR = new THREE.Mesh(eyeGeo, eyeMat);
  eyeR.position.set(0.05, 0.1, 0.14);
  mesh.add(eyeR);

  // ===== Helmet =====
  const helm = new THREE.Mesh(
    new THREE.SphereGeometry(0.21, 16, 12, 0, Math.PI * 2, 0, Math.PI / 1.7),
    matHelm,
  );
  helm.position.y = 0.14;
  helm.castShadow = true;
  mesh.add(helm);

  // Helmet rim
  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(0.2, 0.018, 6, 20),
    new THREE.MeshStandardMaterial({ color: "#1a1a1a", roughness: 0.7 }),
  );
  rim.position.y = 0.06;
  rim.rotation.x = Math.PI / 2;
  mesh.add(rim);

  // Chin strap
  const strap = new THREE.Mesh(
    new THREE.TorusGeometry(0.15, 0.012, 6, 16, Math.PI),
    new THREE.MeshStandardMaterial({ color: "#1a1410" }),
  );
  strap.position.y = 0.02;
  strap.rotation.x = -Math.PI / 2;
  mesh.add(strap);

  // Visor stripe (team color)
  const vis = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.025, 0.04), new THREE.MeshBasicMaterial({ color: visorCol }));
  vis.position.set(0, 0.18, 0.18);
  mesh.add(vis);

  // NVG mount (small bump on front of helmet)
  const nvg = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.05, 0.06), matMetal);
  nvg.position.set(0, 0.22, 0.16);
  mesh.add(nvg);

  // ===== Rifle held in two hands =====
  const rifleGroup = new THREE.Group();
  rifleGroup.position.set(0, -0.78, -0.45);

  const rifleBody = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.12, 0.85), matMetal);
  rifleGroup.add(rifleBody);

  const rifleMag = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.18, 0.1), matMetal);
  rifleMag.position.set(0, -0.13, -0.05);
  rifleGroup.add(rifleMag);

  const rifleStock = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.1, 0.22), matMetal);
  rifleStock.position.set(0, 0, 0.45);
  rifleGroup.add(rifleStock);

  const rifleScope = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.18, 10), matMetal);
  rifleScope.rotation.x = Math.PI / 2;
  rifleScope.position.set(0, 0.09, 0);
  rifleGroup.add(rifleScope);

  // foregrip
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.1, 0.06), matMetal);
  grip.position.set(0, -0.1, -0.2);
  rifleGroup.add(grip);

  mesh.add(rifleGroup);

  // Expose the parts the animation loop drives each frame, plus the resting
  // positions it offsets from.
  mesh.userData.anim = {
    legL: legPivotL,
    legR: legPivotR,
    armL: upperL,
    armR: upperR,
    torso,
    baseLegLZ: 0,
    armLBaseX: upperL.rotation.x,
    armRBaseX: upperR.rotation.x,
    torsoBaseY: torso.position.y,
  };

  return mesh;
}

function Grenades() {
  const ref = useRef<THREE.Group>(null);
  useFrame(() => {
    const g = ref.current;
    if (!g) return;
    const ids = new Set(store.state.grenades.map((x) => x.id));
    for (let i = g.children.length - 1; i >= 0; i--) {
      const c = g.children[i] as any;
      if (!ids.has(c.userData.id)) g.remove(c);
    }
    for (const gr of store.state.grenades) {
      let m = g.children.find((c: any) => c.userData.id === gr.id) as THREE.Mesh | undefined;
      if (!m) {
        m = new THREE.Mesh(
          new THREE.SphereGeometry(0.18, 10, 10),
          new THREE.MeshStandardMaterial({ color: "#2b3018", roughness: 0.5 }),
        );
        m.castShadow = true;
        m.userData.id = gr.id;
        g.add(m);
      }
      m.position.copy(gr.pos);
      const intensity = gr.fuse < 1 ? Math.sin(performance.now() / 60) * 0.5 + 0.5 : 0;
      (m.material as THREE.MeshStandardMaterial).emissive = new THREE.Color(
        intensity * 0.9,
        intensity * 0.15,
        0,
      );
    }
  });
  return <group ref={ref} />;
}

function Explosions() {
  const ref = useRef<THREE.Group>(null);
  useFrame(() => {
    const g = ref.current;
    if (!g) return;
    g.renderOrder = 100;
    while (g.children.length < store.state.explosions.length) {
      const m = new THREE.Mesh(
        new THREE.SphereGeometry(1, 16, 16),
        new THREE.MeshBasicMaterial({ color: "#ffaa44", transparent: true, opacity: 0.9, depthWrite: false }),
      );
      m.renderOrder = 100;
      g.add(m);
    }
    while (g.children.length > store.state.explosions.length) {
      g.remove(g.children[g.children.length - 1]);
    }
    store.state.explosions.forEach((e, i) => {
      const m = g.children[i] as THREE.Mesh;
      const t = e.age / e.ttl;
      const r = 0.5 + t * 6;
      m.scale.setScalar(r);
      m.position.copy(e.pos);
      const mat = m.material as THREE.MeshBasicMaterial;
      mat.opacity = (1 - t) * 0.85;
      mat.color = new THREE.Color().lerpColors(
        new THREE.Color("#ffe18a"),
        new THREE.Color("#ff3a14"),
        t,
      );
    });
  });
  return <group ref={ref} />;
}

function Hits() {
  const ref = useRef<THREE.Group>(null);
  useFrame(() => {
    const g = ref.current;
    if (!g) return;
    while (g.children.length < store.state.hits.length) {
      const m = new THREE.Mesh(
        new THREE.SphereGeometry(0.06, 6, 6),
        new THREE.MeshBasicMaterial({ color: "#ffd56b" }),
      );
      g.add(m);
    }
    while (g.children.length > store.state.hits.length) {
      g.remove(g.children[g.children.length - 1]);
    }
    store.state.hits.forEach((h, i) => {
      const m = g.children[i] as THREE.Mesh;
      m.position.copy(h.point);
      const mat = m.material as THREE.MeshBasicMaterial;
      (mat as any).transparent = true;
      mat.opacity = Math.min(1, h.ttl / 0.5);
      m.visible = !h.enemyId;
    });
  });
  return <group ref={ref} />;
}

function MuzzleFlashes() {
  const ref = useRef<THREE.Group>(null);
  useFrame(() => {
    const g = ref.current;
    if (!g) return;
    while (g.children.length < store.state.flashes.length) {
      const m = new THREE.Mesh(
        new THREE.SphereGeometry(0.15, 8, 8),
        new THREE.MeshBasicMaterial({ color: "#ffd27a", transparent: true, depthWrite: false }),
      );
      m.renderOrder = 100;
      g.add(m);
    }
    while (g.children.length > store.state.flashes.length) {
      g.remove(g.children[g.children.length - 1]);
    }
    store.state.flashes.forEach((f, i) => {
      const m = g.children[i] as THREE.Mesh;
      m.position.copy(f.pos);
      m.scale.setScalar(0.7 + Math.random() * 0.6);
      const mat = m.material as THREE.MeshBasicMaterial;
      mat.color = new THREE.Color(f.color);
      mat.opacity = Math.min(1, f.ttl / 0.06);
    });
  });
  return <group ref={ref} />;
}

// === SMOKE CLOUDS ===
function SmokeCloudsScene() {
  const ref = useRef<THREE.Group>(null);
  useFrame(() => {
    const g = ref.current;
    if (!g) return;
    const clouds = store.state.smokeClouds;
    // Remove old meshes
    while (g.children.length > clouds.length) g.remove(g.children[g.children.length - 1]);
    // Add/update
    for (let i = 0; i < clouds.length; i++) {
      const sc = clouds[i];
      let mesh = g.children[i] as THREE.Mesh | undefined;
      if (!mesh) {
        const geo = new THREE.SphereGeometry(1, 16, 12);
        const mat = new THREE.MeshStandardMaterial({
          color: "#cccccc",
          transparent: true,
          opacity: 0.6,
          roughness: 1,
          depthWrite: false,
          depthTest: true,
        });
        mesh = new THREE.Mesh(geo, mat);
        mesh.renderOrder = 50;
        g.add(mesh);
      }
      const fadeIn = Math.min(1, sc.age / 1.5);
      const fadeOut = Math.max(0, 1 - (sc.age - sc.ttl + 2) / 2);
      const opacity = Math.min(fadeIn, fadeOut) * 0.55;
      const scale = sc.radius * fadeIn;
      mesh.position.set(sc.pos.x, 2.5, sc.pos.z);
      mesh.scale.set(scale, scale * 0.5, scale);
      (mesh.material as THREE.MeshStandardMaterial).opacity = opacity;
    }
  });
  return <group ref={ref} />;
}

// === DESTRUCTIBLES ===
function DestructiblesScene() {
  const ref = useRef<THREE.Group>(null);
  useFrame(() => {
    const g = ref.current;
    if (!g) return;
    const dList = store.state.destructibles.filter(d => !d.destroyed);
    // Rebuild if count changed
    if (g.children.length !== dList.length) {
      while (g.children.length > 0) g.remove(g.children[0]);
      for (const d of dList) {
        let geo: THREE.BufferGeometry;
        if (d.kind === "barrel") {
          geo = new THREE.CylinderGeometry(d.size.x / 2, d.size.x / 2, d.size.y, 12);
        } else {
          geo = new THREE.BoxGeometry(d.size.x, d.size.y, d.size.z);
        }
        const hpRatio = d.hp / d.hpMax;
        const mat = new THREE.MeshStandardMaterial({
          color: d.color,
          roughness: 0.8,
          emissive: hpRatio < 0.5 ? "#ff4400" : "#000000",
          emissiveIntensity: hpRatio < 0.5 ? (1 - hpRatio) * 0.3 : 0,
        });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.copy(d.pos);
        mesh.castShadow = true;
        mesh.userData.id = d.id;
        g.add(mesh);
      }
    }
    // Update HP visual
    for (const child of g.children) {
      const d = dList.find(x => x.id === (child as any).userData.id);
      if (d) {
        const hpRatio = d.hp / d.hpMax;
        const mat = (child as THREE.Mesh).material as THREE.MeshStandardMaterial;
        mat.emissive.set(hpRatio < 0.5 ? "#ff4400" : "#000000");
        mat.emissiveIntensity = hpRatio < 0.5 ? (1 - hpRatio) * 0.3 : 0;
      }
    }
  });
  return <group ref={ref} />;
}

// === RAGDOLLS ===
function RagdollsScene() {
  const ref = useRef<THREE.Group>(null);
  useFrame(() => {
    const g = ref.current;
    if (!g) return;
    const parts = store.state.ragdolls;
    while (g.children.length > parts.length) g.remove(g.children[g.children.length - 1]);
    for (let i = 0; i < parts.length; i++) {
      const r = parts[i];
      let mesh = g.children[i] as THREE.Mesh | undefined;
      if (!mesh) {
        const geo = new THREE.BoxGeometry(1, 1, 1);
        const mat = new THREE.MeshStandardMaterial({ color: r.color, roughness: 0.8, transparent: true, depthWrite: false });
        mesh = new THREE.Mesh(geo, mat);
        mesh.castShadow = true;
        mesh.renderOrder = 10;
        g.add(mesh);
      }
      mesh.position.copy(r.pos);
      mesh.scale.set(r.size.x, r.size.y, r.size.z);
      mesh.rotation.copy(r.rot);
      const mat = mesh.material as THREE.MeshStandardMaterial;
      mat.color.set(r.color);
      mat.opacity = Math.min(1, r.ttl * 2);
    }
  });
  return <group ref={ref} />;
}

// === BULLET TRAILS ===
function BulletTrails() {
  const ref = useRef<THREE.Group>(null);
  useFrame(() => {
    const g = ref.current;
    if (!g) return;
    const trails = store.state.trails;
    while (g.children.length > trails.length) g.remove(g.children[g.children.length - 1]);
    for (let i = 0; i < trails.length; i++) {
      const t = trails[i];
      let line = g.children[i] as THREE.Line | undefined;
      if (!line) {
        const geo = new THREE.BufferGeometry();
        const positions = new Float32Array(6);
        geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        const mat = new THREE.LineBasicMaterial({ color: '#ffd27a', transparent: true, opacity: 0.6, linewidth: 1, depthWrite: false });
        line = new THREE.Line(geo, mat);
        line.renderOrder = 90;
        g.add(line);
      }
      const posAttr = line.geometry.getAttribute('position') as THREE.BufferAttribute;
      posAttr.setXYZ(0, t.from.x, t.from.y, t.from.z);
      posAttr.setXYZ(1, t.to.x, t.to.y, t.to.z);
      posAttr.needsUpdate = true;
      const mat = line.material as THREE.LineBasicMaterial;
      mat.color.set(t.color);
      mat.opacity = Math.min(0.7, t.ttl * 5);
    }
  });
  return <group ref={ref} />;
}

// === VEHICLES ===
function buildJeepMesh(mesh: THREE.Group) {
  // Body
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(2.2, 0.8, 3.6),
    new THREE.MeshStandardMaterial({ color: '#4a6a3a', roughness: 0.7 }),
  );
  body.position.y = 0.4;
  body.castShadow = true;
  mesh.add(body);
  // Cabin
  const cabin = new THREE.Mesh(
    new THREE.BoxGeometry(1.8, 0.7, 1.6),
    new THREE.MeshStandardMaterial({ color: '#3a5a2a', roughness: 0.6 }),
  );
  cabin.position.set(0, 1.15, -0.3);
  cabin.castShadow = true;
  mesh.add(cabin);
  // Wheels
  const wheelGeo = new THREE.CylinderGeometry(0.35, 0.35, 0.2, 12);
  const wheelMat = new THREE.MeshStandardMaterial({ color: '#1a1a1a', roughness: 0.9 });
  for (const [wx, wz] of [[-1.2, 1.2], [1.2, 1.2], [-1.2, -1.2], [1.2, -1.2]]) {
    const wheel = new THREE.Mesh(wheelGeo, wheelMat);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(wx, 0.05, wz);
    mesh.add(wheel);
  }
}

function buildTankMesh(mesh: THREE.Group) {
  const hullMat = new THREE.MeshStandardMaterial({ color: '#46502f', roughness: 0.85, metalness: 0.2 });
  const darkMat = new THREE.MeshStandardMaterial({ color: '#2a2a26', roughness: 0.95 });
  const barrelMat = new THREE.MeshStandardMaterial({ color: '#3a4028', roughness: 0.7, metalness: 0.3 });

  // Lower hull
  const hull = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.9, 4.8), hullMat);
  hull.position.y = 0.7;
  hull.castShadow = true;
  mesh.add(hull);

  // Upper sloped deck
  const deck = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.5, 3.6), hullMat);
  deck.position.y = 1.3;
  deck.castShadow = true;
  mesh.add(deck);

  // Tracks (left/right)
  const trackGeo = new THREE.BoxGeometry(0.7, 0.7, 5.0);
  for (const tx of [-1.45, 1.45]) {
    const track = new THREE.Mesh(trackGeo, darkMat);
    track.position.set(tx, 0.45, 0);
    track.castShadow = true;
    mesh.add(track);
  }
  // Road wheels for a bit of detail
  const rwGeo = new THREE.CylinderGeometry(0.32, 0.32, 0.2, 10);
  for (const tx of [-1.45, 1.45]) {
    for (const tz of [-1.6, -0.55, 0.55, 1.6]) {
      const rw = new THREE.Mesh(rwGeo, darkMat);
      rw.rotation.z = Math.PI / 2;
      rw.position.set(tx, 0.4, tz);
      mesh.add(rw);
    }
  }

  // Turret
  const turret = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.15, 0.7, 12), hullMat);
  turret.position.set(0, 1.85, -0.2);
  turret.castShadow = true;
  mesh.add(turret);

  // Cannon barrel (points forward, -z)
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.18, 3.4, 12), barrelMat);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 1.9, -2.0);
  barrel.castShadow = true;
  mesh.add(barrel);

  // Commander hatch
  const hatch = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.25, 10), darkMat);
  hatch.position.set(0, 2.25, -0.1);
  mesh.add(hatch);
}

// --- Military vehicle body builders (shared by the drivable motor pool) -----
function buildApc(mesh: THREE.Group, color: string) {
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.88, metalness: 0.2 });
  const darkMat = new THREE.MeshStandardMaterial({ color: '#1c1c1a', roughness: 0.95 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.6, 5.2), mat); body.position.y = 1.3; body.castShadow = true; mesh.add(body);
  // sloped front
  const nose = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.9, 1.4), mat); nose.position.set(0, 0.9, -2.2); nose.castShadow = true; mesh.add(nose);
  const cupola = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.7, 1.2), mat); cupola.position.set(0, 2.4, -0.4); cupola.castShadow = true; mesh.add(cupola);
  const wheelGeo = new THREE.CylinderGeometry(0.55, 0.55, 0.4, 12);
  for (const wz of [-1.8, -0.6, 0.6, 1.8]) for (const wx of [-1.35, 1.35]) {
    const w = new THREE.Mesh(wheelGeo, darkMat); w.rotation.z = Math.PI / 2; w.position.set(wx, 0.55, wz); mesh.add(w);
  }
}

function buildTruck(mesh: THREE.Group, color: string) {
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.2 });
  const canvasMat = new THREE.MeshStandardMaterial({ color: '#6f6a4a', roughness: 0.95 });
  const darkMat = new THREE.MeshStandardMaterial({ color: '#1c1c1a', roughness: 0.95 });
  const cab = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.8, 2.0), mat); cab.position.set(0, 1.4, -2.4); cab.castShadow = true; mesh.add(cab);
  const bed = new THREE.Mesh(new THREE.BoxGeometry(2.6, 2.0, 4.4), canvasMat); bed.position.set(0, 1.8, 0.9); bed.castShadow = true; mesh.add(bed);
  const chassis = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.5, 6.6), mat); chassis.position.y = 0.7; mesh.add(chassis);
  const wheelGeo = new THREE.CylinderGeometry(0.6, 0.6, 0.45, 12);
  for (const wz of [-2.6, 0.0, 1.4, 2.6]) for (const wx of [-1.25, 1.25]) {
    const w = new THREE.Mesh(wheelGeo, darkMat); w.rotation.z = Math.PI / 2; w.position.set(wx, 0.6, wz); mesh.add(w);
  }
}

function buildHumvee(mesh: THREE.Group, color: string) {
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.2 });
  const darkMat = new THREE.MeshStandardMaterial({ color: '#1c1c1a', roughness: 0.95 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.1, 4.4), mat); body.position.y = 1.0; body.castShadow = true; mesh.add(body);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.9, 2.2), mat); cabin.position.set(0, 1.85, -0.2); cabin.castShadow = true; mesh.add(cabin);
  const wheelGeo = new THREE.CylinderGeometry(0.55, 0.55, 0.45, 12);
  for (const [wx, wz] of [[-1.2, 1.5], [1.2, 1.5], [-1.2, -1.5], [1.2, -1.5]]) {
    const w = new THREE.Mesh(wheelGeo, darkMat); w.rotation.z = Math.PI / 2; w.position.set(wx, 0.55, wz); mesh.add(w);
  }
}

function Containers() {
  const items = sharedWorld.containers;
  const meshRef = useRef<THREE.InstancedMesh>(null);
  // Reuse the rusty-metal PBR set so containers read as corrugated steel.
  const pbr = useTiledPBR(barrelDiffUrl, barrelNorUrl, barrelRoughUrl, 2, 1, 8);
  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    items.forEach((c, i) => {
      dummy.position.set(c.pos.x, c.pos.y + c.size.y / 2, c.pos.z);
      dummy.rotation.set(0, c.yaw, 0);
      dummy.scale.set(c.size.x, c.size.y, c.size.z);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      color.set(c.color);
      mesh.setColorAt(i, color);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [items]);
  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, Math.max(1, items.length)]} castShadow receiveShadow>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial
        map={pbr.map}
        normalMap={pbr.normalMap}
        roughnessMap={pbr.roughnessMap}
        normalScale={new THREE.Vector2(0.5, 0.5)}
        color="#ffffff"
        roughness={0.9}
        metalness={0.3}
      />
    </instancedMesh>
  );
}

function VehiclesScene() {
  const ref = useRef<THREE.Group>(null);
  useFrame(() => {
    const g = ref.current;
    if (!g) return;
    const vehs = store.state.vehicles;
    const ids = new Set(vehs.map(v => v.id));
    for (let i = g.children.length - 1; i >= 0; i--) {
      const c = g.children[i] as any;
      if (!ids.has(c.userData.id)) g.remove(c);
    }
    for (const v of vehs) {
      let mesh = g.children.find((c: any) => c.userData.id === v.id) as THREE.Group | undefined;
      if (!mesh) {
        mesh = new THREE.Group();
        mesh.userData.id = v.id;
        if (v.kind === 'tank') {
          buildTankMesh(mesh);
        } else if (v.kind === 'apc') {
          buildApc(mesh, '#6f6a4a');
        } else if (v.kind === 'truck') {
          buildTruck(mesh, '#7c7355');
        } else if (v.kind === 'humvee') {
          buildHumvee(mesh, '#857a58');
        } else {
          buildJeepMesh(mesh);
        }
        g.add(mesh);
      }
      mesh.position.copy(v.pos);
      mesh.rotation.y = v.yaw;
      mesh.visible = !v.destroyed;
    }
  });
  return <group ref={ref} />;
}

// === CAPTURE POINTS (visual rings on ground) ===
function CapturePointsScene() {
  const ref = useRef<THREE.Group>(null);
  useFrame(() => {
    const g = ref.current;
    if (!g) return;
    const cps = store.state.capturePoints;
    while (g.children.length > cps.length) g.remove(g.children[g.children.length - 1]);
    for (let i = 0; i < cps.length; i++) {
      const cp = cps[i];
      let mesh = g.children[i] as THREE.Mesh | undefined;
      if (!mesh) {
        const geo = new THREE.RingGeometry(cp.radius - 0.5, cp.radius, 32);
        const mat = new THREE.MeshBasicMaterial({ color: '#888888', transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false });
        mesh = new THREE.Mesh(geo, mat);
        mesh.rotation.x = -Math.PI / 2;
        mesh.position.y = 0.05;
        mesh.renderOrder = 5;
        g.add(mesh);
      }
      mesh.position.set(cp.pos.x, 0.05, cp.pos.z);
      const mat = mesh.material as THREE.MeshBasicMaterial;
      mat.color.set(cp.owner === 'blue' ? '#4488ff' : cp.owner === 'red' ? '#ff4444' : '#888888');
      mat.opacity = 0.2 + Math.abs(cp.progress) * 0.3;
    }
  });
  return <group ref={ref} />;
}

function ViewModel() {
  const ref = useRef<THREE.Group>(null);
  const { camera } = useThree();
  useFrame(() => {
    const g = ref.current;
    if (!g) return;
    g.position.copy(camera.position);
    g.quaternion.copy(camera.quaternion);
    const w = store.state.currentWeapon;
    const aimT = store.state.aimT;
    const hideForScope = (w === "rifle" || w === "sniper") && aimT > 0.7;
    const ids = ["rifle", "pistol", "grenade", "smg", "sniper", "smoke"];
    const slot = ids.indexOf(w);
    g.children.forEach((c, i) => {
      const isCurrent = i === slot;
      c.visible = isCurrent && !hideForScope;
    });
    const v = store.state.player.vel;
    const sp = Math.hypot(v.x, v.z);
    const t = performance.now() / 1000;
    const bob = sp > 0.5 ? Math.sin(t * 10) * 0.012 * (1 - aimT * 0.7) : 0;
    g.children.forEach((c, i) => {
      const id = ids[i];
      let baseX = 0.18, baseY = -0.22, baseZ = -0.45;
      if (id === "pistol") { baseX = 0.16; baseZ = -0.32; }
      else if (id === "grenade" || id === "smoke") { baseZ = -0.3; baseY = -0.2; }
      else if (id === "smg") { baseX = 0.17; baseZ = -0.38; }
      else if (id === "sniper") { baseX = 0.18; baseZ = -0.55; }
      const aimX = 0;
      const aimY = -0.12;
      const aimZ = baseZ - 0.05;
      c.position.x = baseX + (aimX - baseX) * aimT;
      c.position.y = baseY + (aimY - baseY) * aimT + bob;
      c.position.z = baseZ + (aimZ - baseZ) * aimT;
    });
  });
  return (
    <group ref={ref}>
      {/* Rifle */}
      <group position={[0.18, -0.22, -0.45]}>
        <mesh><boxGeometry args={[0.06, 0.1, 0.7]} /><meshStandardMaterial color="#1a1a1a" metalness={0.5} roughness={0.4} /></mesh>
        <mesh position={[0, -0.06, -0.05]}><boxGeometry args={[0.05, 0.12, 0.18]} /><meshStandardMaterial color="#3a3a3a" /></mesh>
        <mesh position={[0, 0.06, 0.1]}><boxGeometry args={[0.04, 0.04, 0.14]} /><meshStandardMaterial color="#222" /></mesh>
      </group>
      {/* Pistol */}
      <group position={[0.16, -0.22, -0.32]}>
        <mesh><boxGeometry args={[0.05, 0.07, 0.28]} /><meshStandardMaterial color="#1a1a1a" metalness={0.5} /></mesh>
        <mesh position={[0, -0.08, 0.04]}><boxGeometry args={[0.05, 0.13, 0.07]} /><meshStandardMaterial color="#2a2a2a" /></mesh>
      </group>
      {/* Grenade */}
      <group position={[0.18, -0.2, -0.3]}>
        <mesh><sphereGeometry args={[0.09, 12, 12]} /><meshStandardMaterial color="#2b3018" /></mesh>
        <mesh position={[0, 0.1, 0]}><cylinderGeometry args={[0.03, 0.03, 0.08]} /><meshStandardMaterial color="#999" /></mesh>
      </group>
      {/* SMG */}
      <group position={[0.17, -0.22, -0.38]}>
        <mesh><boxGeometry args={[0.05, 0.09, 0.5]} /><meshStandardMaterial color="#15151a" metalness={0.4} /></mesh>
        <mesh position={[0, -0.1, -0.04]}><boxGeometry args={[0.05, 0.16, 0.1]} /><meshStandardMaterial color="#2a2a2a" /></mesh>
      </group>
      {/* Sniper */}
      <group position={[0.18, -0.22, -0.55]}>
        <mesh><boxGeometry args={[0.06, 0.1, 0.95]} /><meshStandardMaterial color="#2a2018" metalness={0.3} /></mesh>
        <mesh position={[0, 0.08, 0]}><cylinderGeometry args={[0.04, 0.04, 0.32, 10]} /><meshStandardMaterial color="#0a0a0a" /></mesh>
      </group>
      {/* Smoke Grenade */}
      <group position={[0.18, -0.2, -0.3]}>
        <mesh><sphereGeometry args={[0.09, 12, 12]} /><meshStandardMaterial color="#667766" /></mesh>
        <mesh position={[0, 0.1, 0]}><cylinderGeometry args={[0.03, 0.03, 0.08]} /><meshStandardMaterial color="#aaa" /></mesh>
      </group>
    </group>
  );
}

export default function Game() {
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<Input | null>(null);
  const [engine, setEngine] = useState<GameEngine | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    // Warm the texture cache during the menu so the first map load is instant.
    preloadTextures();
    const input = new Input(containerRef.current);
    inputRef.current = input;
    const eng = new GameEngine(store.state, {
      keys: input.keys,
      consumeMouseDelta: () => input.consumeMouseDelta(),
      mouse: input.mouse,
      get touchMove() { return input.touchMove; },
      get touchActive() { return input.touchActive; },
      get jumpPressed() { return input.jumpPressed; },
      set jumpPressed(v: boolean) { input.jumpPressed = v; },
      get reloadPressed() { return input.reloadPressed; },
      set reloadPressed(v: boolean) { input.reloadPressed = v; },
      get pickupPressed() { return input.pickupPressed; },
      set pickupPressed(v: boolean) { input.pickupPressed = v; },
      get enterVehiclePressed() { return input.enterVehiclePressed; },
      set enterVehiclePressed(v: boolean) { input.enterVehiclePressed = v; },
      get weaponSwitchPressed() { return input.weaponSwitchPressed; },
      set weaponSwitchPressed(v: number | null) { input.weaponSwitchPressed = v; },
      get vehicleGas() { return input.vehicleGas; },
      get vehicleBrake() { return input.vehicleBrake; },
      get mapTogglePressed() { return input.mapTogglePressed; },
      set mapTogglePressed(v: boolean) { input.mapTogglePressed = v; },
    } as any, sharedWorld);
    setEngine(eng);
  }, []);

  const showLoadout = () => {
    store.reset();
    store.state.status = "loadout";
    store.emit();
  };

  const startGame = (loadout?: any) => {
    if (loadout) {
      store.state.loadout = loadout;
    }
    store.state.status = "playing";
    if (engine) {
      engine.state = store.state;
      engine.startMatch();
    }
    const isTouch = typeof window !== "undefined" && "ontouchstart" in window;
    if (!isTouch) inputRef.current?.requestLock();
    store.emit();
  };

  const status = useGameHook((s) => s.status);
  const showCanvas = status !== "menu" && status !== "loadout";

  return (
    <div ref={containerRef} className="relative h-screen w-screen overflow-hidden bg-background">
      <div className="absolute inset-0 z-0">
        {showCanvas && (
          <Canvas
            shadows
            camera={{ fov: 78, near: 0.15, far: 600, position: [0, 1.7, 0] }}
            gl={{
              antialias: false,
              powerPreference: "high-performance",
              logarithmicDepthBuffer: false,
            }}
            // Adaptive resolution: clamp to the device pixel ratio but allow a
            // slightly crisper image (up to 1.5x) on capable displays while
            // keeping the lower bound for weak GPUs — quality up, cost bounded.
            dpr={[0.9, Math.min(typeof window !== "undefined" ? window.devicePixelRatio : 1, 1.5)]}
            onCreated={({ scene, gl }) => {
              scene.background = new THREE.Color("#87ceeb");
              gl.toneMapping = THREE.ACESFilmicToneMapping;
              gl.toneMappingExposure = 1.35;
              gl.outputColorSpace = THREE.SRGBColorSpace;
              gl.shadowMap.enabled = true;
              // Soft, slightly higher-quality shadow filtering.
              gl.shadowMap.type = THREE.PCFSoftShadowMap;
            }}
          >
            <Suspense fallback={null}>
              {engine && <Scene engine={engine} />}
            </Suspense>
          </Canvas>
        )}
      </div>
      <div className="absolute inset-0 z-10">
        <HUD onStart={showLoadout} onStartGame={startGame} input={inputRef} />
      </div>
    </div>
  );
}
