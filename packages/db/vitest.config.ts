import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { defineConfig } from "vitest/config";

// Load the repo-root .env so the CRUD integration suite can reach the local
// Docker Postgres during `npm run db:test` / `npm test`.
config({ path: fileURLToPath(new URL("../../.env", import.meta.url)) });

export default defineConfig({
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
