// Vérifie le sens des arcs DXF (toujours anti-horaire de start à end)
import { sketchToDXF } from "../src/exporters.js";
const txt = sketchToDXF([{ id: "a", t: "arc", a: [1, 0], b: [-1, 0], m: [0, 1] }, { id: "b", t: "arc", a: [-1, 0], b: [1, 0], m: [0, 1] }]);
const arcs = [...txt.matchAll(/ARC\n8\n\w+\n10\n([^\n]+)\n20\n([^\n]+)\n30\n0\n40\n([^\n]+)\n50\n([^\n]+)\n51\n([^\n]+)/g)].map(m => [+m[4], +m[5]]);
const sweep = ([s, e]) => ((e - s) % 360 + 360) % 360;
const ok = arcs.length === 2 && Math.abs(sweep(arcs[0]) - 180) < 1e-6 && Math.abs(sweep(arcs[1]) - 180) < 1e-6 && Math.abs(arcs[0][0]) < 1e-6 && Math.abs(arcs[1][0]) < 1e-6;
console.log((ok ? "OK  " : "ERR ") + "sens des arcs DXF " + JSON.stringify(arcs));
