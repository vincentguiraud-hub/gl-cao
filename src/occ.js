// Chargement du noyau géométrique OpenCascade (WASM compressé, embarqué en base64)
import opencascade from "./vendor/occt.js";
import * as R from "replicad";

function loadScript(src) {
  return new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = src; s.onload = res; s.onerror = () => rej(new Error("Impossible de charger " + src));
    document.head.appendChild(s);
  });
}

export async function initOCC(onProgress) {
  onProgress?.("Chargement du moteur géométrique…");
  if (!window.__OCCT_B64) await loadScript("./occt-wasm.js");
  onProgress?.("Décompression du moteur…");
  const bin = Uint8Array.from(atob(window.__OCCT_B64), c => c.charCodeAt(0));
  window.__OCCT_B64 = null;
  const ds = new Blob([bin]).stream().pipeThrough(new DecompressionStream("gzip"));
  const wasm = new Uint8Array(await new Response(ds).arrayBuffer());
  onProgress?.("Initialisation du noyau…");
  const oc = await opencascade({ wasmBinary: wasm, locateFile: () => "occt.wasm", print: () => {}, printErr: () => {} });
  R.setOC(oc);
  return oc;
}
export { R };
