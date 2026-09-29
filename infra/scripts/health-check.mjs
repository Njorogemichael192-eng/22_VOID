const url = globalThis.process.argv[2];
const expectedStatus = globalThis.process.argv[3] ?? "ok";
// argv[4] is the staleness ceiling in ms. The env fallback exists for
// deployments that wire it that way, but relying on it is a trap: an image
// that never sets the variable (Dockerfile.worker sets only WORKER_HEALTH_PORT)
// silently loses the age guard the moment it runs outside the compose file that
// happens to pass it in. Pass it explicitly instead.
const maxAgeSetting =
  globalThis.process.argv[4] ?? globalThis.process.env.WORKER_STALENESS_MS ?? "0";
const parsedMaxAgeMs = Number(maxAgeSetting);
let maxAgeMs = 0;
if (!Number.isFinite(parsedMaxAgeMs) || parsedMaxAgeMs < 0) {
  // Deliberately not fatal. Exiting here would mark the container unhealthy
  // forever and the reason would live only in `docker inspect`'s health log. The
  // endpoint's own `status` is still asserted below, so skipping this extra age
  // guard degrades the check instead of blinding it.
  globalThis.console.error(
    `[health-check] ignoring invalid max age ${JSON.stringify(maxAgeSetting)}; expected a non-negative number of milliseconds`
  );
} else {
  maxAgeMs = parsedMaxAgeMs;
}

if (!url) {
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
