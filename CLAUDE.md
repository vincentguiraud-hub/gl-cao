# G&L CAO 3D — consignes pour Claude

Logiciel de CAO 3D paramétrique (proche de SolidWorks) de **G&L Créations** (Vincent, métallier-serrurier, Gard).
Utilisateur unique, francophone, non développeur. Toute l'interface et tous les messages sont **en français**.

## Architecture
- Application web (Vite) publiée sur GitHub Pages ; le lanceur Windows (`desktop/`, Electron) charge cette page en ligne. **Ne modifie pas `desktop/` sauf demande explicite** (cela reconstruit l'installateur).
- `src/occ.js` : chargement du noyau OpenCascade (replicad). `src/geom.js` : outils 2D/3D, esquisse → régions.
- `src/cad.js` : moteur de reconstruction (`rebuild(doc)`), une fonction par type (`extrude`, `cut`, `revolve`, `fillet`, `hole`, `weld`, `sheet`, `split`, `movebody`, `part`…). Les erreurs sont traduites par `friendlyError`.
- `src/solver.js` : solveur de contraintes d'esquisse. `src/sketcher.js` : mode esquisse (outils, cotes, relations).
- `src/main.js` : interface (arbre, panneaux de propriétés `pmSpec`/`renderPM`, commandes, exports, mise en plan). `src/viewer.js` : vue three.js.
- `src/drawing.js` : mise en plan. `src/exporters.js` : DXF, STL, 3MF, OBJ… `src/profiles.js` : profilés acier. `src/assistant.js` : panneau « Claude ».
- Document `.glcad.json` : `{ app:"glcad", features:[…], vars, material }`. **Ne casse jamais la compatibilité** des fichiers existants : ajoute des champs optionnels avec valeurs par défaut.

## Vérifications obligatoires avant de publier
```
npm run build
node tests/engine.mjs     # « échecs : 0 », aucune ligne ERR
node tests/solver.mjs
node tests/dxf.mjs
```
Les tests d'interface (`tests/*.cjs`, Playwright) ne tournent pas dans l'automatisation ; garde l'interface cohérente.

## Règles
- Modifications minimales et ciblées ; pas de refonte non demandée.
- Chaque publication : version augmentée dans `package.json` + entrée en tête de `CHANGELOG.md` (français simple, datée) + commit `vX.Y.Z : résumé (#issue)` sur `main`.
- Les messages d'erreur doivent dire à l'utilisateur quoi faire.
- Unités : millimètres. Matériaux et profilés : normes françaises / européennes.
