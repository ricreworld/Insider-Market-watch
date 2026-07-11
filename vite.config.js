import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      // In local development the API route runs as a small Node server
      // started with `npm run dev:api`. In production the same handler
      // runs as a serverless function, so no proxy is needed there.
      "/api": "http://localhost:3001",
    },
  },
});
