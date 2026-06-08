import * as THREE from "three";
import { GameState, store } from "./store";
import type { World } from "./world";
import { Box, BoxGrid, worldToBoxes, rayBox, resolvePlayerCollision, WORLD_SIZE, terrainHeightAt, BASE_POS, BASE_HALF_Z } from "./world";
import { GRENADE_FUSE, GRENADE_RADIUS, SMOKE_DURATION, SMOKE_RADIUS, WEAPONS, makeWeaponState } from "./weapons";
import { Soldier, Pickup, WeaponId, Team, DestructibleObject, RagdollPart, SmokeCloud, CapturePoint, Vehicle, SoldierClass, SpawnPoint, Aircraft } from "./types";
import { CLASSES } from "./classes";
import { soundEngine } from "./sound";

const PLAYER_RADIUS = 0.4;
const PLAYER_HEIGHT = 1.7;
const EYE_HEIGHT = 1.65;
const GRAVITY = 22;
// Base on-foot movement speed for the player AND the AI soldiers (the AI's run
// cap is derived from this). Bumped 1.5x (7.0 -> 10.5) so everyone moves at the
// faster pace requested.
const MOVE_SPEED = 10.5;
const SPRINT_MULT = 1.4;
const JUMP_VEL = 7.5;
const SOLDIER_RADIUS = 0.5;
const SOLDIER_HEIGHT = 1.8;
const SOLDIER_HEAD_HEIGHT = 1.55;
const TEAM_SIZE = 24;
const PICKUP_RANGE = 1.8;
const VEHICLE_ENTER_RANGE = 4.0;
const CAPTURE_RADIUS = 12;
const CAPTURE_SPEED = 0.18;

// === AIRCRAFT TUNING =======================================================
const AIRCRAFT_GRAVITY       = 12;    // 失速時の降下力
const AIRCRAFT_LIFT_SPEED    = 40;    // この速度以上で揚力発生 (m/s) ※低速でも飛べるよう低減
const AIRCRAFT_STALL_SPEED   = 28;    // この速度未満で失速 ※低速旋回を許すため低減
// 水平飛行時の最高速 (m/s)。400km/h ≒ 111m/s。降下時はこの値を超えて
// 加速してよい (重力で速度が増す) ため、水平加速だけを抑える別ロジックで制限する。
const AIRCRAFT_LEVEL_MAX_SPEED     = 111;  // 水平最高速 fighter (≒400km/h)
const AIRCRAFT_ATK_LEVEL_MAX_SPEED = 90;   // 水平最高速 attacker (≒324km/h)
// 物理的な絶対上限 (急降下で出せる最大速)。水平制限よりは高い。
const AIRCRAFT_MAX_SPEED     = 180;   // 絶対上限 fighter (降下時)
const AIRCRAFT_ATK_MAX_SPEED = 140;   // 絶対上限 attacker (降下時)
const AIRCRAFT_GUN_RANGE     = 600;   // 機関銃有効射程
const AIRCRAFT_GUN_RPM       = 1200;  // 発射レート (rounds/min)
const AIRCRAFT_GUN_DAMAGE    = 18;
const AIRCRAFT_BOMB_RADIUS   = 28;    // 爆弾爆発半径
const AIRCRAFT_BOMB_DAMAGE   = 180;
const AIRCRAFT_HP_FIGHTER    = 180;
const AIRCRAFT_HP_ATTACKER   = 240;
const AIRCRAFT_RESPAWN_DELAY = 10;    // 着陸後の再出撃までの秒数
const AIRCRAFT_GUN_RELOAD    = 3;     // 弾切れ後の補充までの秒数
const AIRCRAFT_ENTER_RANGE   = 8.0;   // プレイヤーが搭乗できる水平距離

// === REALISTIC GROUND-VEHICLE DYNAMICS =====================================
// Per-kind physical handling characteristics. These drive a proper bicycle-ish
// vehicle model: engine force scaling, tyre grip (lateral), mass/inertia, brake
// strength, drag and steering authority. Light vehicles are nimble and slidey;
// heavy ones are slow to turn, grip hard and shrug off bumps.
interface VehicleDynamics {
  mass: number;          // relative mass (affects accel, inertia, bounce)
  enginePower: number;   // forward acceleration authority (m/s^2 scale)
  brakePower: number;    // braking / reverse authority
  grip: number;          // lateral tyre grip 0..1 (higher = less drift)
  steerRate: number;     // max steering angle authority (rad/s scale)
  steerEase: number;     // how quickly yawRate tracks the steering target
  drag: number;          // aerodynamic drag coefficient
  rollResist: number;    // rolling resistance / engine braking
  wheelbase: number;     // affects turn radius vs. speed
  rollStiff: number;     // body-lean stiffness (visual)
  trackWidth: number;    // resistance to rollover lean (visual)
}
// NOTE: the drag-limited terminal speed of each vehicle is ≈ sqrt(enginePower /
// drag). To make every ground vehicle reach the doubled top speed in
// VEHICLE_STATS, the aerodynamic `drag` is quartered (÷4) and `enginePower`
// roughly doubled here — quartering drag alone doubles the terminal speed, and
// the stronger engine keeps acceleration brisk so the higher cap is actually
// attained rather than crawled up to.
const VEHICLE_DYN: Record<Vehicle["kind"], VehicleDynamics> = {
  jeep:   { mass: 1.0, enginePower: 52, brakePower: 40, grip: 0.78, steerRate: 1.9, steerEase: 7.0, drag: 0.0050, rollResist: 0.9, wheelbase: 2.6, rollStiff: 0.040, trackWidth: 1.6 },
  humvee: { mass: 1.4, enginePower: 48, brakePower: 40, grip: 0.82, steerRate: 1.6, steerEase: 6.0, drag: 0.0060, rollResist: 1.0, wheelbase: 3.3, rollStiff: 0.034, trackWidth: 2.0 },
  truck:  { mass: 2.4, enginePower: 36, brakePower: 30, grip: 0.70, steerRate: 1.2, steerEase: 4.0, drag: 0.0085, rollResist: 1.3, wheelbase: 4.2, rollStiff: 0.030, trackWidth: 2.1 },
  apc:    { mass: 3.2, enginePower: 34, brakePower: 32, grip: 0.88, steerRate: 1.3, steerEase: 4.5, drag: 0.0075, rollResist: 1.5, wheelbase: 3.8, rollStiff: 0.022, trackWidth: 2.4 },
  tank:   { mass: 5.0, enginePower: 30, brakePower: 34, grip: 0.95, steerRate: 1.1, steerEase: 3.5, drag: 0.0070, rollResist: 1.8, wheelbase: 4.0, rollStiff: 0.015, trackWidth: 2.8 },
};

// === REALISTIC FLIGHT DYNAMICS =============================================
const AIRCRAFT_THRUST_FIGHTER = 95;   // 推力加速 (m/s^2) at full throttle
const AIRCRAFT_THRUST_ATTACKER = 70;
const AIRCRAFT_LIFT_COEF      = 0.0016; // 揚力係数 (×v^2)
const AIRCRAFT_DRAG_COEF      = 0.00022;// 寄生抗力係数 (×v^2)
const AIRCRAFT_INDUCED_DRAG   = 0.9;    // 誘導抗力 (旋回G依存)
const AIRCRAFT_STALL_AOA      = 0.32;   // 失速迎角 (rad ≈ 18°)
const AIRCRAFT_CTRL_EASE      = 6.5;    // 操縦入力の追従速度 (慣性感: 大きいほど機敏)
// エアブレーキ展開時に寄生抗力へ掛ける倍率。大きいほどよく止まる。
const AIRCRAFT_AIRBRAKE_DRAG  = 5.0;
// ランディングギア展開時の追加抗力 (×v^2)。脚を出すと少し減速する。
const AIRCRAFT_GEAR_DRAG_COEF = 0.00010;

// Reusable temp vectors to reduce allocations in hot paths
const _tmpV1 = new THREE.Vector3();
const _tmpV2 = new THREE.Vector3();
const _tmpV3 = new THREE.Vector3();

export class GameEngine {
  state: GameState;
  world: World;
  boxes: Box[];
  /** Spatial-grid broadphase over `boxes` for fast per-agent collision. */
  boxGrid: BoxGrid;
  input: {
    keys: Set<string>;
    consumeMouseDelta: () => { dx: number; dy: number };
    mouse: { left: boolean; right: boolean };
    touchMove?: { x: number; y: number };
    touchActive?: boolean;
    jumpPressed?: boolean;
    reloadPressed?: boolean;
    pickupPressed?: boolean;
    weaponSwitchPressed?: number | null;
    enterVehiclePressed?: boolean;
    aircraftEnterPressed?: boolean;
    vehicleGas?: boolean;
    vehicleBrake?: boolean;
    mapTogglePressed?: boolean;
    viewTogglePressed?: boolean;
    aircraftAirbrake?: boolean;
    gearTogglePressed?: boolean;
  };
  shootHeld = false;
  spawnPoints: SpawnPoint[] = [];
  private footstepTimer = 0;
  private lastShotSound = 0;
  private lastHitSound = 0;
  private emitTimer = 0;
  // Free-look glance offset (radians) applied on top of the vehicle heading
  // while driving, so the mouse can look around the cab without losing the
  // forward-tracking driver view. Recentred toward 0 when the mouse is idle.
  private vehicleLookYaw = 0;
  private vehicleLookPitch = 0;

  constructor(state: GameState, input: GameEngine["input"], world: World) {
    this.state = state;
    this.input = input;
    this.world = world;
    this.boxes = worldToBoxes(this.world);
    this.boxGrid = new BoxGrid(this.boxes);
    this.spawnDestructibles();
  }

  private spawnDestructibles() {
    for (const c of this.world.crates.slice(0, 130)) {
      this.state.destructibles.push({
        id: this.state.nextDestructibleId++,
        pos: c.pos.clone(),
        size: new THREE.Vector3(c.size, c.size, c.size),
        hp: 40,
        hpMax: 40,
        color: c.color,
        destroyed: false,
        kind: "crate",
      });
    }
    for (const b of this.world.barrels.slice(0, 45)) {
      this.state.destructibles.push({
        id: this.state.nextDestructibleId++,
        pos: new THREE.Vector3(b.pos.x, 0.55, b.pos.z),
        size: new THREE.Vector3(0.7, 1.1, 0.7),
        hp: 60,
        hpMax: 60,
        color: b.color,
        destroyed: false,
        kind: "barrel",
      });
    }
  }

  private spawnCapturePoints() {
    const half = WORLD_SIZE / 2;
    const points: { x: number; z: number; name: string }[] = [
      { x: 0, z: 0, name: "PLAZA" },
      { x: -half + 50, z: 0, name: "WEST" },
      { x: half - 50, z: 0, name: "EAST" },
      { x: 0, z: -half + 50, name: "NORTH" },
      { x: 0, z: half - 50, name: "SOUTH" },
    ];
    this.state.capturePoints = points.map((p, i) => ({
      id: i + 1,
      pos: new THREE.Vector3(p.x, 0, p.z),
      radius: CAPTURE_RADIUS,
      owner: null,
      progress: 0,
      name: p.name,
    }));
  }

  // Per-kind drivable vehicle tuning (hp + top speed).
  // Top speeds doubled (2x) from their original values per request so all
  // ground vehicles (everything except aircraft) drive twice as fast.
  private static VEHICLE_STATS: Record<Vehicle["kind"], { hp: number; speed: number }> = {
    jeep: { hp: 300, speed: 64 },
    humvee: { hp: 360, speed: 60 },
    truck: { hp: 420, speed: 48 },
    apc: { hp: 520, speed: 44 },
    tank: { hp: 600, speed: 40 },
  };

  private spawnVehicles() {
    const half = WORLD_SIZE / 2;
    let vid = 1;
    const stats = GameEngine.VEHICLE_STATS;

    const pushVehicle = (
      kind: Vehicle["kind"],
      x: number,
      z: number,
      yaw: number,
    ) => {
      const st = stats[kind];
      const y = terrainHeightAt(this.world, x, z) + (kind === "tank" ? 0.6 : 0.5);
      this.state.vehicles.push({
        id: vid++,
        pos: new THREE.Vector3(x, y, z),
        vel: new THREE.Vector3(),
        yaw,
        hp: st.hp,
        hpMax: st.hp,
        kind,
        speed: st.speed,
        team: null,
        destroyed: false,
        yawRate: 0,
        bodyRoll: 0,
        bodyPitch: 0,
        suspension: 0,
        suspensionVel: 0,
        engineRpm: 0,
        slip: 0,
        wheelSpin: 0,
      });
    };

    // Drivable jeeps just outside the fused airbase's north gate (which faces
    // the city / battlefield), plus a tank staged a little further out facing
    // toward the urban district. The gate sits at the north wall of the
    // compound: (BASE_POS.x, BASE_POS.z - BASE_HALF_Z).
    const gateZ = BASE_POS.z - BASE_HALF_Z;
    pushVehicle("jeep", BASE_POS.x - 14, gateZ - 26, 0);
    pushVehicle("jeep", BASE_POS.x + 14, gateZ - 26, 0);
    pushVehicle("jeep", -30, -half + 35, 0);
    pushVehicle("jeep", 30, -half + 35, 0);
    pushVehicle("tank", BASE_POS.x, gateZ - 70, Math.PI);

    // Every vehicle in the base motor pool is now drivable: convert each parked
    // vehicle into a real, enterable vehicle (and stop drawing the static prop
    // for it so we don't render two overlapping models).
    for (const pv of this.world.parkedVehicles) {
      pushVehicle(pv.kind, pv.pos.x, pv.pos.z, pv.yaw);
    }
    // The motor-pool props are now represented by live vehicles, so clear the
    // decorative list to avoid double geometry / double colliders, then rebuild
    // the static collision boxes so the now-removed parked-vehicle colliders no
    // longer block the drivable vehicles that replaced them.
    this.world.parkedVehicles.length = 0;
    this.boxes = worldToBoxes(this.world);
    this.boxGrid = new BoxGrid(this.boxes);
  }

  startMatch() {
    this.state.soldiers.length = 0;
    this.state.enemies = this.state.soldiers;

    // Apply loadout with class
    const lo = this.state.loadout;
    const classSpec = CLASSES[lo.soldierClass];
    this.state.player.hpMax = classSpec.hpMax;
    this.state.player.hp = classSpec.hpMax;
    this.state.ownedWeapons = [lo.primary, lo.secondary, "grenade", "smoke"];
    this.state.currentWeapon = lo.primary;
    this.state.weapons.grenade.reserve = lo.grenadeCount;
    this.state.weapons.smoke.reserve = lo.smokeCount;

    // Build the selectable deployment points (rear → frontline).
    this.spawnPoints = this.buildSpawnPoints();
    // Player starts at the spawn they chose in the loadout screen (clamped to a
    // valid index; defaults to the home base).
    const idx = Math.max(0, Math.min(this.spawnPoints.length - 1, lo.spawnIndex ?? 0));
    const startSpawn = this.spawnPoints[idx].pos;
    this.state.player.pos.copy(startSpawn);

    // Init sound for everyone
    soundEngine.init();

    this.state.pickups = this.world.pickupSpawns.map((sp) => ({
      id: this.state.nextPickupId++,
      pos: sp.pos.clone(),
      kind: sp.kind,
      weaponId: sp.weaponId,
      amount: sp.amount,
      taken: false,
    }));

    // Spawn soldiers with random classes
    const soldierClasses: SoldierClass[] = ["assault", "sniper", "support", "medic"];
    for (let i = 0; i < TEAM_SIZE - 1; i++) {
      this.spawnSoldier("blue", soldierClasses[i % soldierClasses.length]);
    }
    for (let i = 0; i < TEAM_SIZE; i++) {
      this.spawnSoldier("red", soldierClasses[i % soldierClasses.length]);
    }

    this.spawnCapturePoints();
    this.spawnVehicles();
    this.spawnAircraft();
  }

  // Static metadata for the selectable spawn points, ordered rear → front.
  // The UI (loadout screen) reads this so it can list the options before a
  // match (and therefore before real positions are resolved). `cx`/`cz` are the
  // nominal centers; buildSpawnPoints() resolves a collision-free position
  // nearby at match start.
  static readonly SPAWN_DEFS: {
    name: string;
    desc: string;
    cx: number;
    cz: number;
    radius: number;
    frontline: boolean;
  }[] = [
    {
      name: "本拠地",
      desc: "壁に囲まれた飛行場の奥。最も安全な後方。",
      cx: BASE_POS.x,
      cz: BASE_POS.z,
      radius: 14,
      frontline: false,
    },
    {
      name: "前哨ゲート",
      desc: "基地北門のすぐ外。戦場へ向かう中継点。",
      cx: BASE_POS.x + 20,
      cz: BASE_POS.z - BASE_HALF_Z - 40,
      radius: 25,
      frontline: false,
    },
    {
      name: "市街地外縁",
      desc: "市街地の入口。中央へ素早く展開できる。",
      cx: WORLD_SIZE * 0.14,
      cz: WORLD_SIZE * 0.18,
      radius: 30,
      frontline: true,
    },
    {
      name: "中央広場【最前線】",
      desc: "マップ中央の係争地。即座に激戦に突入する。",
      cx: 0,
      cz: 0,
      radius: 26,
      frontline: true,
    },
  ];

  private buildSpawnPoints(): SpawnPoint[] {
    return GameEngine.SPAWN_DEFS.map((d) => ({
      name: d.name,
      desc: d.desc,
      pos: this.findSpawnNear(d.cx, d.cz, d.radius),
      frontline: d.frontline,
    }));
  }

  private findSpawnNear(cx: number, cz: number, radius: number): THREE.Vector3 {
    for (let i = 0; i < 60; i++) {
      const x = cx + (Math.random() - 0.5) * radius * 2;
      const z = cz + (Math.random() - 0.5) * radius * 2;
      let inside = false;
      for (const b of this.world.buildings) {
        if (x > b.min.x - 1.5 && x < b.max.x + 1.5 && z > b.min.z - 1.5 && z < b.max.z + 1.5) {
          inside = true;
          break;
        }
      }
      // Don't spawn on top of parked motor-pool vehicles.
      if (!inside) {
        for (const pv of this.world.parkedVehicles) {
          if (Math.abs(x - pv.pos.x) < 3 && Math.abs(z - pv.pos.z) < 4) {
            inside = true;
            break;
          }
        }
      }
      if (!inside && Math.abs(x) < WORLD_SIZE / 2 - 5 && Math.abs(z) < WORLD_SIZE / 2 - 5) {
        return new THREE.Vector3(x, terrainHeightAt(this.world, x, z) + EYE_HEIGHT, z);
      }
    }
    return new THREE.Vector3(cx, terrainHeightAt(this.world, cx, cz) + EYE_HEIGHT, cz);
  }

  spawnSoldier(team: Team, soldierClass?: SoldierClass) {
    const cls = soldierClass || (["assault", "sniper", "support", "medic"] as SoldierClass[])[Math.floor(Math.random() * 4)];
    const classSpec = CLASSES[cls];

    // To create more intense, immediate fighting, the large majority of AI
    // soldiers deploy at FORWARD / FRONTLINE positions pushed toward the
    // contested map center instead of deep in their home base. Only a minority
    // spawn at the rear (reinforcements trickling in from base).
    //   - ~75% frontline: near the center (PLAZA) staggered toward each team's
    //     side, so both teams collide around the middle of the map.
    //   - ~25% rear: classic home-base spawn.
    // Snipers preferentially man the explicit high-ground sniper nests at the
    // desert-rim outposts (高低差を活かした狙撃ポジション). When a post is chosen
    // the soldier deploys directly onto the elevated nest/berm so the AI
    // actually exploits the authored elevation advantage. `manPost` (when set)
    // overrides the resolved spawn position/facing further below.
    const manPost =
      cls === "sniper" && this.world.sniperPosts.length > 0 && Math.random() < 0.55
        ? this.world.sniperPosts[Math.floor(Math.random() * this.world.sniperPosts.length)]
        : null;

    const frontline = Math.random() < 0.75;
    let baseX: number;
    let baseZ: number;
    let radius: number;
    if (manPost) {
      baseX = manPost.pos.x;
      baseZ = manPost.pos.z;
      radius = 0;
    } else if (frontline) {
      // Frontline band: close to center, offset toward this team's side so they
      // advance into each other. blue comes from +Z (south), red from -Z (north).
      const sign = team === "blue" ? 1 : -1;
      baseX = (Math.random() - 0.5) * (WORLD_SIZE * 0.5);
      baseZ = sign * (WORLD_SIZE * (0.06 + Math.random() * 0.16));
      radius = 40;
    } else {
      // Rear / home-base reinforcement spawn.
      baseZ = team === "blue" ? WORLD_SIZE / 2 - 25 : -WORLD_SIZE / 2 + 25;
      baseX = (Math.random() - 0.5) * 60;
      radius = 25;
    }
    // When manning a sniper post, deploy at the post's X/Z on the raised
    // outpost mound (its elevation is part of the terrain, so terrainHeightAt
    // gives the soldier the high-ground advantage automatically) and face the
    // post's overwatch lane. Otherwise resolve a normal collision-free spawn.
    const spawn = manPost
      ? new THREE.Vector3(manPost.pos.x, 0, manPost.pos.z)
      : this.findSpawnNear(baseX, baseZ, radius);
    const spawnY = terrainHeightAt(this.world, spawn.x, spawn.z) + SOLDIER_HEIGHT;
    const spawnYaw = manPost ? manPost.yaw : team === "blue" ? Math.PI : 0;
    const s: Soldier = {
      id: this.state.nextSoldierId++,
      team,
      pos: new THREE.Vector3(spawn.x, spawnY, spawn.z),
      vel: new THREE.Vector3(),
      hp: classSpec.hpMax,
      hpMax: classSpec.hpMax,
      alive: true,
      lastShotAt: 0,
      state: "patrol",
      patrolTarget: new THREE.Vector3(spawn.x, 0, spawn.z),
      yaw: spawnYaw,
      targetId: null,
      coverTarget: null,
      coverTimer: 0,
      soldierClass: cls,
      lastSeenPos: null,
      lastSeenAt: -999,
      reactionDelay: 0,
      alertness: 0,
      flankDir: Math.random() < 0.5 ? -1 : 1,
      nextTacticalDecisionAt: 0,
      lastGrenadeAt: -10,
      lastSmokeAt: -10,
      desiredYaw: spawnYaw,
      moveDir: new THREE.Vector3(),
      lastThreatDir: null,
      stuckTimer: 0,
      lastPosCheck: new THREE.Vector3(spawn.x, SOLDIER_HEIGHT, spawn.z),
      squadOffset: new THREE.Vector3((Math.random() - 0.5) * 7, 0, (Math.random() - 0.5) * 7),
      animPhase: Math.random() * Math.PI * 2,
      moveSpeedNorm: 0,
    };
    this.state.soldiers.push(s);
  }

  update(dt: number, time: number) {
    if (this.state.status !== "playing") return;

    this.handleInput(dt, time);
    if (this.state.playerInAircraft) {
      this.updatePlayerAircraft(dt, time);
    } else if (this.state.playerInVehicle) {
      this.updatePlayerVehicle(dt);
    } else {
      this.updatePlayer(dt);
    }
    this.updateSoldiers(dt, time);
    this.updateProjectiles(dt, time);
    this.updateSmokeClouds(dt);
    this.updateRagdolls(dt);
    this.updateEffects(dt);
    this.updatePickups();
    this.updateCapturePoints(dt, time);
    this.updateVehicles(dt);
    this.updateAircraft(dt, time);
    this.updateAircraftBombs(dt, time);
    this.updateMatch();

    // Medic heal aura
    this.updateMedicHeal(dt, time);

    this.emitTimer += dt;
    if (this.emitTimer > 0.05) {
      this.emitTimer = 0;
      store.emit();
    }
  }

  private updateMedicHeal(dt: number, _time: number) {
    // Use squared distances everywhere to avoid per-pair Math.sqrt calls.
    const HEAL_R2 = 8 * 8;
    const soldiers = this.state.soldiers;
    // Medic class heals nearby allies. Only enter the O(n²) inner loop for
    // soldiers that are actually medics (usually a small subset).
    for (const s of soldiers) {
      if (!s.alive || s.soldierClass !== "medic") continue;
      for (const ally of soldiers) {
        if (!ally.alive || ally.team !== s.team || ally.id === s.id) continue;
        if (ally.hp >= ally.hpMax) continue;
        if (s.pos.distanceToSquared(ally.pos) < HEAL_R2) {
          ally.hp = Math.min(ally.hpMax, ally.hp + 5 * dt);
        }
      }
      // Heal player if same team
      if (s.team === "blue" && this.state.player.hp < this.state.player.hpMax) {
        if (s.pos.distanceToSquared(this.state.player.pos) < HEAL_R2) {
          this.state.player.hp = Math.min(this.state.player.hpMax, this.state.player.hp + 5 * dt);
        }
      }
    }
    // Player medic heals nearby blue soldiers
    if (this.state.loadout.soldierClass === "medic") {
      for (const s of soldiers) {
        if (!s.alive || s.team !== "blue") continue;
        if (s.hp >= s.hpMax) continue;
        if (s.pos.distanceToSquared(this.state.player.pos) < HEAL_R2) {
          s.hp = Math.min(s.hpMax, s.hp + 8 * dt);
        }
      }
    }
  }

  private handleInput(dt: number, time: number) {
    const p = this.state.player;
    const w = this.state.weapons[this.state.currentWeapon];

    // Aircraft enter/exit with G (handled first so it works in every mode).
    if (this.input.keys.has("KeyG") || this.input.aircraftEnterPressed) {
      this.tryEnterExitAircraft();
      this.input.aircraftEnterPressed = false;
      this.input.keys.delete("KeyG"); // consume
    }

    // 乗り物搭乗中の視点切り替え (V): 三人称 ⇔ 一人称。航空機モードでは
    // 下の return より前で処理する必要があるためここで処理する。
    if (this.input.viewTogglePressed) {
      this.input.viewTogglePressed = false;
      this.input.keys.delete("KeyV");
      if (this.playerIsMounted()) {
        this.state.vehicleViewMode = this.state.vehicleViewMode === "third" ? "first" : "third";
        store.emit();
      }
    }

    // While piloting an aircraft, the flight controller (updatePlayerAircraft)
    // owns the mouse delta + weapon firing, so skip the on-foot FPS handling.
    if (this.state.playerInAircraft) return;

    // While driving a ground vehicle, the camera tracks the vehicle heading
    // (updatePlayerVehicle owns p.yaw/p.pitch). The mouse instead drives a small
    // free-look OFFSET so the player can glance around the cab without losing
    // the forward view. Consume the delta here so the on-foot look below does
    // not also move the camera.
    if (this.state.playerInVehicle) {
      const md = this.input.consumeMouseDelta();
      const sens = 0.0022;
      this.vehicleLookYaw = THREE.MathUtils.clamp(
        this.vehicleLookYaw - md.dx * sens, -1.4, 1.4);
      this.vehicleLookPitch = THREE.MathUtils.clamp(
        this.vehicleLookPitch - md.dy * sens, -0.6, 0.6);
      // Recenter the glance back toward straight-ahead when the mouse is idle.
      const recenter = Math.min(1, 2.5 * dt);
      this.vehicleLookYaw *= 1 - recenter;
      this.vehicleLookPitch *= 1 - recenter;
      return;
    }

    const wantAim = this.input.mouse.right && this.state.currentWeapon !== "grenade" && this.state.currentWeapon !== "smoke";
    this.state.aiming = wantAim;
    const targetT = wantAim ? 1 : 0;
    this.state.aimT += (targetT - this.state.aimT) * Math.min(1, 8 * dt);

    const md = this.input.consumeMouseDelta();
    const baseSens = 0.0022;
    const sens = baseSens * (1 - this.state.aimT * 0.55);
    p.yaw -= md.dx * sens;
    p.pitch -= md.dy * sens;
    p.pitch = Math.max(-Math.PI / 2 + 0.05, Math.min(Math.PI / 2 - 0.05, p.pitch));

    if (this.input.keys.has("Digit1")) this.switchWeapon("rifle");
    if (this.input.keys.has("Digit2")) this.switchWeapon("pistol");
    if (this.input.keys.has("Digit3")) this.switchWeapon("grenade");
    if (this.input.keys.has("Digit4")) this.switchWeapon("smg");
    if (this.input.keys.has("Digit5")) this.switchWeapon("sniper");
    if (this.input.keys.has("Digit6")) this.switchWeapon("smoke");
    if (this.input.weaponSwitchPressed) {
      const ids: WeaponId[] = ["rifle", "pistol", "grenade", "smg", "sniper", "smoke"];
      const id = ids[this.input.weaponSwitchPressed - 1];
      if (id) this.switchWeapon(id);
      this.input.weaponSwitchPressed = null;
    }
    if (this.input.keys.has("KeyR") || this.input.reloadPressed) {
      this.tryReload(time);
      this.input.reloadPressed = false;
    }
    if (this.input.keys.has("KeyE") || this.input.pickupPressed) {
      this.tryPickup();
      this.input.pickupPressed = false;
    }
    // Vehicle enter/exit with F
    if (this.input.keys.has("KeyF") || this.input.enterVehiclePressed) {
      this.tryEnterExitVehicle();
      this.input.enterVehiclePressed = false;
      this.input.keys.delete("KeyF"); // consume
    }
    // Toggle the full-screen tactical map with M
    if (this.input.mapTogglePressed) {
      this.state.mapOpen = !this.state.mapOpen;
      this.input.mapTogglePressed = false;
      this.input.keys.delete("KeyM");
      store.emit();
    }
    if (this.input.keys.has("Space") || this.input.jumpPressed) {
      if (p.onGround && !this.state.playerInVehicle) {
        p.vel.y = JUMP_VEL;
        p.onGround = false;
      }
      this.input.jumpPressed = false;
    }

    const wantFire = this.input.mouse.left;
    if (wantFire && !this.state.playerInVehicle) {
      if (w.spec.auto || !this.shootHeld) this.tryFire(time);
      this.shootHeld = true;
    } else {
      this.shootHeld = false;
    }
  }

  private tryEnterExitVehicle() {
    if (this.state.playerInVehicle) {
      // Exit
      const v = this.state.vehicles.find(v => v.id === this.state.playerInVehicle);
      if (v) {
        v.team = null;
        const ex = v.pos.x + 3;
        const ez = v.pos.z;
        this.state.player.pos.set(ex, terrainHeightAt(this.world, ex, ez) + EYE_HEIGHT, ez);
      }
      this.state.playerInVehicle = null;
      soundEngine.playVehicleEnter();
      return;
    }
    // Find nearby vehicle
    const nearId = this.state.nearbyVehicleId;
    if (!nearId) return;
    const v = this.state.vehicles.find(v => v.id === nearId);
    if (!v || v.destroyed) return;
    this.state.playerInVehicle = v.id;
    v.team = "blue";
    this.state.vehicleViewMode = "third"; // 搭乗時は三人称から開始
    // 搭乗時はフリールックのオフセットを中央へリセットし、まず正面を向かせる。
    this.vehicleLookYaw = 0;
    this.vehicleLookPitch = 0;
    soundEngine.playVehicleEnter();
  }

  // True while the player is riding any vehicle (ground or air). Used to make
  // the player immune to small-arms / explosion damage that would otherwise be
  // applied to player.pos (which tracks the vehicle while mounted).
  private playerIsMounted(): boolean {
    return this.state.playerInAircraft !== null || this.state.playerInVehicle !== null;
  }

  // === AIRCRAFT: PLAYER PILOTING ==========================================

  // Enter the nearest grounded/alive aircraft, or bail out of the current one.
  private tryEnterExitAircraft() {
    if (this.state.playerInAircraft !== null) {
      // 脱出: パラシュート降下（単純に現在高度でプレイヤーを解放）
      const ac = this.state.aircraft.find(a => a.id === this.state.playerInAircraft);
      if (ac) {
        this.state.player.pos.copy(ac.pos);
        this.state.player.vel.set(ac.vel.x * 0.1, 0, ac.vel.z * 0.1);
        this.state.player.onGround = false;
      }
      this.state.playerInAircraft = null;
      return;
    }
    // 搭乗試行: onGround==true かつ alive の機体を近い順に探す
    let closest: Aircraft | null = null;
    let closestDist = AIRCRAFT_ENTER_RANGE;
    for (const ac of this.state.aircraft) {
      if (!ac.alive || !ac.onGround) continue;
      const dx = ac.pos.x - this.state.player.pos.x;
      const dz = ac.pos.z - this.state.player.pos.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist < closestDist) { closestDist = dist; closest = ac; }
    }
    if (closest) {
      // 搭乗時に飛行状態をリセットする。AI が操縦/滑走していた機体は速度や
      // スロットルが残っており、プレイヤーが乗った瞬間に「速度が一瞬で
      // 跳ね上がる」バグの原因になっていた。地上待機状態から開始させる。
      closest.vel.set(0, 0, 0);
      closest.throttle = 0;
      closest.pitch = 0;
      closest.roll = 0;
      closest.onGround = true;
      closest.airbrake = false;
      closest.gearDown = true; // 地上待機なので脚は出した状態
      // 徒歩中に押された F が残っていると搭乗直後に脚が引っ込むため消費する。
      this.input.gearTogglePressed = false;
      closest.aiState = "taxiing";
      closest.aiTargetSoldierId = null;
      closest.aiTargetPos = null;
      this.state.playerInAircraft = closest.id;
      this.state.playerInVehicle  = null; // 地上車両は降りる
      this.state.vehicleViewMode  = "third"; // 搭乗時は三人称から開始
      soundEngine.playVehicleEnter();     // 搭乗音 (既存流用)
    }
  }

  // Flight controller for the player-piloted aircraft. Reads mouse/WASD,
  // integrates the flight model, handles weapons, landing & crashes, and
  // parks the FPS camera (player.pos) behind the plane for a chase view.
  private updatePlayerAircraft(dt: number, time: number) {
    const ac = this.state.aircraft.find(a => a.id === this.state.playerInAircraft);
    if (!ac || !ac.alive) {
      this.state.playerInAircraft = null;
      return;
    }
    const p = this.state.player;

    // ── 操縦入力 (慣性付きで平滑化) ─────────────────────
    // マウス: ピッチ & ロール指令。WASD: スロットル & ロール補助。
    const md = this.input.consumeMouseDelta();
    const sens = 0.0016;
    // デッドゾーン: わずかな手ブレ/微振動では舵を切らない (やさしい操縦)。
    const dyEff = Math.abs(md.dy) < 0.6 ? 0 : md.dy;
    const dxEff = Math.abs(md.dx) < 0.6 ? 0 : md.dx;
    // 入力ゲインを控えめ(90→55)にして、急な視点移動でも機体が暴れにくくする。
    const pitchCmd = THREE.MathUtils.clamp(ac.pitchInput - dyEff * sens * 55, -1, 1);
    let rollCmd = THREE.MathUtils.clamp(ac.rollInput + dxEff * sens * 55, -1, 1);

    if (this.input.keys.has("KeyW"))
      ac.throttle = Math.min(1, ac.throttle + 0.8 * dt);
    if (this.input.keys.has("KeyS"))
      ac.throttle = Math.max(0, ac.throttle - 0.8 * dt);
    if (this.input.keys.has("KeyA")) rollCmd = -1;
    if (this.input.keys.has("KeyD")) rollCmd = 1;

    // ── エアブレーキ (Shift/B 押下中、またはモバイルの AIR BRAKE ホールド) ──
    ac.airbrake = !!this.input.aircraftAirbrake;
    // ── ランディングギア(脚)の出し入れ (F / モバイルの GEAR ボタン) ──
    if (this.input.gearTogglePressed) {
      ac.gearDown = !ac.gearDown;
      this.input.gearTogglePressed = false;
    }

    // 操縦桿を慣性で追従 (操縦の重さ)。
    ac.pitchInput += (pitchCmd - ac.pitchInput) * Math.min(1, AIRCRAFT_CTRL_EASE * dt);
    ac.rollInput  += (rollCmd  - ac.rollInput ) * Math.min(1, AIRCRAFT_CTRL_EASE * dt);
    if (!this.input.keys.has("KeyA") && !this.input.keys.has("KeyD") && Math.abs(dxEff) < 0.5)
      ac.rollInput *= Math.pow(0.25, dt); // 手を離すと素早くロール入力が抜ける
    // ── ピッチ入力のセンタリング (操縦バグ修正) ──────────────────────
    // 以前は pitchInput が中立へ戻らず、マウスを一度動かすと機首が回り続けて
    // 「ピッチが止まらない / 機体が暴れる」原因になっていた。ロール軸と同様に、
    // マウスのピッチ入力が無いフレームでは pitchInput を素早く 0 へ減衰させ、
    // 手を離せばピッチ操作が抜けるようにする (静安定)。
    if (Math.abs(dyEff) < 0.5) ac.pitchInput *= Math.pow(0.2, dt);

    // ── ロール入力 → バンク角 ────────────────────────
    // バンク上限を大きく抑え(約45°)、入力を離すと自動で水平へ戻る(オート
    // レベリング)ことで、過度な旋回を防ぎ初心者でも姿勢を保ちやすくする。
    const maxBank = Math.PI * 0.25; // ≒45°
    // ロール速度も控えめにして、急なバンク変化(過度な旋回)を抑制する。
    ac.roll = THREE.MathUtils.clamp(ac.roll + ac.rollInput * 1.3 * dt, -maxBank, maxBank);
    if (Math.abs(ac.rollInput) < 0.1) ac.roll *= Math.pow(0.18, dt); // 静安定で素早く水平へ

    const maxSpd = ac.kind === "fighter" ? AIRCRAFT_MAX_SPEED : AIRCRAFT_ATK_MAX_SPEED;
    // 水平飛行時の最高速 (≒400km/h)。地上滑走・水平飛行はこの値で頭打ちにし、
    // 急降下時のみ重力で maxSpd まで超過を許す。
    const levelMaxSpd = ac.kind === "fighter" ? AIRCRAFT_LEVEL_MAX_SPEED : AIRCRAFT_ATK_LEVEL_MAX_SPEED;
    const thrustMax = ac.kind === "fighter" ? AIRCRAFT_THRUST_FIGHTER : AIRCRAFT_THRUST_ATTACKER;

    if (ac.onGround) {
      // ── 地上滑走: 機首水平、スラストで加速し揚力速度で離陸 ──
      const groundFwd = new THREE.Vector3(-Math.sin(ac.yaw), 0, -Math.cos(ac.yaw));
      let gSpd = ac.vel.length();
      gSpd += ac.throttle * thrustMax * dt;
      // エアブレーキ展開中は地上でも強く減速する (着陸後の停止に有効)。
      const groundDrag = ac.airbrake ? AIRCRAFT_DRAG_COEF * AIRCRAFT_AIRBRAKE_DRAG : AIRCRAFT_DRAG_COEF;
      gSpd *= 1 - groundDrag * gSpd * dt; // drag
      if (ac.airbrake) gSpd = Math.max(0, gSpd - 18 * dt); // エアブレーキで強制制動
      gSpd = Math.min(gSpd, levelMaxSpd); // 地上滑走も水平最高速で頭打ち
      ac.pitch = 0;
      ac.roll = 0;
      ac.gearDown = true; // 地上滑走中は脚を出している
      ac.vel.copy(groundFwd).multiplyScalar(gSpd);
      ac.pos.addScaledVector(ac.vel, dt);
      ac.pos.y = 0.8;
      // 離陸 (ローテーション): 操縦桿を引けば揚力速度で、引かなくても十分速度が
      // 乗れば自然に浮く。これにより W だけでも離陸できる。エアブレーキ展開中は
      // 離陸しない (誤離陸防止)。
      const rotateSpeed = ac.pitchInput > 0.15 ? AIRCRAFT_LIFT_SPEED : AIRCRAFT_LIFT_SPEED * 1.15;
      if (gSpd > rotateSpeed && !ac.airbrake) {
        ac.onGround = false;
        ac.pitch = Math.max(0.12, ac.pitch);
        ac.vel.y = 4;
        ac.gearDown = false; // 離陸したら自動で脚を格納
      }
      const lim0 = WORLD_SIZE / 2 - 20;
      ac.pos.x = Math.max(-lim0, Math.min(lim0, ac.pos.x));
      ac.pos.z = Math.max(-lim0, Math.min(lim0, ac.pos.z));
      ac.stalling = false;
      ac.gForce = 1;
    } else {
      // ════════════════════════════════════════════════════════════════
      //  力ベースの飛行モデル: 推力・抗力・揚力・重力を速度へ積分する
      // ════════════════════════════════════════════════════════════════
      const speed = ac.vel.length();
      const cy = Math.cos(ac.pitch);
      const fwd = new THREE.Vector3(
        -Math.sin(ac.yaw) * cy,
        Math.sin(ac.pitch),
        -Math.cos(ac.yaw) * cy,
      );

      // 迎角(AoA): 操縦桿引きで増える。揚力と失速を支配する。
      const aoaCmd = ac.pitchInput * 0.35;
      ac.aoa += (aoaCmd - ac.aoa) * Math.min(1, 6 * dt);

      // ── ピッチ操作: 動圧(速度)が高いほど舵が効く ──
      const q = Math.min(1.3, speed / AIRCRAFT_LIFT_SPEED);
      ac.pitch += ac.pitchInput * 1.7 * q * dt;
      // ── ピッチのオートレベリング (静安定) ──────────────────────────
      // 操縦桿(マウス)が中立のときは機首を水平へじわっと戻す。これにより
      // 手を離せば自然に水平飛行へ復帰し、機体が際限なく上下に振れる挙動を防ぐ。
      // 入力中は戻し量をほぼ無効化して操縦性は損なわない。
      if (Math.abs(ac.pitchInput) < 0.12 && !ac.stalling) {
        ac.pitch -= ac.pitch * Math.min(1, 1.2 * dt);
      }
      ac.pitch = THREE.MathUtils.clamp(ac.pitch, -Math.PI * 0.49, Math.PI * 0.49);

      // ── バンク → 協調旋回: yawRate = g·tan(bank)/v ──
      // 高速ほど旋回率が下がる本来の式に加え、低速域では機首方向が変えられず
      // 「浮いたまま向きが変わらない」状態になりがち。これを防ぐため、低速時は
      // 一定の最小ヨー速度を保証し、バンクを切ればどんな速度でも回頭できるようにする。
      if (speed > 1) {
        const coordTurn = (9.8 * Math.tan(ac.roll)) / Math.max(speed, 25);
        // バンク方向に応じた直接的な最小旋回率 (ラダー的補助)。
        // 低速ほど効きを強くして、ホバリング気味でも向きを変えられるようにする。
        const lowSpeedAssist = THREE.MathUtils.clamp((60 - speed) / 60, 0, 1);
        const directYaw = Math.sin(ac.roll) * (0.5 + lowSpeedAssist * 1.0);
        ac.yaw -= (coordTurn + directYaw) * dt;
      }

      // ── 失速判定 ──
      const effAoa = Math.abs(ac.aoa) + Math.max(0, (AIRCRAFT_STALL_SPEED - speed) / AIRCRAFT_STALL_SPEED) * 0.4;
      ac.stalling = effAoa > AIRCRAFT_STALL_AOA || speed < AIRCRAFT_STALL_SPEED * 0.6;

      // ── 揚力 L = Cl·v²·(1+AoA)、バンクで鉛直成分が減る ──
      let liftMag = AIRCRAFT_LIFT_COEF * speed * speed * (1 + ac.aoa * 2.5);
      if (ac.stalling) liftMag *= 0.35;
      const liftVert = liftMag * Math.cos(ac.roll);

      // 旋回G (誘導抗力 & HUD表示用)。
      ac.gForce = 1 / Math.max(0.2, Math.cos(ac.roll));

      // ── 抗力: 寄生抗力 + 誘導抗力 + エアブレーキ + 脚 ──
      // エアブレーキ展開で寄生抗力が増し、機体が素早く減速する。ランディング
      // ギアを出すと追加の抗力が生じ、降下・進入速度を落としやすくなる。
      const brakeMul = ac.airbrake ? AIRCRAFT_AIRBRAKE_DRAG : 1;
      const parasiticDrag = AIRCRAFT_DRAG_COEF * brakeMul * speed * speed;
      const gearDrag = ac.gearDown ? AIRCRAFT_GEAR_DRAG_COEF * speed * speed : 0;
      const inducedDrag = AIRCRAFT_INDUCED_DRAG * Math.abs(ac.aoa) * Math.max(0, ac.gForce - 1) * 4;
      const dragMag = parasiticDrag + gearDrag + inducedDrag;

      // ── 力を積分 ──
      ac.vel.addScaledVector(fwd, ac.throttle * thrustMax * dt);     // 推力
      if (speed > 0.01) ac.vel.addScaledVector(ac.vel, -dragMag * dt / speed); // 抗力
      ac.vel.y += (liftVert - AIRCRAFT_GRAVITY) * dt;                 // 揚力 - 重力
      if (ac.stalling) {                                              // 失速 → 機首落ち
        ac.pitch -= dt * 0.6;
        ac.vel.y -= AIRCRAFT_GRAVITY * 0.4 * dt;
      }

      // ── 速度制限 (水平最高速 ≒400km/h) ───────────────────────
      // 水平〜上昇飛行では levelMaxSpd で頭打ち。降下時は重力で加速できるよう
      // 降下角に応じて levelMaxSpd → maxSpd まで上限を滑らかに引き上げる。
      {
        const curSpeed = ac.vel.length();
        if (curSpeed > 0.01) {
          // 降下成分の割合 (0=水平/上昇, 1=ほぼ真下)。
          const descentFrac = THREE.MathUtils.clamp(-ac.vel.y / curSpeed, 0, 1);
          const speedCap = levelMaxSpd + (maxSpd - levelMaxSpd) * descentFrac;
          if (curSpeed > speedCap) {
            ac.vel.multiplyScalar(speedCap / curSpeed);
          }
        }
      }

      // ── 位置更新 ──
      ac.pos.addScaledVector(ac.vel, dt);
      ac.pos.y = Math.min(ac.pos.y, 800);
      const lim = WORLD_SIZE / 2 - 20;
      ac.pos.x = Math.max(-lim, Math.min(lim, ac.pos.x));
      ac.pos.z = Math.max(-lim, Math.min(lim, ac.pos.z));

      // ── 着陸 / 墜落判定 ──
      if (ac.pos.y < 0.8) {
        ac.pos.y = 0.8;
        const horizSpeed = Math.hypot(ac.vel.x, ac.vel.z);
        const sinkRate = -ac.vel.y;
        // 低速・低降下率・水平姿勢なら着陸成功、さもなくば墜落。
        // ランディングギアを出していると着陸判定が大幅に緩くなる (やさしい着陸)。
        const okSpeed = ac.gearDown ? 110 : 75;
        const okSink  = ac.gearDown ? 20  : 12;
        const okPitch = ac.gearDown ? 0.40 : 0.25;
        const okRoll  = ac.gearDown ? 0.45 : 0.3;
        if (horizSpeed < okSpeed && sinkRate < okSink && Math.abs(ac.pitch) < okPitch && Math.abs(ac.roll) < okRoll) {
          ac.onGround = true;
          ac.vel.set(0, 0, 0);
          ac.pitch = 0;
          ac.roll = 0;
          ac.throttle = Math.min(ac.throttle, 0.2);
          ac.aoa = 0;
          ac.stalling = false;
        } else {
          ac.alive = false;
          ac.onGround = false;
          this.state.playerInAircraft = null;
          this.state.explosions.push({ pos: ac.pos.clone(), age: 0, ttl: 0.9 });
          this.state.shake = 0.8;
          soundEngine.playExplosion();
        }
      }
    }

    // カメラ・武装用の最終的な前方ベクトル。
    const cyF = Math.cos(ac.pitch);
    const fwd = new THREE.Vector3(
      -Math.sin(ac.yaw) * cyF,
      Math.sin(ac.pitch),
      -Math.cos(ac.yaw) * cyF,
    );

    // ── 武装 ─────────────────────────────────────────
    // 機関銃: 左クリック
    if (this.input.mouse.left) {
      this.playerAircraftGunFire(ac, time);
    }
    // 爆弾: スペース (attacker のみ)
    if (ac.kind === "attacker" && this.input.keys.has("Space")) {
      this.dropBomb(ac);   // 第1回実装済み
      soundEngine.playBombDrop();
      this.input.keys.delete("Space");
    }

    // ── カメラ追従 ───────────────────────────────────
    // 三人称: 機体後方上方からのチェイスカメラ。一人称: コクピット位置。
    if (this.state.vehicleViewMode === "first") {
      // 機首やや後方のコクピットに視点を置く。
      const cockpit = fwd.clone().multiplyScalar(1.5);
      p.pos.set(ac.pos.x + cockpit.x, ac.pos.y + 1.2, ac.pos.z + cockpit.z);
    } else {
      const back = fwd.clone().multiplyScalar(-14);
      p.pos.set(ac.pos.x + back.x, ac.pos.y + 4, ac.pos.z + back.z);
    }
    p.yaw   = ac.yaw;
    p.pitch = ac.pitch;
    p.vel.set(0, 0, 0);
    p.onGround = false;
  }

  // Player nose machine gun: ray from the nose, hits enemy soldiers, draws a
  // tracer trail, applies damage / kills / score, plays a shot sound.
  private playerAircraftGunFire(ac: Aircraft, time: number) {
    const interval = 60 / 1200; // 1200 RPM
    if (time - ac.lastGunAt < interval) return;
    if (ac.gunAmmo <= 0) return;
    ac.lastGunAt = time;
    ac.gunAmmo  -= 1;

    // 機首方向へのレイ
    const cy = Math.cos(ac.pitch);
    const fwd = new THREE.Vector3(
      -Math.sin(ac.yaw) * cy,
      Math.sin(ac.pitch),
      -Math.cos(ac.yaw) * cy,
    );
    const gunEnd = ac.pos.clone().addScaledVector(fwd, 600);

    // トレイル
    this.state.aircraftGunTrails.push({
      from: ac.pos.clone(),
      to:   gunEnd,
      ttl:  0.06,
    });

    // ヒット判定: 全 Soldier をレイとの最近接距離で判定
    for (const s of this.state.soldiers) {
      if (!s.alive) continue;
      // team blue の機関銃は red だけを狙う
      if (ac.team === "blue" && s.team !== "red") continue;
      const toS = s.pos.clone().sub(ac.pos);
      const t   = Math.max(0, Math.min(1, toS.dot(fwd) / 600));
      const closest = ac.pos.clone().addScaledVector(fwd, t * 600);
      if (closest.distanceTo(s.pos) < 1.2) {
        const dmg = 18 * (0.7 + Math.random() * 0.6);
        s.hp -= dmg;
        this.state.damageNumbers.push({
          id:     this.state.nextDmgId++,
          pos:    s.pos.clone().add(new THREE.Vector3(0, 2, 0)),
          amount: Math.round(dmg),
          ttl:    0.9,
          isCrit: false,
        });
        this.state.hitMarker = 0.15;
        if (s.hp <= 0 && s.alive) {
          s.alive = false;
          if (ac.team === "blue" && s.team === "red") {
            this.state.kills  += 1;
            this.state.score  += 80;
            this.state.blueScore += 1;
          }
          this.spawnRagdoll(s);
        }
      }
    }

    soundEngine.playShot(); // 既存流用
  }

  switchWeapon(id: WeaponId) {
    if (!this.state.ownedWeapons.includes(id)) return;
    if (this.state.currentWeapon === id) return;
    this.state.currentWeapon = id;
    const w = this.state.weapons[id];
    w.reloading = false;
  }

  tryReload(time: number) {
    const w = this.state.weapons[this.state.currentWeapon];
    if (w.reloading) return;
    if (w.mag >= w.spec.magSize) return;
    if (w.reserve <= 0) return;
    w.reloading = true;
    w.reloadEndsAt = time + w.spec.reloadTime;
    soundEngine.playReload();
  }

  tryFire(time: number) {
    const w = this.state.weapons[this.state.currentWeapon];
    if (w.reloading) {
      if (time >= w.reloadEndsAt) {
        const need = w.spec.magSize - w.mag;
        const take = Math.min(need, w.reserve);
        w.mag += take;
        w.reserve -= take;
        w.reloading = false;
      } else return;
    }
    const interval = 1 / w.spec.fireRate;
    if (time - w.lastShotAt < interval) return;
    if (w.mag <= 0) {
      this.tryReload(time);
      return;
    }
    w.mag -= 1;
    w.lastShotAt = time;
    const aim = this.state.aimT;
    if (w.spec.id === "grenade") {
      this.throwGrenade("blue");
    } else if (w.spec.id === "smoke") {
      this.throwSmoke("blue");
    } else {
      const spread = w.spec.spread * (1 - aim * 0.85);
      this.hitscan(w.spec.damage, spread, w.spec.muzzleColor, w.spec.headshotMultiplier);
      soundEngine.playShot(w.spec.id);
    }
    this.state.player.pitch = Math.min(
      Math.PI / 2 - 0.05,
      this.state.player.pitch + w.spec.recoil * (1 - aim * 0.6),
    );
    this.state.shake = Math.min(0.4, this.state.shake + 0.08 * (1 - aim * 0.5));
  }

  private tryPickup() {
    const id = this.state.nearbyPickupId;
    if (!id) return;
    const pk = this.state.pickups.find((p) => p.id === id);
    if (!pk || pk.taken) return;
    if (pk.kind === "weapon" && pk.weaponId) {
      if (!this.state.ownedWeapons.includes(pk.weaponId)) {
        this.state.ownedWeapons.push(pk.weaponId);
        this.state.weapons[pk.weaponId] = makeWeaponState(pk.weaponId);
        this.state.weapons[pk.weaponId].mag = WEAPONS[pk.weaponId].magSize;
        this.state.weapons[pk.weaponId].reserve = WEAPONS[pk.weaponId].reserveMax;
      } else {
        const ws = this.state.weapons[pk.weaponId];
        ws.reserve = Math.min(ws.spec.reserveMax, ws.reserve + ws.spec.magSize * 2);
      }
      this.switchWeapon(pk.weaponId);
    } else if (pk.kind === "ammo") {
      const cur = this.state.weapons[this.state.currentWeapon];
      if (cur.spec.id !== "grenade" && cur.spec.id !== "smoke") {
        cur.reserve = Math.min(cur.spec.reserveMax, cur.reserve + (pk.amount || 60));
      }
    } else if (pk.kind === "health") {
      this.state.player.hp = Math.min(this.state.player.hpMax, this.state.player.hp + (pk.amount || 50));
    } else if (pk.kind === "grenade") {
      const g = this.state.weapons.grenade;
      g.reserve = Math.min(g.spec.reserveMax, g.reserve + (pk.amount || 2));
    }
    pk.taken = true;
  }

  private updatePickups() {
    let nearest: Pickup | null = null;
    let minD = PICKUP_RANGE;
    const pp = this.state.player.pos;
    for (const pk of this.state.pickups) {
      if (pk.taken) continue;
      const d = Math.hypot(pk.pos.x - pp.x, pk.pos.z - pp.z);
      if (d < minD) {
        minD = d;
        nearest = pk;
      }
    }
    this.state.nearbyPickupId = nearest ? nearest.id : null;

    // Nearby vehicle. The enter range is widened by the vehicle's footprint so
    // big hulls (tanks/trucks/APCs) can be boarded by standing next to them,
    // not just dead-centre on them.
    let nearVehicle: Vehicle | null = null;
    let bestScore = Infinity;
    for (const v of this.state.vehicles) {
      if (v.destroyed) continue;
      const reach = v.kind === "tank" ? 4.5
        : v.kind === "truck" ? 4.5
        : v.kind === "apc" ? 4.2
        : v.kind === "humvee" ? 3.8
        : VEHICLE_ENTER_RANGE;
      const d = Math.hypot(v.pos.x - pp.x, v.pos.z - pp.z);
      // Compare distance relative to each vehicle's reach so the closest
      // *boardable* vehicle wins regardless of size.
      const score = d - reach;
      if (d < reach && score < bestScore) {
        bestScore = score;
        nearVehicle = v;
      }
    }
    this.state.nearbyVehicleId = nearVehicle ? nearVehicle.id : null;
  }

  private getViewVec() {
    const p = this.state.player;
    const cp = Math.cos(p.pitch);
    return new THREE.Vector3(
      Math.sin(p.yaw) * cp * -1,
      Math.sin(p.pitch),
      Math.cos(p.yaw) * cp * -1,
    ).normalize();
  }
  private getEyePos() {
    const p = this.state.player;
    return new THREE.Vector3(p.pos.x, p.pos.y, p.pos.z);
  }

  private isInSmoke(pos: THREE.Vector3): boolean {
    for (const sc of this.state.smokeClouds) {
      const d = Math.hypot(pos.x - sc.pos.x, pos.z - sc.pos.z);
      if (d < sc.radius) return true;
    }
    return false;
  }

  private linePassesThroughSmoke(from: THREE.Vector3, to: THREE.Vector3): boolean {
    for (const sc of this.state.smokeClouds) {
      _tmpV1.subVectors(to, from);
      const len = _tmpV1.length();
      _tmpV1.normalize();
      _tmpV2.subVectors(sc.pos, from);
      const t = _tmpV2.dot(_tmpV1);
      if (t < 0 || t > len) continue;
      _tmpV3.copy(from).addScaledVector(_tmpV1, t);
      const dist = Math.hypot(_tmpV3.x - sc.pos.x, _tmpV3.z - sc.pos.z);
      if (dist < sc.radius * 0.8) return true;
    }
    return false;
  }

  private hitscan(damage: number, spread: number, muzzleColor: string, headshotMult: number) {
    const origin = this.getEyePos();
    const dir = this.getViewVec();
    const sx = (Math.random() - 0.5) * spread * 2;
    const sy = (Math.random() - 0.5) * spread * 2;
    _tmpV1.crossVectors(dir, _tmpV2.set(0, 1, 0)).normalize();
    _tmpV3.crossVectors(_tmpV1, dir).normalize();
    dir.addScaledVector(_tmpV1, sx).addScaledVector(_tmpV3, sy).normalize();

    let bestT = Infinity;
    let bestNormal = new THREE.Vector3(0, 1, 0);
    for (const box of this.boxes) {
      const t = rayBox(origin, dir, box);
      if (t !== null && t < bestT) {
        bestT = t;
        const hp = origin.clone().addScaledVector(dir, t);
        const cx = (box.min.x + box.max.x) / 2;
        const cy = (box.min.y + box.max.y) / 2;
        const cz = (box.min.z + box.max.z) / 2;
        const dx = (hp.x - cx) / ((box.max.x - box.min.x) / 2);
        const dy = (hp.y - cy) / ((box.max.y - box.min.y) / 2);
        const dz = (hp.z - cz) / ((box.max.z - box.min.z) / 2);
        const ax = Math.abs(dx), ay = Math.abs(dy), az = Math.abs(dz);
        if (ax > ay && ax > az) bestNormal = new THREE.Vector3(Math.sign(dx), 0, 0);
        else if (ay > az) bestNormal = new THREE.Vector3(0, Math.sign(dy), 0);
        else bestNormal = new THREE.Vector3(0, 0, Math.sign(dz));
      }
    }

    // Check destructible objects
    let hitDestructible: DestructibleObject | undefined;
    for (const d of this.state.destructibles) {
      if (d.destroyed) continue;
      const half = d.size.clone().multiplyScalar(0.5);
      const box: Box = {
        min: new THREE.Vector3(d.pos.x - half.x, d.pos.y - half.y, d.pos.z - half.z),
        max: new THREE.Vector3(d.pos.x + half.x, d.pos.y + half.y, d.pos.z + half.z),
      };
      const t = rayBox(origin, dir, box);
      if (t !== null && t < bestT) {
        bestT = t;
        hitDestructible = d;
        bestNormal = new THREE.Vector3(-dir.x, 0, -dir.z).normalize();
      }
    }

    // Check vehicles
    for (const v of this.state.vehicles) {
      if (v.destroyed) continue;
      const half = v.kind === "tank" ? new THREE.Vector3(1.6, 1.2, 2.6)
        : v.kind === "apc" ? new THREE.Vector3(1.5, 1.4, 2.8)
        : v.kind === "truck" ? new THREE.Vector3(1.4, 1.6, 3.4)
        : v.kind === "humvee" ? new THREE.Vector3(1.3, 1.1, 2.3)
        : new THREE.Vector3(1.2, 0.8, 2.0);
      const box: Box = {
        min: new THREE.Vector3(v.pos.x - half.x, v.pos.y - half.y, v.pos.z - half.z),
        max: new THREE.Vector3(v.pos.x + half.x, v.pos.y + half.y, v.pos.z + half.z),
      };
      const t = rayBox(origin, dir, box);
      if (t !== null && t < bestT) {
        bestT = t;
        hitDestructible = undefined; // not a destructible
        bestNormal = new THREE.Vector3(-dir.x, 0, -dir.z).normalize();
        // Damage vehicle
        v.hp -= damage;
        if (v.hp <= 0 && !v.destroyed) {
          v.destroyed = true;
          this.state.explosions.push({ pos: v.pos.clone(), age: 0, ttl: 1.0 });
          soundEngine.playExplosion();
        }
      }
    }

    let hitSoldierId: number | undefined;
    let hitSoldier: Soldier | undefined;
    let isHead = false;
    for (const s of this.state.soldiers) {
      if (!s.alive) continue;
      if (s.team === "blue") continue;
      const ox = origin.x - s.pos.x;
      const oz = origin.z - s.pos.z;
      const dxz2 = dir.x * dir.x + dir.z * dir.z;
      if (dxz2 < 1e-6) continue;
      const b = ox * dir.x + oz * dir.z;
      const c = ox * ox + oz * oz - SOLDIER_RADIUS * SOLDIER_RADIUS;
      const disc = b * b - dxz2 * c;
      if (disc < 0) continue;
      const sq = Math.sqrt(disc);
      const t = (-b - sq) / dxz2;
      if (t < 0 || t >= bestT) continue;
      const y = origin.y + dir.y * t;
      const yMin = s.pos.y - SOLDIER_HEIGHT;
      const yMax = s.pos.y;
      if (y < yMin || y > yMax) continue;
      bestT = t;
      hitSoldierId = s.id;
      hitSoldier = s;
      hitDestructible = undefined;
      isHead = y > s.pos.y - (SOLDIER_HEIGHT - SOLDIER_HEAD_HEIGHT) - 0.15;
      bestNormal = new THREE.Vector3(-dir.x, 0, -dir.z).normalize();
    }

    if (bestT === Infinity) bestT = 80;
    const hp = origin.clone().addScaledVector(dir, bestT);

    // Add bullet trail
    this.state.trails.push({
      from: origin.clone().addScaledVector(dir, 0.6),
      to: hp.clone(),
      ttl: 0.15,
      color: muzzleColor,
    });

    this.state.hits.push({
      point: hp,
      normal: bestNormal,
      enemyId: hitSoldierId,
      ttl: hitSoldierId ? 0.3 : 4,
      isHeadshot: isHead,
    });
    const muz = origin.clone().addScaledVector(dir, 0.6).add(new THREE.Vector3(0, -0.15, 0));
    this.state.flashes.push({ pos: muz, ttl: 0.06, color: muzzleColor });

    // Damage destructible
    if (hitDestructible && !hitSoldier) {
      hitDestructible.hp -= damage;
      if (hitDestructible.hp <= 0) {
        hitDestructible.destroyed = true;
        this.spawnDebris(hitDestructible);
        if (hitDestructible.kind === "barrel") {
          this.state.explosions.push({ pos: hitDestructible.pos.clone(), age: 0, ttl: 0.7 });
          this.state.shake = Math.min(0.5, this.state.shake + 0.2);
          soundEngine.playExplosion();
          for (const s of this.state.soldiers) {
            if (!s.alive) continue;
            const d = s.pos.distanceTo(hitDestructible.pos);
            if (d < 5) {
              const fall = 1 - d / 5;
              s.hp -= 50 * fall;
              if (s.hp <= 0 && s.alive) {
                s.alive = false;
                if (s.team === "red") {
                  this.state.kills += 1;
                  this.state.score += 100;
                  this.state.blueScore += 1;
                }
                this.spawnRagdoll(s);
              }
            }
          }
        }
      }
    }

    if (hitSoldier) {
      const dmg = isHead ? damage * headshotMult : damage;
      this.state.hitMarker = 0.15;
      soundEngine.playHitMarker();
      if (isHead) {
        this.state.headshotMarker = 0.4;
        soundEngine.playHeadshot();
      }
      this.state.damageNumbers.push({
        id: this.state.nextDmgId++,
        pos: hp.clone().add(new THREE.Vector3(0, 0.5, 0)),
        amount: Math.round(dmg),
        ttl: 0.9,
        isCrit: isHead,
      });
      hitSoldier.hp -= dmg;
      if (hitSoldier.hp <= 0 && hitSoldier.alive) {
        hitSoldier.alive = false;
        this.state.kills += 1;
        if (isHead) this.state.headshots += 1;
        this.state.score += isHead ? 200 : 100;
        this.state.blueScore += 1;
        this.spawnRagdoll(hitSoldier);
      }
    }
  }

  private spawnRagdoll(soldier: Soldier) {
    const isRed = soldier.team === "red";
    const accent = isRed ? "#b02828" : "#2050b8";
    const uniform = isRed ? "#5a3a2a" : "#3a4a3a";
    const skin = "#c89a72";
    const boot = "#1a1410";
    const basePos = soldier.pos.clone();
    basePos.y -= 0.9;

    const parts: { offset: THREE.Vector3; size: THREE.Vector3; color: string }[] = [
      { offset: new THREE.Vector3(0, 0.85, 0), size: new THREE.Vector3(0.25, 0.25, 0.25), color: skin },
      { offset: new THREE.Vector3(0, 0.4, 0), size: new THREE.Vector3(0.45, 0.55, 0.3), color: accent },
      { offset: new THREE.Vector3(-0.35, 0.45, 0), size: new THREE.Vector3(0.12, 0.5, 0.12), color: uniform },
      { offset: new THREE.Vector3(0.35, 0.45, 0), size: new THREE.Vector3(0.12, 0.5, 0.12), color: uniform },
      { offset: new THREE.Vector3(-0.12, -0.3, 0), size: new THREE.Vector3(0.14, 0.6, 0.14), color: uniform },
      { offset: new THREE.Vector3(0.12, -0.3, 0), size: new THREE.Vector3(0.14, 0.6, 0.14), color: boot },
    ];

    for (const part of parts) {
      const pos = basePos.clone().add(part.offset);
      const vel = new THREE.Vector3(
        (Math.random() - 0.5) * 6,
        2 + Math.random() * 4,
        (Math.random() - 0.5) * 6,
      );
      this.state.ragdolls.push({
        pos,
        vel,
        rot: new THREE.Euler(Math.random() * 3, Math.random() * 3, Math.random() * 3),
        size: part.size,
        color: part.color,
        ttl: 3.0,
      });
    }
  }

  private spawnDebris(obj: DestructibleObject) {
    const count = obj.kind === "barrel" ? 14 : 8;
    for (let i = 0; i < count; i++) {
      const size = 0.1 + Math.random() * 0.2;
      this.state.ragdolls.push({
        pos: obj.pos.clone().add(new THREE.Vector3(
          (Math.random() - 0.5) * obj.size.x,
          Math.random() * obj.size.y,
          (Math.random() - 0.5) * obj.size.z,
        )),
        vel: new THREE.Vector3(
          (Math.random() - 0.5) * 8,
          3 + Math.random() * 5,
          (Math.random() - 0.5) * 8,
        ),
        rot: new THREE.Euler(Math.random() * 6, Math.random() * 6, Math.random() * 6),
        size: new THREE.Vector3(size, size, size),
        color: obj.color,
        ttl: 2.0,
      });
    }
  }

  private throwGrenade(team: Team) {
    const dir = this.getViewVec();
    const origin = this.getEyePos().add(dir.clone().multiplyScalar(0.6));
    const vel = dir.clone().multiplyScalar(22).add(new THREE.Vector3(0, 4, 0));
    this.state.grenades.push({
      id: this.state.nextGrenadeId++,
      pos: origin,
      vel,
      fuse: GRENADE_FUSE,
      team,
      isSmoke: false,
    });
  }

  private throwSmoke(team: Team) {
    const dir = this.getViewVec();
    const origin = this.getEyePos().add(dir.clone().multiplyScalar(0.6));
    const vel = dir.clone().multiplyScalar(18).add(new THREE.Vector3(0, 3, 0));
    this.state.grenades.push({
      id: this.state.nextGrenadeId++,
      pos: origin,
      vel,
      fuse: GRENADE_FUSE,
      team,
      isSmoke: true,
    });
  }

  private updatePlayer(dt: number) {
    const p = this.state.player;
    const classSpec = CLASSES[this.state.loadout.soldierClass];
    const forward = new THREE.Vector3(-Math.sin(p.yaw), 0, -Math.cos(p.yaw));
    const right = new THREE.Vector3(Math.cos(p.yaw), 0, -Math.sin(p.yaw));
    const move = new THREE.Vector3();
    if (this.input.keys.has("KeyW")) move.add(forward);
    if (this.input.keys.has("KeyS")) move.addScaledVector(forward, -1);
    if (this.input.keys.has("KeyD")) move.add(right);
    if (this.input.keys.has("KeyA")) move.addScaledVector(right, -1);
    const tm = this.input.touchMove;
    if (tm && (Math.abs(tm.x) > 0.05 || Math.abs(tm.y) > 0.05)) {
      move.addScaledVector(forward, tm.y);
      move.addScaledVector(right, tm.x);
    }
    if (move.lengthSq() > 0) move.normalize();
    const speed = MOVE_SPEED * classSpec.speedMult * (this.input.keys.has("ShiftLeft") ? SPRINT_MULT : 1);
    p.vel.x = move.x * speed;
    p.vel.z = move.z * speed;
    p.vel.y -= GRAVITY * dt;

    p.pos.addScaledVector(p.vel, dt);
    const groundY = terrainHeightAt(this.world, p.pos.x, p.pos.z);
    if (p.pos.y < groundY + EYE_HEIGHT) {
      p.pos.y = groundY + EYE_HEIGHT;
      p.vel.y = 0;
      p.onGround = true;
    }
    resolvePlayerCollision(p.pos, PLAYER_RADIUS, PLAYER_HEIGHT, this.boxGrid);

    const lim = WORLD_SIZE / 2 - 2;
    p.pos.x = Math.max(-lim, Math.min(lim, p.pos.x));
    p.pos.z = Math.max(-lim, Math.min(lim, p.pos.z));

    // Footstep sounds
    const sp = Math.hypot(p.vel.x, p.vel.z);
    if (sp > 2 && p.onGround) {
      this.footstepTimer += dt;
      const interval = this.input.keys.has("ShiftLeft") ? 0.28 : 0.38;
      if (this.footstepTimer > interval) {
        this.footstepTimer = 0;
        soundEngine.playFootstep();
      }
    } else {
      this.footstepTimer = 0;
    }
  }

  private updatePlayerVehicle(dt: number) {
    const v = this.state.vehicles.find(v => v.id === this.state.playerInVehicle);
    if (!v || v.destroyed) {
      this.state.playerInVehicle = null;
      return;
    }

    const p = this.state.player;
    // ── 入力収集: スロットル (-1..1) とステア (-1..1) ─────────────────────
    let throttle = 0;   // +1 = full gas, -1 = full reverse/brake
    let steerIn = 0;    // +1 = left, -1 = right

    // Keyboard input
    if (this.input.keys.has("KeyW")) throttle = 1;
    if (this.input.keys.has("KeyS")) throttle = -1;
    if (this.input.keys.has("KeyA")) steerIn = 1;
    if (this.input.keys.has("KeyD")) steerIn = -1;
    // Handbrake (Space): kills lateral grip for sharp slides.
    const handbrake = this.input.keys.has("Space");

    // Touch input: joystick for steering, gas/brake buttons for throttle
    const tm = this.input.touchMove;
    if (tm) {
      if (Math.abs(tm.x) > 0.1) steerIn = -tm.x;
      if (this.input.vehicleGas) {
        throttle = 1;
      } else if (this.input.vehicleBrake) {
        throttle = -1;
      } else if (Math.abs(tm.y) > 0.1) {
        throttle = tm.y > 0 ? 1 : -1;
      }
    }
    steerIn = THREE.MathUtils.clamp(steerIn, -1, 1);

    const dyn = VEHICLE_DYN[v.kind];

    // ── 車体座標系: 前方ベクトル & 右ベクトル ─────────────────────────────
    const fwd = new THREE.Vector3(-Math.sin(v.yaw), 0, -Math.cos(v.yaw));
    const right = new THREE.Vector3(-Math.cos(v.yaw), 0, Math.sin(v.yaw));

    // 速度を前後 / 横方向成分に分解 (タイヤモデルの肝)。
    let vLong = v.vel.x * fwd.x + v.vel.z * fwd.z;   // 前進(+)/後退(-)
    let vLat  = v.vel.x * right.x + v.vel.z * right.z; // 横滑り
    const speed = Math.hypot(vLong, vLat);
    const absLong = Math.abs(vLong);

    // ── エンジン: 速度が上がるほど加速が鈍る (トルクカーブ風) ─────────────
    const topSpeed = v.speed;
    const movingFwd = vLong >= -0.5;
    if (throttle > 0) {
      // 駆動力。最高速近くで頭打ち。
      const powerFade = Math.max(0, 1 - absLong / (topSpeed * 1.05));
      vLong += dyn.enginePower * powerFade * throttle * dt;
    } else if (throttle < 0) {
      if (vLong > 0.5) {
        // 前進中の S = ブレーキ。
        vLong -= dyn.brakePower * dt;
        if (vLong < 0) vLong = 0;
      } else {
        // 停止/後退中の S = バックギア (前進より遅い)。
        vLong -= dyn.enginePower * 0.55 * dt;
        vLong = Math.max(vLong, -topSpeed * 0.4);
      }
    }

    // ── 走行抵抗: 転がり抵抗 + 空気抵抗 (速度二乗) ────────────────────────
    const rollDecel = dyn.rollResist * Math.sign(vLong) * dt;
    if (Math.abs(rollDecel) > Math.abs(vLong)) vLong = 0; else vLong -= rollDecel;
    vLong *= 1 - dyn.drag * absLong * dt;

    // ── ステアリング: 速度感応 + 慣性のあるヨーレート ───────────────────
    // 停止時はほぼ曲がれず、中速で最大、高速でやや緩くなる (実車の感覚)。
    const steerAuthority = Math.min(1, absLong / 3) * (1 - Math.min(0.45, absLong / (topSpeed * 2)));
    // バック時はステア反転。
    const steerSign = movingFwd ? 1 : -1;
    const targetYawRate = steerIn * dyn.steerRate * steerAuthority * steerSign;
    v.yawRate += (targetYawRate - v.yawRate) * Math.min(1, dyn.steerEase * dt);
    v.yaw += v.yawRate * dt;

    // ── タイヤの横グリップ: 横滑り速度を摩擦で削る (ドリフト挙動) ─────────
    // ハンドブレーキ or 過大な横力でグリップを失うとスライドが続く。
    let gripFactor = dyn.grip;
    if (handbrake) gripFactor *= 0.18;
    // 旋回中は遠心力で横速度が増える: ヨーレート×前進速度ぶんを横方向へ。
    vLat += v.yawRate * vLong * dt;
    // 横グリップで横滑りを減衰 (フレームレート非依存)。
    const latGrip = 1 - Math.min(0.99, gripFactor * 14 * dt);
    vLat *= latGrip;

    // スリップ量 (0..1): 横速度が大きいほどドリフト中。
    v.slip = THREE.MathUtils.clamp(Math.abs(vLat) / Math.max(4, speed), 0, 1);

    // ── 速度ベクトルを車体座標から再合成 ─────────────────────────────────
    v.vel.set(
      fwd.x * vLong + right.x * vLat,
      0,
      fwd.z * vLong + right.z * vLat,
    );

    // ── 斜面の影響: 坂を登ると減速、下ると加速 ───────────────────────────
    const aheadH = terrainHeightAt(this.world, v.pos.x + fwd.x * 2, v.pos.z + fwd.z * 2);
    const hereH = terrainHeightAt(this.world, v.pos.x, v.pos.z);
    const slope = (aheadH - hereH) / 2; // rise per metre forward
    vLong -= slope * 14 * dt; // gravity component along slope
    // re-apply slope-corrected longitudinal speed
    v.vel.set(
      fwd.x * vLong + right.x * vLat,
      0,
      fwd.z * vLong + right.z * vLat,
    );

    v.pos.addScaledVector(v.vel, dt);

    // Vehicle collision with world boxes
    const vRadius = 1.5;
    for (const b of this.boxes) {
      if (v.pos.y + 1.0 < b.min.y || v.pos.y - 0.5 > b.max.y) continue;
      const cx = Math.max(b.min.x, Math.min(v.pos.x, b.max.x));
      const cz = Math.max(b.min.z, Math.min(v.pos.z, b.max.z));
      const dx = v.pos.x - cx;
      const dz = v.pos.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 < vRadius * vRadius) {
        const d = Math.sqrt(d2) || 0.001;
        const nx = dx / d, nz = dz / d;
        v.pos.x += nx * (vRadius - d);
        v.pos.z += nz * (vRadius - d);
        // Reflect velocity off the surface normal & bleed energy (heavier =
        // less bounce, more thud). Triggers a small suspension jolt + shake.
        const vn = v.vel.x * nx + v.vel.z * nz;
        if (vn < 0) {
          const restitution = 0.25;
          v.vel.x -= (1 + restitution) * vn * nx;
          v.vel.z -= (1 + restitution) * vn * nz;
          const impact = Math.abs(vn);
          v.suspensionVel -= Math.min(4, impact * 0.25);
          if (impact > 6) this.state.shake = Math.min(0.5, impact * 0.03);
        }
      }
    }

    const lim = WORLD_SIZE / 2 - 5;
    v.pos.x = Math.max(-lim, Math.min(lim, v.pos.x));
    v.pos.z = Math.max(-lim, Math.min(lim, v.pos.z));

    // ── サスペンション: 地形段差を吸収するバネ・ダンパー ─────────────────
    const groundY = terrainHeightAt(this.world, v.pos.x, v.pos.z) + (v.kind === "tank" ? 0.6 : 0.5);
    // Spring pulls the body to rest, damper kills oscillation.
    const springK = 90 / dyn.mass;
    const damp = 12;
    v.suspensionVel += (-v.suspension * springK - v.suspensionVel * damp) * dt;
    v.suspension += v.suspensionVel * dt;
    v.suspension = THREE.MathUtils.clamp(v.suspension, -0.35, 0.35);
    v.pos.y = groundY + v.suspension;

    // ── 車体姿勢 (見た目): コーナーでロール、加減速でピッチ ───────────────
    const targetRoll = THREE.MathUtils.clamp(
      -v.yawRate * vLong * dyn.rollStiff / dyn.trackWidth, -0.35, 0.35);
    v.bodyRoll += (targetRoll - v.bodyRoll) * Math.min(1, 6 * dt);
    const longAccel = throttle > 0 ? throttle : (throttle < 0 && vLong > 0.5 ? -1.4 : 0);
    const targetPitch = THREE.MathUtils.clamp(-longAccel * 0.05, -0.08, 0.08);
    v.bodyPitch += (targetPitch - v.bodyPitch) * Math.min(1, 5 * dt);

    // ── エンジン回転 & 車輪回転 (音・見た目用) ───────────────────────────
    const targetRpm = Math.min(1, 0.12 + absLong / topSpeed + (throttle > 0 ? 0.25 : 0) + v.slip * 0.3);
    v.engineRpm += (targetRpm - v.engineRpm) * Math.min(1, 4 * dt);
    v.wheelSpin += (vLong / 0.5) * dt;

    // Player rides vehicle — seat height varies with the hull size so the
    // camera sits in the cab/turret rather than buried inside or floating above.
    const seatH = v.kind === "tank" ? 2.4
      : v.kind === "apc" ? 2.6
      : v.kind === "truck" ? 2.4
      : v.kind === "humvee" ? 2.0
      : 1.8;
    // Vehicle forward (travel) direction.
    const fwdV = new THREE.Vector3(-Math.sin(v.yaw), 0, -Math.cos(v.yaw));
    if (this.state.vehicleViewMode === "third") {
      // 三人称: 車体後方上方からのチェイスカメラ。前進方向の逆へ下げる。
      const dist = v.kind === "tank" ? 11 : v.kind === "apc" || v.kind === "truck" ? 10 : 8;
      const height = v.kind === "tank" || v.kind === "apc" || v.kind === "truck" ? 5 : 4;
      p.pos.set(
        v.pos.x - fwdV.x * dist,
        v.pos.y + seatH + height,
        v.pos.z - fwdV.z * dist,
      );
    } else {
      // 一人称(操縦手視点): 視点を運転席まで前進方向へ少し進め、ボンネット/
      // 砲塔の前方に置く。車体に埋もれず前がしっかり見えるようにする。
      const fwdSeat = v.kind === "tank" ? 1.2
        : v.kind === "apc" || v.kind === "truck" ? 1.6
        : 1.4;
      p.pos.set(
        v.pos.x + fwdV.x * fwdSeat,
        v.pos.y + seatH,
        v.pos.z + fwdV.z * fwdSeat,
      );
    }
    // カメラの向きを車体の進行方向に追従させる。これがないとハンドルを切っても
    // 視点が回らず、明後日の方向を向いたまま運転することになり非常に見にくい。
    // ステア中はヨーレートぶん先読みして向けると、より自然に曲がる先が見える。
    // マウスのフリールック量 (vehicleLookYaw/Pitch) を進行方向に上乗せして、
    // 前を見据えたまま周囲を少しだけ見回せるようにする。
    const targetYaw = v.yaw + v.yawRate * 0.25 + this.vehicleLookYaw;
    // 角度の差を [-PI, PI] に正規化してから滑らかに追従(急な反転を防ぐ)。
    let dYaw = targetYaw - p.yaw;
    while (dYaw > Math.PI) dYaw -= Math.PI * 2;
    while (dYaw < -Math.PI) dYaw += Math.PI * 2;
    p.yaw += dYaw * Math.min(1, 12 * dt);
    // 水平基準のわずかな見下ろし。第一人称はほぼ水平、第三人称は少し見下ろす。
    const basePitch = this.state.vehicleViewMode === "third" ? -0.12 : -0.02;
    const camTargetPitch = basePitch + this.vehicleLookPitch;
    p.pitch += (camTargetPitch - p.pitch) * Math.min(1, 10 * dt);
    p.vel.set(0, 0, 0);
    p.onGround = true;
  }

  private updateVehicles(dt: number) {
    for (const v of this.state.vehicles) {
      if (v.destroyed) continue;
      if (v.id === this.state.playerInVehicle) continue;
      // Coast unoccupied vehicles to a stop with rolling resistance, then let
      // the suspension settle so a parked truck visibly sits on its springs.
      v.vel.multiplyScalar(1 - 3 * dt);
      if (v.vel.lengthSq() < 0.0004) v.vel.set(0, 0, 0);
      v.pos.addScaledVector(v.vel, dt);
      // Decay handling state back to neutral.
      v.yawRate *= Math.pow(0.1, dt);
      v.slip *= Math.pow(0.1, dt);
      v.engineRpm += (0 - v.engineRpm) * Math.min(1, 3 * dt);
      v.bodyRoll *= Math.pow(0.05, dt);
      v.bodyPitch *= Math.pow(0.05, dt);
      // Suspension spring/damper settling onto the terrain.
      const dyn = VEHICLE_DYN[v.kind];
      const groundY = terrainHeightAt(this.world, v.pos.x, v.pos.z) + (v.kind === "tank" ? 0.6 : 0.5);
      const springK = 90 / dyn.mass;
      v.suspensionVel += (-v.suspension * springK - v.suspensionVel * 12) * dt;
      v.suspension += v.suspensionVel * dt;
      v.suspension = THREE.MathUtils.clamp(v.suspension, -0.35, 0.35);
      v.pos.y = groundY + v.suspension;
    }
  }

  private findCoverPosition(soldier: Soldier, threatPos: THREE.Vector3): THREE.Vector3 | null {
    let bestCover: THREE.Vector3 | null = null;
    let bestScore = -Infinity;

    const candidates: { pos: THREE.Vector3; obstacle: THREE.Vector3 }[] = [];
    for (const sb of this.world.sandbags) {
      const behindDir = _tmpV1.subVectors(sb.pos, threatPos);
      behindDir.y = 0;
      if (behindDir.lengthSq() < 0.0001) continue;
      behindDir.normalize();
      candidates.push({ pos: sb.pos.clone().addScaledVector(behindDir, 1.6), obstacle: sb.pos });
    }
    for (const d of this.state.destructibles) {
      if (d.destroyed) continue;
      const behindDir = _tmpV1.subVectors(d.pos, threatPos);
      behindDir.y = 0;
      if (behindDir.lengthSq() < 0.0001) continue;
      behindDir.normalize();
      candidates.push({ pos: d.pos.clone().addScaledVector(behindDir, 1.6), obstacle: d.pos });
    }
    // Building corners as cover
    for (const b of this.world.buildings) {
      const corners = [
        new THREE.Vector3(b.min.x, 0, b.min.z),
        new THREE.Vector3(b.max.x, 0, b.min.z),
        new THREE.Vector3(b.min.x, 0, b.max.z),
        new THREE.Vector3(b.max.x, 0, b.max.z),
      ];
      for (const c of corners) {
        const dirAway = _tmpV1.subVectors(c, threatPos);
        dirAway.y = 0;
        if (dirAway.lengthSq() < 0.0001) continue;
        dirAway.normalize();
        candidates.push({ pos: c.clone().addScaledVector(dirAway, 2.0), obstacle: c });
      }
    }

    const eyeOffset = new THREE.Vector3(0, 1.0, 0);
    for (const cp of candidates) {
      const distToSoldier = soldier.pos.distanceTo(cp.pos);
      if (distToSoldier > 25) continue;
      // Verify the candidate actually blocks LOS
      const probe = cp.pos.clone().add(eyeOffset);
      const blocked = !this.lineOfSight(probe, threatPos.clone().add(eyeOffset));
      if (!blocked) continue;
      const distToThreat = cp.pos.distanceTo(threatPos);
      const score = -distToSoldier * 0.6 + Math.min(distToThreat, 20) * 0.4;
      if (score > bestScore) {
        bestScore = score;
        bestCover = cp.pos.clone();
      }
    }
    return bestCover;
  }

  // Field-of-view based detection: cone in front, narrow far range, wide close range
  private canSee(s: Soldier, targetPos: THREE.Vector3, time: number): boolean {
    const eye = _tmpV1.set(s.pos.x, s.pos.y - 0.2, s.pos.z);
    const tEye = _tmpV2.set(targetPos.x, targetPos.y - 0.1, targetPos.z);
    if (!this.lineOfSight(eye, tEye)) return false;
    if (this.linePassesThroughSmoke(s.pos, targetPos)) return false;
    const dx = targetPos.x - s.pos.x;
    const dz = targetPos.z - s.pos.z;
    const dist = Math.hypot(dx, dz);
    const cls = CLASSES[s.soldierClass];
    const baseRange = s.soldierClass === "sniper" ? 145 : s.soldierClass === "support" ? 85 : 105;
    const range = baseRange * (0.95 + s.alertness * 0.55);
    if (dist > range) return false;
    // FOV cone: ~120deg base, 360 if very close (sound / proximity)
    if (dist < 14) return true;
    const facing = _tmpV3.set(-Math.sin(s.yaw), 0, -Math.cos(s.yaw));
    const toT = _tmpV1.set(dx / dist, 0, dz / dist);
    const dot = facing.x * toT.x + facing.z * toT.z;
    // alert -> wider cone
    const fovCos = Math.cos((Math.PI / 180) * (80 + s.alertness * 45));
    return dot > fovCos;
  }

  private updateCapturePoints(dt: number, time: number) {
    this.state.captureTickTimer += dt;
    const doTick = this.state.captureTickTimer > 1.0;
    if (doTick) this.state.captureTickTimer = 0;

    for (const cp of this.state.capturePoints) {
      // Count soldiers in radius
      let blueCount = 0;
      let redCount = 0;
      // Player counts
      const pd = Math.hypot(this.state.player.pos.x - cp.pos.x, this.state.player.pos.z - cp.pos.z);
      if (pd < cp.radius && this.state.player.hp > 0) blueCount++;
      for (const s of this.state.soldiers) {
        if (!s.alive) continue;
        const d = Math.hypot(s.pos.x - cp.pos.x, s.pos.z - cp.pos.z);
        if (d < cp.radius) {
          if (s.team === "blue") blueCount++;
          else redCount++;
        }
      }

      const contested = blueCount > 0 && redCount > 0;
      if (!contested) {
        if (blueCount > 0) {
          cp.progress = Math.min(1, cp.progress + CAPTURE_SPEED * dt * blueCount);
        } else if (redCount > 0) {
          cp.progress = Math.max(-1, cp.progress - CAPTURE_SPEED * dt * redCount);
        }
      }

      const prevOwner = cp.owner;
      if (cp.progress >= 1) cp.owner = "blue";
      else if (cp.progress <= -1) cp.owner = "red";
      else if (Math.abs(cp.progress) < 0.1) cp.owner = null;

      if (cp.owner !== prevOwner && cp.owner) {
        soundEngine.playCaptureBeep();
      }

      // Score tick for owned points
      if (doTick && cp.owner) {
        if (cp.owner === "blue") this.state.blueScore += 1;
        else this.state.redScore += 1;
      }
    }
  }

  private updateSoldiers(dt: number, time: number) {
    const p = this.state.player;
    // 搭乗中 (航空機・地上車両) のプレイヤーは敵歩兵の射撃対象にしない。
    // 機体に追従する player.pos を撃たれてもダメージは無効化しているが、
    // ターゲットからも外すことで無駄な被弾エフェクト/追尾を防ぐ。
    const playerAlive = p.hp > 0 && this.state.status === "playing" && !this.playerIsMounted();

    for (const s of this.state.soldiers) {
      if (!s.alive) continue;

      const classSpec = CLASSES[s.soldierClass];

      // ---- 1. Target selection: own sight + nearby squad callouts ----
      // We only need the single CLOSEST visible enemy, so instead of collecting
      // every candidate, doing the expensive line-of-sight test on each, then
      // sorting, we:
      //   1. cheaply find the nearest in-range candidate via squared distance,
      //   2. run the costly canSee() line-of-sight pass on candidates ordered by
      //      proximity, stopping at the first one we can actually see.
      // This dramatically cuts the number of lineOfSight raycasts per frame.
      const SIGHT_R2 = 160 * 160;
      type Cand = { pos: THREE.Vector3; vel: THREE.Vector3; id: number; isPlayer: boolean; d2: number };
      const cand: Cand[] = [];
      if (s.team === "red" && playerAlive) {
        const d2 = s.pos.distanceToSquared(p.pos);
        if (d2 <= SIGHT_R2) cand.push({ pos: p.pos, vel: p.vel, id: 0, isPlayer: true, d2 });
      }
      for (const o of this.state.soldiers) {
        if (!o.alive || o.team === s.team) continue;
        const d2 = s.pos.distanceToSquared(o.pos);
        if (d2 > SIGHT_R2) continue;
        cand.push({ pos: o.pos, vel: o.vel, id: o.id, isPlayer: false, d2 });
      }
      // Nearest-first so the first visible candidate is also the closest.
      cand.sort((a, b) => a.d2 - b.d2);
      let visTarget: { pos: THREE.Vector3; vel: THREE.Vector3; id: number; isPlayer: boolean; dist: number } | null = null;
      for (const c of cand) {
        if (this.canSee(s, c.pos, time)) {
          visTarget = { pos: c.pos, vel: c.vel, id: c.id, isPlayer: c.isPlayer, dist: Math.sqrt(c.d2) };
          break;
        }
      }
      let sharedTarget: { pos: THREE.Vector3; id: number; dist: number } | null = null;
      if (!visTarget) {
        const ALLY_R2 = 34 * 34;
        for (const ally of this.state.soldiers) {
          if (!ally.alive || ally.team !== s.team || ally.id === s.id || !ally.lastSeenPos) continue;
          if (time - ally.lastSeenAt > 2.4 || s.pos.distanceToSquared(ally.pos) > ALLY_R2) continue;
          const distToCallout = s.pos.distanceTo(ally.lastSeenPos);
          if (!sharedTarget || distToCallout < sharedTarget.dist) {
            sharedTarget = { pos: ally.lastSeenPos.clone().add(s.squadOffset), id: ally.targetId ?? -1, dist: distToCallout };
          }
        }
      }

      // Update memory
      if (visTarget) {
        if (!s.lastSeenPos) s.lastSeenPos = new THREE.Vector3();
        s.lastSeenPos.copy(visTarget.pos);
        // Apply reaction delay only when alertness was low
        if (time - s.lastSeenAt > 1.5) {
          // fresh sighting
          const baseReact = s.soldierClass === "sniper" ? 0.16 : s.soldierClass === "support" ? 0.12 : 0.09;
          s.reactionDelay = Math.max(s.reactionDelay, baseReact * (1 - s.alertness * 0.6));
        }
        s.lastSeenAt = time;
        s.alertness = Math.min(1, s.alertness + dt * 2.6);
        s.targetId = visTarget.id;
      } else if (sharedTarget) {
        if (!s.lastSeenPos) s.lastSeenPos = new THREE.Vector3();
        s.lastSeenPos.copy(sharedTarget.pos);
        s.lastSeenAt = Math.max(s.lastSeenAt, time - 0.6);
        s.alertness = Math.min(1, s.alertness + dt * 1.8);
        s.targetId = sharedTarget.id;
      } else {
        s.alertness = Math.max(0, s.alertness - dt * 0.15);
      }
      s.reactionDelay = Math.max(0, s.reactionDelay - dt);

      // Active target reference (visible OR remembered)
      const memActive = !visTarget && s.lastSeenPos && (time - s.lastSeenAt < 12.0);
      const target = visTarget
        ? { pos: visTarget.pos.clone(), vel: visTarget.vel.clone(), id: visTarget.id, isPlayer: visTarget.isPlayer, dist: visTarget.dist }
        : (memActive
          ? { pos: s.lastSeenPos!.clone(), vel: new THREE.Vector3(), id: s.targetId ?? -1, isPlayer: false, dist: s.pos.distanceTo(s.lastSeenPos!) }
          : null);

      // ---- 2. Stuck detection ----
      const moved = s.pos.distanceTo(s.lastPosCheck);
      s.stuckTimer = moved < 0.08 ? s.stuckTimer + dt : Math.max(0, s.stuckTimer - dt * 2);
      const inBuilding = this.isInsideBuilding(s.pos, 0.15);
      if (s.stuckTimer > 0.8 || (inBuilding && s.stuckTimer > 0.5)) {
        s.flankDir = -s.flankDir;
        const escape = this.findEscapePoint(s.pos) ?? s.pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 18, 0, (Math.random() - 0.5) * 18));
        s.patrolTarget = escape;
        s.coverTarget = escape.clone();
        s.coverTimer = 1.5;
        s.state = "investigate";
        s.moveDir.set(0, 0, 0);
        s.stuckTimer = -0.6;
        s.nextTacticalDecisionAt = time + 1.2;
      }
      // Throttle position check so brief slow movement doesn't accumulate stuck time
      s.lastPosCheck.copy(s.pos);

      if (!target) {
        // ---- 3a. Patrol: move toward nearest contested capture point if any ----
        if (s.state !== "patrol") s.state = "patrol";
        let goal = s.patrolTarget;
        if (this.state.capturePoints.length > 0) {
          let best: CapturePoint | null = null;
          let bestD = Infinity;
          for (const cp of this.state.capturePoints) {
            const owns = (s.team === "blue" && cp.owner === "blue") || (s.team === "red" && cp.owner === "red");
            if (owns) continue;
            const d = s.pos.distanceTo(cp.pos);
            if (d < bestD) { bestD = d; best = cp; }
          }
          if (best) goal = best.pos;
        }
        const toGoal = _tmpV1.subVectors(goal, s.pos); toGoal.y = 0;
        if (toGoal.length() < 3) {
          // Pick a new patrol target that's actually far enough away to avoid oscillation
          for (let attempt = 0; attempt < 6; attempt++) {
            const a = Math.random() * Math.PI * 2;
            const r = 18 + Math.random() * 22;
            const candidate = s.pos.clone().add(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r));
            const lim = WORLD_SIZE / 2 - 6;
            candidate.x = Math.max(-lim, Math.min(lim, candidate.x));
            candidate.z = Math.max(-lim, Math.min(lim, candidate.z));
            if (!this.isInsideBuilding(candidate, -0.5)) {
              s.patrolTarget = candidate;
              break;
            }
          }
          toGoal.subVectors(s.patrolTarget, s.pos);
          toGoal.y = 0;
        }
        const move = toGoal.lengthSq() > 0 ? toGoal.clone().normalize() : new THREE.Vector3();
        this.steerAndMove(s, move, 4.2 * classSpec.speedMult, dt);
        s.desiredYaw = Math.atan2(-move.x, -move.z);
        s.yaw += this.shortAngle(s.desiredYaw - s.yaw) * Math.min(1, dt * 4);
        continue;
      }

      // We have a target (visible or remembered)
      const dirToT = new THREE.Vector3().subVectors(target.pos, s.pos);
      dirToT.y = 0;
      const dist = dirToT.length();
      if (dist > 0.001) dirToT.normalize();
      s.lastThreatDir = dirToT.clone();
      s.desiredYaw = Math.atan2(-dirToT.x, -dirToT.z);

      // Smoothly turn toward target (reaction lag while turning)
      const turnRate = (s.soldierClass === "sniper" ? 5 : 8) * (0.6 + s.alertness * 0.6);
      s.yaw += this.shortAngle(s.desiredYaw - s.yaw) * Math.min(1, dt * turnRate);

      const hasLOS = !!visTarget;

      // ---- 4. Tactical decision making — aggressive but cover-aware ----
      const inCommittedState = s.state === "flank" || s.state === "retreat" || s.state === "cover";
      const makingDecision = time >= s.nextTacticalDecisionAt && !(inCommittedState && s.coverTimer > 0);
      // Local squad strength near this soldier vs near the threat — used so a
      // lone, outnumbered soldier behaves more cautiously instead of suicide-rushing.
      // This O(n) scan is only needed when we actually re-evaluate tactics this
      // frame, so it's gated behind `makingDecision` (skips the full soldier scan
      // on the vast majority of frames).
      let outnumbered = false;
      if (makingDecision) {
        let alliesNear = 0;
        let enemiesNearThreat = 0;
        const ALLY_R2 = 26 * 26;
        const THREAT_R2 = 22 * 22;
        for (const o of this.state.soldiers) {
          if (!o.alive) continue;
          if (o.team === s.team && o.id !== s.id && o.pos.distanceToSquared(s.pos) < ALLY_R2) alliesNear++;
          else if (o.team !== s.team && o.pos.distanceToSquared(target.pos) < THREAT_R2) enemiesNearThreat++;
        }
        outnumbered = enemiesNearThreat > alliesNear + 1;
      }

      if (makingDecision) {
        s.nextTacticalDecisionAt = time + (inCommittedState ? 1.4 : 0.7) + Math.random() * 0.4;
        const hpFrac = s.hp / s.hpMax;
        const lowHp = hpFrac < 0.35;
        const veryLowHp = hpFrac < 0.2;

        // --- Survival first: break contact when badly hurt or badly outnumbered ---
        if ((veryLowHp || (lowHp && outnumbered)) && Math.random() < 0.7) {
          s.state = "retreat";
        } else if (lowHp || (outnumbered && hasLOS && dist < 35)) {
          // Hurt or pinned: seek cover and hold/peek instead of charging.
          const cover = this.findCoverNear(s.pos, target.pos, s.soldierClass === "sniper" ? 26 : 16);
          if (cover) {
            s.state = "cover";
            s.coverTarget = cover;
            s.coverTimer = 1.6 + Math.random() * 1.4;
          } else {
            s.state = "suppress";
          }
        } else if (s.soldierClass === "sniper") {
          // Snipers hold range from cover; only reposition when pushed.
          if (hasLOS && dist < 12) {
            s.state = "flank"; // too close, create distance via lateral move
          } else if (hasLOS && dist > 20) {
            const cover = this.findCoverNear(s.pos, target.pos, 22);
            if (cover && Math.random() < 0.5) { s.state = "cover"; s.coverTarget = cover; s.coverTimer = 2.2; }
            else s.state = "attack";
          } else s.state = hasLOS ? "attack" : "chase";
        } else if (s.soldierClass === "support") {
          // Suppress from a held position, push when the lane is clear.
          if (hasLOS && dist < 16) s.state = "attack";
          else if (hasLOS && dist < 60) s.state = Math.random() < 0.35 ? "flank" : "suppress";
          else s.state = hasLOS ? "chase" : "investigate";
        } else if (s.soldierClass === "assault") {
          // Aggressive pusher, but takes cover when contact opens at mid range.
          if (hasLOS && dist < 12) s.state = "attack";
          else if (hasLOS && dist < 22 && Math.random() < 0.3) {
            const cover = this.findCoverNear(s.pos, target.pos, 12);
            if (cover) { s.state = "cover"; s.coverTarget = cover; s.coverTimer = 1.1; }
            else s.state = "flank";
          } else if (hasLOS && dist < 48 && Math.random() < 0.55) s.state = "flank";
          else s.state = hasLOS ? "chase" : "investigate";
        } else { // medic
          const hurtAlly = this.state.soldiers.find((ally) => ally.alive && ally.team === s.team && ally.hp < ally.hpMax * 0.4 && ally.pos.distanceToSquared(s.pos) < 576);
          if (hurtAlly && Math.random() < 0.6) {
            s.state = "cover";
            s.coverTarget = hurtAlly.pos.clone().addScaledVector(dirToT, -2);
            s.coverTimer = 1.2;
          } else s.state = hasLOS ? (dist < 16 ? "attack" : "chase") : "investigate";
        }

        // Throw a grenade to flush a target out of cover / break a standoff.
        if (hasLOS && dist > 7 && dist < 40 && time - s.lastGrenadeAt > 4.0 && Math.random() < 0.45) {
          this.aiThrowGrenade(s, target.pos);
          s.lastGrenadeAt = time;
        }
        // Pop smoke to cover a retreat or a wounded advance.
        if ((s.state === "retreat" || (lowHp && s.state === "cover")) && time - s.lastSmokeAt > 9 && Math.random() < 0.4) {
          this.aiThrowSmoke(s, target.pos);
          s.lastSmokeAt = time;
        }
      }

      // ---- 5. Execute state ----
      const move = new THREE.Vector3();
      let speedMult = 1;

      switch (s.state) {
        case "cover": {
          s.coverTimer -= dt;
          if (s.coverTimer <= 0 || !s.coverTarget) {
            // Recovered / held long enough: peek out and re-engage.
            s.state = "attack";
            s.coverTarget = null;
          } else {
            const toCover = new THREE.Vector3().subVectors(s.coverTarget, s.pos); toCover.y = 0;
            const coverDist = toCover.length();
            if (coverDist > 0.9) {
              // Still moving to the cover spot — sprint there.
              move.copy(toCover.normalize());
              speedMult = 1.9;
            } else {
              // In position: hug the spot with a small peek when ready to fire.
              const settled = coverDist < 0.4;
              if (settled && hasLOS && s.coverTimer < 0.9) {
                // peek toward threat for a shot opportunity
                move.copy(dirToT).multiplyScalar(0.25);
                speedMult = 0.6;
              } else {
                move.set(0, 0, 0);
                speedMult = 0;
              }
            }
          }
          break;
        }
        case "retreat": {
          // Move away from threat — full sprint to break contact.
          move.copy(dirToT).multiplyScalar(-1);
          const lat = new THREE.Vector3(-dirToT.z, 0, dirToT.x).multiplyScalar(s.flankDir * 0.4);
          move.add(lat).normalize();
          speedMult = 1.85;
          if (s.hp > s.hpMax * 0.3) s.state = "chase"; // recover quickly and push back
          break;
        }
        case "flank": {
          // Move perpendicular while strongly closing — sprint around the side.
          const perp = new THREE.Vector3(-dirToT.z, 0, dirToT.x).multiplyScalar(s.flankDir);
          move.copy(perp).addScaledVector(dirToT, 0.75).normalize();
          speedMult = 1.9;
          if (dist < 10 || dist > 50) s.state = hasLOS ? "attack" : "chase";
          break;
        }
        case "suppress": {
          // Hold position, slight strafe — but advance if too far
          const side = Math.sin(time * 1.5 + s.id) > 0 ? 1 : -1;
          const perp = new THREE.Vector3(-dirToT.z, 0, dirToT.x).multiplyScalar(side * 0.4);
          move.copy(perp);
          if (dist > 28) move.addScaledVector(dirToT, 0.85);
          if (move.lengthSq() > 0) move.normalize();
          speedMult = 1.0;
          break;
        }
        case "chase": {
          move.copy(dirToT);
          const perp = new THREE.Vector3(-dirToT.z, 0, dirToT.x).multiplyScalar(s.flankDir * 0.2);
          move.add(perp).normalize();
          speedMult = 2.0; // full-on sprint toward the enemy
          break;
        }
        case "investigate": {
          move.copy(dirToT);
          speedMult = 1.55; // jog toward last-known position
          if (dist < 2) {
            s.lastSeenAt = time - 4.5;
            s.state = "patrol";
          }
          break;
        }
        case "attack":
        default: {
          // Strafe + push to close range
          const side = Math.sin(time * 1.1 + s.id * 0.7) > 0 ? 1 : -1;
          const perp = new THREE.Vector3(-dirToT.z, 0, dirToT.x).multiplyScalar(side);
          const idealDist = s.soldierClass === "sniper" ? 32 : s.soldierClass === "support" ? 18 : 9;
          const closer = dist > idealDist ? 0.75 : (dist < idealDist - 4 ? -0.35 : 0);
          move.copy(perp).addScaledVector(dirToT, closer);
          if (move.lengthSq() > 0) move.normalize();
          speedMult = 1.25;
          break;
        }
      }

      // Soldiers run at the same top speed as the player. When the AI is
      // sprinting (engaged states such as chase/flank/retreat) its movement is
      // capped at the player's sprint pace (MOVE_SPEED * SPRINT_MULT), so an AI
      // running never out-paces a running player.
      // AI base jog speed, scaled 1.5x (5.0 -> 7.5) to match the faster player.
      const baseSpeed = 7.5;
      const PLAYER_SPRINT_SPEED = MOVE_SPEED * SPRINT_MULT;
      const desiredSpeed = baseSpeed * classSpec.speedMult * speedMult;
      const finalSpeed = Math.min(desiredSpeed, PLAYER_SPRINT_SPEED);
      this.steerAndMove(s, move, finalSpeed, dt);

      // ---- 6. Shooting decision ----
      const fireInterval = s.soldierClass === "sniper" ? 1.0
        : s.soldierClass === "support" ? 0.28
        : s.soldierClass === "assault" ? 0.45
        : 0.6;
      const engageRange = s.soldierClass === "sniper" ? 130
        : s.soldierClass === "support" ? 80
        : 75;
      const canShoot = hasLOS
        && dist < engageRange
        && s.reactionDelay <= 0
        && time - s.lastShotAt > fireInterval
        && s.state !== "retreat"
        && s.state !== "investigate";
      // Looser aim cone so they fire more often while pushing
      const facing = _tmpV3.set(-Math.sin(s.yaw), 0, -Math.cos(s.yaw));
      const aimDot = facing.x * dirToT.x + facing.z * dirToT.z;
      if (canShoot && aimDot > 0.78) {
        s.lastShotAt = time;
        this.soldierShoot(s, target, dirToT, time);
      }
    }

    if (time - p.lastDamagedAt > 6 && p.hp < p.hpMax) {
      p.hp = Math.min(p.hpMax, p.hp + 8 * dt);
    }
    if (p.hp <= 0) {
      p.hp = 0;
      this.state.status = "dead";
      this.state.deaths += 1;
      this.state.redScore += 1;
      this.state.playerInVehicle = null;
      document.exitPointerLock?.();
    }

    this.state.enemies = this.state.soldiers;

    const blueAlive = this.state.soldiers.filter((s) => s.team === "blue" && s.alive).length;
    const redAlive = this.state.soldiers.filter((s) => s.team === "red" && s.alive).length;
    if (blueAlive < TEAM_SIZE - 1 && Math.random() < 0.02) this.spawnSoldier("blue");
    if (redAlive < TEAM_SIZE && Math.random() < 0.025) this.spawnSoldier("red");
  }

  private shortAngle(a: number): number {
    while (a > Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    return a;
  }

  private isInsideBuilding(pos: THREE.Vector3, pad = 0) {
    return this.world.buildings.some((b) => pos.x > b.min.x + pad && pos.x < b.max.x - pad && pos.z > b.min.z + pad && pos.z < b.max.z - pad);
  }

  private findEscapePoint(pos: THREE.Vector3): THREE.Vector3 | null {
    let nearest: { b: World["buildings"][number]; d: number } | null = null;
    for (const b of this.world.buildings) {
      if (pos.x > b.min.x - 1 && pos.x < b.max.x + 1 && pos.z > b.min.z - 1 && pos.z < b.max.z + 1) {
        const d = Math.min(Math.abs(pos.x - b.min.x), Math.abs(pos.x - b.max.x), Math.abs(pos.z - b.min.z), Math.abs(pos.z - b.max.z));
        if (!nearest || d < nearest.d) nearest = { b, d };
      }
    }
    if (!nearest) return null;
    const b = nearest.b;
    const options = [
      new THREE.Vector3((b.min.x + b.max.x) / 2, 0, b.min.z - 3),
      new THREE.Vector3((b.min.x + b.max.x) / 2, 0, b.max.z + 3),
      new THREE.Vector3(b.min.x - 3, 0, (b.min.z + b.max.z) / 2),
      new THREE.Vector3(b.max.x + 3, 0, (b.min.z + b.max.z) / 2),
    ];
    const safe = options.filter((p) => Math.abs(p.x) < WORLD_SIZE / 2 - 4 && Math.abs(p.z) < WORLD_SIZE / 2 - 4 && !this.isInsideBuilding(p, -0.4));
    safe.sort((a, c) => a.distanceTo(pos) - c.distanceTo(pos));
    const best = safe[0] ?? options[0];
    best.y = terrainHeightAt(this.world, best.x, best.z) + SOLDIER_HEIGHT;
    return best;
  }

  // Find a nearby cover spot (behind a crate / sandbag / barrel / wall) that
  // breaks line of sight from the threat. Returns null if nothing suitable.
  private findCoverNear(pos: THREE.Vector3, threat: THREE.Vector3, maxDist: number): THREE.Vector3 | null {
    let best: THREE.Vector3 | null = null;
    let bestScore = Infinity;
    // Gather candidate cover objects (low/solid props the AI can hide behind).
    const props: { x: number; z: number; r: number }[] = [];
    for (const c of this.world.crates) {
      if (Math.hypot(c.pos.x - pos.x, c.pos.z - pos.z) < maxDist + 4) props.push({ x: c.pos.x, z: c.pos.z, r: c.size * 0.5 + 0.6 });
    }
    for (const sb of this.world.sandbags) {
      const r = Math.max(sb.size.x, sb.size.z) * 0.5 + 0.7;
      if (Math.hypot(sb.pos.x - pos.x, sb.pos.z - pos.z) < maxDist + 4) props.push({ x: sb.pos.x, z: sb.pos.z, r });
    }
    for (const b of this.world.barrels) {
      if (Math.hypot(b.pos.x - pos.x, b.pos.z - pos.z) < maxDist + 4) props.push({ x: b.pos.x, z: b.pos.z, r: 1.0 });
    }
    for (const prop of props) {
      // Stand on the side of the prop facing away from the threat.
      const ax = prop.x - threat.x;
      const az = prop.z - threat.z;
      const al = Math.hypot(ax, az) || 0.0001;
      const spot = new THREE.Vector3(
        prop.x + (ax / al) * (prop.r + SOLDIER_RADIUS + 0.3),
        0,
        prop.z + (az / al) * (prop.r + SOLDIER_RADIUS + 0.3),
      );
      const d = Math.hypot(spot.x - pos.x, spot.z - pos.z);
      if (d > maxDist) continue;
      if (this.isInsideBuilding(spot, -0.3)) continue;
      // Prefer cover that actually blocks LOS to the threat and is close.
      spot.y = terrainHeightAt(this.world, spot.x, spot.z) + SOLDIER_HEIGHT;
      const eye = _tmpV1.set(spot.x, spot.y - 0.4, spot.z);
      const te = _tmpV2.set(threat.x, threat.y, threat.z);
      const blocked = !this.lineOfSight(eye, te);
      const score = d + (blocked ? 0 : 30);
      if (score < bestScore) { bestScore = score; best = spot; }
    }
    return best;
  }

  private isMoveBlocked(pos: THREE.Vector3, dir: THREE.Vector3, distance: number) {
    const ahead = pos.clone().addScaledVector(dir, distance);
    this.boxGrid.ensureSeen();
    const near = this.boxGrid.query(ahead.x - 0.7, ahead.x + 0.7, ahead.z - 0.7, ahead.z + 0.7, this._boxScratch);
    for (const b of near) {
      if (ahead.x > b.min.x - 0.7 && ahead.x < b.max.x + 0.7 &&
          ahead.z > b.min.z - 0.7 && ahead.z < b.max.z + 0.7 &&
          pos.y + 0.5 > b.min.y && pos.y - 0.5 < b.max.y) return true;
    }
    return false;
  }

  /** Scratch buffer reused by per-frame grid queries (avoids allocation). */
  private _boxScratch: Box[] = [];

  // Steering with obstacle avoidance + ally separation
  private steerAndMove(s: Soldier, desired: THREE.Vector3, speed: number, dt: number) {
    if (desired.lengthSq() < 0.0001) {
      // Decay smoothed movement toward rest so "holding still" registers as
      // stationary for the stop-and-shoot accuracy bonus.
      s.moveDir.x += (0 - s.moveDir.x) * Math.min(1, dt * 8);
      s.moveDir.z += (0 - s.moveDir.z) * Math.min(1, dt * 8);
      return;
    }
    desired = desired.clone().setY(0).normalize();

    // Obstacle whisker: probe forward and adjust
    const original = desired.clone();
    const probe = desired.clone().multiplyScalar(2.8);
    const ahead = s.pos.clone().add(probe);
    let blocked = false;
    this.boxGrid.ensureSeen();
    const nearAhead = this.boxGrid.query(ahead.x - 0.6, ahead.x + 0.6, ahead.z - 0.6, ahead.z + 0.6, this._boxScratch);
    for (const b of nearAhead) {
      if (ahead.x > b.min.x - 0.6 && ahead.x < b.max.x + 0.6 &&
          ahead.z > b.min.z - 0.6 && ahead.z < b.max.z + 0.6 &&
          s.pos.y + 0.5 > b.min.y && s.pos.y - 0.5 < b.max.y) {
        blocked = true;
        break;
      }
    }
    if (blocked) {
      const candidates = [Math.PI / 2, -Math.PI / 2, Math.PI / 3, -Math.PI / 3, Math.PI].map((ang) => {
        const c = Math.cos(ang * s.flankDir), si = Math.sin(ang * s.flankDir);
        return new THREE.Vector3(original.x * c - original.z * si, 0, original.x * si + original.z * c).normalize();
      });
      desired.copy(candidates.find((dir) => !this.isMoveBlocked(s.pos, dir, 2.2)) ?? original.multiplyScalar(-1));
    }

    // Ally separation — accumulate into plain scalars to avoid a per-call
    // Vector3 allocation (this runs for every soldier every frame).
    let sepX = 0;
    let sepZ = 0;
    let count = 0;
    for (const o of this.state.soldiers) {
      if (!o.alive || o.id === s.id || o.team !== s.team) continue;
      const dx = s.pos.x - o.pos.x;
      const dz = s.pos.z - o.pos.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < 9 && d2 > 0.0001) {
        const inv = 1 / Math.sqrt(d2);
        sepX += dx * inv;
        sepZ += dz * inv;
        count++;
      }
    }
    if (count > 0) {
      desired.x += sepX * 0.4;
      desired.z += sepZ * 0.4;
      const l = Math.hypot(desired.x, desired.z);
      if (l > 0.0001) { desired.x /= l; desired.z /= l; }
    }
    if (desired.dot(original) < -0.25 && !blocked) desired.copy(original);

    // Smoothing
    s.moveDir.x += (desired.x - s.moveDir.x) * Math.min(1, dt * 6);
    s.moveDir.z += (desired.z - s.moveDir.z) * Math.min(1, dt * 6);

    // Cap per-frame movement to prevent teleport-like jumps from collision resolution
    const maxStep = speed * dt * 1.5 + 0.1;
    const newPos = s.pos.clone();
    newPos.x += s.moveDir.x * speed * dt;
    newPos.z += s.moveDir.z * speed * dt;
    newPos.y = terrainHeightAt(this.world, newPos.x, newPos.z) + SOLDIER_HEIGHT;
    resolvePlayerCollision(newPos, SOLDIER_RADIUS, SOLDIER_HEIGHT, this.boxGrid);
    // If collision resolution pushed soldier too far, clamp the displacement
    const dx = newPos.x - s.pos.x;
    const dz = newPos.z - s.pos.z;
    const stepLen = Math.hypot(dx, dz);
    if (stepLen > maxStep) {
      const k = maxStep / stepLen;
      newPos.x = s.pos.x + dx * k;
      newPos.z = s.pos.z + dz * k;
      newPos.y = terrainHeightAt(this.world, newPos.x, newPos.z) + SOLDIER_HEIGHT;
    }
    const lim = WORLD_SIZE / 2 - 2;
    newPos.x = Math.max(-lim, Math.min(lim, newPos.x));
    newPos.z = Math.max(-lim, Math.min(lim, newPos.z));

    // Locomotion animation: derive the actual horizontal speed achieved this
    // frame and advance the gait phase proportionally so legs/arms swing faster
    // when running. moveSpeedNorm: 1 ≈ walk (MOVE_SPEED), ~1.4+ ≈ sprint.
    const actualDist = Math.hypot(newPos.x - s.pos.x, newPos.z - s.pos.z);
    const actualSpeed = dt > 0 ? actualDist / dt : 0;
    const norm = actualSpeed / MOVE_SPEED;
    s.moveSpeedNorm += (norm - s.moveSpeedNorm) * Math.min(1, dt * 10);
    // Stride frequency grows with speed (so a sprint looks like a run).
    s.animPhase += dt * (6 + s.moveSpeedNorm * 7);

    s.pos.copy(newPos);
  }

  private aiThrowGrenade(s: Soldier, targetPos: THREE.Vector3) {
    const dir = new THREE.Vector3().subVectors(targetPos, s.pos);
    dir.y = 0;
    const horizDist = dir.length();
    if (horizDist < 0.1) return;
    dir.normalize();
    // Ballistic toss
    const speed = Math.min(22, 10 + horizDist * 0.6);
    const vel = dir.multiplyScalar(speed);
    vel.y = 5 + horizDist * 0.05;
    const origin = s.pos.clone().add(new THREE.Vector3(0, 1.4, 0)).add(vel.clone().setY(0).normalize().multiplyScalar(0.6));
    this.state.grenades.push({
      id: this.state.nextGrenadeId++,
      pos: origin,
      vel,
      fuse: GRENADE_FUSE,
      team: s.team,
      isSmoke: false,
    });
  }

  private aiThrowSmoke(s: Soldier, threatPos: THREE.Vector3) {
    const away = new THREE.Vector3().subVectors(s.pos, threatPos);
    away.y = 0;
    if (away.lengthSq() < 0.01) away.set(Math.random() - 0.5, 0, Math.random() - 0.5);
    away.normalize();
    const side = new THREE.Vector3(-away.z, 0, away.x).multiplyScalar(s.flankDir * 0.8);
    const dir = away.add(side).normalize();
    const vel = dir.multiplyScalar(11 + Math.random() * 4);
    vel.y = 3.8;
    this.state.grenades.push({
      id: this.state.nextGrenadeId++,
      pos: s.pos.clone().add(new THREE.Vector3(0, 1.2, 0)).addScaledVector(dir, 0.5),
      vel,
      fuse: GRENADE_FUSE * 0.7,
      team: s.team,
      isSmoke: true,
    });
  }

  private soldierShoot(s: Soldier, target: { pos: THREE.Vector3; vel?: THREE.Vector3; isPlayer: boolean; id: number; dist?: number }, dirToT: THREE.Vector3, time: number) {
    const dist = target.dist ?? s.pos.distanceTo(target.pos);
    // Distance-based and class-based hit chance
    const baseHit = s.soldierClass === "sniper" ? 0.94
      : s.soldierClass === "support" ? 0.66
      : s.soldierClass === "assault" ? 0.80
      : 0.72;
    // Falloff with distance (sniper falls off less)
    const falloffStart = s.soldierClass === "sniper" ? 50 : 20;
    const falloffEnd = s.soldierClass === "sniper" ? 100 : 55;
    const falloff = THREE.MathUtils.clamp((dist - falloffStart) / (falloffEnd - falloffStart), 0, 1);
    const distMult = 1 - falloff * 0.55;
    // Movement penalty: if shooter just moved fast, accuracy down. Holding
    // still (cover / suppress) gives a marked stop-and-shoot accuracy bonus.
    const moveSpeed = Math.hypot(s.moveDir.x, s.moveDir.z);
    const shooterMoving = moveSpeed > 0.5 ? 0.8 : (moveSpeed < 0.12 ? 1.12 : 1.0);
    // Target moving penalty
    const tMove = target.vel ? Math.hypot(target.vel.x, target.vel.z) : 0;
    const tgtMoving = tMove > 4 ? 0.8 : 1.0;
    // Alertness improves accuracy
    const alertMult = 0.92 + s.alertness * 0.32;
    const hitChance = baseHit * distMult * shooterMoving * tgtMoving * alertMult;

    const hit = Math.random() < hitChance;
    if (hit) {
      const baseDmg = s.soldierClass === "sniper" ? 42
        : s.soldierClass === "support" ? 9
        : s.soldierClass === "assault" ? 15
        : 11;
      // Headshot chance (low)
      const isHead = Math.random() < (s.soldierClass === "sniper" ? 0.32 : 0.12);
      const dmg = (baseDmg + Math.random() * 5) * (isHead ? 2.2 : 1);
      if (target.isPlayer) {
        // 搭乗中 (航空機・地上車両) は機体/車体に守られているため、
        // 小火器のダメージは無効化する。これが「航空機に乗ると勝手に
        // ダメージを受ける」バグの主因だった。
        if (this.playerIsMounted()) return;
        this.state.player.hp -= dmg;
        this.state.player.lastDamagedAt = time;
        this.state.damageFlash = Math.min(0.7, 0.35 + dmg * 0.01);
        this.state.shake = Math.min(0.5, this.state.shake + 0.1);
        soundEngine.playDamage();
      } else {
        const ot = this.state.soldiers.find((x) => x.id === target.id);
        if (ot && ot.alive) {
          ot.hp -= dmg;
          // Hit makes target more alert and reactive
          ot.alertness = Math.min(1, ot.alertness + 0.4);
          // Remember the shooter's direction as a threat
          if (!ot.lastSeenPos) ot.lastSeenPos = new THREE.Vector3();
          ot.lastSeenPos.copy(s.pos);
          ot.lastSeenAt = time;
          if (ot.hp <= 0) {
            ot.alive = false;
            if (ot.team === "blue") this.state.redScore += 1;
            else this.state.blueScore += 1;
            this.spawnRagdoll(ot);
          }
        }
      }
    }

    // Alert nearby allies to combat
    for (const ally of this.state.soldiers) {
      if (!ally.alive || ally.team !== s.team || ally.id === s.id) continue;
      if (ally.pos.distanceTo(s.pos) < 22) {
        ally.alertness = Math.min(1, ally.alertness + 0.15);
      }
    }

    const muz = s.pos.clone().add(new THREE.Vector3(0, 1.2, 0)).addScaledVector(dirToT, 0.4);
    this.state.flashes.push({ pos: muz, ttl: 0.06, color: s.team === "red" ? "#ffb060" : "#a0d8ff" });

    // Trail with realistic miss spread on miss
    const missSpread = hit ? 0.6 : 1.8 + (1 - distMult) * 2;
    const trailEnd = target.pos.clone().add(new THREE.Vector3(
      (Math.random() - 0.5) * missSpread,
      (Math.random() - 0.5) * missSpread * 0.6,
      (Math.random() - 0.5) * missSpread,
    ));
    this.state.trails.push({
      from: muz.clone(),
      to: trailEnd,
      ttl: 0.12,
      color: s.team === "red" ? "#ffb060" : "#a0d8ff",
    });

    const distToPlayer = s.pos.distanceTo(this.state.player.pos);
    if (distToPlayer < 60 && time - this.lastShotSound > 0.07) {
      this.lastShotSound = time;
      soundEngine.playShot(s.soldierClass === "sniper" ? "sniper" : s.soldierClass === "support" ? "smg" : "rifle");
    }
  }

  private lineOfSight(from: THREE.Vector3, to: THREE.Vector3) {
    _tmpV1.subVectors(to, from);
    const len = _tmpV1.length();
    _tmpV1.normalize();
    // Only test colliders whose cells the sight-line's XZ bounding box touches.
    this.boxGrid.ensureSeen();
    const near = this.boxGrid.query(
      Math.min(from.x, to.x), Math.max(from.x, to.x),
      Math.min(from.z, to.z), Math.max(from.z, to.z),
      this._boxScratch,
    );
    for (const b of near) {
      const t = rayBox(from, _tmpV1, b);
      if (t !== null && t < len) return false;
    }
    return true;
  }

  private updateProjectiles(dt: number, time: number) {
    for (const g of this.state.grenades) {
      g.vel.y -= GRAVITY * dt;
      const next = g.pos.clone().addScaledVector(g.vel, dt);
      if (next.y < 0.2) {
        next.y = 0.2;
        g.vel.y = -g.vel.y * 0.45;
        g.vel.x *= 0.6;
        g.vel.z *= 0.6;
      }
      for (const b of this.boxes) {
        if (
          next.x > b.min.x - 0.2 &&
          next.x < b.max.x + 0.2 &&
          next.z > b.min.z - 0.2 &&
          next.z < b.max.z + 0.2 &&
          next.y > b.min.y &&
          next.y < b.max.y + 0.2
        ) {
          const cx = (b.min.x + b.max.x) / 2;
          const cz = (b.min.z + b.max.z) / 2;
          if (Math.abs(next.x - cx) > Math.abs(next.z - cz)) g.vel.x = -g.vel.x * 0.4;
          else g.vel.z = -g.vel.z * 0.4;
          next.copy(g.pos);
        }
      }
      g.pos.copy(next);
      g.fuse -= dt;
    }
    const exploded = this.state.grenades.filter((g) => g.fuse <= 0);
    for (const g of exploded) {
      if (g.isSmoke) {
        this.state.smokeClouds.push({
          id: this.state.nextSmokeId++,
          pos: g.pos.clone(),
          age: 0,
          ttl: SMOKE_DURATION,
          radius: SMOKE_RADIUS,
        });
      } else {
        this.explode(g.pos, time, g.team);
      }
    }
    this.state.grenades = this.state.grenades.filter((g) => g.fuse > 0);
  }

  private updateSmokeClouds(dt: number) {
    for (const sc of this.state.smokeClouds) {
      sc.age += dt;
    }
    this.state.smokeClouds = this.state.smokeClouds.filter((sc) => sc.age < sc.ttl);
  }

  private updateRagdolls(dt: number) {
    for (const r of this.state.ragdolls) {
      r.vel.y -= GRAVITY * dt;
      r.pos.addScaledVector(r.vel, dt);
      r.rot.x += r.vel.x * dt * 2;
      r.rot.z += r.vel.z * dt * 2;
      if (r.pos.y < r.size.y / 2) {
        r.pos.y = r.size.y / 2;
        r.vel.y = -r.vel.y * 0.3;
        r.vel.x *= 0.8;
        r.vel.z *= 0.8;
      }
      r.ttl -= dt;
    }
    this.state.ragdolls = this.state.ragdolls.filter((r) => r.ttl > 0);
  }

  // === AIRCRAFT ============================================================
  // Spawn the friendly air wing onto the runway: two fighters + one attacker,
  // parked (onGround) on the three runway spawn slots, ready to taxi & launch.
  private spawnAircraft() {
    const spawns = this.world.runwaySpawns ?? [];
    for (let i = 0; i < spawns.length; i++) {
      const sp = spawns[i];
      const kind = i === 2 ? "attacker" : "fighter";
      const hpMax = kind === "attacker" ? AIRCRAFT_HP_ATTACKER : AIRCRAFT_HP_FIGHTER;
      const ac: Aircraft = {
        id: this.state.nextAircraftId++,
        kind,
        team: "blue",
        pos: sp.pos.clone(),
        vel: new THREE.Vector3(),
        yaw: sp.yaw,
        pitch: 0,
        roll: 0,
        hp: hpMax,
        hpMax,
        alive: true,
        onGround: true,
        throttle: 0,
        lastGunAt: -10,
        gunAmmo: 500,
        gunAmmoMax: 500,
        bombCount: kind === "attacker" ? 4 : 0,
        bombMax: 4,
        lastBombAt: -10,
        aiState: "taxiing",
        aiTargetPos: null,
        aiTargetSoldierId: null,
        // AI機は絶対に自動離陸しない。タイマーを大きな値 (999) で初期化して
        // taxiing→takeoff へ遷移しないようにし、滑走路南端で静止待機させる。
        aiTimer: 999,
        engineSmoke: false,
        pitchInput: 0,
        rollInput: 0,
        aoa: 0,
        stalling: false,
        gForce: 1,
        airbrake: false,
        gearDown: true,   // 地上待機中は脚を出している
      };
      this.state.aircraft.push(ac);
    }
  }

  // Per-frame flight, AI and weapon update for every (AI controlled) aircraft.
  private updateAircraft(dt: number, time: number) {
    for (const ac of this.state.aircraft) {
      // 1. The player-piloted plane is driven elsewhere; skip it here.
      if (this.state.playerInAircraft === ac.id) continue;
      if (!ac.alive) continue;

      ac.aiTimer -= dt;

      // Simple gun reload: top the magazine back up a few seconds after it runs dry.
      if (ac.gunAmmo <= 0 && time - ac.lastGunAt > AIRCRAFT_GUN_RELOAD) {
        ac.gunAmmo = ac.gunAmmoMax;
      }

      // Smoke trail once badly damaged.
      ac.engineSmoke = ac.hp < ac.hpMax * 0.4;

      // 4. Grounded aircraft: AI機は絶対に自動離陸しない。
      //    滑走路南端で静止待機し、プレイヤーが搭乗した機体だけが飛ぶ。
      if (ac.onGround) {
        // 地上では絶対に動かない: スロットルと速度を毎フレーム 0 に固定する。
        ac.throttle = 0;
        ac.vel.set(0, 0, 0);
        // 撃墜・着陸後の機体のみ、AIRCRAFT_RESPAWN_DELAY 経過で元位置へ戻す。
        if (ac.aiState === "landing" && ac.aiTimer <= 0) {
          this.resetAircraftToRunway(ac);
        }
        continue;
      }

      // 3. Airborne AI機: これはプレイヤーが空中で脱出した機体だけが該当する。
      //    AI 戦術行動 (updateAircraftAI) は呼ばず、動力なしで滑空降下させる。
      // 3a. 動力なし: 空気抵抗で水平速度を徐々に減衰させる。
      ac.throttle = 0;
      ac.vel.x *= Math.pow(0.5, dt);
      ac.vel.z *= Math.pow(0.5, dt);

      // 3b. 重力で降下する。
      ac.vel.y -= AIRCRAFT_GRAVITY * dt;

      // 3c. Integrate position.
      ac.pos.addScaledVector(ac.vel, dt);

      // 機首を徐々に下げ、ロールも中立へ戻す (操縦者不在の挙動)。
      ac.pitch = Math.max(-0.6, ac.pitch - dt * 0.3);
      ac.roll = THREE.MathUtils.clamp(ac.roll * 0.9, -1, 1);

      // 3d. 地面に触れたら着陸扱い: onGround=true, aiState="landing",
      //     aiTimer=AIRCRAFT_RESPAWN_DELAY をセットしてリスポーン待ちにする。
      if (ac.pos.y <= 0.5) {
        ac.pos.y = 0.5;
        ac.onGround = true;
        ac.alive = true;
        ac.vel.set(0, 0, 0);
        ac.pitch = 0;
        ac.roll = 0;
        ac.throttle = 0;
        ac.aiState = "landing";
        ac.aiTimer = AIRCRAFT_RESPAWN_DELAY;
      }
    }
  }

  // Airborne decision making: pick a patrol altitude, hunt enemy soldiers,
  // dive to strafe with guns, or (attackers) drop bombs on a target.
  private updateAircraftAI(ac: Aircraft, dt: number, time: number) {
    // Acquire / refresh a ground target every couple of seconds.
    if (ac.aiTimer <= 0) {
      const target = this.findAircraftTarget(ac);
      if (target) {
        ac.aiTargetSoldierId = target.id;
        ac.aiTargetPos = target.pos.clone();
        ac.aiState = ac.kind === "attacker" && ac.bombCount > 0 ? "strafe" : "attack";
      } else {
        ac.aiTargetSoldierId = null;
        ac.aiState = "patrol";
      }
      ac.aiTimer = 2 + Math.random() * 2;
    }

    if (ac.aiState === "patrol") {
      // Cruise at a random comfortable altitude (80–250m), gentle turns.
      const wantY = 80 + ((ac.id * 53) % 170);
      ac.pitch += (THREE.MathUtils.clamp((wantY - ac.pos.y) * 0.01, -0.4, 0.4) - ac.pitch) * Math.min(1, dt * 2);
      ac.throttle = 0.85;
      // Lazy wandering turn.
      ac.yaw += Math.sin(time * 0.2 + ac.id) * dt * 0.2;
    } else if (ac.aiState === "attack" || ac.aiState === "strafe") {
      const tgt = ac.aiTargetSoldierId != null ? this.state.soldiers.find((s) => s.id === ac.aiTargetSoldierId && s.alive) : undefined;
      if (!tgt) {
        ac.aiState = "patrol";
        ac.aiTimer = 0;
      } else {
        // Aim the nose at the target: yaw toward it, dive at it.
        const toYaw = Math.atan2(tgt.pos.x - ac.pos.x, tgt.pos.z - ac.pos.z);
        ac.yaw += this.angleTowards(ac.yaw, toYaw) * Math.min(1, dt * 2);
        const dx = tgt.pos.x - ac.pos.x;
        const dz = tgt.pos.z - ac.pos.z;
        const horiz = Math.hypot(dx, dz);
        const wantPitch = Math.atan2(tgt.pos.y - ac.pos.y, Math.max(1, horiz));
        ac.pitch += (THREE.MathUtils.clamp(wantPitch, -0.7, 0.5) - ac.pitch) * Math.min(1, dt * 2);
        ac.throttle = 1;
        ac.roll = THREE.MathUtils.clamp(this.angleTowards(ac.yaw, toYaw) * 4, -1, 1);

        if (ac.aiState === "attack") {
          this.attackWithGun(ac, time);
        } else {
          // Attacker: release a bomb when roughly overhead and reasonably low.
          if (ac.bombCount > 0 && horiz < 60 && ac.pos.y < 160 && time - ac.lastBombAt > 1.2) {
            this.dropBomb(ac);
          }
          // Also strafe with guns on the run-in.
          this.attackWithGun(ac, time);
          if (ac.bombCount <= 0) ac.aiState = "attack";
        }

        // Don't fly into the deck while diving: pull up if too low.
        if (ac.pos.y < 40) ac.pitch = Math.max(ac.pitch, 0.15);
      }
    }
  }

  // Find the nearest living enemy (red) soldier for an aircraft to engage.
  private findAircraftTarget(ac: Aircraft): Soldier | null {
    let best: Soldier | null = null;
    let bestD = Infinity;
    const enemyTeam: Team = ac.team === "blue" ? "red" : "blue";
    for (const s of this.state.soldiers) {
      if (!s.alive || s.team !== enemyTeam) continue;
      const d = s.pos.distanceTo(ac.pos);
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    return best;
  }

  // Fire the nose machine gun at the current target if in range & off cooldown.
  private attackWithGun(ac: Aircraft, time: number) {
    if (ac.gunAmmo <= 0) return;
    const tgt = ac.aiTargetSoldierId != null ? this.state.soldiers.find((s) => s.id === ac.aiTargetSoldierId && s.alive) : undefined;
    if (!tgt) return;
    const dist = tgt.pos.distanceTo(ac.pos);
    if (dist > AIRCRAFT_GUN_RANGE) return;
    const interval = 60 / AIRCRAFT_GUN_RPM;
    if (time - ac.lastGunAt < interval) return;

    ac.lastGunAt = time;
    ac.gunAmmo -= 1;

    // Tracer from the nose to the target.
    const from = ac.pos.clone();
    const to = tgt.pos.clone();
    this.state.aircraftGunTrails.push({ from, to, ttl: 0.08 });

    // Apply damage with some spread/variance.
    const dmg = AIRCRAFT_GUN_DAMAGE * (0.7 + Math.random() * 0.6);
    tgt.hp -= dmg;
    if (ac.team === "blue") this.state.score += 50;
    if (tgt.hp <= 0 && tgt.alive) {
      tgt.alive = false;
      if (ac.team === "blue" && tgt.team === "red") {
        this.state.kills += 1;
        this.state.score += 120;
        this.state.blueScore += 1;
      } else if (tgt.team === "blue") {
        this.state.redScore += 1;
      }
      this.spawnRagdoll(tgt);
    }
  }

  // Release a free-falling bomb that keeps the plane's forward inertia.
  private dropBomb(ac: Aircraft) {
    if (ac.bombCount <= 0) return;
    const vel = ac.vel.clone();
    vel.y -= 5; // small downward kick at release
    this.state.aircraftBombs.push({
      id: this.state.nextAircraftBombId++,
      pos: ac.pos.clone(),
      vel,
      team: ac.team,
      exploded: false,
      fromAircraftId: ac.id,
    });
    ac.bombCount -= 1;
    ac.lastBombAt = performance.now() / 1000;
  }

  // Integrate dropped bombs under gravity and detonate them on impact.
  private updateAircraftBombs(dt: number, time: number) {
    for (const b of this.state.aircraftBombs) {
      if (b.exploded) continue;
      b.vel.y -= AIRCRAFT_GRAVITY * dt;
      b.pos.addScaledVector(b.vel, dt);
      if (b.pos.y <= 0.2) {
        b.pos.y = 0.2;
        b.exploded = true;
        this.aircraftExplode(b.pos, time, b.team, AIRCRAFT_BOMB_RADIUS, AIRCRAFT_BOMB_DAMAGE);
      }
    }
    this.state.aircraftBombs = this.state.aircraftBombs.filter((b) => !b.exploded);
  }

  // Parametrised explosion used by aircraft bombs (larger radius/damage than a
  // hand grenade). Mirrors explode() but with caller-supplied radius & damage.
  private aircraftExplode(pos: THREE.Vector3, time: number, team: Team, radius: number, damage: number) {
    this.state.explosions.push({ pos: pos.clone(), age: 0, ttl: 0.9 });
    this.state.shake = Math.min(0.9, this.state.shake + 0.45);
    soundEngine.playExplosion();
    for (const e of this.state.soldiers) {
      if (!e.alive) continue;
      const d = e.pos.distanceTo(pos);
      if (d < radius) {
        const fall = 1 - d / radius;
        e.hp -= damage * fall;
        if (e.hp <= 0 && e.alive) {
          e.alive = false;
          if (team === "blue" && e.team === "red") {
            this.state.kills += 1;
            this.state.score += 120;
            this.state.blueScore += 1;
          } else if (e.team === "blue") {
            this.state.redScore += 1;
          }
          this.spawnRagdoll(e);
        }
      }
    }
    for (const d of this.state.destructibles) {
      if (d.destroyed) continue;
      const dist = d.pos.distanceTo(pos);
      if (dist < radius) {
        d.hp -= 120 * (1 - dist / radius);
        if (d.hp <= 0) {
          d.destroyed = true;
          this.spawnDebris(d);
        }
      }
    }
    const pd = this.state.player.pos.distanceTo(pos);
    if (pd < radius && !this.playerIsMounted()) {
      const fall = 1 - pd / radius;
      this.state.player.hp -= damage * 0.5 * fall;
      this.state.player.lastDamagedAt = time;
      this.state.damageFlash = 0.7;
      soundEngine.playDamage();
    }
  }

  // Recycle a landed/destroyed aircraft back onto its runway slot, rearmed.
  private resetAircraftToRunway(ac: Aircraft) {
    const spawns = this.world.runwaySpawns ?? [];
    if (spawns.length === 0) return;
    // Keep the plane on its original slot (id-1 maps to spawn index).
    const sp = spawns[(ac.id - 1) % spawns.length];
    ac.pos.copy(sp.pos);
    ac.yaw = sp.yaw;
    ac.vel.set(0, 0, 0);
    ac.pitch = 0;
    ac.roll = 0;
    ac.hp = ac.hpMax;
    ac.alive = true;
    ac.onGround = true;
    ac.throttle = 0;
    ac.gunAmmo = ac.gunAmmoMax;
    ac.bombCount = ac.bombMax > 0 && ac.kind === "attacker" ? ac.bombMax : 0;
    ac.engineSmoke = false;
    ac.aiState = "taxiing";
    ac.aiTargetSoldierId = null;
    ac.aiTargetPos = null;
    // リスポーン後も自動離陸しない: タイマーを 999 にして taxiing→takeoff へ
    // 遷移させず、滑走路南端で再び静止待機させる。
    ac.aiTimer = 999;
    ac.pitchInput = 0;
    ac.rollInput = 0;
    ac.aoa = 0;
    ac.stalling = false;
    ac.gForce = 1;
  }

  // Smallest signed angle delta to rotate `from` toward `to` (radians).
  private angleTowards(from: number, to: number): number {
    let d = to - from;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return d;
  }

  private explode(pos: THREE.Vector3, time: number, throwerTeam: Team) {
    this.state.explosions.push({ pos: pos.clone(), age: 0, ttl: 0.7 });
    this.state.shake = Math.min(0.7, this.state.shake + 0.3);
    soundEngine.playExplosion();
    for (const e of this.state.soldiers) {
      if (!e.alive) continue;
      const d = e.pos.distanceTo(pos);
      if (d < GRENADE_RADIUS) {
        const fall = 1 - d / GRENADE_RADIUS;
        const dmg = WEAPONS.grenade.damage * fall;
        e.hp -= dmg;
        if (e.hp <= 0 && e.alive) {
          e.alive = false;
          if (throwerTeam === "blue" && e.team === "red") {
            this.state.kills += 1;
            this.state.score += 120;
            this.state.blueScore += 1;
          } else if (e.team === "blue") this.state.redScore += 1;
          this.spawnRagdoll(e);
        }
      }
    }
    for (const d of this.state.destructibles) {
      if (d.destroyed) continue;
      const dist = d.pos.distanceTo(pos);
      if (dist < GRENADE_RADIUS) {
        d.hp -= 80 * (1 - dist / GRENADE_RADIUS);
        if (d.hp <= 0) {
          d.destroyed = true;
          this.spawnDebris(d);
        }
      }
    }
    const pd = this.state.player.pos.distanceTo(pos);
    if (pd < GRENADE_RADIUS && !this.playerIsMounted()) {
      const fall = 1 - pd / GRENADE_RADIUS;
      const dmg = 60 * fall;
      this.state.player.hp -= dmg;
      this.state.player.lastDamagedAt = time;
      this.state.damageFlash = 0.6;
      soundEngine.playDamage();
    }
  }

  private updateEffects(dt: number) {
    for (const f of this.state.flashes) f.ttl -= dt;
    this.state.flashes = this.state.flashes.filter((f) => f.ttl > 0);
    for (const h of this.state.hits) h.ttl -= dt;
    this.state.hits = this.state.hits.filter((h) => h.ttl > 0);
    for (const t of this.state.trails) t.ttl -= dt;
    this.state.trails = this.state.trails.filter((t) => t.ttl > 0);
    for (const gt of this.state.aircraftGunTrails) gt.ttl -= dt;
    this.state.aircraftGunTrails = this.state.aircraftGunTrails.filter((gt) => gt.ttl > 0);
    for (const e of this.state.explosions) e.age += dt;
    this.state.explosions = this.state.explosions.filter((e) => e.age < e.ttl);
    for (const d of this.state.damageNumbers) {
      d.ttl -= dt;
      d.pos.y += dt * 0.8;
    }
    this.state.damageNumbers = this.state.damageNumbers.filter((d) => d.ttl > 0);
    if (this.state.hitMarker > 0) this.state.hitMarker -= dt;
    if (this.state.headshotMarker > 0) this.state.headshotMarker -= dt;
    if (this.state.damageFlash > 0) this.state.damageFlash -= dt;
    if (this.state.shake > 0) this.state.shake = Math.max(0, this.state.shake - dt * 1.2);
  }

  private updateMatch() {
    if (this.state.score >= this.state.scoreLimit) {
      this.state.status = "won";
      document.exitPointerLock?.();
    } else if (this.state.redScore >= this.state.scoreLimit) {
      this.state.status = "lost";
      document.exitPointerLock?.();
    }
  }
}
