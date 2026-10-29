# G&L CAO 3D

Logiciel de CAO 3D paramétrique de **G&L Créations** (métallerie, ferronnerie, tôlerie, mécano-soudé).

- **Application en ligne (PC, iPhone, Android)** : https://vincentguiraud-hub.github.io/gl-cao/
- **Installateur Windows** : onglet *Releases* → `GL-CAO-3D-Setup.exe`

## Mises à jour
Chaque modification envoyée sur la branche `main` est publiée automatiquement sur GitHub Pages
(workflow « Publier l'application »). Le logiciel Windows charge cette version à chaque démarrage :
**aucune réinstallation n'est nécessaire**. Une bannière « Nouvelle version disponible » apparaît aussi
dans l'application ouverte.

Le lanceur Windows (installateur) n'est reconstruit que lorsque le dossier `desktop/` change : augmenter alors `version` dans `desktop/package.json`.

## Développement
```
npm install
npm run dev      # serveur local
npm run build    # version de production dans dist/
```
Moteur géométrique : OpenCascade (via replicad), rendu : three.js.
