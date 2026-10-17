/**
 * Champs de saisie partagés par les onglets Matières et Fournitures de la fiche technique.
 *
 * Ces composants étaient dupliqués à l'identique dans FTMatieresTab et FTAccessoiresTab. Les
 * extraire ici garantit que les deux onglets parlent le MÊME langage visuel, et qu'un ajustement
 * de lisibilité n'a plus à être fait deux fois.
 *
 * PÉRIMÈTRE VISUEL : seuls FTMatieresTab et FTFournituresTab importent ce module. Les autres
 * onglets (Infos, Croquis, Mesures, Aperçu) ont leurs propres styles et ne sont pas touchés.
 *
 * Couleurs volontairement EN DUR ici, jamais dans les variables globales --v2-* : modifier une
 * variable globale changerait l'apparence de tout l'ERP. Les anciennes valeurs (#9A9A90 pour les
 * labels, #D8D9D0 pour les bordures) donnaient un rendu délavé, peu lisible pour un document
 * technique consulté en atelier.
 */

/** Gris anthracite : contraste nettement supérieur à l'ancien #9A9A90, sans virer au noir pur. */
export const FT_LABEL_COLOR = "#55564E";
/** Bordure de champ un peu plus marquée que l'ancien #D8D9D0, le fond restant blanc. */
export const FT_BORDER_COLOR = "#C9CAC0";
/** Texte secondaire (résumés, unités, mentions) : lisible sans concurrencer le contenu. */
export const FT_TEXT_SECONDARY = "#6B6B62";

export const ftInputStyle: React.CSSProperties = {
  width: "100%",
  border: `1px solid ${FT_BORDER_COLOR}`,
  borderRadius: 6,
  padding: "5px 7px",
  fontSize: 12.5,
};

/** Label de champ. Hiérarchie DÉLIBÉRÉMENT basse : lisible (anthracite, semi-bold), mais il ne
 *  doit jamais concurrencer un titre de section. C'est le titre qui structure la page, pas
 *  l'intitulé d'un champ. */
export function FieldLabel({ children }: { children: any }) {
  return (
    <div
      style={{
        fontSize: 9.5,
        textTransform: "uppercase",
        letterSpacing: ".03em",
        color: FT_LABEL_COLOR,
        fontWeight: 600,
        marginBottom: 3,
      }}
    >
      {children}
    </div>
  );
}

/** Titre de section (Habillage & Branding, Composants de confection). Niveau visuel dominant de
 *  l'onglet : c'est lui qu'on doit voir en parcourant la page rapidement. */
export function SectionTitle({ titre, sous }: { titre: string; sous?: string }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 16, fontWeight: 700, color: "#17181A", letterSpacing: "-.01em" }}>
        {titre}
      </div>
      {sous && (
        <div style={{ fontSize: 12, color: FT_TEXT_SECONDARY, marginTop: 2 }}>{sous}</div>
      )}
    </div>
  );
}

export function FTField({ label, value, disabled, onSave, multiline, placeholder, listId }: {
  label: string;
  value: string | null;
  disabled: boolean;
  onSave: (v: string) => void;
  multiline?: boolean;
  placeholder?: string;
  /** id d'un <datalist> pour proposer des suggestions sans jamais contraindre la saisie. */
  listId?: string;
}) {
  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      {multiline ? (
        <textarea
          rows={2}
          defaultValue={value ?? ""}
          disabled={disabled}
          placeholder={placeholder}
          onBlur={(e) => onSave(e.target.value)}
          style={{ ...ftInputStyle, fontFamily: "inherit" }}
        />
      ) : (
        <input
          type="text"
          defaultValue={value ?? ""}
          disabled={disabled}
          placeholder={placeholder}
          list={listId}
          onBlur={(e) => onSave(e.target.value)}
          style={ftInputStyle}
        />
      )}
    </div>
  );
}

/** Popover flottant ancré sur un bouton « + ». En position absolute : n'décale jamais la ligne
 *  sous laquelle il s'ouvre et ne crée jamais de seconde ligne de saisie. */
export function Popover({ titre, onFermer, large, children }: {
  titre: string; onFermer: () => void; large?: boolean; children: any;
}) {
  return (
    <div
      style={{
        position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 30,
        width: large ? 360 : 240, background: "#fff", border: `1px solid ${FT_BORDER_COLOR}`,
        borderRadius: 8, boxShadow: "0 4px 16px rgba(0,0,0,.12)", padding: 10,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <strong style={{ fontSize: 12.5 }}>{titre}</strong>
        <button className="btn ghost tiny" onClick={onFermer} title="Fermer">✕</button>
      </div>
      {children}
    </div>
  );
}
