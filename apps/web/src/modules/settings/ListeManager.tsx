import { useEffect, useState } from "react";
import { ListeType, ListeValeur } from "../../shared/types";
import Accordion from "./Accordion";
import ConfirmDialog from "../commandes/ConfirmDialog";
import { RENAME_WARNING, RENAME_HINT } from "./renameWarning";

interface Props {
  type: ListeType;
  title: string;
  description: string;
  orderable?: boolean;
  coded?: boolean;
}

export default function ListeManager({ type, title, description, orderable = false, coded = false }: Props) {
  const [values, setValues] = useState<ListeValeur[]>([]);
  const [search, setSearch] = useState("");
  const [inactiveOpen, setInactiveOpen] = useState(false);
  const [newNom, setNewNom] = useState("");
  const [newCode, setNewCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingNom, setEditingNom] = useState("");
  const [editingCode, setEditingCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [pendingRename, setPendingRename] = useState<{ v: ListeValeur; nouveauNom: string; nouveauCode: string } | null>(null);

  async function refresh() {
    const list = await window.api.listes.list(type, { includeInactive: true });
    setValues(orderable ? [...list].sort((a, b) => (a.ordre ?? 0) - (b.ordre ?? 0)) : list);
  }
  useEffect(() => { refresh(); }, []);

  const activeValues = values.filter((v) => v.actif);
  const inactiveValues = values.filter((v) => !v.actif);

  const q = search.trim().toLowerCase();
  const matches = (v: ListeValeur) => v.nom.toLowerCase().includes(q) || (v.code ?? "").toLowerCase().includes(q);
  const filteredActive = q ? activeValues.filter(matches) : activeValues;
  const filteredInactive = q ? inactiveValues.filter(matches) : inactiveValues;

  useEffect(() => {
    if (q && filteredInactive.length > 0) setInactiveOpen(true);
  }, [q, filteredInactive.length]);

  async function handleAdd() {
    if (!newNom.trim()) {
      setError("Le nom ne peut pas être vide.");
      return;
    }
    if (coded && !newCode.trim()) {
      setError("Le code est obligatoire.");
      return;
    }
    try {
      await window.api.listes.create(type, newNom, coded ? { code: newCode } : undefined);
      setNewNom("");
      setNewCode("");
      setError(null);
      refresh();
    } catch (err: any) {
      setError(err?.message || "Erreur lors de l'ajout.");
    }
  }

  async function handleToggleActif(v: ListeValeur) {
    await window.api.listes.update(v.id, { actif: !v.actif });
    refresh();
  }

  function requestRename(v: ListeValeur) {
    const nouveauNom = editingNom.trim();
    const nouveauCode = editingCode.trim().toUpperCase();
    if (!nouveauNom) return;
    if (coded && !nouveauCode) {
      setError("Le code ne peut pas être vide.");
      return;
    }
    if (nouveauNom === v.nom && (!coded || nouveauCode === v.code)) {
      setEditingId(null);
      return;
    }
    setPendingRename({ v, nouveauNom, nouveauCode });
  }

  async function confirmRename() {
    if (!pendingRename) return;
    try {
      const patch: { nom?: string; code?: string } = { nom: pendingRename.nouveauNom };
      if (coded) patch.code = pendingRename.nouveauCode;
      await window.api.listes.update(pendingRename.v.id, patch);
      setEditingId(null);
      setPendingRename(null);
      refresh();
    } catch (err: any) {
      setError(err?.message || "Erreur lors de la modification.");
      setPendingRename(null);
    }
  }

  async function move(list: ListeValeur[], index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= list.length || busy) return;
    setBusy(true);
    try {
      const a = list[index];
      const b = list[target];
      await window.api.listes.update(a.id, { ordre: b.ordre ?? target });
      await window.api.listes.update(b.id, { ordre: a.ordre ?? index });
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  function renderRow(v: ListeValeur, index: number, orderList: ListeValeur[], showOrder: boolean, showDeactivate: boolean) {
    return (
      <div className="settings-row" key={v.id}>
        {orderable && showOrder && (
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <button className="btn ghost quick-add-btn" style={{ padding: "2px 8px", fontSize: 11 }} disabled={index === 0 || busy} onClick={() => move(orderList, index, -1)}>▲</button>
            <button className="btn ghost quick-add-btn" style={{ padding: "2px 8px", fontSize: 11 }} disabled={index === orderList.length - 1 || busy} onClick={() => move(orderList, index, 1)}>▼</button>
          </div>
        )}
        {editingId === v.id ? (
          <>
            <input
              type="text"
              value={editingNom}
              onChange={(e) => setEditingNom(e.target.value)}
              autoFocus
              style={{ flex: 1, border: "1px solid #D8D9D0", borderRadius: 6, padding: "5px 8px", fontSize: 13 }}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); requestRename(v); } }}
            />
            {coded && (
              <input
                type="text"
                value={editingCode}
                onChange={(e) => setEditingCode(e.target.value.toUpperCase())}
                placeholder="Code"
                maxLength={6}
                style={{ width: 70, border: "1px solid #D8D9D0", borderRadius: 6, padding: "5px 8px", fontSize: 13, fontFamily: "IBM Plex Mono, monospace" }}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); requestRename(v); } }}
              />
            )}
            <button className="btn ghost" onClick={() => requestRename(v)}>Enregistrer</button>
            <button className="btn ghost" onClick={() => setEditingId(null)}>Annuler</button>
          </>
        ) : (
          <>
            <div className="libelle" style={{ opacity: v.actif ? 1 : 0.55 }}>
              {v.nom}
              {coded && v.code && <span className="code-badge">{v.code}</span>}
            </div>
            <button
              className="btn ghost"
              title={RENAME_HINT}
              onClick={() => { setEditingId(v.id); setEditingNom(v.nom); setEditingCode(v.code ?? ""); }}
            >
              Modifier le libellé
            </button>
            {showDeactivate ? (
              <button className="btn ghost" onClick={() => handleToggleActif(v)}>Désactiver</button>
            ) : (
              <button className="btn ghost" onClick={() => handleToggleActif(v)}>Réactiver</button>
            )}
          </>
        )}
      </div>
    );
  }

  return (
    <Accordion title={title} count={activeValues.length}>
      <p className="desc">{description}</p>

      <div className="search-mini">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={`Rechercher dans ${title.toLowerCase()}...`}
        />
      </div>

      <p className="subgroup-label">🟢 Valeurs actives ({filteredActive.length})</p>
      <div className="scroll-list">
        {filteredActive.map((v, index) => renderRow(v, index, activeValues, true, true))}
        {filteredActive.length === 0 && (
          <p className="hint">{q ? "Aucune valeur active ne correspond à la recherche." : "Aucune valeur active pour le moment."}</p>
        )}
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <input
          type="text"
          value={newNom}
          onChange={(e) => setNewNom(e.target.value)}
          placeholder="Ajouter une nouvelle valeur..."
          style={{ flex: 1, border: "1px solid #D8D9D0", borderRadius: 6, padding: "7px 8px", fontSize: 13 }}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleAdd(); } }}
        />
        {coded && (
          <input
            type="text"
            value={newCode}
            onChange={(e) => setNewCode(e.target.value.toUpperCase())}
            placeholder="Code"
            maxLength={6}
            style={{ width: 80, border: "1px solid #D8D9D0", borderRadius: 6, padding: "7px 8px", fontSize: 13, fontFamily: "IBM Plex Mono, monospace" }}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleAdd(); } }}
          />
        )}
        <button className="btn primary" onClick={handleAdd}>Ajouter</button>
      </div>
      {error && <p style={{ color: "#C0392B", fontSize: 12, marginTop: 6 }}>{error}</p>}

      {inactiveValues.length > 0 && (
        <div className="inactive-subsection">
          <button type="button" className="accordion-header sub" onClick={() => setInactiveOpen((o) => !o)} aria-expanded={inactiveOpen}>
            <span className="accordion-chevron">{inactiveOpen ? "▼" : "▶"}</span>
            <span className="accordion-title">Valeurs désactivées</span>
            <span className="accordion-count">({inactiveValues.length})</span>
          </button>
          {inactiveOpen && (
            <div className="scroll-list">
              {filteredInactive.map((v, index) => renderRow(v, index, inactiveValues, false, false))}
              {filteredInactive.length === 0 && q && (
                <p className="hint">Aucune valeur désactivée ne correspond à la recherche.</p>
              )}
            </div>
          )}
        </div>
      )}

      {pendingRename && (
        <ConfirmDialog
          title="Confirmer la modification du libellé ?"
          message={`« ${pendingRename.v.nom}${coded && pendingRename.v.code ? " (" + pendingRename.v.code + ")" : ""} » → « ${pendingRename.nouveauNom}${coded ? " (" + pendingRename.nouveauCode + ")" : ""} »\n\n${RENAME_WARNING}`}
          confirmLabel="Modifier le libellé"
          onConfirm={confirmRename}
          onCancel={() => setPendingRename(null)}
        />
      )}
    </Accordion>
  );
}
