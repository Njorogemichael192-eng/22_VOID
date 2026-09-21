/**
 * Minimal dense two-phase simplex for `minimize c·x subject to A x = b, x >= 0`.
 *
 * The stake optimizer only needs a small, dense LP, so this is a compact
 * tableau implementation rather than a general-purpose solver:
 *
 * - rows with a negative right-hand side are negated so phase 1 starts from a
 *   non-negative basis;
 * - one artificial variable per row forms the initial identity basis;
 * - phase 1 minimizes the artificial sum (infeasible when it cannot reach 0),
 *   basic artificials are then pivoted out where possible;
 * - phase 2 minimizes the real objective with artificials forbidden by a large
 *   cost, using Bland's rule to avoid cycling.
 */

const EPS = 1e-9;
const MAX_ITERATIONS = 20_000;
const ARTIFICIAL_COST = 1e12;

export interface SimplexResult {
  status: "optimal" | "infeasible" | "unbounded";
  /** Length `c.length`; one entry per structural variable. */
  solution: number[];
  /** Optimal value of `c·x`. */
  objective: number;
}

export function simplexMinimize(
  c: readonly number[],
  A: readonly (readonly number[])[],
  b: readonly number[]
): SimplexResult {
  const rowCount = A.length;
  const variableCount = c.length;
  if (rowCount === 0) {
    return { status: "optimal", solution: new Array<number>(variableCount).fill(0), objective: 0 };
  }

  const columnCount = variableCount + rowCount + 1;
  const rhs = variableCount + rowCount;

  const tableau: number[][] = [];
  for (let row = 0; row < rowCount; row += 1) {
    const source = A[row] ?? [];
    const flipped = (b[row] ?? 0) < 0 ? -1 : 1;
    const line = new Array<number>(columnCount).fill(0);
    for (let column = 0; column < variableCount; column += 1) {
      line[column] = flipped * (source[column] ?? 0);
    }
    line[variableCount + row] = 1;
    line[rhs] = Math.abs(b[row] ?? 0);
    tableau.push(line);
  }

  const basis: number[] = [];
  for (let row = 0; row < rowCount; row += 1) basis.push(variableCount + row);

  const cost = new Array<number>(variableCount + rowCount).fill(0);
  for (let row = 0; row < rowCount; row += 1) cost[variableCount + row] = 1;

  const pivot = (leaveRow: number, enterColumn: number): void => {
    const pivotRow = tableau[leaveRow]!;
    const pivotValue = pivotRow[enterColumn]!;
    for (let column = 0; column < columnCount; column += 1) {
      pivotRow[column] = pivotRow[column]! / pivotValue;
    }
    for (let row = 0; row < rowCount; row += 1) {
      if (row === leaveRow) continue;
      const factor = tableau[row]![enterColumn]!;
      if (factor === 0) continue;
      const target = tableau[row]!;
      for (let column = 0; column < columnCount; column += 1) {
        target[column] = target[column]! - factor * pivotRow[column]!;
      }
    }
    basis[leaveRow] = enterColumn;
  };

  const iterate = (): "optimal" | "unbounded" => {
    for (let iteration = 0; iteration < MAX_ITERATIONS; iteration += 1) {
      let enter = -1;
      for (let column = 0; column < variableCount + rowCount; column += 1) {
        let reduced = cost[column]!;
        for (let row = 0; row < rowCount; row += 1) {
          reduced -= cost[basis[row]!]! * tableau[row]![column]!;
        }
        if (reduced < -EPS) {
          enter = column;
          break;
        }
      }
      if (enter === -1) return "optimal";

      let leave = -1;
      let bestRatio = Number.POSITIVE_INFINITY;
      for (let row = 0; row < rowCount; row += 1) {
        const coefficient = tableau[row]![enter]!;
        if (coefficient <= EPS) continue;
        const ratio = tableau[row]![rhs]! / coefficient;
        const better =
          ratio < bestRatio - EPS ||
          (Math.abs(ratio - bestRatio) <= EPS && (leave === -1 || basis[row]! < basis[leave]!));
        if (better) {
          bestRatio = ratio;
          leave = row;
        }
      }
      if (leave === -1) return "unbounded";
      pivot(leave, enter);
    }
    return "optimal";
  };

  const phaseOne = iterate();
  if (phaseOne === "unbounded") {
    return {
      status: "infeasible",
      solution: new Array<number>(variableCount).fill(0),
      objective: 0,
    };
  }

  let artificialSum = 0;
  for (let row = 0; row < rowCount; row += 1) {
    artificialSum += cost[basis[row]!]! * tableau[row]![rhs]!;
  }
  if (artificialSum > 1e-7) {
    return {
      status: "infeasible",
      solution: new Array<number>(variableCount).fill(0),
      objective: 0,
    };
  }

  for (let row = 0; row < rowCount; row += 1) {
    if (basis[row]! < variableCount) continue;
    if (Math.abs(tableau[row]![rhs]!) > EPS) {
      return {
        status: "infeasible",
        solution: new Array<number>(variableCount).fill(0),
        objective: 0,
      };
    }
    for (let column = 0; column < variableCount; column += 1) {
      if (Math.abs(tableau[row]![column]!) > EPS && !basis.includes(column)) {
        pivot(row, column);
        break;
      }
    }
  }

  for (let column = 0; column < variableCount; column += 1) cost[column] = c[column] ?? 0;
  for (let row = 0; row < rowCount; row += 1) cost[variableCount + row] = ARTIFICIAL_COST;

  if (iterate() === "unbounded") {
    return {
      status: "unbounded",
      solution: new Array<number>(variableCount).fill(0),
      objective: 0,
    };
  }

  const solution = new Array<number>(variableCount).fill(0);
  for (let row = 0; row < rowCount; row += 1) {
    const basic = basis[row]!;
    if (basic < variableCount) solution[basic] = tableau[row]![rhs]!;
  }
  let objective = 0;
  for (let column = 0; column < variableCount; column += 1) {
    objective += (c[column] ?? 0) * solution[column]!;
  }

  return { status: "optimal", solution, objective };
}
