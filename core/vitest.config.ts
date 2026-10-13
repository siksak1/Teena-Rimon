import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // pdf.js asks Node to use its legacy build; the browser gets the modern one.
    alias: { "pdfjs-dist": "pdfjs-dist/legacy/build/pdf.mjs" },
  },
  test: {
    include: ["test/**/*.test.ts"],
    testTimeout: 20000,
  },
});
