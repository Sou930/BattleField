import { describe, it, expect } from "vitest";
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
  });
});
