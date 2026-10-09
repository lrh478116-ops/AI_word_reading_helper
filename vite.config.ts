import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { createReadStream } from "node:fs";
import { cp, stat } from "node:fs/promises";
import path from "node:path";
import { createBuildPolicy } from './src/edition.ts';

const requestedPolicy = process.env.AI_TIP_BUILD_POLICY ? JSON.parse(process.env.AI_TIP_BUILD_POLICY) : null;
const policy = requestedPolicy ? createBuildPolicy(requestedPolicy.edition, requestedPolicy.distribution, requestedPolicy.apiDownloadURL) : createBuildPolicy('api', 'direct');
const outputDir = requestedPolicy ? path.resolve('.edition-build', `${policy.edition}-${policy.distribution}`, 'dist') : path.resolve('dist');

const pdfAssetRoots = {
  cmaps: path.resolve("node_modules/pdfjs-dist/cmaps"),
  iccs: path.resolve("node_modules/pdfjs-dist/iccs"),
  standard_fonts: path.resolve("node_modules/pdfjs-dist/standard_fonts"),
  wasm: path.resolve("node_modules/pdfjs-dist/wasm")
} as const;

function pdfAssets() {
  return {
    name: "ai-tip-pdfjs-assets",
    configureServer(server: { middlewares: { use: (route: string, handler: (req: { url?: string }, res: import("node:http").ServerResponse, next: () => void) => void) => void } }) {
      server.middlewares.use("/pdfjs-assets/", async (req, res, next) => {
        try {
          const pathname = String(req.url || "").split("?", 1)[0];
          const [group, ...rest] = decodeURIComponent(pathname.replace(/^\/+/, "")).split("/");
          const root = pdfAssetRoots[group as keyof typeof pdfAssetRoots];
          if (!root || !rest.length) return next();
          const target = path.resolve(root, ...rest);
          if (!target.startsWith(`${root}${path.sep}`)) return next();
          const info = await stat(target);
          if (!info.isFile()) return next();
          const type = target.endsWith(".wasm") ? "application/wasm" : target.endsWith(".bcmap") ? "application/octet-stream" : "application/octet-stream";
          res.setHeader("Content-Type", type);
          res.setHeader("Content-Length", String(info.size));
          createReadStream(target).pipe(res);
        } catch { next(); }
      });
    },
    async closeBundle() {
      for (const [group, source] of Object.entries(pdfAssetRoots)) {
        await cp(source, path.join(outputDir, "pdfjs-assets", group), { recursive: true });
      }
      await cp(path.resolve("node_modules/pdfjs-dist/LICENSE"), path.join(outputDir, "pdfjs-assets", "LICENSE.pdfjs.txt"));
    }
  };
}

export default defineConfig({
  define: { __AI_TIP_BUILD_POLICY__: JSON.stringify(policy) },
  build: { outDir: outputDir, emptyOutDir: true },
  plugins: [react(), pdfAssets()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:8787"
    }
  }
});
