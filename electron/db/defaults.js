// --- Configuration STRUCTURELLE : toujours présente, même sur une installation totalement
//     vierge. Ce sont des réglages génériques utiles à n'importe quel atelier (un flux de
//     production, des tailles standard, des codes saison/rayon), pas des données d'exemple. ---

const ETAPES = [
  { cle: "preparation", libelle: "Préparation", pourcentage: 5, ordre: 1, optionnelle: 0 },
  { cle: "coupe", libelle: "Coupe", pourcentage: 20, ordre: 2, optionnelle: 0 },
  { cle: "broderie_impression", libelle: "Broderie ou impression", pourcentage: 35, ordre: 3, optionnelle: 1 },
  { cle: "confection", libelle: "Confection", pourcentage: 60, ordre: 4, optionnelle: 0 },
  { cle: "finition", libelle: "Finition", pourcentage: 80, ordre: 5, optionnelle: 0 },
  { cle: "controle_qualite", libelle: "Contrôle qualité", pourcentage: 90, ordre: 6, optionnelle: 0 },
  { cle: "emballage", libelle: "Emballage", pourcentage: 97, ordre: 7, optionnelle: 0 },
  { cle: "terminee", libelle: "Terminée", pourcentage: 100, ordre: 8, optionnelle: 0 },
];

const TAILLES = ["S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL", "6XL", "7XL"];

// { nom, code } : le code est utilisé tel quel (en majuscules) dans le générateur de référence.
const SAISONS = [
  { nom: "Printemps–Été", code: "SS" },
  { nom: "Automne–Hiver", code: "FW" },
  { nom: "Été", code: "SU" },
  { nom: "Hiver", code: "WI" },
  { nom: "Toute saison", code: "AS" },
];

const RAYONS = [
  { nom: "Homme", code: "M" },
  { nom: "Femme", code: "W" },
  { nom: "Enfant", code: "K" },
  { nom: "Unisexe", code: "U" },
];

// --- Données de DÉMONSTRATION : jamais chargées automatiquement. Une installation vierge n'a
//     ni produit, ni couleur, ni responsable, ni atelier, ni opérateur, ni article, ni commande
//     tant que l'utilisateur n'a pas explicitement cliqué sur "Charger des données de
//     démonstration" (voir electron/db/demoData.js). ---

const DEMO_PRODUITS = ["T-shirt Essentiel", "Robe Aya", "Veste Denim", "Chemise Lin", "Pantalon Nara", "Blouse Soie"];
const DEMO_COULEURS = ["Blanc", "Noir", "Ecru", "Terracotta", "Bleu indigo", "Kaki"];
const DEMO_RESPONSABLES = ["Sami", "Nour", "Amine", "Hela", "Youssef"];
const DEMO_ATELIERS = ["Atelier interne Belvie", "Atelier Mme Ibtissem", "Atelier externe X"];
// Distincts des Responsables (l'Opérateur = qui utilise le logiciel, pas qui pilote la commande).
const DEMO_OPERATEURS = ["Amal", "Karim"];

module.exports = {
  ETAPES, TAILLES, SAISONS, RAYONS,
  DEMO_PRODUITS, DEMO_COULEURS, DEMO_RESPONSABLES, DEMO_ATELIERS, DEMO_OPERATEURS,
};
