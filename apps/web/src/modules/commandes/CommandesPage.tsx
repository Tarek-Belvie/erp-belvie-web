import { Fragment, useEffect, useMemo, useState } from "react";
import { Commande, Etape, ListeValeur, PRIORITE_LABELS, STATUT_BADGE_CLASS, STATUT_LABELS, TYPE_PRODUCTION_LABELS } from "../../shared/types";
import { mediaUrl } from "./uiHelpers";
import CommandeDetailModal from "./CommandeDetailModal";
import CommandeWizard from "../wizard/CommandeWizard";

interface Props {
  operateurActif: ListeValeur | null;
  /** Ouvre le module Approvisionnement sur la préparation d'un bon MP pour ces productions. */
  onPreparerBcMp: (commandeIds: number[]) => void;
}

type ViewKey = "toutes" | "brouillons" | "encours" | "bloquees" | "archivees";

const EN_COURS_STATUTS = new Set(["validee", "en_production", "controle_qualite"]);

export default function CommandesPage({ operateurActif, onPreparerBcMp }: Props) {
  const [orders, setOrders] = useState<Commande[]>([]);
  const [etapes, setEtapes] = useState<Etape[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [view, setView] = useState<ViewKey>("toutes");
  const [showWizard, setShowWizard] = useState(false);
  const [editingCommande, setEditingCommande] = useState<Commande | null>(null);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  async function refresh() {
    const [o, e] = await Promise.all([window.api.commandes.list(), window.api.etapes.list()]);
    setOrders(o);
    setEtapes(e);
    setLoading(false);
  }
  useEffect(() => { refresh(); }, []);

  function notify(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  }

  async function handleWizardSaved(created: Commande) {
    setShowWizard(false);
    setEditingCommande(null);
    notify(`Brouillon enregistré (${created.reference_production ?? "sans référence"}).`);
    await refresh();
  }

  async function handleWizardValidated(commande: Commande) {
    setShowWizard(false);
    setEditingCommande(null);
    notify(`Commande validée — numéro ${commande.numero} attribué.`);
    await refresh();
  }

  function handleWizardClose() {
    setShowWizard(false);
    setEditingCommande(null);
    refresh();
  }

  const activeOrders = useMemo(() => orders.filter((o) => !o.archived), [orders]);

  const counts = {
    toutes: activeOrders.length,
    brouillons: activeOrders.filter((o) => o.statut === "brouillon").length,
    encours: activeOrders.filter((o) => EN_COURS_STATUTS.has(o.statut)).length,
    bloquees: activeOrders.filter((o) => o.bloquee).length,
    archivees: orders.filter((o) => o.archived).length,
  };

  const views: { key: ViewKey; label: string; count: number; colorClass?: string }[] = [
    { key: "toutes", label: "Toutes", count: counts.toutes },
    { key: "brouillons", label: "Brouillons", count: counts.brouillons, colorClass: "v2-count-brouillon" },
    { key: "encours", label: "En cours", count: counts.encours, colorClass: "v2-count-en-production" },
    { key: "bloquees", label: "Bloquées", count: counts.bloquees, colorClass: "v2-count-bloquee" },
    { key: "archivees", label: "Archivées", count: counts.archivees, colorClass: "v2-count-archivee" },
  ];

  const filtered = useMemo(() => {
    let list = view === "archivees" ? orders.filter((o) => o.archived) : [...activeOrders];
    if (view === "brouillons") list = list.filter((o) => o.statut === "brouillon");
    if (view === "encours") list = list.filter((o) => EN_COURS_STATUTS.has(o.statut));
    if (view === "bloquees") list = list.filter((o) => o.bloquee);

    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter((o) =>
        (o.numero ?? "").toLowerCase().includes(q) ||
        (o.reference_production ?? "").toLowerCase().includes(q) ||
        o.produit.toLowerCase().includes(q) ||
        o.responsable.toLowerCase().includes(q) ||
        o.atelier.toLowerCase().includes(q)
      );
    }

    // Tri par date de création, la plus récente en premier — jamais par dernière modification,
    // pour qu'une commande ancienne simplement consultée/modifiée ne remonte pas artificiellement.
    return list.sort((a, b) => b.created_at.localeCompare(a.created_at));
  }, [orders, activeOrders, view, query]);

  // Formate la dernière activité : "Aujourd'hui 09:42" si c'est le jour même, sinon date complète.
  function fmtDerniereActivite(sqliteDateTime: string): string {
    const [datePart, timePart] = sqliteDateTime.split(" ");
    const todayISO = new Date().toISOString().slice(0, 10);
    if (datePart === todayISO) return `Aujourd'hui ${(timePart ?? "").slice(0, 5)}`;
    const [y, m, d] = datePart.split("-");
    return `${d}/${m}/${y}`;
  }

  if (loading) return <div className="empty-state">Chargement des commandes...</div>;

  if (showWizard) {
    return (
      <CommandeWizard
        etapes={etapes}
        existing={editingCommande}
        onClose={handleWizardClose}
        onSaved={handleWizardSaved}
        onValidated={handleWizardValidated}
        onDraftChanged={refresh}
      />
    );
  }

  return (
    <div>
      <div className="topline">
        <div>
          <div className="page-title">Commandes de production</div>
          <div className="page-sub">{counts.toutes} commande{counts.toutes > 1 ? "s" : ""} active{counts.toutes > 1 ? "s" : ""}</div>
        </div>
        <button className="btn primary" onClick={() => setShowWizard(true)}>+ Nouvelle commande</button>
      </div>

      <div className="tabs">
        {views.map((v) => (
          <button key={v.key} className={`tab ${view === v.key ? "active" : ""}`} onClick={() => setView(v.key)}>
            {v.label} <span className={`tab-count ${v.colorClass ?? ""}`}>{v.count}</span>
          </button>
        ))}
      </div>

      <div className="toolbar">
        <div className="search">
          🔍<input placeholder="Rechercher par numéro, référence, produit, responsable, atelier..." value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
      </div>

      <table>
        <thead>
          <tr>
            <th style={{ width: 32 }}>#</th>
            <th>Bon de commande</th>
            <th style={{ width: 56 }}>Photo</th>
            <th>Produit</th>
            <th>Responsable</th>
            <th>Statut</th>
            <th>Échéance</th>
            <th style={{ width: 28 }}></th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((o, index) => {
            const isOpen = expandedId === o.id;
            return (
              <Fragment key={o.id}>
                <tr
                  className="row"
                  onClick={() => setExpandedId(isOpen ? null : o.id)}
                  style={{ cursor: "pointer" }}
                >
                  <td style={{ color: "#8A8A82" }}>{index + 1}</td>
                  <td className="num">
                    {o.numero ?? <span className="v2-badge v2-badge-brouillon">Brouillon</span>}
                  </td>
                  <td>
                    {o.photo_thumb_path ? (
                      <div className="thumb-cell"><img src={mediaUrl(o.photo_thumb_path)!} alt={o.produit} /></div>
                    ) : (
                      <div className="thumb-cell empty"><span>—</span></div>
                    )}
                  </td>
                  <td>{o.produit}</td>
                  <td>{o.responsable}</td>
                  <td>
                    <span className={`v2-badge ${STATUT_BADGE_CLASS[o.statut]}`}>{STATUT_LABELS[o.statut]}</span>
                    {o.bloquee ? <span className="v2-badge v2-badge-bloquee" title={o.blocage_motif ?? ""} style={{ marginLeft: 6 }}>Bloquée</span> : null}
                  </td>
                  <td>{o.date_fin_prevue}</td>
                  <td style={{ color: "#8A8A82" }}>{isOpen ? "▲" : "▼"}</td>
                </tr>
                {isOpen && (
                  <tr>
                    <td></td>
                    <td colSpan={7} style={{ padding: "0 6px 16px 6px" }}>
                      <div className="row-expanded">
                        <div><span className="row-expanded-icon">🏭</span> <span className="row-expanded-label">Atelier</span> : {o.atelier}</div>
                        <div><span className="row-expanded-icon">🔄</span> <span className="row-expanded-label">Dernière activité</span> : {fmtDerniereActivite(o.updated_at)}</div>
                        <div><span className="row-expanded-icon">📦</span> <span className="row-expanded-label">Type</span> : {TYPE_PRODUCTION_LABELS[o.type_production]}</div>
                        <div><span className="row-expanded-icon">⭐</span> <span className="row-expanded-label">Priorité</span> : {PRIORITE_LABELS[o.priorite]}</div>
                        <div><span className="row-expanded-icon">📅</span> <span className="row-expanded-label">Créée le</span> : {fmtDerniereActivite(o.created_at)}</div>
                        <div><span className="row-expanded-icon">📝</span> <span className="row-expanded-label">Notes</span> : {o.commentaires || "—"}</div>
                      </div>
                      <button
                        className="btn ghost"
                        style={{ marginTop: 10 }}
                        onClick={(e) => { e.stopPropagation(); setDetailId(o.id); }}
                      >
                        Voir la commande complète
                      </button>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
          {filtered.length === 0 && (
            <tr><td colSpan={8} className="empty-state">Aucune commande ne correspond à cette vue.</td></tr>
          )}
        </tbody>
      </table>

      {detailId != null && (
        <CommandeDetailModal
          onPreparerBcMp={onPreparerBcMp}
          commandeId={detailId}
          operateurActif={operateurActif}
          etapes={etapes}
          onClose={() => setDetailId(null)}
          onChanged={refresh}
          onEditBrouillon={(commande) => {
            setDetailId(null);
            setEditingCommande(commande);
            setShowWizard(true);
          }}
        />
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
