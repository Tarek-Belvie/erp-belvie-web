import { Entreprise } from "./types";

export interface EntrepriseRequirementResult {
  ok: boolean;
  missingLabels: string[];
}

function hasText(v: string | null | undefined): boolean {
  return !!v && v.trim() !== "";
}

// Profil général : le seul utilisé aujourd'hui (badge dans Paramètres). Nom commercial OU
// raison sociale, adresse, et au moins un moyen de contact.
export function checkProfilGeneral(e: Entreprise | null): EntrepriseRequirementResult {
  const missing: string[] = [];
  if (!hasText(e?.nom_commercial) && !hasText(e?.raison_sociale)) missing.push("Nom commercial ou raison sociale");
  if (!hasText(e?.adresse)) missing.push("Adresse");
  if (!hasText(e?.telephone) && !hasText(e?.email)) missing.push("Téléphone ou e-mail");
  return { ok: missing.length === 0, missingLabels: missing };
}

// --- Ci-dessous : prêt à être complété quand chaque module de document existera réellement.
// Chacun part du profil général et ajoute ses propres exigences, sans jamais dépendre d'une
// seule fonction fourre-tout partagée par tous les documents.

export function checkPretPourBonCommandePF(e: Entreprise | null): EntrepriseRequirementResult {
  return checkProfilGeneral(e);
}

export function checkPretPourBonCommandeMP(e: Entreprise | null): EntrepriseRequirementResult {
  return checkProfilGeneral(e);
}

export function checkPretPourFacture(e: Entreprise | null): EntrepriseRequirementResult {
  const base = checkProfilGeneral(e);
  const missing = [...base.missingLabels];
  if (!hasText(e?.matricule_fiscal)) missing.push("Matricule fiscal");
  if (!hasText(e?.rib)) missing.push("RIB");
  return { ok: missing.length === 0, missingLabels: missing };
}

export function checkPretPourBonLivraison(e: Entreprise | null): EntrepriseRequirementResult {
  return checkProfilGeneral(e);
}
