import * as THREE from "three";

export type WeaponId = "rifle" | "pistol" | "grenade" | "smg" | "sniper" | "smoke";
export type Team = "blue" | "red";
export type SoldierClass = "assault" | "sniper" | "support" | "medic";

export interface ClassSpec {
  id: SoldierClass;
  name: string;
  hpMax: number;
  speedMult: number;
  primary: WeaponId;
  secondary: WeaponId;
  grenadeCount: number;
  smokeCount: number;
  ability: string;
  abilityDesc: string;
}

export interface WeaponSpec {
  id: WeaponId;
  name: string;
  damage: number;
  fireRate: number;
  magSize: number;
  reserveMax: number;
  reloadTime: number;
  spread: number;
  auto: boolean;
  recoil: number;
  muzzleColor: string;
  headshotMultiplier: number;
}

export interface WeaponState {
  spec: WeaponSpec;
  mag: number;
  reserve: number;
  reloading: boolean;
  reloadEndsAt: number;
  lastShotAt: number;
}

export type SoldierState = "patrol" | "chase" | "attack" | "cover" | "flank" | "retreat" | "suppress" | "investigate";

export interface Soldier {
  id: number;
  team: Team;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  hp: number;
  hpMax: number;
  alive: boolean;
  lastShotAt: number;
  state: SoldierState;
  patrolTarget: THREE.Vector3;
  yaw: number;
  targetId: number | null;
  coverTarget: THREE.Vector3 | null;
  coverTimer: number;
  soldierClass: SoldierClass;
  // AI memory & perception
  lastSeenPos: THREE.Vector3 | null;
  lastSeenAt: number;
  reactionDelay: number;       // remaining seconds before fully reacting to a new sighting
  alertness: number;           // 0..1, raises detection range/aim accuracy
  flankDir: number;            // -1 or 1, side preference
  nextTacticalDecisionAt: number;
  lastGrenadeAt: number;
  lastSmokeAt: number;
  desiredYaw: number;
  // smoothed movement
  moveDir: THREE.Vector3;
  // last known threat dir for facing while in cover
  lastThreatDir: THREE.Vector3 | null;
  stuckTimer: number;
  lastPosCheck: THREE.Vector3;
  squadOffset: THREE.Vector3;
}

export type Enemy = Soldier;

export interface BulletHit {
  point: THREE.Vector3;
  normal: THREE.Vector3;
  enemyId?: number;
  ttl: number;
  isHeadshot?: boolean;
}

export interface BulletTrail {
  from: THREE.Vector3;
  to: THREE.Vector3;
  ttl: number;
  color: string;
}

export interface Grenade {
  id: number;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  fuse: number;
  team: Team;
  isSmoke: boolean;
}

export interface SmokeCloud {
  id: number;
  pos: THREE.Vector3;
  age: number;
  ttl: number;
  radius: number;
}

export interface Explosion {
  pos: THREE.Vector3;
  age: number;
  ttl: number;
}

export interface MuzzleFlash {
  pos: THREE.Vector3;
  ttl: number;
  color: string;
}

export interface DamageNumber {
  id: number;
  pos: THREE.Vector3;
  amount: number;
  ttl: number;
  isCrit: boolean;
}

export type PickupKind = "weapon" | "ammo" | "health" | "grenade";

export interface Pickup {
  id: number;
  pos: THREE.Vector3;
  kind: PickupKind;
  weaponId?: WeaponId;
  amount?: number;
  taken: boolean;
}

export interface DestructibleObject {
  id: number;
  pos: THREE.Vector3;
  size: THREE.Vector3;
  hp: number;
  hpMax: number;
  color: string;
  destroyed: boolean;
  kind: "crate" | "barrel";
}

export interface RagdollPart {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  rot: THREE.Euler;
  size: THREE.Vector3;
  color: string;
  ttl: number;
}

export interface Loadout {
  primary: WeaponId;
  secondary: WeaponId;
  grenadeCount: number;
  smokeCount: number;
  soldierClass: SoldierClass;
}

// === CAPTURE POINT ===
export interface CapturePoint {
  id: number;
  pos: THREE.Vector3;
  radius: number;
  owner: Team | null;
  progress: number; // -1 (full red) to 1 (full blue)
  name: string;
}

// === VEHICLE ===
export interface Vehicle {
  id: number;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  yaw: number;
  hp: number;
  hpMax: number;
  kind: "jeep" | "tank";
  speed: number;
  team: Team | null;
  destroyed: boolean;
}
