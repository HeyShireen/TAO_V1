from __future__ import annotations

import json
import re
import unicodedata
import zipfile
from datetime import datetime
from html import escape
from pathlib import Path


ROOT = Path.cwd()
DOCS_DIR = ROOT / "docs"
OUT_DIR = ROOT / "annexes_word_mis_en_forme"
TEMPLATE_DOCX = Path(
    r"c:\Users\alban\Documents\À transférer\ECOTEC\Mémoire d'entreprise\Projet d'entreprise Alban Michaud AO-link_V6.docx"
)
INCLUDED_EXTENSIONS = {".md", ".txt", ".sh"}
SCHEMA_ASSETS = {
    "schema_donnees": {
        "path": ROOT / "assets" / "schemas" / "schema_donnees_aolink.png",
        "target": "media/schema_donnees_aolink.png",
        "rid": "rIdSchemaDonnees",
        "caption": "Figure - Schema de donnees AO Link",
    },
    "schema_navigation": {
        "path": ROOT / "assets" / "schemas" / "schema_navigation_aolink.png",
        "target": "media/schema_navigation_aolink.png",
        "rid": "rIdSchemaNavigation",
        "caption": "Figure - Parcours utilisateur AO Link",
    },
    "schema_cycle": {
        "path": ROOT / "assets" / "schemas" / "schema_cycle_utilisation_aolink.png",
        "target": "media/schema_cycle_utilisation_aolink.png",
        "rid": "rIdSchemaCycle",
        "caption": "Figure - Cycle d'utilisation AO Link",
    },
}

STYLE_ALIASES = {
    "Heading1": "Titre1",
    "Heading2": "Titre2",
    "Heading3": "Titre3",
    "ListParagraph": "Paragraphedeliste",
    "TableGrid": "Grilledutableau",
}


def xml_escape(value: str) -> str:
    return escape(str(value), quote=True).replace("'", "&apos;")


def rel(path: Path) -> str:
    return path.relative_to(ROOT).as_posix()


def slugify(value: str) -> str:
    normalized = unicodedata.normalize("NFD", value)
    ascii_value = "".join(char for char in normalized if unicodedata.category(char) != "Mn")
    cleaned = re.sub(r"[^a-zA-Z0-9]+", "_", ascii_value).strip("_")
    return cleaned[:80] or "document"


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="replace")


def title_from_file(path: Path) -> str:
    for line in read_text(path).splitlines():
        if line.startswith("# "):
            return line[2:].strip()
    return path.stem.replace("_", " ").replace("-", " ").strip()


def clean_inline(value: str) -> str:
    value = re.sub(r"`([^`]+)`", r"\1", value)
    value = re.sub(r"\*\*([^*]+)\*\*", r"\1", value)
    value = re.sub(r"\*([^*]+)\*", r"\1", value)
    value = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", r"\1 (\2)", value)
    return value


def code_summary_xml(lines: list[str], language: str = "") -> list[str]:
    useful_lines = [line.strip() for line in lines if line.strip()]
    if not useful_lines:
        return []

    joined = "\n".join(useful_lines).lower()
    details = []
    if "npm" in joined or "node" in joined:
        details.append("Ce bloc concerne l'environnement Node.js ou les dependances applicatives.")
    if "sql" in language.lower() or "select " in joined or "create table" in joined:
        details.append("Ce bloc illustre une requete ou une structure de base de donnees.")
    if "nginx" in joined or "server_name" in joined:
        details.append("Ce bloc decrit une configuration serveur ou proxy.")
    if "jwt" in joined or "csrf" in joined or "cors" in joined:
        details.append("Ce bloc concerne une mesure de securite applicative.")
    if "pm2" in joined or "systemctl" in joined or "certbot" in joined:
        details.append("Ce bloc correspond a une commande d'exploitation ou de deploiement.")
    if not details:
        details.append("Ce bloc technique sert d'exemple de configuration, de commande ou de logique applicative.")

    body = [paragraph_xml("Extrait technique resume", "Heading3")]
    body.extend(bullet_xml(detail) for detail in details)

    preview = useful_lines[:3]
    if preview:
        body.append(paragraph_xml("Elements importants a retenir :", "Heading3"))
        for line in preview:
            if len(line) > 130:
                line = line[:127] + "..."
            body.append(bullet_xml(line))
    if len(useful_lines) > len(preview):
        body.append(paragraph_xml(f"Le bloc complet contient {len(useful_lines)} lignes techniques. Il a ete resume pour privilegier la lecture du livrable."))
    return body


def style_id(style: str) -> str:
    return STYLE_ALIASES.get(style, style) if TEMPLATE_DOCX.exists() else style


def strip_markdown_table_separator(value: str) -> bool:
    cells = [cell.strip() for cell in value.strip().strip("|").split("|")]
    return bool(cells) and all(re.match(r"^:?-{3,}:?$", cell or "") for cell in cells)


def is_table_row(value: str) -> bool:
    return value.strip().startswith("|") and value.strip().endswith("|") and "|" in value.strip()[1:-1]


def split_table_row(value: str) -> list[str]:
    return [clean_inline(cell.strip()) for cell in value.strip().strip("|").split("|")]


def run_xml(text: str, monospace: bool = False, preserve: bool = False) -> str:
    preserve_attr = ' xml:space="preserve"' if preserve else ""
    font = (
        '<w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/>'
        '<w:sz w:val="18"/></w:rPr>'
        if monospace
        else ""
    )
    return f"<w:r>{font}<w:t{preserve_attr}>{xml_escape(text)}</w:t></w:r>"


def paragraph_xml(text: str = "", style: str | None = None, monospace: bool = False, preserve: bool = False) -> str:
    style_xml = f'<w:pPr><w:pStyle w:val="{style_id(style)}"/></w:pPr>' if style else ""
    return f"<w:p>{style_xml}{run_xml(text, monospace=monospace, preserve=preserve)}</w:p>"


def table_cell_xml(text: str, header: bool = False) -> str:
    shading = '<w:shd w:fill="D9EAF7"/>' if header else ""
    bold_start = "<w:rPr><w:b/></w:rPr>" if header else ""
    return (
        "<w:tc>"
        f"<w:tcPr><w:tcW w:w=\"2400\" w:type=\"dxa\"/>{shading}</w:tcPr>"
        f"<w:p><w:r>{bold_start}<w:t>{xml_escape(text)}</w:t></w:r></w:p>"
        "</w:tc>"
    )


def table_xml(rows: list[list[str]], has_header: bool = True) -> str:
    if not rows:
        return ""
    column_count = max(len(row) for row in rows)
    normalized_rows = [row + [""] * (column_count - len(row)) for row in rows]
    grid = "".join('<w:gridCol w:w="2400"/>' for _ in range(column_count))
    table_rows = []

    for row_index, row in enumerate(normalized_rows):
        cells = "".join(table_cell_xml(cell, header=has_header and row_index == 0) for cell in row)
        header_props = "<w:trPr><w:tblHeader/></w:trPr>" if has_header and row_index == 0 else ""
        table_rows.append(f"<w:tr>{header_props}{cells}</w:tr>")

    return (
        "<w:tbl>"
        "<w:tblPr>"
        f'<w:tblStyle w:val="{style_id("TableGrid")}"/>'
        '<w:tblW w:w="0" w:type="auto"/>'
        "<w:tblBorders>"
        '<w:top w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/>'
        '<w:left w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/>'
        '<w:bottom w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/>'
        '<w:right w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/>'
        '<w:insideH w:val="single" w:sz="4" w:space="0" w:color="D9D9D9"/>'
        '<w:insideV w:val="single" w:sz="4" w:space="0" w:color="D9D9D9"/>'
        "</w:tblBorders>"
        '<w:tblCellMar><w:top w:w="80" w:type="dxa"/><w:left w:w="80" w:type="dxa"/>'
        '<w:bottom w:w="80" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar>'
        "</w:tblPr>"
        f"<w:tblGrid>{grid}</w:tblGrid>"
        f"{''.join(table_rows)}"
        "</w:tbl>"
    )


def figure_xml(asset_key: str) -> list[str]:
    asset = SCHEMA_ASSETS[asset_key]
    rid = asset["rid"]
    caption = asset["caption"]
    cx = 6_400_000
    cy = 3_600_000
    image = f"""
<w:p>
  <w:pPr><w:jc w:val="center"/></w:pPr>
  <w:r>
    <w:drawing>
      <wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" distT="0" distB="0" distL="0" distR="0">
        <wp:extent cx="{cx}" cy="{cy}"/>
        <wp:docPr id="1" name="{xml_escape(caption)}"/>
        <a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
          <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
            <pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
              <pic:nvPicPr><pic:cNvPr id="0" name="{xml_escape(caption)}"/><pic:cNvPicPr/></pic:nvPicPr>
              <pic:blipFill><a:blip r:embed="{rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>
              <pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="{cx}" cy="{cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>
            </pic:pic>
          </a:graphicData>
        </a:graphic>
      </wp:inline>
    </w:drawing>
  </w:r>
</w:p>"""
    return [paragraph_xml(caption, "Heading3"), image]


def mermaid_schema_xml(code: str, source: Path) -> list[str]:
    lowered = code.lower()
    source_name = source.name.lower()
    if "erdiagram" in lowered or "schema_base_donnees" in source_name:
        return figure_xml("schema_donnees") + [
            paragraph_xml(
                "Ce schema presente les principales familles de donnees manipulees par AO Link. "
                "Il aide a comprendre comment un projet se decompose en lots, articles, offres, tours et questions."
            )
        ]
    if "sequencediagram" in lowered:
        return figure_xml("schema_cycle") + [
            paragraph_xml(
                "Ce parcours resume l'enchainement d'un usage classique, depuis la connexion jusqu'a l'analyse comparative."
            )
        ]
    if "flowchart" in lowered or "guide_navigation" in source_name:
        return figure_xml("schema_navigation") + [
            paragraph_xml(
                "Ce schema remplace le diagramme technique Mermaid afin de rendre la navigation plus lisible dans le livrable Word."
            )
        ]
    return code_summary_xml(code.splitlines(), "mermaid")


def bullet_xml(text: str, level: int = 0) -> str:
    indent = 360 + level * 360
    return (
        f'<w:p><w:pPr><w:pStyle w:val="{style_id("ListParagraph")}"/>'
        f'<w:ind w:left="{indent}" w:hanging="360"/></w:pPr>'
        f'{run_xml("- " + text, preserve=True)}</w:p>'
    )


def numbered_xml(text: str, number: int) -> str:
    return (
        f'<w:p><w:pPr><w:pStyle w:val="{style_id("ListParagraph")}"/></w:pPr>'
        f'{run_xml(f"{number}. {text}", preserve=True)}</w:p>'
    )


def page_break_xml() -> str:
    return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>'


def cover_page_xml(title: str, subtitle: str | None = None, details: list[str] | None = None) -> list[str]:
    body = [
        paragraph_xml(""),
        paragraph_xml(""),
        paragraph_xml("AO Link", "Titre"),
        paragraph_xml(title, "Heading1"),
    ]
    if subtitle:
        body.append(paragraph_xml(subtitle, "Sous-titre"))
    body.extend(
        [
            paragraph_xml(""),
            paragraph_xml("Projet d'entreprise - Alban Michaud"),
            paragraph_xml(f"Export généré le {datetime.now().strftime('%d/%m/%Y')}"),
            paragraph_xml(""),
        ]
    )
    for detail in details or []:
        body.append(paragraph_xml(detail))
    body.append(page_break_xml())
    return body


def markdown_to_body(path: Path, annexe_label: str | None = None, include_title: bool = True) -> list[str]:
    lines = read_text(path).replace("\r\n", "\n").split("\n")
    body: list[str] = []
    in_code = False
    code_language = ""
    code_lines: list[str] = []
    ordered = 1
    index = 0

    if include_title:
        if annexe_label:
            body.append(paragraph_xml(annexe_label, "Heading1"))
        body.append(paragraph_xml(title_from_file(path), "Heading2" if annexe_label else "Heading1"))
        body.append(paragraph_xml(f"Source : {rel(path)}"))
        body.append(paragraph_xml())

    while index < len(lines):
        raw_line = lines[index]
        line = raw_line.rstrip()

        if line.startswith("```"):
            if in_code:
                if code_language.lower() == "mermaid":
                    body.extend(mermaid_schema_xml("\n".join(code_lines), path))
                else:
                    body.extend(code_summary_xml(code_lines, code_language))
                code_lines = []
                code_language = ""
                in_code = False
            else:
                code_language = line.replace("```", "").strip()
                code_lines = []
                in_code = True
            index += 1
            continue

        if in_code:
            code_lines.append(line)
            index += 1
            continue

        if is_table_row(line):
            table_lines = []
            while index < len(lines) and is_table_row(lines[index].rstrip()):
                table_lines.append(lines[index].rstrip())
                index += 1

            rows = [split_table_row(table_line) for table_line in table_lines if not strip_markdown_table_separator(table_line)]
            if rows:
                body.append(table_xml(rows, has_header=len(table_lines) > 1 and strip_markdown_table_separator(table_lines[1])))
            ordered = 1
            continue

        if not line.strip():
            body.append(paragraph_xml())
            ordered = 1
            index += 1
            continue

        heading = re.match(r"^(#{1,6})\s+(.*)$", line)
        if heading:
            level = min(len(heading.group(1)), 3)
            body.append(paragraph_xml(heading.group(2).replace("**", "").strip(), f"Heading{level}"))
            ordered = 1
            index += 1
            continue

        bullet = re.match(r"^(\s*)[-*]\s+(.*)$", line)
        if bullet:
            body.append(bullet_xml(clean_inline(bullet.group(2)), len(bullet.group(1)) // 2))
            index += 1
            continue

        numbered = re.match(r"^\s*\d+[.)]\s+(.*)$", line)
        if numbered:
            body.append(numbered_xml(clean_inline(numbered.group(1)), ordered))
            ordered += 1
            index += 1
            continue

        if re.match(r"^[-=]{3,}", line):
            body.append(paragraph_xml(line, monospace=True, preserve=True))
            index += 1
            continue

        body.append(paragraph_xml(clean_inline(line)))
        ordered = 1
        index += 1

    return body


def styles_xml() -> str:
    template_styles = template_part("word/styles.xml")
    if template_styles:
        return template_styles

    return """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:rPr><w:rFonts w:ascii="Aptos" w:hAnsi="Aptos"/><w:sz w:val="22"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:rPr><w:b/><w:sz w:val="28"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:rPr><w:b/><w:sz w:val="24"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="360"/></w:pPr></w:style>
</w:styles>"""


def template_part(part_name: str) -> str | None:
    if not TEMPLATE_DOCX.exists():
        return None
    try:
        with zipfile.ZipFile(TEMPLATE_DOCX) as template:
            return template.read(part_name).decode("utf-8")
    except (KeyError, zipfile.BadZipFile, UnicodeDecodeError):
        return None


def template_part_bytes(part_name: str) -> bytes | None:
    if not TEMPLATE_DOCX.exists():
        return None
    try:
        with zipfile.ZipFile(TEMPLATE_DOCX) as template:
            return template.read(part_name)
    except (KeyError, zipfile.BadZipFile):
        return None


def template_section_xml() -> str:
    fallback = (
        '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>'
        '<w:pgMar w:top="1417" w:right="1417" w:bottom="1417" w:left="1417" '
        'w:header="708" w:footer="708" w:gutter="0"/><w:cols w:space="720"/></w:sectPr>'
    )
    document = template_part("word/document.xml")
    if not document:
        return fallback
    match = re.search(r"<w:sectPr\b.*?</w:sectPr>", document, flags=re.DOTALL)
    return match.group(0) if match else fallback


def document_xml(body_parts: list[str]) -> str:
    return f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:body>
    {"".join(body_parts)}
    {template_section_xml()}
  </w:body>
</w:document>"""


def template_document_relationships_xml() -> str:
    image_relationships = "".join(
        f'  <Relationship Id="{asset["rid"]}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="{asset["target"]}"/>\n'
        for asset in SCHEMA_ASSETS.values()
        if asset["path"].exists()
    )
    return f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
  <Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>
  <Relationship Id="rId10" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>
  <Relationship Id="rId11" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header2.xml"/>
  <Relationship Id="rId12" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>
  <Relationship Id="rId13" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer2.xml"/>
  <Relationship Id="rId14" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header3.xml"/>
  <Relationship Id="rId15" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer3.xml"/>
  <Relationship Id="rId94" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/>
{image_relationships}
</Relationships>"""


def template_content_types_xml() -> str:
    return """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="png" ContentType="image/png"/>
  <Default Extension="jpeg" ContentType="image/jpeg"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>
  <Override PartName="/word/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>
  <Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>
  <Override PartName="/word/header2.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>
  <Override PartName="/word/header3.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>
  <Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>
  <Override PartName="/word/footer2.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>
  <Override PartName="/word/footer3.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>
</Types>"""


def copy_template_part(template: zipfile.ZipFile, docx: zipfile.ZipFile, part_name: str) -> None:
    try:
        docx.writestr(part_name, template.read(part_name))
    except KeyError:
        pass


def write_docx(path: Path, body_parts: list[str]) -> None:
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as docx:
        if TEMPLATE_DOCX.exists():
            try:
                with zipfile.ZipFile(TEMPLATE_DOCX) as template:
                    docx.writestr("[Content_Types].xml", template_content_types_xml())
                    docx.writestr(
                        "_rels/.rels",
                        """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>""",
                    )
                    for part in [
                        "word/styles.xml",
                        "word/settings.xml",
                        "word/theme/theme1.xml",
                        "word/header1.xml",
                        "word/header2.xml",
                        "word/header3.xml",
                        "word/footer1.xml",
                        "word/footer2.xml",
                        "word/footer3.xml",
                        "word/_rels/header3.xml.rels",
                        "word/media/image2.png",
                        "word/media/image3.jpeg",
                    ]:
                        copy_template_part(template, docx, part)
                    for asset in SCHEMA_ASSETS.values():
                        if asset["path"].exists():
                            docx.writestr(f'word/{asset["target"]}', asset["path"].read_bytes())
                    docx.writestr("word/_rels/document.xml.rels", template_document_relationships_xml())
                docx.writestr("word/document.xml", document_xml(body_parts))
                return
            except zipfile.BadZipFile:
                pass

        docx.writestr(
            "[Content_Types].xml",
            """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/word/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>
</Types>""",
        )
        docx.writestr(
            "_rels/.rels",
            """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>""",
        )
        docx.writestr("word/document.xml", document_xml(body_parts))
        docx.writestr("word/styles.xml", styles_xml())
        theme = template_part_bytes("word/theme/theme1.xml")
        if theme:
            docx.writestr("word/theme/theme1.xml", theme)
        docx.writestr(
            "word/_rels/document.xml.rels",
            """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rIdTheme" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/>
</Relationships>""",
        )


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    files = sorted(
        (path for path in DOCS_DIR.rglob("*") if path.is_file() and path.suffix.lower() in INCLUDED_EXTENSIONS),
        key=lambda item: rel(item).lower(),
    )

    index_body = [
        *cover_page_xml("Sommaire des annexes", "Documentation AO Link"),
        paragraph_xml("Annexes - Documentation AO-link", "Heading1"),
        paragraph_xml(f"Export généré le {datetime.now().strftime('%d/%m/%Y')}."),
        paragraph_xml(f"{len(files)} documents exportés depuis le dossier docs."),
        paragraph_xml(),
    ]
    combined_body = [
        *cover_page_xml("Annexes - Documentation complète", "AO Link"),
        paragraph_xml("Annexes - Documentation complète AO-link", "Heading1"),
        paragraph_xml(f"Export généré le {datetime.now().strftime('%d/%m/%Y')}."),
        paragraph_xml(),
    ]
    manifest = []

    for index, source in enumerate(files, start=1):
        number = f"{index:02d}"
        title = title_from_file(source)
        annexe_label = f"Annexe {number}"
        output_name = f"Annexe_{number}_{slugify(title or source.stem)}.docx"

        single_body = [
            *cover_page_xml(annexe_label, title, [f"Source : {rel(source)}"]),
            *markdown_to_body(source, annexe_label),
        ]
        write_docx(OUT_DIR / output_name, single_body)
        index_body.append(numbered_xml(f"{annexe_label} - {title} - {rel(source)} - {output_name}", index))

        if index > 1:
            combined_body.append(page_break_xml())
        combined_body.extend(markdown_to_body(source, annexe_label))

        manifest.append({"annexe": annexe_label, "title": title, "source": rel(source), "file": output_name})

    write_docx(OUT_DIR / "00_Sommaire_des_annexes.docx", index_body)
    write_docx(OUT_DIR / "Annexes_documentation_complete_AO-link.docx", combined_body)
    (OUT_DIR / "manifest_annexes.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"Export terminé : {len(files)} documents + sommaire + document complet dans {OUT_DIR}")


if __name__ == "__main__":
    main()
