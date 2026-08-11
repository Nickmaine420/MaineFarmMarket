import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["router.test.ts", "utils/**/*.test.ts"],
  },
});
