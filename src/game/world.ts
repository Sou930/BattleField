import * as THREE from "three";

// A single wall segment (axis-aligned box used both for collision and rendering)
export interface Wall {
  pos: THREE.Vector3; // center
  size: THREE.Vector3; // full extents
  color: string;
  kind: "wall" | "roof" | "floor" | "pillar" | "barrier" | "ground-debris";
}

export interface Building {
  walls: Wall[];
  // bounds (for spawn checks)
  min: THREE.Vector3;
  max: THREE.Vector3;
  info?: BuildingInfo;
}

export interface Crate {
  pos: THREE.Vector3;
  size: number;
  color: string;
}

export interface PalmTree {
  pos: THREE.Vector3;
  height: number;
}

export interface TerrainHill {
  pos: THREE.Vector3;
  radius: number;
  height: number;
  color: string;
}

export interface Barrel {
  pos: THREE.Vector3;
  color: string;
}

// Deterministic seeded random
function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const WORLD_SIZE = 720; // doubled large battlefield

// Radius of the flat city core. Inside this the ground is leveled so the
// streets, buildings and plaza sit on flat terrain; outside it the desert
// rolls naturally.
const CITY_FLAT_RADIUS = WORLD_SIZE * 0.48 * 0.58 + 18;

// --- Deterministic value-noise field used for the continuous base terrain ---
function hash2(ix: number, iz: number): number {
  let h = ix * 374761393 + iz * 668265263;
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 1274126177) >>> 0;
  return (h >>> 0) / 4294967296;
}

function smoothNoise(x: number, z: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz);
  const b = hash2(ix + 1, iz);
  const c = hash2(ix, iz + 1);
  const d = hash2(ix + 1, iz + 1);
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}

// Fractal Brownian motion (several octaves of value noise) in [0,1].
function fbm2(x: number, z: number): number {
  let v = 0;
  let amp = 0.5;
  let freq = 1;
  let norm = 0;
  for (let o = 0; o < 4; o++) {
    v += amp * smoothNoise(x * freq, z * freq);
    norm += amp;
    amp *= 0.5;
    freq *= 2.07;
  }
  return v / norm;
}

// Continuous, smoothly rolling base elevation of the desert. Flattens to 0
// inside the city core so the urban area stays buildable and walkable.
export function baseTerrainHeight(x: number, z: number): number {
  // Large gentle dunes plus finer ripples.
  const dunes = (fbm2(x * 0.0042 + 11.3, z * 0.0042 - 7.1) - 0.5) * 2; // [-1,1]
  const ripples = (fbm2(x * 0.02 + 51.7, z * 0.02 + 23.9) - 0.5) * 2;
  let h = dunes * 9.0 + ripples * 1.3;

  // Flatten the city core: blend the elevation down to ~0 within the flat
  // radius, easing back to full dunes a bit outside it.
  const distFromCenter = Math.hypot(x, z);
  const flatStart = CITY_FLAT_RADIUS;
  const flatEnd = CITY_FLAT_RADIUS + 70;
  let cityBlend = (distFromCenter - flatStart) / (flatEnd - flatStart);
  cityBlend = Math.max(0, Math.min(1, cityBlend));
  cityBlend = cityBlend * cityBlend * (3 - 2 * cityBlend); // smoothstep
  h *= cityBlend;

  return h;
}

const SAND_PALETTE = ["#c9a874", "#b89968", "#a98456", "#d4b585", "#b08858", "#8d6d44"];
const ROOF_PALETTE = ["#7a5238", "#8a5e3e", "#6b4830", "#9a6a45"];

// Per-building metadata so the renderer can decorate facades with windows,
// balconies and parapets that line up with the actual storeys.
export interface BuildingInfo {
  cx: number;
  cz: number;
  w: number;
  d: number;
  h: number;
  floors: number;
  floorH: number;
  doorSide: number; // 0=+z, 1=-z, 2=+x, 3=-x
  color: string;
  roofColor: string;
  hasParapet: boolean;
}

const STOREY_HEIGHT = 3.4; // realistic per-floor height

function makeBuilding(
  rng: () => number,
  cx: number,
  cz: number,
  w: number,
  d: number,
  hRequested: number,
): Building {
  const walls: Wall[] = [];
  const wallT = 0.4;
  const color = SAND_PALETTE[Math.floor(rng() * SAND_PALETTE.length)];
  const roofColor = ROOF_PALETTE[Math.floor(rng() * ROOF_PALETTE.length)];

  // Quantize the height into whole storeys so floors line up cleanly.
  const floors = Math.max(1, Math.round(hRequested / STOREY_HEIGHT));
  const floorH = STOREY_HEIGHT;
  const h = floors * floorH;

  const halfW = w / 2;
  const halfD = d / 2;

  // Decide door position on one of the 4 walls
  const doorSide = Math.floor(rng() * 4); // 0=+z, 1=-z, 2=+x, 3=-x
  const doorWidth = 1.6;
  const doorHeight = 2.2;

  // A façade wall for ONE storey, optionally pierced by a door (ground floor)
  // and window openings on the upper part.
  const addFacade = (
    centerX: number,
    centerZ: number,
    spanAxis: "x" | "z",
    spanLen: number,
    baseY: number,
    storeyH: number,
    hasDoor: boolean,
  ) => {
    const segs: { off: number; len: number }[] = [];
    if (hasDoor) {
      const halfSpan = spanLen / 2;
      const halfDoor = doorWidth / 2;
      const sideLen = halfSpan - halfDoor;
      segs.push({ off: -(halfDoor + sideLen / 2), len: sideLen });
      segs.push({ off: halfDoor + sideLen / 2, len: sideLen });
    } else {
      segs.push({ off: 0, len: spanLen });
    }
    for (const sg of segs) {
      if (sg.len <= 0.05) continue;
      const px = spanAxis === "x" ? centerX + sg.off : centerX;
      const pz = spanAxis === "z" ? centerZ + sg.off : centerZ;
      const sx = spanAxis === "x" ? sg.len : wallT;
      const sz = spanAxis === "z" ? sg.len : wallT;
      walls.push({
        pos: new THREE.Vector3(px, baseY + storeyH / 2, pz),
        size: new THREE.Vector3(sx, storeyH, sz),
        color,
        kind: "wall",
      });
    }
    // Lintel above the door so the opening is only door-height.
    if (hasDoor) {
      const lintelH = storeyH - doorHeight;
      if (lintelH > 0.05) {
        const sx = spanAxis === "x" ? doorWidth : wallT;
        const sz = spanAxis === "z" ? doorWidth : wallT;
        walls.push({
          pos: new THREE.Vector3(centerX, baseY + doorHeight + lintelH / 2, centerZ),
          size: new THREE.Vector3(sx, lintelH, sz),
          color,
          kind: "wall",
        });
      }
    }
  };

  // Build each storey's four façades.
  for (let f = 0; f < floors; f++) {
    const baseY = f * floorH;
    const groundFloor = f === 0;
    addFacade(cx, cz + halfD, "x", w, baseY, floorH, groundFloor && doorSide === 0);
    addFacade(cx, cz - halfD, "x", w, baseY, floorH, groundFloor && doorSide === 1);
    addFacade(cx + halfW, cz, "z", d, baseY, floorH, groundFloor && doorSide === 2);
    addFacade(cx - halfW, cz, "z", d, baseY, floorH, groundFloor && doorSide === 3);

    // Interior floor slab for storeys above the ground (a real walkable deck
    // for the upper levels), with a stair opening left in one corner.
    if (f > 0) {
      const slabY = baseY;
      const holeW = Math.min(2.6, w * 0.4);
      const holeD = Math.min(2.6, d * 0.4);
      // Stair hole in the -x/-z corner; build slab as 2 L-shaped boxes.
      const hx = cx - halfW + holeW / 2 + 0.2;
      const hz = cz - halfD + holeD / 2 + 0.2;
      // Big slab covering everything except a strip on the -x side for the hole
      walls.push({
        pos: new THREE.Vector3(cx + holeW / 2, slabY, cz),
        size: new THREE.Vector3(w - holeW, 0.25, d),
        color: roofColor,
        kind: "floor",
      });
      walls.push({
        pos: new THREE.Vector3(hx, slabY, cz + holeD / 2),
        size: new THREE.Vector3(holeW, 0.25, d - holeD),
        color: roofColor,
        kind: "floor",
      });
      void hz;
    }
  }

  // Corner pilasters (quoins) for facade depth on bigger buildings.
  if (w > 9 && d > 9) {
    const pT = 0.7;
    const corners = [
      [cx - halfW, cz - halfD],
      [cx + halfW, cz - halfD],
      [cx - halfW, cz + halfD],
      [cx + halfW, cz + halfD],
    ];
    for (const [px, pz] of corners) {
      walls.push({
        pos: new THREE.Vector3(px, h / 2, pz),
        size: new THREE.Vector3(pT, h, pT),
        color,
        kind: "pillar",
      });
    }
  }

  // Roof slab
  walls.push({
    pos: new THREE.Vector3(cx, h + 0.15, cz),
    size: new THREE.Vector3(w + 0.3, 0.3, d + 0.3),
    color: roofColor,
    kind: "roof",
  });

  // Rooftop parapet (low wall around the edge) — gives rooftop cover and a more
  // realistic flat-roof silhouette. Taller buildings only.
  const hasParapet = floors >= 2;
  if (hasParapet) {
    const pH = 0.9;
    const pT = 0.35;
    const pY = h + pH / 2 + 0.3;
    walls.push({ pos: new THREE.Vector3(cx, pY, cz + halfD), size: new THREE.Vector3(w + 0.4, pH, pT), color: roofColor, kind: "barrier" });
    walls.push({ pos: new THREE.Vector3(cx, pY, cz - halfD), size: new THREE.Vector3(w + 0.4, pH, pT), color: roofColor, kind: "barrier" });
    walls.push({ pos: new THREE.Vector3(cx + halfW, pY, cz), size: new THREE.Vector3(pT, pH, d + 0.4), color: roofColor, kind: "barrier" });
    walls.push({ pos: new THREE.Vector3(cx - halfW, pY, cz), size: new THREE.Vector3(pT, pH, d + 0.4), color: roofColor, kind: "barrier" });
  }

  // Interior staircase: a stepped ramp of boxes climbing each storey in the
  // -x/-z corner so the AI/player can reach upper floors.
  if (floors >= 2) {
    const stepCount = Math.max(5, Math.round(floorH / 0.45));
    for (let f = 0; f < floors - 1; f++) {
      const baseY = f * floorH;
      const run = Math.min(d - 1.5, 4.5);
      const startZ = cz - halfD + 0.7;
      for (let st = 0; st < stepCount; st++) {
        const t = st / stepCount;
        const stepY = baseY + t * floorH;
        const stepZ = startZ + t * run;
        walls.push({
          pos: new THREE.Vector3(cx - halfW + 1.0, stepY + 0.15, stepZ),
          size: new THREE.Vector3(1.6, 0.3, run / stepCount + 0.25),
          color: roofColor,
          kind: "floor",
        });
      }
    }
  }

  const b: Building = {
    walls,
    min: new THREE.Vector3(cx - halfW, 0, cz - halfD),
    max: new THREE.Vector3(cx + halfW, h, cz + halfD),
    info: {
      cx, cz, w, d, h, floors, floorH, doorSide, color, roofColor, hasParapet,
    },
  };
  return b;
}

export interface Road {
  // Axis-aligned road strip rendered as dark sand path
  pos: THREE.Vector3; // center on ground (y=0.01)
  size: THREE.Vector3; // x,y(thin),z
  color: string;
}

export interface MarketTent {
  pos: THREE.Vector3;
  color: string;
}

export interface Lamp {
  pos: THREE.Vector3;
}

export interface PickupSpawn {
  pos: THREE.Vector3;
  kind: "weapon" | "ammo" | "health" | "grenade";
  weaponId?: "rifle" | "pistol" | "smg" | "sniper";
  amount?: number;
}

export interface WindowDecal {
  pos: THREE.Vector3;
  size: THREE.Vector3;
  lit: boolean;
}

export interface Awning {
  pos: THREE.Vector3;
  size: THREE.Vector3;
  color: string;
}

export interface Rug {
  pos: THREE.Vector3;
  size: THREE.Vector3;
  color: string;
  rot: number;
}

export interface World {
  buildings: Building[];
  walls: Wall[];
  crates: Crate[];
  barrels: Barrel[];
  palms: PalmTree[];
  sandbags: Wall[];
  roads: Road[];
  tents: MarketTent[];
  lamps: Lamp[];
  pickupSpawns: PickupSpawn[];
  windows: WindowDecal[];
  awnings: Awning[];
  rugs: Rug[];
  hills: TerrainHill[];
  fountainPos: THREE.Vector3;
}

export function generateWorld(): World {
  const rng = mulberry32(7);
  const buildings: Building[] = [];
  const crates: Crate[] = [];
  const barrels: Barrel[] = [];
  const palms: PalmTree[] = [];
  const sandbags: Wall[] = [];
  const roads: Road[] = [];
  const tents: MarketTent[] = [];
  const lamps: Lamp[] = [];
  const pickupSpawns: PickupSpawn[] = [];
  const windows: WindowDecal[] = [];
  const awnings: Awning[] = [];
  const rugs: Rug[] = [];
  const hills: TerrainHill[] = [];

  // Grid of buildings with streets between
  const citySize = WORLD_SIZE * 0.48;
  const cityRadius = citySize * 0.58;
  const cells = 12;
  const cellSize = citySize / cells;
  for (let x = 0; x < cells; x++) {
    for (let z = 0; z < cells; z++) {
      // Keep central plaza clear (around 0,0)
      const cx0 = -citySize / 2 + (x + 0.5) * cellSize;
      const cz0 = -citySize / 2 + (z + 0.5) * cellSize;
      if (Math.hypot(cx0, cz0) < cellSize * 1.2) continue;
      if (Math.hypot(cx0, cz0) > cityRadius) continue;
      if (rng() < 0.28) continue; // street/plaza
      const w = 9 + rng() * 13;
      const d = 9 + rng() * 13;
      // Mix of heights: mostly 1-3 storeys with occasional 4-5 storey towers
      const tower = rng() < 0.22;
      const h = tower ? STOREY_HEIGHT * (3.5 + rng() * 1.6) : STOREY_HEIGHT * (1 + rng() * 2.2);
      buildings.push(
        makeBuilding(
          rng,
          cx0 + (rng() - 0.5) * 4,
          cz0 + (rng() - 0.5) * 4,
          w,
          d,
          h,
        ),
      );
    }
  }

  // Wooden crates as cover
  for (let i = 0; i < 220; i++) {
    const s = 0.9 + rng() * 0.7;
    const outer = rng() > 0.55;
    const a = rng() * Math.PI * 2;
    const r = outer ? cityRadius + rng() * (WORLD_SIZE / 2 - cityRadius - 25) : rng() * cityRadius;
    const p = new THREE.Vector3(
      outer ? Math.cos(a) * r : (rng() - 0.5) * citySize,
      s / 2,
      outer ? Math.sin(a) * r : (rng() - 0.5) * citySize,
    );
    if (insideAnyBuilding(p, buildings, 0.5)) continue;
    const woodPalette = ["#6b4a2b", "#825a35", "#5a3e22", "#7a5028"];
    crates.push({ pos: p, size: s, color: woodPalette[Math.floor(rng() * woodPalette.length)] });
  }

  // Oil barrels
  for (let i = 0; i < 50; i++) {
    const p = new THREE.Vector3(
      (rng() - 0.5) * (WORLD_SIZE - 20),
      0,
      (rng() - 0.5) * (WORLD_SIZE - 20),
    );
    if (insideAnyBuilding(p, buildings, 0.5)) continue;
    const colors = ["#9a2a1a", "#2a4a8a", "#3a3a3a", "#7a4a1a"];
    barrels.push({ pos: p, color: colors[Math.floor(rng() * colors.length)] });
  }

  // Broad, gentle mounds layered on top of the continuous desert base to add
  // larger landmarks (ridges / dune crests) outside the city.
  for (let i = 0; i < 38; i++) {
    const a = rng() * Math.PI * 2;
    const r = cityRadius + 25 + rng() * (WORLD_SIZE / 2 - cityRadius - 45);
    const radius = 45 + rng() * 70;
    const height = 3 + rng() * 7;
    const pos = new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r);
    hills.push({ pos, radius, height, color: rng() > 0.45 ? "#8a7a54" : "#6f8152" });
  }

  // Palm / forest trees: sparse in city, thick outside
  for (let i = 0; i < 190; i++) {
    const outer = rng() > 0.25;
    const a = rng() * Math.PI * 2;
    const r = outer ? cityRadius + rng() * (WORLD_SIZE / 2 - cityRadius - 20) : rng() * cityRadius;
    const p = new THREE.Vector3(
      outer ? Math.cos(a) * r : (rng() - 0.5) * citySize,
      0,
      outer ? Math.sin(a) * r : (rng() - 0.5) * citySize,
    );
    if (insideAnyBuilding(p, buildings, 1)) continue;
    palms.push({ pos: p, height: 4 + rng() * 3 });
  }

  // Sandbag clusters
  for (let i = 0; i < 80; i++) {
    const outer = rng() > 0.45;
    const a = rng() * Math.PI * 2;
    const r = outer ? cityRadius + rng() * (WORLD_SIZE / 2 - cityRadius - 35) : rng() * cityRadius;
    const cx = outer ? Math.cos(a) * r : (rng() - 0.5) * citySize;
    const cz = outer ? Math.sin(a) * r : (rng() - 0.5) * citySize;
    if (insideAnyBuilding(new THREE.Vector3(cx, 0, cz), buildings, 2)) continue;
    const horizontal = rng() > 0.5;
    const length = 3 + rng() * 3;
    sandbags.push({
      pos: new THREE.Vector3(cx, 0.45, cz),
      size: horizontal
        ? new THREE.Vector3(length, 0.9, 0.6)
        : new THREE.Vector3(0.6, 0.9, length),
      color: "#a8895a",
      kind: "barrier",
    });
  }

  // Roads — main cross at center + ring road
  const roadColor = "#7d6440";
  roads.push({
    pos: new THREE.Vector3(0, 0.01, 0),
    size: new THREE.Vector3(citySize, 0.02, 7),
    color: roadColor,
  });
  roads.push({
    pos: new THREE.Vector3(0, 0.01, 0),
    size: new THREE.Vector3(7, 0.02, citySize),
    color: roadColor,
  });
  // diagonals (alleyways)
  for (let i = -2; i <= 2; i++) {
    if (i === 0) continue;
    roads.push({
      pos: new THREE.Vector3(0, 0.01, i * cellSize),
      size: new THREE.Vector3(citySize, 0.02, 3),
      color: "#8a7048",
    });
    roads.push({
      pos: new THREE.Vector3(i * cellSize, 0.01, 0),
      size: new THREE.Vector3(3, 0.02, citySize),
      color: "#8a7048",
    });
  }

  // Market tents lining central plaza
  const tentColors = ["#b04030", "#3060a0", "#a08030", "#6a4030"];
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2;
    const r = 22 + (i % 3) * 4;
    const tx = Math.cos(a) * r;
    const tz = Math.sin(a) * r;
    if (insideAnyBuilding(new THREE.Vector3(tx, 0, tz), buildings, 1.5)) continue;
    tents.push({
      pos: new THREE.Vector3(tx, 0, tz),
      color: tentColors[Math.floor(rng() * tentColors.length)],
    });
  }

  // Street lamps along main roads
  for (let i = -5; i <= 5; i++) {
    if (i === 0) continue;
    lamps.push({ pos: new THREE.Vector3(i * cellSize, 0, 4) });
    lamps.push({ pos: new THREE.Vector3(i * cellSize, 0, -4) });
    lamps.push({ pos: new THREE.Vector3(4, 0, i * cellSize) });
    lamps.push({ pos: new THREE.Vector3(-4, 0, i * cellSize) });
  }

  // Pickups inside buildings — weapons, ammo, health, grenades
  const weaponPool: ("rifle" | "pistol" | "smg" | "sniper")[] = [
    "rifle",
    "pistol",
    "smg",
    "sniper",
  ];
  for (const b of buildings) {
    if (rng() < 0.7) {
      const px = (b.min.x + b.max.x) / 2 + (rng() - 0.5) * (b.max.x - b.min.x) * 0.5;
      const pz = (b.min.z + b.max.z) / 2 + (rng() - 0.5) * (b.max.z - b.min.z) * 0.5;
      const roll = rng();
      if (roll < 0.4) {
        pickupSpawns.push({
          pos: new THREE.Vector3(px, 0.6, pz),
          kind: "weapon",
          weaponId: weaponPool[Math.floor(rng() * weaponPool.length)],
        });
      } else if (roll < 0.7) {
        pickupSpawns.push({
          pos: new THREE.Vector3(px, 0.4, pz),
          kind: "ammo",
          amount: 60,
        });
      } else if (roll < 0.9) {
        pickupSpawns.push({
          pos: new THREE.Vector3(px, 0.4, pz),
          kind: "health",
          amount: 50,
        });
      } else {
        pickupSpawns.push({
          pos: new THREE.Vector3(px, 0.4, pz),
          kind: "grenade",
          amount: 2,
        });
      }
    }
  }

  // Windows on building exterior walls (one row per storey) + balconies on
  // upper floors + awnings above doors. Uses per-building storey info so the
  // glazing lines up with the real floors.
  const tentColors2 = ["#b04030", "#3060a0", "#a08030", "#6a4030", "#8a6020"];
  for (const b of buildings) {
    if (!b.info) continue;
    const { cx, cz, w: bw, d: bd, floors, floorH, doorSide } = b.info;
    const halfW = bw / 2;
    const halfD = bd / 2;
    const nx = Math.max(1, Math.floor(bw / 3.2));
    const nz = Math.max(1, Math.floor(bd / 3.2));
    const winH = 1.1;
    const winW = 0.8;

    for (let f = 0; f < floors; f++) {
      // window sits in the upper portion of each storey
      const sillY = f * floorH + floorH * 0.5;
      // +z / -z faces (vary along x)
      for (let i = 0; i < nx; i++) {
        const fx = b.min.x + (i + 0.5) * (bw / nx);
        const overDoorZpos = f === 0 && (doorSide === 0) && Math.abs(fx - cx) < 1.3;
        const overDoorZneg = f === 0 && (doorSide === 1) && Math.abs(fx - cx) < 1.3;
        if (!overDoorZpos) {
          windows.push({ pos: new THREE.Vector3(fx, sillY, b.max.z + 0.06), size: new THREE.Vector3(winW, winH, 0.06), lit: rng() > 0.45 });
        }
        if (!overDoorZneg) {
          windows.push({ pos: new THREE.Vector3(fx, sillY, b.min.z - 0.06), size: new THREE.Vector3(winW, winH, 0.06), lit: rng() > 0.45 });
        }
      }
      // +x / -x faces (vary along z)
      for (let i = 0; i < nz; i++) {
        const fz = b.min.z + (i + 0.5) * (bd / nz);
        const overDoorXpos = f === 0 && (doorSide === 2) && Math.abs(fz - cz) < 1.3;
        const overDoorXneg = f === 0 && (doorSide === 3) && Math.abs(fz - cz) < 1.3;
        if (!overDoorXpos) {
          windows.push({ pos: new THREE.Vector3(b.max.x + 0.06, sillY, fz), size: new THREE.Vector3(0.06, winH, winW), lit: rng() > 0.45 });
        }
        if (!overDoorXneg) {
          windows.push({ pos: new THREE.Vector3(b.min.x - 0.06, sillY, fz), size: new THREE.Vector3(0.06, winH, winW), lit: rng() > 0.45 });
        }
      }

      // Balcony slab on a random upper-floor face for buildings with >=2 floors.
      if (f >= 1 && rng() < 0.35) {
        const balconyY = f * floorH + 0.2;
        const bSide = Math.floor(rng() * 4);
        const bColor = ROOF_PALETTE[Math.floor(rng() * ROOF_PALETTE.length)];
        if (bSide === 0) awnings.push({ pos: new THREE.Vector3(cx, balconyY, b.max.z + 0.7), size: new THREE.Vector3(Math.min(bw * 0.6, 3), 0.16, 1.3), color: bColor });
        else if (bSide === 1) awnings.push({ pos: new THREE.Vector3(cx, balconyY, b.min.z - 0.7), size: new THREE.Vector3(Math.min(bw * 0.6, 3), 0.16, 1.3), color: bColor });
        else if (bSide === 2) awnings.push({ pos: new THREE.Vector3(b.max.x + 0.7, balconyY, cz), size: new THREE.Vector3(1.3, 0.16, Math.min(bd * 0.6, 3)), color: bColor });
        else awnings.push({ pos: new THREE.Vector3(b.min.x - 0.7, balconyY, cz), size: new THREE.Vector3(1.3, 0.16, Math.min(bd * 0.6, 3)), color: bColor });
      }
      void halfW; void halfD;
    }

    // Cloth awning directly above the entrance door.
    const awColor = tentColors2[Math.floor(rng() * tentColors2.length)];
    if (doorSide === 0) awnings.push({ pos: new THREE.Vector3(cx, 2.6, b.max.z + 0.6), size: new THREE.Vector3(2.6, 0.05, 1.2), color: awColor });
    else if (doorSide === 1) awnings.push({ pos: new THREE.Vector3(cx, 2.6, b.min.z - 0.6), size: new THREE.Vector3(2.6, 0.05, 1.2), color: awColor });
    else if (doorSide === 2) awnings.push({ pos: new THREE.Vector3(b.max.x + 0.6, 2.6, cz), size: new THREE.Vector3(1.2, 0.05, 2.6), color: awColor });
    else awnings.push({ pos: new THREE.Vector3(b.min.x - 0.6, 2.6, cz), size: new THREE.Vector3(1.2, 0.05, 2.6), color: awColor });
  }

  // Decorative rugs around plaza
  const rugColors = ["#7a2030", "#205a7a", "#a06020", "#5a3070"];
  for (let i = 0; i < 14; i++) {
    const a = rng() * Math.PI * 2;
    const r = 8 + rng() * 10;
    const px = Math.cos(a) * r;
    const pz = Math.sin(a) * r;
    if (insideAnyBuilding(new THREE.Vector3(px, 0, pz), buildings, 0.5)) continue;
    rugs.push({
      pos: new THREE.Vector3(px, 0.03, pz),
      size: new THREE.Vector3(2.2 + rng() * 1.5, 0.02, 1.4 + rng() * 1.0),
      color: rugColors[Math.floor(rng() * rugColors.length)],
      rot: rng() * Math.PI,
    });
  }

  // Perimeter walls
  const wallH = 8;
  const wallT = 1.5;
  const perimeter: Wall[] = [
    {
      pos: new THREE.Vector3(0, wallH / 2, WORLD_SIZE / 2),
      size: new THREE.Vector3(WORLD_SIZE, wallH, wallT),
      color: "#7a5d3a",
      kind: "wall",
    },
    {
      pos: new THREE.Vector3(0, wallH / 2, -WORLD_SIZE / 2),
      size: new THREE.Vector3(WORLD_SIZE, wallH, wallT),
      color: "#7a5d3a",
      kind: "wall",
    },
    {
      pos: new THREE.Vector3(WORLD_SIZE / 2, wallH / 2, 0),
      size: new THREE.Vector3(wallT, wallH, WORLD_SIZE),
      color: "#7a5d3a",
      kind: "wall",
    },
    {
      pos: new THREE.Vector3(-WORLD_SIZE / 2, wallH / 2, 0),
      size: new THREE.Vector3(wallT, wallH, WORLD_SIZE),
      color: "#7a5d3a",
      kind: "wall",
    },
  ];

  const walls: Wall[] = [];
  for (const b of buildings) walls.push(...b.walls);
  walls.push(...perimeter);

  // Ground height (base dunes + authored mounds) used to seat props on the
  // rolling terrain. Mirrors terrainHeightAt() but without needing the World.
  const groundAt = (x: number, z: number) => {
    let h = baseTerrainHeight(x, z);
    for (const hill of hills) {
      const dx = x - hill.pos.x;
      const dz = z - hill.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < hill.radius) {
        const t = 1 - d / hill.radius;
        const smooth = t * t * (3 - 2 * t);
        h += smooth * hill.height;
      }
    }
    return h;
  };

  // Seat ground props onto the terrain so nothing floats or sinks.
  for (const c of crates) c.pos.y += groundAt(c.pos.x, c.pos.z);
  for (const b of barrels) b.pos.y += groundAt(b.pos.x, b.pos.z);
  for (const p of palms) p.pos.y += groundAt(p.pos.x, p.pos.z);
  for (const s of sandbags) s.pos.y += groundAt(s.pos.x, s.pos.z);
  for (const t of tents) t.pos.y += groundAt(t.pos.x, t.pos.z);
  for (const l of lamps) l.pos.y += groundAt(l.pos.x, l.pos.z);

  return {
    buildings,
    walls,
    crates,
    barrels,
    palms,
    sandbags,
    roads,
    tents,
    lamps,
    pickupSpawns,
    windows,
    awnings,
    rugs,
    hills,
    fountainPos: new THREE.Vector3(0, 0, 0),
  };
}

function insideAnyBuilding(p: THREE.Vector3, buildings: Building[], pad: number) {
  for (const b of buildings) {
    if (
      p.x > b.min.x - pad &&
      p.x < b.max.x + pad &&
      p.z > b.min.z - pad &&
      p.z < b.max.z + pad
    ) {
      return true;
    }
  }
  return false;
}

export function terrainHeightAt(world: World, x: number, z: number) {
  // Continuous rolling desert base (flat in the city core).
  let h = baseTerrainHeight(x, z);
  // Add the authored hills as broad, soft mounds on top of the base so the
  // landscape reads as one continuous surface rather than isolated cones.
  for (const hill of world.hills) {
    const dx = x - hill.pos.x;
    const dz = z - hill.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < hill.radius) {
      const t = 1 - d / hill.radius;
      const smooth = t * t * (3 - 2 * t);
      h += smooth * hill.height;
    }
  }
  return h;
}

// Axis-aligned box collider
export interface Box {
  min: THREE.Vector3;
  max: THREE.Vector3;
  // height of bottom (for step-up) - if low enough player can step over
  isLow?: boolean;
}

export function worldToBoxes(world: World): Box[] {
  const boxes: Box[] = [];
  for (const w of world.walls) {
    boxes.push({
      min: new THREE.Vector3(
        w.pos.x - w.size.x / 2,
        w.pos.y - w.size.y / 2,
        w.pos.z - w.size.z / 2,
      ),
      max: new THREE.Vector3(
        w.pos.x + w.size.x / 2,
        w.pos.y + w.size.y / 2,
        w.pos.z + w.size.z / 2,
      ),
    });
  }
  for (const c of world.crates) {
    const baseY = c.pos.y - c.size / 2;
    boxes.push({
      min: new THREE.Vector3(c.pos.x - c.size / 2, baseY, c.pos.z - c.size / 2),
      max: new THREE.Vector3(c.pos.x + c.size / 2, baseY + c.size, c.pos.z + c.size / 2),
    });
  }
  for (const s of world.sandbags) {
    const baseY = s.pos.y - s.size.y / 2;
    boxes.push({
      min: new THREE.Vector3(
        s.pos.x - s.size.x / 2,
        baseY,
        s.pos.z - s.size.z / 2,
      ),
      max: new THREE.Vector3(
        s.pos.x + s.size.x / 2,
        baseY + s.size.y,
        s.pos.z + s.size.z / 2,
      ),
      isLow: true,
    });
  }
  for (const b of world.barrels) {
    const baseY = b.pos.y;
    boxes.push({
      min: new THREE.Vector3(b.pos.x - 0.35, baseY, b.pos.z - 0.35),
      max: new THREE.Vector3(b.pos.x + 0.35, baseY + 1.1, b.pos.z + 0.35),
    });
  }
  const f = world.fountainPos;
  boxes.push({
    min: new THREE.Vector3(f.x - 4.4, 0, f.z - 4.4),
    max: new THREE.Vector3(f.x + 4.4, 0.9, f.z + 4.4),
  });
  boxes.push({
    min: new THREE.Vector3(f.x - 0.65, 0, f.z - 0.65),
    max: new THREE.Vector3(f.x + 0.65, 2.4, f.z + 0.65),
  });
  return boxes;
}

// Resolve player capsule (approx as cylinder) vs boxes
export function resolvePlayerCollision(
  pos: THREE.Vector3,
  radius: number,
  height: number,
  boxes: Box[],
) {
  const yFeet = pos.y - height;
  const yHead = pos.y;
  for (const b of boxes) {
    if (yHead < b.min.y || yFeet > b.max.y) continue;
    const cx = Math.max(b.min.x, Math.min(pos.x, b.max.x));
    const cz = Math.max(b.min.z, Math.min(pos.z, b.max.z));
    const dx = pos.x - cx;
    const dz = pos.z - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 < radius * radius) {
      const d = Math.sqrt(d2) || 0.0001;
      pos.x += (dx / d) * (radius - d);
      pos.z += (dz / d) * (radius - d);
    }
  }
}

// Ray vs AABB
export function rayBox(
  origin: THREE.Vector3,
  dir: THREE.Vector3,
  box: Box,
): number | null {
  let tmin = -Infinity;
  let tmax = Infinity;
  for (const axis of ["x", "y", "z"] as const) {
    const o = origin[axis];
    const d = dir[axis];
    const mn = box.min[axis];
    const mx = box.max[axis];
    if (Math.abs(d) < 1e-8) {
      if (o < mn || o > mx) return null;
    } else {
      let t1 = (mn - o) / d;
      let t2 = (mx - o) / d;
      if (t1 > t2) [t1, t2] = [t2, t1];
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return null;
    }
  }
  return tmin >= 0 ? tmin : tmax >= 0 ? tmax : null;
}
