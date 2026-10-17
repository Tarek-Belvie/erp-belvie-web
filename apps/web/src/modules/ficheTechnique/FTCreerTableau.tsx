import { useEffect, useState } from "react";
import { ftInputStyle, FT_BORDER_COLOR, FT_TEXT_SECONDARY } from "./FTChamps";

/**
 * Création du tableau de mesures à partir des mesures SUGGÉRÉES pour le type d'article.
 *
 * Le modèle standard est ici une BIBLIOTHÈQUE, pas une structure imposée : les mesures sont
 * précochées, l'utilisateur décoche ce dont il n'a pas besoin, en ajoute au besoin, et seules
 * les lignes retenues sont créées.
 *
 * N'apparaît que si la fiche ne contient AUCUNE ligne : un tableau existant n'est jamais
 * régénéré ni écrasé.
 */

interface Suggestion {
  nom: string; repere: string | null; unite: string | null;
  tolerance_plus: string | null; tolerance_moins: string | null;
  suggeree: boolean; modele?: string;
}

interface Props {
  ficheId: number;
  onCree: () => void;
  onError: (msg: string) => void;
}

export default function FTCreerTableau({ ficheId, onCree, onError }: Props) {
  const [ouvert, setOuvert] = useState(false);
  const [typeProduit, setTypeProduit] = useState<string | null>(null);
  const [mesures, setMesures] = useState<Suggestion[]>([]);
  const [retenues, setRetenues] = useState<Set<string>>(new Set());
  const [ajout, setAjout] = useState("");
  const [enCours, setEnCours] = useState(false);

  useEffect(() => {
    if (!ouvert) return;
    window.api.ficheTechnique.mesuresSuggerees(ficheId)
      .then((d: any) => {
        setTypeProduit(d.type_produit);
        setMesures(d.mesures);
        // Les mesures du modèle sont précochées : c'est le point de départ le plus courant.
        setRetenues(new Set(d.mesures.filter((m: Suggestion) => m.suggeree).map((m: Suggestion) => m.nom)));
      })
      .catch((err: any) => onError(err?.message || "Chargement des suggestions impossible."));
  }, [ouvert, ficheId]);

  function basculer(nom: string) {
    setRetenues((prev) => {
      const n = new Set(prev);
      if (n.has(nom)) n.delete(nom); else n.add(nom);
      return n;
    });
  }

  function ajouterMesure() {
    const nom = ajout.trim();
    if (!nom) return;
    if (mesures.some((m) => m.nom.toLowerCase() === nom.toLowerCase())) {
      setRetenues((p) => new Set(p).add(mesures.find((m) => m.nom.toLowerCase() === nom.toLowerCase())!.nom));
    } else {
      setMesures((p) => [...p, { nom, repere: null, unite: null, tolerance_plus: null, tolerance_moins: null, suggeree: false }]);
      setRetenues((p) => new Set(p).add(nom));
    }
    setAjout("");
  }

  async function creer() {
    const choisies = mesures.filter((m) => retenues.has(m.nom));
    if (choisies.length === 0) { onError("Sélectionnez au moins une mesure."); return; }
    setEnCours(true);
    try {
      await window.api.ficheTechnique.creerTableauMesures(ficheId, choisies);
      setOuvert(false);
      onCree();
    } catch (err: any) {
      onError(err?.message || "Création impossible.");
    } finally {
      setEnCours(false);
    }
  }

  if (!ouvert) {
    return (
      <div style={{ padding: "18px 0" }}>
        <button className="btn primary" onClick={() => setOuvert(true)}>Créer le tableau de mesures</button>
        <p style={{ fontSize: 12.5, color: FT_TEXT_SECONDARY, marginTop: 6 }}>
          Les mesures habituelles du type d'article vous seront proposées — vous ne gardez que celles dont vous avez besoin.
        </p>
      </div>
    );
  }

  return (
    <div style={{ border: `1px solid ${FT_BORDER_COLOR}`, borderRadius: 10, padding: 14, marginBottom: 14, background: "#FAFBF7" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 10 }}>
        <strong style={{ fontSize: 14 }}>Mesures à inclure</strong>
        <span style={{ fontSize: 12, color: FT_TEXT_SECONDARY }}>
          {typeProduit ? `Suggestions pour « ${typeProduit} »` : "Aucun type d'article défini"}
        </span>
        <span style={{ marginLeft: "auto", fontSize: 12, color: FT_TEXT_SECONDARY }}>
          {retenues.size} sélectionnée{retenues.size > 1 ? "s" : ""}
        </span>
      </div>

      {mesures.length === 0 ? (
        // Un type sans modele n'est pas une anomalie : Survetement, par exemple, est un ensemble
        // haut + bas qu'aucun tableau unique ne decrit. Le message nomme le type pour que la
        // cause soit immediate, au lieu du « Aucune mesure suggeree » anonyme d'avant.
        <p style={{ fontSize: 12.5, color: FT_TEXT_SECONDARY, margin: "0 0 10px" }}>
          {typeProduit
            ? <>Aucune configuration de mesures définie pour le type <strong>« {typeProduit} »</strong>. Ajoutez les mesures nécessaires ci-dessous.</>
            : <>Aucun type d'article n'est défini sur cet article : renseignez-le depuis Articles pour bénéficier des mesures suggérées.</>}
        </p>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", gap: 4, marginBottom: 10 }}>
          {mesures.map((m) => (
            <label key={m.nom} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, cursor: "pointer", padding: "2px 0" }}>
              <input type="checkbox" checked={retenues.has(m.nom)} onChange={() => basculer(m.nom)} />
              <span>{m.nom}</span>
              {!m.suggeree && <span style={{ fontSize: 11, color: FT_TEXT_SECONDARY }}>(ajoutée)</span>}
            </label>
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 12 }}>
        <input
          type="text" value={ajout} placeholder="Ajouter une autre mesure…"
          onChange={(e) => setAjout(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); ajouterMesure(); } }}
          style={{ ...ftInputStyle, width: 260 }}
        />
        <button className="btn ghost tiny" onClick={ajouterMesure}>Ajouter</button>
        <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          <button className="btn ghost" onClick={() => setOuvert(false)} disabled={enCours}>Annuler</button>
          <button className="btn primary" onClick={creer} disabled={enCours || retenues.size === 0}>
            {enCours ? "Création…" : "Créer le tableau"}
          </button>
        </div>
      </div>

      <p style={{ fontSize: 11.5, color: FT_TEXT_SECONDARY, margin: 0 }}>
        Une fois créé, le tableau reste entièrement modifiable : renommer, repère, ajouter, supprimer, réordonner.
      </p>
    </div>
  );
}
