// Installe window.api AVANT tout autre module : certains écrans lisent window.api dès leur
// chargement (comme le permettait le preload d'Electron). Ce fichier doit rester le PREMIER
// import de main.tsx.
import { construireApi } from "./client";

(window as any).api = construireApi();
