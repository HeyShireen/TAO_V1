$ErrorActionPreference = "Stop"

$Root = Resolve-Path "."
$LivrablesDir = Join-Path $Root "livrables_word_mis_en_forme"
$Formation = Join-Path $Root "docs\formation_aolink\Formation_AO_Link.docx"
$AAccent = [char]0x00C0
$EAccent = [char]0x00E9
$ExternalAnnexes = Join-Path $env:USERPROFILE ("Documents\" + $AAccent + " transf" + $EAccent + "rer\ECOTEC\M" + $EAccent + "moire d'entreprise\Annexes")
$OutWorkspace = Join-Path $LivrablesDir "Annexe_complete_AO_Link_fusionnee.docx"
$OutExternal = Join-Path $ExternalAnnexes "Annexe_complete_AO_Link_fusionnee.docx"

$livrables = @(
  "Livrable_01_Application_web_operationnelle.docx",
  "Livrable_02_Documentation_technique.docx",
  "Livrable_03_Documentation_de_securite.docx",
  "Livrable_04_Scripts_et_fichiers_de_deploiement.docx",
  "Livrable_05_Cahier_de_tests_et_resultats.docx",
  "Livrable_06_Maintenance_et_exploitation.docx",
  "Livrable_07_Annexes_et_documents_de_reference.docx"
) | ForEach-Object { Join-Path $LivrablesDir $_ } | Where-Object { Test-Path -LiteralPath $_ }

$externalDocx = Get-ChildItem -LiteralPath $ExternalAnnexes -File -Filter "*.docx" |
  Where-Object { $_.Name -notmatch "^Annexe_complete_AO_Link" } |
  Sort-Object Name |
  Select-Object -ExpandProperty FullName

$excelFiles = Get-ChildItem -LiteralPath $ExternalAnnexes -File -Filter "*.xlsx" |
  Sort-Object Name |
  Select-Object -ExpandProperty FullName

$word = New-Object -ComObject Word.Application
$word.Visible = $false
$word.DisplayAlerts = 0

$excel = $null

function Add-Paragraph {
  param([object]$Selection, [string]$Text, [string]$Style = "")
  if ($Style) {
    try { $Selection.Style = $Style } catch {}
  }
  $Selection.TypeText($Text)
  $Selection.TypeParagraph()
}

function Add-PageBreak {
  param([object]$Selection)
  $Selection.InsertBreak(7) | Out-Null
}

function Add-DocxSection {
  param([object]$Selection, [string]$Path, [int]$Index, [string]$Group)
  Write-Host ("Integration Word : " + $Path)
  Add-PageBreak $Selection
  Add-Paragraph $Selection ("Annexe {0:00} - {1}" -f $Index, [System.IO.Path]::GetFileNameWithoutExtension($Path)) "Titre 1"
  Add-Paragraph $Selection ("Groupe : " + $Group)
  Add-Paragraph $Selection ("Source : " + $Path)
  $sourceDoc = $word.Documents.Open($Path, $false, $true, $false, "", "", $false, "", "", 0, $false, $false, $true)
  try {
    $sourceDoc.Content.Copy() | Out-Null
    $Selection.PasteAndFormat(16) | Out-Null
  } finally {
    $sourceDoc.Close($false)
  }
  $Selection.EndKey(6) | Out-Null
}

function Add-ExcelSection {
  param([object]$Selection, [object]$ExcelApp, [string]$Path, [int]$Index)
  Add-PageBreak $Selection
  Add-Paragraph $Selection ("Annexe {0:00} - {1}" -f $Index, [System.IO.Path]::GetFileNameWithoutExtension($Path)) "Titre 1"
  Add-Paragraph $Selection ("Groupe : Annexes externes")
  Add-Paragraph $Selection ("Source : " + $Path)

  $workbook = $ExcelApp.Workbooks.Open($Path, 0, $true)
  try {
    foreach ($sheet in @($workbook.Worksheets)) {
      Add-Paragraph $Selection ("Feuille : " + $sheet.Name) "Titre 2"
      $range = $sheet.UsedRange
      if ($range -and $range.Rows.Count -gt 0 -and $range.Columns.Count -gt 0) {
        $range.Copy() | Out-Null
        $Selection.PasteExcelTable($false, $false, $false) | Out-Null
        $Selection.TypeParagraph()
      }
    }
  } finally {
    $workbook.Close($false)
  }
}

try {
  $doc = $word.Documents.Add()
  $selection = $word.Selection

  Add-Paragraph $selection "Annexe complète AO Link" "Titre"
  Add-Paragraph $selection "Livrables, formation utilisateur et annexes du mémoire d'entreprise."
  Add-Paragraph $selection ("Document fusionné généré le " + (Get-Date -Format "dd/MM/yyyy HH:mm"))
  Add-Paragraph $selection ""
  Add-Paragraph $selection "Documents inclus" "Titre 1"

  $allDocSections = @()
  foreach ($path in $livrables) { $allDocSections += [pscustomobject]@{ Group = "Livrables Word mis en forme"; Path = $path } }
  if (Test-Path -LiteralPath $Formation) { $allDocSections += [pscustomobject]@{ Group = "Formation utilisateur"; Path = $Formation } }
  foreach ($path in $externalDocx) { $allDocSections += [pscustomobject]@{ Group = "Annexes externes"; Path = $path } }

  $lineIndex = 1
  foreach ($item in $allDocSections) {
    Add-Paragraph $selection ("{0:00}. {1} - {2}" -f $lineIndex, $item.Group, [System.IO.Path]::GetFileName($item.Path))
    $lineIndex += 1
  }
  foreach ($path in $excelFiles) {
    Add-Paragraph $selection ("{0:00}. Annexes externes - {1}" -f $lineIndex, [System.IO.Path]::GetFileName($path))
    $lineIndex += 1
  }

  $sectionIndex = 1
  foreach ($item in $allDocSections) {
    Add-DocxSection $selection $item.Path $sectionIndex $item.Group
    $sectionIndex += 1
  }

  if ($excelFiles.Count -gt 0) {
    $excel = New-Object -ComObject Excel.Application
    $excel.Visible = $false
    $excel.DisplayAlerts = $false
    foreach ($path in $excelFiles) {
      Add-ExcelSection $selection $excel $path $sectionIndex
      $sectionIndex += 1
    }
  }

  if (Test-Path -LiteralPath $OutWorkspace) { Remove-Item -LiteralPath $OutWorkspace -Force }
  $doc.SaveAs2($OutWorkspace, 16)
  $doc.Close($false)

  Copy-Item -LiteralPath $OutWorkspace -Destination $OutExternal -Force
  Write-Host "Document fusionne genere : $OutWorkspace"
  Write-Host "Copie : $OutExternal"
} finally {
  if ($excel) {
    $excel.Quit()
    [System.Runtime.InteropServices.Marshal]::ReleaseComObject($excel) | Out-Null
  }
  if ($word) {
    $word.Quit()
    [System.Runtime.InteropServices.Marshal]::ReleaseComObject($word) | Out-Null
  }
}
