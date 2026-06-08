import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { generateWorld } from "@/game/world";
import { GameEngine } from "@/game/engine";
import { createInitialState } from "@/game/store";

function makeEngine() {
  const state = createInitialState();
  state.enemies = state.soldiers;
  const input: GameEngine["input"] = {
    keys: new Set<string>(),
    consumeMouseDelta: () => ({ dx: 0, dy: 0 }),
    mouse: { left: false, right: false },
  };
  const world = generateWorld();
  return new GameEngine(state, input, world);
}

// A controllable input object exposing the mutable fields the player
// piloting code reads (keys / mouse / aircraftEnterPressed / mouse delta).
function makeControllableEngine() {
  const state = createInitialState();
  state.enemies = state.soldiers;
  let mouseDelta = { dx: 0, dy: 0 };
  const input: GameEngine["input"] & {
    aircraftEnterPressed: boolean;
    viewTogglePressed: boolean;
    setMouseDelta: (dx: number, dy: number) => void;
  } = {
    keys: new Set<string>(),
    consumeMouseDelta: () => {
      const d = mouseDelta;
      mouseDelta = { dx: 0, dy: 0 };
      return d;
    },
    mouse: { left: false, right: false },
    aircraftEnterPressed: false,
    viewTogglePressed: false,
    setMouseDelta: (dx: number, dy: number) => { mouseDelta = { dx, dy }; },
  };
  const world = generateWorld();
  const engine = new GameEngine(state, input, world);
  return { engine, input };
}

describe("runway spawns", () => {
  const world = generateWorld();

  it("creates exactly 3 runway spawn points", () => {
    expect(world.runwaySpawns).toBeDefined();
    expect(world.runwaySpawns.length).toBe(3);
  });

  it("places spawns near ground level facing north (yaw 0)", () => {
    for (const sp of world.runwaySpawns) {
      expect(sp.yaw).toBe(0);
      expect(sp.pos.y).toBeCloseTo(0.5, 5);
    }
  });

  it("lines the 3 spawns up side-by-side at the runway's south end", () => {
    const sp = world.runwaySpawns;
    // All three share the same Z (the south end) — they are abreast, not strung
    // out along the runway length.
    expect(sp[0].pos.z).toBeCloseTo(sp[1].pos.z, 5);
    expect(sp[1].pos.z).toBeCloseTo(sp[2].pos.z, 5);
    // Spread laterally along X by ±9m around the centre slot.
    const xs = sp.map((s) => s.pos.x).sort((a, b) => a - b);
    expect(xs[1] - xs[0]).toBeCloseTo(9, 5);
    expect(xs[2] - xs[1]).toBeCloseTo(9, 5);
  });
});

describe("aircraft spawn", () => {
  it("spawns 3 blue aircraft (2 fighters + 1 attacker) on startMatch", () => {
    const engine = makeEngine();
    engine.startMatch();
    const ac = engine.state.aircraft;
    expect(ac.length).toBe(3);

    const fighters = ac.filter((a) => a.kind === "fighter");
    const attackers = ac.filter((a) => a.kind === "attacker");
    expect(fighters.length).toBe(2);
    expect(attackers.length).toBe(1);

    for (const a of ac) {
      expect(a.team).toBe("blue");
      expect(a.onGround).toBe(true);
      expect(a.alive).toBe(true);
      expect(a.aiState).toBe("taxiing");
      expect(a.gunAmmoMax).toBe(500);
    }

    const attacker = attackers[0];
    expect(attacker.bombMax).toBe(4);
    expect(attacker.bombCount).toBe(4);

    // AI機は自動離陸しないよう aiTimer が大きな値で初期化される。
    for (const a of ac) {
      expect(a.aiTimer).toBeGreaterThan(100);
    }
  });
});

describe("AI aircraft never auto-takeoff (bug regression)", () => {
  it("keeps all 3 aircraft parked and motionless over many frames", () => {
    const engine = makeEngine();
    engine.startMatch();
    engine.state.status = "playing";
    // Remove soldiers so nothing else perturbs the sim; we only care that the
    // grounded planes never roll / lift off on their own.
    engine.state.soldiers.length = 0;

    const startPositions = engine.state.aircraft.map((a) => a.pos.clone());

    // Simulate ~15 seconds (well past the old taxiing→takeoff timer).
    for (let i = 0; i < 300; i++) {
      engine.update(0.05, 10 + i * 0.05);
    }

    for (let i = 0; i < engine.state.aircraft.length; i++) {
      const a = engine.state.aircraft[i];
      expect(a.onGround).toBe(true);
      expect(a.throttle).toBe(0);
      expect(a.vel.length()).toBeCloseTo(0, 5);
      // Still sitting exactly where it spawned (no taxi roll).
      expect(a.pos.distanceTo(startPositions[i])).toBeCloseTo(0, 4);
    }
  });

  it("an airborne bailed-out aircraft glides down, lands and schedules a respawn", () => {
    const engine = makeEngine();
    engine.startMatch();
    engine.state.status = "playing";
    engine.state.soldiers.length = 0;

    const ac = engine.state.aircraft[0];
    // Simulate a plane the player bailed out of in mid-air: airborne with some
    // forward speed but no pilot driving it.
    ac.onGround = false;
    ac.pos.y = 120;
    ac.vel.set(0, 0, -50);
    ac.throttle = 1;

    // Run the unpiloted glide until it touches down.
    for (let i = 0; i < 400 && !ac.onGround; i++) {
      engine.update(0.05, 30 + i * 0.05);
    }

    expect(ac.onGround).toBe(true);
    expect(ac.aiState).toBe("landing");
    expect(ac.aiTimer).toBeGreaterThan(0); // respawn countdown armed
    expect(ac.vel.length()).toBeCloseTo(0, 5);
  });
});

describe("player aircraft piloting", () => {
  it("boards the nearest grounded aircraft with G and exits with G", () => {
    const { engine, input } = makeControllableEngine();
    engine.startMatch();
    engine.state.status = "playing";

    // Stand right next to the first grounded aircraft.
    const ac = engine.state.aircraft[0];
    engine.state.player.pos.set(ac.pos.x + 2, 1.65, ac.pos.z);

    // Press G -> board.
    input.aircraftEnterPressed = true;
    engine.update(0.016, 1);
    expect(engine.state.playerInAircraft).toBe(ac.id);

    // Press G again -> exit (parachute release).
    input.aircraftEnterPressed = true;
    engine.update(0.016, 1.1);
    expect(engine.state.playerInAircraft).toBeNull();
  });

  it("throttle (W) accelerates the plane and lifts it off the runway", () => {
    const { engine, input } = makeControllableEngine();
    engine.startMatch();
    engine.state.status = "playing";
    const ac = engine.state.aircraft.find((a) => a.kind === "fighter")!;
    engine.state.player.pos.copy(ac.pos);
    engine.state.player.pos.y = 1.65;

    input.aircraftEnterPressed = true;
    engine.update(0.016, 1);
    expect(engine.state.playerInAircraft).toBe(ac.id);

    // Clear AI soldiers so the per-frame cost is just the flight model
    // (keeps this physics-focused test fast & deterministic).
    engine.state.soldiers.length = 0;

    // Hold W (throttle up) and a slight nose-up for several frames.
    input.keys.add("KeyW");
    for (let i = 0; i < 80; i++) {
      ac.pitch = 0.2; // climb attitude each frame
      engine.update(0.05, 2 + i * 0.05);
    }
    expect(ac.throttle).toBeGreaterThan(0.5);
    expect(ac.vel.length()).toBeGreaterThan(40);
    expect(ac.onGround).toBe(false);
  });

  it("nose machine gun fires, draws a tracer trail, and damages an enemy", () => {
    const { engine, input } = makeControllableEngine();
    engine.startMatch();
    engine.state.status = "playing";
    const ac = engine.state.aircraft.find((a) => a.kind === "fighter")!;
    engine.state.player.pos.copy(ac.pos);
    engine.state.player.pos.y = 1.65;

    input.aircraftEnterPressed = true;
    engine.update(0.016, 1);

    // Place a red enemy directly ahead along the nose (yaw 0 => -Z forward).
    ac.pitch = 0;
    ac.roll = 0;
    const enemy = engine.state.soldiers.find((s) => s.team === "red" && s.alive)!;
    enemy.pos.set(ac.pos.x, ac.pos.y, ac.pos.z - 100);
    const hpBefore = enemy.hp;

    input.mouse.left = true;
    engine.update(0.05, 5);

    expect(engine.state.aircraftGunTrails.length).toBeGreaterThan(0);
    expect(enemy.hp).toBeLessThan(hpBefore);
  });

  it("attacker drops a bomb with Space", () => {
    const { engine, input } = makeControllableEngine();
    engine.startMatch();
    engine.state.status = "playing";
    const ac = engine.state.aircraft.find((a) => a.kind === "attacker")!;
    engine.state.player.pos.copy(ac.pos);
    engine.state.player.pos.y = 1.65;

    input.aircraftEnterPressed = true;
    engine.update(0.016, 1);
    expect(engine.state.playerInAircraft).toBe(ac.id);

    const bombsBefore = ac.bombCount;
    // Put the aircraft genuinely airborne. `onGround` must be cleared too,
    // otherwise the flight controller snaps it back to runway height — which
    // would make the just-released bomb detonate against the ground on the very
    // first frame (bombs now correctly explode on terrain/building contact).
    ac.onGround = false;
    ac.pos.y = 120; // airborne so the bomb has room to fall
    input.keys.add("Space");
    engine.update(0.05, 6);

    expect(ac.bombCount).toBe(bombsBefore - 1);
    expect(engine.state.aircraftBombs.length).toBeGreaterThan(0);
  });

  it("a dropped bomb detonates when it strikes a building (not just the ground)", () => {
    const { engine, input } = makeControllableEngine();
    engine.startMatch();
    engine.state.status = "playing";
    const ac = engine.state.aircraft.find((a) => a.kind === "attacker")!;
    engine.state.player.pos.copy(ac.pos);
    engine.state.player.pos.y = 1.65;
    input.aircraftEnterPressed = true;
    engine.update(0.016, 1);

    // Find a tall wall/building collider and hover the plane right above it.
    const tall = engine.boxes.find(
      (b) => b.max.y - b.min.y > 3 && b.max.y > 4,
    )!;
    expect(tall).toBeTruthy();
    const cx = (tall.min.x + tall.max.x) / 2;
    const cz = (tall.min.z + tall.max.z) / 2;
    ac.onGround = false;
    ac.pos.set(cx, tall.max.y + 30, cz);
    ac.vel.set(0, -40, 0); // dive straight down onto the roof

    const explBefore = engine.state.explosions.length;
    input.keys.add("Space");
    // Advance enough frames for the bomb to fall the ~30m onto the roof.
    for (let i = 0; i < 40 && engine.state.explosions.length === explBefore; i++) {
      engine.update(0.05, 6 + i * 0.05);
      input.keys.delete("Space"); // only drop once
    }

    // It should have exploded ABOVE ground level (on the roof of the building),
    // proving bombs now collide with structures rather than phasing through.
    expect(engine.state.explosions.length).toBeGreaterThan(explBefore);
    const blast = engine.state.explosions[engine.state.explosions.length - 1];
    expect(blast.pos.y).toBeGreaterThan(tall.max.y - 1);
  });
});

describe("aircraft bug fixes", () => {
  it("boarding resets velocity/throttle so speed does not spike (speed bug)", () => {
    const { engine, input } = makeControllableEngine();
    engine.startMatch();
    engine.state.status = "playing";

    // Simulate an aircraft the AI had spun up: high residual velocity + throttle.
    const ac = engine.state.aircraft[0];
    ac.vel.set(0, 0, -200);
    ac.throttle = 1;
    ac.onGround = false;
    ac.aiState = "attack";

    // Stand next to it and board.
    engine.state.player.pos.set(ac.pos.x + 2, 1.65, ac.pos.z);
    // Put it back on the ground so it is boardable.
    ac.onGround = true;
    input.aircraftEnterPressed = true;
    engine.update(0.016, 1);

    expect(engine.state.playerInAircraft).toBe(ac.id);
    // Speed/throttle must be reset on board — no instant velocity spike.
    expect(ac.vel.length()).toBeCloseTo(0, 3);
    expect(ac.throttle).toBe(0);
    expect(ac.onGround).toBe(true);
    expect(ac.aiState).toBe("taxiing");
  });

  it("player takes no grenade/bomb damage while piloting (damage bug)", () => {
    const { engine, input } = makeControllableEngine();
    engine.startMatch();
    engine.state.status = "playing";
    engine.state.soldiers.length = 0;

    const ac = engine.state.aircraft[0];
    engine.state.player.pos.set(ac.pos.x + 2, 1.65, ac.pos.z);
    input.aircraftEnterPressed = true;
    engine.update(0.016, 1);
    expect(engine.state.playerInAircraft).toBe(ac.id);

    const hpBefore = engine.state.player.hp;
    // Detonate an aircraft bomb right where the plane (and thus player.pos) is.
    (engine as unknown as {
      aircraftExplode: (
        pos: THREE.Vector3, time: number, team: string, radius: number, damage: number,
      ) => void;
    }).aircraftExplode(ac.pos.clone(), 2, "red", 30, 200);

    // No damage applied while mounted.
    expect(engine.state.player.hp).toBe(hpBefore);
  });

  it("defaults to third-person view on board and toggles with V", () => {
    const { engine, input } = makeControllableEngine();
    engine.startMatch();
    engine.state.status = "playing";

    const ac = engine.state.aircraft[0];
    engine.state.player.pos.set(ac.pos.x + 2, 1.65, ac.pos.z);
    input.aircraftEnterPressed = true;
    engine.update(0.016, 1);

    // Boarding starts in third-person.
    expect(engine.state.vehicleViewMode).toBe("third");

    // V toggles to first-person.
    input.viewTogglePressed = true;
    engine.update(0.016, 1.1);
    expect(engine.state.vehicleViewMode).toBe("first");

    // V again -> back to third-person.
    input.viewTogglePressed = true;
    engine.update(0.016, 1.2);
    expect(engine.state.vehicleViewMode).toBe("third");
  });
});
