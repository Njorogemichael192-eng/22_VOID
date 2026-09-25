const url = globalThis.process.argv[2];
const expectedStatus = globalThis.process.argv[3] ?? "ok";
const maxAgeSetting =
  globalThis.process.argv[4] ?? globalThis.process.env.WORKER_STALENESS_MS ?? "0";
const maxAgeMs = Number(maxAgeSetting);

if (!url || !Number.isFinite(maxAgeMs) || maxAgeMs < 0) {
  globalThis.process.exit(2);
}

try {
  const response = await globalThis.fetch(url, { signal: globalThis.AbortSignal.timeout(5000) });
  if (response.status !== 200) {
    globalThis.process.exit(1);
  }

  const body = await response.json();
  if (!body || body.status !== expectedStatus) {
    globalThis.process.exit(1);
  }

  if (maxAgeMs > 0) {
    if (typeof body.lastCycleAt !== "string") {
      globalThis.process.exit(1);
    }
    const ageMs = Date.now() - Date.parse(body.lastCycleAt);
    if (!Number.isFinite(ageMs) || ageMs < -60000 || ageMs > maxAgeMs) {
      globalThis.process.exit(1);
    }
  }
} catch {
  globalThis.process.exit(1);
}

globalThis.process.exit(0);
