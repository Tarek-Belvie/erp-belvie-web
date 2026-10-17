# ===========================================================================
# COMPTAGE DES FICHIERS PHYSIQUES — LECTURE SEULE
# Aucune écriture, aucune suppression, aucun upload.
# PowerShell, à exécuter sur le poste Windows.
# ===========================================================================

# Dossier de données Electron (app.getPath("userData")).
# Ajuster si le nom du produit diffère.
$userData = Join-Path $env:APPDATA "Belvie ERP"

Write-Host "Dossier de donnees : $userData"
Write-Host ""

$images = Join-Path $userData "images\commandes"
$thumbs = Join-Path $images "thumbs"

foreach ($d in @($images, $thumbs)) {
  if (Test-Path $d) {
    $f = Get-ChildItem -Path $d -File -ErrorAction SilentlyContinue
    $taille = if ($f) { [math]::Round(($f | Measure-Object Length -Sum).Sum / 1MB, 2) } else { 0 }
    Write-Host ("{0,-52} {1,4} fichier(s)  {2,8} Mo" -f $d, $f.Count, $taille)
  } else {
    Write-Host ("{0,-52} ABSENT" -f $d)
  }
}

Write-Host ""
Write-Host "--- Detail des originaux (hors miniatures) ---"
if (Test-Path $images) {
  Get-ChildItem -Path $images -File | Select-Object Name, @{N='Ko';E={[math]::Round($_.Length/1KB,1)}}, LastWriteTime |
    Format-Table -AutoSize
}

Write-Host "--- Detail des miniatures ---"
if (Test-Path $thumbs) {
  Get-ChildItem -Path $thumbs -File | Select-Object Name, @{N='Ko';E={[math]::Round($_.Length/1KB,1)}} |
    Format-Table -AutoSize
}

Write-Host ""
Write-Host "Comparez le nombre d'originaux aux 19 lignes article_photos."
Write-Host "Le dossier peut contenir DAVANTAGE de fichiers : photos de planning,"
Write-Host "logo entreprise et snapshots de BC PF y cohabitent (voir requete A5)."
