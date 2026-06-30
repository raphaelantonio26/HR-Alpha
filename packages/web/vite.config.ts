import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true, // listen on 0.0.0.0 so CodeSandbox can forward the preview
    // Accept CodeSandbox's proxied preview host (leading dot = match subdomains).
    allowedHosts: [".csb.app", ".codesandbox.io"],
    proxy: {
      // Browser calls same-origin /api/*; Vite (in the VM) forwards to the API on
      // localhost:8080 and strips the /api prefix. This avoids CORS entirely and
      // needs no knowledge of the dynamic forwarded URL. (Set VITE_API_URL=/api.)
      "/api": {
        target: "http://localhost:8080",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ""),
      },
    },
  },
  build: { outDir: "dist", sourcemap: true },
});
