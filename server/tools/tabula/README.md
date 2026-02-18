# Tabula setup

This folder is used for the Tabula jar required to convert PDF tables to Excel.

## Steps
1) Download the Tabula jar:
   https://github.com/tabulapdf/tabula-java/releases
2) Rename it to `tabula.jar` (optional, but recommended).
3) Place it in this folder:
   server/tools/tabula/tabula.jar

## Alternate path
You can set the environment variable `TABULA_JAR_PATH` to point to the jar
if you prefer to keep it outside the repo.

Example (PowerShell):
$env:TABULA_JAR_PATH = "C:\\path\\to\\tabula.jar"

## Java requirement
Tabula requires Java (JRE or JDK) to be installed and available in PATH.
