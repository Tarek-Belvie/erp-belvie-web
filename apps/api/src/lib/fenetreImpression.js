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
// navigateur vient de CHROMIUM_PATH (installé dans l'image Docker de l'API) ; sur Vercel, de
// @sparticuz/chromium.
//
// Les images référencées en « belvie-media://local/<chemin relatif> » sont remplacées par leur
// contenu (data: URI) avant chargement : la page n'a ainsi accès à aucun fichier du serveur.
// ================================================================================================
const fs = require("fs");
const path = require("path");
const { cheminMedia } = require("./plateforme");

// La PROMESSE de lancement est gardée (et non le navigateur) : deux PDF demandés en même temps
// au premier usage partagent le même Chromium au lieu d'en lancer deux.
let lancement = null;
async function obtenirNavigateur() {
  if (lancement) {
    const nav = await lancement.catch(() => null);
    if (nav && nav.isConnected()) return nav;
  }
  const { chromium } = require("playwright-core");
  lancement = (async () => {
    let executablePath = process.env.CHROMIUM_PATH || undefined;
    let args = ["--no-sandbox", "--disable-dev-shm-usage"];
    // Sur Vercel, pas de navigateur installé : Chromium compressé fourni par @sparticuz/chromium,
    // décompressé dans /tmp au premier PDF de l'instance.
    if (!executablePath && process.env.VERCEL) {
      const serverless = require("@sparticuz/chromium").default;
      executablePath = await serverless.executablePath();
      args = serverless.args;
    }
    return chromium.launch({ executablePath, args });
  })();
  return lancement;
}

const MIME = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".svg": "image/svg+xml", ".gif": "image/gif" };
// Une photo d'origine (jusqu'à 10 Mo) est réduite avant d'être intégrée : 1600 px au plus grand côté
// suffisent largement pour une page A4 imprimée, et le PDF reste léger (Vercel : 4,5 Mo par réponse).
// Les petites images et les SVG sont intégrés tels quels ; en cas d'échec de sharp, l'original.
async function enDataUri(rel, contenu) {
  const ext = path.extname(rel).toLowerCase();
  if (ext !== ".svg" && contenu.length > 300 * 1024) {
    try {
      const sharp = require("sharp");
      const reduite = await sharp(contenu).rotate().resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
        .flatten({ background: "#ffffff" }).jpeg({ quality: 82 }).toBuffer();
      if (reduite.length < contenu.length) return `data:image/jpeg;base64,${reduite.toString("base64")}`;
    } catch (_) { /* image illisible par sharp : original */ }
  }
  return `data:${MIME[ext] || "application/octet-stream"};base64,${contenu.toString("base64")}`;
}

// Images lues dans le stockage (disque ou R2) et intégrées en data: URI.
async function integrerMedias(html) {
  const { lire } = require("./stockage");
  const rels = [...new Set([...html.matchAll(/belvie-media:\/\/local\/([^"')\s]+)/g)].map((m) => m[1]))];
  const remplacements = new Map();
  for (const rel of rels) {
    let uri = ""; // image absente : même rendu qu'une image cassée dans Electron
    try {
      const contenu = await lire(decodeURIComponent(rel));
      if (contenu) uri = await enDataUri(rel, contenu);
    } catch (_) { /* idem */ }
    remplacements.set(rel, uri);
  }
  return html.replace(/belvie-media:\/\/local\/([^"')\s]+)/g, (_t, rel) => remplacements.get(rel) || "");
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
    // Le document est autonome (médias intégrés en data:) : toute requête réseau est refusée.
    await this._page.route("**/*", (r) => (r.request().url().startsWith("data:") ? r.continue() : r.abort()));
    const prefixe = "data:text/html;charset=utf-8,";
    if (!url.startsWith(prefixe)) throw new Error("FenetreImpression : seules les pages HTML en data: sont acceptées.");
    await this._page.setContent(await integrerMedias(decodeURIComponent(url.slice(prefixe.length))), { waitUntil: "load" });
  }

  isDestroyed() { return this._detruite; }
  destroy() {
    this._detruite = true;
    if (this._contexte) this._contexte.close().catch(() => {});
  }
}

async function fermerNavigateur() {
  if (!lancement) return;
  const nav = await lancement.catch(() => null);
  lancement = null;
  if (nav) await nav.close().catch(() => {});
}

module.exports = { FenetreImpression, fermerNavigateur, integrerMedias };
