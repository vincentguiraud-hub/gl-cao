// Restaure le contenu d'une version précédente dans une NOUVELLE version (l'historique est conservé).
// Usage : node scripts/retour-version.mjs "<titre de la demande>" <numéro>
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
const sh = c => execSync(c, { encoding: "utf8" }).trim();
const [titre = "", num = "?"] = process.argv.slice(2);
const actuelle = JSON.parse(readFileSync("package.json", "utf8")).version;
// versions = commits dont le message commence par vX.Y.Z
const versions = sh("git log --format=%H%x09%s").split("\n").map(l => { const [h, s] = l.split("\t"); const m = /^v(\d+\.\d+\.\d+)/.exec(s || ""); return m ? { h, v: m[1] } : null; }).filter(Boolean);
const voulue = /v(\d+\.\d+\.\d+)/.exec(titre)?.[1];
const cible = voulue ? versions.find(x => x.v === voulue) : versions.find(x => x.v !== actuelle);
if (!cible) { console.log("INTROUVABLE"); process.exit(0); }
sh("git rm -r -q .");
sh(`git checkout ${cible.h} -- .`);
sh("git checkout HEAD -- .github scripts/retour-version.mjs");
const [a, b, c] = actuelle.split(".").map(Number); const nv = `${a}.${b}.${c + 1}`;
const pkg = JSON.parse(readFileSync("package.json", "utf8")); pkg.version = nv; writeFileSync("package.json", JSON.stringify(pkg, null, 2) + "\n");
const date = new Date().toLocaleDateString("fr-FR");
const ancien = existsSync("CHANGELOG.md") ? readFileSync("CHANGELOG.md", "utf8") : "# Historique des versions\n";
const [tete, ...reste] = ancien.split("\n");
writeFileSync("CHANGELOG.md", [tete, "", `## v${nv} — ${date}`, `- Retour au contenu de la version v${cible.v} (demande #${num}).`, ...reste].join("\n"));
sh("git add -A");
sh(`git commit -qm "v${nv} : retour à v${cible.v} (#${num})"`);
console.log(`OK v${cible.v} v${nv}`);
