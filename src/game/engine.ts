import * as THREE from "three";
import { GameState, store } from "./store";
import type { World } from "./world";
import { Box, worldToBoxes, rayBox, resolvePlayerCollision, WORLD_SIZE, terrainHeightAt } from "./world";
import { GRENADE_FUSE, GRENADE_RADIUS, SMOKE_DURATION, SMOKE_RADIUS, WEAPONS, makeWeaponState } from "./weapons";
import { Soldier, Pickup, WeaponId, Team, DestructibleObject, RagdollPart, SmokeCloud, CapturePoint, Vehicle, SoldierClass } from "./types";
import { CLASSES } from "./classes";
import { soundEngine } from "./sound";
import { NetManager } from "@/net/net";

const PLAYER_RADIUS = 0.4;
const PLAYER_HEIGHT = 1.7;
const EYE_HEIGHT = 1.65;
const GRAVITY = 22;
const MOVE_SPEED = 7.0;
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

// Reusable temp vectors to reduce allocations in hot paths
const _tmpV1 = new THREE.Vector3();
const _tmpV2 = new THREE.Vector3();
const _tmpV3 = new THREE.Vector3();

export class GameEngine {
  state: GameState;
  world: World;
  boxes: Box[];
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
    vehicleGas?: boolean;
    vehicleBrake?: boolean;
  };
  shootHeld = false;
  private footstepTimer = 0;
  private lastShotSound = 0;
  private lastHitSound = 0;
  private emitTimer = 0;

  constructor(state: GameState, input: GameEngine["input"], world: World) {
    this.state = state;
    this.input = input;
    this.world = world;
    this.boxes = worldToBoxes(this.world);
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

  private spawnVehicles() {
    const half = WORLD_SIZE / 2;
    const spawns = [
      { x: -30, z: half - 35, kind: "jeep" as const },
      { x: 30, z: half - 35, kind: "jeep" as const },
      { x: -30, z: -half + 35, kind: "jeep" as const },
      { x: 30, z: -half + 35, kind: "jeep" as const },
    ];
    let vid = 1;
    for (const sp of spawns) {
      this.state.vehicles.push({
        id: vid++,
        pos: new THREE.Vector3(sp.x, 0.5, sp.z),
        vel: new THREE.Vector3(),
        yaw: 0,
        hp: 300,
        hpMax: 300,
        kind: sp.kind,
        speed: 32,
        team: null,
        destroyed: false,
      });
    }
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

    const playerSpawn = this.findSpawnNear(0, WORLD_SIZE / 2 - 30, 30);
    this.state.player.pos.copy(playerSpawn);

    // Init sound for everyone
    soundEngine.init();

    // CLIENT mode: don't spawn soldiers/capture/vehicles/pickups — host owns them and broadcasts state.
    if (NetManager.mode === "client") {
      this.state.pickups = [];
      this.state.capturePoints = [];
      this.state.vehicles = [];
      return;
    }

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
      if (!inside && Math.abs(x) < WORLD_SIZE / 2 - 5 && Math.abs(z) < WORLD_SIZE / 2 - 5) {
        return new THREE.Vector3(x, terrainHeightAt(this.world, x, z) + EYE_HEIGHT, z);
      }
    }
    return new THREE.Vector3(cx, terrainHeightAt(this.world, cx, cz) + EYE_HEIGHT, cz);
  }

  spawnSoldier(team: Team, soldierClass?: SoldierClass) {
    const cls = soldierClass || (["assault", "sniper", "support", "medic"] as SoldierClass[])[Math.floor(Math.random() * 4)];
    const classSpec = CLASSES[cls];
    const baseZ = team === "blue" ? WORLD_SIZE / 2 - 25 : -WORLD_SIZE / 2 + 25;
    const baseX = (Math.random() - 0.5) * 60;
    const spawn = this.findSpawnNear(baseX, baseZ, 25);
    const s: Soldier = {
      id: this.state.nextSoldierId++,
      team,
      pos: new THREE.Vector3(spawn.x, terrainHeightAt(this.world, spawn.x, spawn.z) + SOLDIER_HEIGHT, spawn.z),
      vel: new THREE.Vector3(),
      hp: classSpec.hpMax,
      hpMax: classSpec.hpMax,
      alive: true,
      lastShotAt: 0,
      state: "patrol",
      patrolTarget: new THREE.Vector3(spawn.x, 0, spawn.z),
      yaw: team === "blue" ? Math.PI : 0,
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
      desiredYaw: team === "blue" ? Math.PI : 0,
      moveDir: new THREE.Vector3(),
      lastThreatDir: null,
      stuckTimer: 0,
      lastPosCheck: new THREE.Vector3(spawn.x, SOLDIER_HEIGHT, spawn.z),
      squadOffset: new THREE.Vector3((Math.random() - 0.5) * 7, 0, (Math.random() - 0.5) * 7),
    };
    this.state.soldiers.push(s);
  }

  update(dt: number, time: number) {
    if (this.state.status !== "playing") return;

    // CLIENT mode: skip simulation; just handle local input + camera + local hitscan + send input.
    if (NetManager.mode === "client") {
      this.handleInput(dt, time);
      if (this.state.playerInVehicle) {
        this.updatePlayerVehicle(dt);
      } else {
        this.updatePlayer(dt);
      }
      this.updateEffects(dt);
      // Send input ~20Hz
      NetManager.clientSendInput(this.state, dt, this.input.mouse.left, false);
      this.emitTimer += dt;
      if (this.emitTimer > 0.05) {
        this.emitTimer = 0;
        store.emit();
      }
      return;
    }

    this.handleInput(dt, time);
    if (this.state.playerInVehicle) {
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
    this.updateMatch();

    // Medic heal aura
    this.updateMedicHeal(dt, time);

    // HOST mode: apply remote inputs + broadcast snapshot
    if (NetManager.mode === "host") {
      NetManager.applyRemoteInputs(this.state, dt, time);
      NetManager.hostBroadcast(this.state, dt, time);
    }

    this.emitTimer += dt;
    if (this.emitTimer > 0.05) {
      this.emitTimer = 0;
      store.emit();
    }
  }

  private updateMedicHeal(dt: number, _time: number) {
    // Medic class heals nearby allies
    for (const s of this.state.soldiers) {
      if (!s.alive || s.soldierClass !== "medic") continue;
      for (const ally of this.state.soldiers) {
        if (!ally.alive || ally.team !== s.team || ally.id === s.id) continue;
        if (ally.hp >= ally.hpMax) continue;
        const d = s.pos.distanceTo(ally.pos);
        if (d < 8) {
          ally.hp = Math.min(ally.hpMax, ally.hp + 5 * dt);
        }
      }
      // Heal player if same team
      if (s.team === "blue") {
        const d = s.pos.distanceTo(this.state.player.pos);
        if (d < 8 && this.state.player.hp < this.state.player.hpMax) {
          this.state.player.hp = Math.min(this.state.player.hpMax, this.state.player.hp + 5 * dt);
        }
      }
    }
    // Player medic heals nearby blue soldiers
    if (this.state.loadout.soldierClass === "medic") {
      for (const s of this.state.soldiers) {
        if (!s.alive || s.team !== "blue") continue;
        if (s.hp >= s.hpMax) continue;
        const d = s.pos.distanceTo(this.state.player.pos);
        if (d < 8) {
          s.hp = Math.min(s.hpMax, s.hp + 8 * dt);
        }
      }
    }
  }

  private handleInput(dt: number, time: number) {
    const p = this.state.player;
    const w = this.state.weapons[this.state.currentWeapon];

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
        this.state.player.pos.set(v.pos.x + 3, EYE_HEIGHT, v.pos.z);
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
    soundEngine.playVehicleEnter();
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

    // Nearby vehicle
    let nearVehicle: Vehicle | null = null;
    let minVD = VEHICLE_ENTER_RANGE;
    for (const v of this.state.vehicles) {
      if (v.destroyed) continue;
      const d = Math.hypot(v.pos.x - pp.x, v.pos.z - pp.z);
      if (d < minVD) {
        minVD = d;
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
      const half = v.kind === "jeep" ? new THREE.Vector3(1.2, 0.8, 2.0) : new THREE.Vector3(1.5, 1.0, 2.5);
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
      if (NetManager.mode === "client") {
        // Don't apply damage locally — report to host
        NetManager.clientReportHit({ targetId: hitSoldier.id, damage: dmg, head: isHead, weapon: muzzleColor });
      } else {
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
    resolvePlayerCollision(p.pos, PLAYER_RADIUS, PLAYER_HEIGHT, this.boxes);

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
    // Steer vehicle with WASD or touch controls
    let accel = 0;
    let steer = 0;

    // Keyboard input
    if (this.input.keys.has("KeyW")) accel = 1;
    if (this.input.keys.has("KeyS")) accel = -0.6;
    if (this.input.keys.has("KeyA")) steer = 1.5;
    if (this.input.keys.has("KeyD")) steer = -1.5;

    // Touch input: joystick for steering, gas/brake buttons for throttle
    const tm = this.input.touchMove;
    if (tm) {
      // Touch: left stick X for steering
      if (Math.abs(tm.x) > 0.1) steer = -tm.x * 2.0;
      // Touch: gas/brake buttons override stick Y
      if (this.input.vehicleGas) {
        accel = 1;
      } else if (this.input.vehicleBrake) {
        accel = -0.6;
      } else if (Math.abs(tm.y) > 0.1) {
        // Fallback: stick Y for gas/brake if buttons not used
        accel = tm.y > 0 ? 1 : -0.6;
      }
    }

    const spd = Math.hypot(v.vel.x, v.vel.z);
    v.yaw += steer * dt * Math.min(1, spd / 3);
    const fwd = new THREE.Vector3(-Math.sin(v.yaw), 0, -Math.cos(v.yaw));
    v.vel.addScaledVector(fwd, accel * v.speed * dt);
    v.vel.multiplyScalar(1 - 2.5 * dt); // friction
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
        v.pos.x += (dx / d) * (vRadius - d);
        v.pos.z += (dz / d) * (vRadius - d);
        // Bounce velocity
        v.vel.x *= -0.3;
        v.vel.z *= -0.3;
      }
    }

    const lim = WORLD_SIZE / 2 - 5;
    v.pos.x = Math.max(-lim, Math.min(lim, v.pos.x));
    v.pos.z = Math.max(-lim, Math.min(lim, v.pos.z));
    v.pos.y = terrainHeightAt(this.world, v.pos.x, v.pos.z) + 0.5;

    // Player rides vehicle
    p.pos.set(v.pos.x, v.pos.y + 1.8, v.pos.z);
    p.vel.set(0, 0, 0);
    p.onGround = true;
  }

  private updateVehicles(dt: number) {
    for (const v of this.state.vehicles) {
      if (v.destroyed) continue;
      if (v.id === this.state.playerInVehicle) continue;
      // Decelerate unoccupied vehicles
      v.vel.multiplyScalar(1 - 3 * dt);
      v.pos.addScaledVector(v.vel, dt);
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
    const playerAlive = p.hp > 0 && this.state.status === "playing";

    for (const s of this.state.soldiers) {
      if (!s.alive) continue;
      // Skip AI for soldiers controlled by remote players (host applies their input separately)
      if ((s as any).__remoteOwner) continue;

      const classSpec = CLASSES[s.soldierClass];

      // ---- 1. Target selection: own sight + nearby squad callouts ----
      let visibleTargets: { pos: THREE.Vector3; vel: THREE.Vector3; id: number; isPlayer: boolean; dist: number }[] = [];
      const cand: { pos: THREE.Vector3; vel: THREE.Vector3; id: number; isPlayer: boolean }[] = [];
      if (s.team === "red" && playerAlive) {
        cand.push({ pos: p.pos, vel: p.vel, id: 0, isPlayer: true });
      }
      for (const o of this.state.soldiers) {
        if (!o.alive || o.team === s.team) continue;
        cand.push({ pos: o.pos, vel: o.vel, id: o.id, isPlayer: false });
      }
      for (const c of cand) {
        const d = s.pos.distanceTo(c.pos);
        if (d > 160) continue;
        if (this.canSee(s, c.pos, time)) {
          visibleTargets.push({ ...c, dist: d });
        }
      }

      // Sort visible by closest
      visibleTargets.sort((a, b) => a.dist - b.dist);
      const visTarget = visibleTargets[0] || null;
      let sharedTarget: { pos: THREE.Vector3; id: number; dist: number } | null = null;
      if (!visTarget) {
        for (const ally of this.state.soldiers) {
          if (!ally.alive || ally.team !== s.team || ally.id === s.id || !ally.lastSeenPos) continue;
          if (s.pos.distanceTo(ally.pos) > 34 || time - ally.lastSeenAt > 2.4) continue;
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
        this.steerAndMove(s, move, 1.8 * classSpec.speedMult, dt);
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

      // ---- 4. Tactical decision making — AGGRESSIVE: prefer pushing the target ----
      const inCommittedState = s.state === "flank" || s.state === "retreat";
      if (time >= s.nextTacticalDecisionAt && !(inCommittedState && s.coverTimer > 0)) {
        s.nextTacticalDecisionAt = time + (inCommittedState ? 1.4 : 0.8) + Math.random() * 0.4;
        const veryLowHp = s.hp < s.hpMax * 0.15; // only retreat when nearly dead

        // Class-driven aggressive behavior
        if (veryLowHp && Math.random() < 0.55) {
          s.state = "retreat";
        } else if (s.soldierClass === "sniper") {
          // Snipers still prefer range but push if needed
          s.state = hasLOS && dist > 18 ? "attack" : (dist < 10 ? "flank" : "chase");
        } else if (s.soldierClass === "support") {
          // Push and suppress aggressively
          if (hasLOS && dist < 18) s.state = "attack";
          else if (hasLOS && dist < 55) s.state = Math.random() < 0.4 ? "flank" : "suppress";
          else s.state = "chase";
        } else if (s.soldierClass === "assault") {
          // Always push: flank at range, attack up close
          if (hasLOS && dist < 11) s.state = "attack";
          else if (hasLOS && dist < 45 && Math.random() < 0.55) s.state = "flank";
          else s.state = hasLOS ? "chase" : "investigate";
        } else { // medic
          const hurtAlly = this.state.soldiers.find((ally) => ally.alive && ally.team === s.team && ally.hp < ally.hpMax * 0.4 && ally.pos.distanceTo(s.pos) < 22);
          if (hurtAlly && Math.random() < 0.55) {
            s.state = "cover";
            s.coverTarget = hurtAlly.pos.clone().addScaledVector(dirToT, -2);
            s.coverTimer = 1.2;
          } else s.state = hasLOS ? (dist < 14 ? "attack" : "chase") : "investigate";
        }

        // Throw grenade more often to push enemy out
        if (hasLOS && dist > 6 && dist < 42 && time - s.lastGrenadeAt > 3.2 && Math.random() < 0.55) {
          this.aiThrowGrenade(s, target.pos);
          s.lastGrenadeAt = time;
        }
        // Smoke only when actually retreating
        if (s.state === "retreat" && time - s.lastSmokeAt > 8 && Math.random() < 0.35) {
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
            s.state = "attack";
            s.coverTarget = null;
          } else {
            const toCover = new THREE.Vector3().subVectors(s.coverTarget, s.pos); toCover.y = 0;
            if (toCover.length() > 0.8) {
              move.copy(toCover.normalize());
              speedMult = 1.4;
            }
          }
          break;
        }
        case "retreat": {
          // Move away from threat
          move.copy(dirToT).multiplyScalar(-1);
          const lat = new THREE.Vector3(-dirToT.z, 0, dirToT.x).multiplyScalar(s.flankDir * 0.4);
          move.add(lat).normalize();
          speedMult = 1.5;
          if (s.hp > s.hpMax * 0.3) s.state = "chase"; // recover quickly and push back
          break;
        }
        case "flank": {
          // Move perpendicular while strongly closing
          const perp = new THREE.Vector3(-dirToT.z, 0, dirToT.x).multiplyScalar(s.flankDir);
          move.copy(perp).addScaledVector(dirToT, 0.75).normalize();
          speedMult = 1.5;
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
          speedMult = 1.55;
          break;
        }
        case "investigate": {
          move.copy(dirToT);
          speedMult = 1.25;
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

      const baseSpeed = 4.0;
      this.steerAndMove(s, move, baseSpeed * classSpec.speedMult * speedMult, dt);

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

  private isMoveBlocked(pos: THREE.Vector3, dir: THREE.Vector3, distance: number) {
    const ahead = pos.clone().addScaledVector(dir, distance);
    for (const b of this.boxes) {
      if (ahead.x > b.min.x - 0.7 && ahead.x < b.max.x + 0.7 &&
          ahead.z > b.min.z - 0.7 && ahead.z < b.max.z + 0.7 &&
          pos.y + 0.5 > b.min.y && pos.y - 0.5 < b.max.y) return true;
    }
    return false;
  }

  // Steering with obstacle avoidance + ally separation
  private steerAndMove(s: Soldier, desired: THREE.Vector3, speed: number, dt: number) {
    if (desired.lengthSq() < 0.0001) return;
    desired = desired.clone().setY(0).normalize();

    // Obstacle whisker: probe forward and adjust
    const original = desired.clone();
    const probe = desired.clone().multiplyScalar(2.8);
    const ahead = s.pos.clone().add(probe);
    let blocked = false;
    for (const b of this.boxes) {
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

    // Ally separation
    const sep = new THREE.Vector3();
    let count = 0;
    for (const o of this.state.soldiers) {
      if (!o.alive || o.id === s.id || o.team !== s.team) continue;
      const dx = s.pos.x - o.pos.x;
      const dz = s.pos.z - o.pos.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < 9 && d2 > 0.0001) {
        const inv = 1 / Math.sqrt(d2);
        sep.x += dx * inv;
        sep.z += dz * inv;
        count++;
      }
    }
    if (count > 0) {
      desired.x += sep.x * 0.4;
      desired.z += sep.z * 0.4;
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
    resolvePlayerCollision(newPos, SOLDIER_RADIUS, SOLDIER_HEIGHT, this.boxes);
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
    let baseHit = s.soldierClass === "sniper" ? 0.94
      : s.soldierClass === "support" ? 0.66
      : s.soldierClass === "assault" ? 0.80
      : 0.72;
    // Falloff with distance (sniper falls off less)
    const falloffStart = s.soldierClass === "sniper" ? 50 : 20;
    const falloffEnd = s.soldierClass === "sniper" ? 100 : 55;
    const falloff = THREE.MathUtils.clamp((dist - falloffStart) / (falloffEnd - falloffStart), 0, 1);
    const distMult = 1 - falloff * 0.55;
    // Movement penalty: if shooter just moved fast, accuracy down
    const shooterMoving = Math.hypot(s.moveDir.x, s.moveDir.z) > 0.5 ? 0.85 : 1.0;
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
    for (const b of this.boxes) {
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
    if (pd < GRENADE_RADIUS) {
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
