import { useEffect, useRef, useState } from "react";
import { Article, FicheTechnique, MesureCatalogue, MesuresStatut } from "../../shared/types";
import MesureCell from "./MesureCell";
import FTTaillesSelector from "./FTTaillesSelector";
import FTGradationRow, { formaterGradation } from "./FTGradationRow";
import FTCreerTableau from "./FTCreerTableau";

interface Props {
  fiche: FicheTechnique;
  article: Article;
  lectureSeule: boolean;
  onChanged: () => void;
}

export default function FTMesuresTab({ fiche, article, lectureSeule, onChanged }: Props) {
  const [statut, setStatut] = useState<MesuresStatut | null>(null);
  const [mesureQuery, setMesureQuery] = useState("");
  const [mesureResults, setMesureResults] = useState<MesureCatalogue[]>([]);
  const [error, setError] = useState<string | null>(null);
  // Indicateur GLOBAL du tableau : agrège l'état des cellules pour que l'utilisateur sache d'un
  // coup d'œil si tout est enregistré, sans avoir à inspecter chaque case.
  const [sauvegarde, setSauvegarde] = useState<{ enCours: number; erreurs: number; dernierOk: boolean }>({ enCours: 0, erreurs: 0, dernierOk: false });
  const [confirmChangerMethode, setConfirmChangerMethode] = useState(false);
  // Modèles applicables, chargés en permanence : le choix se fait DANS la page, plus dans la
  // popup d'administration. « Gérer les modèles » reste accessible mais devient secondaire.
  // Lignes dont la zone de gradation est dépliée, et résumés affichés quand elle est fermée.
  const [gradationOuverte, setGradationOuverte] = useState<Set<number>>(new Set());
  // Ligne dont le nom est en cours de renommage. Un contentEditable visuellement identique à du
  // texte statique n'indiquait rien : un crayon discret rend la fonction découvrable.
  const [renommageId, setRenommageId] = useState<number | null>(null);
  // Repli VISUEL uniquement : les <tr> masquees ne sont pas demontees, donc aucune valeur saisie
  // ni etat de sauvegarde n'est perdu. « Mesures de detail » est replie par defaut.
  const [detailReplie, setDetailReplie] = useState(true);
  const [nouveauGroupe, setNouveauGroupe] = useState<"principale" | "detail">("principale");
  const [enrichirModele, setEnrichirModele] = useState(true);
  const [resumesGradation, setResumesGradation] = useState<Record<number, string>>({});

  // Résumés rechargés avec la grille : une gradation configurée doit rester visible même zone
  // fermée, sans quoi rien n'indiquerait qu'elle existe.
  useEffect(() => {
    if (!statut) return;
    let annule = false;
    Promise.all(statut.grille.lignes.map((l: any) =>
      window.api.ficheTechnique.intervallesGradation(fiche.id, l.id)
        .then((iv: any[]) => [l.id, iv.filter((x) => x.valeur != null).length > 0
          ? iv.map((x) => (x.valeur != null ? formaterGradation(x.valeur) : "—")).join(" / ") : ""] as [number, string])
        .catch(() => [l.id, ""] as [number, string])
    )).then((paires) => { if (!annule) setResumesGradation(Object.fromEntries(paires)); });
    return () => { annule = true; };
  }, [fiche.id, statut?.grille.lignes.length, statut?.grille.tailles.length]);

  // Le repère est FACULTATIF, mais unique dans la fiche. En cas de refus, le champ est remis à sa
  // valeur précédente : sans cela, l'utilisateur verrait à l'écran un repère qui n'est pas en base.
  async function handleRepere(ligne: any, input: HTMLInputElement) {
    const saisi = input.value;
    if ((saisi || "").trim().toUpperCase() === (ligne.repere || "").trim().toUpperCase()) return;
    try {
      await window.api.ficheTechnique.updateMesureLigne(fiche.id, ligne.id, { repere: saisi });
      refresh();
    } catch (err: any) {
      input.value = ligne.repere ?? "";
      notifyErr(err?.message || "Repère refusé.");
    }
  }

  // Renommage LOCAL : n'écrit que ft_mesures_lignes.nom_local, jamais mesures_catalogue. Les
  // autres fiches utilisant cette mesure ne sont pas affectées. Vider le champ revient au nom
  // du catalogue.
  async function handleRenommerMesure(ligne: any, texte: string) {
    const nouveau = (texte || "").trim();
    if (nouveau === (ligne.nom || "")) return;
    try {
      // Saisir exactement le nom du catalogue équivaut à ne pas avoir de nom local.
      const local = nouveau === "" || nouveau === ligne.nom_catalogue ? "" : nouveau;
      await window.api.ficheTechnique.updateMesureLigne(fiche.id, ligne.id, { nom_local: local });
      refresh();
    } catch (err: any) {
      notifyErr(err?.message || "Renommage impossible.");
      refresh();
    }
  }

  function basculerGradation(mesureId: number) {
    setGradationOuverte((prev) => {
      const n = new Set(prev);
      if (n.has(mesureId)) n.delete(mesureId); else n.add(mesureId);
      return n;
    });
  }


  // --- Protection contre la perte de saisie à la fermeture de la fenêtre -------------------------
  // Ensemble des cellules ayant encore quelque chose à enregistrer. Un Set plutôt qu'un compteur :
  // une cellule qui signale deux fois le même état ne fausse pas le total, et un démontage la
  // retire proprement.
  const cellulesEnAttente = useRef<Set<string>>(new Set());
  const [nbEnAttente, setNbEnAttente] = useState(0);

  function signalerEnAttente(cle: string, enAttente: boolean) {
    const s = cellulesEnAttente.current;
    if (enAttente) s.add(cle); else s.delete(cle);
    setNbEnAttente(s.size);
  }

  // Poussé en continu vers le processus principal, qui s'en sert au moment de fermer la fenêtre.
  useEffect(() => {
    window.api.app?.setModificationsEnAttente(nbEnAttente);
  }, [nbEnAttente]);

  // À la disparition de l'onglet, plus rien n'est en attente ici : sans cette remise à zéro, un
  // compteur fantôme bloquerait la fermeture pour des cellules qui n'existent plus.
  useEffect(() => () => { window.api.app?.setModificationsEnAttente(0); }, []);

  // Demande d'enregistrement émise juste avant la fermeture. On se contente de retirer le focus de
  // la cellule active : cela déclenche son onBlur, donc le chemin de sauvegarde NORMAL. Aucun code
  // d'écriture parallèle, donc aucun risque de divergence.
  useEffect(() => {
    if (!window.api.app?.onEnregistrerAvantFermeture) return;
    const off = window.api.app.onEnregistrerAvantFermeture(() => {
      const actif = document.activeElement as HTMLElement | null;
      if (actif && typeof actif.blur === "function") actif.blur();
      // Laisser le temps à l'écriture déclenchée par le blur d'aboutir avant de répondre.
      setTimeout(() => {
        window.api.app.pretAFermer(cellulesEnAttente.current.size);
      }, 400);
    });
    return off;
  }, []);

  async function refresh() {
    const s = await window.api.ficheTechnique.getMesuresStatut(fiche.id);
    setStatut(s);
    onChanged();
  }

  // Reprise de session : si les tailles étaient déjà confirmées mais qu'aucun modèle n'existait
  // encore à l'époque, retente l'application automatique (utile si un modèle a été créé depuis).
  // Ne fait jamais rien tant que les tailles ne sont pas confirmées.
  useEffect(() => {
    window.api.ficheTechnique.ensureMesuresGenerees(fiche.id).then((s) => { setStatut(s); onChanged(); });
  }, [fiche.id]);

  useEffect(() => {
    window.api.ficheTechnique.searchMesuresCatalogue(mesureQuery).then(setMesureResults);
  }, [mesureQuery]);

  function notifyErr(msg: string) { setError(msg); setTimeout(() => setError(null), 3500); }

  async function handleAddMesure(nom: string) {
    try {
      // groupe et enrichirModele viennent des controles affiches sous le champ d'ajout.
      // enrichirModele coche = la mesure rejoint aussi le modele du TYPE, donc les prochaines
      // fiches de ce type. Decoche = strictement locale a cette fiche.
      await window.api.ficheTechnique.addMesureLigne(fiche.id, nom, {
        groupe: nouveauGroupe,
        enrichirModele: enrichirModele,
      });
      setMesureQuery("");
      refresh();
    } catch (err: any) {
      notifyErr(err?.message || "Erreur.");
    }
  }

  async function handleRemoveMesure(mesureId: number) {
    await window.api.ficheTechnique.removeMesureLigne(fiche.id, mesureId);
    refresh();
  }

  async function handleReorderMesure(index: number, direction: -1 | 1, lignes: MesuresStatut["grille"]["lignes"]) {
    const ids = lignes.map((l) => l.id);
    const target = index + direction;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    await window.api.ficheTechnique.reorderMesuresLignes(fiche.id, ids);
    refresh();
  }

  async function handleUpdateLigneChamp(mesureId: number, champ: string, valeur: string) {
    await window.api.ficheTechnique.updateMesureLigne(fiche.id, mesureId, { [champ]: valeur });
    refresh();
  }

  // Écriture d'UNE cellule. Ne recharge plus toute la fiche : à 12 lignes x 7 tailles, l'ancienne
  // version déclenchait jusqu'à 84 rechargements complets, ce qui rendait la saisie poussive et
  // multipliait les occasions de perdre une frappe. Seule la grille locale est mise à jour.
  // Cette fonction LÈVE en cas d'échec : c'est ce qui permet à la cellule d'afficher une erreur
  // plutôt qu'un faux succès.
  async function handleSetValeur(mesureId: number, ftTailleId: number, valeur: string) {
    setSauvegarde((s) => ({ ...s, enCours: s.enCours + 1 }));
    try {
      await window.api.ficheTechnique.setValeur(fiche.id, mesureId, ftTailleId, valeur || null);
      setStatut((prev) => {
        if (!prev) return prev;
        const autres = prev.grille.valeurs.filter((v) => !(v.mesure_catalogue_id === mesureId && v.ft_taille_id === ftTailleId));
        const maj = valeur ? autres.concat([{ mesure_catalogue_id: mesureId, ft_taille_id: ftTailleId, valeur: valeur } as any]) : autres;
        return { ...prev, grille: { ...prev.grille, valeurs: maj } };
      });
      setSauvegarde((s) => ({ enCours: s.enCours - 1, erreurs: s.erreurs, dernierOk: true }));
    } catch (err: any) {
      setSauvegarde((s) => ({ enCours: s.enCours - 1, erreurs: s.erreurs + 1, dernierOk: false }));
      notifyErr(err?.message || "Enregistrement impossible.");
      throw err; // propagé : la cellule doit savoir que l'écriture a échoué
    }
  }

  // Navigation clavier dans le tableau : les cellules portent data-cellule="ligne-colonne".
  function naviguer(ligne: number, colonne: number, direction: "haut" | "bas" | "gauche" | "droite") {
    const d = { haut: [-1, 0], bas: [1, 0], gauche: [0, -1], droite: [0, 1] }[direction];
    const cible = document.querySelector<HTMLInputElement>(`[data-cellule="${ligne + d[0]}-${colonne + d[1]}"]`);
    if (cible) { cible.focus(); cible.select(); }
  }

  // Retour au choix d'une méthode. Ne supprime RIEN par elle-même : elle rouvre simplement le
  // choix. L'écrasement éventuel n'a lieu qu'à l'application d'un modèle, après confirmation.
  async function handleChangerMethode() {
    const nbValeurs = statut ? statut.grille.valeurs.filter((v) => v.valeur).length : 0;
    if (nbValeurs > 0) { setConfirmChangerMethode(true); return; }
    await appliquerRetourChoix();
  }

  async function appliquerRetourChoix() {
    try {
      await window.api.ficheTechnique.reinitialiserChoixMesures(fiche.id);
      setConfirmChangerMethode(false);
      refresh();
    } catch (err: any) {
      notifyErr(err?.message || "Erreur.");
    }
  }

  async function handleAppliquerModele(modeleId: number) {
    try {
      await window.api.ficheTechnique.appliquerModele(fiche.id, modeleId);
      refresh();
    } catch (err: any) {
      notifyErr(err?.message || "Erreur.");
    }
  }

  async function handleConstruireManuellement() {
    try {
      await window.api.ficheTechnique.construireManuellement(fiche.id);
      refresh();
    } catch (err: any) {
      notifyErr(err?.message || "Erreur.");
    }
  }

  if (!statut) {
    return <p style={{ fontSize: 13, color: "var(--v2-text-3)" }}>Chargement...</p>;
  }

  const grille = statut.grille;

  // PLUS AUCUNE ÉTAPE. L'ancienne version enchaînait : saisir les tailles -> « Confirmer les
  // tailles » -> choisir une méthode -> tableau. Le drapeau tailles_confirmees servait de verrou
  // d'affichage, et c'est ce qui produisait le symptôme « Aucune mesure pour l'instant » à la
  // réouverture : tant qu'il valait 0, l'écran repartait à l'étape 1 même si des lignes et des
  // valeurs existaient bel et bien en base.
  // La colonne est conservée pour compatibilité, mais elle ne conditionne plus rien ici.

  return (
    <div>
      {/* Placeholder du repère fortement atténué : en gris plein, le « A » pouvait être pris pour
          une valeur déjà enregistrée. Portée limitée à cet onglet — global.css n'est pas modifié,
          donc aucun risque pour le reste de l'ERP. */}
      <style>{`
        .ft-repere-input::placeholder { color: #C9CAC0; opacity: .45; }
        .ft-repere-input:focus::placeholder { opacity: .2; }
      `}</style>

      {/* 1. Grille + pastilles de tailles — directement dans la page, sans étape de confirmation. */}
      <FTTaillesSelector
        ficheId={fiche.id}
        lectureSeule={lectureSeule}
        onChanged={() => { refresh(); }}
        onError={notifyErr}
      />

      {/* Section « MODÈLE DE MESURES » RETIREE de l'interface quotidienne : sélecteur, « Modèle
          utilisé » et « Gérer les modèles ». Le système de modèles reste ENTIEREMENT en place en
          base et côté API — appliquerModele, les 14 jeux standards et les associations existantes
          sont intacts. Il sera piloté automatiquement par le Type d'article (D2). L'onglet
          commence donc directement par Grille de tailles -> Tailles -> Tableau. */}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
        <div style={{ fontSize: 12.5, color: "var(--v2-text-3)" }}>
          {/* « Modèle utilisé » retiré : information d'administration, sans utilité quotidienne. */}
          {/* Le choix modèle / manuel n'est JAMAIS irréversible : on peut toujours rouvrir le
              choix, et rien n'est supprimé par ce retour. */}
          {/* « Changer de méthode » retiré du parcours normal : le tableau étant entièrement
              modifiable ligne par ligne (renommer, repère, ajouter, supprimer), repartir d'un
              modèle est devenu un cas exceptionnel. L'action reste accessible sous « Gérer les
              modèles », et prévient toujours avant d'écraser des valeurs existantes. */}
          {/* Indicateur global : agrège l'état de toutes les cellules. Une erreur reste affichée
              tant qu'elle n'est pas résolue — jamais de faux « enregistré ». */}
          <span style={{ marginLeft: 10, fontSize: 12 }}>
            {sauvegarde.erreurs > 0 ? (
              <span style={{ color: "#C2410C", fontWeight: 600 }}>
                ⚠ {sauvegarde.erreurs} enregistrement{sauvegarde.erreurs > 1 ? "s" : ""} en échec
              </span>
            ) : sauvegarde.enCours > 0 ? (
              <span style={{ color: "#9A9A90" }}>Enregistrement…</span>
            ) : sauvegarde.dernierOk ? (
              <span style={{ color: "#0E9F6E" }}>✓ Modifications enregistrées</span>
            ) : null}
          </span>
        </div>
        {grille.lignes.length === 0 ? (
          /* Fiche sans aucune ligne : on propose de creer le tableau a partir des mesures
             suggerees par le TYPE d'article. Ce bloc disparait des qu'une ligne existe — un
             tableau en place n'est jamais regenere. */
          lectureSeule ? (
            <p style={{ fontSize: 13, color: "var(--v2-text-3)" }}>Aucune mesure sur cette fiche.</p>
          ) : (
            <FTCreerTableau ficheId={fiche.id} onCree={refresh} onError={notifyErr} />
          )
        ) : (
          <>
            {/* Alignement : le tableau etait pousse vers la droite par les regles de
                global.css attachees a .grid-table-wrap / .ft-mesures-table — vraisemblablement
                un centrage (margin auto ou justify-content) herite d'un autre ecran.
                Ces styles en ligne les neutralisent LOCALEMENT, sans modifier global.css donc
                sans risque pour le reste de l'ERP : le tableau part du bord gauche, comme les
                blocs Grille de tailles et Tailles de cette fiche juste au-dessus, et occupe la
                largeur disponible. overflowX garde le defilement quand les colonnes sont
                nombreuses. */}
            <div
              className="grid-table-wrap ft-mesures-table"
              style={{ display: "block", marginLeft: 0, marginRight: 0, paddingLeft: 0, justifyContent: "flex-start", width: "100%", maxWidth: "100%", overflowX: "auto" }}
            >
              <table className="grid-table" style={{ marginLeft: 0, marginRight: "auto", width: "auto", minWidth: "100%" }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left" }}>Repère</th>
                    <th style={{ textAlign: "left" }}>Mesure</th>
                    {/* Colonne « Unité » RETIRÉE de la saisie : les mesures d'un vêtement sont
                        exprimées dans la même unité, et ce champ étroit et non validé recevait en
                        pratique des VALEURS ("75cm", "58cm"). La colonne reste en base et reste
                        modifiable dans « Gérer les modèles » pour les cas particuliers. */}
                    <th>Tolérance</th>
                    {/* En-têtes épurés : l'ordre et le retrait des tailles se font par les
                        pastilles au-dessus, plus dans le tableau. */}
                    {grille.tailles.map((t) => <th key={t.id}>{t.nom}</th>)}
                    {!lectureSeule && <th></th>}
                  </tr>
                </thead>
                <tbody>
                  {grille.lignes.flatMap((l, i) => {
                    const groupe = (l as any).groupe || "principale";
                    const nbP = grille.lignes.filter((x: any) => (x.groupe || "principale") === "principale").length;
                    const nbD = grille.lignes.length - nbP;
                    const nbCol = 3 + grille.tailles.length + (lectureSeule ? 0 : 1);
                    // Separateur insere AVANT la premiere ligne de chaque groupe.
                    const premierP = groupe === "principale" && i === 0;
                    const premierD = groupe === "detail" && grille.lignes.findIndex((x: any) => (x.groupe || "principale") === "detail") === i;
                    const masquee = groupe === "detail" && detailReplie;
                    return [
                      premierP ? (
                        <tr key="sep-p">
                          <td colSpan={nbCol} style={{ background: "#F4F5F0", padding: "6px 10px", fontSize: 10.5, fontWeight: 700, letterSpacing: ".05em", color: "#55564E" }}>
                            MESURES PRINCIPALES ({nbP})
                          </td>
                        </tr>
                      ) : null,
                      premierD ? (
                        <tr key="sep-d">
                          <td colSpan={nbCol} style={{ background: "#F4F5F0", padding: 0 }}>
                            <button
                              onClick={() => setDetailReplie((v) => !v)}
                              style={{ width: "100%", textAlign: "left", padding: "6px 10px", background: "none", border: "none", cursor: "pointer", fontSize: 10.5, fontWeight: 700, letterSpacing: ".05em", color: "#55564E" }}
                            >
                              MESURES DE DÉTAIL ({nbD}) {detailReplie ? "▸" : "▾"}
                            </button>
                          </td>
                        </tr>
                      ) : null,
                      masquee ? null : (
                    <tr key={l.id}>
                      <td>
                        {lectureSeule ? l.repere || "—" : (
                          <input
                            defaultValue={l.repere ?? ""}
                            placeholder="A"
                            className="ft-repere-input"
                            onBlur={(e) => handleRepere(l, e.target)}
                            style={{ width: 34, border: "1px solid #C9CAC0", borderRadius: 4, padding: "3px 4px", fontSize: 12, textAlign: "center" }}
                          />
                        )}
                      </td>
                      <td className="grid-row-label">
                        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          {!lectureSeule && (
                            <span style={{ display: "inline-flex", flexDirection: "column", gap: 0 }}>
                              <button className="btn ghost tiny" style={{ padding: "0 3px", lineHeight: 1 }} disabled={i === 0} onClick={() => handleReorderMesure(i, -1, grille.lignes)}>▲</button>
                              <button className="btn ghost tiny" style={{ padding: "0 3px", lineHeight: 1 }} disabled={i === grille.lignes.length - 1} onClick={() => handleReorderMesure(i, 1, grille.lignes)}>▼</button>
                            </span>
                          )}
                          {renommageId === l.id ? (
                            <input
                              autoFocus
                              defaultValue={l.nom}
                              onBlur={(e) => { handleRenommerMesure(l, e.target.value); setRenommageId(null); }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                                if (e.key === "Escape") { setRenommageId(null); }
                              }}
                              style={{ width: "100%", border: "1px solid #17181A", borderRadius: 4, padding: "2px 5px", fontSize: 12.5 }}
                            />
                          ) : (
                            <span
                              onDoubleClick={() => !lectureSeule && setRenommageId(l.id)}
                              title={l.nom_local ? `Nom propre à cette fiche — catalogue : « ${l.nom_catalogue} »` : undefined}
                              style={{ borderBottom: l.nom_local ? "1px dotted #C9CAC0" : "none" }}
                            >
                              {l.nom}
                            </span>
                          )}
                          {!lectureSeule && renommageId !== l.id && (
                            <button
                              className="btn ghost tiny"
                              title="Renommer cette mesure sur cette fiche uniquement"
                              onClick={() => setRenommageId(l.id)}
                              style={{ padding: "0 3px", opacity: .55 }}
                            >
                              ✎
                            </button>
                          )}
                          {!lectureSeule && (
                            <button
                              className="btn ghost tiny"
                              title="Gradation entre tailles"
                              onClick={() => basculerGradation(l.id)}
                              style={{ padding: "0 4px", marginLeft: "auto", color: gradationOuverte.has(l.id) ? "#17181A" : "#6B6B62" }}
                            >
                              ↔
                            </button>
                          )}
                        </span>
                      </td>
                      <td style={{ whiteSpace: "nowrap" }}>
                        {lectureSeule ? (l.tolerance_plus || l.tolerance_moins ? `+${l.tolerance_plus || 0} / -${l.tolerance_moins || 0}` : "—") : (
                          <span style={{ display: "flex", gap: 3, alignItems: "center", justifyContent: "center" }}>
                            +<input defaultValue={l.tolerance_plus ?? ""} onBlur={(e) => handleUpdateLigneChamp(l.id, "tolerance_plus", e.target.value)} style={{ width: 34, border: "1px solid #D8D9D0", borderRadius: 4, padding: "3px 4px", fontSize: 12, textAlign: "center" }} />
                            -<input defaultValue={l.tolerance_moins ?? ""} onBlur={(e) => handleUpdateLigneChamp(l.id, "tolerance_moins", e.target.value)} style={{ width: 34, border: "1px solid #D8D9D0", borderRadius: 4, padding: "3px 4px", fontSize: 12, textAlign: "center" }} />
                          </span>
                        )}
                      </td>
                      {grille.tailles.map((t, ci) => {
                        const v = grille.valeurs.find((x) => x.mesure_catalogue_id === l.id && x.ft_taille_id === t.id)?.valeur ?? "";
                        return (
                          <td key={t.id}>
                            {lectureSeule ? (v || "—") : (
                              <MesureCell
                                valeur={v}
                                disabled={false}
                                ligne={i}
                                colonne={ci}
                                onSave={(val) => handleSetValeur(l.id, t.id, val)}
                                onNavigate={(dir) => naviguer(i, ci, dir)}
                                onEnAttenteChange={(a) => signalerEnAttente(`${l.id}-${t.id}`, a)}
                              />
                            )}
                          </td>
                        );
                      })}
                      {!lectureSeule && <td><button className="btn ghost tiny" onClick={() => handleRemoveMesure(l.id)}>✕</button></td>}
                    </tr>
                  ), masquee ? null : (gradationOuverte.has(l.id) && !lectureSeule ? (
                    // Zone dépliée DANS le tableau (une <tr> en colSpan), pas une popup :
                    // la gradation reste visuellement rattachée à sa ligne de mesure.
                    <FTGradationRow
                      key={`grad-${l.id}`}
                      ficheId={fiche.id}
                      mesureCatalogueId={l.id}
                      nbColonnes={3 + grille.tailles.length + (lectureSeule ? 0 : 1)}
                      onApplique={() => { refresh(); }}
                      onError={notifyErr}
                    />
                  ) : null)];
                  })}
                </tbody>
              </table>
            </div>
            {/* « + Ajouter une mesure » APRES la dernière ligne : on consulte et on remplit le
                tableau existant, et on n'ajoute une mesure que si elle manque. */}
            <div style={{ marginTop: 10 }}>
        {!lectureSeule && (
          <div style={{ position: "relative" }}>
            <input
              type="text" value={mesureQuery} onChange={(e) => setMesureQuery(e.target.value)}
              placeholder="+ Ajouter une mesure"
              style={{ border: "1px solid #D8D9D0", borderRadius: 6, padding: "6px 9px", fontSize: 12.5, width: 200 }}
              onKeyDown={(e) => { if (e.key === "Enter" && mesureQuery.trim()) handleAddMesure(mesureQuery.trim()); }}
            />
            {mesureQuery.trim() && (
              <div style={{ border: "1px solid #E7E9E0", borderRadius: 8, marginTop: 4, background: "#fff", boxShadow: "0 2px 8px rgba(0,0,0,.08)", position: "absolute", width: 220, zIndex: 5, right: 0 }}>
                {mesureResults.filter((m) => !grille.lignes.some((l) => l.id === m.id)).map((m) => (
                  <div key={m.id} onClick={() => handleAddMesure(m.nom)} style={{ padding: "7px 10px", fontSize: 13, cursor: "pointer", borderBottom: "1px solid #F0F1EC" }}>{m.nom}</div>
                ))}
                <div onClick={() => handleAddMesure(mesureQuery.trim())} style={{ padding: "7px 10px", fontSize: 12.5, cursor: "pointer", color: "#0E9F6E" }}>+ Créer « {mesureQuery.trim()} »</div>
              </div>
            )}
          </div>
        )}
      </div>

      {error && <p style={{ color: "var(--v2-danger)", fontSize: 12.5 }}>{error}</p>}

      <div className="detail-block">
        <h4>Tableau de mesures</h4>
            </div>
            {!lectureSeule && (
              <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap", marginTop: 8, fontSize: 12.5 }}>
                <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  Type de mesure
                  <select
                    value={nouveauGroupe}
                    onChange={(e) => setNouveauGroupe(e.target.value === "detail" ? "detail" : "principale")}
                    style={{ border: "1px solid #C9CAC0", borderRadius: 6, padding: "3px 6px", fontSize: 12.5 }}
                  >
                    <option value="principale">Principale</option>
                    <option value="detail">Détail</option>
                  </select>
                </label>
                {/* Cochee par defaut : une mesure ajoutee est le plus souvent une amelioration du
                    referentiel. Decochee, elle reste exceptionnelle et propre a cette fiche. */}
                <label style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "#55564E" }}>
                  <input type="checkbox" checked={enrichirModele} onChange={(e) => setEnrichirModele(e.target.checked)} />
                  Proposer pour les prochains « {article.produit} »
                </label>
              </div>
            )}
            <p style={{ fontSize: 11.5, color: "var(--v2-text-3)", marginTop: 6 }}>Les cellules s'enregistrent automatiquement en quittant le champ.</p>
          </>
        )}
      </div>


    </div>
  );
}
