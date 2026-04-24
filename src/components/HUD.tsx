import { useEffect, useRef, useState, MutableRefObject, useCallback } from "react";
import { useGame, store } from "@/game/store";
import { WEAPONS } from "@/game/weapons";
import { Input } from "@/game/input";
import { cn } from "@/lib/utils";
import { WORLD_SIZE } from "@/game/world";
import { CLASSES } from "@/game/classes";
import type { WeaponId, Loadout, SoldierClass } from "@/game/types";

interface Props {
  onStart: () => void;
  onStartGame: (loadout?: Loadout) => void;
  input?: MutableRefObject<Input | null>;
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
  const playerClass = useGame((s) => s.loadout.soldierClass);

  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    setIsMobile(detectMobile());
  }, []);

  const w = weapons[currentWeapon];
  const isSniperScope = (currentWeapon === "rifle" || currentWeapon === "sniper") && aimT > 0.5;
  const nearbyPickup = nearbyPickupId ? pickups.find((p) => p.id === nearbyPickupId) : null;
  const nearbyVehicle = nearbyVehicleId ? vehicles.find((v) => v.id === nearbyVehicleId) : null;

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

      {status === "playing" && aimT < 0.5 && (
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
            {isMobile ? "左スティック:操縦 · EXIT:降車" : "WASD to drive · F to exit"}
          </div>
        </div>
      )}

      {/* Pickup prompt */}
      {status === "playing" && nearbyPickup && !playerInVehicle && (
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
      {status === "playing" && nearbyVehicle && !playerInVehicle && !nearbyPickup && (
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
      {status === "playing" && !playerInVehicle && (
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
        <MobileControls input={input} hasPickup={!!nearbyPickup} hasVehicle={!!nearbyVehicle} inVehicle={!!playerInVehicle} />
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
        />
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
}: {
  input: MutableRefObject<Input | null>;
  hasPickup: boolean;
  hasVehicle: boolean;
  inVehicle: boolean;
}) {
  return (
    <>
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
            あなたはBLUE分隊。RED軍より先にスコア達成で勝利。オンラインで友達のCPU枠を置き換えよう。
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
            </>
          ) : (
            <>
              <Row label="Move" keys="W A S D" />
              <Row label="Sprint" keys="Shift" />
              <Row label="Jump" keys="Space" />
              <Row label="Fire / Aim" keys="L-Mouse / R-Mouse" />
              <Row label="Reload / Pick up" keys="R / E" />
              <Row label="Vehicle" keys="F (enter/exit)" />
              <Row label="Weapons" keys="1 Rifle · 2 Pistol · 3 Nade · 4 SMG · 5 Sniper" />
            </>
          )}
        </div>

        <OnlinePanel />

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

function OnlinePanel() {
  const [mode, setMode] = useState<"solo" | "host" | "client">("solo");
  const [code, setCode] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [peers, setPeers] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Lazy-load NetManager so non-online users don't pay for it.
  const netRef = useRef<typeof import("@/net/net").NetManager | null>(null);
  const ensureNet = async () => {
    if (!netRef.current) {
      const mod = await import("@/net/net");
      netRef.current = mod.NetManager;
      mod.NetManager.onEvent = (ev) => {
        if (ev.kind === "clientJoined" || ev.kind === "clientLeft") {
          setPeers([...mod.NetManager.connectedPeers]);
        } else if (ev.kind === "error") {
          setErr(String(ev.data?.message || "error"));
        }
      };
    }
    return netRef.current!;
  };

  const host = async () => {
    setBusy(true); setErr(null);
    try {
      const net = await ensureNet();
      const id = await net.hostRoom();
      setCode(id);
      setMode("host");
    } catch (e: any) {
      setErr(e?.message || String(e));
    }
    setBusy(false);
  };
  const join = async () => {
    if (!joinCode.trim()) return;
    setBusy(true); setErr(null);
    try {
      const net = await ensureNet();
      await net.joinRoom(joinCode.trim());
      setMode("client");
    } catch (e: any) {
      setErr(e?.message || String(e));
    }
    setBusy(false);
  };
  const leave = async () => {
    const net = netRef.current;
    net?.leave();
    setMode("solo");
    setCode("");
    setPeers([]);
  };

  return (
    <div className="mt-5 rounded border border-[hsl(var(--accent)/0.4)] bg-background/40 p-3">
      <div className="mb-2 flex items-center justify-between text-[10px] uppercase tracking-widest">
        <span className="text-[hsl(var(--accent))]">ONLINE</span>
        <span className="text-muted-foreground">
          {mode === "solo" ? "ソロ" : mode === "host" ? `ホスト (${peers.length}人接続中)` : "クライアント"}
        </span>
      </div>
      {mode === "solo" && (
        <div className="space-y-2">
          <button
            onClick={host}
            disabled={busy}
            className="w-full rounded border border-[hsl(var(--accent))] bg-transparent px-3 py-2 text-xs font-bold uppercase tracking-widest text-[hsl(var(--accent))] hover:bg-[hsl(var(--accent)/0.15)] disabled:opacity-50"
          >
            🏠 ルームを作る (ホスト)
          </button>
          <div className="flex gap-2">
            <input
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value)}
              placeholder="ルームコードを入力"
              className="flex-1 rounded border border-border/50 bg-background/60 px-2 py-1 text-xs font-mono outline-none focus:border-[hsl(var(--accent))]"
            />
            <button
              onClick={join}
              disabled={busy || !joinCode.trim()}
              className="rounded border border-[hsl(var(--accent))] bg-transparent px-3 py-1 text-xs font-bold uppercase tracking-widest text-[hsl(var(--accent))] hover:bg-[hsl(var(--accent)/0.15)] disabled:opacity-50"
            >
              参加
            </button>
          </div>
          <p className="text-[9px] leading-snug text-muted-foreground">
            ホストが先にDeploy→ルームコードを共有→他の人が参加してDeploy。CPUの枠が人間に置き換わります。
          </p>
        </div>
      )}
      {mode === "host" && (
        <div className="space-y-2">
          <div className="rounded bg-background/60 p-2">
            <div className="text-[9px] uppercase text-muted-foreground">ルームコード (共有してください)</div>
            <div className="mt-1 flex items-center gap-2">
              <code className="flex-1 break-all rounded bg-background/80 px-2 py-1 text-[10px] font-mono">{code}</code>
              <button
                onClick={() => navigator.clipboard?.writeText(code)}
                className="rounded border border-border/60 px-2 py-1 text-[10px] uppercase hover:bg-background/80"
              >
                Copy
              </button>
            </div>
          </div>
          <button onClick={leave} className="w-full rounded border border-border/60 px-3 py-1 text-[10px] uppercase tracking-widest hover:bg-background/80">
            ルームを閉じる
          </button>
        </div>
      )}
      {mode === "client" && (
        <div className="space-y-2">
          <div className="rounded bg-background/60 p-2 text-[10px] text-muted-foreground">
            ホストに接続済み。Deployでマッチに参加します。
          </div>
          <button onClick={leave} className="w-full rounded border border-border/60 px-3 py-1 text-[10px] uppercase tracking-widest hover:bg-background/80">
            退出
          </button>
        </div>
      )}
      {err && <div className="mt-2 text-[10px] text-[hsl(var(--danger))]">⚠ {err}</div>}
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
    onStart({ primary, secondary, grenadeCount, smokeCount, soldierClass });
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
        </div>

        <button
          onClick={handleDeploy}
          className="mt-6 w-full rounded bg-[hsl(var(--hud))] px-6 py-3 text-sm font-bold uppercase tracking-[0.3em] text-[hsl(var(--hud-foreground))] transition-transform hover:scale-[1.02] active:scale-[0.98]"
        >
          ▶ Deploy as {CLASSES[soldierClass].name}
        </button>
      </div>
    </div>
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
}: {
  playerPos: { x: number; z: number };
  playerYaw: number;
  soldiers: Array<{ pos: { x: number; z: number }; team: string; alive: boolean }>;
  smokeClouds: Array<{ pos: { x: number; z: number }; radius: number }>;
  capturePoints: Array<{ pos: { x: number; z: number }; owner: string | null; name: string }>;
  vehicles: Array<{ pos: { x: number; z: number }; destroyed: boolean; kind: string }>;
}) {
  const size = 150;
  const range = 80;

  const toMapX = (wx: number) => ((wx - playerPos.x) / range + 0.5) * size;
  const toMapY = (wz: number) => ((wz - playerPos.z) / range + 0.5) * size;

  return (
    <div
      className="pointer-events-none absolute top-20 right-4 overflow-hidden rounded-lg border border-[hsl(var(--hud)/0.4)] bg-background/70 backdrop-blur-sm"
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {/* Capture points */}
        {capturePoints.map((cp, i) => {
          const sx = toMapX(cp.pos.x);
          const sy = toMapY(cp.pos.z);
          if (sx < -10 || sx > size + 10 || sy < -10 || sy > size + 10) return null;
          return (
            <g key={`cp-${i}`}>
              <rect
                x={sx - 5} y={sy - 5} width={10} height={10}
                fill={cp.owner === "blue" ? "rgba(68,136,255,0.4)" : cp.owner === "red" ? "rgba(255,68,68,0.4)" : "rgba(120,120,120,0.3)"}
                stroke={cp.owner === "blue" ? "#4488ff" : cp.owner === "red" ? "#ff4444" : "#888"}
                strokeWidth={1}
              />
              <text x={sx} y={sy - 7} textAnchor="middle" fill="#aaa" fontSize={5}>{cp.name}</text>
            </g>
          );
        })}

        {/* Vehicles */}
        {vehicles.filter(v => !v.destroyed).map((v, i) => {
          const sx = toMapX(v.pos.x);
          const sy = toMapY(v.pos.z);
          if (sx < -5 || sx > size + 5 || sy < -5 || sy > size + 5) return null;
          return (
            <rect key={`v-${i}`} x={sx - 3} y={sy - 3} width={6} height={6} fill="#ffaa20" opacity={0.8} rx={1} />
          );
        })}

        {/* Smoke clouds */}
        {smokeClouds.map((sc, i) => {
          const sx = toMapX(sc.pos.x);
          const sy = toMapY(sc.pos.z);
          const sr = (sc.radius / range) * size;
          return (
            <circle key={`smoke-${i}`} cx={sx} cy={sy} r={sr} fill="rgba(200,200,200,0.4)" />
          );
        })}

        {/* Soldiers */}
        {soldiers.filter(s => s.alive).map((s, i) => {
          const sx = toMapX(s.pos.x);
          const sy = toMapY(s.pos.z);
          if (sx < -5 || sx > size + 5 || sy < -5 || sy > size + 5) return null;
          return (
            <circle
              key={`s-${i}`}
              cx={sx}
              cy={sy}
              r={3}
              fill={s.team === "blue" ? "#4488ff" : "#ff4444"}
              opacity={0.9}
            />
          );
        })}

        {/* Player */}
        <g transform={`translate(${size / 2}, ${size / 2}) rotate(${(-playerYaw * 180) / Math.PI})`}>
          <polygon points="0,-6 4,4 -4,4" fill="#44ff44" />
        </g>

        <rect x={0} y={0} width={size} height={size} fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth={1} />
      </svg>
      <div className="absolute bottom-1 left-1 text-[8px] uppercase tracking-widest text-muted-foreground">
        MAP
      </div>
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
