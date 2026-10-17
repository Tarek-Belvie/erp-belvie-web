import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// En développement, /api et /media sont relayés vers l'API locale : l'interface et l'API sont
// ainsi sur la même origine, exactement comme en production (réécritures Vercel).
const API = process.env.API_LOCALE || "http://localhost:3001";

export default defineConfig({
  plugins: [react()],
  build: { outDir: "dist", emptyOutDir: true },
  server: {
    port: 5173,
    strictPort: true,
    proxy: { "/api": API, "/media": API },
  },
});
