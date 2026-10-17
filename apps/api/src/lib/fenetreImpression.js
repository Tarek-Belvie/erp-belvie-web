// ================================================================================================
// Fenêtre d'impression PDF côté serveur — remplace la BrowserWindow cachée d'Electron.
//
// Les générateurs PDF (bcPfPdf.js, ficheTechniquePdf.js) sont conservés tels quels : ils
// construisent un document HTML, le chargent, exécutent leur script de mise en page, puis
// impriment. Cette classe offre exactement le sous-ensemble d'API qu'ils utilisent :
//   new FenetreImpression({ width, height }) ; loadURL(dataUrl) ;
//   webContents.executeJavaScript(code) ; webContents.printToPDF(options) ; isDestroyed() ; destroy()
//
// Le moteur est Chromium (le même que celui d'Electron), piloté par playwright-core. Le chemin du
// navigateur vient de CHROMIUM_PATH (installé dans l'image Docker de l'API).
//
// Les images référencées en « belvie-media://local/<chemin relatif> » sont remplacées par leur
// contenu (data: URI) avant chargement : la page n'a ainsi accès à aucun fichier du serveur.
// ================================================================================================
const fs = require("fs");
const path = require("path");
const { cheminMedia } = require("./plateforme");

let navigateur = null;
async function obtenirNavigateur() {
  if (navigateur && navigateur.isConnected()) return navigateur;
  const { chromium } = require("playwright-core");
  navigateur = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  return navigateur;
}

const MIME = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".svg": "image/svg+xml", ".gif": "image/gif" };
function integrerMedias(html) {
  return html.replace(/belvie-media:\/\/local\/([^"')\s]+)/g, (_tout, rel) => {
    try {
      const abs = cheminMedia(decodeURIComponent(rel));
      const type = MIME[path.extname(abs).toLowerCase()] || "application/octet-stream";
      return `data:${type};base64,${fs.readFileSync(abs).toString("base64")}`;
    } catch (_) {
      return ""; // image absente : même rendu qu'une image cassée dans Electron
    }
  });
}

class FenetreImpression {
  constructor(options = {}) {
    this._taille = { width: options.width || 1024, height: options.height || 768 };
    this._page = null;
    this._contexte = null;
    this._detruite = false;
    const self = this;
    this.webContents = {
      async executeJavaScript(code) {
        // Même sémantique qu'Electron : évalue l'expression ; une Promise est attendue.
        return self._page.evaluate((source) => (0, eval)(source), code);
      },
      async printToPDF(opts = {}) {
        const m = opts.margins || {};
        const pouces = (v) => (v === undefined ? undefined : `${v}in`);
        return self._page.pdf({
          printBackground: !!opts.printBackground,
          preferCSSPageSize: !!opts.preferCSSPageSize,
          landscape: !!opts.landscape,
          format: opts.pageSize && typeof opts.pageSize === "string" ? opts.pageSize : undefined,
          margin: { top: pouces(m.top), bottom: pouces(m.bottom), left: pouces(m.left), right: pouces(m.right) },
        });
      },
    };
  }

  async loadURL(url) {
    const nav = await obtenirNavigateur();
    this._contexte = await nav.newContext({ viewport: this._taille, javaScriptEnabled: true });
    this._page = await this._contexte.newPage();
    const prefixe = "data:text/html;charset=utf-8,";
    if (!url.startsWith(prefixe)) throw new Error("FenetreImpression : seules les pages HTML en data: sont acceptées.");
    await this._page.setContent(integrerMedias(decodeURIComponent(url.slice(prefixe.length))), { waitUntil: "load" });
  }

  isDestroyed() { return this._detruite; }
  destroy() {
    this._detruite = true;
    if (this._contexte) this._contexte.close().catch(() => {});
  }
}

async function fermerNavigateur() { if (navigateur) { await navigateur.close().catch(() => {}); navigateur = null; } }

module.exports = { FenetreImpression, fermerNavigateur, integrerMedias };
