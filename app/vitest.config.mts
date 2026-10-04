import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
    // Gera o banco de teste migrado uma vez por rodada (M0.8); cada teste parte desse retrato.
    globalSetup: ["src/db/testing.setup.ts"],
  },
});
