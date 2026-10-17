import { useEffect, useRef, useState } from "react";

/**
 * Cellule de valeur du tableau de mesures.
 *
 * POURQUOI CE COMPOSANT EXISTE — la version précédente perdait des saisies :
 *
 *   <input defaultValue={v} onBlur={(e) => handleSetValeur(...)} />
 *
 * Trois défauts qui se combinaient :
 *   1. `defaultValue` = champ NON CONTRÔLÉ. React n'y touche plus jamais après le premier rendu :
 *      ce que l'utilisateur voit n'est pas ce qui est en base, c'est sa propre frappe affichée par
 *      le navigateur. Un échec d'écriture restait donc totalement invisible.
 *   2. Aucun try/catch : une erreur d'enregistrement produisait une promesse rejetée en silence.
 *   3. `onBlur` seul : tant que le curseur reste dans la cellule, rien n'est envoyé. Un démontage
 *      du composant sans perte de focus (fermeture de la fiche, Échap) emportait la saisie.
 *
 * Ici la valeur affichée est un état React, l'écriture est confirmée avant d'être considérée comme
 * acquise, et toute erreur est remontée. Une cellule en erreur reste visuellement en erreur : on ne
 * peut pas croire une valeur enregistrée alors qu'elle ne l'est pas.
 */

export type EtatSauvegarde = "repos" | "encours" | "ok" | "erreur";

interface Props {
  /** Valeur en base, source de vérité. */
  valeur: string;
  disabled: boolean;
  /** Doit LEVER en cas d'échec : c'est ce qui permet de ne jamais afficher un faux succès. */
  onSave: (valeur: string) => Promise<void>;
  /** Déplacement au clavier depuis cette cellule. */
  onNavigate?: (direction: "haut" | "bas" | "gauche" | "droite") => void;
  /** Coordonnées, utilisées pour retrouver la cellule voisine dans le tableau. */
  ligne: number;
  colonne: number;
  /** Remonte l'état « il reste quelque chose à enregistrer ici » : saisie non encore envoyée,
   *  écriture en cours, ou écriture en échec. Le parent agrège pour protéger la fermeture. */
  onEnAttenteChange?: (enAttente: boolean) => void;
}

export default function MesureCell({ valeur, disabled, onSave, onNavigate, ligne, colonne, onEnAttenteChange }: Props) {
  const [saisie, setSaisie] = useState(valeur);
  const [etat, setEtat] = useState<EtatSauvegarde>("repos");
  const [messageErreur, setMessageErreur] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Dernière valeur RÉELLEMENT confirmée en base. Sert à savoir s'il y a quelque chose à écrire,
  // et à revenir à un état sûr si l'écriture échoue.
  const enregistree = useRef(valeur);
  const montee = useRef(true);

  useEffect(() => () => { montee.current = false; }, []);

  // Une cellule est « en attente » si sa saisie diffère de ce qui est confirmé en base, si une
  // écriture est en cours, ou si la dernière a échoué. À la disparition de la cellule, on libère
  // toujours la retenue pour ne jamais bloquer une fermeture avec un compteur fantôme.
  const enAttente = saisie !== enregistree.current || etat === "encours" || etat === "erreur";
  useEffect(() => {
    if (onEnAttenteChange) onEnAttenteChange(enAttente);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enAttente]);
  useEffect(() => () => { if (onEnAttenteChange) onEnAttenteChange(false); }, []);

  // La valeur venant du parent (donc de la base) reprend la main tant que l'utilisateur n'a pas
  // de saisie en attente : évite d'écraser une frappe en cours lors d'un rafraîchissement.
  useEffect(() => {
    if (saisie === enregistree.current || etat === "ok" || etat === "repos") {
      setSaisie(valeur);
      enregistree.current = valeur;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valeur]);

  async function sauvegarder(v: string) {
    if (v === enregistree.current) return true; // rien à écrire
    setEtat("encours");
    setMessageErreur(null);
    try {
      await onSave(v);
      if (!montee.current) return true;
      enregistree.current = v;
      setEtat("ok");
      // Le voyant vert retombe seul : il confirme sans encombrer durablement l'écran.
      setTimeout(() => { if (montee.current) setEtat((e) => (e === "ok" ? "repos" : e)); }, 1400);
      return true;
    } catch (err: any) {
      if (!montee.current) return false;
      setEtat("erreur");
      setMessageErreur(err?.message || "Enregistrement impossible.");
      return false;
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      sauvegarder(saisie).then((ok) => { if (ok && onNavigate) onNavigate("bas"); });
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      // Échap ANNULE la saisie en cours et revient à la valeur enregistrée — il ne doit jamais
      // faire disparaître une valeur déjà en base.
      setSaisie(enregistree.current);
      setEtat("repos");
      setMessageErreur(null);
      return;
    }
    if (e.key === "Tab") {
      // Tab déplace le focus nativement, ce qui déclenche onBlur : la sauvegarde part de là.
      return;
    }
    const fleches: Record<string, "haut" | "bas" | "gauche" | "droite"> = {
      ArrowUp: "haut", ArrowDown: "bas",
    };
    if (fleches[e.key] && onNavigate) {
      e.preventDefault();
      sauvegarder(saisie).then((ok) => { if (ok) onNavigate(fleches[e.key]); });
    }
  }

  const bordure = etat === "erreur" ? "#C2410C" : etat === "ok" ? "#0E9F6E" : "#C9CAC0";

  return (
    <span style={{ position: "relative", display: "inline-block" }}>
      <input
        ref={inputRef}
        data-cellule={`${ligne}-${colonne}`}
        value={saisie}
        disabled={disabled}
        onChange={(e) => { setSaisie(e.target.value); if (etat !== "encours") setEtat("repos"); }}
        onBlur={() => sauvegarder(saisie)}
        onKeyDown={handleKeyDown}
        title={messageErreur || undefined}
        style={{
          width: 52, border: `1px solid ${bordure}`, borderRadius: 4, padding: "3px 4px",
          fontSize: 12.5, textAlign: "center",
          background: etat === "erreur" ? "#FEF3EC" : "#fff",
        }}
      />
      {etat === "encours" && (
        <span style={{ position: "absolute", right: -9, top: 2, fontSize: 9, color: "#9A9A90" }} title="Enregistrement…">●</span>
      )}
      {etat === "erreur" && (
        <span style={{ position: "absolute", right: -9, top: 1, fontSize: 11, color: "#C2410C" }} title={messageErreur || "Erreur"}>!</span>
      )}
    </span>
  );
}
