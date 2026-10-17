import { useEffect, useRef, useState } from "react";
import Icon from "../../shared/Icon";
import { Article, Commande, CommandePayload, Etape, ListeValeur, PRIORITE_LABELS, TypeProduction } from "../../shared/types";
import { mediaUrl, todayISO } from "../commandes/uiHelpers";
import RepartitionEditor from "../commandes/RepartitionEditor";
import ArticleForm from "../articles/ArticleForm";
import ConfirmDialog from "../commandes/ConfirmDialog";
import TransitionDialog from "../commandes/TransitionDialog";

interface Props {
  etapes: Etape[];
  existing?: Commande | null;
  onClose: () => void;
  onSaved: (commande: Commande) => void;
  onValidated: (commande: Commande) => void;
  onDraftChanged?: () => void;
}

const STEPS = ["Article", "Organisation", "Répartition", "Résumé"];

function addDays(iso: string, n: number) {
  const d = new Date(iso);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

function prochaineReferenceReassort(article: Article): string {
  const next = (article.max_numero_reassort || 0) + 1;
  return `${article.reference_principale}-R${String(next).padStart(2, "0")}`;
}

export default function CommandeWizard({ etapes, existing, onClose, onSaved, onValidated, onDraftChanged }: Props) {
  // Une commande qui n'est plus en brouillon ne peut être rouverte en édition que si son BC PF
  // est lui-même encore en brouillon (voir CommandeDetailModal) — l'article et le type de
  // production restent alors verrouillés : en changer déclenche une recréation de la commande,
  // sûre uniquement sur un authentique brouillon. On saute directement à l'étape Organisation.
  const articleVerrouille = !!existing && existing.statut !== "brouillon";
  const [step, setStep] = useState(articleVerrouille ? 1 : 0);
  const [loaded, setLoaded] = useState(false);

  const [articles, setArticles] = useState<Article[]>([]);
  const [allCommandes, setAllCommandes] = useState<Commande[]>([]);
  const [couleurs, setCouleurs] = useState<ListeValeur[]>([]);
  const [tailles, setTailles] = useState<ListeValeur[]>([]);
  const [ateliers, setAteliers] = useState<ListeValeur[]>([]);

  const [typeProduction, setTypeProduction] = useState<TypeProduction | null>(existing?.type_production ?? null);
  const [selectedArticle, setSelectedArticle] = useState<Article | null>(null);
  // Grille applicable a l'article choisi, et message si aucune n'est configuree.
  const [grilleTailles, setGrilleTailles] = useState<{ id: number; nom: string } | null>(null);
  const [grilleManquante, setGrilleManquante] = useState<string | null>(null);
  const [showCreateArticle, setShowCreateArticle] = useState(false);
  const [prefilled, setPrefilled] = useState(false);

  const [f, setF] = useState<Partial<CommandePayload>>({
    responsable_nom: existing?.responsable ?? "",
    atelier_id: existing?.atelier_id,
    date_lancement: existing?.date_lancement ?? todayISO(),
    date_fin_prevue: existing?.date_fin_prevue ?? addDays(todayISO(), 14),
    etape_id: existing?.etape_id ?? etapes[0]?.id,
    priorite: existing?.priorite ?? "normale",
    commentaires: existing?.commentaires ?? "",
    lignes: existing?.lignes?.map((l) => ({ couleur_id: l.couleur_id, taille_id: l.taille_id, quantite: l.quantite, reference_libre: l.couleur_reference })) ?? [],
  });

  // État de la répartition (couleurs/tailles sélectionnées, quantités) : vit ici, dans le
  // wizard, qui ne se démonte jamais entre les étapes — pas dans RepartitionEditor, qui lui
  // n'est monté que pendant l'étape Répartition et perdrait tout à chaque changement d'étape.
  const [selectedCouleurs, setSelectedCouleurs] = useState<number[]>(() =>
    Array.from(new Set((existing?.lignes ?? []).map((l) => l.couleur_id)))
  );
  const [selectedTailles, setSelectedTailles] = useState<number[]>(() =>
    Array.from(new Set((existing?.lignes ?? []).filter((l) => l.taille_id != null).map((l) => l.taille_id as number)))
  );
  const [quantities, setQuantities] = useState<Record<string, number>>(() => {
    const map: Record<string, number> = {};
    (existing?.lignes ?? []).forEach((l) => { map[`${l.couleur_id}:${l.taille_id ?? "none"}`] = l.quantite; });
    return map;
  });
  const [references, setReferences] = useState<Record<number, string>>(() => {
    const map: Record<number, string> = {};
    (existing?.lignes ?? []).forEach((l) => {
      if (l.couleur_reference) map[l.couleur_id] = l.couleur_reference;
    });
    return map;
  });
  const [pendingRepartitionRemoval, setPendingRepartitionRemoval] = useState<{ kind: "couleur" | "taille"; id: number; nom: string } | null>(null);

  const [draftId, setDraftId] = useState<number | null>(existing?.id ?? null);
  const [saving, setSaving] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [confirmLaunch, setConfirmLaunch] = useState(false);
  const [autosaving, setAutosaving] = useState(false);
  const [autosaveError, setAutosaveError] = useState<string | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [pendingChange, setPendingChange] = useState<{ kind: "type"; value: TypeProduction } | { kind: "article"; value: Article } | null>(null);
  const [criticalInconsistency, setCriticalInconsistency] = useState<{ oldRef: string; newRef: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Refs (synchrones, contrairement à l'état React) : évitent qu'un double-clic rapide entre
  // deux étapes ne déclenche deux créations en parallèle avant que l'état n'ait eu le temps
  // de se mettre à jour.
  const draftIdRef = useRef<number | null>(existing?.id ?? null);
  const savingInFlightRef = useRef<Promise<{ ok: boolean; message?: string }> | null>(null);
  const pendingAutosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedArticleRef = useRef<{ articleId: number; type: TypeProduction } | null>(
    existing ? { articleId: existing.article_id, type: existing.type_production } : null
  );

  // Tailles proposees = valeurs ACTIVES de la grille associee au TYPE de produit de l'article.
  // Flux : article -> produit_id -> produit_grille_taille -> grille -> grilles_tailles_valeurs.
  // Aucune grille n'est choisie par defaut, meme s'il n'en existe qu'une seule : l'existence
  // d'une grille unique ne signifie pas qu'elle convient au produit.
  useEffect(() => {
    let annule = false;
    async function chargerGrille() {
      if (!selectedArticle || !selectedArticle.produit_id) {
        setTailles([]); setGrilleTailles(null); setGrilleManquante(null);
        return;
      }
      try {
        const g = await window.api.grillesTailles.getPourProduit(selectedArticle.produit_id);
        if (annule) return;
        if (!g) {
          setTailles([]); setGrilleTailles(null);
          setGrilleManquante(selectedArticle.produit || "ce type de produit");
          return;
        }
        setGrilleManquante(null);
        setGrilleTailles({ id: g.id, nom: g.nom });
        // Les valeurs arrivent deja triees par `ordre` : aucun tri alphabetique ou numerique
        // n'est refait ici, sans quoi S/M/L ou 29/30/38 seraient reordonnes a tort.
        setTailles((g.valeurs || []).filter((v: any) => v.actif).map((v: any) => ({ id: v.id, nom: v.valeur, actif: v.actif })));
      } catch (err) {
        if (!annule) { setTailles([]); setGrilleTailles(null); setGrilleManquante(selectedArticle.produit || "ce type de produit"); }
      }
    }
    chargerGrille();
    return () => { annule = true; };
  }, [selectedArticle?.id, selectedArticle?.produit_id]);

  useEffect(() => {
    async function load() {
      const [arts, cmds, c, a] = await Promise.all([
        window.api.articles.list({ includeIncomplete: false }),
        window.api.commandes.list(),
        window.api.listes.list("couleur", { includeInactive: true }),
        window.api.listes.list("atelier", { includeInactive: true }),
      ]);
      setArticles(arts);
      setAllCommandes(cmds);
      setCouleurs(c);
      // Les tailles ne sont PLUS chargees ici : elles dependent desormais de l'article choisi.
      // Voir l'effet ci-dessous — listes_valeurs(type='taille') n'est plus utilise pour la
      // production, car commande_lignes.taille_id reference grilles_tailles_valeurs.
      setAteliers(a);
      if (existing) {
        setTypeProduction(existing.type_production);
        setSelectedArticle(arts.find((x) => x.id === existing.article_id) ?? null);
      } else {
        const atelierParDefaut = a.find((v) => v.actif);
        setF((prev) => ({
          ...prev,
          atelier_id: prev.atelier_id ?? atelierParDefaut?.id,
          responsable_nom: prev.responsable_nom || atelierParDefaut?.responsable_nom || "",
        }));
      }
      setLoaded(true);
    }
    load();
  }, []);

  function repartitionCellKey(couleurId: number, tailleId: number | null) {
    return `${couleurId}:${tailleId ?? "none"}`;
  }

  // Recalcule f.lignes à chaque changement de sélection/quantité/référence — c'est la seule voie
  // par laquelle la répartition alimente le payload envoyé au backend (jamais de quantité à 0
  // stockée). La référence, saisie une fois par couleur, s'applique à toutes ses lignes taille.
  useEffect(() => {
    const lignes: { couleur_id: number; taille_id: number | null; quantite: number; reference_libre: string | null }[] = [];
    for (const cId of selectedCouleurs) {
      const ref = (references[cId] || "").trim() || null;
      if (selectedTailles.length === 0) {
        const q = quantities[repartitionCellKey(cId, null)] || 0;
        if (q > 0) lignes.push({ couleur_id: cId, taille_id: null, quantite: q, reference_libre: ref });
      } else {
        for (const tId of selectedTailles) {
          const q = quantities[repartitionCellKey(cId, tId)] || 0;
          if (q > 0) lignes.push({ couleur_id: cId, taille_id: tId, quantite: q, reference_libre: ref });
        }
      }
    }
    setF((prev) => ({ ...prev, lignes }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCouleurs, selectedTailles, quantities, references]);

  function hasRepartitionDataFor(kind: "couleur" | "taille", id: number) {
    const prefix = kind === "couleur" ? `${id}:` : `:${id}`;
    return Object.entries(quantities).some(([k, v]) => v > 0 && (kind === "couleur" ? k.startsWith(prefix) : k.endsWith(prefix)));
  }

  function toggleCouleur(v: ListeValeur) {
    const isSelected = selectedCouleurs.includes(v.id);
    if (isSelected) {
      if (hasRepartitionDataFor("couleur", v.id)) { setPendingRepartitionRemoval({ kind: "couleur", id: v.id, nom: v.nom }); return; }
      setSelectedCouleurs((prev) => prev.filter((x) => x !== v.id));
    } else {
      setSelectedCouleurs((prev) => [...prev, v.id]);
    }
  }

  function toggleTaille(v: ListeValeur) {
    const isSelected = selectedTailles.includes(v.id);
    if (isSelected) {
      if (hasRepartitionDataFor("taille", v.id)) { setPendingRepartitionRemoval({ kind: "taille", id: v.id, nom: v.nom }); return; }
      setSelectedTailles((prev) => prev.filter((x) => x !== v.id));
    } else {
      setSelectedTailles((prev) => [...prev, v.id]);
    }
  }

  function confirmRepartitionRemoval() {
    if (!pendingRepartitionRemoval) return;
    if (pendingRepartitionRemoval.kind === "couleur") setSelectedCouleurs((prev) => prev.filter((x) => x !== pendingRepartitionRemoval.id));
    else setSelectedTailles((prev) => prev.filter((x) => x !== pendingRepartitionRemoval.id));
    setPendingRepartitionRemoval(null);
  }

  // Ne stocke jamais une quantité invalide, quelle que soit sa forme ("", espaces, 0, négatif,
  // NaN) : la case est retirée de la carte plutôt que mise à 0, pour qu'aucune ambiguïté ne
  // subsiste dans la validation (une clé absente = jamais renseignée, point final). Seule une
  // valeur numérique finie strictement supérieure à 0 est conservée.
  // Un champ vide n'est jamais une quantité renseignée : la case est retirée de la carte.
  // Un 0 explicitement saisi, en revanche, est une valeur valide et délibérée ("aucune pièce
  // prévue pour cette combinaison") : il est conservé tel quel, distinct d'une case jamais
  // remplie. Une valeur négative ou non numérique reste traitée comme non renseignée.
  function handleQuantityChange(cId: number, tId: number | null, raw: string) {
    const key = repartitionCellKey(cId, tId);
    const trimmed = raw.trim();
    const parsed = Number(trimmed);
    const isEmpty = trimmed === "";
    const isValidNonNegative = !isEmpty && Number.isFinite(parsed) && parsed >= 0;

    setQuantities((prev) => {
      if (!isValidNonNegative) {
        if (!(key in prev)) return prev;
        const next = { ...prev };
        delete next[key];
        return next;
      }
      return { ...prev, [key]: Math.trunc(parsed) };
    });
  }

  function handleReferenceChange(couleurId: number, raw: string) {
    setReferences((prev) => ({ ...prev, [couleurId]: raw }));
  }

  function handleCouleurCreated(v: ListeValeur) {
    setCouleurs((prev) => [...prev, v]);
    setSelectedCouleurs((prev) => [...prev, v.id]);
  }

  // Marque des changements non enregistrés dès que la sélection/le formulaire bouge, mais
  // jamais lors du tout premier passage juste après le chargement (sinon le simple fait
  // d'ouvrir le wizard, sans rien saisir, serait à tort considéré comme "modifié").
  const skipNextChangeRef = useRef(true);
  const suppressDirtyRef = useRef(false);
  useEffect(() => {
    if (!loaded) return;
    if (skipNextChangeRef.current) { skipNextChangeRef.current = false; return; }
    if (suppressDirtyRef.current) { suppressDirtyRef.current = false; return; }
    setHasUnsavedChanges(true);

    // Enregistrement automatique dès que la première donnée réellement significative existe
    // (au moins une quantité renseignée dans la répartition), pas seulement au changement
    // d'étape. En amont de ce seuil, le backend refuse de toute façon toute création — ce n'est
    // pas un choix arbitraire de l'interface, c'est la même règle "au moins une ligne" déjà en
    // place partout ailleurs dans l'application.
    if (!isValidPayload()) return;
    const timer = setTimeout(() => { trySaveDraft(); }, 700);
    pendingAutosaveTimerRef.current = timer;
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, typeProduction, selectedArticle, f]);

  function handleSelectArticle(article: Article) {
    setSelectedArticle(article);
    if (existing) return;
    if (typeProduction === "reassort") {
      const last = allCommandes.filter((c) => c.article_id === article.id).sort((a, b) => b.id - a.id)[0];
      if (last) {
        setF((prev) => ({ ...prev, responsable_nom: last.responsable, atelier_id: last.atelier_id, priorite: last.priorite }));
        setPrefilled(true);
      }
    }
  }

  // Un brouillon existe déjà : changer l'article ou le type déclenchera la génération d'une
  // nouvelle référence de production. On avertit clairement avant d'appliquer quoi que ce soit,
  // plutôt que de le faire silencieusement.
  function requestTypeChange(newType: TypeProduction) {
    if (draftId != null && typeProduction != null && typeProduction !== newType) {
      setPendingChange({ kind: "type", value: newType });
      return;
    }
    setTypeProduction(newType);
    setSelectedArticle(null);
  }

  function requestArticleChange(article: Article) {
    if (draftId != null && selectedArticle != null && selectedArticle.id !== article.id) {
      setPendingChange({ kind: "article", value: article });
      return;
    }
    handleSelectArticle(article);
  }

  function confirmPendingChange() {
    if (!pendingChange) return;
    if (pendingChange.kind === "type") {
      setTypeProduction(pendingChange.value);
      setSelectedArticle(null);
    } else {
      handleSelectArticle(pendingChange.value);
    }
    setPendingChange(null);
  }

  const REPARTITION_INCOMPLETE_MESSAGE =
    "Veuillez sélectionner au moins une couleur, une taille et saisir une quantité supérieure à 0 avant de continuer.";

  // Règle précise : CHAQUE couleur sélectionnée doit avoir au moins une quantité > 0 sur au
  // moins une taille, et CHAQUE taille sélectionnée doit avoir au moins une quantité > 0 sur au
  // moins une couleur. Une cellule vide reste autorisée tant que la couleur et la taille
  // concernées sont utilisées ailleurs au moins une fois — pas besoin de remplir la grille en
  // entier. S'appuie directement sur la sélection réelle (pas seulement sur les lignes déjà
  // produites), pour distinguer "jamais sélectionné" de "sélectionné mais resté vide".
  function isRepartitionComplete(): boolean {
    if (selectedCouleurs.length === 0 || selectedTailles.length === 0) return false;
    const everyCouleurHasQty = selectedCouleurs.every((cId) => hasRepartitionDataFor("couleur", cId));
    const everyTailleHasQty = selectedTailles.every((tId) => hasRepartitionDataFor("taille", tId));
    return everyCouleurHasQty && everyTailleHasQty;
  }

  // Source unique de vérité pour "cette commande peut être enregistrée" : utilisée aussi bien
  // par l'enregistrement automatique progressif que par "Suivant" (étape Répartition),
  // "Enregistrer comme brouillon" et "Lancer la commande". Un brouillon n'est donc jamais créé,
  // même automatiquement, sans une répartition complète au sens de la règle ci-dessus.
  function isValidPayload(): boolean {
    return !!(selectedArticle && f.responsable_nom && f.responsable_nom.trim() && f.atelier_id && f.date_lancement && f.date_fin_prevue &&
      f.date_fin_prevue >= f.date_lancement && isRepartitionComplete());
  }

  // Enregistrement automatique du brouillon, protégé contre les doublons : si un enregistrement
  // est déjà en cours (deux clics rapprochés entre étapes), on attend qu'il se termine au lieu
  // d'en démarrer un second — deux create() en parallèle produiraient deux commandes distinctes.
  async function trySaveDraft(): Promise<{ ok: boolean; message?: string }> {
    if (!isValidPayload()) return { ok: false, message: "Formulaire incomplet." };
    if (savingInFlightRef.current) return savingInFlightRef.current;

    const run = (async (): Promise<{ ok: boolean; message?: string }> => {
      setAutosaving(true);
      setAutosaveError(null);
      try {
        const currentType = typeProduction ?? "nouveau";
        const payload: CommandePayload = {
          ...(f as CommandePayload),
          article_id: selectedArticle!.id,
          type_production: currentType,
        };
        const articleChanged =
          lastSavedArticleRef.current != null &&
          (lastSavedArticleRef.current.articleId !== selectedArticle!.id || lastSavedArticleRef.current.type !== currentType);

        if (draftIdRef.current == null) {
          const created = await window.api.commandes.create(payload);
          draftIdRef.current = created.id;
          setDraftId(created.id);
          lastSavedArticleRef.current = { articleId: selectedArticle!.id, type: currentType };
          setHasUnsavedChanges(false);
          return { ok: true };
        }

        if (!articleChanged) {
          await window.api.commandes.update(draftIdRef.current, payload);
          lastSavedArticleRef.current = { articleId: selectedArticle!.id, type: currentType };
          setHasUnsavedChanges(false);
          return { ok: true };
        }

        // --- Changement d'article/type sur un brouillon déjà existant ---
        // Séquence stricte : le wizard ne bascule vers la nouvelle commande QUE si la création
        // ET la suppression de l'ancienne réussissent TOUTES LES DEUX. Aucun état intermédiaire
        // n'est jamais présenté comme actif.
        const oldId = draftIdRef.current;

        let created;
        try {
          created = await window.api.commandes.create(payload);
        } catch (err: any) {
          // Étape 1 échouée : rien n'a changé, l'ancien brouillon reste la commande active.
          const message = err?.message || "La création de la nouvelle commande a échoué.";
          setAutosaveError(message);
          return { ok: false, message };
        }

        try {
          await window.api.commandes.remove(oldId);
        } catch {
          // Étape 2 échouée : on tente immédiatement d'annuler la création (étape 3, rollback)
          // pour revenir exactement à l'état initial plutôt que de laisser deux commandes
          // représenter la même intention utilisateur.
          try {
            await window.api.commandes.remove(created.id);
            // Rollback réussi : l'ancien brouillon reste la commande active à tous points de vue,
            // y compris dans l'affichage du wizard, qui revient à la dernière sélection enregistrée.
            const revertedArticle = articles.find((a) => a.id === lastSavedArticleRef.current?.articleId) ?? null;
            if (revertedArticle && lastSavedArticleRef.current) {
              suppressDirtyRef.current = true;
              setSelectedArticle(revertedArticle);
              setTypeProduction(lastSavedArticleRef.current.type);
            }
            setHasUnsavedChanges(false);
            onDraftChanged?.();
            const message = "Le changement d'article n'a pas pu être appliqué (suppression de l'ancien brouillon impossible). Aucune modification n'a été conservée.";
            setAutosaveError(message);
            return { ok: false, message };
          } catch {
            // Le rollback lui-même a échoué : les deux commandes existent désormais. Ce n'est
            // JAMAIS présenté comme un succès, et la validation finale reste bloquée tant que
            // ce n'est pas résolu manuellement (voir le bandeau permanent affiché).
            let oldRefLabel = `#${oldId}`;
            try {
              const oldCmd = await window.api.commandes.get(oldId);
              oldRefLabel = oldCmd.reference_production || oldCmd.numero || oldRefLabel;
            } catch {
              // Référence de repli déjà définie ci-dessus.
            }
            setCriticalInconsistency({
              oldRef: oldRefLabel,
              newRef: created.reference_production || created.numero || `#${created.id}`,
            });
            onDraftChanged?.();
            setHasUnsavedChanges(true);
            const message = "Incohérence non résolue : deux commandes existent désormais pour cette saisie et n'ont pas pu être fusionnées automatiquement.";
            setAutosaveError(message);
            return { ok: false, message };
          }
        }

        // Les deux opérations ont réussi : bascule définitive vers la nouvelle commande,
        // et seulement maintenant.
        draftIdRef.current = created.id;
        setDraftId(created.id);
        lastSavedArticleRef.current = { articleId: selectedArticle!.id, type: currentType };
        setHasUnsavedChanges(false);
        onDraftChanged?.();
        return { ok: true };
      } catch (err: any) {
        const message = err?.message || "Erreur lors de l'enregistrement automatique.";
        setAutosaveError(message);
        return { ok: false, message };
      } finally {
        setAutosaving(false);
        savingInFlightRef.current = null;
      }
    })();

    savingInFlightRef.current = run;
    return run;
  }

  async function goToStep(n: number) {
    if (autosaving) return; // évite un changement d'étape pendant un enregistrement déjà en cours
    if (n < step) { await trySaveDraft(); setStep(n); return; }
    if (step === 0 && !selectedArticle) { setError("Sélectionnez ou créez un article avant de continuer."); return; }
    if (step === 1 && (!f.responsable_nom || !f.responsable_nom.trim() || !f.atelier_id)) { setError("Renseignez un responsable et un atelier."); return; }
    if (step === 2 && !isRepartitionComplete()) { setError(REPARTITION_INCOMPLETE_MESSAGE); return; }
    setError(null);
    await trySaveDraft();
    setStep(n);
  }

  async function handleSaveAsDraft() {
    if (criticalInconsistency) {
      setError("Impossible d'enregistrer : une incohérence non résolue existe entre deux commandes. Résolvez-la avant de continuer (voir le bandeau ci-dessus).");
      return;
    }
    if (!isRepartitionComplete()) {
      setError(REPARTITION_INCOMPLETE_MESSAGE);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const result = await trySaveDraft();
      if (!result.ok) {
        setError(result.message || "Erreur lors de l'enregistrement.");
        return;
      }
      if (draftIdRef.current == null) throw new Error("Identifiant de brouillon manquant après l'enregistrement.");
      const commande = await window.api.commandes.get(draftIdRef.current);
      onSaved(commande);
    } catch (err: any) {
      setError(err?.message || "Erreur lors de l'enregistrement.");
    } finally {
      setSaving(false);
    }
  }

  // Ouvre la confirmation de lancement — bloque immédiatement si les données obligatoires
  // manquent, sans même montrer le dialogue (rien à confirmer si ce n'est pas possible).
  function requestLaunch() {
    if (criticalInconsistency) {
      setError("Impossible de lancer : une incohérence non résolue existe entre deux commandes. Résolvez-la avant de continuer (voir le bandeau ci-dessus).");
      return;
    }
    if (!isRepartitionComplete()) {
      setError(REPARTITION_INCOMPLETE_MESSAGE);
      return;
    }
    setError(null);
    setConfirmLaunch(true);
  }

  // Dernière sauvegarde, puis validation officielle (Brouillon → Validée), jamais directement
  // vers En production : conforme au cycle de vie déjà en place (voir commandes:valider côté
  // backend, inchangé). En cas d'échec à n'importe quelle étape, on lève l'erreur : le dialogue
  // reste ouvert et affiche le message, rien n'est présenté comme réussi.
  async function handleLaunch() {
    setLaunching(true);
    try {
      // Annule tout enregistrement automatique différé encore en attente : sans cela, un
      // autosave programmé juste avant le clic pourrait s'exécuter APRÈS la validation avec des
      // données obsolètes (aucun risque sur le statut lui-même, qui n'est jamais touché par
      // l'autosave, mais un risque réel sur atelier/dates/étape/priorité/commentaires).
      if (pendingAutosaveTimerRef.current) {
        clearTimeout(pendingAutosaveTimerRef.current);
        pendingAutosaveTimerRef.current = null;
      }
      const saveResult = await trySaveDraft();
      if (!saveResult.ok) throw new Error(saveResult.message || "Erreur lors de l'enregistrement.");
      if (draftIdRef.current == null) throw new Error("Identifiant de brouillon manquant après l'enregistrement.");
      const validated = await window.api.commandes.valider(draftIdRef.current);
      setConfirmLaunch(false);
      onValidated(validated);
    } finally {
      setLaunching(false);
    }
  }

  function requestClose() {
    if (hasUnsavedChanges) { setConfirmClose(true); return; }
    onClose();
  }

  const articlesPourNouveau = articles.filter((a) => a.nb_commandes_nouveau === 0);
  const articlesPourReassort = articles;
  const photoPrincipale = selectedArticle?.photos.find((p) => p.est_principale) ?? null;
  const quantiteTotale = (f.lignes ?? []).reduce((s, l) => s + l.quantite, 0);
  const couleursUtilisees = Array.from(new Set((f.lignes ?? []).map((l) => l.couleur_id)))
    .map((id) => couleurs.find((c) => c.id === id)?.nom).filter(Boolean);
  const taillesUtilisees = Array.from(new Set((f.lignes ?? []).map((l) => l.taille_id).filter((x): x is number => x != null)))
    .map((id) => tailles.find((t) => t.id === id)?.nom).filter(Boolean);

  return (
    <div className="wizard-page">
      <div className="wizard-topbar">
        <button className="wizard-back-btn" onClick={requestClose} aria-label="Retour"><Icon name="arrow-left" /></button>
        <span className="crumb">Commandes</span><span className="sep">/</span>
        <span className="crumb current">{existing ? (existing.numero ?? "Brouillon") : "Nouvelle commande"}</span>
        <div className="wizard-autosave" style={autosaveError ? { color: "var(--v2-danger)" } : undefined} title={autosaveError ?? undefined}>
          {autosaveError
            ? <><Icon name="alert-triangle" /> Échec de l'enregistrement automatique</>
            : autosaving ? "Enregistrement..." : draftId != null ? <><span className="dot" /> Brouillon enregistré</> : "Non enregistré"}
        </div>
        <button className="wizard-quit-btn" onClick={requestClose}><Icon name="x" /> Quitter</button>
      </div>

      {criticalInconsistency && (
        <div style={{ background: "var(--v2-danger-bg)", color: "var(--v2-danger)", padding: "12px 28px", fontSize: 13, display: "flex", alignItems: "center", gap: 8 }}>
          <Icon name="alert-triangle" />
          Incohérence non résolue : deux commandes existent pour cette saisie — <strong>{criticalInconsistency.oldRef}</strong> (active) et <strong>{criticalInconsistency.newRef}</strong> (en trop).
          Supprimez manuellement <strong>{criticalInconsistency.newRef}</strong> depuis la liste des commandes avant de pouvoir terminer.
        </div>
      )}

      <div className="wizard-stepper">
        {STEPS.map((label, i) => (
          <button
            key={label}
            className={`wizard-step-tab ${i < step ? "done clickable" : ""} ${i === step ? "active" : ""} ${i > step ? "" : "clickable"}`}
            onClick={() => { if (i <= step && !(articleVerrouille && i === 0)) goToStep(i); }}
            disabled={i > step || (articleVerrouille && i === 0)}
          >
            <div className="wizard-step-bar" />
            <span className="wizard-step-label">{i + 1}. {label}</span>
          </button>
        ))}
      </div>

      <div className="wizard-body">
        <div className="wizard-content">
          {!loaded && <p style={{ color: "var(--v2-text-3)" }}>Chargement...</p>}

          {loaded && step === 0 && (
            <>
              <p className="wizard-title">Article</p>
              <p className="wizard-subtitle">Cette commande porte-t-elle sur un nouvel article ou sur un réassort ?</p>

              {!existing && (
                <div className="v2-choice-grid">
                  <button className={`v2-choice-card ${typeProduction === "nouveau" ? "selected" : ""}`} onClick={() => requestTypeChange("nouveau")}>
                    <Icon name="sparkles" />
                    <div className="v2-choice-card-title">Nouvel article</div>
                    <div className="v2-choice-card-desc">Première commande de production pour un article inédit</div>
                  </button>
                  <button className={`v2-choice-card ${typeProduction === "reassort" ? "selected" : ""}`} onClick={() => requestTypeChange("reassort")}>
                    <Icon name="repeat" />
                    <div className="v2-choice-card-title">Réassort</div>
                    <div className="v2-choice-card-desc">Production supplémentaire d'un article déjà lancé</div>
                  </button>
                </div>
              )}

              {typeProduction && !existing && (
                <div style={{ marginBottom: 24 }}>
                  <label style={{ fontSize: 12.5, fontWeight: 500, color: "var(--v2-text)", display: "block", marginBottom: 8 }}>
                    {typeProduction === "nouveau" ? "Choisir un article sans commande initiale" : "Choisir un article"}
                  </label>
                  <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                    <select
                      value={selectedArticle?.id ?? ""}
                      onChange={(e) => { const a = articles.find((x) => x.id === Number(e.target.value)); if (a) requestArticleChange(a); }}
                      style={{ height: 40, border: "1px solid var(--v2-border)", borderRadius: 8, padding: "0 10px", fontSize: 13.5, minWidth: 320 }}
                    >
                      <option value="" disabled>— Sélectionner —</option>
                      {(typeProduction === "nouveau" ? articlesPourNouveau : articlesPourReassort).map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.reference_principale} — {a.produit}{typeProduction === "reassort" && a.nb_productions === 0 ? " (sans historique)" : ""}
                        </option>
                      ))}
                    </select>
                    {typeProduction === "nouveau" && (
                      <button className="v2-btn ghost" onClick={() => setShowCreateArticle(true)}><Icon name="plus" /> Créer un nouvel article</button>
                    )}
                  </div>
                  {draftId != null && (
                    <p style={{ fontSize: 11.5, color: "var(--v2-text-3)", marginTop: 8 }}>
                      <Icon name="info-circle" /> Un brouillon existe déjà pour cette commande : changer l'article ou le type générera une nouvelle référence de production.
                    </p>
                  )}
                </div>
              )}

              {selectedArticle && (
                <div className="v2-summary-card" style={{ display: "flex", gap: 16, alignItems: "center", maxWidth: 640 }}>
                  <div className="v2-photo-frame" style={{ width: 88, aspectRatio: "auto", height: 88 }}>
                    {photoPrincipale ? <img src={mediaUrl(photoPrincipale.photo_thumb_path)!} alt="" /> : <Icon name="photo" size={26} />}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: 15 }}>{selectedArticle.produit}</div>
                    <span className="v2-summary-ref">{selectedArticle.reference_principale}</span>
                    {typeProduction === "reassort" && selectedArticle.nb_productions > 0 && (
                      <div style={{ marginTop: 10, fontSize: 12.5, color: "var(--v2-text-2)" }}>
                        {selectedArticle.nb_productions} production{selectedArticle.nb_productions > 1 ? "s" : ""} déjà réalisée{selectedArticle.nb_productions > 1 ? "s" : ""}
                        {selectedArticle.derniere_reference_production && <> · dernière : <strong>{selectedArticle.derniere_reference_production}</strong></>}
                        <br />Nouvelle référence proposée : <strong style={{ color: "var(--v2-green-dark)" }}>{prochaineReferenceReassort(selectedArticle)}</strong>
                      </div>
                    )}
                    {typeProduction === "reassort" && selectedArticle.nb_productions === 0 && (
                      <div style={{ marginTop: 10, fontSize: 12.5, color: "var(--v2-warning)", background: "var(--v2-warning-bg)", padding: "8px 10px", borderRadius: 8 }}>
                        <Icon name="info-circle" /> Aucune production précédente n'est enregistrée dans Belvie ERP pour cet article. Ce réassort sera saisi sans historique ERP.
                        <br />Référence proposée : <strong style={{ color: "var(--v2-green-dark)" }}>{prochaineReferenceReassort(selectedArticle)}</strong>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </>
          )}

          {loaded && step === 1 && (
            <>
              {articleVerrouille && selectedArticle && (
                <div className="v2-info-card" style={{ marginBottom: 16 }}>
                  <Icon name="info-circle" />
                  <label>Article (non modifiable)</label>
                  <div style={{ fontWeight: 600 }}>{selectedArticle.produit} — {selectedArticle.reference_principale}</div>
                  <div style={{ fontSize: 12, color: "var(--v2-text-3)", marginTop: 4 }}>
                    La commande a déjà été validée — l'article et le type de production ne peuvent plus être changés.
                    Seules l'organisation et la répartition restent modifiables tant que le bon de commande associé
                    n'est pas encore validé.
                  </div>
                </div>
              )}
              <p className="wizard-title">Organisation</p>
              <p className="wizard-subtitle">Qui pilote cette commande, et sous quels délais</p>
              <div className="v2-card-grid">
                <div className="v2-info-card">
                  <Icon name="building-factory" />
                  <label>Atelier</label>
                  <select
                    value={f.atelier_id ?? ""}
                    onChange={(e) => {
                      const id = Number(e.target.value);
                      const atelier = ateliers.find((a) => a.id === id);
                      setF({ ...f, atelier_id: id, responsable_nom: atelier?.responsable_nom || f.responsable_nom });
                    }}
                  >
                    {ateliers.map((a) => <option key={a.id} value={a.id}>{a.nom}</option>)}
                  </select>
                  {prefilled && <div className="v2-prefill-hint"><Icon name="wand" /> Pré-rempli depuis la dernière production</div>}
                </div>
                <div className="v2-info-card">
                  <Icon name="user" />
                  <label>Responsable</label>
                  <input type="text" placeholder="Nom du responsable" value={f.responsable_nom ?? ""} onChange={(e) => setF({ ...f, responsable_nom: e.target.value })} />
                  {prefilled && <div className="v2-prefill-hint"><Icon name="wand" /> Pré-rempli depuis la dernière production</div>}
                </div>
                <div className="v2-info-card">
                  <Icon name="flag" />
                  <label>Priorité</label>
                  <select value={f.priorite} onChange={(e) => setF({ ...f, priorite: e.target.value as any })}>
                    {Object.entries(PRIORITE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
                <div className="v2-info-card">
                  <Icon name="calendar" />
                  <label>Date de lancement</label>
                  <input type="date" value={f.date_lancement} onChange={(e) => setF({ ...f, date_lancement: e.target.value })} />
                </div>
                <div className="v2-info-card">
                  <Icon name="calendar-due" />
                  <label>Date limite de production</label>
                  <input type="date" min={f.date_lancement} value={f.date_fin_prevue} onChange={(e) => setF({ ...f, date_fin_prevue: e.target.value })} />
                </div>
                <div className="v2-info-card">
                  <Icon name="list-check" />
                  <label>Étape actuelle</label>
                  <select value={f.etape_id} onChange={(e) => setF({ ...f, etape_id: Number(e.target.value) })}>
                    {etapes.map((s) => <option key={s.id} value={s.id}>{s.libelle}</option>)}
                  </select>
                </div>
                <div className="v2-info-card" style={{ gridColumn: "span 2" }}>
                  <Icon name="note" />
                  <label>Commentaires</label>
                  <textarea rows={2} value={f.commentaires ?? ""} onChange={(e) => setF({ ...f, commentaires: e.target.value })} placeholder="Précision utile pour l'atelier..." />
                </div>
              </div>
            </>
          )}

          {loaded && step === 2 && (
            <>
              <p className="wizard-title">Couleurs, tailles et répartition</p>
              <p className="wizard-subtitle">
                Sélectionnez d'abord les couleurs et tailles, la grille s'ajuste automatiquement
                {grilleTailles ? <> — tailles de la grille <strong>{grilleTailles.nom}</strong></> : null}
              </p>

              {/* Aucune grille associee au type de produit : on le dit clairement plutot que d'en
                  choisir une au hasard. L'existence d'une grille unique ne signifie pas qu'elle
                  convient a ce produit. */}
              {grilleManquante && (
                <div style={{ border: "1px solid #C2410C", background: "#FEF3EC", borderRadius: 8, padding: 12, marginBottom: 14 }}>
                  <p style={{ margin: "0 0 6px", fontWeight: 600, fontSize: 13.5 }}>
                    Aucune grille de tailles n'est configurée pour le type de produit « {grilleManquante} ».
                  </p>
                  <p style={{ margin: 0, fontSize: 12.5, color: "var(--v2-text-2)" }}>
                    Ouvrez <strong>Paramètres → Tailles et variantes → Grille par type de produit</strong> pour
                    l'associer, puis revenez à cette étape.
                  </p>
                </div>
              )}

              <RepartitionEditor
                couleurs={couleurs}
                tailles={tailles}
                selectedCouleurs={selectedCouleurs}
                selectedTailles={selectedTailles}
                quantities={quantities}
                references={references}
                onToggleCouleur={toggleCouleur}
                onToggleTaille={toggleTaille}
                onQuantityChange={handleQuantityChange}
                onReferenceChange={handleReferenceChange}
                onCouleurCreated={handleCouleurCreated}
              />
            </>
          )}

          {loaded && step === 3 && selectedArticle && (
            <>
              <p className="wizard-title">Résumé</p>
              <p className="wizard-subtitle">Vérifiez les informations avant d'enregistrer</p>
              <div className="v2-summary-layout">
                <div className="v2-photo-frame">
                  {photoPrincipale ? (
                    <img src={mediaUrl(photoPrincipale.photo_thumb_path)!} alt="" />
                  ) : (
                    <div className="v2-photo-frame-empty"><Icon name="photo" size={32} /> Aucune image</div>
                  )}
                </div>
                <div className="v2-summary-card">
                  <div style={{ fontSize: 18, fontWeight: 600 }}>{selectedArticle.produit}</div>
                  <span className="v2-summary-ref">
                    {typeProduction === "reassort" ? prochaineReferenceReassort(selectedArticle) : selectedArticle.reference_principale}
                  </span>
                  <div className="v2-summary-grid">
                    <div className="item"><div className="k">Couleurs</div><div className="v">{couleursUtilisees.join(", ") || "—"}</div></div>
                    <div className="item"><div className="k">Tailles</div><div className="v">{taillesUtilisees.join(", ") || "—"}</div></div>
                    <div className="item"><div className="k">Quantité totale</div><div className="v big">{quantiteTotale}</div></div>
                    <div className="item"><div className="k">Atelier</div><div className="v">{ateliers.find((a) => a.id === f.atelier_id)?.nom ?? "—"}</div></div>
                    <div className="item"><div className="k">Responsable</div><div className="v">{f.responsable_nom || "—"}</div></div>
                    <div className="item"><div className="k">Priorité</div><div className="v">{f.priorite ? PRIORITE_LABELS[f.priorite] : "—"}</div></div>
                  </div>
                  {f.commentaires && <div className="v2-summary-comment">{f.commentaires}</div>}
                </div>
              </div>
            </>
          )}

          {error && <p style={{ background: "var(--v2-danger-bg)", color: "var(--v2-danger)", padding: "10px 14px", borderRadius: 8, fontSize: 13, marginTop: 20, maxWidth: 640 }}>{error}</p>}
        </div>
      </div>

      <div className="wizard-footer">
        <div className="wizard-footer-inner">
          <button className="v2-btn ghost" onClick={() => goToStep(step - 1)} disabled={autosaving || saving || launching || confirmLaunch || step === (articleVerrouille ? 1 : 0)}>
            <Icon name="arrow-left" /> Précédent
          </button>
          {step < 3 ? (
            <button className="v2-btn primary" onClick={() => goToStep(step + 1)} disabled={autosaving || (step === 2 && !isRepartitionComplete())}>Suivant <Icon name="arrow-right" /></button>
          ) : (
            <>
              <button className="v2-btn secondary" onClick={handleSaveAsDraft} disabled={saving || launching || confirmLaunch || !!criticalInconsistency || !isRepartitionComplete()}>
                {saving ? "Enregistrement..." : "Enregistrer comme brouillon"}
              </button>
              <button className="v2-btn primary" onClick={requestLaunch} disabled={saving || launching || confirmLaunch || !!criticalInconsistency || !isRepartitionComplete()}>
                Lancer la commande <Icon name="check" />
              </button>
            </>
          )}
        </div>
      </div>

      {showCreateArticle && (
        <ArticleForm
          onCancel={() => setShowCreateArticle(false)}
          onCreated={(article) => { setShowCreateArticle(false); setArticles((prev) => [...prev, article]); handleSelectArticle(article); }}
        />
      )}

      {confirmClose && (
        <ConfirmDialog
          title="Quitter sans enregistrer ?"
          message="Des modifications ne sont pas encore enregistrées. Voulez-vous vraiment quitter ?"
          confirmLabel="Quitter sans enregistrer"
          cancelLabel="Continuer la saisie"
          danger
          onConfirm={() => { setConfirmClose(false); onClose(); }}
          onCancel={() => setConfirmClose(false)}
        />
      )}

      {pendingChange && (
        <ConfirmDialog
          title="Changer d'article ou de type ?"
          message={
            "Cette commande a déjà été enregistrée comme brouillon. Changer l'article ou le type de production générera une nouvelle référence de production. " +
            "Les quantités déjà saisies dans la répartition seront conservées."
          }
          confirmLabel="Confirmer le changement"
          danger
          onConfirm={confirmPendingChange}
          onCancel={() => setPendingChange(null)}
        />
      )}

      {confirmLaunch && selectedArticle && (
        <TransitionDialog
          title="Lancer cette commande ?"
          message={
            `Référence : ${selectedArticle.reference_principale ?? ""} — ${selectedArticle.produit}\n` +
            `Quantité totale : ${quantiteTotale} pièces\n\n` +
            "Après validation, la commande recevra un numéro officiel et ses informations structurantes (article, référence, répartition) seront verrouillées. Elle ne pourra plus être supprimée. " +
            "Le statut passera de Brouillon à Validée."
          }
          confirmLabel="Lancer la commande"
          onConfirm={handleLaunch}
          onCancel={() => setConfirmLaunch(false)}
        />
      )}

      {pendingRepartitionRemoval && (
        <ConfirmDialog
          title={pendingRepartitionRemoval.kind === "couleur" ? "Retirer cette couleur ?" : "Retirer cette taille ?"}
          message={`« ${pendingRepartitionRemoval.nom} » contient déjà des quantités saisies. Les retirer effacera ces valeurs de la commande.`}
          confirmLabel="Retirer"
          danger
          onConfirm={confirmRepartitionRemoval}
          onCancel={() => setPendingRepartitionRemoval(null)}
        />
      )}
    </div>
  );
}
