import { useEffect, useState } from "react";
import { ComplementStandard, MesureCatalogue, ModeleMesures, ModeleStandard } from "../../shared/types";

// Panneau de gestion des modèles de tableaux de mesures — déplacé depuis Paramètres : ce n'est pas
// un réglage global de l'application, mais un outil de travail du bureau d'études, utilisé au
// moment de concevoir un produit. Toujours ouvert dans le contexte d'un type de produit déjà
// connu (celui de l'article en cours) — plus de liste de types de produits à choisir à gauche.
interface Props {
  produitId: number;
  produitNom: string;
  onClose: () => void;
}

export default function ModelesMesuresPanel({ produitId, produitNom, onClose }: Props) {
  const [modeles, setModeles] = useState<ModeleMesures[]>([]);
  const [modeleId, setModeleId] = useState<number | null>(null);
  const [modele, setModele] = useState<ModeleMesures | null>(null);
  const [standards, setStandards] = useState<ModeleStandard[]>([]);
  const [complements, setComplements] = useState<ComplementStandard[]>([]);
  // Jeu de base chargé dans CE modèle, retenu le temps de la session : sert uniquement à filtrer
  // les compléments proposés (proposer « Bord-côte bomber » sur un short n'aiderait personne).
  const [cleBaseChargee, setCleBaseChargee] = useState<string | null>(null);
  const [nouveauNom, setNouveauNom] = useState("");
  const [mesureQuery, setMesureQuery] = useState("");
  const [mesureResults, setMesureResults] = useState<MesureCatalogue[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function refreshList() {
    const list = await window.api.modelesMesures.listByProduitId(produitId, { actifsSeulement: false });
    setModeles(list);
  }
  useEffect(() => {
    refreshList();
    window.api.modelesMesures.listModelesStandards().then(setStandards);
  }, [produitId]);

  useEffect(() => {
    window.api.modelesMesures.listComplementsStandards(cleBaseChargee || undefined).then(setComplements);
  }, [cleBaseChargee]);

  // Changer de modèle réinitialise le filtre : le jeu de base du précédent ne dit rien du nouveau.
  useEffect(() => { setCleBaseChargee(null); }, [modeleId]);

  useEffect(() => {
    if (modeleId == null) { setModele(null); return; }
    window.api.modelesMesures.getById(modeleId).then(setModele);
  }, [modeleId]);

  useEffect(() => {
    window.api.ficheTechnique.searchMesuresCatalogue(mesureQuery).then(setMesureResults);
  }, [mesureQuery]);

  function notifyErr(msg: string) { setError(msg); setTimeout(() => setError(null), 3500); }

  async function refreshModele() {
    if (modeleId == null) return;
    const m = await window.api.modelesMesures.getById(modeleId);
    setModele(m);
    refreshList();
  }

  async function handleCreerModele() {
    if (!nouveauNom.trim()) { notifyErr("Le nom du modèle est obligatoire."); return; }
    try {
      const m = await window.api.modelesMesures.create(produitId, nouveauNom.trim());
      setNouveauNom("");
      await refreshList();
      setModeleId(m.id);
    } catch (err: any) {
      notifyErr(err?.message || "Erreur.");
    }
  }

  async function handleDupliquer(source: ModeleMesures) {
    try {
      const copie = await window.api.modelesMesures.dupliquer(source.id, `${source.nom} (copie)`);
      await refreshList();
      setModeleId(copie.id);
    } catch (err: any) {
      notifyErr(err?.message || "Erreur.");
    }
  }

  async function handleRenommer(nom: string) {
    if (modeleId == null || !nom.trim()) return;
    await window.api.modelesMesures.updateNom(modeleId, nom.trim());
    refreshModele();
  }

  async function handleToggleActif() {
    if (modele == null) return;
    await window.api.modelesMesures.setActif(modele.id, !modele.actif);
    refreshModele();
  }

  async function handleChargerStandard(cle: string) {
    if (modeleId == null) return;
    try {
      await window.api.modelesMesures.chargerModeleStandard(modeleId, cle);
      setCleBaseChargee(cle);
      refreshModele();
    } catch (err: any) {
      notifyErr(err?.message || "Erreur.");
    }
  }

  // Les compléments s'ajoutent PAR-DESSUS le tableau : addLigne ignore une mesure déjà présente,
  // donc recharger deux fois ne duplique rien et n'écrase aucune ligne modifiée à la main.
  async function handleChargerComplement(cle: string) {
    if (modeleId == null) return;
    try {
      await window.api.modelesMesures.chargerComplementStandard(modeleId, cle);
      refreshModele();
    } catch (err: any) {
      notifyErr(err?.message || "Erreur.");
    }
  }

  async function handleAddLigne(nom: string) {
    if (modeleId == null || !nom.trim()) return;
    try {
      await window.api.modelesMesures.addLigne(modeleId, nom.trim());
      setMesureQuery("");
      refreshModele();
    } catch (err: any) {
      notifyErr(err?.message || "Erreur.");
    }
  }

  async function handleUpdateLigne(ligneId: number, champ: string, valeur: string) {
    if (modeleId == null) return;
    await window.api.modelesMesures.updateLigne(modeleId, ligneId, { [champ]: valeur });
    refreshModele();
  }

  async function handleRemoveLigne(ligneId: number) {
    if (modeleId == null) return;
    await window.api.modelesMesures.removeLigne(modeleId, ligneId);
    refreshModele();
  }

  async function handleReorder(index: number, direction: -1 | 1) {
    if (modeleId == null || !modele) return;
    const ids = modele.lignes.map((l) => l.id);
    const target = index + direction;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    await window.api.modelesMesures.reorderLignes(modeleId, ids);
    refreshModele();
  }

  async function handleSupprimerModele() {
    if (modeleId == null) return;
    await window.api.modelesMesures.deleteModele(modeleId);
    setModeleId(null);
    refreshList();
  }

  return (
    <div className="modal-veil" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 760 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3 style={{ fontFamily: "inherit" }}>Modèles de tableaux de mesures — {produitNom}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Fermer">✕</button>
        </div>
        <p style={{ fontSize: 12.5, color: "var(--v2-text-3)", marginTop: 0 }}>
          Un ou plusieurs modèles pour ce type de produit (ex. Pantalon classique / Pantalon jogging). Un modèle ne
          fournit que les lignes de mesures par défaut — les tailles sont toujours configurées directement dans
          chaque fiche technique. S'il n'existe qu'un seul modèle actif, il s'applique automatiquement à l'ouverture
          d'une fiche ; s'il en existe plusieurs, le bureau d'études choisit lequel utiliser.
        </p>

        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
          {modeles.map((m) => (
            <div key={m.id} style={{ display: "flex", alignItems: "center", gap: 2 }}>
              <button
                className={`btn ghost tiny ${modeleId === m.id ? "ft-vue-active" : ""}`}
                style={{ opacity: m.actif ? 1 : 0.5 }}
                onClick={() => setModeleId(m.id)}
              >
                {m.nom}{!m.actif && " (inactif)"}
              </button>
              <button className="btn ghost tiny" title="Dupliquer ce modèle" onClick={() => handleDupliquer(m)}>⧉</button>
            </div>
          ))}
          {modeles.length === 0 && <p style={{ fontSize: 12.5, color: "var(--v2-text-3)" }}>Aucun modèle pour ce type de produit pour l'instant.</p>}
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 16, paddingBottom: 14, borderBottom: "1px solid #EEF0EA" }}>
          <input
            type="text" value={nouveauNom} onChange={(e) => setNouveauNom(e.target.value)}
            placeholder="Nom du nouveau modèle (ex : Pantalon jogging)"
            style={{ flex: 1, border: "1px solid #D8D9D0", borderRadius: 6, padding: "6px 9px", fontSize: 13 }}
            onKeyDown={(e) => { if (e.key === "Enter") handleCreerModele(); }}
          />
          <button className="btn ghost" onClick={handleCreerModele}>+ Nouveau modèle</button>
        </div>

        {modele && (
          <>
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
              <input defaultValue={modele.nom} onBlur={(e) => handleRenommer(e.target.value)} style={{ fontWeight: 600, fontSize: 14, border: "1px solid #D8D9D0", borderRadius: 6, padding: "5px 8px" }} />
              <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12.5 }}>
                <input type="checkbox" checked={!!modele.actif} onChange={handleToggleActif} /> Actif
              </label>
              <button className="btn ghost tiny" onClick={() => handleDupliquer(modele)}>Dupliquer</button>
              <button className="btn ghost tiny" onClick={handleSupprimerModele}>Supprimer ce modèle</button>
            </div>

            {modele.lignes.length === 0 && standards.length > 0 && (
              <div style={{ background: "#ECFDF5", border: "1px solid #BEEFDA", borderRadius: 8, padding: "10px 12px", marginBottom: 14 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: "#047857", marginBottom: 8 }}>Charger un jeu de mesures standard</div>
                {/* Regroupés par famille : 14 jeux à plat seraient illisibles. */}
                {Array.from(new Set(standards.map((s) => s.famille || "Autres"))).map((fam) => (
                  <div key={fam} style={{ marginBottom: 8 }}>
                    <div style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".04em", color: "#55564E", fontWeight: 600, marginBottom: 4 }}>{fam}</div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {standards.filter((s) => (s.famille || "Autres") === fam).map((s) => (
                        <button key={s.cle} className="btn ghost tiny" onClick={() => handleChargerStandard(s.cle)}>{s.label} ({s.nb_mesures})</button>
                      ))}
                    </div>
                  </div>
                ))}
                <p style={{ fontSize: 11, color: "#6B6B62", margin: "6px 0 0" }}>Point de départ modifiable — chaque ligne reste ajoutable, supprimable et modifiable ensuite.</p>
              </div>
            )}

            {/* Compléments : particularités techniques (capuche, bord-côte, ceinture élastiquée),
                jamais des catégories distinctes. Proposés dès qu'un tableau existe, filtrés sur le
                jeu de base chargé pendant cette session lorsqu'il est connu. */}
            {modele.lignes.length > 0 && complements.length > 0 && (
              <div style={{ border: "1px solid #E7E9E0", borderRadius: 8, padding: "10px 12px", marginBottom: 14 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: "#55564E", marginBottom: 6 }}>Ajouter une particularité technique</div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {complements.map((c) => (
                    <button key={c.cle} className="btn ghost tiny" onClick={() => handleChargerComplement(c.cle)}>+ {c.label} ({c.nb_mesures})</button>
                  ))}
                </div>
                <p style={{ fontSize: 11, color: "#6B6B62", margin: "6px 0 0" }}>
                  Les lignes s'ajoutent au tableau existant, sans rien remplacer. Une ligne déjà présente est ignorée.
                </p>
              </div>
            )}

            <div style={{ position: "relative", marginBottom: 12 }}>
              <input
                type="text" value={mesureQuery} onChange={(e) => setMesureQuery(e.target.value)}
                placeholder="Ajouter une mesure par défaut (ex : Longueur devant...)"
                style={{ width: "100%", border: "1px solid #D8D9D0", borderRadius: 6, padding: "7px 9px", fontSize: 13 }}
                onKeyDown={(e) => { if (e.key === "Enter" && mesureQuery.trim()) handleAddLigne(mesureQuery.trim()); }}
              />
              {mesureQuery.trim() && (
                <div style={{ border: "1px solid #E7E9E0", borderRadius: 8, marginTop: 4, background: "#fff", boxShadow: "0 2px 8px rgba(0,0,0,.08)", position: "absolute", width: "100%", zIndex: 5 }}>
                  {mesureResults.filter((m) => !modele.lignes.some((l) => l.mesure_catalogue_id === m.id)).map((m) => (
                    <div key={m.id} onClick={() => handleAddLigne(m.nom)} style={{ padding: "7px 10px", fontSize: 13, cursor: "pointer", borderBottom: "1px solid #F0F1EC" }}>{m.nom}</div>
                  ))}
                  <div onClick={() => handleAddLigne(mesureQuery.trim())} style={{ padding: "7px 10px", fontSize: 12.5, cursor: "pointer", color: "#0E9F6E" }}>+ Créer « {mesureQuery.trim()} »</div>
                </div>
              )}
            </div>

            {modele.lignes.length > 0 && (
              <div className="grid-table-wrap">
                <table className="grid-table">
                  <thead><tr><th style={{ textAlign: "left" }}>Repère</th><th style={{ textAlign: "left" }}>Mesure</th><th>Unité</th><th>Tolérance</th><th></th></tr></thead>
                  <tbody>
                    {modele.lignes.map((l, i) => (
                      <tr key={l.id}>
                        <td><input defaultValue={l.repere ?? ""} placeholder="A" onBlur={(e) => handleUpdateLigne(l.id, "repere", e.target.value)} style={{ width: 34, border: "1px solid #D8D9D0", borderRadius: 4, padding: "3px 4px", fontSize: 12, textAlign: "center" }} /></td>
                        <td className="grid-row-label">
                          <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <span style={{ display: "inline-flex", flexDirection: "column" }}>
                              <button className="btn ghost tiny" style={{ padding: "0 3px", lineHeight: 1 }} disabled={i === 0} onClick={() => handleReorder(i, -1)}>▲</button>
                              <button className="btn ghost tiny" style={{ padding: "0 3px", lineHeight: 1 }} disabled={i === modele.lignes.length - 1} onClick={() => handleReorder(i, 1)}>▼</button>
                            </span>
                            {l.nom}
                          </span>
                        </td>
                        <td><input defaultValue={l.unite ?? ""} placeholder="cm" onBlur={(e) => handleUpdateLigne(l.id, "unite", e.target.value)} style={{ width: 44, border: "1px solid #D8D9D0", borderRadius: 4, padding: "3px 4px", fontSize: 12, textAlign: "center" }} /></td>
                        <td style={{ whiteSpace: "nowrap" }}>
                          <span style={{ display: "flex", gap: 3, alignItems: "center", justifyContent: "center" }}>
                            +<input defaultValue={l.tolerance_plus ?? ""} onBlur={(e) => handleUpdateLigne(l.id, "tolerance_plus", e.target.value)} style={{ width: 34, border: "1px solid #D8D9D0", borderRadius: 4, padding: "3px 4px", fontSize: 12, textAlign: "center" }} />
                            -<input defaultValue={l.tolerance_moins ?? ""} onBlur={(e) => handleUpdateLigne(l.id, "tolerance_moins", e.target.value)} style={{ width: 34, border: "1px solid #D8D9D0", borderRadius: 4, padding: "3px 4px", fontSize: 12, textAlign: "center" }} />
                          </span>
                        </td>
                        <td><button className="btn ghost tiny" onClick={() => handleRemoveLigne(l.id)}>✕</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        {error && <p style={{ color: "var(--v2-danger)", fontSize: 12.5, marginTop: 8 }}>{error}</p>}
      </div>
    </div>
  );
}
