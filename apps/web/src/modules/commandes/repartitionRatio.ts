// Répartition d'une quantité totale selon un ratio de tailles.
//
// Méthode retenue : le plus fort reste. Chaque taille reçoit d'abord la partie entière
// de son quota théorique, puis les pièces restantes sont attribuées une à une aux tailles
// dont la décimale est la plus forte. Conséquence garantie par construction :
//
//   somme des quantités calculées === quantité totale demandée, TOUJOURS.
//
// Aucune pièce n'est perdue ni inventée, quel que soit le ratio et quel que soit le total.
// En cas d'égalité parfaite entre deux décimales, c'est l'ordre de la grille qui tranche
// (la taille la plus petite est servie en premier) — jamais un tirage arbitraire, pour que
// deux calculs identiques donnent toujours exactement le même résultat.
//
// Ce module est volontairement pur : aucun accès à la base, aucun état React, aucun effet
// de bord. Il peut donc être vérifié isolément, et c'est ce qui permet de garantir la règle
// du total exact indépendamment de l'interface.

export interface PoidsTaille {
  taille_id: number;
  /** Poids du ratio pour cette taille. 0 = taille servie à 0 pièce. */
  poids: number;
}

export interface LigneRepartition {
  taille_id: number;
  quantite: number;
}

/** Somme des poids strictement positifs — les poids nuls ou invalides sont ignorés. */
export function sommePoids(poids: PoidsTaille[]): number {
  return poids.reduce((somme, p) => somme + (Number.isFinite(p.poids) && p.poids > 0 ? p.poids : 0), 0);
}

/**
 * Calcule la répartition d'un total entier selon des poids par taille.
 * Lève une erreur explicite plutôt que de produire un résultat approximatif.
 */
export function repartirParRatio(total: number, poids: PoidsTaille[]): LigneRepartition[] {
  if (!Number.isFinite(total) || !Number.isInteger(total) || total < 0) {
    throw new Error("La quantité totale doit être un nombre entier positif ou nul.");
  }
  if (poids.some((p) => Number.isFinite(p.poids) && p.poids < 0)) {
    throw new Error("Un poids de ratio ne peut pas être négatif.");
  }
  const somme = sommePoids(poids);
  if (!(somme > 0)) {
    throw new Error("Renseignez au moins un poids supérieur à 0 dans le ratio.");
  }

  // Quota théorique de chaque taille, décomposé en part entière + reste décimal.
  // L'epsilon absorbe les imprécisions du calcul flottant (ex. 0.3 * 3 = 0.8999...),
  // sans quoi une taille pourrait perdre une pièce au profit d'une autre à cause d'un
  // écart de 1e-16 sans aucune signification métier.
  const EPSILON = 1e-9;
  const calcul = poids.map((p, index) => {
    const w = Number.isFinite(p.poids) && p.poids > 0 ? p.poids : 0;
    const quota = (total * w) / somme;
    const part = Math.floor(quota + EPSILON);
    return { taille_id: p.taille_id, index, poids: w, part, reste: quota - part };
  });

  // Pièces restantes après distribution des parts entières : strictement inférieures au
  // nombre de tailles servies, par définition de la somme des décimales.
  const attribue = calcul.reduce((somme2, c) => somme2 + c.part, 0);
  const restant = total - attribue;

  if (restant > 0) {
    // Seules les tailles réellement présentes dans le ratio peuvent recevoir une pièce
    // supplémentaire : une taille à poids 0 doit rester à 0, jamais être servie par
    // effet de bord de l'arrondi.
    const servies = calcul.filter((c) => c.poids > 0);
    const ordre = [...servies].sort((a, b) => b.reste - a.reste || a.index - b.index);
    for (let i = 0; i < restant; i++) {
      ordre[i % ordre.length].part += 1;
    }
  }

  return calcul.map((c) => ({ taille_id: c.taille_id, quantite: c.part }));
}
