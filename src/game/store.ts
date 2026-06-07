import * as THREE from "three";
import { Soldier, MuzzleFlash, BulletHit, BulletTrail, Grenade, Explosion, DamageNumber, WeaponState, Pickup, WeaponId, SmokeCloud, DestructibleObject, RagdollPart, Loadout, CapturePoint, Vehicle, Aircraft, AircraftBomb, AircraftGunTrail } from "./types";
import { makeWeaponState, WEAPONS } from "./weapons";

export interface PlayerState {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  yaw: number;
  pitch: number;
  hp: number;
  hpMax: number;
  onGround: boolean;
  lastDamagedAt: number;
}

export interface GameState {
  player: PlayerState;
  weapons: Record<string, WeaponState>;
  currentWeapon: WeaponId;
  ownedWeapons: WeaponId[];
  soldiers: Soldier[];
  pickups: Pickup[];
  hits: BulletHit[];
  trails: BulletTrail[];
  flashes: MuzzleFlash[];
  grenades: Grenade[];
  explosions: Explosion[];
  damageNumbers: DamageNumber[];
  smokeClouds: SmokeCloud[];
  destructibles: DestructibleObject[];
  ragdolls: RagdollPart[];
  capturePoints: CapturePoint[];
  vehicles: Vehicle[];
  playerInVehicle: number | null; // vehicle id
  aircraft: Aircraft[];
  aircraftBombs: AircraftBomb[];
  aircraftGunTrails: AircraftGunTrail[];
  playerInAircraft: number | null;  // aircraft.id
  nextAircraftId: number;
  nextAircraftBombId: number;
  score: number;
  kills: number;
  deaths: number;
  headshots: number;
  blueScore: number;
  redScore: number;
  scoreLimit: number;
  status: "menu" | "loadout" | "playing" | "dead" | "won" | "lost";
  hitMarker: number;
  headshotMarker: number;
  damageFlash: number;
  shake: number;
  nextSoldierId: number;
  nextGrenadeId: number;
  nextDmgId: number;
  nextPickupId: number;
  nextSmokeId: number;
  nextDestructibleId: number;
  aiming: boolean;
  aimT: number;
  // 乗り物 (航空機・地上車両) 搭乗中のカメラ視点。
  //  "third" = 三人称 (機体/車体を後方から見る), "first" = 一人称 (コクピット視点)。
  // 搭乗時は既定で三人称。V キーでトグルする。
  vehicleViewMode: "first" | "third";
  nearbyPickupId: number | null;
  nearbyVehicleId: number | null;
  enemies: Soldier[];
  wave: number;
  loadout: Loadout;
  captureTickTimer: number;
  mapOpen: boolean;
}

export function createInitialState(): GameState {
  const soldiers: Soldier[] = [];
  return {
    player: {
      pos: new THREE.Vector3(0, 1.7, 0),
      vel: new THREE.Vector3(),
      yaw: 0,
      pitch: 0,
      hp: 100,
      hpMax: 100,
      onGround: true,
      lastDamagedAt: -10,
    },
    weapons: {
      rifle: makeWeaponState("rifle"),
      pistol: makeWeaponState("pistol"),
      grenade: makeWeaponState("grenade"),
      smoke: makeWeaponState("smoke"),
      smg: makeWeaponState("smg"),
      sniper: makeWeaponState("sniper"),
    },
    currentWeapon: "rifle",
    ownedWeapons: ["rifle", "pistol", "grenade"],
    soldiers,
    pickups: [],
    hits: [],
    trails: [],
    flashes: [],
    grenades: [],
    explosions: [],
    damageNumbers: [],
    smokeClouds: [],
    destructibles: [],
    ragdolls: [],
    capturePoints: [],
    vehicles: [],
    playerInVehicle: null,
    aircraft: [],
    aircraftBombs: [],
    aircraftGunTrails: [],
    playerInAircraft: null,
    nextAircraftId: 1,
    nextAircraftBombId: 1,
    score: 0,
    kills: 0,
    deaths: 0,
    headshots: 0,
    blueScore: 0,
    redScore: 0,
    scoreLimit: 1000,
    status: "menu",
    hitMarker: 0,
    headshotMarker: 0,
    damageFlash: 0,
    shake: 0,
    nextSoldierId: 1,
    nextGrenadeId: 1,
    nextDmgId: 1,
    nextPickupId: 1,
    nextSmokeId: 1,
    nextDestructibleId: 1,
    aiming: false,
    aimT: 0,
    vehicleViewMode: "third",
    nearbyPickupId: null,
    nearbyVehicleId: null,
    enemies: soldiers,
    wave: 1,
    loadout: {
      primary: "rifle",
      secondary: "pistol",
      grenadeCount: 3,
      smokeCount: 2,
      soldierClass: "assault",
      spawnIndex: 0,
    },
    captureTickTimer: 0,
    mapOpen: false,
  };
}

type Listener = () => void;
class Store {
  state: GameState = createInitialState();
  private listeners = new Set<Listener>();
  subscribe(l: Listener) {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
  emit() {
    this.listeners.forEach((l) => l());
  }
  reset() {
    this.state = createInitialState();
    this.state.enemies = this.state.soldiers;
    this.emit();
  }
}

export const store = new Store();

import { useEffect, useState } from "react";
export function useGame<T>(selector: (s: GameState) => T): T {
  const [val, setVal] = useState(() => selector(store.state));
  useEffect(() => {
    const unsub = store.subscribe(() => setVal(selector(store.state)));
    return () => {
      unsub();
    };
  }, [selector]);
  return val;
}

export { WEAPONS };
