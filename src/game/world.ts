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

const SAND_PALETTE = ["#c9a874", "#b89968", "#a98456", "#d4b585", "#b08858", "#8d6d44"];
const ROOF_PALETTE = ["#7a5238", "#8a5e3e", "#6b4830", "#9a6a45"];

function makeBuilding(
  rng: () => number,
  cx: number,
  cz: number,
  w: number,
  d: number,
  h: number,
): Building {
  const walls: Wall[] = [];
  const wallT = 0.4;
  const color = SAND_PALETTE[Math.floor(rng() * SAND_PALETTE.length)];
  const roofColor = ROOF_PALETTE[Math.floor(rng() * ROOF_PALETTE.length)];

  const halfW = w / 2;
  const halfD = d / 2;

  // Decide door position on one of the 4 walls
  const doorSide = Math.floor(rng() * 4); // 0=+z, 1=-z, 2=+x, 3=-x
  const doorWidth = 1.6;
  const doorHeight = 2.2;

  // Helper to add a wall with a gap (door) along an axis
  const addWallWithDoor = (
    centerX: number,
    centerZ: number,
    spanAxis: "x" | "z",
    spanLen: number,
    hasDoor: boolean,
  ) => {
    if (!hasDoor) {
      // single solid wall
      const sx = spanAxis === "x" ? spanLen : wallT;
      const sz = spanAxis === "z" ? spanLen : wallT;
      walls.push({
        pos: new THREE.Vector3(centerX, h / 2, centerZ),
        size: new THREE.Vector3(sx, h, sz),
        color,
        kind: "wall",
      });
      return;
    }
    // door is in the middle of this span
    const halfSpan = spanLen / 2;
    const halfDoor = doorWidth / 2;
    // segment 1: from -half to -halfDoor
    const seg1Len = halfSpan - halfDoor;
    const seg2Len = halfSpan - halfDoor;
    if (spanAxis === "x") {
      walls.push({
        pos: new THREE.Vector3(centerX - (halfDoor + seg1Len / 2), h / 2, centerZ),
        size: new THREE.Vector3(seg1Len, h, wallT),
        color,
        kind: "wall",
      });
      walls.push({
        pos: new THREE.Vector3(centerX + (halfDoor + seg2Len / 2), h / 2, centerZ),
        size: new THREE.Vector3(seg2Len, h, wallT),
        color,
        kind: "wall",
      });
      // lintel above door
      walls.push({
        pos: new THREE.Vector3(centerX, doorHeight + (h - doorHeight) / 2, centerZ),
        size: new THREE.Vector3(doorWidth, h - doorHeight, wallT),
        color,
        kind: "wall",
      });
    } else {
      walls.push({
        pos: new THREE.Vector3(centerX, h / 2, centerZ - (halfDoor + seg1Len / 2)),
        size: new THREE.Vector3(wallT, h, seg1Len),
        color,
        kind: "wall",
      });
      walls.push({
        pos: new THREE.Vector3(centerX, h / 2, centerZ + (halfDoor + seg2Len / 2)),
        size: new THREE.Vector3(wallT, h, seg2Len),
        color,
        kind: "wall",
      });
      walls.push({
        pos: new THREE.Vector3(centerX, doorHeight + (h - doorHeight) / 2, centerZ),
        size: new THREE.Vector3(wallT, h - doorHeight, doorWidth),
        color,
        kind: "wall",
      });
    }
  };

  // 4 walls
  addWallWithDoor(cx, cz + halfD, "x", w, doorSide === 0);
  addWallWithDoor(cx, cz - halfD, "x", w, doorSide === 1);
  addWallWithDoor(cx + halfW, cz, "z", d, doorSide === 2);
  addWallWithDoor(cx - halfW, cz, "z", d, doorSide === 3);

  // Roof (slightly thinner than walls so player can be inside)
  walls.push({
    pos: new THREE.Vector3(cx, h + 0.15, cz),
    size: new THREE.Vector3(w + 0.3, 0.3, d + 0.3),
    color: roofColor,
    kind: "roof",
  });

  // Optional second floor for taller buildings
  if (h > 8 && rng() > 0.5) {
    // floor at h/2 with hole (skip floor for simplicity, just add no floor)
    // add a small interior pillar instead
    walls.push({
      pos: new THREE.Vector3(cx + (rng() - 0.5) * (w * 0.3), h / 2, cz + (rng() - 0.5) * (d * 0.3)),
      size: new THREE.Vector3(0.6, h, 0.6),
      color,
      kind: "pillar",
    });
  }

  return {
    walls,
    min: new THREE.Vector3(cx - halfW, 0, cz - halfD),
    max: new THREE.Vector3(cx + halfW, h, cz + halfD),
  };
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
      const w = 8 + rng() * 12;
      const d = 8 + rng() * 12;
      const h = 4 + rng() * 12;
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

  // Low rolling hills and forest belts outside the city
  for (let i = 0; i < 46; i++) {
    const a = rng() * Math.PI * 2;
    const r = cityRadius + 25 + rng() * (WORLD_SIZE / 2 - cityRadius - 45);
    const radius = 28 + rng() * 48;
    const height = 0.8 + rng() * 2.2;
    const pos = new THREE.Vector3(Math.cos(a) * r, -height * 0.18, Math.sin(a) * r);
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

  // Windows on building exterior walls + awnings above doors
  const tentColors2 = ["#b04030", "#3060a0", "#a08030", "#6a4030", "#8a6020"];
  for (const b of buildings) {
    const bw = b.max.x - b.min.x;
    const bd = b.max.z - b.min.z;
    const bh = b.max.y;
    const cx = (b.min.x + b.max.x) / 2;
    const cz = (b.min.z + b.max.z) / 2;
    // Number of windows per long side ~ length/4
    const nx = Math.max(1, Math.floor(bw / 4));
    const nz = Math.max(1, Math.floor(bd / 4));
    const winH = 0.9;
    const winW = 0.7;
    const sillY = 1.6;
    for (let i = 0; i < nx; i++) {
      const fx = b.min.x + (i + 0.5) * (bw / nx);
      // skip if too close to door (center of side)
      const closeToDoor = Math.abs(fx - cx) < 1.2;
      if (!closeToDoor) {
        windows.push({
          pos: new THREE.Vector3(fx, sillY, b.min.z - 0.05),
          size: new THREE.Vector3(winW, winH, 0.05),
          lit: rng() > 0.5,
        });
        windows.push({
          pos: new THREE.Vector3(fx, sillY, b.max.z + 0.05),
          size: new THREE.Vector3(winW, winH, 0.05),
          lit: rng() > 0.5,
        });
      }
      if (bh > 7) {
        windows.push({
          pos: new THREE.Vector3(fx, sillY + 3.2, b.min.z - 0.05),
          size: new THREE.Vector3(winW, winH, 0.05),
          lit: rng() > 0.5,
        });
        windows.push({
          pos: new THREE.Vector3(fx, sillY + 3.2, b.max.z + 0.05),
          size: new THREE.Vector3(winW, winH, 0.05),
          lit: rng() > 0.5,
        });
      }
    }
    for (let i = 0; i < nz; i++) {
      const fz = b.min.z + (i + 0.5) * (bd / nz);
      const closeToDoor = Math.abs(fz - cz) < 1.2;
      if (!closeToDoor) {
        windows.push({
          pos: new THREE.Vector3(b.min.x - 0.05, sillY, fz),
          size: new THREE.Vector3(0.05, winH, winW),
          lit: rng() > 0.5,
        });
        windows.push({
          pos: new THREE.Vector3(b.max.x + 0.05, sillY, fz),
          size: new THREE.Vector3(0.05, winH, winW),
          lit: rng() > 0.5,
        });
      }
      if (bh > 7) {
        windows.push({
          pos: new THREE.Vector3(b.min.x - 0.05, sillY + 3.2, fz),
          size: new THREE.Vector3(0.05, winH, winW),
          lit: rng() > 0.5,
        });
        windows.push({
          pos: new THREE.Vector3(b.max.x + 0.05, sillY + 3.2, fz),
          size: new THREE.Vector3(0.05, winH, winW),
          lit: rng() > 0.5,
        });
      }
    }
    // Awning at random side
    const aSide = Math.floor(rng() * 4);
    const awColor = tentColors2[Math.floor(rng() * tentColors2.length)];
    if (aSide === 0) {
      awnings.push({ pos: new THREE.Vector3(cx, 2.6, b.max.z + 0.6), size: new THREE.Vector3(2.4, 0.05, 1.2), color: awColor });
    } else if (aSide === 1) {
      awnings.push({ pos: new THREE.Vector3(cx, 2.6, b.min.z - 0.6), size: new THREE.Vector3(2.4, 0.05, 1.2), color: awColor });
    } else if (aSide === 2) {
      awnings.push({ pos: new THREE.Vector3(b.max.x + 0.6, 2.6, cz), size: new THREE.Vector3(1.2, 0.05, 2.4), color: awColor });
    } else {
      awnings.push({ pos: new THREE.Vector3(b.min.x - 0.6, 2.6, cz), size: new THREE.Vector3(1.2, 0.05, 2.4), color: awColor });
    }
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
  let h = 0;
  for (const hill of world.hills) {
    const dx = x - hill.pos.x;
    const dz = z - hill.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < hill.radius) {
      const t = 1 - d / hill.radius;
      const smooth = t * t * (3 - 2 * t);
      h = Math.max(h, smooth * hill.height);
    }
  }
  return Math.min(3, h);
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
    boxes.push({
      min: new THREE.Vector3(c.pos.x - c.size / 2, 0, c.pos.z - c.size / 2),
      max: new THREE.Vector3(c.pos.x + c.size / 2, c.size, c.pos.z + c.size / 2),
    });
  }
  for (const s of world.sandbags) {
    boxes.push({
      min: new THREE.Vector3(
        s.pos.x - s.size.x / 2,
        0,
        s.pos.z - s.size.z / 2,
      ),
      max: new THREE.Vector3(
        s.pos.x + s.size.x / 2,
        s.size.y,
        s.pos.z + s.size.z / 2,
      ),
      isLow: true,
    });
  }
  for (const b of world.barrels) {
    boxes.push({
      min: new THREE.Vector3(b.pos.x - 0.35, 0, b.pos.z - 0.35),
      max: new THREE.Vector3(b.pos.x + 0.35, 1.1, b.pos.z + 0.35),
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
