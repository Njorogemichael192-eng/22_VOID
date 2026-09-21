import { describe, expect, it } from "vitest";

import { simplexMinimize } from "./simplex.js";

describe("simplexMinimize", () => {
  it("solves a single equality", () => {
    const result = simplexMinimize([-1], [[1]], [1]);
    expect(result.status).toBe("optimal");
    expect(result.solution[0]).toBeCloseTo(1, 9);
    expect(result.objective).toBeCloseTo(-1, 9);
  });

  it("solves a two-variable system", () => {
    const result = simplexMinimize(
      [1, 1],
      [
        [1, 1],
        [1, -1],
      ],
      [3, 1]
    );
    expect(result.status).toBe("optimal");
    expect(result.solution[0]).toBeCloseTo(2, 8);
    expect(result.solution[1]).toBeCloseTo(1, 8);
    expect(result.objective).toBeCloseTo(3, 8);
  });

  it("handles negative right-hand sides", () => {
    const result = simplexMinimize(
      [1, 1],
      [
        [1, 1],
        [-1, 0],
      ],
      [3, -1]
    );
    expect(result.status).toBe("optimal");
    expect(result.solution[0]).toBeCloseTo(1, 8);
    expect(result.solution[1]).toBeCloseTo(2, 8);
    expect(result.objective).toBeCloseTo(3, 8);
  });

  it("detects infeasible systems", () => {
    const result = simplexMinimize([0], [[1], [1]], [1, 2]);
    expect(result.status).toBe("infeasible");
  });

  it("detects unbounded systems", () => {
    const result = simplexMinimize([-1, 0], [[1, -1]], [0]);
    expect(result.status).toBe("unbounded");
  });
});
