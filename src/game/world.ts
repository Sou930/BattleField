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

// A decorative, non-drivable military vehicle parked on the apron (motor pool).
// These are pure set-dressing (and provide cover) so the base can be packed
// with armour without the cost/AI of fully simulated vehicles.
export interface ParkedVehicle {
  pos: THREE.Vector3;
  yaw: number;
  kind: "tank" | "apc" | "truck" | "humvee";
  color: string;
}

// A shipping container / CONEX box (also reused for supply crates near walls).
export interface Container {
  pos: THREE.Vector3;
  size: THREE.Vector3;
  yaw: number;
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

// "Nellis AFB × Aleppo" fusion map. The world is split down the middle:
//   * West half  -> Nellis Air Force Base (long runway, apron, hangars, tower)
//   * East half  -> Aleppo old city (dense war-torn blocks + hilltop Citadel)
// The map is enlarged to comfortably hold both districts side by side.
export const WORLD_SIZE = 1480; // enlarged to host the airbase + city fusion

// X coordinate that divides the airbase (west, x<0) from the ruined city
// (east, x>0). A blast-wall corridor sits along this seam.
export const DISTRICT_SEAM_X = 0;

// --- Aleppo old-city core (east side) ------------------------------------
// Center of the dense city grid and radius of the leveled urban area. Inside
// this disc the ground is flattened so streets and buildings sit level.
export const CITY_CENTER_X = WORLD_SIZE * 0.24;
export const CITY_CENTER_Z = -WORLD_SIZE * 0.04;
// Slightly larger flattened urban disc so the denser grid stays buildable.
const CITY_FLAT_RADIUS = WORLD_SIZE * 0.23 + 18;

// --- Aleppo Citadel (landmark hill-fortress on the city's NE) ------------
export const CITADEL_X = WORLD_SIZE * 0.34;
export const CITADEL_Z = -WORLD_SIZE * 0.26;
const CITADEL_RADIUS = 120;
const CITADEL_HEIGHT = 34;

// --- Nellis airfield flat zone (west side) -------------------------------
// The runway / taxiway / apron all need perfectly level ground.
export const AIRFIELD_CENTER_X = -WORLD_SIZE * 0.24;
export const AIRFIELD_CENTER_Z = 0;
const AIRFIELD_FLAT_HALF_X = WORLD_SIZE * 0.22;
const AIRFIELD_FLAT_HALF_Z = WORLD_SIZE * 0.34;

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

function smoothstep01(t: number): number {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
}

// Continuous, smoothly rolling Mojave/Syrian-steppe elevation. Flattens to ~0
// over the airfield and the city core (so both districts stay buildable), and
// raises a broad mound under the Aleppo Citadel.
export function baseTerrainHeight(x: number, z: number): number {
  // Large gentle dunes plus finer ripples (open desert between the districts).
  const dunes = (fbm2(x * 0.0042 + 11.3, z * 0.0042 - 7.1) - 0.5) * 2; // [-1,1]
  const ripples = (fbm2(x * 0.02 + 51.7, z * 0.02 + 23.9) - 0.5) * 2;
  let h = dunes * 9.0 + ripples * 1.3;

  // Flatten the Aleppo city core (circular disc on the east side).
  const distFromCity = Math.hypot(x - CITY_CENTER_X, z - CITY_CENTER_Z);
  const cityBlend = smoothstep01(
    (distFromCity - CITY_FLAT_RADIUS) / 70,
  );
  h *= cityBlend;

  // Flatten the Nellis airfield (a large rectangle on the west side) so the
  // runway, taxiway and apron are dead level.
  const adx = Math.abs(x - AIRFIELD_CENTER_X);
  const adz = Math.abs(z - AIRFIELD_CENTER_Z);
  const fieldOutside = Math.max(
    (adx - AIRFIELD_FLAT_HALF_X) / 60,
    (adz - AIRFIELD_FLAT_HALF_Z) / 60,
  );
  const fieldBlend = smoothstep01(fieldOutside);
  h *= fieldBlend;

  // Flatten the home-base airbase compound near the south edge. The compound is
  // a large rectangle, so flatten a rectangular footprint (plus a soft skirt)
  // rather than a small disc — this keeps the apron, hangars and motor pool
  // dead level and prevents terrain from poking up through the concrete.
  const bdx = Math.abs(x - BASE_POS.x);
  const bdz = Math.abs(z - BASE_POS.z);
  const baseOutside = Math.max(
    (bdx - (BASE_HALF + 6)) / 40,
    (bdz - (BASE_HALF + 6)) / 40,
  );
  h *= smoothstep01(baseOutside);

  // Raise the Citadel mound (broad, smooth hill carrying the fortress). Done
  // here (rather than as an authored hill) so it is part of the base surface
  // and the flattening above never digs into it.
  const distFromCitadel = Math.hypot(x - CITADEL_X, z - CITADEL_Z);
  if (distFromCitadel < CITADEL_RADIUS) {
    const t = 1 - distFromCitadel / CITADEL_RADIUS;
    h += smoothstep01(t) * CITADEL_HEIGHT;
  }

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

// Shift every wall (and the bounds) of a building up by `dy` so it sits on
// raised terrain instead of floating at world-y 0 / being buried.
function raiseBuilding(b: Building, dy: number) {
  if (dy === 0) return;
  for (const w of b.walls) w.pos.y += dy;
  b.min.y += dy;
  b.max.y += dy;
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
  parkedVehicles: ParkedVehicle[];
  containers: Container[];
  fountainPos: THREE.Vector3;
  basePos: THREE.Vector3;
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
  const parkedVehicles: ParkedVehicle[] = [];
  const containers: Container[] = [];

  // ======================================================================
  //  NELLIS AIR FORCE BASE  (west half, x < DISTRICT_SEAM_X)
  // ======================================================================
  // A long north-south runway with a parallel taxiway, a concrete apron
  // (flight line), rows of hangars, a control tower and jet-blast
  // revetments. Rendered using the generic road / wall / building primitives.
  const af = { x: AIRFIELD_CENTER_X, z: AIRFIELD_CENTER_Z };
  const runwayLen = WORLD_SIZE * 0.6;
  const runwayWidth = 26;

  // Main runway (dark asphalt strip).
  roads.push({
    pos: new THREE.Vector3(af.x, 0.01, af.z),
    size: new THREE.Vector3(runwayWidth, 0.02, runwayLen),
    color: "#34373c",
  });
  // Painted runway centerline dashes.
  const dashCount = 40;
  for (let i = 0; i < dashCount; i++) {
    const dz = -runwayLen / 2 + (i + 0.5) * (runwayLen / dashCount);
    roads.push({
      pos: new THREE.Vector3(af.x, 0.03, af.z + dz),
      size: new THREE.Vector3(1.0, 0.02, runwayLen / dashCount * 0.5),
      color: "#d8d8c8",
    });
  }
  // Threshold "piano key" bars at each runway end.
  for (const end of [-1, 1]) {
    for (let k = -3; k <= 3; k++) {
      roads.push({
        pos: new THREE.Vector3(af.x + k * 3, 0.03, af.z + end * (runwayLen / 2 - 8)),
        size: new THREE.Vector3(1.8, 0.02, 10),
        color: "#e6e6da",
      });
    }
  }

  // Parallel taxiway east of the runway.
  const taxiX = af.x + 60;
  roads.push({
    pos: new THREE.Vector3(taxiX, 0.01, af.z),
    size: new THREE.Vector3(14, 0.02, runwayLen * 0.92),
    color: "#3c4046",
  });
  // Connector taxiways linking runway and taxiway.
  for (const cz of [-runwayLen * 0.32, 0, runwayLen * 0.32]) {
    roads.push({
      pos: new THREE.Vector3((af.x + taxiX) / 2, 0.01, af.z + cz),
      size: new THREE.Vector3(taxiX - af.x, 0.02, 12),
      color: "#3c4046",
    });
  }

  // Concrete apron / flight line east of the taxiway, where aircraft park.
  const apronX = taxiX + 70;
  const apronW = 110;
  const apronD = runwayLen * 0.55;
  roads.push({
    pos: new THREE.Vector3(apronX, 0.01, af.z),
    size: new THREE.Vector3(apronW, 0.02, apronD),
    color: "#9a958a",
  });

  // Hangars: large, low, wide buildings along the back (west) edge of the apron.
  const hangarColor = "#5d6b74";
  const hangarRoof = "#42505a";
  for (let i = 0; i < 5; i++) {
    const hz = af.z - apronD / 2 + 30 + i * (apronD - 60) / 4;
    const hx = apronX - apronW / 2 - 22;
    const hw = 34;
    const hd = 26;
    const hh = 12;
    const walls2: Wall[] = [];
    const wt = 0.6;
    const halfW = hw / 2;
    const halfD = hd / 2;
    // side + back walls (front, facing apron at +x, left open as a hangar door)
    walls2.push({ pos: new THREE.Vector3(hx - halfW, hh / 2, hz), size: new THREE.Vector3(wt, hh, hd), color: hangarColor, kind: "wall" });
    walls2.push({ pos: new THREE.Vector3(hx, hh / 2, hz - halfD), size: new THREE.Vector3(hw, hh, wt), color: hangarColor, kind: "wall" });
    walls2.push({ pos: new THREE.Vector3(hx, hh / 2, hz + halfD), size: new THREE.Vector3(hw, hh, wt), color: hangarColor, kind: "wall" });
    // narrow front jambs either side of the big door opening (+x face)
    const jamb = 5;
    walls2.push({ pos: new THREE.Vector3(hx + halfW, hh / 2, hz - halfD + jamb / 2), size: new THREE.Vector3(wt, hh, jamb), color: hangarColor, kind: "wall" });
    walls2.push({ pos: new THREE.Vector3(hx + halfW, hh / 2, hz + halfD - jamb / 2), size: new THREE.Vector3(wt, hh, jamb), color: hangarColor, kind: "wall" });
    // curved-ish arched roof approximated by a flat slab + raised ridge
    walls2.push({ pos: new THREE.Vector3(hx, hh + 0.4, hz), size: new THREE.Vector3(hw + 1, 0.8, hd + 1), color: hangarRoof, kind: "roof" });
    walls2.push({ pos: new THREE.Vector3(hx, hh + 1.4, hz), size: new THREE.Vector3(hw * 0.6, 1.2, hd + 1), color: hangarRoof, kind: "roof" });
    buildings.push({
      walls: walls2,
      min: new THREE.Vector3(hx - halfW, 0, hz - halfD),
      max: new THREE.Vector3(hx + halfW, hh, hz + halfD),
      info: { cx: hx, cz: hz, w: hw, d: hd, h: hh, floors: 1, floorH: hh, doorSide: 2, color: hangarColor, roofColor: hangarRoof, hasParapet: false },
    });

    // A parked "aircraft" silhouette on the apron in front of each hangar,
    // suggested with low boxes (fuselage + wings) treated as cover crates.
    const px = apronX - 10;
    crates.push({ pos: new THREE.Vector3(px, 1.0, hz), size: 2.2, color: "#7a8088" });
    crates.push({ pos: new THREE.Vector3(px + 4, 0.8, hz), size: 1.6, color: "#6f757d" });
  }

  // Control tower: a tall slim building at the south end of the apron.
  {
    const tx = apronX + apronW / 2 - 16;
    const tz = af.z + apronD / 2 - 24;
    buildings.push(makeBuilding(rng, tx, tz, 9, 9, STOREY_HEIGHT * 7));
    // glass cab on top suggested with a wider parapet box
    buildings.push(makeBuilding(rng, tx, tz, 12, 12, STOREY_HEIGHT * 1));
  }

  // Jet-blast revetments / fuel storage on the apron: rows of blast walls and
  // fuel drums, reusing sandbag barriers + barrels.
  for (let i = 0; i < 6; i++) {
    const rz = af.z - apronD / 2 + 40 + i * (apronD - 80) / 5;
    const rx = apronX + apronW / 2 - 36;
    sandbags.push({ pos: new THREE.Vector3(rx, 1.4, rz), size: new THREE.Vector3(10, 2.8, 1.0), color: "#8a8f86", kind: "barrier" });
    barrels.push({ pos: new THREE.Vector3(rx + 4, 0, rz + 2), color: "#3a3a3a" });
    barrels.push({ pos: new THREE.Vector3(rx + 4, 0, rz - 2), color: "#7a4a1a" });
  }

  // Perimeter fence posts (lamps double as floodlight poles) around the field.
  for (let i = -6; i <= 6; i++) {
    lamps.push({ pos: new THREE.Vector3(af.x - AIRFIELD_FLAT_HALF_X * 0.7, 0, af.z + i * (runwayLen / 13)) });
  }

  // ======================================================================
  //  ALEPPO OLD CITY  (east half, x > DISTRICT_SEAM_X)
  // ======================================================================
  // A dense, partly-ruined grid of buildings with narrow streets, a market
  // plaza around the central fountain, and the Citadel landmark on a hill.
  const cityCX = CITY_CENTER_X;
  const cityCZ = CITY_CENTER_Z;
  const citySize = WORLD_SIZE * 0.46;
  const cityRadius = CITY_FLAT_RADIUS - 8;
  // Denser grid: more, smaller blocks separated by narrow alleys, like a real
  // medieval old-city quarter.
  const cells = 20;
  const cellSize = citySize / cells;
  const plazaX = cityCX;
  const plazaZ = cityCZ;
  // A narrow alley gap kept between adjacent building footprints so the dense
  // grid still has walkable streets.
  const alley = 1.6;
  for (let gx = 0; gx < cells; gx++) {
    for (let gz = 0; gz < cells; gz++) {
      const cx0 = cityCX - citySize / 2 + (gx + 0.5) * cellSize;
      const cz0 = cityCZ - citySize / 2 + (gz + 0.5) * cellSize;
      const dPlaza = Math.hypot(cx0 - plazaX, cz0 - plazaZ);
      if (dPlaza < cellSize * 1.6) continue; // keep market plaza clear
      if (Math.hypot(cx0 - cityCX, cz0 - cityCZ) > cityRadius) continue;
      // Leave the Citadel hill clear of ordinary houses.
      if (Math.hypot(cx0 - CITADEL_X, cz0 - CITADEL_Z) < CITADEL_RADIUS * 0.8) continue;
      // Keep the main cross-streets (every grid line through the center) clear
      // so the city reads as blocks divided by roads rather than a solid mass.
      const onMainStreetX = Math.abs(cx0 - cityCX) < cellSize * 0.5;
      const onMainStreetZ = Math.abs(cz0 - cityCZ) < cellSize * 0.5;
      if (onMainStreetX || onMainStreetZ) continue;

      if (rng() < 0.07) continue; // occasional alley / rubble lot (much denser now)

      // How much of the cell the footprint fills (densely packed: most of it,
      // minus a slim alley). Buildings sit flush to the block so the streets
      // become genuine narrow corridors.
      const maxW = cellSize - alley;
      const maxD = cellSize - alley;

      // ~28% of lots get split into 2–3 adjacent row-houses sharing party
      // walls (typical dense souk / residential terrace).
      const rowHouse = rng() < 0.28 && maxW > 9;
      if (rowHouse) {
        const n = 2 + (rng() < 0.4 ? 1 : 0);
        const segW = (maxW - (n - 1) * 0.3) / n;
        for (let s = 0; s < n; s++) {
          const sx = cx0 - maxW / 2 + segW / 2 + s * (segW + 0.3);
          const sd = Math.min(maxD, 7 + rng() * (maxD - 7));
          const tower = rng() < 0.18;
          const h = tower
            ? STOREY_HEIGHT * (3.5 + rng() * 2.0)
            : STOREY_HEIGHT * (2 + rng() * 2.2);
          const b = makeBuilding(rng, sx, cz0, segW, sd, h);
          buildings.push(b);
        }
      } else {
        const w = Math.min(maxW, 8 + rng() * (maxW - 8));
        const d = Math.min(maxD, 8 + rng() * (maxD - 8));
        // More tall towers (~30%) for a denser, taller skyline.
        const tower = rng() < 0.3;
        const h = tower
          ? STOREY_HEIGHT * (3.5 + rng() * 2.5)
          : STOREY_HEIGHT * (1 + rng() * 2.6);
        const b = makeBuilding(rng, cx0 + (rng() - 0.5) * 1.5, cz0 + (rng() - 0.5) * 1.5, w, d, h);
        buildings.push(b);
        // War damage: pile rubble crates against ~55% of buildings.
        if (rng() < 0.55) {
          for (let r = 0; r < 2 + Math.floor(rng() * 4); r++) {
            const rx = b.min.x + rng() * (b.max.x - b.min.x);
            const rz = b.max.z + 0.6 + rng() * 1.5;
            crates.push({ pos: new THREE.Vector3(rx, 0.5, rz), size: 0.7 + rng() * 0.9, color: "#6b6256" });
          }
        }
      }
    }
  }

  // ---- The Aleppo Citadel: fortress wall ring on top of the raised hill ----
  // Citadel ring walls / towers are pure cover geometry (no storeys), so they
  // are kept in a separate wall list rather than the `buildings` array (which
  // is reserved for things with per-storey metadata).
  const citadelWalls: Wall[] = [];
  {
    const ringR = 44;
    const segs = 18;
    const cwH = 9;
    const cwT = 2.2;
    for (let i = 0; i < segs; i++) {
      // leave a gate gap on the south-west approach
      if (i === 13 || i === 14) continue;
      const a0 = (i / segs) * Math.PI * 2;
      const a1 = ((i + 1) / segs) * Math.PI * 2;
      const mx = CITADEL_X + Math.cos((a0 + a1) / 2) * ringR;
      const mz = CITADEL_Z + Math.sin((a0 + a1) / 2) * ringR;
      // Seat each wall segment on the citadel mound so it doesn't float above
      // (or sink into) the raised terrain. Extend the box downward so the wall
      // always meets the ground even where the slope dips slightly.
      const groundY = baseTerrainHeight(mx, mz);
      const skirt = 4; // extra depth buried into the slope to avoid gaps
      const segLen = ringR * (Math.PI * 2 / segs) + 1.5;
      const ang = (a0 + a1) / 2 + Math.PI / 2;
      // approximate the tangential wall segment with an axis-aligned box whose
      // longer side roughly follows the ring (good enough at this scale)
      const alongX = Math.abs(Math.cos(ang)) > Math.abs(Math.sin(ang));
      const wH = cwH + skirt;
      citadelWalls.push({
        pos: new THREE.Vector3(mx, groundY + cwH / 2 - skirt / 2, mz),
        size: alongX
          ? new THREE.Vector3(segLen, wH, cwT)
          : new THREE.Vector3(cwT, wH, segLen),
        color: "#7a6b52",
        kind: "wall",
      });
      // corner towers every few segments
      if (i % 3 === 0) {
        const tx = CITADEL_X + Math.cos(a0) * ringR;
        const tz = CITADEL_Z + Math.sin(a0) * ringR;
        const tGround = baseTerrainHeight(tx, tz);
        citadelWalls.push({
          pos: new THREE.Vector3(tx, tGround + 6.5 - skirt / 2, tz),
          size: new THREE.Vector3(6, 13 + skirt, 6),
          color: "#8a7a5e",
          kind: "wall",
        });
      }
    }
    // central keep (a real building with storeys the player can enter), seated
    // on top of the citadel mound.
    const keep = makeBuilding(rng, CITADEL_X, CITADEL_Z, 22, 22, STOREY_HEIGHT * 4);
    raiseBuilding(keep, baseTerrainHeight(CITADEL_X, CITADEL_Z));
    buildings.push(keep);
  }

  // Wooden crates as cover, concentrated in the city, sparse in the desert.
  for (let i = 0; i < 340; i++) {
    const s = 0.9 + rng() * 0.7;
    const inCity = rng() > 0.3;
    let px: number, pz: number;
    if (inCity) {
      px = cityCX + (rng() - 0.5) * citySize;
      pz = cityCZ + (rng() - 0.5) * citySize;
    } else {
      px = (rng() - 0.5) * (WORLD_SIZE - 40);
      pz = (rng() - 0.5) * (WORLD_SIZE - 40);
    }
    const p = new THREE.Vector3(px, s / 2, pz);
    if (insideAnyBuilding(p, buildings, 0.5)) continue;
    const woodPalette = ["#6b4a2b", "#825a35", "#5a3e22", "#7a5028"];
    crates.push({ pos: p, size: s, color: woodPalette[Math.floor(rng() * woodPalette.length)] });
  }

  // Oil barrels scattered everywhere (more around the city / airfield).
  for (let i = 0; i < 110; i++) {
    const p = new THREE.Vector3(
      (rng() - 0.5) * (WORLD_SIZE - 30),
      0,
      (rng() - 0.5) * (WORLD_SIZE - 30),
    );
    if (insideAnyBuilding(p, buildings, 0.5)) continue;
    const colors = ["#9a2a1a", "#2a4a8a", "#3a3a3a", "#7a4a1a"];
    barrels.push({ pos: p, color: colors[Math.floor(rng() * colors.length)] });
  }

  // Broad desert mounds in the open ground between the districts.
  for (let i = 0; i < 30; i++) {
    const px = (rng() - 0.5) * WORLD_SIZE * 0.9;
    const pz = (rng() - 0.5) * WORLD_SIZE * 0.9;
    // keep mounds out of the flat airfield and city
    if (Math.abs(px - af.x) < AIRFIELD_FLAT_HALF_X + 30 && Math.abs(pz - af.z) < AIRFIELD_FLAT_HALF_Z + 30) continue;
    if (Math.hypot(px - cityCX, pz - cityCZ) < CITY_FLAT_RADIUS + 30) continue;
    // Keep mounds out of the (flattened) home base too. Authored hills are
    // added on top of the base terrain by terrainHeightAt(), so a mound here
    // would raise the ground *inside* the flattened compound and read as
    // "terrain stacked on terrain" poking through the apron. The mound radius
    // can reach ~115, so pad the exclusion generously.
    const baseR = 115 + 30;
    if (Math.abs(px - BASE_POS.x) < BASE_HALF + baseR && Math.abs(pz - BASE_POS.z) < BASE_HALF + baseR) continue;
    const radius = 45 + rng() * 70;
    const height = 3 + rng() * 7;
    hills.push({ pos: new THREE.Vector3(px, 0, pz), radius, height, color: rng() > 0.45 ? "#8a7a54" : "#6f8152" });
  }

  // Trees: a few palms/poplars in city courtyards, scrub in the desert.
  for (let i = 0; i < 230; i++) {
    const inCity = rng() > 0.5;
    const px = inCity ? cityCX + (rng() - 0.5) * citySize : (rng() - 0.5) * (WORLD_SIZE - 30);
    const pz = inCity ? cityCZ + (rng() - 0.5) * citySize : (rng() - 0.5) * (WORLD_SIZE - 30);
    const p = new THREE.Vector3(px, 0, pz);
    if (insideAnyBuilding(p, buildings, 1)) continue;
    // keep trees off the runway/apron
    if (Math.abs(px - af.x) < AIRFIELD_FLAT_HALF_X && Math.abs(pz - af.z) < AIRFIELD_FLAT_HALF_Z) continue;
    palms.push({ pos: p, height: 4 + rng() * 3 });
  }

  // Sandbag clusters / checkpoints, concentrated along the district seam and
  // around the city — the front line of the fused battlefield.
  for (let i = 0; i < 140; i++) {
    const onSeam = rng() < 0.4;
    let cx: number, cz: number;
    if (onSeam) {
      cx = DISTRICT_SEAM_X + (rng() - 0.5) * 30;
      cz = (rng() - 0.5) * WORLD_SIZE * 0.7;
    } else {
      cx = cityCX + (rng() - 0.5) * citySize;
      cz = cityCZ + (rng() - 0.5) * citySize;
    }
    if (insideAnyBuilding(new THREE.Vector3(cx, 0, cz), buildings, 2)) continue;
    const horizontal = rng() > 0.5;
    const length = 3 + rng() * 3;
    sandbags.push({
      pos: new THREE.Vector3(cx, 0.45, cz),
      size: horizontal ? new THREE.Vector3(length, 0.9, 0.6) : new THREE.Vector3(0.6, 0.9, length),
      color: "#a8895a",
      kind: "barrier",
    });
  }

  // Aleppo streets: main cross through the city + ring + alleys.
  const roadColor = "#6f5b3c";
  roads.push({ pos: new THREE.Vector3(cityCX, 0.01, cityCZ), size: new THREE.Vector3(citySize, 0.02, 7), color: roadColor });
  roads.push({ pos: new THREE.Vector3(cityCX, 0.01, cityCZ), size: new THREE.Vector3(7, 0.02, citySize), color: roadColor });
  // A finer mesh of secondary streets / alleys matching the denser grid, so
  // the packed blocks are separated by genuine walkable lanes.
  const halfCells = Math.floor(cells / 2);
  for (let i = -halfCells; i <= halfCells; i++) {
    if (i === 0) continue;
    const minor = Math.abs(i) % 2 === 0;
    const lane = minor ? 3.2 : 2.0;
    const laneColor = minor ? "#7a6444" : "#6a553a";
    roads.push({ pos: new THREE.Vector3(cityCX, 0.01, cityCZ + i * cellSize), size: new THREE.Vector3(citySize, 0.02, lane), color: laneColor });
    roads.push({ pos: new THREE.Vector3(cityCX + i * cellSize, 0.01, cityCZ), size: new THREE.Vector3(lane, 0.02, citySize), color: laneColor });
  }
  // A long approach road linking the airfield apron to the city.
  roads.push({ pos: new THREE.Vector3((apronX + cityCX) / 2, 0.01, 0), size: new THREE.Vector3(cityCX - apronX, 0.02, 9), color: "#5a4d34" });

  // Market tents — two denser rings around the central fountain plaza,
  // forming a busy souk.
  const tentColors = ["#b04030", "#3060a0", "#a08030", "#6a4030", "#8a6020", "#406a40"];
  for (let i = 0; i < 34; i++) {
    const a = (i / 34) * Math.PI * 2 + (i % 2) * 0.09;
    const r = 18 + (i % 4) * 5;
    const tx = plazaX + Math.cos(a) * r;
    const tz = plazaZ + Math.sin(a) * r;
    if (insideAnyBuilding(new THREE.Vector3(tx, 0, tz), buildings, 1.2)) continue;
    tents.push({ pos: new THREE.Vector3(tx, 0, tz), color: tentColors[Math.floor(rng() * tentColors.length)] });
  }

  // Street lamps along the city's main roads (now reaching further out to line
  // the denser grid).
  for (let i = -8; i <= 8; i++) {
    if (i === 0) continue;
    lamps.push({ pos: new THREE.Vector3(cityCX + i * cellSize, 0, cityCZ + 4) });
    lamps.push({ pos: new THREE.Vector3(cityCX + i * cellSize, 0, cityCZ - 4) });
    lamps.push({ pos: new THREE.Vector3(cityCX + 4, 0, cityCZ + i * cellSize) });
    lamps.push({ pos: new THREE.Vector3(cityCX - 4, 0, cityCZ + i * cellSize) });
  }

  // Pickups inside buildings.
  const weaponPool: ("rifle" | "pistol" | "smg" | "sniper")[] = ["rifle", "pistol", "smg", "sniper"];
  for (const b of buildings) {
    if (!b.info) continue; // skip citadel wall segments / towers
    if (rng() < 0.7) {
      const px = (b.min.x + b.max.x) / 2 + (rng() - 0.5) * (b.max.x - b.min.x) * 0.5;
      const pz = (b.min.z + b.max.z) / 2 + (rng() - 0.5) * (b.max.z - b.min.z) * 0.5;
      const roll = rng();
      if (roll < 0.4) pickupSpawns.push({ pos: new THREE.Vector3(px, 0.6, pz), kind: "weapon", weaponId: weaponPool[Math.floor(rng() * weaponPool.length)] });
      else if (roll < 0.7) pickupSpawns.push({ pos: new THREE.Vector3(px, 0.4, pz), kind: "ammo", amount: 60 });
      else if (roll < 0.9) pickupSpawns.push({ pos: new THREE.Vector3(px, 0.4, pz), kind: "health", amount: 50 });
      else pickupSpawns.push({ pos: new THREE.Vector3(px, 0.4, pz), kind: "grenade", amount: 2 });
    }
  }

  // Windows + balconies + awnings on the city buildings (skip airbase/citadel).
  const tentColors2 = ["#b04030", "#3060a0", "#a08030", "#6a4030", "#8a6020"];
  for (const b of buildings) {
    if (!b.info) continue;
    if (b.info.color === hangarColor) continue; // hangars have no windows
    const { cx, cz, w: bw, d: bd, floors, floorH, doorSide } = b.info;
    const nx = Math.max(1, Math.floor(bw / 3.2));
    const nz = Math.max(1, Math.floor(bd / 3.2));
    const winH = 1.1;
    const winW = 0.8;
    for (let f = 0; f < floors; f++) {
      const sillY = f * floorH + floorH * 0.5;
      for (let i = 0; i < nx; i++) {
        const fx = b.min.x + (i + 0.5) * (bw / nx);
        const overDoorZpos = f === 0 && doorSide === 0 && Math.abs(fx - cx) < 1.3;
        const overDoorZneg = f === 0 && doorSide === 1 && Math.abs(fx - cx) < 1.3;
        if (!overDoorZpos) windows.push({ pos: new THREE.Vector3(fx, sillY, b.max.z + 0.06), size: new THREE.Vector3(winW, winH, 0.06), lit: rng() > 0.55 });
        if (!overDoorZneg) windows.push({ pos: new THREE.Vector3(fx, sillY, b.min.z - 0.06), size: new THREE.Vector3(winW, winH, 0.06), lit: rng() > 0.55 });
      }
      for (let i = 0; i < nz; i++) {
        const fz = b.min.z + (i + 0.5) * (bd / nz);
        const overDoorXpos = f === 0 && doorSide === 2 && Math.abs(fz - cz) < 1.3;
        const overDoorXneg = f === 0 && doorSide === 3 && Math.abs(fz - cz) < 1.3;
        if (!overDoorXpos) windows.push({ pos: new THREE.Vector3(b.max.x + 0.06, sillY, fz), size: new THREE.Vector3(0.06, winH, winW), lit: rng() > 0.55 });
        if (!overDoorXneg) windows.push({ pos: new THREE.Vector3(b.min.x - 0.06, sillY, fz), size: new THREE.Vector3(0.06, winH, winW), lit: rng() > 0.55 });
      }
      if (f >= 1 && rng() < 0.35) {
        const balconyY = f * floorH + 0.2;
        const bSide = Math.floor(rng() * 4);
        const bColor = ROOF_PALETTE[Math.floor(rng() * ROOF_PALETTE.length)];
        if (bSide === 0) awnings.push({ pos: new THREE.Vector3(cx, balconyY, b.max.z + 0.7), size: new THREE.Vector3(Math.min(bw * 0.6, 3), 0.16, 1.3), color: bColor });
        else if (bSide === 1) awnings.push({ pos: new THREE.Vector3(cx, balconyY, b.min.z - 0.7), size: new THREE.Vector3(Math.min(bw * 0.6, 3), 0.16, 1.3), color: bColor });
        else if (bSide === 2) awnings.push({ pos: new THREE.Vector3(b.max.x + 0.7, balconyY, cz), size: new THREE.Vector3(1.3, 0.16, Math.min(bd * 0.6, 3)), color: bColor });
        else awnings.push({ pos: new THREE.Vector3(b.min.x - 0.7, balconyY, cz), size: new THREE.Vector3(1.3, 0.16, Math.min(bd * 0.6, 3)), color: bColor });
      }
    }
    const awColor = tentColors2[Math.floor(rng() * tentColors2.length)];
    if (doorSide === 0) awnings.push({ pos: new THREE.Vector3(cx, 2.6, b.max.z + 0.6), size: new THREE.Vector3(2.6, 0.05, 1.2), color: awColor });
    else if (doorSide === 1) awnings.push({ pos: new THREE.Vector3(cx, 2.6, b.min.z - 0.6), size: new THREE.Vector3(2.6, 0.05, 1.2), color: awColor });
    else if (doorSide === 2) awnings.push({ pos: new THREE.Vector3(b.max.x + 0.6, 2.6, cz), size: new THREE.Vector3(1.2, 0.05, 2.6), color: awColor });
    else awnings.push({ pos: new THREE.Vector3(b.min.x - 0.6, 2.6, cz), size: new THREE.Vector3(1.2, 0.05, 2.6), color: awColor });
  }

  // Decorative rugs around the market plaza.
  const rugColors = ["#7a2030", "#205a7a", "#a06020", "#5a3070"];
  for (let i = 0; i < 14; i++) {
    const a = rng() * Math.PI * 2;
    const r = 8 + rng() * 10;
    const px = plazaX + Math.cos(a) * r;
    const pz = plazaZ + Math.sin(a) * r;
    if (insideAnyBuilding(new THREE.Vector3(px, 0, pz), buildings, 0.5)) continue;
    rugs.push({
      pos: new THREE.Vector3(px, 0.03, pz),
      size: new THREE.Vector3(2.2 + rng() * 1.5, 0.02, 1.4 + rng() * 1.0),
      color: rugColors[Math.floor(rng() * rugColors.length)],
      rot: rng() * Math.PI,
    });
  }

  // Perimeter walls. The open desert along the map edges is NOT flattened, so
  // the ground rolls by up to ~±9 units. To stop dunes poking through (or the
  // wall floating over a dip) the wall box is extended well below y=0 with a
  // deep "skirt" and its visible top kept at a constant height. The center is
  // lowered by half the skirt so the top stays put while the base buries into
  // the terrain everywhere along the edge.
  const wallH = 8;
  const wallSkirt = 16; // buried depth to bridge the rolling desert edge
  const wallT = 1.5;
  const totalH = wallH + wallSkirt;
  const wallY = wallH / 2 - wallSkirt / 2; // top stays at wallH, base at -wallSkirt
  const perimeter: Wall[] = [
    { pos: new THREE.Vector3(0, wallY, WORLD_SIZE / 2), size: new THREE.Vector3(WORLD_SIZE, totalH, wallT), color: "#7a5d3a", kind: "wall" },
    { pos: new THREE.Vector3(0, wallY, -WORLD_SIZE / 2), size: new THREE.Vector3(WORLD_SIZE, totalH, wallT), color: "#7a5d3a", kind: "wall" },
    { pos: new THREE.Vector3(WORLD_SIZE / 2, wallY, 0), size: new THREE.Vector3(wallT, totalH, WORLD_SIZE), color: "#7a5d3a", kind: "wall" },
    { pos: new THREE.Vector3(-WORLD_SIZE / 2, wallY, 0), size: new THREE.Vector3(wallT, totalH, WORLD_SIZE), color: "#7a5d3a", kind: "wall" },
  ];

  // Blast-wall corridor along the district seam (concrete T-walls), with gaps.
  for (let i = -8; i <= 8; i++) {
    if (i % 3 === 0) continue; // gaps to cross between districts
    sandbags.push({
      pos: new THREE.Vector3(DISTRICT_SEAM_X, 2.0, i * (WORLD_SIZE * 0.8 / 17)),
      size: new THREE.Vector3(1.4, 4.0, WORLD_SIZE * 0.8 / 17 - 4),
      color: "#9a958c",
      kind: "barrier",
    });
  }

  // --- Home base (large forward-operating airbase) near the south edge ----
  const baseWalls = buildBaseCompound(rng, buildings, parkedVehicles, containers, barrels, sandbags, lamps, crates, roads);

  const walls: Wall[] = [];
  for (const b of buildings) walls.push(...b.walls);
  walls.push(...citadelWalls);
  walls.push(...perimeter);
  walls.push(...baseWalls);

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
  for (const pv of parkedVehicles) pv.pos.y += groundAt(pv.pos.x, pv.pos.z);
  for (const ct of containers) ct.pos.y += groundAt(ct.pos.x, ct.pos.z);

  // Seat every road decal onto the terrain so the asphalt/concrete follows the
  // rolling ground instead of clipping through it or hovering above it. The
  // small base offset is kept so the strip renders just above the dirt. (The
  // airfield, city core and base are already flattened, so this only matters
  // along the connecting desert roads.)
  for (const r of roads) {
    r.pos.y = groundAt(r.pos.x, r.pos.z) + Math.max(0.02, r.pos.y);
  }

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
    parkedVehicles,
    containers,
    fountainPos: new THREE.Vector3(CITY_CENTER_X, 0, CITY_CENTER_Z),
    basePos: BASE_POS.clone(),
  };
}

// === HOME BASE (forward operating airbase) ================================
// Center of the walled home base, placed near the south edge of the expanded
// map (just inside the perimeter wall). The compound is a large fortified
// airbase: a concrete apron with a control tower + command block, a row of
// hangars, a packed motor pool of parked armour, fuel/ammo storage and a
// T-wall + container perimeter. The north side (facing the battlefield / -z)
// has a wide gate so vehicles can drive out.
export const BASE_POS = new THREE.Vector3(0, 0, WORLD_SIZE / 2 - 120);
export const BASE_HALF = 92; // half-extent of the square compound (greatly enlarged)

// Build the home-base airbase compound: perimeter T-walls plus all the
// authored structures and motor-pool dressing. Returns the collidable wall
// segments; buildings / vehicles / props are pushed into the shared arrays.
function buildBaseCompound(
  rng: () => number,
  buildings: Building[],
  parkedVehicles: ParkedVehicle[],
  containers: Container[],
  barrels: Barrel[],
  sandbags: Wall[],
  lamps: Lamp[],
  crates: Crate[],
  roads: Road[],
): Wall[] {
  const walls: Wall[] = [];
  const cx = BASE_POS.x;
  const cz = BASE_POS.z;
  const half = BASE_HALF;

  // --- Concrete apron covering the whole compound floor ------------------
  // Rendered as a thin road decal (NOT a solid floor box) so it sits flush on
  // the flattened terrain instead of stacking a second slab of "ground" on top
  // of it. The decal is also excluded from collision, so the player no longer
  // bumps an invisible curb when walking across the compound.
  roads.push({
    pos: new THREE.Vector3(cx, 0.02, cz),
    size: new THREE.Vector3(half * 2 - 2, 0.02, half * 2 - 2),
    color: "#9a958a",
  });

  // --- Perimeter T-wall (concrete blast wall) with a north gate ----------
  const wallH = 5.5;
  const wallT = 1.4;
  const wallColor = "#9a958c";
  const gate = 22; // wide vehicle gate on the north wall
  // South wall (full, facing the map edge)
  walls.push({ pos: new THREE.Vector3(cx, wallH / 2, cz + half), size: new THREE.Vector3(half * 2, wallH, wallT), color: wallColor, kind: "wall" });
  // East + West walls (full)
  walls.push({ pos: new THREE.Vector3(cx + half, wallH / 2, cz), size: new THREE.Vector3(wallT, wallH, half * 2), color: wallColor, kind: "wall" });
  walls.push({ pos: new THREE.Vector3(cx - half, wallH / 2, cz), size: new THREE.Vector3(wallT, wallH, half * 2), color: wallColor, kind: "wall" });
  // North wall split into two segments leaving a central gate.
  const sideLen = half - gate / 2;
  if (sideLen > 0.1) {
    walls.push({ pos: new THREE.Vector3(cx - (gate / 2 + sideLen / 2), wallH / 2, cz - half), size: new THREE.Vector3(sideLen, wallH, wallT), color: wallColor, kind: "wall" });
    walls.push({ pos: new THREE.Vector3(cx + (gate / 2 + sideLen / 2), wallH / 2, cz - half), size: new THREE.Vector3(sideLen, wallH, wallT), color: wallColor, kind: "wall" });
  }
  // Gate pillars either side of the opening.
  for (const sx of [-1, 1]) {
    walls.push({ pos: new THREE.Vector3(cx + sx * gate / 2, wallH / 2 + 0.6, cz - half), size: new THREE.Vector3(2.2, wallH + 1.2, 2.6), color: "#8a857c", kind: "pillar" });
  }
  // Floodlight poles spaced along the inside of the perimeter.
  for (let i = -2; i <= 2; i++) {
    lamps.push({ pos: new THREE.Vector3(cx + i * (half * 0.85 / 2), 0, cz + half - 4) });
    lamps.push({ pos: new THREE.Vector3(cx - half + 4, 0, cz + i * (half * 0.85 / 2)) });
    lamps.push({ pos: new THREE.Vector3(cx + half - 4, 0, cz + i * (half * 0.85 / 2)) });
  }

  // --- Control tower + command building (south-east corner) --------------
  const towerX = cx + half * 0.5;
  const towerZ = cz + half * 0.45;
  const cmd = makeBuilding(rng, towerX - 16, towerZ, 26, 18, STOREY_HEIGHT * 3);
  buildings.push(cmd);
  // Slim control tower shaft + glass cab on top.
  const tower = makeBuilding(rng, towerX, towerZ, 9, 9, STOREY_HEIGHT * 7);
  buildings.push(tower);
  const cab = makeBuilding(rng, towerX, towerZ, 12, 12, STOREY_HEIGHT * 1);
  raiseBuilding(cab, STOREY_HEIGHT * 7);
  buildings.push(cab);

  // --- Row of hangars along the west wall, doors facing the apron (+x) ----
  const hangarColor = "#5d6b74";
  const hangarRoof = "#42505a";
  for (let i = 0; i < 3; i++) {
    const hz = cz - half * 0.5 + i * (half * 0.9 / 2);
    const hx = cx - half + 24;
    const hw = 34, hd = 24, hh = 12;
    const hWalls: Wall[] = [];
    const wt = 0.6;
    const hW2 = hw / 2, hD2 = hd / 2;
    hWalls.push({ pos: new THREE.Vector3(hx - hW2, hh / 2, hz), size: new THREE.Vector3(wt, hh, hd), color: hangarColor, kind: "wall" });
    hWalls.push({ pos: new THREE.Vector3(hx, hh / 2, hz - hD2), size: new THREE.Vector3(hw, hh, wt), color: hangarColor, kind: "wall" });
    hWalls.push({ pos: new THREE.Vector3(hx, hh / 2, hz + hD2), size: new THREE.Vector3(hw, hh, wt), color: hangarColor, kind: "wall" });
    const jamb = 5;
    hWalls.push({ pos: new THREE.Vector3(hx + hW2, hh / 2, hz - hD2 + jamb / 2), size: new THREE.Vector3(wt, hh, jamb), color: hangarColor, kind: "wall" });
    hWalls.push({ pos: new THREE.Vector3(hx + hW2, hh / 2, hz + hD2 - jamb / 2), size: new THREE.Vector3(wt, hh, jamb), color: hangarColor, kind: "wall" });
    hWalls.push({ pos: new THREE.Vector3(hx, hh + 0.4, hz), size: new THREE.Vector3(hw + 1, 0.8, hd + 1), color: hangarRoof, kind: "roof" });
    hWalls.push({ pos: new THREE.Vector3(hx, hh + 1.4, hz), size: new THREE.Vector3(hw * 0.6, 1.2, hd + 1), color: hangarRoof, kind: "roof" });
    buildings.push({
      walls: hWalls,
      min: new THREE.Vector3(hx - hW2, 0, hz - hD2),
      max: new THREE.Vector3(hx + hW2, hh, hz + hD2),
      info: { cx: hx, cz: hz, w: hw, d: hd, h: hh, floors: 1, floorH: hh, doorSide: 2, color: hangarColor, roofColor: hangarRoof, hasParapet: false },
    });
  }

  // --- Motor pool: organized rows of parked armour on the apron ----------
  // Mirrors the reference image: neat parallel rows of tanks, APCs, trucks
  // and humvees facing the gate (north). Camo sand/olive palette.
  const camo = ["#7c7355", "#6f6a4a", "#857a58", "#5f6347", "#8a7f5d"];
  const rowKinds: ParkedVehicle["kind"][] = ["tank", "apc", "humvee", "truck"];
  const poolX0 = cx - 6;          // left edge of the motor pool
  const poolZ0 = cz - half * 0.55; // front (north) edge
  const cols = 5;
  const rows = 6;
  const colGap = 13;
  const rowGap = 12;
  for (let r = 0; r < rows; r++) {
    const kind = rowKinds[r % rowKinds.length];
    for (let c = 0; c < cols; c++) {
      const px = poolX0 + c * colGap;
      const pz = poolZ0 + r * rowGap;
      if (px > cx + half - 10) continue;
      parkedVehicles.push({
        pos: new THREE.Vector3(px, 0, pz),
        yaw: Math.PI, // face north (toward the gate / battlefield)
        kind,
        color: camo[(r + c) % camo.length],
      });
    }
  }

  // --- Supply yard: shipping containers + crates near the south-west -----
  const contColors = ["#5a6b4a", "#7a6a3a", "#6a5a4a", "#4a5a6a", "#7c5436"];
  for (let i = 0; i < 10; i++) {
    const stackX = cx - half + 16 + (i % 5) * 7;
    const stackZ = cz + half - 14 - Math.floor(i / 5) * 8;
    const tall = rng() < 0.3;
    containers.push({
      pos: new THREE.Vector3(stackX, tall ? 5.0 : 0, stackZ),
      size: new THREE.Vector3(6.0, 2.5, 2.4),
      yaw: 0,
      color: contColors[Math.floor(rng() * contColors.length)],
    });
    if (tall) {
      containers.push({
        pos: new THREE.Vector3(stackX, 0, stackZ),
        size: new THREE.Vector3(6.0, 2.5, 2.4),
        yaw: 0,
        color: contColors[Math.floor(rng() * contColors.length)],
      });
    }
  }
  // Stacked supply crates against the south wall.
  for (let i = 0; i < 24; i++) {
    const px = cx + 6 + (i % 8) * 2.0;
    const pz = cz + half - 6 - Math.floor(i / 8) * 2.0;
    crates.push({ pos: new THREE.Vector3(px, 0.6, pz), size: 1.1, color: "#7a5028" });
  }

  // --- Fuel / ammo storage: drums + revetment blast walls (east side) ----
  for (let i = 0; i < 5; i++) {
    const rz = cz - half * 0.4 + i * (half * 0.8 / 4);
    const rx = cx + half - 18;
    sandbags.push({ pos: new THREE.Vector3(rx, 1.6, rz), size: new THREE.Vector3(11, 3.2, 1.1), color: "#8a8f86", kind: "barrier" });
    for (let d = 0; d < 4; d++) {
      barrels.push({ pos: new THREE.Vector3(rx + 4 + (d % 2) * 0.9, 0, rz - 2 + d * 1.0), color: d % 2 ? "#3a3a3a" : "#7a4a1a" });
    }
  }

  return walls;
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
  // Parked motor-pool vehicles act as solid cover. Approximate each with an
  // axis-aligned box sized to its kind (orientation ignored — close enough at
  // these scales, and the rows are axis-aligned anyway).
  for (const pv of world.parkedVehicles) {
    const half = pv.kind === "tank" ? new THREE.Vector3(1.7, 1.3, 2.9)
      : pv.kind === "apc" ? new THREE.Vector3(1.5, 1.4, 2.8)
      : pv.kind === "truck" ? new THREE.Vector3(1.4, 1.6, 3.4)
      : new THREE.Vector3(1.3, 1.1, 2.3);
    boxes.push({
      min: new THREE.Vector3(pv.pos.x - half.x, pv.pos.y, pv.pos.z - half.z),
      max: new THREE.Vector3(pv.pos.x + half.x, pv.pos.y + half.y * 2, pv.pos.z + half.z),
    });
  }
  // Shipping containers / CONEX boxes are solid cover.
  for (const c of world.containers) {
    boxes.push({
      min: new THREE.Vector3(c.pos.x - c.size.x / 2, c.pos.y, c.pos.z - c.size.z / 2),
      max: new THREE.Vector3(c.pos.x + c.size.x / 2, c.pos.y + c.size.y, c.pos.z + c.size.z / 2),
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

// ===================================================================
// MAP DATA — a lightweight, render-friendly snapshot of the static
// world geometry used to draw the minimap & the full-screen tactical
// map. We pre-compute building footprints, road strips, hills, tree
// clusters and named landmarks so the HUD can paint a rich map without
// touching the heavy 3D scene graph every frame.
// ===================================================================
export interface MapFootprint {
  cx: number;
  cz: number;
  hw: number; // half width (x)
  hd: number; // half depth (z)
  tall: boolean; // true for multi-storey / large structures
}
export interface MapStrip {
  cx: number;
  cz: number;
  hw: number;
  hd: number;
  color: string;
}
export interface MapDot {
  x: number;
  z: number;
  r: number;
}
export interface MapLandmark {
  x: number;
  z: number;
  name: string;
}
export interface MapData {
  worldSize: number;
  buildings: MapFootprint[];
  roads: MapStrip[];
  hills: MapDot[];
  trees: MapDot[];
  containers: MapFootprint[];
  landmarks: MapLandmark[];
}

let _mapDataCache: MapData | null = null;

export function buildMapData(world: World): MapData {
  if (_mapDataCache) return _mapDataCache;

  const buildings: MapFootprint[] = world.buildings.map((b) => {
    const hw = (b.max.x - b.min.x) / 2;
    const hd = (b.max.z - b.min.z) / 2;
    const height = b.max.y - b.min.y;
    return {
      cx: (b.min.x + b.max.x) / 2,
      cz: (b.min.z + b.max.z) / 2,
      hw,
      hd,
      tall: height > STOREY_HEIGHT * 2.2 || hw * hd > 120,
    };
  });

  const roads: MapStrip[] = world.roads.map((r) => ({
    cx: r.pos.x,
    cz: r.pos.z,
    hw: r.size.x / 2,
    hd: r.size.z / 2,
    color: r.color,
  }));

  const hills: MapDot[] = world.hills.map((h) => ({
    x: h.pos.x,
    z: h.pos.z,
    r: h.radius,
  }));

  const trees: MapDot[] = world.palms.map((p) => ({
    x: p.pos.x,
    z: p.pos.z,
    r: 2.5,
  }));

  const containers: MapFootprint[] = world.containers.map((c) => ({
    cx: c.pos.x,
    cz: c.pos.z,
    hw: Math.max(c.size.x, c.size.z) / 2,
    hd: Math.min(c.size.x, c.size.z) / 2,
    tall: false,
  }));

  const landmarks: MapLandmark[] = [
    { x: CITY_CENTER_X, z: CITY_CENTER_Z, name: "CITY" },
    { x: AIRFIELD_CENTER_X, z: AIRFIELD_CENTER_Z, name: "AIRFIELD" },
    { x: CITADEL_X, z: CITADEL_Z, name: "CITADEL" },
  ];

  _mapDataCache = {
    worldSize: WORLD_SIZE,
    buildings,
    roads,
    hills,
    trees,
    containers,
    landmarks,
  };
  return _mapDataCache;
}
