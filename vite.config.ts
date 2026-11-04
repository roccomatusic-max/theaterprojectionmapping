import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

// Pages are loaded from disk (file://) by Electron, so asset paths must be relative.
export default defineConfig({
  base: "./",
  plugins: [react()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: resolve(__dirname, "index.html"),
        output: resolve(__dirname, "output.html"),
        node: resolve(__dirname, "node.html"),
      },
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
  },
} as any);
