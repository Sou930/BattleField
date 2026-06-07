import { describe, it, expect } from "vitest";
import { generateWorld, terrainHeightAt, WORLD_SIZE } from "@/game/world";

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

  it("adds three desert-rim outposts on the open outer edge", () => {
    expect(world.outposts.length).toBe(3);
    const half = WORLD_SIZE / 2;
    for (const op of world.outposts) {
      // Each outpost sits well out toward the perimeter (outer rim), not in the
      // map center, and stays inside the perimeter wall.
      const ring = Math.max(Math.abs(op.pos.x), Math.abs(op.pos.z));
      expect(ring).toBeGreaterThan(WORLD_SIZE * 0.2);
      expect(Math.abs(op.pos.x) + op.radius).toBeLessThan(half);
      expect(Math.abs(op.pos.z) + op.radius).toBeLessThan(half);
      expect(op.name.length).toBeGreaterThan(0);
      expect(op.sniperPosts.length).toBeGreaterThan(0);
    }
  });

  it("raises each outpost above the surrounding desert (高低差)", () => {
    for (const op of world.outposts) {
      const centerH = terrainHeightAt(world, op.pos.x, op.pos.z);
      // Sample the desert floor just outside the outpost mound.
      const outsideR = op.radius + 30;
      const ring = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2].map((a) =>
        terrainHeightAt(world, op.pos.x + Math.cos(a) * outsideR, op.pos.z + Math.sin(a) * outsideR),
      );
      const avgOutside = ring.reduce((a, b) => a + b, 0) / ring.length;
      // The crest must command the surrounding ground by a clear margin.
      expect(centerH - avgOutside).toBeGreaterThan(8);
    }
  });

  it("places explicit sniper posts with a recorded elevation advantage", () => {
    expect(world.sniperPosts.length).toBeGreaterThanOrEqual(world.outposts.length * 2);
    for (const sp of world.sniperPosts) {
      // Every post records a meaningful height advantage and a valid owner.
      expect(sp.elevation).toBeGreaterThan(8);
      expect(Number.isFinite(sp.yaw)).toBe(true);
      expect(world.outposts.some((op) => op.id === sp.outpostId)).toBe(true);
    }
    // The primary (tower-nest) posts must out-elevate the secondary berms.
    const maxElev = Math.max(...world.sniperPosts.map((s) => s.elevation));
    const minElev = Math.min(...world.sniperPosts.map((s) => s.elevation));
    expect(maxElev).toBeGreaterThan(minElev);
  });

  it("rewards the high ground with sniper pickups at the outposts", () => {
    const sniperPickups = world.pickupSpawns.filter(
      (p) => p.kind === "weapon" && p.weaponId === "sniper",
    );
    // At least one sniper rifle per outpost nest (plus the plaza one).
    expect(sniperPickups.length).toBeGreaterThanOrEqual(world.outposts.length);
  });
});
