from __future__ import annotations

import json
import re
import zipfile
from datetime import datetime
from pathlib import Path
from xml.etree import ElementTree as ET
from html import escape


ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "livrables_word_mis_en_forme"
FORMATION = ROOT / "docs" / "formation_aolink" / "Formation_AO_Link.docx"
EXTERNAL_ANNEXES = Path(r"C:\Users\alban\Documents\À transférer\ECOTEC\Mémoire d'entreprise\Annexes")
OUT_DOCX = OUT_DIR / "Annexe_complete_AO_Link.docx"
MANIFEST = OUT_DIR / "manifest_annexe_complete.json"

LIVRABLES = [
    OUT_DIR / "Livrable_01_Application_web_operationnelle.docx",
    OUT_DIR / "Livrable_02_Documentation_technique.docx",
    OUT_DIR / "Livrable_03_Documentation_de_securite.docx",
    OUT_DIR / "Livrable_04_Scripts_et_fichiers_de_deploiement.docx",
    OUT_DIR / "Livrable_05_Cahier_de_tests_et_resultats.docx",
    OUT_DIR / "Livrable_06_Maintenance_et_exploitation.docx",
    OUT_DIR / "Livrable_07_Annexes_et_documents_de_reference.docx",
]

NS = {
    "w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    "pkg": "http://schemas.openxmlformats.org/package/2006/relationships",
    "x": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
}


def xml_escape(value: str) -> str:
    return escape(str(value), quote=True).replace("'", "&apos;")


def p(text: str = "", style: str | None = None) -> str:
    style_xml = f'<w:pPr><w:pStyle w:val="{style}"/></w:pPr>' if style else ""
    return f"<w:p>{style_xml}<w:r><w:t>{xml_escape(text)}</w:t></w:r></w:p>"


def bullet(text: str) -> str:
    return (
        '<w:p><w:pPr><w:pStyle w:val="ListParagraph"/>'
        '<w:ind w:left="360" w:hanging="360"/></w:pPr>'
        f"<w:r><w:t>{xml_escape('- ' + text)}</w:t></w:r></w:p>"
    )


def page_break() -> str:
    return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>'


def alt_chunk(rid: str) -> str:
    return f'<w:altChunk r:id="{rid}"/>'


def table_cell(text: str, header: bool = False) -> str:
    shading = '<w:shd w:fill="D9EAF7"/>' if header else ""
    bold = "<w:rPr><w:b/></w:rPr>" if header else ""
    return (
        "<w:tc>"
        f'<w:tcPr><w:tcW w:w="2200" w:type="dxa"/>{shading}</w:tcPr>'
        f"<w:p><w:r>{bold}<w:t>{xml_escape(text)}</w:t></w:r></w:p>"
        "</w:tc>"
    )


def table(rows: list[list[str]]) -> str:
    if not rows:
        return ""
    column_count = max(len(row) for row in rows)
    normalized = [row + [""] * (column_count - len(row)) for row in rows]
    grid = "".join('<w:gridCol w:w="2200"/>' for _ in range(column_count))
    body = []
    for row_index, row in enumerate(normalized):
        cells = "".join(table_cell(cell, header=row_index == 0) for cell in row)
        body.append(f"<w:tr>{cells}</w:tr>")
    return (
        "<w:tbl><w:tblPr>"
        '<w:tblStyle w:val="TableGrid"/><w:tblW w:w="0" w:type="auto"/>'
        "<w:tblBorders>"
        '<w:top w:val="single" w:sz="4" w:color="BFBFBF"/>'
        '<w:left w:val="single" w:sz="4" w:color="BFBFBF"/>'
        '<w:bottom w:val="single" w:sz="4" w:color="BFBFBF"/>'
        '<w:right w:val="single" w:sz="4" w:color="BFBFBF"/>'
        '<w:insideH w:val="single" w:sz="4" w:color="D9D9D9"/>'
        '<w:insideV w:val="single" w:sz="4" w:color="D9D9D9"/>'
        "</w:tblBorders></w:tblPr>"
        f"<w:tblGrid>{grid}</w:tblGrid>{''.join(body)}</w:tbl>"
    )


def styles_xml() -> str:
    return """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="21"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:rPr><w:b/><w:sz w:val="40"/><w:color w:val="17324D"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:rPr><w:b/><w:sz w:val="30"/><w:color w:val="17324D"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:rPr><w:b/><w:sz w:val="24"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="360"/></w:pPr></w:style>
  <w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:color="BFBFBF"/><w:left w:val="single" w:sz="4" w:color="BFBFBF"/><w:bottom w:val="single" w:sz="4" w:color="BFBFBF"/><w:right w:val="single" w:sz="4" w:color="BFBFBF"/><w:insideH w:val="single" w:sz="4" w:color="D9D9D9"/><w:insideV w:val="single" w:sz="4" w:color="D9D9D9"/></w:tblBorders></w:tblPr></w:style>
</w:styles>"""


def document_xml(body: list[str]) -> str:
    return f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="{NS['w']}" xmlns:r="{NS['r']}">
  <w:body>
    {''.join(body)}
    <w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>
  </w:body>
</w:document>"""


def rel_path(path: Path) -> str:
    try:
        return path.relative_to(ROOT).as_posix()
    except ValueError:
        return str(path)


def chunk_title(path: Path) -> str:
    return path.stem.replace("_", " ").replace("-", " ").strip()


def shared_strings(xlsx: zipfile.ZipFile) -> list[str]:
    try:
        root = ET.fromstring(xlsx.read("xl/sharedStrings.xml"))
    except KeyError:
        return []
    strings = []
    for item in root.findall("x:si", NS):
        parts = [node.text or "" for node in item.findall(".//x:t", NS)]
        strings.append("".join(parts))
    return strings


def workbook_sheets(xlsx: zipfile.ZipFile) -> list[tuple[str, str]]:
    workbook = ET.fromstring(xlsx.read("xl/workbook.xml"))
    rels = ET.fromstring(xlsx.read("xl/_rels/workbook.xml.rels"))
    rel_map = {
        rel.attrib["Id"]: rel.attrib["Target"]
        for rel in rels
    }
    sheets = []
    for sheet in workbook.findall("x:sheets/x:sheet", NS):
        name = sheet.attrib.get("name", "Feuille")
        rid = sheet.attrib.get(f"{{{NS['r']}}}id")
        target = rel_map.get(rid, "")
        if target:
            target = target.replace("../", "")
            if not target.startswith("xl/"):
                target = "xl/" + target
            sheets.append((name, target))
    return sheets


def cell_column_index(référence: str) -> int:
    letters = re.match(r"([A-Z]+)", référence or "")
    if not letters:
        return 0
    value = 0
    for char in letters.group(1):
        value = value * 26 + (ord(char) - ord("A") + 1)
    return value - 1


def cell_value(cell: ET.Element, strings: list[str]) -> str:
    kind = cell.attrib.get("t")
    value = cell.find("x:v", NS)
    if kind == "s" and value is not None:
        index = int(value.text or 0)
        return strings[index] if index < len(strings) else ""
    if kind == "inlineStr":
        parts = [node.text or "" for node in cell.findall(".//x:t", NS)]
        return "".join(parts)
    return value.text if value is not None and value.text is not None else ""


def xlsx_to_body(path: Path) -> list[str]:
    body = [p(f"Planning Excel - {path.name}", "Heading1"), p(f"Source : {rel_path(path)}")]
    with zipfile.ZipFile(path) as xlsx:
        strings = shared_strings(xlsx)
        for sheet_name, target in workbook_sheets(xlsx):
            root = ET.fromstring(xlsx.read(target))
            rows = []
            for row in root.findall("x:sheetData/x:row", NS):
                values: list[str] = []
                for cell in row.findall("x:c", NS):
                    index = cell_column_index(cell.attrib.get("r", ""))
                    while len(values) <= index:
                        values.append("")
                    values[index] = cell_value(cell, strings).strip()
                while values and values[-1] == "":
                    values.pop()
                if any(values):
                    rows.append(values[:8])
            if not rows:
                continue
            body.append(p(f"Feuille : {sheet_name}", "Heading2"))
            body.append(table(rows))
            body.append(p(""))
    return body


def collect_documents() -> tuple[list[dict], list[dict]]:
    doc_chunks = []
    excel_docs = []

    for path in LIVRABLES:
        if path.exists():
            doc_chunks.append({"group": "Livrables Word mis en forme", "path": path})

    if FORMATION.exists():
        doc_chunks.append({"group": "Formation utilisateur", "path": FORMATION})

    if EXTERNAL_ANNEXES.exists():
        for path in sorted(EXTERNAL_ANNEXES.iterdir(), key=lambda item: item.name.lower()):
            if path.suffix.lower() == ".docx":
                doc_chunks.append({"group": "Annexes externes", "path": path})
            elif path.suffix.lower() == ".xlsx":
                excel_docs.append({"group": "Annexes externes", "path": path})

    return doc_chunks, excel_docs


def write_docx(doc_chunks: list[dict], excel_docs: list[dict]) -> None:
    body = [
        p("Annexe complete AO Link", "Title"),
        p("Livrables, formation utilisateur et annexes du memoire d'entreprise."),
        p(f"Document généré le {datetime.now().strftime('%d/%m/%Y')}."),
        p(""),
        p("Documents inclus", "Heading1"),
    ]

    manifest_items = []
    for index, item in enumerate([*doc_chunks, *excel_docs], start=1):
        path = item["path"]
        body.append(bullet(f"{index:02d}. {item['group']} - {path.name}"))
        manifest_items.append({"index": index, "group": item["group"], "path": rel_path(path)})

    relationships = ['<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>']
    content_overrides = [
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>',
        '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>',
    ]
    chunk_entries: list[tuple[Path, str]] = []

    for index, item in enumerate(doc_chunks, start=1):
        path = item["path"]
        rid = f"rIdChunk{index:03d}"
        target = f"afchunk/chunk_{index:03d}.docx"
        body.extend(
            [
                page_break(),
                p(f"Annexe {index:02d} - {chunk_title(path)}", "Heading1"),
                p(f"Source : {rel_path(path)}"),
                alt_chunk(rid),
            ]
        )
        relationships.append(
            f'<Relationship Id="{rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/aFChunk" Target="{target}"/>'
        )
        content_overrides.append(
            f'<Override PartName="/word/{target}" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
        )
        chunk_entries.append((path, f"word/{target}"))

    excel_offset = len(doc_chunks)
    for index, item in enumerate(excel_docs, start=1):
        path = item["path"]
        body.append(page_break())
        body.append(p(f"Annexe {excel_offset + index:02d} - {chunk_title(path)}", "Heading1"))
        body.extend(xlsx_to_body(path))

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(OUT_DOCX, "w", compression=zipfile.ZIP_DEFLATED) as docx:
        docx.writestr(
            "[Content_Types].xml",
            f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  {''.join(content_overrides)}
</Types>""",
        )
        docx.writestr(
            "_rels/.rels",
            """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>""",
        )
        docx.writestr("word/document.xml", document_xml(body))
        docx.writestr("word/styles.xml", styles_xml())
        docx.writestr(
            "word/_rels/document.xml.rels",
            f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  {''.join(relationships)}
</Relationships>""",
        )
        for source, target in chunk_entries:
            docx.writestr(target, source.read_bytes())

    MANIFEST.write_text(json.dumps(manifest_items, ensure_ascii=False, indent=2), encoding="utf-8")


def main() -> None:
    doc_chunks, excel_docs = collect_documents()
    write_docx(doc_chunks, excel_docs)
    print(f"Document annexe généré : {OUT_DOCX}")
    print(f"Documents Word integres : {len(doc_chunks)}")
    print(f"Documents Excel convertis : {len(excel_docs)}")


if __name__ == "__main__":
    main()
