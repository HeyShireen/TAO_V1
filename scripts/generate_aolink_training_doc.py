from __future__ import annotations

import html
import json
import re
import zipfile
from datetime import datetime
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "docs" / "formation_aolink"
CAPTURES_DIR = OUT_DIR / "captures"
DOCX_PATH = OUT_DIR / "Formation_AO_Link.docx"
MD_PATH = OUT_DIR / "Formation_AO_Link.md"


SECTIONS = [
    {
        "title": "Objectif de la formation",
        "body": [
            "Ce support accompagne la prise en main d'AO Link sur l'environnement de démonstration démo.ao-link.fr.",
            "Il documenté les principaux parcours utilisateur visibles dans la version démo : connexion, gestion des projets, tours, lots, comparaison des offres, questions automatiques, configuration et administration.",
        ],
    },
    {
        "title": "Connexion et Accès à la démo",
        "image": "01_connexion_compte_demo.png",
        "body": [
            "Depuis la page de connexion, le compte démo est pre-rempli lorsque le mode beta/démo est active.",
            "L'utilisateur clique sur Se connecter pour acceder à l'espace de travail. Les champs techniques honeypot ne doivent jamais être remplis ni ajoutés dans une automatisation.",
        ],
        "steps": [
            "Ouvrir démo.ao-link.fr/login.",
            "Vérifier que l'email et le mot de passe démo sont présents.",
            "Cliquer sur Se connecter.",
        ],
    },
    {
        "title": "Tableau de bord et liste des projets",
        "image": "02_liste_projets.png",
        "body": [
            "La page Projets est le point de depart du travail. Elle permet de créer un projet, d'ouvrir un dossier existant et d'acceder aux actions d'Édition ou de partage.",
            "Dans la démo, un projet de référence est disponible afin de parcourir les écrans sans recréer de données.",
        ],
        "steps": [
            "Consulter la liste des projets.",
            "Utiliser Ouvrir pour entrer dans le projet.",
            "Utiliser Editer ou Partager si le Rôle le permet.",
        ],
    },
    {
        "title": "Édition d'un projet",
        "image": "03_modal_edition_projet.png",
        "body": [
            "La fenêtre d'Édition sert a corriger les informations principales du projet : nom, référence, client, date d'etude et partages associes.",
            "Elle est utile en debut de dossier ou lorsqu'un projet change de périmètre.",
        ],
        "steps": [
            "Cliquer sur Editer depuis la ligne du projet.",
            "Modifier les champs necessaires.",
            "Enregistrer les changements, ou fermer sans action si la modification n'est pas souhaitee.",
        ],
    },
    {
        "title": "Partage d'un projet",
        "image": "04_modal_partage_projet.png",
        "body": [
            "Le partage donne Accès à un projet à des utilisateurs visionneurs. Une option permet d'autoriser la modification lorsque le contexte le justifie.",
            "Ce parcours est important pour distinguer la consultation simple de la collaboration active.",
        ],
        "steps": [
            "Cliquer sur Partager.",
            "Sélectionner un visionneur.",
            "Choisir lecture seule ou lecture avec modification.",
            "Valider le partage puis Vérifier la liste des partages existants.",
        ],
    },
    {
        "title": "Gestion des tours",
        "image": "05_liste_tours.png",
        "body": [
            "Un tour correspond à une phase de consultation : ouverture, negociation, second tour ou ajustement.",
            "Chaque tour porte ses propres lots, offres, questions et statistiques afin de suivre l'evolution de l'appel d'offres dans le temps.",
        ],
        "steps": [
            "Ouvrir un projet.",
            "Consulter les cartes de tours.",
            "Sélectionner un tour pour voir ses lots.",
            "Utiliser Nouveau tour ou Exporter selon le besoin et les droits.",
        ],
    },
    {
        "title": "Comparaison des tours",
        "image": "06_comparaison_tours.png",
        "body": [
            "La comparaison des tours donne une vue de synthèse sur l'evolution des montants et des choix entre phases.",
            "Les sous-vues Comparatif, Sélection options et Simulation servent respectivement à analyser les montants, les options et les scénarios de décision.",
        ],
        "steps": [
            "Depuis l'onglet Tours, ouvrir Comparaison Tours.",
            "Sélectionner le tour à analyser si nécessaire.",
            "Parcourir les vues Comparatif, Sélection options et Simulation.",
        ],
    },
    {
        "title": "Lots d'un tour",
        "image": "07_tour_liste_lots.png",
        "body": [
            "La vue Lots liste les lots rattachés au tour selectionne. C'est le passage vers le détail des données d'un lot.",
            "Selon le Rôle, l'utilisateur peut ouvrir, modifier, importer ou reordonner les lots.",
        ],
        "steps": [
            "Sélectionner un tour.",
            "Vérifier la liste des lots.",
            "Cliquer sur Ouvrir pour acceder au tableau comparatif du lot.",
        ],
    },
    {
        "title": "Configuration globale des questions",
        "image": "08_tour_config_questions.png",
        "body": [
            "La configuration des questions definit les seuils et les regles qui declenchent les alertes automatiques.",
            "Elle permet d'adapter AO Link au niveau de sensibilite attendu sur les Quantités, prix unitaires, montants ou réponses manquantes.",
        ],
        "steps": [
            "Ouvrir Config Questions depuis un tour.",
            "Vérifier les seuils actifs.",
            "Ajuster les valeurs lorsque la strategie d'analyse le demande.",
        ],
    },
    {
        "title": "Comparatif d'un lot",
        "image": "10_lot_donnees_comparatif.png",
        "body": [
            "Le comparatif d'un lot rassemble les lignes MOE et les offres entreprises pour faciliter l'analyse.",
            "Les differences, cellules vides et montants atypiques deviennent visibles dans une vue unique.",
        ],
        "steps": [
            "Ouvrir un lot depuis la liste des lots.",
            "Rester en mode Comparatif pour lire les offres.",
            "Utiliser les totaux, couleurs et indicateurs pour identifier les points a controler.",
        ],
    },
    {
        "title": "Mode Édition des données",
        "image": "11_lot_donnees_edition.png",
        "body": [
            "Le mode Édition expose une logique proche d'un tableur. Il sert a corriger les lignes, Quantités et offres quand l'utilisateur dispose des droits d'ecriture.",
            "La saisie doit rester prudente : les modifications alimentent ensuite les comparatifs et les questions.",
        ],
        "steps": [
            "Cliquer sur Édition dans le lot.",
            "Modifier les cellules utiles.",
            "Controler le resultat en revenant au mode Comparatif.",
        ],
    },
    {
        "title": "Questions du lot",
        "image": "12_lot_questions.png",
        "body": [
            "L'onglet Questions regroupe les points de vigilance générés automatiquement ou prepares pour echange avec les entreprises.",
            "Les filtres permettent de cibler les Quantités, prix unitaires, montants, entreprises ou ecarts MOE/entreprise.",
        ],
        "steps": [
            "Ouvrir l'onglet Questions du lot.",
            "Filtrer les questions selon le type d'ecart recherche.",
            "Exporter ou preparer l'envoi lorsque la revue est prete.",
        ],
    },
    {
        "title": "Configuration des questions du lot",
        "image": "13_lot_config_questions.png",
        "body": [
            "Cette configuration affine les seuils au niveau du lot. Elle complete la configuration globale lorsqu'un lot demande une sensibilite particuliere.",
            "Elle sert notamment a gerer les ecarts tres bas, bas, hauts, tres hauts et les réponses oubliees.",
        ],
        "steps": [
            "Ouvrir Config Questions dans le lot.",
            "Vérifier les seuils par type de donnee.",
            "Modifier uniquement les valeurs utiles au contexte du lot.",
        ],
    },
    {
        "title": "Paramètres et administration",
        "image": "14_parametres.png",
        "body": [
            "L'onglet Paramètres regroupe les fonctions d'administration accessibles selon le Rôle.",
            "Il couvre notamment les utilisateurs, les rôles, les entreprises rattachees et la validation des comptes.",
        ],
        "steps": [
            "Ouvrir Paramètres.",
            "Vérifier les utilisateurs et leurs rôles.",
            "Mettre à jour les droits uniquement lorsque la responsabilite du dossier le nécessite.",
        ],
    },
    {
        "title": "synthèse des parcours couverts",
        "body": [
            "Les captures couvrent les parcours principaux de la démo : Accès, projet, partage, tours, comparaison, lots, Données, questions et administration.",
            "La fiche Questions au niveau tour était désactivée dans l'état observé avant sélection d'un lot; le parcours fonctionnel des questions est donc documenté via l'onglet Questions du lot.",
        ],
    },
]


def xml_escape(value: str) -> str:
    return html.escape(value, quote=True).replace("'", "&apos;")


def para(text: str = "", style: str | None = None) -> str:
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


def image_xml(rid: str, caption: str, width_px: int, height_px: int) -> str:
    width_emu = 5_900_000
    height_emu = int(width_emu * height_px / width_px)
    return f"""
<w:p>
  <w:pPr><w:jc w:val="center"/></w:pPr>
  <w:r>
    <w:drawing>
      <wp:inline distT="0" distB="0" distL="0" distR="0">
        <wp:extent cx="{width_emu}" cy="{height_emu}"/>
        <wp:docPr id="{re.sub(r'\\D', '', rid) or '1'}" name="{xml_escape(caption)}"/>
        <a:graphic>
          <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
            <pic:pic>
              <pic:nvPicPr><pic:cNvPr id="0" name="{xml_escape(caption)}"/><pic:cNvPicPr/></pic:nvPicPr>
              <pic:blipFill><a:blip r:embed="{rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>
              <pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="{width_emu}" cy="{height_emu}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>
            </pic:pic>
          </a:graphicData>
        </a:graphic>
      </wp:inline>
    </w:drawing>
  </w:r>
</w:p>
<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:i/></w:rPr><w:t>{xml_escape(caption)}</w:t></w:r></w:p>
"""


def png_size(path: Path) -> tuple[int, int]:
    data = path.read_bytes()
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        return 1440, 1100
    return int.from_bytes(data[16:20], "big"), int.from_bytes(data[20:24], "big")


def document_xml(parts: list[str]) -> str:
    return f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document
  xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
  xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
  xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
  xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
  <w:body>
    {''.join(parts)}
    <w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>
  </w:body>
</w:document>"""


def styles_xml() -> str:
    return """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="21"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:rPr><w:b/><w:sz w:val="40"/><w:color w:val="17324D"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:rPr><w:b/><w:sz w:val="30"/><w:color w:val="17324D"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:rPr><w:b/><w:sz w:val="24"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="360"/></w:pPr></w:style>
</w:styles>"""


def write_markdown() -> None:
    lines = [
        "# Formation AO Link",
        "",
        f"Document généré le {datetime.now().strftime('%d/%m/%Y')}.",
        "",
        "Source des captures : https://démo.ao-link.fr",
        "",
    ]
    for section in SECTIONS:
        lines.extend([f"## {section['title']}", ""])
        lines.extend([paragraph + "\n" for paragraph in section.get("body", [])])
        if section.get("image"):
            lines.append(f"![{section['title']}](captures/{section['image']})")
            lines.append("")
        if section.get("steps"):
            lines.append("Etapes :")
            lines.extend([f"- {step}" for step in section["steps"]])
            lines.append("")
    MD_PATH.write_text("\n".join(lines), encoding="utf-8")


def write_docx() -> None:
    image_relationships = []
    body = [
        para("Formation AO Link", "Title"),
        para("Guide utilisateur illustre"),
        para(f"généré le {datetime.now().strftime('%d/%m/%Y')} à partir de démo.ao-link.fr."),
        para(""),
        para("Public vise : utilisateurs métier, responsables de projet et administrateurs fonctionnels."),
        page_break(),
    ]

    image_index = 1
    used_images: list[tuple[Path, str]] = []
    for section_index, section in enumerate(SECTIONS, start=1):
        if section_index > 1:
            body.append(page_break())
        body.append(para(section["title"], "Heading1"))
        for paragraph in section.get("body", []):
            body.append(para(paragraph))
        image_name = section.get("image")
        if image_name:
            path = CAPTURES_DIR / image_name
            if path.exists():
                rid = f"rIdImage{image_index}"
                width, height = png_size(path)
                body.append(image_xml(rid, f"Capture - {section['title']}", width, height))
                image_relationships.append(
                    f'<Relationship Id="{rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/{image_name}"/>'
                )
                used_images.append((path, image_name))
                image_index += 1
        steps = section.get("steps", [])
        if steps:
            body.append(para("Etapes utilisateur", "Heading2"))
            for step in steps:
                body.append(bullet(step))

    relationships = "\n".join(
        [
            '<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>',
            *image_relationships,
        ]
    )

    with zipfile.ZipFile(DOCX_PATH, "w", compression=zipfile.ZIP_DEFLATED) as docx:
        docx.writestr(
            "[Content_Types].xml",
            """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="png" ContentType="image/png"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
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
{relationships}
</Relationships>""",
        )
        for path, name in used_images:
            docx.writestr(f"word/media/{name}", path.read_bytes())


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    write_markdown()
    write_docx()
    manifest = {
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "source": BASE_URL if "BASE_URL" in globals() else "https://démo.ao-link.fr",
        "docx": str(DOCX_PATH.relative_to(ROOT)),
        "markdown": str(MD_PATH.relative_to(ROOT)),
        "captures": sorted(path.name for path in CAPTURES_DIR.glob("*.png")),
    }
    (OUT_DIR / "manifest_formation.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Document généré : {DOCX_PATH}")
    print(f"Source Markdown : {MD_PATH}")


if __name__ == "__main__":
    main()
