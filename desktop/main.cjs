// Lanceur Windows de G&L CAO 3D
// L'application elle-même est chargée depuis GitHub Pages : chaque mise à jour publiée
// sur GitHub est disponible au prochain démarrage, sans réinstaller.
// Hors connexion, la copie embarquée (dossier app/) est utilisée.
const { app, BrowserWindow, shell, protocol, net, session, Menu, dialog } = require("electron");
const path = require("path");
const { pathToFileURL } = require("url");

const ONLINE_URL = "https://vincentguiraud-hub.github.io/gl-cao/";
protocol.registerSchemesAsPrivileged([{ scheme: "glcao", privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);

let win;
function createWindow() {
  win = new BrowserWindow({
    width: 1440, height: 920, minWidth: 900, minHeight: 600, title: "G&L CAO 3D",
    icon: path.join(__dirname, "icon.png"), autoHideMenuBar: true, backgroundColor: "#eef1f4",
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  Menu.setApplicationMenu(null);
  let triedOffline = false;
  const goOffline = () => { if (triedOffline) return; triedOffline = true; win.loadURL("glcao://app/index.html"); };
  win.webContents.on("did-navigate", (_e, url, code) => { if (url.startsWith("http") && code >= 400) goOffline(); });
  win.webContents.on("did-fail-load", (_e, _code, _desc, url, isMain) => { if (isMain && url.startsWith("http")) goOffline(); });
  win.loadURL(ONLINE_URL).catch(goOffline);
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: "deny" }; });
  win.webContents.on("before-input-event", (e, input) => {
    if (input.key === "F5") { win.webContents.reloadIgnoringCache(); e.preventDefault(); }
    if (input.key === "F12") { win.webContents.toggleDevTools(); e.preventDefault(); }
  });
}

app.whenReady().then(() => {
  protocol.handle("glcao", req => {
    const u = new URL(req.url);
    const file = path.join(__dirname, "app", decodeURIComponent(u.pathname));
    return net.fetch(pathToFileURL(file).toString());
  });
  // fenêtre « Enregistrer sous » pour chaque fichier exporté
  session.defaultSession.on("will-download", (_e, item) => {
    const p = dialog.showSaveDialogSync(win, { defaultPath: path.join(app.getPath("documents"), item.getFilename()) });
    if (p) item.setSavePath(p); else item.cancel();
  });
  createWindow();
  // mise à jour du lanceur lui-même (rare)
  try { const { autoUpdater } = require("electron-updater"); autoUpdater.checkForUpdatesAndNotify().catch(() => {}); } catch {}
});
app.on("window-all-closed", () => app.quit());
