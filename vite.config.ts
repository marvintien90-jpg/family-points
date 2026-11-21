import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
// GitHub Pages 會放在 /family-points/ 底下
export default defineConfig({ plugins: [react()], base: process.env.BASE_PATH ?? "/family-points/" });
