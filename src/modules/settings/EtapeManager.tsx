import { useEffect, useState } from "react";
import { Etape } from "../../shared/types";
import Accordion from "./Accordion";
import ConfirmDialog from "../commandes/ConfirmDialog";
import { RENAME_WARNING, RENAME_HINT } from "./renameWarning";

export default function EtapeManager() {
  const [etapes, setEtapes] = useState<Etape[]>([]);
  const [search, setSearch] = useState("");
  const [inactiveOpen, setInactiveOpen] = useState(false);
  const [newLibelle, setNewLibelle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingLibelle, setEditingLibelle] = useState("");
  const [busy, setBusy] = useState(false);
  const [pendingRename, setPendingRename] = useState<{ e: Etape; nouveauLibelle: string } | null>(null);

  async function refresh() {
    const list = await window.api.etapes.list({ includeInactive: true });
    setEtapes([...list].sort((a, b) => a.ordre - b.ordre));
  }
  useEffect(() => { refresh(); }, []);

  const activeEtapes = etapes.filter((e) => e.actif);
  const inactiveEtapes = etapes.filter((e) => !e.actif);

  const q = search.trim().toLowerCase();
  const filteredActive = q ? activeEtapes.filter((e) => e.libelle.toLowerCase().includes(q)) : activeEtapes;
  const filteredInactive = q ? inactiveEtapes.filter((e) => e.libelle.toLowerCase().includes(q)) : inactiveEtapes;

  useEffect(() => {
    if (q && filteredInactive.length > 0) setInactiveOpen(true);
  }, [q, filteredInactive.length]);

  async function handleAdd() {
    if (!newLibelle.trim()) {
      setError("Le nom de l'étape ne peut pas être vide.");
      return;
    }
    try {
      await window.api.etapes.create({ libelle: newLibelle });
      setNewLibelle("");
      setError(null);
      refresh();
    } catch (err: any) {
      setError(err?.message || "Erreur lors de l'ajout.");
    }
  }

  async function handleToggleActif(e: Etape) {
    await window.api.etapes.update(e.id, { actif: !e.actif });
    refresh();
  }

  // Étape 1 : confirmation demandée avant tout appel API — si l'utilisateur annule,
  // rien n'est modifié.
  function requestRename(e: Etape) {
    const nouveauLibelle = editingLibelle.trim();
    if (!nouveauLibelle) return;
    if (nouveauLibelle === e.libelle) {
      setEditingId(null);
      return;
    }
    setPendingRename({ e, nouveauLibelle });
  }

  // Étape 2 : confirmation reçue — le contrôle des doublons (casse/espaces ignorés) est
  // fait côté serveur à ce moment précis, pas avant.
  async function confirmRename() {
    if (!pendingRename) return;
    try {
      await window.api.etapes.update(pendingRename.e.id, { libelle: pendingRename.nouveauLibelle });
      setEditingId(null);
      setPendingRename(null);
      refresh();
    } catch (err: any) {
      setError(err?.message || "Erreur lors du renommage.");
      setPendingRename(null);
    }
  }

  async function move(list: Etape[], index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= list.length || busy) return;
    setBusy(true);
    try {
      const a = list[index];
      const b = list[target];
      await window.api.etapes.update(a.id, { ordre: b.ordre });
      await window.api.etapes.update(b.id, { ordre: a.ordre });
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  function renderRow(e: Etape, index: number, orderList: Etape[], showOrder: boolean, showDeactivate: boolean) {
    return (
      <div className="settings-row" key={e.id}>
        {showOrder && (
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <button className="btn ghost quick-add-btn" style={{ padding: "2px 8px", fontSize: 11 }} disabled={index === 0 || busy} onClick={() => move(orderList, index, -1)}>▲</button>
            <button className="btn ghost quick-add-btn" style={{ padding: "2px 8px", fontSize: 11 }} disabled={index === orderList.length - 1 || busy} onClick={() => move(orderList, index, 1)}>▼</button>
          </div>
        )}
        {editingId === e.id ? (
          <>
            <input
              type="text"
              value={editingLibelle}
              onChange={(ev) => setEditingLibelle(ev.target.value)}
              autoFocus
              style={{ flex: 1, border: "1px solid #D8D9D0", borderRadius: 6, padding: "5px 8px", fontSize: 13 }}
              onKeyDown={(ev) => { if (ev.key === "Enter") { ev.preventDefault(); requestRename(e); } }}
            />
            <button className="btn ghost" onClick={() => requestRename(e)}>Enregistrer</button>
            <button className="btn ghost" onClick={() => setEditingId(null)}>Annuler</button>
          </>
        ) : (
          <>
            <div className="libelle" style={{ opacity: e.actif ? 1 : 0.55 }}>
              {e.libelle}
              {e.optionnelle ? <small>Étape optionnelle</small> : null}
            </div>
            <button
              className="btn ghost"
              title={RENAME_HINT}
              onClick={() => { setEditingId(e.id); setEditingLibelle(e.libelle); }}
            >
              Modifier le libellé
            </button>
            {showDeactivate ? (
              <button className="btn ghost" onClick={() => handleToggleActif(e)}>Désactiver</button>
            ) : (
              <button className="btn ghost" onClick={() => handleToggleActif(e)}>Réactiver</button>
            )}
          </>
        )}
      </div>
    );
  }

  return (
    <Accordion title="Étapes de production" count={activeEtapes.length}>
      <p className="desc">
        L'utilisateur indique uniquement l'étape où se trouve la commande — pas de pourcentage à gérer. Réordonnez avec les
        flèches, ou désactivez une étape sans supprimer l'historique des commandes qui l'utilisent déjà.
      </p>

      <div className="search-mini">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Rechercher une étape..."
        />
      </div>

      <p className="subgroup-label">🟢 Étapes actives ({filteredActive.length})</p>
      <div className="scroll-list">
        {filteredActive.map((e, index) => renderRow(e, index, activeEtapes, true, true))}
        {filteredActive.length === 0 && (
          <p className="hint">{q ? "Aucune étape active ne correspond à la recherche." : "Aucune étape active pour le moment."}</p>
        )}
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <input
          type="text"
          value={newLibelle}
          onChange={(e) => setNewLibelle(e.target.value)}
          placeholder="Ajouter une nouvelle étape..."
          style={{ flex: 1, border: "1px solid #D8D9D0", borderRadius: 6, padding: "7px 8px", fontSize: 13 }}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleAdd(); } }}
        />
        <button className="btn primary" onClick={handleAdd}>Ajouter</button>
      </div>
      {error && <p style={{ color: "#C0392B", fontSize: 12, marginTop: 6 }}>{error}</p>}

      {inactiveEtapes.length > 0 && (
        <div className="inactive-subsection">
          <button type="button" className="accordion-header sub" onClick={() => setInactiveOpen((o) => !o)} aria-expanded={inactiveOpen}>
            <span className="accordion-chevron">{inactiveOpen ? "▼" : "▶"}</span>
            <span className="accordion-title">Étapes désactivées</span>
            <span className="accordion-count">({inactiveEtapes.length})</span>
          </button>
          {inactiveOpen && (
            <div className="scroll-list">
              {filteredInactive.map((e, index) => renderRow(e, index, inactiveEtapes, false, false))}
              {filteredInactive.length === 0 && q && (
                <p className="hint">Aucune étape désactivée ne correspond à la recherche.</p>
              )}
            </div>
          )}
        </div>
      )}

      {pendingRename && (
        <ConfirmDialog
          title="Confirmer la modification du libellé ?"
          message={`« ${pendingRename.e.libelle} » → « ${pendingRename.nouveauLibelle} »\n\n${RENAME_WARNING}`}
          confirmLabel="Modifier le libellé"
          onConfirm={confirmRename}
          onCancel={() => setPendingRename(null)}
        />
      )}
    </Accordion>
  );
}
