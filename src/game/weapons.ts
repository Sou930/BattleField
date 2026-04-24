import { WeaponSpec, WeaponState, WeaponId } from "./types";

export const WEAPONS: Record<WeaponId, WeaponSpec> = {
  rifle: {
    id: "rifle",
    name: "M4 ASSAULT",
    damage: 28,
    fireRate: 9,
    magSize: 30,
    reserveMax: 180,
    reloadTime: 1.8,
    spread: 0.018,
    auto: true,
    recoil: 0.012,
    muzzleColor: "#ffd27a",
    headshotMultiplier: 2.5,
  },
  pistol: {
    id: "pistol",
    name: "M9 SIDEARM",
    damage: 22,
    fireRate: 4,
    magSize: 12,
    reserveMax: 96,
    reloadTime: 1.2,
    spread: 0.012,
    auto: false,
    recoil: 0.018,
    muzzleColor: "#ffe6a8",
    headshotMultiplier: 2.0,
  },
  grenade: {
    id: "grenade",
    name: "FRAG GRENADE",
    damage: 110,
    fireRate: 1,
    magSize: 1,
    reserveMax: 5,
    reloadTime: 1.0,
    spread: 0,
    auto: false,
    recoil: 0,
    muzzleColor: "#ffffff",
    headshotMultiplier: 1.0,
  },
  smoke: {
    id: "smoke",
    name: "SMOKE GRENADE",
    damage: 0,
    fireRate: 1,
    magSize: 1,
    reserveMax: 3,
    reloadTime: 1.0,
    spread: 0,
    auto: false,
    recoil: 0,
    muzzleColor: "#cccccc",
    headshotMultiplier: 1.0,
  },
  smg: {
    id: "smg",
    name: "MP5 SMG",
    damage: 18,
    fireRate: 13,
    magSize: 40,
    reserveMax: 240,
    reloadTime: 1.6,
    spread: 0.028,
    auto: true,
    recoil: 0.009,
    muzzleColor: "#ffd590",
    headshotMultiplier: 2.0,
  },
  sniper: {
    id: "sniper",
    name: "AWM SNIPER",
    damage: 110,
    fireRate: 1.1,
    magSize: 5,
    reserveMax: 30,
    reloadTime: 2.6,
    spread: 0.001,
    auto: false,
    recoil: 0.06,
    muzzleColor: "#fff0c0",
    headshotMultiplier: 3.0,
  },
};

export const GRENADE_RADIUS = 6;
export const GRENADE_FUSE = 2.4;
export const SMOKE_DURATION = 12;
export const SMOKE_RADIUS = 8;

export function makeWeaponState(id: WeaponId): WeaponState {
  const spec = WEAPONS[id];
  return {
    spec,
    mag: spec.magSize,
    reserve: id === "grenade" ? 4 : id === "smoke" ? 2 : Math.floor(spec.reserveMax / 2),
    reloading: false,
    reloadEndsAt: 0,
    lastShotAt: 0,
  };
}
