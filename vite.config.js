import { readFileSync, writeFileSync } from "node:fs";
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const build = new Date().toISOString().slice(0, 16).replace("T", " ");
export default {
  base: "./",
  define: { __APP_VERSION__: JSON.stringify(pkg.version), __APP_BUILD__: JSON.stringify(build) },
  build: { outDir: "dist", assetsInlineLimit: 0, chunkSizeWarningLimit: 5000 },
  plugins: [{ name: "version-json", closeBundle() { writeFileSync("dist/version.json", JSON.stringify({ version: pkg.version, build })); } }],
};
