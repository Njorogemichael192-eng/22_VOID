/** Returns the default worker id for this process. */
export function workerId(): string {
  return `odds-collector-${process.pid}`;
}