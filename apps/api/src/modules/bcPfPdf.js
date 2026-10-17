const fs = require("fs/promises");
const { FenetreImpression: BrowserWindow } = require("../lib/fenetreImpression");

const TYPE_PRODUCTION_LABELS = { nouveau: "Nouvel article", reassort: "Réassort" };
const BC_STATUT_LABELS = { brouillon: "Brouillon", valide: "Validé", lance: "Lancé", remplace: "Remplacé", annule: "Annulé" };

function typeDocumentLabel(numero) {
  if (numero && numero.startsWith("MP-")) return "Matières premières (MP)";
  return "Produits finis (PF)";
}

function badgeLancement(typeProduction) {
  if (typeProduction === "nouveau") return { label: "Lancement de production", couleur: "#1F4B3C" };
  if (typeProduction === "reassort") return { label: "Réassort", couleur: "#4B4B43" };
  return null;
}

const ORDRE_TAILLES_LETTRES = ["XXS", "XS", "S", "M", "L", "XL", "XXL", "2XL", "XXXL", "3XL", "4XL", "5XL"];
function comparerTailles(a, b) {
  const ia = ORDRE_TAILLES_LETTRES.indexOf(a.toUpperCase());
  const ib = ORDRE_TAILLES_LETTRES.indexOf(b.toUpperCase());
  if (ia !== -1 && ib !== -1) return ia - ib;
  if (ia !== -1) return -1;
  if (ib !== -1) return 1;
  const na = parseFloat(a), nb = parseFloat(b);
  if (!isNaN(na) && !isNaN(nb)) return na - nb;
  return a.localeCompare(b);
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function mediaUrl(relPath) {
  return relPath ? `belvie-media://local/${relPath}` : null;
}

function fmtDate(sqliteDateTime) {
  if (!sqliteDateTime) return "—";
  const [datePart] = sqliteDateTime.split(" ");
  const [y, m, d] = datePart.split("-");
  return `${d}/${m}/${y}`;
}

function buildResumeProductionHtml(lignes) {
  const couleurs = new Set((lignes ?? []).map((l) => l.couleur_nom));
  const tailles = new Set((lignes ?? []).filter((l) => l.taille_nom != null).map((l) => l.taille_nom));
  const quantiteTotale = (lignes ?? []).reduce((s, l) => s + l.quantite, 0);
  return `
    <div class="bcpf-doc-resume">
      <div class="bcpf-doc-resume-item"><span>Nombre de couleurs</span><strong>${couleurs.size}</strong></div>
      <div class="bcpf-doc-resume-item"><span>Nombre de tailles</span><strong>${tailles.size || "—"}</strong></div>
      <div class="bcpf-doc-resume-item"><span>Quantité totale</span><strong class="accent">${quantiteTotale} pièces</strong></div>
    </div>`;
}

// Vrai tableau HTML avec thead/tfoot en "table-header-group"/"table-footer-group" : mécanisme
// natif des navigateurs pour l'impression — l'en-tête de colonnes se répète automatiquement sur
// chaque page que ce tableau traverse, la ligne Total n'apparaît qu'une seule fois, à la toute
// fin. Chaque ligne de couleur a "break-inside: avoid" pour ne jamais être coupée entre deux pages.
function buildRepartitionTableHtml(lignes) {
  if (!lignes || lignes.length === 0) {
    return `<p style="color:#9A9A90;font-size:12.5px">Aucune répartition renseignée.</p>`;
  }
  const couleurs = Array.from(new Set(lignes.map((l) => l.couleur_nom)));
  const tailles = Array.from(new Set(lignes.filter((l) => l.taille_nom != null).map((l) => l.taille_nom))).sort(comparerTailles);
  const qty = (couleur, taille) => lignes.find((l) => l.couleur_nom === couleur && (l.taille_nom ?? null) === taille)?.quantite ?? 0;
  const rowTotal = (couleur) => (tailles.length > 0 ? tailles.reduce((s, t) => s + qty(couleur, t), 0) : qty(couleur, null));
  const colTotal = (taille) => couleurs.reduce((s, c) => s + qty(c, taille), 0);
  const grandTotal = couleurs.reduce((s, c) => s + rowTotal(c), 0);
  const referenceDe = (couleur) => lignes.find((l) => l.couleur_nom === couleur)?.couleur_reference || "—";

  const ths = (tailles.length > 0 ? tailles : ["Quantité"]).map((t) => `<th>${esc(t)}</th>`).join("");
  const rows = couleurs.map((c) => {
    const cells = (tailles.length > 0 ? tailles : [null]).map((t) => `<td>${qty(c, t) || "—"}</td>`).join("");
    return `<tr><td>${esc(c)}</td><td>${esc(referenceDe(c))}</td>${cells}<td class="col-total">${rowTotal(c)}</td></tr>`;
  }).join("");
  const footCells = (tailles.length > 0 ? tailles.map((t) => `<td>${colTotal(t)}</td>`).join("") : `<td>${grandTotal}</td>`);

  return `
    <table class="bcpf-doc-table">
      <thead><tr><th style="text-align:left">Couleur</th><th>Réf</th>${ths}<th>Total</th></tr></thead>
      <tbody>${rows}</tbody>

      <tfoot><tr><td>Total</td><td></td>${footCells}<td class="col-total">${grandTotal}</td></tr></tfoot>
    </table>`;
}

function buildFooterInnerHtml(entreprise) {
  if (!entreprise) return "";
  const ligne1Parts = [
    entreprise.raison_sociale,
    [entreprise.adresse, [entreprise.code_postal, entreprise.ville].filter(Boolean).join(" "), entreprise.pays].filter(Boolean).join(", "),
  ].filter(Boolean);
  const ligne2Parts = [
    entreprise.telephone,
    entreprise.email,
    entreprise.matricule_fiscal && `MF : ${entreprise.matricule_fiscal}`,
  ].filter(Boolean);
  if (ligne1Parts.length === 0 && ligne2Parts.length === 0) return "";
  return `
    ${ligne1Parts.length > 0 ? `<div class="name">${esc(ligne1Parts.join(" • "))}</div>` : ""}
    ${ligne2Parts.length > 0 ? `<div>${esc(ligne2Parts.join(" • "))}</div>` : ""}
  `;
}

const PAGE_MARGIN_MM = 16;

// Architecture : tout le document est UN SEUL tableau HTML (#page-table). Son thead et son tfoot
// (l'en-tête et le pied de page du document) utilisent "table-header-group"/"table-footer-group"
// — la répétition sur chaque page est gérée nativement par le moteur de rendu, exactement comme
// il répète déjà l'en-tête d'un tableau de données classique. C'est un mécanisme mature et fiable
// pour l'impression, contrairement à "position: fixed" combiné à un padding qui devrait se
// répéter sur chaque page (testé : peu fiable dans le pipeline printToPDF d'Electron, la section
// Notes pouvait rester invisible sur une deuxième page, cachée derrière l'en-tête). Toutes les
// dimensions visuelles ci-dessous sont volontairement identiques à la version précédente — seule
// la mécanique de pagination change.
const CSS = `
@page { size: A4 portrait; margin: 0; }
html, body { width: 210mm; margin: 0; padding: 0; background: #fff; font-family: 'Inter', Arial, sans-serif; color: #1A1A1A; }
*, *::before, *::after { box-sizing: border-box; }

#page-table { width: 100%; border-collapse: collapse; table-layout: fixed; }
#page-table > thead { display: table-header-group; }
#page-table > tfoot { display: table-footer-group; }
#page-table > thead td, #page-table > tfoot td { padding: 0; }
#page-table > tbody > tr.bcpf-row-atomique { break-inside: avoid; page-break-inside: avoid; }

.bcpf-doc-header-bloc {
  padding: 10mm ${PAGE_MARGIN_MM}mm 0; display: grid; grid-template-columns: minmax(0, 1fr) auto;
  column-gap: 10mm; align-items: start; border-bottom: 1px solid #DADCD3;
}
.bcpf-doc-footer-bloc {
  padding: 4mm ${PAGE_MARGIN_MM}mm 0; border-top: 1px solid #DADCD3; text-align: center;
  font-size: 8.5px; color: #6B6B62; line-height: 1.7;
}
.bcpf-doc-footer-bloc .name { color: #1A1A1A; font-size: 9.5px; font-weight: 700; letter-spacing: 0.02em; }
.bcpf-doc-brand { font-family: Arial, sans-serif; font-weight: 700; font-size: 20px; letter-spacing: 0.04em; text-transform: uppercase; color: #1A1A1A; margin-bottom: 4mm; }
.bcpf-doc-logo { max-height: 12mm; max-width: 50mm; object-fit: contain; object-position: left top; display: block; margin-bottom: 4mm; }
.bcpf-doc-info-list { font-size: 10.5px; color: #1A1A1A; line-height: 1.85; }
.bcpf-doc-info-list div { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
.bcpf-doc-info-list span { color: #6B6B62; }
.bcpf-doc-info-list strong { color: #1A1A1A; font-weight: 600; }
.bcpf-doc-titre { font-size: 22px; font-weight: 700; letter-spacing: 0.01em; text-transform: uppercase; margin: 0; }
.bcpf-doc-badge-lancement { display: inline-block; font-size: 11.5px; font-weight: 600; border: 1px solid currentColor; border-radius: 3px; padding: 3px 10px; margin: 3px 0; letter-spacing: 0.02em; }
.bcpf-doc-sous-titre { font-size: 11px; color: #6B6B62; margin: 2px 0 0; }
.bcpf-doc-numero-titre { font-family: 'Inter', Arial, sans-serif; font-size: 12.5px; color: #1A1A1A; margin-top: 4px; font-weight: 700; }

.bcpf-content-cell { padding-top: 5mm; padding-left: ${PAGE_MARGIN_MM}mm; padding-right: ${PAGE_MARGIN_MM}mm; }
.bcpf-doc-destinataire { border: 1px solid #DADCD3; border-radius: 4px; padding: 5mm 6mm; margin-bottom: 9mm; }
.bcpf-doc-destinataire-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 3mm 8mm; margin-top: 3mm; }
.bcpf-doc-article { display: flex; gap: 8mm; margin-bottom: 9mm; }
.bcpf-doc-photo { width: 32mm; height: 32mm; flex-shrink: 0; border: 1px solid #DADCD3; border-radius: 3px; overflow: hidden; display: flex; align-items: center; justify-content: center; background: #FAFAF8; }
.bcpf-doc-photo img { width: 100%; height: 100%; object-fit: cover; display: block; }
.bcpf-doc-photo-empty { font-size: 8.5px; color: #B0B0A6; text-align: center; padding: 0 3mm; }
.bcpf-doc-article-info { flex: 1; min-width: 0; padding-top: 1mm; }
.bcpf-doc-article-title { font-size: 15.5px; font-weight: 700; margin: 0 0 2mm; }
.bcpf-doc-article-ref { display: inline-block; font-family: 'Inter', Arial, sans-serif; font-size: 10.5px; font-weight: 600; color: #4B4B43; background: #F2F3EE; border-radius: 3px; padding: 2px 8px; }
.bcpf-doc-field-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 5mm 6mm; margin-top: 5mm; }
.bcpf-doc-field-k { font-size: 8.5px; text-transform: uppercase; letter-spacing: 0.05em; color: #9A9A90; margin-bottom: 1.2mm; }
.bcpf-doc-field-v { font-size: 12px; font-weight: 500; }
.bcpf-doc-resume { display: flex; gap: 0; border: 1px solid #DADCD3; border-radius: 4px; margin-bottom: 8mm; }
.bcpf-doc-resume-item { flex: 1; text-align: center; padding: 4mm 6mm; border-right: 1px solid #DADCD3; }
.bcpf-doc-resume-item:last-child { border-right: none; }
.bcpf-doc-resume-item span { display: block; font-size: 8.5px; text-transform: uppercase; letter-spacing: 0.05em; color: #6B6B62; margin-bottom: 2mm; }
.bcpf-doc-resume-item strong { font-size: 14px; color: #1A1A1A; }
.bcpf-doc-resume-item strong.accent { color: #1F4B3C; }
.bcpf-doc-section-title { font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; margin: 0 0 4mm; color: #1A1A1A; }
.bcpf-doc-table-wrap { margin-bottom: 8mm; width: 100%; }

.bcpf-doc-table { width: 100%; max-width: 100%; border-collapse: collapse; table-layout: fixed; }
.bcpf-doc-table thead { display: table-header-group; }
.bcpf-doc-table tfoot { display: table-footer-group; }
.bcpf-doc-table tbody tr, .bcpf-doc-table thead tr, .bcpf-doc-table tfoot tr { break-inside: avoid; page-break-inside: avoid; }
.bcpf-doc-table th { background: #1F3A2E; font-size: 9px; text-transform: uppercase; letter-spacing: 0.04em; color: #fff; font-weight: 600; padding: 3mm 2mm; text-align: center; }
.bcpf-doc-table th:first-child, .bcpf-doc-table td:first-child { text-align: left; padding-left: 4mm; }
.bcpf-doc-table td { font-size: 11px; padding: 2.6mm 2mm; text-align: center; border-bottom: 1px solid #EEF0EA; }
.bcpf-doc-table tbody tr:nth-child(even) { background: #FAFAF8; }
.bcpf-doc-table tfoot td { font-weight: 700; border-top: 1.3px solid #1A1A1A; border-bottom: none; background: #F2F3EE; }
.bcpf-doc-table .col-total { color: #1F4B3C; }

.bcpf-doc-notes { border: 1px solid #DADCD3; border-radius: 4px; background: #fff; padding: 5mm 6mm; min-height: 22mm; }
.bcpf-doc-notes-label { font-size: 8.5px; text-transform: uppercase; letter-spacing: 0.05em; color: #9A9A90; margin-bottom: 2mm; }
.bcpf-doc-notes-text { font-size: 11.5px; white-space: pre-wrap; line-height: 1.5; }
.bcpf-doc-brouillon-tag { display: block; position: fixed; top: 45%; left: 0; width: 100%; text-align: center; font-size: 72px; font-weight: 800; color: rgba(220,38,38,0.13); letter-spacing: 8px; transform: rotate(-18deg); pointer-events: none; }
img { max-width: 100%; height: auto; }
`;

function buildBcPfHtml(bc, entreprise) {
  const logoHtml = bc.entreprise_logo_snapshot_path
    ? `<img src="${mediaUrl(bc.entreprise_logo_snapshot_path)}" alt="" class="bcpf-doc-logo" />`
    : `<div class="bcpf-doc-brand">Belvie</div>`;
  const badge = badgeLancement(bc.type_production);

  return `<!DOCTYPE html>
<html lang="fr">
<head><meta charset="utf-8" /><style>${CSS}</style></head>
<body>
  ${bc.statut === "brouillon" ? `<div class="bcpf-doc-brouillon-tag">BROUILLON</div>` : ""}

  <table id="page-table">
    <thead>
      <tr><td>
        <div class="bcpf-doc-header-bloc">
          <div>
            ${logoHtml}
            <p class="bcpf-doc-titre">Bon de commande</p>
            ${badge ? `<div class="bcpf-doc-badge-lancement" style="color:${badge.couleur}">${esc(badge.label)}</div>` : ""}
            <p class="bcpf-doc-sous-titre">${esc(typeDocumentLabel(bc.numero))}</p>
            <p class="bcpf-doc-numero-titre">N° ${esc(bc.numero)}</p>
          </div>
          <div class="bcpf-doc-info-list">
            <div><span>Commande</span><strong>${esc(bc.commande_numero)}</strong></div>
            <div><span>Date</span><strong>${fmtDate(bc.created_at)}</strong></div>
            <div><span>Date limite</span><strong>${esc(bc.date_limite_production || "—")}</strong></div>
            <div><span>Statut</span><strong>${esc(BC_STATUT_LABELS[bc.statut] || bc.statut)}</strong></div>
            <div><span>Priorité</span><strong>${esc(bc.priorite || "—")}</strong></div>
          </div>
        </div>
      </td></tr>
    </thead>

    <tfoot>
      <tr><td>
        <div class="bcpf-doc-footer-bloc">${buildFooterInnerHtml(entreprise)}</div>
      </td></tr>
    </tfoot>

    <tbody>
      <tr class="bcpf-row-atomique"><td class="bcpf-content-cell">
        <div class="bcpf-doc-destinataire">
          <div class="bcpf-doc-section-title">Destinataire</div>
          <div class="bcpf-doc-destinataire-grid">
            <div><div class="bcpf-doc-field-k">Atelier</div><div class="bcpf-doc-field-v">${esc(bc.atelier_nom || "—")}</div></div>
            <div><div class="bcpf-doc-field-k">Responsable</div><div class="bcpf-doc-field-v">${esc(bc.responsable_nom || "—")}</div></div>
            <div><div class="bcpf-doc-field-k">Téléphone</div><div class="bcpf-doc-field-v">—</div></div>
            <div><div class="bcpf-doc-field-k">Adresse</div><div class="bcpf-doc-field-v">—</div></div>
          </div>
        </div>
      </td></tr>

      <tr class="bcpf-row-atomique"><td class="bcpf-content-cell">
        <div class="bcpf-doc-article">
          <div class="bcpf-doc-photo">
            ${bc.photo_snapshot_path ? `<img src="${mediaUrl(bc.photo_snapshot_path)}" alt="" />` : `<span class="bcpf-doc-photo-empty">Aucune image</span>`}
          </div>
          <div class="bcpf-doc-article-info">
            <div class="bcpf-doc-article-title">${esc(bc.article_nom)}</div>
            <span class="bcpf-doc-article-ref">${esc(bc.article_reference)}</span>
            <div class="bcpf-doc-field-grid">
              <div><div class="bcpf-doc-field-k">Type</div><div class="bcpf-doc-field-v">${esc(bc.type_production ? TYPE_PRODUCTION_LABELS[bc.type_production] : "—")}</div></div>
              <div><div class="bcpf-doc-field-k">Saison</div><div class="bcpf-doc-field-v">${esc(bc.saison_nom || "—")}</div></div>
            </div>
          </div>
        </div>
      </td></tr>

      <tr class="bcpf-row-atomique"><td class="bcpf-content-cell">
        ${buildResumeProductionHtml(bc.lignes ?? [])}
      </td></tr>

      <tr><td class="bcpf-content-cell">
        <div class="bcpf-doc-section-title">Répartition</div>
        <div class="bcpf-doc-table-wrap">${buildRepartitionTableHtml(bc.lignes ?? [])}</div>
      </td></tr>

      <tr class="bcpf-row-atomique"><td class="bcpf-content-cell">
        <div class="bcpf-doc-notes">
          <div class="bcpf-doc-notes-label">Notes / instructions (atelier)</div>
          <div class="bcpf-doc-notes-text">${esc(bc.notes_atelier || "—")}</div>
        </div>
      </td></tr>
    </tbody>
  </table>
</body>
</html>`;
}

async function genererPdfDepuisFenetreDediee(html, outputPath) {
  const printWindow = new BrowserWindow({
    show: false,
    width: 794,
    height: 1123,
    useContentSize: true,
    backgroundColor: "#ffffff",
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  try {
    await printWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);

    await printWindow.webContents.executeJavaScript(`
      Promise.all([
        document.fonts.ready,
        ...Array.from(document.images).map((image) => {
          if (image.complete) return Promise.resolve();
          return new Promise((resolve) => {
            image.addEventListener("load", resolve, { once: true });
            image.addEventListener("error", resolve, { once: true });
          });
        })
      ])
    `);

    // Le pied de page (tfoot, en "table-footer-group") se répète correctement sur chaque page,
    // mais se place naturellement juste après la fin du contenu de cette page — pas collé au bas
    // physique de la feuille. On insère donc, avant chacun des grands blocs (Destinataire, Article,
    // Résumé, Répartition, Notes), une ligne invisible dont la hauteur est calculée pour combler
    // l'espace restant dès qu'un bloc ne tiendrait plus sur la page en cours — ce qui pousse le
    // pied de page jusqu'en bas de CETTE page avant de passer à la suivante. Si le tableau de
    // répartition lui-même doit se couper au milieu (beaucoup de couleurs), cette mesure ne peut
    // pas anticiper où exactement — dans ce cas précis, le pied de page reste correctement répété
    // et rien n'est jamais caché, mais sa position sur ces pages intermédiaires précises peut ne
    // pas être collée au bas au pixel près.
    await printWindow.webContents.executeJavaScript(`
      (function () {
        const mmToPx = (mm) => mm * 96 / 25.4;
        const PAGE_HEIGHT_PX = mmToPx(297);
        const SECURITE_PX = mmToPx(10); // marge confortable entre le pied de page et le bord physique de la feuille — identique sur chaque page, puisque ce calcul s'applique à toutes.

        const table = document.getElementById('page-table');
        if (!table) return { ok: false, raison: 'page-table introuvable' };
        const thead = table.querySelector('thead');
        const tfoot = table.querySelector('tfoot');
        const tbody = table.querySelector('tbody');
        if (!thead || !tfoot || !tbody) return { ok: false, raison: 'thead/tfoot/tbody introuvables' };

        const headerHeight = thead.getBoundingClientRect().height;
        const footerHeight = tfoot.getBoundingClientRect().height;
        const disponiblePage = PAGE_HEIGHT_PX - headerHeight - footerHeight - SECURITE_PX;

        const blocs = Array.from(tbody.querySelectorAll(':scope > tr'));
        let hauteurPage = 0;
        let nbEspaceurs = 0;
        let dernierBloc = null;
        blocs.forEach((bloc) => {
          const h = bloc.getBoundingClientRect().height;
          if (hauteurPage + h > disponiblePage && hauteurPage > 0) {
            const espaceur = document.createElement('tr');
            const td = document.createElement('td');
            td.style.height = Math.max(0, disponiblePage - hauteurPage) + 'px';
            td.style.padding = '0';
            espaceur.appendChild(td);
            bloc.parentNode.insertBefore(espaceur, bloc);
            hauteurPage = 0;
            nbEspaceurs++;
          }
          hauteurPage += h;
          dernierBloc = bloc;
        });

        // La boucle ci-dessus ne pousse le pied de page vers le bas qu'ENTRE deux blocs, quand on
        // détecte un changement de page. Sans ce complément, la toute DERNIÈRE page (après le
        // dernier bloc, ici Notes) ne reçoit jamais cet espaceur — son pied de page reste collé
        // juste après le contenu au lieu d'être aligné comme sur les pages précédentes.
        if (dernierBloc && hauteurPage > 0) {
          const espaceurFinal = document.createElement('tr');
          const tdFinal = document.createElement('td');
          tdFinal.style.height = Math.max(0, disponiblePage - hauteurPage) + 'px';
          tdFinal.style.padding = '0';
          espaceurFinal.appendChild(tdFinal);
          dernierBloc.parentNode.insertBefore(espaceurFinal, dernierBloc.nextSibling);
        }

        return { ok: true, headerHeight, footerHeight, disponiblePage, nbEspaceurs };
      })()
    `);

    const pdfBuffer = await printWindow.webContents.printToPDF({
      printBackground: true,
      preferCSSPageSize: true,
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
    });

    await fs.writeFile(outputPath, pdfBuffer);
  } finally {
    if (!printWindow.isDestroyed()) printWindow.destroy();
  }
}

module.exports = { buildBcPfHtml, genererPdfDepuisFenetreDediee };
