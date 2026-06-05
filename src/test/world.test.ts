import { describe, it, expect } from "vitest";
import { generateWorld } from "@/game/world";

describe("generateWorld", () => {
  const world = generateWorld();

  it("produces buildings with storey metadata", () => {
    expect(world.buildings.length).toBeGreaterThan(0);
    for (const b of world.buildings) {
      expect(b.info).toBeDefined();
      expect(b.info!.floors).toBeGreaterThanOrEqual(1);
      expect(b.walls.length).toBeGreaterThan(0);
    }
  });

  it("generates some multi-storey buildings with interior floors", () => {
    const multi = world.buildings.filter((b) => (b.info?.floors ?? 0) >= 2);
    expect(multi.length).toBeGreaterThan(0);
    // Multi-storey buildings should have interior floor slabs and a staircase.
    const withFloors = multi.filter((b) => b.walls.some((w) => w.kind === "floor"));
    expect(withFloors.length).toBeGreaterThan(0);
  });

  it("places windows aligned to multiple floors", () => {
    expect(world.windows.length).toBeGreaterThan(0);
    const maxY = Math.max(...world.windows.map((w) => w.pos.y));
    // Some windows must be on an upper storey (well above the ground row).
    expect(maxY).toBeGreaterThan(4);
  });
});
