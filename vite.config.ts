import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const buildId = new Date().toISOString();

export default defineConfig({
  base: process.env.VITE_BASE || "/",
  define: {
    __BUILD_ID__: JSON.stringify(buildId)
  },
  plugins: [
    react(),
    tailwindcss(),
    {
      name: "emit-build-version",
      generateBundle() {
        this.emitFile({
          type: "asset",
          fileName: "version.json",
          source: JSON.stringify({ buildId, builtAt: buildId })
        });
      }
    }
  ],
  server: {
    host: "0.0.0.0",
    port: 5173
  },
  build: {
    outDir: "dist",
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/react")) return "react";
          if (id.includes("node_modules/lucide-react")) return "icons";
          if (id.includes("node_modules/qrcode")) return "qrcode";
          if (id.includes("/data/strategy.json")) return "strategy-data";
        }
      }
    }
  }
});
