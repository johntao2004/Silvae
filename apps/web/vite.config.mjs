import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

const apiPort = process.env.HUMITE_API_PORT ?? "8080";
const apiProxyTarget = process.env.HUMITE_API_PROXY_TARGET ?? `http://127.0.0.1:${apiPort}`;

export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "src"),
    },
  },
  build: {
    outDir: "dist/client",
    chunkSizeWarningLimit: 700,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: "vendor-react",
              priority: 40,
              test: /[\\/]node_modules[\\/](react|react-dom|scheduler|react-router(?:-dom)?)[\\/]/,
            },
            {
              name: "vendor-antd",
              priority: 30,
              test: /[\\/]node_modules[\\/](antd|@ant-design[\\/](icons|icons-svg|cssinjs(?:-utils)?|colors|fast-color)|@rc-component|rc-[^\\/]+)[\\/]/,
            },
            {
              name: "vendor-query",
              priority: 25,
              test: /[\\/]node_modules[\\/]@tanstack[\\/](react-query|query-core)[\\/]/,
            },
            {
              name: "vendor-three",
              priority: 10,
              includeDependenciesRecursively: false,
              test: /[\\/]node_modules[\\/]three[\\/]/,
            },
            {
              name: "vendor-editor",
              priority: 10,
              includeDependenciesRecursively: false,
              test: /[\\/]node_modules[\\/](@tiptap|prosemirror-[^\\/]+)[\\/]/,
            },
            {
              name: "vendor-antv-g",
              priority: 10,
              includeDependenciesRecursively: false,
              test: /[\\/]node_modules[\\/](@antv[\\/](g|g-[^\\/]+|util)|gl-matrix)[\\/]/,
            },
            {
              name: "vendor-graph-layout",
              priority: 10,
              includeDependenciesRecursively: false,
              test: /[\\/]node_modules[\\/](@antv[\\/](layout|algorithm|graphlib)|d3-[^\\/]+)[\\/]/,
            },
            {
              name: "vendor-g6",
              priority: 10,
              includeDependenciesRecursively: false,
              test: /[\\/]node_modules[\\/](@antv[\\/]g6|@ant-design[\\/]graphs)[\\/]/,
            },
          ],
        },
      },
    },
  },
  optimizeDeps: {
    include: ["react", "react-dom/client", "@tanstack/react-query", "antd", "@ant-design/icons"],
  },
  server: {
    host: "0.0.0.0",
    port: Number(process.env.HUMITE_WEB_PORT || 4173),
    strictPort: true,
    allowedHosts: ["terminal.local", "localhost", "127.0.0.1"],
    proxy: {
      "/robots.txt": {target: apiProxyTarget, changeOrigin: true},
      "/api": {
        target: apiProxyTarget,
        changeOrigin: true,
      },
    },
    warmup: {
      clientFiles: ["./src/main.tsx"],
    },
  },
  plugins: [react()],
  test: {
    env: {
      VITE_DEMO_MODE: "true",
    },
    execArgv: process.allowedNodeEnvironmentFlags.has("--no-experimental-webstorage")
      ? ["--no-experimental-webstorage"]
      : [],
    environment: "jsdom",
    globals: true,
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["./src/test/setup.ts"],
    css: false,
    maxWorkers: 2,
    testTimeout: 30_000,
  },
});
