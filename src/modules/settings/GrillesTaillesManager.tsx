import { useEffect, useState } from "react";
import { GrilleTaille, ListeValeur } from "../../shared/types";
import Accordion from "./Accordion";

interface Props {
  onChanged?: () => void;
}

export default function GrillesTaillesManager({ onChanged }: Props) {
  const [grilles, setGrilles] = useState<GrilleTaille[]>([]);
  const [newGrilleNom, setNewGrilleNom] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editingGrilleId, setEditingGrilleId] = useState<number | null>(null);
  const [editingGrilleNom, setEditingGrilleNom] = useState("");
  const [newValeurByGrille, setNewValeurByGrille] = useState<Record<number, string>>({});
  const [editingValeur, setEditingValeur] = useState<{ grilleId: number; valeurId: number; texte: string } | null>(null);
  // Association Type de produit -> Grille. Les fonctions existaient deja (getGrillePourProduit /
  // setGrillePourProduit, canaux IPC et preload compris) mais aucune interface ne les appelait :
  // produit_grille_taille restait donc vide, et la commande n'avait aucune taille a proposer.
  const [types, setTypes] = useState<ListeValeur[]>([]);
  const [associations, setAssociations] = useState<Record<number, number | null>>({});

  async function refresh() {
    const list = await window.api.grillesTailles.list({ activesSeulement: false });
    setGrilles([...list].sort((a, b) => a.nom.localeCompare(b.nom)));
    onChanged?.();
  }
  async function refreshAssociations() {
    const t = await window.api.listes.list("produit");
    setTypes([...t].sort((a, b) => a.nom.localeCompare(b.nom)));
    const paires = await Promise.all(
      t.map(async (p: ListeValeur) => {
        try {
          const g = await window.api.grillesTailles.getPourProduit(p.id);
          return [p.id, g ? g.id : null] as [number, number | null];
        } catch { return [p.id, null] as [number, number | null]; }
      })
    );
    setAssociations(Object.fromEntries(paires));
  }

  async function handleAssocier(produitId: number, grilleId: number | null) {
    setBusy(true);
    setError(null);
    try {
      await window.api.grillesTailles.setPourProduit(produitId, grilleId);
      setAssociations((prev) => ({ ...prev, [produitId]: grilleId }));
    } catch (err: any) {
      setError(err?.message || "Association impossible.");
      refreshAssociations();
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => { refresh(); refreshAssociations(); }, []);

  async function handleCreerGrille() {
    if (!newGrilleNom.trim()) { setError("Le nom de la grille est obligatoire."); return; }
    setBusy(true);
    try {
      await window.api.grillesTailles.creer(newGrilleNom);
      setNewGrilleNom("");
      setError(null);
      refresh();
    } catch (err: any) {
      setError(err?.message || "Erreur lors de la création.");
    } finally {
      setBusy(false);
    }
  }

  async function handleRenommerGrille(grille: GrilleTaille) {
    if (!editingGrilleNom.trim()) return;
    setBusy(true);
    try {
      await window.api.grillesTailles.renommer(grille.id, editingGrilleNom);
      setEditingGrilleId(null);
      refresh();
    } finally {
      setBusy(false);
    }
  }

  async function handleToggleActifGrille(grille: GrilleTaille) {
    setBusy(true);
    try {
      await window.api.grillesTailles.setActive(grille.id, !grille.actif);
      refresh();
    } finally {
      setBusy(false);
    }
  }

  async function handleSupprimerGrille(grille: GrilleTaille) {
    setBusy(true);
    setError(null);
    try {
      await window.api.grillesTailles.supprimer(grille.id);
      refresh();
    } catch (err: any) {
      setError(err?.message || "Erreur lors de la suppression.");
    } finally {
      setBusy(false);
    }
  }

  async function handleAjouterValeur(grille: GrilleTaille) {
    const valeur = (newValeurByGrille[grille.id] || "").trim();
    if (!valeur) return;
    setBusy(true);
    try {
      await window.api.grillesTailles.ajouterValeur(grille.id, valeur);
      setNewValeurByGrille((prev) => ({ ...prev, [grille.id]: "" }));
      refresh();
    } finally {
      setBusy(false);
    }
  }

  async function handleEnregistrerValeur() {
    if (!editingValeur || !editingValeur.texte.trim()) return;
    setBusy(true);
    try {
      await window.api.grillesTailles.modifierValeur(editingValeur.grilleId, editingValeur.valeurId, editingValeur.texte);
      setEditingValeur(null);
      refresh();
    } finally {
      setBusy(false);
    }
  }

  async function handleSupprimerValeur(grille: GrilleTaille, valeurId: number) {
    setBusy(true);
    try {
      await window.api.grillesTailles.supprimerValeur(grille.id, valeurId);
      refresh();
    } finally {
      setBusy(false);
    }
  }

  async function move(grille: GrilleTaille, index: number, dir: -1 | 1) {
    const ids = grille.valeurs.map((v) => v.id);
    const target = index + dir;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    setBusy(true);
    try {
      await window.api.grillesTailles.reordonnerValeurs(grille.id, ids);
      refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="settings-section">
      <h3>Grilles de tailles</h3>
      <p className="desc">
        Chaque grille (Vêtements, Pantalons, Chaussures...) possède ses propres valeurs, dans son propre ordre — aucune
        logique alphabétique ou numérique n'est codée en dur. Un type de produit peut être associé à une grille, pour que
        seules ses tailles soient proposées à la création d'un article ou d'une fiche technique.
      </p>

      {error && <p style={{ color: "#C0392B", fontSize: 12, marginTop: 6 }}>{error}</p>}

      <div className="settings-actions" style={{ marginBottom: 16 }}>
        <input
          placeholder="Nom de la nouvelle grille (ex: Combinaisons)"
          value={newGrilleNom}
          onChange={(e) => setNewGrilleNom(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleCreerGrille()}
          style={{ minWidth: 260 }}
        />
        <button className="btn primary" onClick={handleCreerGrille} disabled={busy}>Créer une grille</button>
      </div>

      {grilles.length === 0 && <p className="hint">Aucune grille pour le moment.</p>}

      {/* Association Type de produit -> Grille. C'est cette table qui determine les tailles
          proposees a la creation d'une commande : sans elle, aucune taille n'est disponible.
          Plusieurs types peuvent partager la meme grille. */}
      <div style={{ marginTop: 22, paddingTop: 16, borderTop: "1px solid #EEF0EA" }}>
        <h3 style={{ marginBottom: 4 }}>Grille par type de produit</h3>
        <p className="desc">
          Détermine les tailles proposées lors de la création d'une commande. Plusieurs types de produits
          peuvent partager la même grille. Un type sans grille ne proposera aucune taille : la commande
          vous le signalera plutôt que d'en choisir une au hasard.
        </p>

        {types.length === 0 ? (
          <p className="hint">Aucun type de produit. Créez-en dans « Catalogue produit ».</p>
        ) : (
          <div className="scroll-list">
            {types.map((t) => (
              <div className="settings-row" key={t.id}>
                <div className="libelle" style={{ opacity: t.actif ? 1 : 0.55, minWidth: 160 }}>
                  {t.nom}{t.actif ? "" : " (désactivé)"}
                </div>
                <select
                  value={associations[t.id] ?? ""}
                  disabled={busy}
                  onChange={(e) => handleAssocier(t.id, e.target.value ? Number(e.target.value) : null)}
                  style={{ minWidth: 220 }}
                >
                  <option value="">— aucune grille —</option>
                  {grilles.filter((g) => g.actif || associations[t.id] === g.id).map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.nom} ({g.valeurs.length} tailles){g.actif ? "" : " — désactivée"}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        )}
      </div>

      {grilles.map((grille) => (
        <Accordion key={grille.id} title={grille.nom + (grille.actif ? "" : " (désactivée)")} count={grille.valeurs.length} defaultOpen={false}>
          <div className="settings-row" style={{ marginBottom: 10 }}>
            {editingGrilleId === grille.id ? (
              <>
                <input value={editingGrilleNom} onChange={(e) => setEditingGrilleNom(e.target.value)} autoFocus />
                <button className="btn ghost" onClick={() => handleRenommerGrille(grille)}>Enregistrer</button>
                <button className="btn ghost" onClick={() => setEditingGrilleId(null)}>Annuler</button>
              </>
            ) : (
              <>
                <div className="libelle" style={{ opacity: grille.actif ? 1 : 0.55, fontWeight: 600 }}>{grille.nom}</div>
                <button className="btn ghost" onClick={() => { setEditingGrilleId(grille.id); setEditingGrilleNom(grille.nom); }}>Renommer</button>
                {grille.actif ? (
                  <button className="btn ghost" onClick={() => handleToggleActifGrille(grille)}>Désactiver</button>
                ) : (
                  <button className="btn ghost" onClick={() => handleToggleActifGrille(grille)}>Réactiver</button>
                )}
                <button className="btn ghost" style={{ color: "#C0392B" }} onClick={() => handleSupprimerGrille(grille)}>Supprimer</button>
              </>
            )}
          </div>

          <div className="scroll-list" style={{ marginBottom: 10 }}>
            {grille.valeurs.length === 0 && <p className="hint">Aucune valeur dans cette grille.</p>}
            {grille.valeurs.map((v, index) => (
              <div className="settings-row" key={v.id}>
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  <button className="btn ghost quick-add-btn" style={{ padding: "2px 8px", fontSize: 11 }} disabled={index === 0 || busy} onClick={() => move(grille, index, -1)}>▲</button>
                  <button className="btn ghost quick-add-btn" style={{ padding: "2px 8px", fontSize: 11 }} disabled={index === grille.valeurs.length - 1 || busy} onClick={() => move(grille, index, 1)}>▼</button>
                </div>
                {editingValeur && editingValeur.grilleId === grille.id && editingValeur.valeurId === v.id ? (
                  <>
                    <input
                      value={editingValeur.texte}
                      onChange={(e) => setEditingValeur({ ...editingValeur, texte: e.target.value })}
                      autoFocus
                    />
                    <button className="btn ghost" onClick={handleEnregistrerValeur}>Enregistrer</button>
                    <button className="btn ghost" onClick={() => setEditingValeur(null)}>Annuler</button>
                  </>
                ) : (
                  <>
                    <div className="libelle" style={{ opacity: v.actif ? 1 : 0.55 }}>{v.valeur}</div>
                    <button className="btn ghost" onClick={() => setEditingValeur({ grilleId: grille.id, valeurId: v.id, texte: v.valeur })}>Modifier</button>
                    <button className="btn ghost" style={{ color: "#C0392B" }} onClick={() => handleSupprimerValeur(grille, v.id)}>Supprimer</button>
                  </>
                )}
              </div>
            ))}
          </div>

          <div className="settings-actions">
            <input
              placeholder="Ajouter une valeur (ex: XS, 38, 1...)"
              value={newValeurByGrille[grille.id] || ""}
              onChange={(e) => setNewValeurByGrille((prev) => ({ ...prev, [grille.id]: e.target.value }))}
              onKeyDown={(e) => e.key === "Enter" && handleAjouterValeur(grille)}
            />
            <button className="btn ghost" onClick={() => handleAjouterValeur(grille)} disabled={busy}>Ajouter</button>
          </div>
        </Accordion>
      ))}
    </div>
  );
}
