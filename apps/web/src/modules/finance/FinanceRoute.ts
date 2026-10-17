// Une seule pile de navigation pour tout le module Finance — pas de panneau ni de pop-up : chaque
// écran est une "page" pleine largeur, empilée dans un fil d'Ariane cliquable.
export type FinanceRoute =
  | { kind: "apercu" }
  | { kind: "fournisseurs" }
  | { kind: "fournisseur"; id: number; nom: string }
  | { kind: "fournisseur-form"; id: number; nom: string; form: "prix" | "achat" | "facture" | "paiement" }
  | { kind: "fournisseur-nouveau" }
  | { kind: "achats" }
  | { kind: "achats-nouveau" }
  | { kind: "achat"; id: number; retour: FinanceRoute }
  | { kind: "couts-produits" }
  | { kind: "estimation"; articleId: number; nom: string }
  | { kind: "echeances-paiements" }
  | { kind: "nouveau-paiement-global" };

export function labelRoute(r: FinanceRoute): string {
  switch (r.kind) {
    case "apercu": return "Vue d'ensemble";
    case "fournisseurs": return "Fournisseurs";
    case "fournisseur": return r.nom;
    case "fournisseur-form": return r.form === "prix" ? "Nouveau prix d'achat" : r.form === "achat" ? "Nouvel achat" : r.form === "facture" ? "Nouvelle facture" : "Nouveau paiement";
    case "fournisseur-nouveau": return "Nouveau fournisseur";
    case "achats": return "Achats & factures";
    case "achats-nouveau": return "Nouvel achat";
    case "achat": return "Détail achat";
    case "couts-produits": return "Coûts produits";
    case "estimation": return r.nom;
    case "echeances-paiements": return "Échéances & paiements";
    case "nouveau-paiement-global": return "Nouveau paiement / avance";
  }
}

// Fil d'Ariane complet jusqu'à la route actuelle — chaque maillon connaît la route vers laquelle
// cliquer dessus doit ramener.
export function filAriane(r: FinanceRoute): { label: string; route: FinanceRoute }[] {
  const fil: { label: string; route: FinanceRoute }[] = [{ label: "Finance", route: { kind: "apercu" } }];
  switch (r.kind) {
    case "apercu":
      break;
    case "fournisseurs":
      fil.push({ label: "Fournisseurs", route: r });
      break;
    case "fournisseur-nouveau":
      fil.push({ label: "Fournisseurs", route: { kind: "fournisseurs" } });
      fil.push({ label: "Nouveau fournisseur", route: r });
      break;
    case "fournisseur":
      fil.push({ label: "Fournisseurs", route: { kind: "fournisseurs" } });
      fil.push({ label: r.nom, route: r });
      break;
    case "fournisseur-form":
      fil.push({ label: "Fournisseurs", route: { kind: "fournisseurs" } });
      fil.push({ label: r.nom, route: { kind: "fournisseur", id: r.id, nom: r.nom } });
      fil.push({ label: labelRoute(r), route: r });
      break;
    case "achats":
      fil.push({ label: "Achats & factures", route: r });
      break;
    case "achats-nouveau":
      fil.push({ label: "Achats & factures", route: { kind: "achats" } });
      fil.push({ label: "Nouvel achat", route: r });
      break;
    case "achat":
      fil.push(...filAriane(r.retour).slice(1));
      fil.push({ label: "Détail achat", route: r });
      break;
    case "couts-produits":
      fil.push({ label: "Coûts produits", route: r });
      break;
    case "estimation":
      fil.push({ label: "Coûts produits", route: { kind: "couts-produits" } });
      fil.push({ label: r.nom, route: r });
      break;
    case "echeances-paiements":
      fil.push({ label: "Échéances & paiements", route: r });
      break;
    case "nouveau-paiement-global":
      fil.push({ label: "Échéances & paiements", route: { kind: "echeances-paiements" } });
      fil.push({ label: "Nouveau paiement / avance", route: r });
      break;
  }
  return fil;
}
