import { useEffect, useRef, useState, MutableRefObject, useCallback } from "react";
import { useGame, store } from "@/game/store";
import { WEAPONS } from "@/game/weapons";
import { Input } from "@/game/input";
import { cn } from "@/lib/utils";
import { WORLD_SIZE, buildMapData, generateWorld, type MapData } from "@/game/world";
import { CLASSES } from "@/game/classes";
import { GameEngine } from "@/game/engine";
import type { WeaponId, Loadout, SoldierClass } from "@/game/types";

interface Props {
  onStart: () => void;
  onStartGame: (loadout?: Loadout) => void;
  input?: MutableRefObject<Input | null>;
}

// The world is deterministic (seeded), so the static map geometry only needs
// to be computed once for the whole HUD lifetime.
let _mapData: MapData | null = null;
function getMapData(): MapData {
  if (!_mapData) _mapData = buildMapData(generateWorld());
  return _mapData;
}

function detectMobile() {
  if (typeof window === "undefined") return false;
  const ua = navigator.userAgent;
  const isTouch = "ontouchstart" in window || navigator.maxTouchPoints > 0;
  const isMobileUA = /iPhone|iPad|iPod|Android|Mobile/i.test(ua);
  return isTouch && (isMobileUA || window.innerWidth < 1100);
}

export default function HUD({ onStart, onStartGame, input }: Props) {
  const status = useGame((s) => s.status);
  const hp = useGame((s) => s.player.hp);
  const hpMax = useGame((s) => s.player.hpMax);
  const score = useGame((s) => s.score);
  const kills = useGame((s) => s.kills);
  const blueScore = useGame((s) => s.blueScore);
  const redScore = useGame((s) => s.redScore);
  const scoreLimit = useGame((s) => s.scoreLimit);
  const currentWeapon = useGame((s) => s.currentWeapon);
  const ownedWeapons = useGame((s) => s.ownedWeapons);
  const weapons = useGame((s) => s.weapons);
  const hitMarker = useGame((s) => s.hitMarker);
  const headshotMarker = useGame((s) => s.headshotMarker);
  const damageFlash = useGame((s) => s.damageFlash);
  const dmgNums = useGame((s) => s.damageNumbers);
  const headshots = useGame((s) => s.headshots);
  const aliveBlue = useGame((s) => s.soldiers.filter((e) => e.alive && e.team === "blue").length + (s.player.hp > 0 ? 1 : 0));
  const aliveRed = useGame((s) => s.soldiers.filter((e) => e.alive && e.team === "red").length);
  const aimT = useGame((s) => s.aimT);
  const nearbyPickupId = useGame((s) => s.nearbyPickupId);
  const nearbyVehicleId = useGame((s) => s.nearbyVehicleId);
  const pickups = useGame((s) => s.pickups);
  const playerPos = useGame((s) => s.player.pos);
  const playerYaw = useGame((s) => s.player.yaw);
  const soldiers = useGame((s) => s.soldiers);
  const smokeClouds = useGame((s) => s.smokeClouds);
  const capturePoints = useGame((s) => s.capturePoints);
  const vehicles = useGame((s) => s.vehicles);
  const playerInVehicle = useGame((s) => s.playerInVehicle);
  const playerInAircraft = useGame((s) => s.playerInAircraft);
  const vehicleViewMode = useGame((s) => s.vehicleViewMode);
  const aircraft = useGame((s) => s.aircraft);
  const playerClass = useGame((s) => s.loadout.soldierClass);
  const mapOpen = useGame((s) => s.mapOpen);

  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    setIsMobile(detectMobile());
  }, []);

  const w = weapons[currentWeapon];
  const isSniperScope = (currentWeapon === "rifle" || currentWeapon === "sniper") && aimT > 0.5;
  const nearbyPickup = nearbyPickupId ? pickups.find((p) => p.id === nearbyPickupId) : null;
  const nearbyVehicle = nearbyVehicleId ? vehicles.find((v) => v.id === nearbyVehicleId) : null;

  // 搭乗中の機体オブジェクトを導出
  const myAircraft = playerInAircraft
    ? aircraft.find((a) => a.id === playerInAircraft) ?? null
    : null;

  // 徒歩時: 近くに onGround の機体があるか
  const nearbyAircraft = !playerInAircraft
    ? aircraft.find((a) => {
        if (!a.alive || !a.onGround) return false;
        const dx = a.pos.x - playerPos.x;
        const dz = a.pos.z - playerPos.z;
        return Math.sqrt(dx * dx + dz * dz) < 8;
      }) ?? null
    : null;

  return (
    <div className="pointer-events-none absolute inset-0 select-none font-mono text-foreground">
      {/* Damage vignette */}
      <div
        className="absolute inset-0 transition-opacity"
        style={{
          background:
            "radial-gradient(ellipse at center, transparent 40%, hsl(var(--danger) / 0.65) 100%)",
          opacity: Math.min(1, damageFlash * 1.5),
        }}
      />

      {/* Sniper scope overlay */}
      {status === "playing" && isSniperScope && (
        <div
          className="absolute inset-0 transition-opacity"
          style={{ opacity: Math.min(1, (aimT - 0.5) * 2) }}
        >
          <div
            className="absolute inset-0 bg-black"
            style={{
              maskImage:
                "radial-gradient(circle at center, transparent 0, transparent 38vmin, black 38.5vmin)",
              WebkitMaskImage:
                "radial-gradient(circle at center, transparent 0, transparent 38vmin, black 38.5vmin)",
            }}
          />
          <div
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-black"
            style={{ width: "76vmin", height: "76vmin" }}
          />
          <div className="absolute left-1/2 top-1/2 h-[1px] w-[76vmin] -translate-x-1/2 -translate-y-1/2 bg-black/85" />
          <div className="absolute left-1/2 top-1/2 h-[76vmin] w-[1px] -translate-x-1/2 -translate-y-1/2 bg-black/85" />
          {[-3, -2, -1, 1, 2, 3].map((i) => (
            <div key={`h${i}`} className="absolute top-1/2 h-[2px] w-[2px] -translate-y-1/2 rounded-full bg-black" style={{ left: `calc(50% + ${i * 4}vmin)` }} />
          ))}
          {[-3, -2, -1, 1, 2, 3].map((i) => (
            <div key={`v${i}`} className="absolute left-1/2 h-[2px] w-[2px] -translate-x-1/2 rounded-full bg-black" style={{ top: `calc(50% + ${i * 4}vmin)` }} />
          ))}
          <div className="absolute left-1/2 top-1/2 h-1 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[hsl(var(--danger))]" />
          <div className="absolute left-1/2 top-[calc(50%+38vmin-28px)] -translate-x-1/2 text-[10px] uppercase tracking-[0.3em] text-[hsl(var(--hud))]">
            ◉ {currentWeapon === "sniper" ? "4.3×" : "2.4×"} ZOOM
          </div>
        </div>
      )}

      {/* Pistol/SMG ADS dot */}
      {status === "playing" && (currentWeapon === "pistol" || currentWeapon === "smg") && aimT > 0.3 && (
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2" style={{ opacity: Math.min(1, (aimT - 0.3) * 2) }}>
          <div className="h-3 w-3 rounded-full border border-[hsl(var(--hud))]" />
          <div className="absolute left-1/2 top-1/2 h-[3px] w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[hsl(var(--danger))]" />
        </div>
      )}

      {status === "playing" && aimT < 0.5 && !playerInAircraft && (
        <div className="absolute left-1/2 top-1/2 h-6 w-6 -translate-x-1/2 -translate-y-1/2" style={{ opacity: 1 - aimT * 2 }}>
          <div className="absolute left-1/2 top-0 h-2 w-[2px] -translate-x-1/2 bg-[hsl(var(--hud))]" />
          <div className="absolute bottom-0 left-1/2 h-2 w-[2px] -translate-x-1/2 bg-[hsl(var(--hud))]" />
          <div className="absolute left-0 top-1/2 h-[2px] w-2 -translate-y-1/2 bg-[hsl(var(--hud))]" />
          <div className="absolute right-0 top-1/2 h-[2px] w-2 -translate-y-1/2 bg-[hsl(var(--hud))]" />
          <div className="absolute left-1/2 top-1/2 h-1 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[hsl(var(--hud))]" />
          {hitMarker > 0 && (
            <div className="absolute -inset-3">
              <div className="absolute left-1/2 top-1/2 h-3 w-[2px] origin-center -translate-x-1/2 -translate-y-1/2 rotate-45 bg-[hsl(var(--danger))]" />
              <div className="absolute left-1/2 top-1/2 h-3 w-[2px] origin-center -translate-x-1/2 -translate-y-1/2 -rotate-45 bg-[hsl(var(--danger))]" />
            </div>
          )}
          {headshotMarker > 0 && (
            <div className="absolute -inset-5 flex items-center justify-center">
              <div className="text-[10px] font-bold uppercase tracking-widest text-[#ff4444] animate-pulse">
                ★ HEADSHOT
              </div>
            </div>
          )}
        </div>
      )}

      {/* Top bar: team scores */}
      {status === "playing" && (
        <div className="absolute left-0 right-0 top-0 flex items-center justify-center gap-3 p-3">
          <div className="rounded border border-[hsl(var(--hud)/0.4)] bg-background/60 px-4 py-2 text-center backdrop-blur-sm">
            <div className="text-[10px] uppercase tracking-widest text-[hsl(var(--accent))]">POINTS</div>
            <div className="text-2xl font-bold tabular-nums">{score} / {scoreLimit}</div>
            <div className="text-[10px] text-muted-foreground">K {kills} · HS {headshots}</div>
          </div>
          <div className="rounded border border-[hsl(var(--hud)/0.4)] bg-background/60 px-3 py-2 text-center backdrop-blur-sm">
            <div className="text-[10px] uppercase tracking-widest text-[hsl(var(--hud))]">BLUE</div>
            <div className="text-lg font-bold tabular-nums">{blueScore}</div>
            <div className="text-[10px] text-muted-foreground">{aliveBlue} alive</div>
          </div>
          <div className="rounded border border-[hsl(var(--hud)/0.4)] bg-background/60 px-4 py-2 text-center backdrop-blur-sm">
            <div className="text-[10px] uppercase tracking-widest text-[#ff6060]">RED</div>
            <div className="text-2xl font-bold tabular-nums">{redScore}</div>
            <div className="text-[10px] text-muted-foreground">{aliveRed} alive</div>
          </div>
        </div>
      )}

      {/* Capture points HUD */}
      {status === "playing" && capturePoints.length > 0 && (
        <div className="absolute left-1/2 top-[72px] -translate-x-1/2 flex gap-2">
          {capturePoints.map((cp) => (
            <div key={cp.id} className="flex flex-col items-center">
              <div className="text-[8px] uppercase tracking-widest text-muted-foreground">{cp.name}</div>
              <div className="relative h-2 w-12 overflow-hidden rounded-sm bg-background/60 border border-border/30">
                <div
                  className="absolute inset-y-0 left-1/2"
                  style={{
                    width: `${Math.abs(cp.progress) * 50}%`,
                    transform: cp.progress >= 0 ? 'translateX(0)' : `translateX(-100%)`,
                    background: cp.progress >= 0 ? "hsl(var(--accent))" : "hsl(var(--danger))",
                    opacity: 0.8,
                  }}
                />
              </div>
              <div
                className="mt-0.5 h-1.5 w-1.5 rounded-full"
                style={{
                  background: cp.owner === "blue" ? "hsl(var(--accent))" : cp.owner === "red" ? "hsl(var(--danger))" : "hsl(var(--muted-foreground))",
                }}
              />
            </div>
          ))}
        </div>
      )}

      {/* Player class indicator */}
      {status === "playing" && (
        <div className="absolute top-20 left-6 rounded border border-[hsl(var(--hud)/0.3)] bg-background/50 px-2 py-1 backdrop-blur-sm">
          <div className="text-[9px] uppercase tracking-widest text-[hsl(var(--hud))]">
            {CLASSES[playerClass].name}
          </div>
          <div className="text-[8px] text-muted-foreground">{CLASSES[playerClass].ability}</div>
        </div>
      )}

      {/* Vehicle HUD */}
      {status === "playing" && playerInVehicle && (
        <div className="absolute bottom-20 left-1/2 -translate-x-1/2 rounded border border-[hsl(var(--ammo)/0.5)] bg-background/70 px-4 py-2 text-center backdrop-blur-sm">
          <div className="text-[10px] uppercase tracking-widest text-[hsl(var(--ammo))]">🚗 VEHICLE</div>
          <div className="text-[9px] text-muted-foreground mt-1">
            {isMobile ? "左スティック:操縦 · VIEW:視点 · EXIT:降車" : "WASD to drive · V 視点切替 · F to exit"}
          </div>
        </div>
      )}

      {/* Aircraft board prompt (徒歩時のみ) */}
      {status === "playing" && nearbyAircraft && (
        <div className="absolute bottom-24 left-1/2 -translate-x-1/2 bg-black/60 text-white px-4 py-2 rounded text-sm font-mono">
          ✈ G キーで搭乗
        </div>
      )}

      {/* 航空計器パネル（搭乗中のみ表示） */}
      {status === "playing" && myAircraft && (
        <div className="absolute bottom-4 left-4 w-52 bg-black/70 text-green-400 font-mono text-xs p-3 rounded border border-green-800">
          <div className="text-green-300 mb-1 text-sm flex items-center justify-between">
            <span>✈ {myAircraft.kind.toUpperCase()}</span>
            <span className="text-[9px] text-green-500 border border-green-700 rounded px-1">
              {vehicleViewMode === "third" ? "三人称" : "一人称"}
            </span>
          </div>
          <div>SPD  {Math.round(myAircraft.vel.length() * 3.6)} km/h</div>
          <div>ALT  {Math.round(myAircraft.pos.y)} m</div>
          <div className="mt-1">
            THR
            <span className="ml-1 inline-block w-24 h-2 bg-gray-700 align-middle rounded">
              <span
                className="block h-2 bg-green-500 rounded"
                style={{ width: `${myAircraft.throttle * 100}%` }}
              />
            </span>
          </div>
          <div>GUN  {myAircraft.gunAmmo}/{myAircraft.gunAmmoMax}</div>
          {myAircraft.kind === "attacker" && (
            <div>BOMB {myAircraft.bombCount}/{myAircraft.bombMax}</div>
          )}
          <div className="mt-2 text-gray-400 text-[10px] leading-4">
            W/S スロットル<br />
            A/D バンク<br />
            マウス 機首操作<br />
            左クリック 機関銃<br />
            {myAircraft.kind === "attacker" && (<>SPACE 爆弾投下<br /></>)}
            V 視点切替<br />
            G 脱出
          </div>
        </div>
      )}

      {/* 航空照準（搭乗中のみ表示） */}
      {status === "playing" && playerInAircraft && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          {/* 中央リング */}
          <div className="w-6 h-6 rounded-full border border-white/80 flex items-center justify-center">
            <div className="w-1 h-1 bg-white rounded-full" />
          </div>
          {/* 速度ベクトル方向インジケータ (簡易版: 30px 前方の菱形) */}
          <div
            className="absolute w-3 h-3 border border-yellow-300 rotate-45"
            style={{
              transform: "translate(-50%,-50%) rotate(45deg)",
              top: "calc(50% - 30px)",
              left: "50%",
            }}
          />
        </div>
      )}

      {/* Pickup prompt */}
      {status === "playing" && nearbyPickup && !playerInVehicle && !playerInAircraft && (
        <div className="absolute left-1/2 top-[58%] -translate-x-1/2 rounded border border-[hsl(var(--hud)/0.6)] bg-background/80 px-4 py-2 text-center backdrop-blur-sm">
          <div className="text-[10px] uppercase tracking-[0.3em] text-[hsl(var(--hud))]">
            {isMobile ? "Tap PICK UP" : "Press [E]"}
          </div>
          <div className="mt-1 text-sm font-bold uppercase">
            {nearbyPickup.kind === "weapon" && nearbyPickup.weaponId
              ? WEAPONS[nearbyPickup.weaponId].name
              : nearbyPickup.kind === "ammo"
              ? `+${nearbyPickup.amount} AMMO`
              : nearbyPickup.kind === "health"
              ? `+${nearbyPickup.amount} HEALTH`
              : `+${nearbyPickup.amount} GRENADE`}
          </div>
        </div>
      )}

      {/* Vehicle enter prompt */}
      {status === "playing" && nearbyVehicle && !playerInVehicle && !playerInAircraft && !nearbyPickup && (
        <div className="absolute left-1/2 top-[58%] -translate-x-1/2 rounded border border-[hsl(var(--ammo)/0.6)] bg-background/80 px-4 py-2 text-center backdrop-blur-sm">
          <div className="text-[10px] uppercase tracking-[0.3em] text-[hsl(var(--ammo))]">
            {isMobile ? "Tap ENTER" : "Press [F]"}
          </div>
          <div className="mt-1 text-sm font-bold uppercase">
            ENTER {nearbyVehicle.kind.toUpperCase()}
          </div>
        </div>
      )}

      {/* Bottom-left: health */}
      {status === "playing" && (
        <div className="absolute bottom-6 left-6 w-64 rounded border border-[hsl(var(--hud)/0.4)] bg-background/60 p-3 backdrop-blur-sm">
          <div className="mb-1 flex items-center justify-between text-xs uppercase tracking-widest">
            <span className="text-[hsl(var(--hud))]">Health</span>
            <span className="tabular-nums">{Math.max(0, Math.round(hp))} / {hpMax}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-sm bg-background/80">
            <div
              className="h-full transition-all"
              style={{
                width: `${(hp / hpMax) * 100}%`,
                background: hp > 50 ? "hsl(var(--health))" : hp > 25 ? "hsl(var(--ammo))" : "hsl(var(--danger))",
              }}
            />
          </div>
        </div>
      )}

      {/* Bottom-right: weapon */}
      {status === "playing" && !playerInVehicle && !playerInAircraft && (
        <div className="absolute bottom-6 right-6 rounded border border-[hsl(var(--hud)/0.4)] bg-background/60 p-3 backdrop-blur-sm">
          <div className="text-right text-xs uppercase tracking-widest text-[hsl(var(--hud))]">{w.spec.name}</div>
          <div className="mt-1 flex items-baseline justify-end gap-2 tabular-nums">
            <span className={cn("text-3xl font-bold", w.mag === 0 && "text-[hsl(var(--danger))]", w.reloading && "animate-pulse")}>{w.mag}</span>
            <span className="text-muted-foreground">/ {w.reserve}</span>
          </div>
          <div className="mt-2 flex flex-wrap justify-end gap-1 text-[10px]">
            {(["rifle", "pistol", "grenade", "smg", "sniper", "smoke"] as const).map((id, i) => {
              const owned = ownedWeapons.includes(id);
              return (
                <div
                  key={id}
                  className={cn(
                    "rounded px-2 py-1 uppercase tracking-wider",
                    !owned && "opacity-30",
                    currentWeapon === id
                      ? "bg-[hsl(var(--hud))] text-[hsl(var(--hud-foreground))]"
                      : "bg-background/60 text-muted-foreground",
                  )}
                >
                  {i + 1}
                </div>
              );
            })}
          </div>
          {w.reloading && (
            <div className="mt-1 text-right text-[10px] uppercase tracking-widest text-[hsl(var(--ammo))]">
              Reloading…
            </div>
          )}
        </div>
      )}

      {/* Damage numbers */}
      {status === "playing" && dmgNums.length > 0 && (
        <div className="absolute left-1/2 top-[42%] -translate-x-1/2 text-center">
          {dmgNums.slice(-1).map((d) => (
            <div
              key={d.id}
              className={cn("text-2xl font-bold tabular-nums", d.isCrit ? "text-[hsl(var(--danger))]" : "text-[hsl(var(--ammo))]")}
              style={{ opacity: d.ttl }}
            >
              {d.isCrit && "✦ "}-{d.amount}
            </div>
          ))}
        </div>
      )}

      {/* Mobile touch controls */}
      {status === "playing" && isMobile && input && (
        <MobileControls input={input} hasPickup={!!nearbyPickup} hasVehicle={!!nearbyVehicle} inVehicle={!!playerInVehicle} hasAircraft={!!nearbyAircraft} inAircraft={!!playerInAircraft} />
      )}

      {/* Minimap */}
      {status === "playing" && (
        <Minimap
          playerPos={playerPos}
          playerYaw={playerYaw}
          soldiers={soldiers}
          smokeClouds={smokeClouds}
          capturePoints={capturePoints}
          vehicles={vehicles}
          pickups={pickups}
          mapData={getMapData()}
        />
      )}

      {/* Full-screen tactical map (M) */}
      {status === "playing" && mapOpen && (
        <FullMap
          playerPos={playerPos}
          playerYaw={playerYaw}
          soldiers={soldiers}
          capturePoints={capturePoints}
          vehicles={vehicles}
          pickups={pickups}
          smokeClouds={smokeClouds}
          mapData={getMapData()}
          isMobile={isMobile}
          onClose={() => {
            store.state.mapOpen = false;
            store.emit();
          }}
        />
      )}

      {/* Map hint (desktop) */}
      {status === "playing" && !mapOpen && !isMobile && (
        <div className="absolute right-4 text-[9px] uppercase tracking-widest text-muted-foreground" style={{ top: 158 + 24 }}>
          [M] FULL MAP
        </div>
      )}

      {/* Map button (mobile) */}
      {status === "playing" && !mapOpen && isMobile && (
        <button
          className="pointer-events-auto absolute left-3 top-24 h-9 w-9 rounded border border-[hsl(var(--hud)/0.5)] bg-background/70 text-xs font-bold text-[hsl(var(--hud))] backdrop-blur-sm active:bg-[hsl(var(--hud))] active:text-[hsl(var(--hud-foreground))]"
          onClick={() => { store.state.mapOpen = true; store.emit(); }}
        >
          MAP
        </button>
      )}

      {/* Menu / End screens */}
      {status === "menu" && <Menu onStart={onStart} isMobile={isMobile} />}
      {status === "loadout" && <LoadoutScreen onStart={onStartGame} isMobile={isMobile} />}
      {status === "dead" && <DeathScreen onRestart={onStart} score={score} kills={kills} blueScore={blueScore} redScore={redScore} headshots={headshots} />}
      {status === "won" && <WinScreen onRestart={onStart} score={score} kills={kills} won headshots={headshots} />}
      {status === "lost" && <WinScreen onRestart={onStart} score={score} kills={kills} won={false} headshots={headshots} />}
    </div>
  );
}

// ============= MOBILE TOUCH CONTROLS =============
function MobileControls({
  input,
  hasPickup,
  hasVehicle,
  inVehicle,
  hasAircraft,
  inAircraft,
}: {
  input: MutableRefObject<Input | null>;
  hasPickup: boolean;
  hasVehicle: boolean;
  inVehicle: boolean;
  hasAircraft: boolean;
  inAircraft: boolean;
}) {
  return (
    <>
      {/* Aircraft enter/exit button (徒歩で機体が近い時、または搭乗中) */}
      {(hasAircraft || inAircraft) && (
        <button
          className="pointer-events-auto absolute right-4 bottom-40 w-14 h-14 rounded-full bg-gray-700/80 text-white text-lg flex items-center justify-center active:bg-gray-500"
          onPointerDown={() => { if (input?.current) input.current.aircraftEnterPressed = true; }}
        >
          ✈
        </button>
      )}
      {/* 視点切り替えボタン (車両・航空機 搭乗中のみ) */}
      {(inVehicle || inAircraft) && (
        <button
          className="pointer-events-auto absolute right-20 bottom-40 w-14 h-14 rounded-full bg-sky-700/80 text-white text-xs font-bold flex items-center justify-center active:bg-sky-500"
          onPointerDown={() => { if (input?.current) input.current.viewTogglePressed = true; }}
        >
          VIEW
        </button>
      )}
      {/* Movement joystick (left) - works for both on-foot and vehicle */}
      <Joystick
        side="left"
        onChange={(v) => input.current?.setTouchMove(v)}
        onRelease={() => input.current?.setTouchMove({ x: 0, y: 0 })}
      />
      {/* Look area (right half of screen) */}
      <LookPad onDelta={(dx, dy) => input.current?.addTouchLook(dx, dy)} />

      {/* On-foot controls */}
      {!inVehicle && (
        <div className="pointer-events-none absolute bottom-32 right-4 flex flex-col items-end gap-3">
          <TouchButton
            label="FIRE"
            color="hsl(var(--danger))"
            big
            onPress={() => input.current?.setFire(true)}
            onRelease={() => input.current?.setFire(false)}
          />
          <div className="flex gap-2">
            <TouchButton label="JUMP" onTap={() => input.current?.pressJump()} />
            <TouchButton label="RELOAD" onTap={() => input.current?.pressReload()} />
          </div>
          {hasPickup && (
            <TouchButton
              label="PICK UP"
              color="hsl(var(--health))"
              onTap={() => input.current?.pressPickup()}
            />
          )}
          {hasVehicle && (
            <TouchButton
              label="ENTER"
              color="hsl(var(--ammo))"
              onTap={() => input.current?.pressEnterVehicle()}
            />
          )}
        </div>
      )}

      {/* Vehicle controls - dedicated GAS/BRAKE/EXIT buttons */}
      {inVehicle && (
        <>
          {/* Right side: Exit button + horn */}
          <div className="pointer-events-none absolute bottom-32 right-4 flex flex-col items-end gap-3">
            <TouchButton
              label="EXIT"
              color="hsl(var(--ammo))"
              big
              onTap={() => input.current?.pressEnterVehicle()}
            />
          </div>

          {/* Gas pedal (right side, bottom) */}
          <div className="pointer-events-auto absolute bottom-8 right-24">
            <button
              className="flex h-20 w-20 items-center justify-center rounded-2xl border-2 border-emerald-400/60 bg-emerald-500/70 text-xs font-bold uppercase tracking-wider text-white shadow-lg backdrop-blur-sm active:scale-95 active:bg-emerald-400/90"
              onTouchStart={(e) => {
                e.preventDefault();
                input.current?.setVehicleGas(true);
              }}
              onTouchEnd={(e) => {
                e.preventDefault();
                input.current?.setVehicleGas(false);
              }}
            >
              GAS
            </button>
          </div>

          {/* Brake pedal (right side, above gas) */}
          <div className="pointer-events-auto absolute bottom-32 right-24">
            <button
              className="flex h-14 w-20 items-center justify-center rounded-2xl border-2 border-red-400/60 bg-red-500/70 text-xs font-bold uppercase tracking-wider text-white shadow-lg backdrop-blur-sm active:scale-95 active:bg-red-400/90"
              onTouchStart={(e) => {
                e.preventDefault();
                input.current?.setVehicleBrake(true);
              }}
              onTouchEnd={(e) => {
                e.preventDefault();
                input.current?.setVehicleBrake(false);
              }}
            >
              BRAKE
            </button>
          </div>

          {/* Speed indicator */}
          <VehicleSpeedometer />
        </>
      )}

      {/* AIM toggle (on-foot only) */}
      {!inVehicle && (
        <div className="pointer-events-none absolute bottom-60 left-6 flex flex-col gap-2">
          <AimToggle input={input} />
        </div>
      )}

      {/* Weapon switch buttons (on-foot only) */}
      {!inVehicle && (
        <div className="pointer-events-auto absolute right-3 top-24 flex flex-col gap-1">
          {([1, 2, 3, 4, 5] as const).map((n) => (
            <button
              key={n}
              className="h-9 w-9 rounded border border-[hsl(var(--hud)/0.5)] bg-background/70 text-xs font-bold text-[hsl(var(--hud))] backdrop-blur-sm active:bg-[hsl(var(--hud))] active:text-[hsl(var(--hud-foreground))]"
              onTouchStart={(e) => {
                e.preventDefault();
                input.current?.pressSwitchWeapon(n);
              }}
              onClick={() => input.current?.pressSwitchWeapon(n)}
            >
              {n}
            </button>
          ))}
        </div>
      )}
    </>
  );
}

function VehicleSpeedometer() {
  const vehicles = useGame((s) => s.vehicles);
  const vehicleId = useGame((s) => s.playerInVehicle);
  const v = vehicleId ? vehicles.find((x) => x.id === vehicleId) : null;
  if (!v) return null;
  const speed = Math.round(Math.hypot(v.vel.x, v.vel.z) * 3.6); // convert to "km/h" feel
  const hpPct = Math.round((v.hp / v.hpMax) * 100);
  return (
    <div className="pointer-events-none absolute bottom-6 left-1/2 -translate-x-1/2 rounded border border-[hsl(var(--ammo)/0.4)] bg-background/70 px-4 py-2 backdrop-blur-sm text-center">
      <div className="text-2xl font-bold tabular-nums text-[hsl(var(--ammo))]">{speed} <span className="text-xs">km/h</span></div>
      <div className="mt-1 h-1.5 w-24 overflow-hidden rounded-sm bg-background/60">
        <div
          className="h-full transition-all"
          style={{
            width: `${hpPct}%`,
            background: hpPct > 50 ? "hsl(var(--health))" : hpPct > 25 ? "hsl(var(--ammo))" : "hsl(var(--danger))",
          }}
        />
      </div>
      <div className="text-[8px] text-muted-foreground mt-0.5">HULL {hpPct}%</div>
    </div>
  );
}

function Joystick({
  side,
  onChange,
  onRelease,
}: {
  side: "left" | "right";
  onChange: (v: { x: number; y: number }) => void;
  onRelease: () => void;
}) {
  const baseRef = useRef<HTMLDivElement>(null);
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const [active, setActive] = useState(false);
  const touchId = useRef<number | null>(null);
  const baseRadius = 60;

  const handleStart = (e: React.TouchEvent) => {
    const t = e.changedTouches[0];
    touchId.current = t.identifier;
    setActive(true);
    update(t.clientX, t.clientY);
  };
  const handleMove = (e: React.TouchEvent) => {
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      if (t.identifier === touchId.current) {
        update(t.clientX, t.clientY);
        e.preventDefault();
      }
    }
  };
  const handleEnd = (e: React.TouchEvent) => {
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      if (t.identifier === touchId.current) {
        touchId.current = null;
        setActive(false);
        setKnob({ x: 0, y: 0 });
        onRelease();
      }
    }
  };
  const update = (cx: number, cy: number) => {
    const base = baseRef.current;
    if (!base) return;
    const r = base.getBoundingClientRect();
    const ox = r.left + r.width / 2;
    const oy = r.top + r.height / 2;
    let dx = cx - ox;
    let dy = cy - oy;
    const d = Math.hypot(dx, dy);
    if (d > baseRadius) {
      dx = (dx / d) * baseRadius;
      dy = (dy / d) * baseRadius;
    }
    setKnob({ x: dx, y: dy });
    onChange({ x: dx / baseRadius, y: -dy / baseRadius });
  };

  return (
    <div
      ref={baseRef}
      className={cn(
        "pointer-events-auto absolute bottom-24 h-32 w-32 rounded-full border-2 border-[hsl(var(--hud)/0.4)] bg-background/30 backdrop-blur-sm transition-opacity",
        side === "left" ? "left-6" : "right-6",
        active ? "opacity-100" : "opacity-70",
      )}
      onTouchStart={handleStart}
      onTouchMove={handleMove}
      onTouchEnd={handleEnd}
      onTouchCancel={handleEnd}
    >
      <div
        className="absolute left-1/2 top-1/2 h-12 w-12 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[hsl(var(--hud)/0.7)] shadow-lg"
        style={{ transform: `translate(calc(-50% + ${knob.x}px), calc(-50% + ${knob.y}px))` }}
      />
    </div>
  );
}

function LookPad({ onDelta }: { onDelta: (dx: number, dy: number) => void }) {
  const lastRef = useRef<{ x: number; y: number; id: number } | null>(null);
  const handleStart = (e: React.TouchEvent) => {
    const t = e.changedTouches[0];
    lastRef.current = { x: t.clientX, y: t.clientY, id: t.identifier };
  };
  const handleMove = (e: React.TouchEvent) => {
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      if (lastRef.current && t.identifier === lastRef.current.id) {
        const dx = t.clientX - lastRef.current.x;
        const dy = t.clientY - lastRef.current.y;
        onDelta(dx * 1.6, dy * 1.6);
        lastRef.current.x = t.clientX;
        lastRef.current.y = t.clientY;
        e.preventDefault();
      }
    }
  };
  const handleEnd = (e: React.TouchEvent) => {
    for (let i = 0; i < e.changedTouches.length; i++) {
      if (lastRef.current && e.changedTouches[i].identifier === lastRef.current.id) {
        lastRef.current = null;
      }
    }
  };
  return (
    <div
      className="pointer-events-auto absolute right-0 top-0 h-full w-1/2"
      onTouchStart={handleStart}
      onTouchMove={handleMove}
      onTouchEnd={handleEnd}
      onTouchCancel={handleEnd}
    />
  );
}

function AimToggle({ input }: { input: MutableRefObject<Input | null> }) {
  const [on, setOn] = useState(false);
  const aimT = useGame((s) => s.aimT);
  const toggle = () => {
    const next = !on;
    setOn(next);
    input.current?.setAim(next);
  };
  useEffect(() => {
    if (aimT < 0.05 && on) {
      // do nothing
    }
  }, [aimT, on]);
  return (
    <button
      className={cn(
        "pointer-events-auto h-16 w-16 rounded-full border-2 font-bold uppercase tracking-wider shadow-lg backdrop-blur-sm active:scale-95 text-xs",
        on
          ? "border-[hsl(var(--ammo))] bg-[hsl(var(--ammo)/0.85)] text-background"
          : "border-white/30 bg-[hsl(var(--hud)/0.7)] text-white",
      )}
      onTouchStart={(e) => {
        e.preventDefault();
        e.stopPropagation();
        toggle();
      }}
      onClick={(e) => {
        e.stopPropagation();
        toggle();
      }}
    >
      {on ? "● AIM" : "AIM"}
    </button>
  );
}

function TouchButton({
  label,
  color = "hsl(var(--hud))",
  big = false,
  onPress,
  onRelease,
  onTap,
}: {
  label: string;
  color?: string;
  big?: boolean;
  onPress?: () => void;
  onRelease?: () => void;
  onTap?: () => void;
}) {
  return (
    <button
      className={cn(
        "pointer-events-auto rounded-full border-2 border-white/30 font-bold uppercase tracking-wider text-white shadow-lg backdrop-blur-sm active:scale-95",
        big ? "h-20 w-20 text-sm" : "h-14 w-14 text-[10px]",
      )}
      style={{ background: `${color}` }}
      onTouchStart={(e) => {
        e.preventDefault();
        onPress?.();
        onTap?.();
      }}
      onTouchEnd={(e) => {
        e.preventDefault();
        onRelease?.();
      }}
      onMouseDown={() => {
        onPress?.();
        onTap?.();
      }}
      onMouseUp={() => onRelease?.()}
    >
      {label}
    </button>
  );
}

// ============= SCREENS =============
function Menu({ onStart, isMobile }: { onStart: () => void; isMobile: boolean }) {
  return (
    <div className="pointer-events-auto absolute inset-0 flex items-center justify-center bg-background/80 backdrop-blur-md overflow-y-auto py-6">
      <div className="max-w-md rounded-lg border border-[hsl(var(--hud)/0.5)] bg-background/90 p-8 shadow-2xl">
        <div className="text-center">
          <div className="text-xs uppercase tracking-[0.4em] text-[hsl(var(--hud))]">24 vs 24 Skirmish</div>
          <h1 className="mt-2 text-4xl font-bold tracking-tight">DESERT STRIKE</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            あなたはBLUE分隊。RED軍より先にスコア達成で勝利。
          </p>
        </div>
        <div className="mt-6 space-y-2 rounded border border-border/40 bg-background/60 p-4 text-sm">
          {isMobile ? (
            <>
              <Row label="移動" keys="左スティック" />
              <Row label="視点" keys="右画面ドラッグ" />
              <Row label="撃つ / エイム" keys="FIRE / AIM" />
              <Row label="ジャンプ / リロード" keys="JUMP / RELOAD" />
              <Row label="拾う / 乗車" keys="PICK UP / ENTER" />
              <Row label="武器切替" keys="右側 1〜5" />
              <Row label="マップ全体" keys="MAPボタン" />
            </>
          ) : (
            <>
              <Row label="Move" keys="W A S D" />
              <Row label="Sprint" keys="Shift" />
              <Row label="Jump" keys="Space" />
              <Row label="Fire / Aim" keys="L-Mouse / R-Mouse" />
              <Row label="Reload / Pick up" keys="R / E" />
              <Row label="Vehicle" keys="F (enter/exit)" />
              <Row label="Full Map" keys="M (zoomable)" />
              <Row label="Weapons" keys="1 Rifle · 2 Pistol · 3 Nade · 4 SMG · 5 Sniper" />
            </>
          )}
        </div>

        <button
          onClick={onStart}
          className="mt-4 w-full rounded bg-[hsl(var(--hud))] px-6 py-3 text-sm font-bold uppercase tracking-[0.3em] text-[hsl(var(--hud-foreground))] transition-transform hover:scale-[1.02] active:scale-[0.98]"
        >
          ▶ Deploy
        </button>
        {!isMobile && (
          <p className="mt-3 text-center text-[10px] uppercase tracking-widest text-muted-foreground">
            Click to capture mouse · ESC to release
          </p>
        )}
      </div>
    </div>
  );
}

function DeathScreen({
  onRestart,
  score,
  kills,
  blueScore,
  redScore,
  headshots,
}: {
  onRestart: () => void;
  score: number;
  kills: number;
  blueScore: number;
  redScore: number;
  headshots: number;
}) {
  return (
    <div className="pointer-events-auto absolute inset-0 flex items-center justify-center bg-background/80 backdrop-blur-md">
      <div className="max-w-md rounded-lg border border-[hsl(var(--danger)/0.5)] bg-background/90 p-8 text-center shadow-2xl">
        <div className="text-xs uppercase tracking-[0.4em] text-[hsl(var(--danger))]">KIA</div>
        <h1 className="mt-2 text-5xl font-bold tracking-tight">YOU DIED</h1>
        <div className="mt-6 grid grid-cols-2 gap-3 text-left">
          <Stat label="Blue" value={blueScore} />
          <Stat label="Red" value={redScore} />
          <Stat label="Kills" value={kills} />
          <Stat label="Headshots" value={headshots} />
          <Stat label="Score" value={score} />
        </div>
        <button
          onClick={onRestart}
          className="mt-6 w-full rounded bg-[hsl(var(--hud))] px-6 py-3 text-sm font-bold uppercase tracking-[0.3em] text-[hsl(var(--hud-foreground))] hover:scale-[1.02] active:scale-[0.98]"
        >
          ▶ Redeploy
        </button>
      </div>
    </div>
  );
}

function WinScreen({
  onRestart,
  score,
  kills,
  won,
  headshots,
}: {
  onRestart: () => void;
  score: number;
  kills: number;
  won: boolean;
  headshots: number;
}) {
  return (
    <div className="pointer-events-auto absolute inset-0 flex items-center justify-center bg-background/80 backdrop-blur-md">
      <div
        className={cn(
          "max-w-md rounded-lg border bg-background/90 p-8 text-center shadow-2xl",
          won ? "border-[hsl(var(--health)/0.6)]" : "border-[hsl(var(--danger)/0.5)]",
        )}
      >
        <div
          className={cn(
            "text-xs uppercase tracking-[0.4em]",
            won ? "text-[hsl(var(--health))]" : "text-[hsl(var(--danger))]",
          )}
        >
          {won ? "VICTORY" : "DEFEAT"}
        </div>
        <h1 className="mt-2 text-5xl font-bold tracking-tight">{won ? "BLUE WINS" : "RED WINS"}</h1>
        <div className="mt-6 grid grid-cols-2 gap-3 text-left">
          <Stat label="Kills" value={kills} />
          <Stat label="Headshots" value={headshots} />
          <Stat label="Score" value={score} />
        </div>
        <button
          onClick={onRestart}
          className="mt-6 w-full rounded bg-[hsl(var(--hud))] px-6 py-3 text-sm font-bold uppercase tracking-[0.3em] text-[hsl(var(--hud-foreground))] hover:scale-[1.02] active:scale-[0.98]"
        >
          ▶ Play Again
        </button>
      </div>
    </div>
  );
}

// === LOADOUT SCREEN ===
function LoadoutScreen({ onStart, isMobile }: { onStart: (loadout: Loadout) => void; isMobile: boolean }) {
  const [soldierClass, setSoldierClass] = useState<SoldierClass>("assault");
  const classSpec = CLASSES[soldierClass];
  const [primary, setPrimary] = useState<WeaponId>(classSpec.primary);
  const [secondary, setSecondary] = useState<WeaponId>(classSpec.secondary);
  const [grenadeCount, setGrenadeCount] = useState(classSpec.grenadeCount);
  const [smokeCount, setSmokeCount] = useState(classSpec.smokeCount);
  // Default deployment: the home base (index 0).
  const [spawnIndex, setSpawnIndex] = useState(0);

  const spawnDefs = GameEngine.SPAWN_DEFS;
  const allClasses: SoldierClass[] = ["assault", "sniper", "support", "medic"];
  const primaries: WeaponId[] = ["rifle", "smg", "sniper"];
  const secondaries: WeaponId[] = ["pistol", "smg"];

  const selectClass = (cls: SoldierClass) => {
    setSoldierClass(cls);
    const spec = CLASSES[cls];
    setPrimary(spec.primary);
    setSecondary(spec.secondary);
    setGrenadeCount(spec.grenadeCount);
    setSmokeCount(spec.smokeCount);
  };

  const handleDeploy = () => {
    onStart({ primary, secondary, grenadeCount, smokeCount, soldierClass, spawnIndex });
  };

  return (
    <div className="pointer-events-auto absolute inset-0 flex items-center justify-center bg-background/80 backdrop-blur-md">
      <div className="max-w-lg rounded-lg border border-[hsl(var(--hud)/0.5)] bg-background/90 p-8 shadow-2xl overflow-y-auto max-h-[90vh]">
        <div className="text-center">
          <div className="text-xs uppercase tracking-[0.4em] text-[hsl(var(--hud))]">クラス & ロードアウト選択</div>
          <h1 className="mt-2 text-3xl font-bold tracking-tight">LOADOUT</h1>
        </div>

        <div className="mt-6 space-y-4">
          {/* Class Selection */}
          <div>
            <div className="text-xs uppercase tracking-widest text-muted-foreground mb-2">Class</div>
            <div className="grid grid-cols-2 gap-2">
              {allClasses.map((cls) => {
                const spec = CLASSES[cls];
                return (
                  <button
                    key={cls}
                    onClick={() => selectClass(cls)}
                    className={cn(
                      "rounded border px-3 py-3 text-left text-xs transition-all",
                      soldierClass === cls
                        ? "border-[hsl(var(--hud))] bg-[hsl(var(--hud))] text-[hsl(var(--hud-foreground))]"
                        : "border-border/40 bg-background/60 text-muted-foreground hover:border-[hsl(var(--hud)/0.5)]",
                    )}
                  >
                    <div className="font-bold uppercase tracking-wider">{spec.name}</div>
                    <div className="mt-1 text-[10px] opacity-80">HP {spec.hpMax} · SPD ×{spec.speedMult}</div>
                    <div className="mt-0.5 text-[10px] opacity-70">{spec.abilityDesc}</div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Primary Weapon */}
          <div>
            <div className="text-xs uppercase tracking-widest text-muted-foreground mb-2">Primary Weapon</div>
            <div className="flex gap-2">
              {primaries.map((id) => (
                <button
                  key={id}
                  onClick={() => setPrimary(id)}
                  className={cn(
                    "flex-1 rounded border px-3 py-3 text-center text-xs font-bold uppercase tracking-wider transition-all",
                    primary === id
                      ? "border-[hsl(var(--hud))] bg-[hsl(var(--hud))] text-[hsl(var(--hud-foreground))]"
                      : "border-border/40 bg-background/60 text-muted-foreground hover:border-[hsl(var(--hud)/0.5)]",
                  )}
                >
                  <div>{WEAPONS[id].name}</div>
                  <div className="mt-1 text-[10px] opacity-70">DMG {WEAPONS[id].damage} · HS ×{WEAPONS[id].headshotMultiplier}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Secondary Weapon */}
          <div>
            <div className="text-xs uppercase tracking-widest text-muted-foreground mb-2">Secondary Weapon</div>
            <div className="flex gap-2">
              {secondaries.map((id) => (
                <button
                  key={id}
                  onClick={() => setSecondary(id)}
                  className={cn(
                    "flex-1 rounded border px-3 py-3 text-center text-xs font-bold uppercase tracking-wider transition-all",
                    secondary === id
                      ? "border-[hsl(var(--hud))] bg-[hsl(var(--hud))] text-[hsl(var(--hud-foreground))]"
                      : "border-border/40 bg-background/60 text-muted-foreground hover:border-[hsl(var(--hud)/0.5)]",
                  )}
                >
                  <div>{WEAPONS[id].name}</div>
                  <div className="mt-1 text-[10px] opacity-70">DMG {WEAPONS[id].damage}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Grenades */}
          <div className="flex gap-4">
            <div className="flex-1">
              <div className="text-xs uppercase tracking-widest text-muted-foreground mb-2">Frag Grenades</div>
              <div className="flex gap-1">
                {[1, 2, 3, 4].map((n) => (
                  <button
                    key={n}
                    onClick={() => setGrenadeCount(n)}
                    className={cn(
                      "flex-1 rounded border px-2 py-2 text-center text-sm font-bold",
                      grenadeCount === n
                        ? "border-[hsl(var(--hud))] bg-[hsl(var(--hud))] text-[hsl(var(--hud-foreground))]"
                        : "border-border/40 bg-background/60 text-muted-foreground",
                    )}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex-1">
              <div className="text-xs uppercase tracking-widest text-muted-foreground mb-2">Smoke Grenades</div>
              <div className="flex gap-1">
                {[0, 1, 2, 3].map((n) => (
                  <button
                    key={n}
                    onClick={() => setSmokeCount(n)}
                    className={cn(
                      "flex-1 rounded border px-2 py-2 text-center text-sm font-bold",
                      smokeCount === n
                        ? "border-[hsl(var(--hud))] bg-[hsl(var(--hud))] text-[hsl(var(--hud-foreground))]"
                        : "border-border/40 bg-background/60 text-muted-foreground",
                    )}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Spawn point selection */}
          <div>
            <div className="text-xs uppercase tracking-widest text-muted-foreground mb-2">
              Deploy Point / 出撃地点
            </div>
            <div className="grid grid-cols-1 gap-2">
              {spawnDefs.map((sp, i) => (
                <button
                  key={sp.name}
                  onClick={() => setSpawnIndex(i)}
                  className={cn(
                    "rounded border px-3 py-2.5 text-left text-xs transition-all",
                    spawnIndex === i
                      ? "border-[hsl(var(--hud))] bg-[hsl(var(--hud))] text-[hsl(var(--hud-foreground))]"
                      : "border-border/40 bg-background/60 text-muted-foreground hover:border-[hsl(var(--hud)/0.5)]",
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span className="font-bold uppercase tracking-wider">{sp.name}</span>
                    {sp.frontline && (
                      <span
                        className={cn(
                          "rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider",
                          spawnIndex === i
                            ? "bg-[hsl(var(--hud-foreground)/0.2)] text-[hsl(var(--hud-foreground))]"
                            : "bg-red-500/20 text-red-400",
                        )}
                      >
                        ⚔ 最前線
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 text-[10px] opacity-75">{sp.desc}</div>
                </button>
              ))}
            </div>
          </div>
        </div>

        <button
          onClick={handleDeploy}
          className="mt-6 w-full rounded bg-[hsl(var(--hud))] px-6 py-3 text-sm font-bold uppercase tracking-[0.3em] text-[hsl(var(--hud-foreground))] transition-transform hover:scale-[1.02] active:scale-[0.98]"
        >
          ▶ Deploy as {CLASSES[soldierClass].name} @ {spawnDefs[spawnIndex].name}
        </button>
      </div>
    </div>
  );
}

// === SHARED MAP RENDER HELPERS ===
type Vec2 = { x: number; z: number };
type MapSoldier = { pos: Vec2; team: string; alive: boolean };
type MapVehicle = { pos: Vec2; destroyed: boolean; kind: string; team?: string | null };
type MapCapture = { pos: Vec2; owner: string | null; name: string; radius?: number };
type MapSmoke = { pos: Vec2; radius: number };
type MapPickup = { pos: Vec2; kind: string; taken: boolean };

const PICKUP_COLOR: Record<string, string> = {
  weapon: "#c084fc",
  ammo: "#ffd24a",
  health: "#5ee06a",
  grenade: "#ff9a3c",
};

// Renders the static world (ground, roads, building footprints, hills, trees,
// landmarks) plus dynamic actors into an <svg>, given a world→screen transform.
function MapGeometry({
  mapData,
  toX,
  toY,
  scale,
  detail,
}: {
  mapData: MapData;
  toX: (wx: number) => number;
  toY: (wz: number) => number;
  scale: number; // pixels per world unit
  detail: "low" | "high";
}) {
  return (
    <>
      {/* Hills / elevation blobs */}
      {mapData.hills.map((h, i) => (
        <circle key={`hill-${i}`} cx={toX(h.x)} cy={toY(h.z)} r={h.r * scale} fill="rgba(150,120,70,0.18)" />
      ))}

      {/* Roads */}
      {mapData.roads.map((r, i) => (
        <rect
          key={`road-${i}`}
          x={toX(r.cx) - r.hw * scale}
          y={toY(r.cz) - r.hd * scale}
          width={r.hw * 2 * scale}
          height={r.hd * 2 * scale}
          fill="rgba(60,52,38,0.85)"
        />
      ))}

      {/* Trees (only in high detail to avoid clutter) */}
      {detail === "high" &&
        mapData.trees.map((t, i) => (
          <circle key={`tree-${i}`} cx={toX(t.x)} cy={toY(t.z)} r={Math.max(1, t.r * scale)} fill="rgba(70,110,55,0.65)" />
        ))}

      {/* Containers */}
      {mapData.containers.map((c, i) => (
        <rect
          key={`cont-${i}`}
          x={toX(c.cx) - c.hw * scale}
          y={toY(c.cz) - c.hd * scale}
          width={Math.max(1, c.hw * 2 * scale)}
          height={Math.max(1, c.hd * 2 * scale)}
          fill="rgba(120,130,140,0.7)"
        />
      ))}

      {/* Building footprints */}
      {mapData.buildings.map((b, i) => (
        <rect
          key={`b-${i}`}
          x={toX(b.cx) - b.hw * scale}
          y={toY(b.cz) - b.hd * scale}
          width={Math.max(1, b.hw * 2 * scale)}
          height={Math.max(1, b.hd * 2 * scale)}
          fill={b.tall ? "rgba(180,168,140,0.92)" : "rgba(150,138,110,0.78)"}
          stroke="rgba(40,34,24,0.6)"
          strokeWidth={detail === "high" ? 0.6 : 0}
        />
      ))}
    </>
  );
}

function MapActors({
  toX,
  toY,
  scale,
  soldiers,
  vehicles,
  capturePoints,
  smokeClouds,
  pickups,
  playerPos,
  playerYaw,
  soldierR,
  showPickups,
}: {
  toX: (wx: number) => number;
  toY: (wz: number) => number;
  scale: number;
  soldiers: MapSoldier[];
  vehicles: MapVehicle[];
  capturePoints: MapCapture[];
  smokeClouds: MapSmoke[];
  pickups: MapPickup[];
  playerPos: Vec2;
  playerYaw: number;
  soldierR: number;
  showPickups: boolean;
}) {
  return (
    <>
      {/* Capture point radius rings */}
      {capturePoints.map((cp, i) => (
        <g key={`cpr-${i}`}>
          {cp.radius ? (
            <circle
              cx={toX(cp.pos.x)}
              cy={toY(cp.pos.z)}
              r={cp.radius * scale}
              fill={cp.owner === "blue" ? "rgba(68,136,255,0.10)" : cp.owner === "red" ? "rgba(255,68,68,0.10)" : "rgba(150,150,150,0.08)"}
              stroke={cp.owner === "blue" ? "rgba(68,136,255,0.5)" : cp.owner === "red" ? "rgba(255,68,68,0.5)" : "rgba(150,150,150,0.4)"}
              strokeWidth={1}
              strokeDasharray="4 3"
            />
          ) : null}
        </g>
      ))}

      {/* Smoke clouds */}
      {smokeClouds.map((sc, i) => (
        <circle key={`smk-${i}`} cx={toX(sc.pos.x)} cy={toY(sc.pos.z)} r={Math.max(2, sc.radius * scale)} fill="rgba(210,210,210,0.4)" />
      ))}

      {/* Pickups */}
      {showPickups &&
        pickups.filter((p) => !p.taken).map((p, i) => (
          <rect
            key={`pk-${i}`}
            x={toX(p.pos.x) - 2.5}
            y={toY(p.pos.z) - 2.5}
            width={5}
            height={5}
            rx={1}
            fill={PICKUP_COLOR[p.kind] || "#fff"}
            opacity={0.85}
          />
        ))}

      {/* Capture point markers */}
      {capturePoints.map((cp, i) => {
        const sx = toX(cp.pos.x);
        const sy = toY(cp.pos.z);
        return (
          <g key={`cp-${i}`}>
            <rect
              x={sx - 6} y={sy - 6} width={12} height={12}
              fill={cp.owner === "blue" ? "rgba(68,136,255,0.45)" : cp.owner === "red" ? "rgba(255,68,68,0.45)" : "rgba(120,120,120,0.35)"}
              stroke={cp.owner === "blue" ? "#4488ff" : cp.owner === "red" ? "#ff4444" : "#aaa"}
              strokeWidth={1.5}
            />
            <text x={sx} y={sy + 3} textAnchor="middle" fill="#fff" fontSize={8} fontWeight="bold">{cp.name}</text>
          </g>
        );
      })}

      {/* Vehicles */}
      {vehicles.filter((v) => !v.destroyed).map((v, i) => (
        <rect
          key={`v-${i}`}
          x={toX(v.pos.x) - 4}
          y={toY(v.pos.z) - 4}
          width={8}
          height={8}
          rx={1.5}
          fill="#ffaa20"
          stroke="#7a5200"
          strokeWidth={1}
          opacity={0.95}
        />
      ))}

      {/* Soldiers */}
      {soldiers.filter((s) => s.alive).map((s, i) => (
        <circle
          key={`s-${i}`}
          cx={toX(s.pos.x)}
          cy={toY(s.pos.z)}
          r={soldierR}
          fill={s.team === "blue" ? "#4488ff" : "#ff4444"}
          stroke="rgba(0,0,0,0.5)"
          strokeWidth={0.6}
          opacity={0.95}
        />
      ))}

      {/* Player arrow */}
      <g transform={`translate(${toX(playerPos.x)}, ${toY(playerPos.z)}) rotate(${(-playerYaw * 180) / Math.PI})`}>
        <polygon points="0,-8 5,5 -5,5" fill="#44ff44" stroke="#0a3" strokeWidth={1} />
      </g>
    </>
  );
}

// === MINIMAP ===
function Minimap({
  playerPos,
  playerYaw,
  soldiers,
  smokeClouds,
  capturePoints,
  vehicles,
  pickups,
  mapData,
}: {
  playerPos: Vec2;
  playerYaw: number;
  soldiers: MapSoldier[];
  smokeClouds: MapSmoke[];
  capturePoints: MapCapture[];
  vehicles: MapVehicle[];
  pickups: MapPickup[];
  mapData: MapData;
}) {
  const size = 158;
  const range = 110; // world units shown across the minimap
  const scale = size / range;

  // Player-centred, north-up projection.
  const toX = (wx: number) => (wx - playerPos.x) * scale + size / 2;
  const toY = (wz: number) => (wz - playerPos.z) * scale + size / 2;

  const clipId = "minimap-clip";

  return (
    <div
      className="pointer-events-none absolute top-20 right-4 overflow-hidden rounded-lg border border-[hsl(var(--hud)/0.45)] bg-[#1c1810]/80 backdrop-blur-sm shadow-lg"
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <defs>
          <clipPath id={clipId}>
            <rect x={0} y={0} width={size} height={size} />
          </clipPath>
        </defs>
        <g clipPath={`url(#${clipId})`}>
          {/* Sand backdrop */}
          <rect x={0} y={0} width={size} height={size} fill="#3a3320" />
          <MapGeometry mapData={mapData} toX={toX} toY={toY} scale={scale} detail="low" />
          <MapActors
            toX={toX}
            toY={toY}
            scale={scale}
            soldiers={soldiers}
            vehicles={vehicles}
            capturePoints={capturePoints}
            smokeClouds={smokeClouds}
            pickups={pickups}
            playerPos={playerPos}
            playerYaw={playerYaw}
            soldierR={2.6}
            showPickups={false}
          />
        </g>
        <rect x={0} y={0} width={size} height={size} fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth={1} />
      </svg>
      <div className="absolute bottom-1 left-1 text-[8px] uppercase tracking-widest text-muted-foreground">
        MAP · [M]
      </div>
    </div>
  );
}

// === FULL-SCREEN TACTICAL MAP ===
function FullMap({
  playerPos,
  playerYaw,
  soldiers,
  capturePoints,
  vehicles,
  pickups,
  smokeClouds,
  mapData,
  isMobile,
  onClose,
}: {
  playerPos: Vec2;
  playerYaw: number;
  soldiers: MapSoldier[];
  capturePoints: MapCapture[];
  vehicles: MapVehicle[];
  pickups: MapPickup[];
  smokeClouds: MapSmoke[];
  mapData: MapData;
  isMobile: boolean;
  onClose: () => void;
}) {
  const world = mapData.worldSize;
  const half = world / 2;
  const viewport = 640; // logical svg size

  // zoom: 1 = whole world fits; higher = zoomed in. center is in world coords.
  const [zoom, setZoom] = useState(1);
  const [center, setCenter] = useState<Vec2>({ x: playerPos.x, z: playerPos.z });
  const dragRef = useRef<{ x: number; y: number; cx: number; cz: number; id: number | null } | null>(null);

  const minZoom = 0.6;
  const maxZoom = 6;

  // world units visible across the viewport at current zoom
  const span = world / zoom;
  const scale = viewport / span; // px per world unit

  const toX = (wx: number) => (wx - center.x) * scale + viewport / 2;
  const toY = (wz: number) => (wz - center.z) * scale + viewport / 2;

  const clampCenter = useCallback(
    (c: Vec2, z: number): Vec2 => {
      const visHalf = world / z / 2;
      const lim = Math.max(0, half - visHalf);
      return {
        x: Math.max(-lim, Math.min(lim, c.x)),
        z: Math.max(-lim, Math.min(lim, c.z)),
      };
    },
    [world, half],
  );

  const applyZoom = useCallback(
    (factor: number) => {
      setZoom((z) => {
        const nz = Math.max(minZoom, Math.min(maxZoom, z * factor));
        setCenter((c) => clampCenter(c, nz));
        return nz;
      });
    },
    [clampCenter],
  );

  // ESC / M to close
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Escape" || e.code === "KeyM") {
        e.preventDefault();
        onClose();
      } else if (e.code === "Equal" || e.code === "NumpadAdd") {
        applyZoom(1.25);
      } else if (e.code === "Minus" || e.code === "NumpadSubtract") {
        applyZoom(0.8);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, applyZoom]);

  const svgRef = useRef<SVGSVGElement>(null);
  // Active touch points for pinch-to-zoom
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchRef = useRef<{ dist: number; zoom: number } | null>(null);

  const screenToWorldDelta = (dxPx: number, dyPx: number) => {
    const el = svgRef.current;
    if (!el) return { x: 0, z: 0 };
    const rect = el.getBoundingClientRect();
    const pxScale = rect.width / viewport; // css px per logical unit
    return { x: dxPx / (scale * pxScale), z: dyPx / (scale * pxScale) };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointersRef.current.size === 1) {
      dragRef.current = { x: e.clientX, y: e.clientY, cx: center.x, cz: center.z, id: e.pointerId };
    } else if (pointersRef.current.size === 2) {
      // start pinch
      const pts = [...pointersRef.current.values()];
      pinchRef.current = { dist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y), zoom };
      dragRef.current = null;
    }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (pointersRef.current.has(e.pointerId)) {
      pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }
    // Pinch zoom takes priority when two fingers are down
    if (pointersRef.current.size >= 2 && pinchRef.current) {
      const pts = [...pointersRef.current.values()];
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const ratio = dist / (pinchRef.current.dist || 1);
      const nz = Math.max(minZoom, Math.min(maxZoom, pinchRef.current.zoom * ratio));
      setZoom(nz);
      setCenter((c) => clampCenter(c, nz));
      return;
    }
    const d = dragRef.current;
    if (!d || d.id !== e.pointerId) return;
    const wd = screenToWorldDelta(e.clientX - d.x, e.clientY - d.y);
    setCenter(clampCenter({ x: d.cx - wd.x, z: d.cz - wd.z }, zoom));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    pointersRef.current.delete(e.pointerId);
    if (pointersRef.current.size < 2) pinchRef.current = null;
    if (dragRef.current?.id === e.pointerId) dragRef.current = null;
  };
  const onWheel = (e: React.WheelEvent) => {
    applyZoom(e.deltaY < 0 ? 1.15 : 0.87);
  };

  return (
    <div className="pointer-events-auto absolute inset-0 z-40 flex items-center justify-center bg-background/85 backdrop-blur-md">
      <div className="relative flex max-h-[94vh] w-full max-w-[760px] flex-col px-4">
        {/* Header */}
        <div className="mb-2 flex items-center justify-between">
          <div>
            <div className="text-[10px] uppercase tracking-[0.3em] text-[hsl(var(--hud))]">Tactical Map</div>
            <div className="text-[9px] text-muted-foreground">
              {isMobile ? "ドラッグで移動 · ピンチ/ボタンでズーム" : "Drag to pan · Wheel / +- to zoom · [M] or [Esc] to close"}
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded border border-[hsl(var(--hud)/0.5)] bg-background/70 px-3 py-1.5 text-xs font-bold uppercase tracking-widest text-[hsl(var(--hud))] hover:bg-[hsl(var(--hud))] hover:text-[hsl(var(--hud-foreground))]"
          >
            ✕ Close
          </button>
        </div>

        {/* Map surface */}
        <div className="relative aspect-square w-full overflow-hidden rounded-lg border border-[hsl(var(--hud)/0.4)] bg-[#1c1810] shadow-2xl">
          <svg
            ref={svgRef}
            width="100%"
            height="100%"
            viewBox={`0 0 ${viewport} ${viewport}`}
            className="touch-none"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onWheel={onWheel}
            style={{ cursor: "grab" }}
          >
            {/* World extents backdrop */}
            <rect
              x={toX(-half)}
              y={toY(-half)}
              width={world * scale}
              height={world * scale}
              fill="#3a3320"
              stroke="rgba(255,255,255,0.12)"
              strokeWidth={2}
            />

            <MapGeometry mapData={mapData} toX={toX} toY={toY} scale={scale} detail="high" />

            {/* Landmark labels */}
            {mapData.landmarks.map((lm, i) => (
              <g key={`lm-${i}`}>
                <circle cx={toX(lm.x)} cy={toY(lm.z)} r={3} fill="rgba(255,255,255,0.5)" />
                <text
                  x={toX(lm.x)}
                  y={toY(lm.z) - 7}
                  textAnchor="middle"
                  fill="rgba(255,255,255,0.7)"
                  fontSize={11}
                  fontWeight="bold"
                  style={{ letterSpacing: "1px" }}
                >
                  {lm.name}
                </text>
              </g>
            ))}

            <MapActors
              toX={toX}
              toY={toY}
              scale={scale}
              soldiers={soldiers}
              vehicles={vehicles}
              capturePoints={capturePoints}
              smokeClouds={smokeClouds}
              pickups={pickups}
              playerPos={playerPos}
              playerYaw={playerYaw}
              soldierR={3.5}
              showPickups
            />
          </svg>

          {/* Zoom controls */}
          <div className="absolute bottom-3 right-3 flex flex-col gap-1">
            <button
              onClick={() => applyZoom(1.25)}
              className="h-9 w-9 rounded border border-[hsl(var(--hud)/0.5)] bg-background/80 text-lg font-bold text-[hsl(var(--hud))] active:bg-[hsl(var(--hud))] active:text-[hsl(var(--hud-foreground))]"
            >
              +
            </button>
            <button
              onClick={() => applyZoom(0.8)}
              className="h-9 w-9 rounded border border-[hsl(var(--hud)/0.5)] bg-background/80 text-lg font-bold text-[hsl(var(--hud))] active:bg-[hsl(var(--hud))] active:text-[hsl(var(--hud-foreground))]"
            >
              −
            </button>
            <button
              onClick={() => { setZoom(1); setCenter(clampCenter({ x: playerPos.x, z: playerPos.z }, 1)); }}
              className="h-9 w-9 rounded border border-[hsl(var(--hud)/0.5)] bg-background/80 text-[9px] font-bold uppercase text-[hsl(var(--hud))] active:bg-[hsl(var(--hud))] active:text-[hsl(var(--hud-foreground))]"
            >
              FIT
            </button>
          </div>

          {/* Legend */}
          <div className="absolute bottom-3 left-3 flex flex-wrap gap-x-3 gap-y-1 rounded bg-background/60 px-2 py-1.5 text-[9px] backdrop-blur-sm">
            <LegendDot color="#44ff44" label="YOU" />
            <LegendDot color="#4488ff" label="BLUE" />
            <LegendDot color="#ff4444" label="RED" />
            <LegendDot color="#ffaa20" label="VEHICLE" square />
            <LegendDot color="#5ee06a" label="LOOT" square />
          </div>
        </div>
      </div>
    </div>
  );
}

function LegendDot({ color, label, square }: { color: string; label: string; square?: boolean }) {
  return (
    <div className="flex items-center gap-1 text-muted-foreground">
      <span
        className={square ? "inline-block h-2.5 w-2.5 rounded-[2px]" : "inline-block h-2.5 w-2.5 rounded-full"}
        style={{ background: color }}
      />
      <span className="uppercase tracking-wider">{label}</span>
    </div>
  );
}

function Row({ label, keys }: { label: string; keys: string }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="uppercase tracking-widest text-muted-foreground">{label}</span>
      <span className="font-mono text-[hsl(var(--hud))]">{keys}</span>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded border border-border/40 bg-background/60 p-3">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-bold tabular-nums">{value}</div>
    </div>
  );
}
