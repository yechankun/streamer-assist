import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  base: "./",
  plugins: [
    react(),
    {
      name: "local-development-csp",
      apply: "serve",
      transformIndexHtml(html) {
        // React Refresh injects an inline bootstrap in development only.
        return html.replace(
          "script-src 'self';",
          "script-src 'self' 'unsafe-inline';",
        );
      },
    },
  ],
  server: { host: "127.0.0.1", port: 5173, strictPort: true },
});
