import * as THREE from "three";

// A single wall segment (axis-aligned box used both for collision and rendering)
export interface Wall {
  pos: THREE.Vector3; // center
  size: THREE.Vector3; // full extents
  color: string;
  kind: "wall" | "roof" | "floor" | "pillar" | "barrier" | "ground-debris";
  // Purely visual trim (window sills/lintels, plinths, string-courses). These
  // are rendered like any other wall but are skipped when building the static
  // collision boxes, so the thousands of small façade ledges add realism
  // without bloating the physics broadphase or blocking the player.
  decorative?: boolean;
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

// A large cylindrical fuel / water storage tank (airbase fuel farm). Rendered
// as an upright capped cylinder; purely decorative set-dressing + soft cover.
export interface FuelTank {
  pos: THREE.Vector3; // base centre (y = ground)
  radius: number;
  height: number;
  color: string;
}

// An explicitly authored sniper firing position. Each post sits on the high
// ground of a desert outpost (a raised platform / tower nest) and stores the
// direction it overwatches plus the relative elevation advantage it enjoys
// over the surrounding terrain. The AI / spawn logic and the tactical map can
// read these to prefer the high ground for long-range duels.
export interface SniperPost {
  pos: THREE.Vector3; // world position of the firing slit / nest floor
  yaw: number; // facing (radians) — the lane the post overwatches
  elevation: number; // height advantage over the surrounding desert floor
  outpostId: number; // which outpost this post belongs to
}

// A desert-rim outpost: a small fortified position seated on raised terrain at
// the open outer edge of the map. Each carries its own sniper posts so the
// elevation advantage is placed explicitly rather than left to chance.
export interface Outpost {
  id: number;
  pos: THREE.Vector3; // ground-level center (y = terrain height)
  groundY: number; // terrain height under the outpost center
  radius: number; // footprint radius (for spawn / map use)
  name: string;
  sniperPosts: SniperPost[];
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
//   * West half  -> ONE fused Nellis Air Force Base: the long operational
//                   runway, taxiway and apron now sit *inside* the fortified
//                   home-base compound (T-wall perimeter, gate, motor pool,
//                   hangars, command + control tower, supply yard). The two
//                   previously-separate base/runway facilities are merged.
//   * East half  -> Aleppo old city (dense war-torn blocks + hilltop Citadel),
//                   now expanded to fill the space freed by the fusion.
// The map is enlarged to comfortably hold both districts side by side.
//
// MAP_SCALE shrinks the whole battlefield (and every structure on it) by a
// uniform factor so all districts, roads and props re-place proportionally.
// At 0.8 the map (and the airbase / citadel footprints, which use absolute
// extents below) are 80% of their original size; everything that derives from
// WORLD_SIZE follows automatically, and the absolute footprints are multiplied
// by MAP_SCALE so the structures stay correctly proportioned to the smaller
// world rather than overflowing it.
export const MAP_SCALE = 0.8;
export const WORLD_SIZE = Math.round(1480 * MAP_SCALE); // 0.8x of the original 1480

// X coordinate that divides the airbase (west, x<0) from the ruined city
// (east, x>0). A blast-wall corridor sits along this seam.
export const DISTRICT_SEAM_X = -WORLD_SIZE * 0.04;

// --- Aleppo old-city core (east side) ------------------------------------
// Center of the dense city grid and radius of the leveled urban area. Inside
// this disc the ground is flattened so streets and buildings sit level. The
// urban area is EXPANDED: pushed a little east and grown in radius so it
// occupies the larger eastern/southern half left open by fusing the bases.
export const CITY_CENTER_X = WORLD_SIZE * 0.27;
export const CITY_CENTER_Z = WORLD_SIZE * 0.02;
// Larger flattened urban disc so the bigger, denser grid stays buildable.
const CITY_FLAT_RADIUS = WORLD_SIZE * 0.3 + 22;

// --- Aleppo Citadel (landmark hill-fortress on the city's NE) ------------
export const CITADEL_X = WORLD_SIZE * 0.38;
export const CITADEL_Z = -WORLD_SIZE * 0.28;
const CITADEL_RADIUS = 120 * MAP_SCALE;
const CITADEL_HEIGHT = 34 * MAP_SCALE;

// --- Fused Nellis airbase flat zone (west side) --------------------------
// The runway / taxiway / apron and the whole fortified compound now share a
// single dead-level rectangle on the west side. BASE_POS is anchored to this
// same center so the home base and the airfield are one facility.
export const AIRFIELD_CENTER_X = -WORLD_SIZE * 0.26;
export const AIRFIELD_CENTER_Z = 0;
export const AIRFIELD_FLAT_HALF_X = WORLD_SIZE * 0.24;
export const AIRFIELD_FLAT_HALF_Z = WORLD_SIZE * 0.4;

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

// "Ridged" noise: folds value noise around its midpoint and inverts it so the
// field forms sharp crests (ridge lines) instead of soft blobs. Output [0,1],
// where 1 sits exactly on a crest. A couple of octaves give a continuous range
// of escarpments without isolated spikes.
function ridgeNoise(x: number, z: number): number {
  let v = 0;
  let amp = 0.5;
  let freq = 1;
  let norm = 0;
  for (let o = 0; o < 3; o++) {
    const n = smoothNoise(x * freq, z * freq); // [0,1]
    const r = 1 - Math.abs(n * 2 - 1); // [0,1], 1 on the crest
    v += amp * r * r; // square sharpens the ridge
    norm += amp;
    amp *= 0.5;
    freq *= 2.13;
  }
  return v / norm;
}

// Continuous, smoothly rolling Mojave/Syrian-steppe elevation. Flattens to ~0
// over the airfield and the city core (so both districts stay buildable), and
// raises a broad mound under the Aleppo Citadel.
export function baseTerrainHeight(x: number, z: number): number {
  // Large gentle dunes plus finer ripples (open desert between the districts).
  const dunes = (fbm2(x * 0.0042 + 11.3, z * 0.0042 - 7.1) - 0.5) * 2; // [-1,1]
  const ripples = (fbm2(x * 0.02 + 51.7, z * 0.02 + 23.9) - 0.5) * 2;
  let h = dunes * 9.0 + ripples * 1.3;

  // --- Per-region relief: stronger ridges (稜線) and carved valleys (谷) -----
  // The open ground between the districts gets a much bolder profile: long
  // rocky escarpments (ridge lines) rising out of the steppe, and dry
  // wadi-style valleys cut down between them. Both use low-frequency fields so
  // the relief reads as broad terrain "regions" the player crosses, not noise.

  // Ridge crests — broad, oriented NW↔SE so they form continuous spines rather
  // than isolated humps. Raised on top of the dunes.
  const ridge = ridgeNoise(x * 0.0026 + 4.2, z * 0.0031 - 9.6); // [0,1]
  // Gate the ridges so only the upper band actually rises (keeps the lowlands
  // open) and feather the onset for smooth flanks.
  const ridgeMask = smoothstep01((ridge - 0.45) / 0.45);
  h += ridgeMask * 26.0;

  // Valleys — a separate low-frequency channel network carved BELOW the rolling
  // surface. Where the valley field is near its crest we dig a smooth trough.
  const valley = ridgeNoise(x * 0.0019 - 21.7, z * 0.0017 + 13.1); // [0,1]
  const valleyMask = smoothstep01((valley - 0.5) / 0.4);
  // Only carve where we are NOT on a ridge, so crests stay sharp and the
  // valleys read as the lowland floors between the spines.
  h -= valleyMask * (1 - ridgeMask) * 16.0;

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

  // Flatten the fused airbase compound (runway + apron + walled base) on the
  // west side. The compound is a tall rectangle, so flatten a rectangular
  // footprint (plus a soft skirt) — this keeps the runway, apron, hangars and
  // motor pool dead level and prevents terrain from poking up through the
  // concrete. (This rectangle overlaps the airfield rectangle above, which is
  // fine — both just drive h toward 0 over the same west-side zone.)
  const bdx = Math.abs(x - BASE_POS.x);
  const bdz = Math.abs(z - BASE_POS.z);
  const baseOutside = Math.max(
    (bdx - (BASE_HALF_X + 8)) / 50,
    (bdz - (BASE_HALF_Z + 8)) / 50,
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

// Shared hangar colours (used by the fused airbase + the window decorator to
// skip windowing the hangar shells).
const HANGAR_COLOR = "#5d6b74";
const HANGAR_ROOF = "#42505a";

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
  fuelTanks: FuelTank[];
  outposts: Outpost[];
  sniperPosts: SniperPost[];
  fountainPos: THREE.Vector3;
  basePos: THREE.Vector3;
  runwaySpawns: RunwaySpawn[];
}

export interface RunwaySpawn {
  pos: THREE.Vector3;   // 滑走路上の待機位置 (y=0)
  yaw: number;          // 離陸方向
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
  const fuelTanks: FuelTank[] = [];
  const outposts: Outpost[] = [];
  const sniperPosts: SniperPost[] = [];
  const runwaySpawns: RunwaySpawn[] = [];

  // ======================================================================
  //  FUSED NELLIS AIRBASE  (west half) — built in buildBaseCompound()
  // ======================================================================
  // The standalone Nellis airfield and the separate fortified home base have
  // been FUSED into a single facility. All of the airfield geometry (long
  // runway, parallel taxiway, concrete apron, hangars, control tower, jet-blast
  // revetments) plus the compound (T-wall perimeter, north gate, motor pool,
  // command block, supply yard) is now produced together inside
  // buildBaseCompound(), which is centred on AIRFIELD_CENTER via BASE_POS.

  // ======================================================================
  //  ALEPPO OLD CITY  (east half, x > DISTRICT_SEAM_X)
  // ======================================================================
  // A dense, partly-ruined grid of buildings with narrow streets, a market
  // plaza around the central fountain, and the Citadel landmark on a hill.
  const cityCX = CITY_CENTER_X;
  const cityCZ = CITY_CENTER_Z;
  // EXPANDED urban footprint: the city grid now covers a much larger square so
  // the dense quarter fills the eastern/southern half freed up by fusing the
  // two bases into one west-side facility.
  const citySize = WORLD_SIZE * 0.6;
  const cityRadius = CITY_FLAT_RADIUS - 8;
  // Denser grid: more, smaller blocks separated by narrow alleys, like a real
  // medieval old-city quarter. The cell count is grown along with the footprint
  // so the blocks stay the same size (just more of them) → a bigger city.
  const cells = 26;
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
  // (Count raised to populate the enlarged urban footprint.)
  for (let i = 0; i < 460; i++) {
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
    if (Math.abs(px - AIRFIELD_CENTER_X) < AIRFIELD_FLAT_HALF_X + 30 && Math.abs(pz - AIRFIELD_CENTER_Z) < AIRFIELD_FLAT_HALF_Z + 30) continue;
    if (Math.hypot(px - cityCX, pz - cityCZ) < CITY_FLAT_RADIUS + 30) continue;
    // Keep mounds out of the (flattened) fused airbase too. Authored hills are
    // added on top of the base terrain by terrainHeightAt(), so a mound here
    // would raise the ground *inside* the flattened compound and read as
    // "terrain stacked on terrain" poking through the apron. The compound is a
    // tall rectangle, so use its rectangular extents (padded for the mound
    // radius, which can reach ~115).
    const baseR = 115 + 30;
    if (Math.abs(px - BASE_POS.x) < BASE_HALF_X + baseR && Math.abs(pz - BASE_POS.z) < BASE_HALF_Z + baseR) continue;
    const radius = 45 + rng() * 70;
    const height = 3 + rng() * 7;
    hills.push({ pos: new THREE.Vector3(px, 0, pz), radius, height, color: rng() > 0.45 ? "#8a7a54" : "#6f8152" });
  }

  // Trees: a few palms/poplars in city courtyards, scrub in the desert.
  // (Count raised for the enlarged city.)
  for (let i = 0; i < 300; i++) {
    const inCity = rng() > 0.5;
    const px = inCity ? cityCX + (rng() - 0.5) * citySize : (rng() - 0.5) * (WORLD_SIZE - 30);
    const pz = inCity ? cityCZ + (rng() - 0.5) * citySize : (rng() - 0.5) * (WORLD_SIZE - 30);
    const p = new THREE.Vector3(px, 0, pz);
    if (insideAnyBuilding(p, buildings, 1)) continue;
    // keep trees off the runway/apron
    if (Math.abs(px - AIRFIELD_CENTER_X) < AIRFIELD_FLAT_HALF_X && Math.abs(pz - AIRFIELD_CENTER_Z) < AIRFIELD_FLAT_HALF_Z) continue;
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
  // A long approach road linking the fused airbase (its east perimeter) to the
  // city, so the player can drive out of the gate and into the urban district.
  const baseEastEdge = BASE_POS.x + BASE_HALF_X;
  roads.push({ pos: new THREE.Vector3((baseEastEdge + cityCX) / 2, 0.01, cityCZ), size: new THREE.Vector3(cityCX - baseEastEdge, 0.02, 9), color: "#5a4d34" });

  // --- Multi-layer market plaza around the central fountain ---------------
  // The flat souk square is rebuilt as a tiered civic space: a stepped central
  // dais carrying the fountain, an elevated walkable gallery ring reached by
  // stairs, and a sunken lower court. Pure cover/traversal geometry, so kept in
  // its own wall list (no per-storey window decoration).
  const plazaWalls = buildMarketPlaza(plazaX, plazaZ, lamps, pickupSpawns);

  // Market tents — two denser rings around the central fountain plaza,
  // forming a busy souk. Tents on the raised gallery ring are lifted onto its
  // deck; those near the central dais are skipped so the steps stay clear.
  const tentColors = ["#b04030", "#3060a0", "#a08030", "#6a4030", "#8a6020", "#406a40"];
  for (let i = 0; i < 34; i++) {
    const a = (i / 34) * Math.PI * 2 + (i % 2) * 0.09;
    const r = 18 + (i % 4) * 5;
    const tx = plazaX + Math.cos(a) * r;
    const tz = plazaZ + Math.sin(a) * r;
    if (insideAnyBuilding(new THREE.Vector3(tx, 0, tz), buildings, 1.2)) continue;
    // Lift tents that sit on the elevated gallery ring (between r≈26 and r≈34)
    // up onto its deck so they read as a stalls on the upper terrace.
    const galleryY = r >= 25 && r <= 35 ? PLAZA_GALLERY_Y : 0;
    tents.push({ pos: new THREE.Vector3(tx, galleryY, tz), color: tentColors[Math.floor(rng() * tentColors.length)] });
  }

  // Street lamps along the city's main roads (reaching out across the enlarged
  // grid so the whole expanded quarter is lit).
  const lampReach = Math.min(halfCells, 11);
  for (let i = -lampReach; i <= lampReach; i++) {
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
    if (b.info.color === HANGAR_COLOR) continue; // hangars have no windows
    const { cx, cz, w: bw, d: bd, floors, floorH, doorSide, roofColor } = b.info;
    const nx = Math.max(1, Math.floor(bw / 3.2));
    const nz = Math.max(1, Math.floor(bd / 3.2));
    // Slightly taller, properly proportioned windows.
    const winH = 1.45;
    const winW = 0.95;
    // Trim (sills + lintels + plinth) is rendered as instanced concrete boxes in
    // the building's own roof colour so each window gains a real protruding
    // ledge above and below the glass — the single biggest cue that turns a flat
    // painted rectangle into a believable framed opening. Pushed onto the
    // building's wall list (collected into the global walls array further down).
    const trimT = 0.14;     // ledge protrusion beyond the facade
    const trimH = 0.12;     // ledge height
    const ledgeOver = 0.22; // how far the ledge overhangs the window width
    // sill = below glass, lintel = above glass
    const addTrimZ = (px: number, y: number, faceZ: number, dir: number) => {
      b.walls.push({
        pos: new THREE.Vector3(px, y, faceZ + dir * (trimT / 2)),
        size: new THREE.Vector3(winW + ledgeOver, trimH, trimT),
        color: roofColor,
        kind: "barrier",
        decorative: true,
      });
    };
    const addTrimX = (faceX: number, y: number, pz: number, dir: number) => {
      b.walls.push({
        pos: new THREE.Vector3(faceX + dir * (trimT / 2), y, pz),
        size: new THREE.Vector3(trimT, trimH, winW + ledgeOver),
        color: roofColor,
        kind: "barrier",
        decorative: true,
      });
    };
    for (let f = 0; f < floors; f++) {
      const sillY = f * floorH + floorH * 0.5;
      const belowY = sillY - winH / 2 - trimH / 2;
      const aboveY = sillY + winH / 2 + trimH / 2;
      for (let i = 0; i < nx; i++) {
        const fx = b.min.x + (i + 0.5) * (bw / nx);
        const overDoorZpos = f === 0 && doorSide === 0 && Math.abs(fx - cx) < 1.3;
        const overDoorZneg = f === 0 && doorSide === 1 && Math.abs(fx - cx) < 1.3;
        if (!overDoorZpos) {
          windows.push({ pos: new THREE.Vector3(fx, sillY, b.max.z + 0.06), size: new THREE.Vector3(winW, winH, 0.06), lit: rng() > 0.55 });
          addTrimZ(fx, belowY, b.max.z, 1);
          addTrimZ(fx, aboveY, b.max.z, 1);
        }
        if (!overDoorZneg) {
          windows.push({ pos: new THREE.Vector3(fx, sillY, b.min.z - 0.06), size: new THREE.Vector3(winW, winH, 0.06), lit: rng() > 0.55 });
          addTrimZ(fx, belowY, b.min.z, -1);
          addTrimZ(fx, aboveY, b.min.z, -1);
        }
      }
      for (let i = 0; i < nz; i++) {
        const fz = b.min.z + (i + 0.5) * (bd / nz);
        const overDoorXpos = f === 0 && doorSide === 2 && Math.abs(fz - cz) < 1.3;
        const overDoorXneg = f === 0 && doorSide === 3 && Math.abs(fz - cz) < 1.3;
        if (!overDoorXpos) {
          windows.push({ pos: new THREE.Vector3(b.max.x + 0.06, sillY, fz), size: new THREE.Vector3(0.06, winH, winW), lit: rng() > 0.55 });
          addTrimX(b.max.x, belowY, fz, 1);
          addTrimX(b.max.x, aboveY, fz, 1);
        }
        if (!overDoorXneg) {
          windows.push({ pos: new THREE.Vector3(b.min.x - 0.06, sillY, fz), size: new THREE.Vector3(0.06, winH, winW), lit: rng() > 0.55 });
          addTrimX(b.min.x, belowY, fz, -1);
          addTrimX(b.min.x, aboveY, fz, -1);
        }
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
    // Base plinth: a slightly wider, darker concrete band wrapping the ground
    // floor so the building reads as sitting on a real foundation course rather
    // than meeting the sand with a knife edge.
    {
      const plinthH = 0.55;
      const plinthOut = 0.18;
      const py = b.min.y + plinthH / 2;
      const plinthColor = roofColor;
      b.walls.push({ pos: new THREE.Vector3(cx, py, b.max.z + plinthOut / 2), size: new THREE.Vector3(bw + plinthOut * 2, plinthH, plinthOut), color: plinthColor, kind: "barrier", decorative: true });
      b.walls.push({ pos: new THREE.Vector3(cx, py, b.min.z - plinthOut / 2), size: new THREE.Vector3(bw + plinthOut * 2, plinthH, plinthOut), color: plinthColor, kind: "barrier", decorative: true });
      b.walls.push({ pos: new THREE.Vector3(b.max.x + plinthOut / 2, py, cz), size: new THREE.Vector3(plinthOut, plinthH, bd), color: plinthColor, kind: "barrier", decorative: true });
      b.walls.push({ pos: new THREE.Vector3(b.min.x - plinthOut / 2, py, cz), size: new THREE.Vector3(plinthOut, plinthH, bd), color: plinthColor, kind: "barrier", decorative: true });
    }
    // String-course bands marking each upper floor line — a thin protruding
    // cornice that breaks up tall blank facades the way real concrete buildings
    // have storey-divider mouldings.
    if (floors >= 2) {
      const bandH = 0.16;
      const bandOut = 0.1;
      for (let f = 1; f < floors; f++) {
        const by = b.min.y + f * floorH;
        b.walls.push({ pos: new THREE.Vector3(cx, by, b.max.z + bandOut / 2), size: new THREE.Vector3(bw + bandOut * 2, bandH, bandOut), color: roofColor, kind: "barrier", decorative: true });
        b.walls.push({ pos: new THREE.Vector3(cx, by, b.min.z - bandOut / 2), size: new THREE.Vector3(bw + bandOut * 2, bandH, bandOut), color: roofColor, kind: "barrier", decorative: true });
        b.walls.push({ pos: new THREE.Vector3(b.max.x + bandOut / 2, by, cz), size: new THREE.Vector3(bandOut, bandH, bd), color: roofColor, kind: "barrier", decorative: true });
        b.walls.push({ pos: new THREE.Vector3(b.min.x - bandOut / 2, by, cz), size: new THREE.Vector3(bandOut, bandH, bd), color: roofColor, kind: "barrier", decorative: true });
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

  // --- District-seam crossings: a vehicle overpass + a berm tunnel ---------
  // The seam is the front line between the airbase (west) and the city (east).
  // Two purpose-built ways to cross it: an elevated concrete bridge to the
  // north and a tunnel bored through a raised earth berm to the south. The
  // tunnel pushes a TerrainHill (berm) so the bore reads as cutting through a
  // real mound; that hill must exist before props are seated below.
  const seamWalls = buildSeamCrossings(DISTRICT_SEAM_X, hills, lamps, roads);

  // --- Home base (large forward-operating airbase) near the south edge ----
  const baseWalls = buildBaseCompound(rng, buildings, parkedVehicles, containers, barrels, sandbags, lamps, crates, roads, fuelTanks);

  // --- Three desert-rim outposts (前哨陣地) on raised terrain --------------
  // Forward fortified positions placed at the open outer edge of the map,
  // each seated on a deliberately raised mound so it commands the surrounding
  // desert. Every outpost ships explicit sniper nests on its high ground; the
  // elevation advantage of each nest is recorded on the SniperPost so the AI
  // and the tactical map can exploit the high ground on purpose.
  const outpostWalls = buildDesertOutposts(
    rng, hills, sandbags, crates, barrels, lamps, containers, pickupSpawns, outposts, sniperPosts,
  );

  const walls: Wall[] = [];
  for (const b of buildings) walls.push(...b.walls);
  walls.push(...citadelWalls);
  walls.push(...perimeter);
  walls.push(...baseWalls);
  walls.push(...seamWalls);
  walls.push(...plazaWalls);
  walls.push(...outpostWalls);

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

  // Seat the seam-crossing structures (overpass + tunnel) onto the terrain.
  // They are built with y measured from local ground=0, so lift each segment by
  // the BASE terrain height at its footprint. Using the base height (not
  // groundAt) is intentional for the tunnel: its bore must sit on the ground
  // *under* the berm mound rather than on top of it.
  for (const w of seamWalls) w.pos.y += baseTerrainHeight(w.pos.x, w.pos.z);

  // Seat the desert-outpost structures onto their raised mounds. Each outpost
  // wall is built in local coordinates (y measured from the mound's surface),
  // so lift it by the full terrain height (base dunes + the authored outpost
  // mound) at its footprint. The same lift is applied to the recorded sniper
  // posts so their world Y sits exactly on the nest floor on the high ground.
  for (const w of outpostWalls) w.pos.y += groundAt(w.pos.x, w.pos.z);
  for (const op of outposts) {
    const gy = groundAt(op.pos.x, op.pos.z);
    op.groundY = gy;
    op.pos.y = gy;
  }
  for (const sp of sniperPosts) sp.pos.y += groundAt(sp.pos.x, sp.pos.z);

  // Seat ground props onto the terrain so nothing floats or sinks.
  for (const c of crates) c.pos.y += groundAt(c.pos.x, c.pos.z);
  for (const b of barrels) b.pos.y += groundAt(b.pos.x, b.pos.z);
  for (const p of palms) p.pos.y += groundAt(p.pos.x, p.pos.z);
  for (const s of sandbags) s.pos.y += groundAt(s.pos.x, s.pos.z);
  for (const t of tents) t.pos.y += groundAt(t.pos.x, t.pos.z);
  for (const l of lamps) l.pos.y += groundAt(l.pos.x, l.pos.z);
  for (const pv of parkedVehicles) pv.pos.y += groundAt(pv.pos.x, pv.pos.z);
  for (const ct of containers) ct.pos.y += groundAt(ct.pos.x, ct.pos.z);
  for (const ft of fuelTanks) ft.pos.y += groundAt(ft.pos.x, ft.pos.z);

  // Seat every road decal onto the terrain so the asphalt/concrete follows the
  // rolling ground instead of clipping through it or hovering above it. The
  // small base offset is kept so the strip renders just above the dirt. (The
  // airfield, city core and base are already flattened, so this only matters
  // along the connecting desert roads.)
  //
  // The rendered terrain is a coarse displaced grid that linearly interpolates
  // BETWEEN vertices, so on rolling ground the mesh surface can bulge a little
  // above the analytic `groundAt` height mid-cell. A thin road decal seated at
  // exactly groundAt would then get swallowed by that bulge and look buried.
  // Authored airfield decals already carry their own tall clearance (y≥0.3);
  // for the low desert connector roads we lift them by a larger minimum so they
  // clear the worst-case mesh interpolation and always read as sitting on top.
  for (const r of roads) {
    const isPaved = pavedFlatHeightAt(r.pos.x, r.pos.z) !== null;
    const minClear = isPaved ? 0.02 : 0.18;
    r.pos.y = groundAt(r.pos.x, r.pos.z) + Math.max(minClear, r.pos.y);
  }

  // === Aircraft runway spawn points =====================================
  // 滑走路 rwX (= AIRFIELD_CENTER_X - BASE_HALF_X * 0.46) の「南端」1箇所に
  // 3機を横並び (X軸方向に ±9m) で静止待機させる。AI機は自動離陸しないので、
  // プレイヤーが Gキーで搭乗した機体だけがここから飛び立つ。
  // 南端の Z 座標は AIRFIELD_CENTER_Z + BASE_HALF_Z - 20。すべて北向き (yaw=0)
  // ＝離陸方向を向けて待機する。
  const RW_X = AIRFIELD_CENTER_X - BASE_HALF_X * 0.46;
  const RW_SOUTH_Z = AIRFIELD_CENTER_Z + BASE_HALF_Z - 20;
  runwaySpawns.push(
    { pos: new THREE.Vector3(RW_X - 9, 0.5, RW_SOUTH_Z), yaw: 0 },  // 南端・左
    { pos: new THREE.Vector3(RW_X,     0.5, RW_SOUTH_Z), yaw: 0 },  // 南端・中央
    { pos: new THREE.Vector3(RW_X + 9, 0.5, RW_SOUTH_Z), yaw: 0 },  // 南端・右
  );

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
    fuelTanks,
    outposts,
    sniperPosts,
    fountainPos: new THREE.Vector3(CITY_CENTER_X, 0, CITY_CENTER_Z),
    basePos: BASE_POS.clone(),
    runwaySpawns,
  };
}

// === FUSED HOME AIRBASE ====================================================
// The home base and the Nellis airfield are now ONE facility. The fortified
// compound (T-wall perimeter, gate, motor pool, hangars, command block,
// control tower, supply yard) is centred on the airfield, so the long
// operational runway + taxiway + apron sit *inside* the walled base. The
// compound is a tall rectangle (north-south) that wraps the runway with the
// gate on the north wall (facing the city / battlefield).
export const BASE_POS = new THREE.Vector3(AIRFIELD_CENTER_X, 0, AIRFIELD_CENTER_Z);
// Half-extents of the (now rectangular) compound: wide enough to hold the
// runway + taxiway + apron, tall enough to span most of the runway length.
export const BASE_HALF = 150 * MAP_SCALE; // legacy square half-extent (kept for terrain skirt + spawns)
export const BASE_HALF_X = 200 * MAP_SCALE; // east-west half extent (runway + taxiway + apron)
export const BASE_HALF_Z = 320 * MAP_SCALE; // north-south half extent (along the runway)

// Build the FUSED Nellis airbase: one walled compound that contains the full
// operational airfield (long runway, parallel taxiway, connector taxiways,
// concrete apron, hangar row, control tower + command block, jet-blast
// revetments) PLUS the fortified home-base dressing (T-wall perimeter, north
// gate, packed motor pool, supply yard). Returns the collidable wall segments;
// buildings / vehicles / props are pushed into the shared arrays.
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
  fuelTanks: FuelTank[],
): Wall[] {
  const walls: Wall[] = [];
  const cx = BASE_POS.x;
  const cz = BASE_POS.z;
  const halfX = BASE_HALF_X; // east-west
  const halfZ = BASE_HALF_Z; // north-south (runway runs along z)

  // Surface / marking paint heights. The detailed terrain mesh is a coarse
  // (~20 m cell) displaced grid, so near the flattened-airfield edges a triangle
  // can interpolate a few tens of centimetres above the nominal flat (y≈0)
  // surface and poke up through a thin, ground-hugging decal — which is exactly
  // why the runway looked half-buried. Lift the whole paved stack well clear of
  // that interpolation error so the asphalt always reads as sitting on top of
  // the ground, then layer the paint just above the tarmac.
  const APRON_Y = 0.35;
  const Y_SHOULDER = 0.34;
  const Y_SURFACE = 0.40;
  const PAINT_Y = 0.48;
  const PAINT2_Y = 0.50;

  // --- Concrete apron covering the whole compound floor ------------------
  // Thin road decal (not a collidable floor box) so it sits flush on the
  // flattened terrain and the player can walk across freely.
  roads.push({
    pos: new THREE.Vector3(cx, APRON_Y, cz),
    size: new THREE.Vector3(halfX * 2 - 2, 0.02, halfZ * 2 - 2),
    color: "#9a958a",
  });

  // --- Main operational runway (west side of the compound) ---------------
  // A long north-south runway. The big east apron sits to its right.
  const rwX = cx - halfX * 0.46;
  const rwW = 30;
  const rwLen = halfZ * 2 - 30;
  // Sandy graded shoulder bed under the runway.
  roads.push({
    pos: new THREE.Vector3(rwX, Y_SHOULDER, cz),
    size: new THREE.Vector3(rwW + 22, 0.02, rwLen + 24),
    color: "#5a5247",
  });
  // Dark asphalt surface.
  roads.push({
    pos: new THREE.Vector3(rwX, Y_SURFACE, cz),
    size: new THREE.Vector3(rwW, 0.02, rwLen),
    color: "#2f3236",
  });
  // Solid white edge stripes.
  for (const side of [-1, 1]) {
    roads.push({
      pos: new THREE.Vector3(rwX + side * (rwW / 2 - 1.0), PAINT_Y, cz),
      size: new THREE.Vector3(0.6, 0.02, rwLen - 24),
      color: "#e8e8dc",
    });
  }
  // Centerline dashes.
  const dashCount = 44;
  for (let i = 0; i < dashCount; i++) {
    const dz = -rwLen / 2 + (i + 0.5) * (rwLen / dashCount);
    roads.push({
      pos: new THREE.Vector3(rwX, PAINT_Y, cz + dz),
      size: new THREE.Vector3(1.0, 0.02, (rwLen / dashCount) * 0.5),
      color: "#d8d8c8",
    });
  }
  // Threshold piano-keys + aiming-point bars at each end.
  for (const end of [-1, 1]) {
    for (let k = -3; k <= 3; k++) {
      roads.push({
        pos: new THREE.Vector3(rwX + k * 3, PAINT_Y, cz + end * (rwLen / 2 - 8)),
        size: new THREE.Vector3(1.8, 0.02, 10),
        color: "#e6e6da",
      });
    }
    for (const side of [-1, 1]) {
      roads.push({
        pos: new THREE.Vector3(rwX + side * 3.2, PAINT_Y, cz + end * (rwLen / 2 - 34)),
        size: new THREE.Vector3(2.6, 0.02, 14),
        color: "#e6e6da",
      });
    }
  }
  // Runway designation numbers ("18 / 36") built from glyph bars near each end.
  const drawDigitBars = (gx: number, gz: number, bars: [number, number, number, number][]) => {
    for (const [ox, oz, w, d] of bars) {
      roads.push({
        pos: new THREE.Vector3(gx + ox, PAINT2_Y, gz + oz),
        size: new THREE.Vector3(w, 0.02, d),
        color: "#eeeee2",
      });
    }
  };
  drawDigitBars(rwX - 3.2, cz + rwLen / 2 - 52, [[0, 0, 0.9, 7]]); // 1
  drawDigitBars(rwX + 1.0, cz + rwLen / 2 - 52, [
    [0, 3.0, 3.0, 0.9], [0, 0, 3.0, 0.9], [0, -3.0, 3.0, 0.9],
    [1.4, 1.5, 0.9, 3.0], [-1.4, -1.5, 0.9, 3.0],
  ]); // 8
  drawDigitBars(rwX - 3.2, cz - rwLen / 2 + 52, [
    [0, 3.0, 3.0, 0.9], [0, 0, 3.0, 0.9], [0, -3.0, 3.0, 0.9],
    [1.4, 1.5, 0.9, 3.0], [1.4, -1.5, 0.9, 3.0],
  ]); // 3
  drawDigitBars(rwX + 1.0, cz - rwLen / 2 + 52, [
    [0, 3.0, 3.0, 0.9], [0, 0, 3.0, 0.9], [0, -3.0, 3.0, 0.9],
    [1.4, 0, 0.9, 6.0], [-1.4, 1.5, 0.9, 3.0],
  ]); // 6

  // --- Parallel taxiway east of the runway -------------------------------
  const taxiX = rwX + 56;
  roads.push({
    pos: new THREE.Vector3(taxiX, Y_SURFACE, cz),
    size: new THREE.Vector3(16, 0.02, rwLen * 0.92),
    color: "#3a3e44",
  });
  roads.push({
    pos: new THREE.Vector3(taxiX, PAINT_Y, cz),
    size: new THREE.Vector3(0.5, 0.02, rwLen * 0.9),
    color: "#d6b73c",
  });
  // Connector taxiways linking the runway and the taxiway.
  for (const dz of [-rwLen * 0.32, 0, rwLen * 0.32]) {
    roads.push({
      pos: new THREE.Vector3((rwX + taxiX) / 2, Y_SURFACE, cz + dz),
      size: new THREE.Vector3(taxiX - rwX, 0.02, 12),
      color: "#3a3e44",
    });
    roads.push({
      pos: new THREE.Vector3((rwX + taxiX) / 2, PAINT_Y, cz + dz),
      size: new THREE.Vector3(taxiX - rwX - 4, 0.02, 0.5),
      color: "#d6b73c",
    });
  }

  // --- Flight-line apron east of the taxiway, with parking-spot outlines --
  const apronX = taxiX + 64;
  const apronW = 120;
  const apronD = rwLen * 0.7;
  roads.push({
    pos: new THREE.Vector3(apronX, Y_SURFACE, cz),
    size: new THREE.Vector3(apronW, 0.02, apronD),
    color: "#9a958a",
  });
  for (let r = 0; r < 7; r++) {
    const pz = cz - apronD / 2 + 30 + r * (apronD - 60) / 6;
    roads.push({
      pos: new THREE.Vector3(apronX, PAINT_Y, pz),
      size: new THREE.Vector3(apronW - 26, 0.02, 0.4),
      color: "#cdb24a",
    });
  }

  // --- Perimeter T-wall (concrete blast wall) with a north gate ----------
  // The gate faces the city / battlefield (-z) so vehicles drive out toward
  // the urban district.
  const wallH = 5.5;
  const wallT = 1.4;
  const wallColor = "#9a958c";
  const gate = 24; // wide vehicle gate on the north wall
  // South wall (faces the map edge).
  walls.push({ pos: new THREE.Vector3(cx, wallH / 2, cz + halfZ), size: new THREE.Vector3(halfX * 2, wallH, wallT), color: wallColor, kind: "wall" });
  // East + West walls (full length along z).
  walls.push({ pos: new THREE.Vector3(cx + halfX, wallH / 2, cz), size: new THREE.Vector3(wallT, wallH, halfZ * 2), color: wallColor, kind: "wall" });
  walls.push({ pos: new THREE.Vector3(cx - halfX, wallH / 2, cz), size: new THREE.Vector3(wallT, wallH, halfZ * 2), color: wallColor, kind: "wall" });
  // North wall split into two segments leaving a central gate.
  const sideLen = halfX - gate / 2;
  if (sideLen > 0.1) {
    walls.push({ pos: new THREE.Vector3(cx - (gate / 2 + sideLen / 2), wallH / 2, cz - halfZ), size: new THREE.Vector3(sideLen, wallH, wallT), color: wallColor, kind: "wall" });
    walls.push({ pos: new THREE.Vector3(cx + (gate / 2 + sideLen / 2), wallH / 2, cz - halfZ), size: new THREE.Vector3(sideLen, wallH, wallT), color: wallColor, kind: "wall" });
  }
  // Gate pillars either side of the opening.
  for (const sx of [-1, 1]) {
    walls.push({ pos: new THREE.Vector3(cx + sx * gate / 2, wallH / 2 + 0.6, cz - halfZ), size: new THREE.Vector3(2.2, wallH + 1.2, 2.6), color: "#8a857c", kind: "pillar" });
  }
  // Floodlight poles spaced along the inside of the (now longer) perimeter.
  for (let i = -3; i <= 3; i++) {
    lamps.push({ pos: new THREE.Vector3(cx + i * (halfX * 0.85 / 3), 0, cz + halfZ - 4) });
    lamps.push({ pos: new THREE.Vector3(cx + i * (halfX * 0.85 / 3), 0, cz - halfZ + 4) });
  }
  for (let i = -3; i <= 3; i++) {
    lamps.push({ pos: new THREE.Vector3(cx - halfX + 4, 0, cz + i * (halfZ * 0.85 / 3)) });
    lamps.push({ pos: new THREE.Vector3(cx + halfX - 4, 0, cz + i * (halfZ * 0.85 / 3)) });
  }

  // --- Control tower + command building (east edge, by the apron) --------
  const towerX = apronX + apronW / 2 - 18;
  const towerZ = cz + apronD / 2 - 30;
  const cmd = makeBuilding(rng, towerX - 18, towerZ, 26, 18, STOREY_HEIGHT * 3);
  buildings.push(cmd);
  buildAirfieldTower(buildings, towerX, towerZ, 0);

  // --- Row of hangars along the back (west) edge of the apron ------------
  const hangarColor = HANGAR_COLOR;
  const hangarRoof = HANGAR_ROOF;
  const hangarCount = 6;
  for (let i = 0; i < hangarCount; i++) {
    const hz = cz - apronD / 2 + 34 + i * (apronD - 68) / (hangarCount - 1);
    const hx = apronX - apronW / 2 - 22;
    const hw = 34, hd = 26, hh = 12;
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

    // A parked "aircraft" silhouette on the apron in front of each hangar.
    const px = apronX - apronW / 2 + 14;
    crates.push({ pos: new THREE.Vector3(px, 1.0, hz), size: 2.2, color: "#7a8088" });
    crates.push({ pos: new THREE.Vector3(px + 4, 0.8, hz), size: 1.6, color: "#6f757d" });
  }

  // --- Motor pool: organized rows of parked armour on the apron ----------
  // Neat parallel rows of tanks, APCs, trucks and humvees facing the gate
  // (north). Camo sand/olive palette. Placed on the south part of the apron.
  const camo = ["#7c7355", "#6f6a4a", "#857a58", "#5f6347", "#8a7f5d"];
  const rowKinds: ParkedVehicle["kind"][] = ["tank", "apc", "humvee", "truck"];
  const poolX0 = apronX - apronW / 2 + 34; // left edge of the motor pool
  const poolZ0 = cz + 30;                  // front (north) edge
  const cols = 6;
  const rows = 7;
  const colGap = 13;
  const rowGap = 12;
  for (let r = 0; r < rows; r++) {
    const kind = rowKinds[r % rowKinds.length];
    for (let c = 0; c < cols; c++) {
      const px = poolX0 + c * colGap;
      const pz = poolZ0 + r * rowGap;
      if (px > apronX + apronW / 2 - 10) continue;
      if (pz > cz + halfZ - 14) continue;
      parkedVehicles.push({
        pos: new THREE.Vector3(px, 0, pz),
        yaw: Math.PI, // face north (toward the gate / battlefield)
        kind,
        color: camo[(r + c) % camo.length],
      });
    }
  }

  // --- Supply yard: shipping containers + crates near the south-east -----
  const contColors = ["#5a6b4a", "#7a6a3a", "#6a5a4a", "#4a5a6a", "#7c5436"];
  for (let i = 0; i < 12; i++) {
    const stackX = apronX - 40 + (i % 6) * 7;
    const stackZ = cz + halfZ - 18 - Math.floor(i / 6) * 8;
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
    const pz = cz + halfZ - 6 - Math.floor(i / 8) * 2.0;
    crates.push({ pos: new THREE.Vector3(px, 0.6, pz), size: 1.1, color: "#7a5028" });
  }

  // --- Fuel / ammo storage: drums + revetment blast walls (east apron) ---
  for (let i = 0; i < 6; i++) {
    const rz = cz - apronD * 0.4 + i * (apronD * 0.8 / 5);
    const rx = apronX + apronW / 2 - 30;
    sandbags.push({ pos: new THREE.Vector3(rx, 1.6, rz), size: new THREE.Vector3(11, 3.2, 1.1), color: "#8a8f86", kind: "barrier" });
    for (let d = 0; d < 4; d++) {
      barrels.push({ pos: new THREE.Vector3(rx + 4 + (d % 2) * 0.9, 0, rz - 2 + d * 1.0), color: d % 2 ? "#3a3a3a" : "#7a4a1a" });
    }
  }

  // --- Extra airfield detailing (fuel farm, fire station, GSE, lights …) --
  // Pushes a much richer set of authentic airbase structures and ground
  // equipment around the runway / taxiway / apron so the facility reads as a
  // busy, lived-in operational base rather than a bare paved rectangle.
  buildAirfieldDetails(rng, {
    cx, cz, halfX, halfZ,
    rwX, rwW, rwLen, taxiX, apronX, apronW, apronD,
    Y_SURFACE, PAINT_Y, APRON_Y,
  }, buildings, parkedVehicles, containers, barrels, sandbags, lamps, crates, roads, walls, fuelTanks);

  return walls;
}

// Extra set-dressing for the fused airbase. All geometry is anchored to the
// layout metrics computed in buildBaseCompound() so everything lines up with
// the runway, taxiway and apron. Pure decoration + light cover; nothing here
// changes gameplay spawns.
interface AirfieldLayout {
  cx: number; cz: number; halfX: number; halfZ: number;
  rwX: number; rwW: number; rwLen: number;
  taxiX: number; apronX: number; apronW: number; apronD: number;
  Y_SURFACE: number; PAINT_Y: number; APRON_Y: number;
}
function buildAirfieldDetails(
  rng: () => number,
  L: AirfieldLayout,
  buildings: Building[],
  parkedVehicles: ParkedVehicle[],
  containers: Container[],
  barrels: Barrel[],
  sandbags: Wall[],
  lamps: Lamp[],
  crates: Crate[],
  roads: Road[],
  walls: Wall[],
  fuelTanks: FuelTank[],
) {
  const { cx, cz, halfX, halfZ, rwX, rwW, rwLen, taxiX, apronX, apronW, apronD, Y_SURFACE, PAINT_Y } = L;
  const concrete = "#8f8a7e";
  const concreteDark = "#736e62";
  const metal = "#9aa0a4";

  // ---------------------------------------------------------------------
  // (A) FUEL FARM — a cluster of big cylindrical storage tanks inside a
  //     bunded (low blast-wall) enclosure at the south-east corner, with a
  //     pump shed and connecting pipe runs. Tanks are tall barrels.
  // ---------------------------------------------------------------------
  const fuelX = apronX + apronW / 2 - 26;
  const fuelZ = cz + halfZ - 40;
  // Containment berm (low wall ring) around the tank farm.
  const bermW = 46, bermD = 30, bermH = 1.8, bt = 1.0;
  walls.push({ pos: new THREE.Vector3(fuelX, bermH / 2, fuelZ - bermD / 2), size: new THREE.Vector3(bermW, bermH, bt), color: concreteDark, kind: "barrier" });
  walls.push({ pos: new THREE.Vector3(fuelX, bermH / 2, fuelZ + bermD / 2), size: new THREE.Vector3(bermW, bermH, bt), color: concreteDark, kind: "barrier" });
  walls.push({ pos: new THREE.Vector3(fuelX - bermW / 2, bermH / 2, fuelZ), size: new THREE.Vector3(bt, bermH, bermD), color: concreteDark, kind: "barrier" });
  walls.push({ pos: new THREE.Vector3(fuelX + bermW / 2, bermH / 2, fuelZ), size: new THREE.Vector3(bt, bermH, bermD), color: concreteDark, kind: "barrier" });
  // Three big cylindrical fuel tanks in two rows inside the bund.
  const tankCols = ["#d8d4c4", "#cfcbbb", "#c4c0b0"];
  for (let i = 0; i < 3; i++) {
    const tx = fuelX - bermW / 2 + 12 + i * 12;
    fuelTanks.push({ pos: new THREE.Vector3(tx, 0, fuelZ - 4), radius: 4.4, height: 9, color: tankCols[i % 3] });
    fuelTanks.push({ pos: new THREE.Vector3(tx, 0, fuelZ + 6), radius: 4.4, height: 9, color: tankCols[(i + 1) % 3] });
  }
  // Pump / control shed beside the farm.
  const pumpShed = makeBuilding(rng, fuelX + bermW / 2 + 8, fuelZ, 10, 8, STOREY_HEIGHT);
  buildings.push(pumpShed);
  // A refueling bowser parked near the gate of the fuel farm.
  parkedVehicles.push({ pos: new THREE.Vector3(fuelX - bermW / 2 - 10, 0, fuelZ - 8), yaw: Math.PI / 2, kind: "truck", color: "#6f6a4a" });

  // ---------------------------------------------------------------------
  // (B) FIRE / CRASH-RESCUE STATION — a low building with two engine bays
  //     near the runway mid-point, with two crash trucks parked outside.
  // ---------------------------------------------------------------------
  const fireX = taxiX + 26;
  const fireZ = cz - rwLen * 0.18;
  const fireStn = makeBuilding(rng, fireX, fireZ, 22, 12, STOREY_HEIGHT * 1.4);
  buildings.push(fireStn);
  // Roll-up bay doors (lighter panels) facing the runway (-x side).
  walls.push({ pos: new THREE.Vector3(fireX - 11.2, STOREY_HEIGHT * 0.7, fireZ - 5), size: new THREE.Vector3(0.3, STOREY_HEIGHT * 1.2, 7), color: "#b0432f", kind: "wall" });
  walls.push({ pos: new THREE.Vector3(fireX - 11.2, STOREY_HEIGHT * 0.7, fireZ + 5), size: new THREE.Vector3(0.3, STOREY_HEIGHT * 1.2, 7), color: "#b0432f", kind: "wall" });
  for (const dz of [-5, 5]) {
    parkedVehicles.push({ pos: new THREE.Vector3(fireX - 20, 0, fireZ + dz), yaw: -Math.PI / 2, kind: "truck", color: "#9c2f22" });
  }

  // ---------------------------------------------------------------------
  // (C) WINDSOCK + segmented circle near the runway mid-point.
  // ---------------------------------------------------------------------
  const wsX = rwX - rwW / 2 - 14;
  const wsZ = cz;
  walls.push({ pos: new THREE.Vector3(wsX, 3.0, wsZ), size: new THREE.Vector3(0.3, 6.0, 0.3), color: "#dddddd", kind: "pillar" });
  // Striped cone segments (orange/white) held aloft.
  for (let s = 0; s < 4; s++) {
    walls.push({
      pos: new THREE.Vector3(wsX + 1.2 + s * 1.0, 5.6, wsZ),
      size: new THREE.Vector3(1.0, 1.0 - s * 0.12, 1.0 - s * 0.12),
      color: s % 2 ? "#e8e4d4" : "#e0631e",
      kind: "barrier",
    });
  }

  // ---------------------------------------------------------------------
  // (D) APPROACH / RUNWAY EDGE LIGHTING — small light stubs marching down
  //     both runway shoulders, plus a PAPI bar and an approach-light array
  //     off each threshold so the strip reads as fully lit.
  // ---------------------------------------------------------------------
  const edgeN = 24;
  for (let i = 0; i <= edgeN; i++) {
    const lz = cz - rwLen / 2 + (i / edgeN) * rwLen;
    for (const side of [-1, 1]) {
      walls.push({
        pos: new THREE.Vector3(rwX + side * (rwW / 2 + 2.0), 0.55, lz),
        size: new THREE.Vector3(0.35, 1.1, 0.35),
        color: side < 0 ? "#d8d2b0" : "#d8d2b0",
        kind: "pillar",
      });
    }
  }
  // PAPI four-light bar to the left of each threshold.
  for (const end of [-1, 1]) {
    for (let k = 0; k < 4; k++) {
      walls.push({
        pos: new THREE.Vector3(rwX - rwW / 2 - 8 - k * 1.6, 0.5, cz + end * (rwLen / 2 - 30)),
        size: new THREE.Vector3(1.1, 0.9, 1.1),
        color: k < 2 ? "#d83a2a" : "#e8e8e0",
        kind: "pillar",
      });
    }
    // Approach-light bars marching beyond each threshold (off the paved end).
    for (let a = 1; a <= 5; a++) {
      walls.push({
        pos: new THREE.Vector3(rwX, 0.45, cz + end * (rwLen / 2 + a * 8)),
        size: new THREE.Vector3(rwW * 0.8, 0.6, 0.5),
        color: "#e6e6d0",
        kind: "barrier",
      });
    }
  }

  // ---------------------------------------------------------------------
  // (E) HARDENED AIRCRAFT SHELTERS (HAS) — three arched revetment shelters
  //     in a dispersal area west of the runway, each an open-fronted earth-
  //     covered box that an aircraft would taxi into.
  // ---------------------------------------------------------------------
  const hasX = rwX - rwW / 2 - 46;
  const hasCol = "#7e7a5e";
  for (let i = 0; i < 3; i++) {
    const hz = cz - rwLen * 0.28 + i * (rwLen * 0.28);
    const sw = 22, sd = 18, sh = 9, st = 1.4;
    // Back + two side walls (front open toward the runway, +x).
    walls.push({ pos: new THREE.Vector3(hasX - sw / 2, sh / 2, hz), size: new THREE.Vector3(st, sh, sd), color: hasCol, kind: "wall" });
    walls.push({ pos: new THREE.Vector3(hasX, sh / 2, hz - sd / 2), size: new THREE.Vector3(sw, sh, st), color: hasCol, kind: "wall" });
    walls.push({ pos: new THREE.Vector3(hasX, sh / 2, hz + sd / 2), size: new THREE.Vector3(sw, sh, st), color: hasCol, kind: "wall" });
    // Sloped earth-covered roof (a couple of stacked slabs to fake the arch).
    walls.push({ pos: new THREE.Vector3(hasX, sh + 0.6, hz), size: new THREE.Vector3(sw + 1.5, 1.2, sd + 1.5), color: "#8a7a54", kind: "roof" });
    walls.push({ pos: new THREE.Vector3(hasX, sh + 1.6, hz), size: new THREE.Vector3(sw * 0.7, 1.0, sd * 0.7), color: "#8a7a54", kind: "roof" });
    // A short taxi-spur decal connecting the shelter mouth to the runway.
    roads.push({ pos: new THREE.Vector3((hasX + rwX) / 2, Y_SURFACE, hz), size: new THREE.Vector3(rwX - hasX, 0.02, 8), color: "#3a3e44" });
  }

  // ---------------------------------------------------------------------
  // (F) GROUND SUPPORT EQUIPMENT (GSE) scattered on the flight-line apron:
  //     tow tractors, generator carts, stair trucks and stacked wheel
  //     chocks / equipment crates between the parking rows.
  // ---------------------------------------------------------------------
  for (let i = 0; i < 8; i++) {
    const gx = apronX - apronW / 2 + 20 + (i % 4) * 24 + (rng() - 0.5) * 6;
    const gz = cz - apronD / 2 + 40 + Math.floor(i / 4) * 36 + (rng() - 0.5) * 6;
    parkedVehicles.push({ pos: new THREE.Vector3(gx, 0, gz), yaw: rng() * Math.PI * 2, kind: "humvee", color: "#d6d000" });
    // generator / GPU cart represented as a small crate cluster
    crates.push({ pos: new THREE.Vector3(gx + 3, 0.7, gz + 2), size: 1.3, color: "#586b58" });
    crates.push({ pos: new THREE.Vector3(gx + 4.4, 0.6, gz + 2), size: 1.0, color: "#4a5a4a" });
  }
  // Equipment / tool crates lined neatly along the hangar frontage.
  for (let i = 0; i < 18; i++) {
    const ex = apronX - apronW / 2 - 6;
    const ez = cz - apronD / 2 + 30 + i * (apronD - 60) / 17;
    crates.push({ pos: new THREE.Vector3(ex, 0.6, ez), size: 1.0 + (i % 3) * 0.15, color: i % 2 ? "#6b6240" : "#7a6a3a" });
  }

  // ---------------------------------------------------------------------
  // (G) JERSEY-BARRIER lane dividers + bollards separating the taxiway from
  //     the parking apron, guiding ground traffic.
  // ---------------------------------------------------------------------
  for (let i = 0; i < 14; i++) {
    const bz = cz - apronD / 2 + 10 + i * (apronD - 20) / 13;
    walls.push({ pos: new THREE.Vector3(taxiX + 30, 0.55, bz), size: new THREE.Vector3(1.0, 1.1, 3.2), color: "#c9c4b4", kind: "barrier" });
  }

  // ---------------------------------------------------------------------
  // (H) SUPPORT BUILDINGS along the east wall — squadron ops / barracks /
  //     workshop blocks, giving the base a populated cantonment edge.
  // ---------------------------------------------------------------------
  const opsX = cx + halfX - 30;
  for (let i = 0; i < 4; i++) {
    const oz = cz - halfZ + 60 + i * 70;
    const w = 24 + (i % 2) * 8;
    const d = 16;
    const floors = 1 + (i % 2);
    const b = makeBuilding(rng, opsX, oz, w, d, STOREY_HEIGHT * floors);
    buildings.push(b);
    // A lamp + a couple of parked support trucks out front.
    lamps.push({ pos: new THREE.Vector3(opsX - w / 2 - 6, 0, oz) });
    parkedVehicles.push({ pos: new THREE.Vector3(opsX - w / 2 - 12, 0, oz + 5), yaw: -Math.PI / 2, kind: "truck", color: "#5f6347" });
  }

  // ---------------------------------------------------------------------
  // (I) COMMS / RADAR yard — a fenced patch near the control tower side
  //     with a tall lattice antenna mast and a rotating-radar dish stub.
  // ---------------------------------------------------------------------
  const radarX = apronX + apronW / 2 - 14;
  const radarZ = cz - apronD / 2 + 24;
  // Tall lattice mast.
  walls.push({ pos: new THREE.Vector3(radarX, 11, radarZ), size: new THREE.Vector3(0.6, 22, 0.6), color: metal, kind: "pillar" });
  walls.push({ pos: new THREE.Vector3(radarX, 22.4, radarZ), size: new THREE.Vector3(0.25, 4, 0.25), color: "#cf3b2f", kind: "pillar" });
  // Guy-anchor blocks around the mast.
  for (let a = 0; a < 3; a++) {
    const ga = a * (Math.PI * 2 / 3);
    crates.push({ pos: new THREE.Vector3(radarX + Math.cos(ga) * 6, 0.4, radarZ + Math.sin(ga) * 6), size: 0.8, color: "#6a6a6a" });
  }
  // Squat radar plinth + dish.
  walls.push({ pos: new THREE.Vector3(radarX + 10, 1.6, radarZ), size: new THREE.Vector3(3, 3.2, 3), color: concrete, kind: "wall" });
  walls.push({ pos: new THREE.Vector3(radarX + 10, 4.0, radarZ), size: new THREE.Vector3(4.5, 0.5, 1.2), color: "#dcdce0", kind: "roof" });

  // ---------------------------------------------------------------------
  // (J) ARMING / HOLDING APRON markings near each runway end (run-up pads)
  //     plus a couple of revetment blast walls for last-chance checks.
  // ---------------------------------------------------------------------
  for (const end of [-1, 1]) {
    const padZ = cz + end * (rwLen / 2 - 70);
    roads.push({ pos: new THREE.Vector3(taxiX, Y_SURFACE, padZ), size: new THREE.Vector3(26, 0.02, 26), color: "#3a3e44" });
    roads.push({ pos: new THREE.Vector3(taxiX, PAINT_Y, padZ), size: new THREE.Vector3(22, 0.02, 0.5), color: "#d6b73c" });
    sandbags.push({ pos: new THREE.Vector3(taxiX + 15, 1.6, padZ), size: new THREE.Vector3(1.0, 3.2, 12), color: "#8a8f86", kind: "barrier" });
  }
}

// === DESERT-RIM OUTPOSTS (前哨陣地) =========================================
// Three forward fortified outposts placed at the open OUTER EDGE of the desert
// (clear of the airfield, the city core and the citadel). Each one is seated on
// a deliberately RAISED earth mound (a TerrainHill pushed here) so it physically
// commands the lower ground around it — the high-ground advantage is built into
// the terrain, not faked. On top of that high ground every outpost gets:
//   * a sandbag/HESCO perimeter ring (waist-high cover),
//   * a two-storey watch/sniper tower with an elevated nest and a parapet,
//   * one or two flanking elevated sniper berms,
//   * explicit SniperPost markers (position + facing + measured elevation
//     advantage) so the AI and the tactical map can use the high ground on
//     purpose,
//   * sniper-rifle + ammo pickups as a reward for taking the high ground.
// Returns the collidable wall segments (built in LOCAL y; the caller lifts them
// onto the mound). Mounds are appended to `hills` here so they exist before the
// world's groundAt() seating pass runs.
function buildDesertOutposts(
  rng: () => number,
  hills: TerrainHill[],
  sandbags: Wall[],
  crates: Crate[],
  barrels: Barrel[],
  lamps: Lamp[],
  containers: Container[],
  pickupSpawns: PickupSpawn[],
  outposts: Outpost[],
  sniperPosts: SniperPost[],
): Wall[] {
  const walls: Wall[] = [];

  // Outpost anchor points around the desert outer rim. They are deliberately
  // spread to the far N, far SE and far W edges so they ring the playable area
  // and overwatch the approaches into the central battlefield. Each faces
  // (yaw) roughly toward the contested map center so its sniper lanes look in.
  const R = WORLD_SIZE * 0.42; // sit well out toward the perimeter wall
  const defs: { name: string; x: number; z: number; faceYaw: number; moundH: number; moundR: number }[] = [
    // North-east ridge outpost — on the open desert NORTH of the city (east of
    // the airfield's flat rectangle), overwatching the northern approach.
    { name: "北稜前哨", x: WORLD_SIZE * 0.14, z: -R, faceYaw: Math.PI / 2, moundH: 18, moundR: 46 },
    // South-east dune outpost — overwatches the city's south-east flank.
    { name: "東丘前哨", x: WORLD_SIZE * 0.34, z: R * 0.92, faceYaw: -Math.PI * 0.75, moundH: 16, moundR: 44 },
    // South-west escarpment outpost — in the open desert at the far SOUTH-WEST
    // corner (clear of the airfield's tall flat rectangle), overwatching the
    // western flank and the south map edge.
    { name: "西崖前哨", x: -R * 0.55, z: R, faceYaw: -Math.PI / 4, moundH: 20, moundR: 48 },
  ];

  defs.forEach((d, i) => {
    const ow = buildOneOutpost(
      rng, i, d.name, d.x, d.z, d.faceYaw, d.moundH, d.moundR,
      hills, sandbags, crates, barrels, lamps, containers, pickupSpawns, outposts, sniperPosts,
    );
    walls.push(...ow);
  });

  return walls;
}

// Build a single desert outpost centred on (cx, cz). Pushes a raised mound onto
// `hills`, scatters cover/props, and returns the LOCAL-y collidable walls (the
// tower, parapets and sniper berms). All vertical coordinates are measured from
// the mound's surface (local ground = 0); the caller adds the terrain height.
function buildOneOutpost(
  rng: () => number,
  id: number,
  name: string,
  cx: number,
  cz: number,
  faceYaw: number,
  moundH: number,
  moundR: number,
  hills: TerrainHill[],
  sandbags: Wall[],
  crates: Crate[],
  barrels: Barrel[],
  lamps: Lamp[],
  containers: Container[],
  pickupSpawns: PickupSpawn[],
  outposts: Outpost[],
  sniperPosts: SniperPost[],
): Wall[] {
  const walls: Wall[] = [];
  const sandColor = "#a8895a";
  const hescoColor = "#9c8456";
  const concrete = "#8f8a7e";
  const concreteDark = "#736e62";

  // Forward (facing) unit vector and its right-hand perpendicular, used to lay
  // out the tower, berms and sniper lanes relative to the way the outpost looks.
  const fx = Math.cos(faceYaw);
  const fz = Math.sin(faceYaw);
  const rxv = Math.cos(faceYaw + Math.PI / 2);
  const rzv = Math.sin(faceYaw + Math.PI / 2);

  // 1) Raise the commanding mound. A broad, smooth hill so the whole outpost
  //    sits clearly above the surrounding desert floor (the explicit 高低差).
  hills.push({
    pos: new THREE.Vector3(cx, 0, cz),
    radius: moundR,
    height: moundH,
    color: "#8a7a54",
  });

  // 2) Sandbag / HESCO perimeter ring on the mound crest (waist-high cover with
  //    firing gaps). Built as short tangential segments around a circle.
  const ringR = 13;
  const ringSegs = 16;
  for (let s = 0; s < ringSegs; s++) {
    if (s % 4 === 3) continue; // leave firing gaps / an entrance
    const a = (s / ringSegs) * Math.PI * 2;
    const sx = cx + Math.cos(a) * ringR;
    const sz = cz + Math.sin(a) * ringR;
    const tang = a + Math.PI / 2;
    const alongX = Math.abs(Math.cos(tang)) > Math.abs(Math.sin(tang));
    const segLen = ringR * (Math.PI * 2 / ringSegs) + 1.2;
    sandbags.push({
      pos: new THREE.Vector3(sx, 0.55, sz),
      size: alongX ? new THREE.Vector3(segLen, 1.1, 0.9) : new THREE.Vector3(0.9, 1.1, segLen),
      color: hescoColor,
      kind: "barrier",
    });
  }

  // 3) Watch / sniper TOWER at the rear of the ring (opposite the facing dir so
  //    the nest looks out over the perimeter toward the battlefield). A hollow
  //    concrete shaft carrying an elevated open nest with a parapet — the
  //    primary high-ground firing position.
  const towerH = 7.0;            // shaft height above the mound
  const towerW = 5.0;            // shaft footprint
  const tx = cx - fx * (ringR - 2.5);
  const tz = cz - fz * (ringR - 2.5);
  const wt = 0.5;
  const hw = towerW / 2;
  walls.push({ pos: new THREE.Vector3(tx, towerH / 2, tz + hw), size: new THREE.Vector3(towerW, towerH, wt), color: concrete, kind: "wall" });
  walls.push({ pos: new THREE.Vector3(tx, towerH / 2, tz - hw), size: new THREE.Vector3(towerW, towerH, wt), color: concrete, kind: "wall" });
  walls.push({ pos: new THREE.Vector3(tx + hw, towerH / 2, tz), size: new THREE.Vector3(wt, towerH, towerW), color: concrete, kind: "wall" });
  walls.push({ pos: new THREE.Vector3(tx - hw, towerH / 2, tz), size: new THREE.Vector3(wt, towerH, towerW), color: concrete, kind: "wall" });
  // Nest floor slab on top of the shaft.
  const nestY = towerH;
  walls.push({ pos: new THREE.Vector3(tx, nestY + 0.15, tz), size: new THREE.Vector3(towerW + 1.2, 0.3, towerW + 1.2), color: concreteDark, kind: "floor" });
  // Low parapet around the nest (cover at the firing line).
  const pH = 0.95;
  const pT = 0.35;
  const pY = nestY + 0.3 + pH / 2;
  const nHalf = (towerW + 1.2) / 2;
  walls.push({ pos: new THREE.Vector3(tx, pY, tz + nHalf), size: new THREE.Vector3(towerW + 1.4, pH, pT), color: concrete, kind: "barrier" });
  walls.push({ pos: new THREE.Vector3(tx, pY, tz - nHalf), size: new THREE.Vector3(towerW + 1.4, pH, pT), color: concrete, kind: "barrier" });
  walls.push({ pos: new THREE.Vector3(tx + nHalf, pY, tz), size: new THREE.Vector3(pT, pH, towerW + 1.4), color: concrete, kind: "barrier" });
  walls.push({ pos: new THREE.Vector3(tx - nHalf, pY, tz), size: new THREE.Vector3(pT, pH, towerW + 1.4), color: concrete, kind: "barrier" });
  // Stepped ramp climbing the inside face of the tower up to the nest so the
  // player/AI can actually reach the high firing position.
  const rampSteps = 8;
  for (let s = 0; s < rampSteps; s++) {
    const t = (s + 1) / rampSteps;
    const y = nestY * t;
    // Climb toward the tower from the ring center side (the +face direction).
    const rr = (ringR - 2.5) - s * ((ringR - 4.0) / rampSteps);
    const sxp = cx - fx * rr;
    const szp = cz - fz * rr;
    walls.push({
      pos: new THREE.Vector3(sxp, y / 2, szp),
      size: new THREE.Vector3(2.4, Math.max(0.4, y), 2.4),
      color: concreteDark,
      kind: "floor",
    });
  }

  // The tower nest is the PRIMARY sniper post. Record it with its measured
  // elevation advantage (mound height + tower height) over the desert floor.
  const towerNestElevation = moundH + nestY;
  sniperPosts.push({
    pos: new THREE.Vector3(tx, nestY + 0.45, tz),
    yaw: faceYaw,
    elevation: towerNestElevation,
    outpostId: id,
  });
  // Reward for holding the high ground: a sniper rifle + ammo on the nest.
  pickupSpawns.push({ pos: new THREE.Vector3(tx, nestY + 0.7, tz), kind: "weapon", weaponId: "sniper" });
  pickupSpawns.push({ pos: new THREE.Vector3(tx + 0.8, nestY + 0.6, tz), kind: "ammo", amount: 60 });

  // 4) Two flanking elevated sniper BERMS on the forward arc — raised concrete
  //    pads (knee-to-waist height) flush with the parapet, giving secondary
  //    high-ground positions that cover the approaches from the sides.
  const bermElevation = moundH + 1.3;
  for (const side of [-1, 1]) {
    const bx = cx + fx * (ringR - 4) + rxv * side * (ringR - 3);
    const bz = cz + fz * (ringR - 4) + rzv * side * (ringR - 3);
    // Raised pad to stand on.
    walls.push({ pos: new THREE.Vector3(bx, 0.65, bz), size: new THREE.Vector3(3.2, 1.3, 3.2), color: concreteDark, kind: "floor" });
    // A forward sandbag lip for the prone firing line.
    sandbags.push({
      pos: new THREE.Vector3(bx + fx * 1.6, 1.55, bz + fz * 1.6),
      size: Math.abs(fx) > Math.abs(fz) ? new THREE.Vector3(0.9, 0.9, 3.2) : new THREE.Vector3(3.2, 0.9, 0.9),
      color: hescoColor,
      kind: "barrier",
    });
    // Each berm is an explicit secondary sniper post (faces the same lane,
    // angled slightly outward to fan the coverage).
    sniperPosts.push({
      pos: new THREE.Vector3(bx, 1.55, bz),
      yaw: faceYaw + side * 0.35,
      elevation: bermElevation,
      outpostId: id,
    });
  }
  // A little extra sniper ammo split between the berms.
  pickupSpawns.push({ pos: new THREE.Vector3(cx + fx * (ringR - 4), 1.7, cz + fz * (ringR - 4)), kind: "ammo", amount: 40 });

  // 5) Set-dressing on the mound: a couple of CONEX boxes, supply crates,
  //    fuel drums and a floodlight pole so the outpost reads as occupied.
  containers.push({
    pos: new THREE.Vector3(cx - rxv * (ringR - 6), 0, cz - rzv * (ringR - 6)),
    size: new THREE.Vector3(6.0, 2.5, 2.4),
    yaw: faceYaw,
    color: "#5a6b4a",
  });
  for (let c = 0; c < 4; c++) {
    crates.push({
      pos: new THREE.Vector3(cx + (rng() - 0.5) * 8, 0.55, cz + (rng() - 0.5) * 8),
      size: 1.0 + rng() * 0.5,
      color: "#7a5028",
    });
  }
  for (let b = 0; b < 3; b++) {
    barrels.push({ pos: new THREE.Vector3(cx + rxv * (4 + b), 0, cz + rzv * (4 + b)), color: b % 2 ? "#3a3a3a" : "#7a4a1a" });
  }
  lamps.push({ pos: new THREE.Vector3(tx, 0, tz + (faceYaw === 0 ? 3 : 0)) });

  // 6) Register the outpost (ground center filled in by the caller's seating
  //    pass; here we store the local center and footprint).
  outposts.push({
    id,
    pos: new THREE.Vector3(cx, 0, cz),
    groundY: 0,
    radius: moundR,
    name,
    sniperPosts: sniperPosts.filter((sp) => sp.outpostId === id),
  });

  return walls;
}

// Build a detailed air-traffic-control tower at (tx, tz) seated on ground
// height `baseY`. Produces: a tapered concrete shaft, a wider cantilevered
// glass observation cab with a slanted-out window band and a railing parapet,
// a flat roof, and a thin antenna mast. Pushed into `buildings` as collidable
// structures (cab carries `info` so it can host windows/decoration).
function buildAirfieldTower(buildings: Building[], tx: number, tz: number, baseY: number) {
  const shaftH = STOREY_HEIGHT * 7; // ~24m shaft
  const shaftW = 8;
  const cabH = STOREY_HEIGHT * 1.6;
  const cabW = 13; // cab overhangs the shaft on all sides
  const concrete = "#8d8f93";
  const glass = "#3c5d72";
  const roofCol = "#54585d";

  const walls: Wall[] = [];
  const wt = 0.5;
  const hw = shaftW / 2;
  // Four shaft walls (hollow so it reads as a real tower, with stair access
  // provided elsewhere is unnecessary — it is set dressing/cover here).
  walls.push({ pos: new THREE.Vector3(tx, baseY + shaftH / 2, tz + hw), size: new THREE.Vector3(shaftW, shaftH, wt), color: concrete, kind: "wall" });
  walls.push({ pos: new THREE.Vector3(tx, baseY + shaftH / 2, tz - hw), size: new THREE.Vector3(shaftW, shaftH, wt), color: concrete, kind: "wall" });
  walls.push({ pos: new THREE.Vector3(tx + hw, baseY + shaftH / 2, tz), size: new THREE.Vector3(wt, shaftH, shaftW), color: concrete, kind: "wall" });
  walls.push({ pos: new THREE.Vector3(tx - hw, baseY + shaftH / 2, tz), size: new THREE.Vector3(wt, shaftH, shaftW), color: concrete, kind: "wall" });

  // Cab floor slab (cantilevered wider than the shaft).
  const cabBaseY = baseY + shaftH;
  walls.push({ pos: new THREE.Vector3(tx, cabBaseY + 0.15, tz), size: new THREE.Vector3(cabW + 0.6, 0.4, cabW + 0.6), color: roofCol, kind: "roof" });

  // Glass observation band (four tinted-glass walls around the cab).
  const chw = cabW / 2;
  const cy = cabBaseY + 0.4 + cabH / 2;
  walls.push({ pos: new THREE.Vector3(tx, cy, tz + chw), size: new THREE.Vector3(cabW, cabH, 0.35), color: glass, kind: "wall" });
  walls.push({ pos: new THREE.Vector3(tx, cy, tz - chw), size: new THREE.Vector3(cabW, cabH, 0.35), color: glass, kind: "wall" });
  walls.push({ pos: new THREE.Vector3(tx + chw, cy, tz), size: new THREE.Vector3(0.35, cabH, cabW), color: glass, kind: "wall" });
  walls.push({ pos: new THREE.Vector3(tx - chw, cy, tz), size: new THREE.Vector3(0.35, cabH, cabW), color: glass, kind: "wall" });

  // Cab roof slab + low parapet/railing around the roof.
  const roofY = cabBaseY + 0.4 + cabH;
  walls.push({ pos: new THREE.Vector3(tx, roofY + 0.2, tz), size: new THREE.Vector3(cabW + 1.0, 0.45, cabW + 1.0), color: roofCol, kind: "roof" });
  const pH = 0.8;
  const pY = roofY + 0.45 + pH / 2;
  walls.push({ pos: new THREE.Vector3(tx, pY, tz + chw + 0.4), size: new THREE.Vector3(cabW + 1.0, pH, 0.25), color: roofCol, kind: "barrier" });
  walls.push({ pos: new THREE.Vector3(tx, pY, tz - chw - 0.4), size: new THREE.Vector3(cabW + 1.0, pH, 0.25), color: roofCol, kind: "barrier" });
  walls.push({ pos: new THREE.Vector3(tx + chw + 0.4, pY, tz), size: new THREE.Vector3(0.25, pH, cabW + 1.0), color: roofCol, kind: "barrier" });
  walls.push({ pos: new THREE.Vector3(tx - chw - 0.4, pY, tz), size: new THREE.Vector3(0.25, pH, cabW + 1.0), color: roofCol, kind: "barrier" });

  // Antenna mast on the roof.
  walls.push({ pos: new THREE.Vector3(tx, roofY + 0.45 + 3.0, tz), size: new THREE.Vector3(0.3, 6.0, 0.3), color: "#cf3b2f", kind: "pillar" });

  buildings.push({
    walls,
    min: new THREE.Vector3(tx - chw, baseY, tz - chw),
    max: new THREE.Vector3(tx + chw, roofY, tz + chw),
    info: {
      cx: tx, cz: tz, w: shaftW, d: shaftW, h: shaftH,
      floors: 1, floorH: shaftH, doorSide: 1,
      color: concrete, roofColor: roofCol, hasParapet: false,
    },
  });
}

// === DISTRICT-SEAM CROSSINGS ==============================================
// Build the two ways across the fortified seam between the airbase and the
// city: (1) an elevated concrete vehicle OVERPASS to the north, with ramped
// approaches, piers, a walkable deck and side railings; and (2) a TUNNEL bored
// through a raised earth berm to the south, with portal head-walls, interior
// jamb walls and a roof slab so the player/AI can drive straight through.
//
// `hills` is appended to (the tunnel berm is a real TerrainHill so the bore
// reads as cutting through a mound). Returns the collidable wall segments.
function buildSeamCrossings(
  seamX: number,
  hills: TerrainHill[],
  lamps: Lamp[],
  roads: Road[],
): Wall[] {
  const walls: Wall[] = [];
  const concrete = "#9a958c";
  const concreteDark = "#7d796f";
  const deckColor = "#6f6a60";

  // ---------------------------------------------------------------------
  // (1) NORTH OVERPASS — a raised deck spanning the seam corridor.
  // ---------------------------------------------------------------------
  const bridgeZ = -WORLD_SIZE * 0.22; // north of center, clear of the city core
  const deckY = 7.0;                  // clearance over the seam blast-walls
  const deckW = 16;                   // east-west span across the seam
  const deckLen = 14;                 // north-south width of the carriageway
  const deckThick = 0.8;
  const rampRun = 26;                 // length of each approach ramp

  // Deck slab (walkable bridge surface, flat-topped).
  walls.push({
    pos: new THREE.Vector3(seamX, deckY, bridgeZ),
    size: new THREE.Vector3(deckW, deckThick, deckLen),
    color: deckColor,
    kind: "floor",
  });

  // Two support piers down to the ground on each side of the corridor.
  for (const sx of [-1, 1]) {
    const pierX = seamX + sx * (deckW / 2 - 1.4);
    walls.push({
      pos: new THREE.Vector3(pierX, deckY / 2, bridgeZ),
      size: new THREE.Vector3(2.0, deckY, deckLen * 0.7),
      color: concreteDark,
      kind: "pillar",
    });
  }

  // Side railings / parapets along both long edges of the deck.
  const railH = 1.1;
  for (const sz of [-1, 1]) {
    walls.push({
      pos: new THREE.Vector3(seamX, deckY + deckThick / 2 + railH / 2, bridgeZ + sz * (deckLen / 2 - 0.3)),
      size: new THREE.Vector3(deckW + 0.6, railH, 0.4),
      color: concrete,
      kind: "barrier",
    });
  }

  // Stepped approach ramps on each side (a short staircase of slabs climbing to
  // the deck) so vehicles/players can mount the overpass from either district.
  const rampSteps = 7;
  for (const dir of [-1, 1]) {
    // dir = -1 → ramp on the west (airbase) side, +1 → east (city) side.
    const startX = seamX + dir * (deckW / 2);
    for (let s = 0; s < rampSteps; s++) {
      const t = s / (rampSteps - 1);
      const y = deckY * t; // climb from ground (t=0) to deck (t=1)
      const segLen = rampRun / rampSteps;
      const stepX = startX + dir * (s + 0.5) * segLen;
      walls.push({
        pos: new THREE.Vector3(stepX, y / 2, bridgeZ),
        size: new THREE.Vector3(segLen + 0.4, Math.max(0.5, y), deckLen),
        color: deckColor,
        kind: "floor",
      });
    }
  }

  // A pair of lamps on the bridge deck corners.
  for (const sx of [-1, 1]) {
    lamps.push({ pos: new THREE.Vector3(seamX + sx * (deckW / 2 - 1.0), deckY + deckThick, bridgeZ) });
  }

  // ---------------------------------------------------------------------
  // (2) SOUTH TUNNEL — a bore through a raised earth berm.
  // ---------------------------------------------------------------------
  const tunnelZ = WORLD_SIZE * 0.2; // south of center
  const bermRadius = 60;
  const bermHeight = 16;
  // Raise a real terrain mound (berm) the tunnel cuts through.
  hills.push({
    pos: new THREE.Vector3(seamX, 0, tunnelZ),
    radius: bermRadius,
    height: bermHeight,
    color: "#8a7a54",
  });

  const bore = 9;        // east-west length of the tunnel (through the berm)
  const boreW = 9;       // carriageway width (north-south)
  const boreH = 5.5;     // interior clearance
  const wallT = 1.2;

  // Interior side walls (north & south jambs running through the bore).
  for (const sz of [-1, 1]) {
    walls.push({
      pos: new THREE.Vector3(seamX, boreH / 2, tunnelZ + sz * (boreW / 2 + wallT / 2)),
      size: new THREE.Vector3(bore + 16, boreH, wallT),
      color: concreteDark,
      kind: "wall",
    });
  }
  // Roof slab over the bore (holds the berm up over the carriageway).
  walls.push({
    pos: new THREE.Vector3(seamX, boreH + 0.4, tunnelZ),
    size: new THREE.Vector3(bore + 16, 0.8, boreW + wallT * 2 + 0.6),
    color: concreteDark,
    kind: "roof",
  });

  // Portal head-walls at each end (a framed concrete face around the opening,
  // built as a lintel beam plus two jambs that flank the carriageway).
  for (const dir of [-1, 1]) {
    const portalX = seamX + dir * (bore / 2 + 8);
    // Lintel beam above the opening.
    walls.push({
      pos: new THREE.Vector3(portalX, boreH + 1.1, tunnelZ),
      size: new THREE.Vector3(2.0, 2.2, boreW + 7),
      color: concrete,
      kind: "wall",
    });
    // Side jambs flanking the opening.
    for (const sz of [-1, 1]) {
      walls.push({
        pos: new THREE.Vector3(portalX, (boreH + 1) / 2, tunnelZ + sz * (boreW / 2 + 2.4)),
        size: new THREE.Vector3(2.0, boreH + 1, 4.0),
        color: concrete,
        kind: "wall",
      });
    }
  }

  // A short paved approach road on each side of the tunnel mouth, linking the
  // bore to the open ground (seated onto terrain later by groundAt()).
  for (const dir of [-1, 1]) {
    roads.push({
      pos: new THREE.Vector3(seamX + dir * (bore / 2 + 16), 0.05, tunnelZ),
      size: new THREE.Vector3(20, 0.02, boreW),
      color: "#5a4d34",
    });
  }

  return walls;
}

// Deck height of the elevated market-plaza gallery ring (used both by the
// plaza builder and to lift tents that sit on the ring).
export const PLAZA_GALLERY_Y = 3.2;

// === MULTI-LAYER MARKET PLAZA =============================================
// Turn the flat souk square around the central fountain into a tiered civic
// space:
//   * a stepped CENTRAL DAIS (concentric terraces) carrying the fountain,
//   * an elevated walkable GALLERY RING (deck on a colonnade) reached by four
//     stairways, with a low parapet so it gives rooftop-style cover,
//   * a ring of columns supporting the gallery.
// All segments are plain collidable boxes (floor/wall/pillar/barrier) seated on
// the flattened city ground (y=0 here). Returns the wall segments; a couple of
// pickup spawns are added on the dais + gallery as a reward for the high ground.
function buildMarketPlaza(
  px: number,
  pz: number,
  lamps: Lamp[],
  pickupSpawns: PickupSpawn[],
): Wall[] {
  const walls: Wall[] = [];
  const stone = "#b3a487";
  const stoneDark = "#8f8265";
  const deck = "#a59a78";

  // ---- Central stepped dais (3 concentric circular terraces) -------------
  // Approximated by stacked square slabs of decreasing size so the fountain
  // sits on a raised, climbable platform.
  const tierCount = 3;
  const tierH = 0.45;
  const baseHalf = 8.5; // outer terrace half-extent
  for (let t = 0; t < tierCount; t++) {
    const half = baseHalf - t * 2.4;
    const y = t * tierH;
    walls.push({
      pos: new THREE.Vector3(px, y + tierH / 2, pz),
      size: new THREE.Vector3(half * 2, tierH, half * 2),
      color: t % 2 ? stoneDark : stone,
      kind: "floor",
    });
  }

  // ---- Elevated gallery ring (square deck on a colonnade) ----------------
  const galleryY = PLAZA_GALLERY_Y;
  const ringInner = 26; // inner edge half-extent of the ring deck
  const ringOuter = 34; // outer edge half-extent
  const deckThick = 0.6;
  const ringMid = (ringInner + ringOuter) / 2;
  const ringWidth = ringOuter - ringInner;

  // Four deck strips (N, S, E, W) forming a square walkway ring, each leaving a
  // central gap aligned with the stairways below.
  // North & South strips run along x.
  for (const sz of [-1, 1]) {
    walls.push({
      pos: new THREE.Vector3(px, galleryY, pz + sz * ringMid),
      size: new THREE.Vector3(ringOuter * 2, deckThick, ringWidth),
      color: deck,
      kind: "floor",
    });
  }
  // East & West strips run along z (shortened to butt against the N/S strips).
  for (const sx of [-1, 1]) {
    walls.push({
      pos: new THREE.Vector3(px + sx * ringMid, galleryY, pz),
      size: new THREE.Vector3(ringWidth, deckThick, ringInner * 2),
      color: deck,
      kind: "floor",
    });
  }

  // Low parapet around the OUTER edge of the gallery ring (cover on the deck).
  const parH = 1.0;
  const parT = 0.4;
  const parY = galleryY + deckThick / 2 + parH / 2;
  for (const sz of [-1, 1]) {
    walls.push({ pos: new THREE.Vector3(px, parY, pz + sz * ringOuter), size: new THREE.Vector3(ringOuter * 2 + parT, parH, parT), color: stone, kind: "barrier" });
  }
  for (const sx of [-1, 1]) {
    walls.push({ pos: new THREE.Vector3(px + sx * ringOuter, parY, pz), size: new THREE.Vector3(parT, parH, ringOuter * 2 + parT), color: stone, kind: "barrier" });
  }

  // Colonnade: columns under the gallery ring supporting the deck.
  const colCount = 12;
  for (let i = 0; i < colCount; i++) {
    const a = (i / colCount) * Math.PI * 2;
    const cxp = px + Math.cos(a) * ringMid;
    const czp = pz + Math.sin(a) * ringMid;
    walls.push({
      pos: new THREE.Vector3(cxp, galleryY / 2, czp),
      size: new THREE.Vector3(0.8, galleryY, 0.8),
      color: stoneDark,
      kind: "pillar",
    });
  }

  // Four stairways climbing from the court up to the gallery deck (one per
  // cardinal direction, set in the gaps between deck strips).
  const stepCount = 7;
  const stairRun = 7;
  for (let dir = 0; dir < 4; dir++) {
    const ang = (dir / 4) * Math.PI * 2; // 0,90,180,270
    const ux = Math.cos(ang);
    const uz = Math.sin(ang);
    // Start just inside the inner ring edge, climb outward to the deck.
    const startR = ringInner - 1.0;
    for (let s = 0; s < stepCount; s++) {
      const t = (s + 0.5) / stepCount;
      const r = startR + t * stairRun;
      const y = galleryY * ((s + 1) / stepCount);
      const sxp = px + ux * r;
      const szp = pz + uz * r;
      // Step slab oriented across the climb direction.
      const along = Math.abs(ux) > Math.abs(uz);
      walls.push({
        pos: new THREE.Vector3(sxp, y - galleryY / (stepCount * 2), szp),
        size: along
          ? new THREE.Vector3(stairRun / stepCount + 0.3, Math.max(0.4, y), 4.0)
          : new THREE.Vector3(4.0, Math.max(0.4, y), stairRun / stepCount + 0.3),
        color: stoneDark,
        kind: "floor",
      });
    }
  }

  // Lamps at the four outer corners of the gallery ring.
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      lamps.push({ pos: new THREE.Vector3(px + sx * ringOuter, galleryY + deckThick, pz + sz * ringOuter) });
    }
  }

  // Reward pickups: ammo on the central dais top, a weapon on the gallery deck.
  pickupSpawns.push({ pos: new THREE.Vector3(px + 5, tierCount * tierH + 0.4, pz), kind: "ammo", amount: 60 });
  pickupSpawns.push({ pos: new THREE.Vector3(px + ringMid, galleryY + deckThick + 0.4, pz), kind: "weapon", weaponId: "sniper" });

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

// Returns the dead-level paved height (≈0) if (x,z) lies inside the fully
// flattened airfield / base rectangle, otherwise null. The detailed terrain
// mesh is a coarse displaced grid, so a vertex just OUTSIDE the flattened zone
// is tall and its triangle interpolates a height well above 0 as it crosses
// INTO the flat zone — which made the runway / apron look half-buried. The
// renderer uses this to SNAP every mesh vertex inside the (slightly expanded)
// paved footprint to a true flat plane, so the asphalt always sits cleanly on
// top of the ground with no interpolation overshoot poking through it.
export function pavedFlatHeightAt(x: number, z: number): number | null {
  const adx = Math.abs(x - AIRFIELD_CENTER_X);
  const adz = Math.abs(z - AIRFIELD_CENTER_Z);
  // Expand the snap region a touch past the flat half-extents so the hard-flat
  // plateau fully contains the apron and the boundary triangles are level too.
  const margin = 24;
  if (adx < AIRFIELD_FLAT_HALF_X + margin && adz < AIRFIELD_FLAT_HALF_Z + margin) {
    return 0;
  }
  return null;
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
    // Decorative façade trim (sills, lintels, plinths, string-courses) is
    // visual only — never a collider.
    if (w.decorative) continue;
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
  // Large fuel-farm storage tanks are solid (approximated as a square footprint
  // sized to the tank radius).
  for (const t of world.fuelTanks) {
    boxes.push({
      min: new THREE.Vector3(t.pos.x - t.radius, t.pos.y, t.pos.z - t.radius),
      max: new THREE.Vector3(t.pos.x + t.radius, t.pos.y + t.height, t.pos.z + t.radius),
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
    // The airfield and home base are now one fused facility.
    { x: BASE_POS.x, z: BASE_POS.z, name: "AIRBASE" },
    { x: CITADEL_X, z: CITADEL_Z, name: "CITADEL" },
    // Desert-rim outposts (前哨陣地) on the high ground.
    ...world.outposts.map((op) => ({ x: op.pos.x, z: op.pos.z, name: op.name })),
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
