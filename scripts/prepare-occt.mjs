// Prépare le moteur OpenCascade : WASM compressé + encodé (chargé par la page)
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { gzipSync } from "node:zlib";
const wasm = readFileSync("node_modules/replicad-opencascadejs/dist/replicad_single.wasm");
mkdirSync("public", { recursive: true });
writeFileSync("public/occt-wasm.js", 'window.__OCCT_B64="' + gzipSync(wasm, { level: 9 }).toString("base64") + '";');
let js = readFileSync("node_modules/replicad-opencascadejs/dist/replicad_single.js", "utf8");
js = js.replace('(new URL("replicad_single.wasm",import.meta.url)', '("replicad_single.wasm"');
mkdirSync("src/vendor", { recursive: true });
writeFileSync("src/vendor/occt.js", js);
console.log("Moteur OpenCascade prêt");
