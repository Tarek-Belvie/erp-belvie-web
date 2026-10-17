// ============================================================================
// Détection de plateforme — capturée UNE SEULE FOIS, avant que quoi que ce
// soit (y compris ce module) n'ait pu installer un window.api de
// remplacement. Importé en tout premier dans main.tsx.
//
// window.api.system n'existe QUE dans le vrai preload.js Electron — jamais
// dans le shim web (voir webApiShim.ts, qui ne couvre que les 7 namespaces
// migrés). C'est un marqueur fiable, jamais ambigu.
// ============================================================================

export const ESTELECTRON =
  typeof window !== "undefined" &&
  typeof (window as any).api !== "undefined" &&
  typeof (window as any).api.system !== "undefined";
