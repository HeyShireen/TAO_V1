from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path

from export_docs_to_docx import (
    ROOT,
    bullet_xml,
    cover_page_xml,
    markdown_to_body,
    numbered_xml,
    page_break_xml,
    paragraph_xml,
    rel,
    slugify,
    title_from_file,
    write_docx,
)


OUT_DIR = ROOT / "livrables_word_mis_en_forme"

LIVRABLES = [
    {
        "number": "01",
        "title": "Application web operationnelle",
        "objective": "Montrer que l'application AO Link repond au besoin metier : centraliser les appels d'offres, structurer les lots et produire des analyses exploitables.",
        "audience": "Direction, utilisateurs metier, jury et futur repreneur fonctionnel.",
        "summary": [
            "Ce livrable presente l'outil tel qu'il est utilise par l'entreprise. Il ne s'agit pas seulement d'un depot de code : le document explique le parcours de travail attendu, depuis la connexion jusqu'aux exports.",
            "L'objectif est de permettre a un lecteur non developpeur de comprendre ce que fait AO Link, a quel moment il intervient dans la phase ACT et quels gains il apporte par rapport aux anciens fichiers Excel.",
        ],
        "key_points": [
            "AO Link centralise les projets, les tours, les lots, les entreprises et les offres.",
            "Le parcours utilisateur est structure autour de quelques ecrans principaux : projets, tours, lots, questions et exports.",
            "Le livrable montre la valeur metier de l'application avant d'entrer dans les details techniques.",
        ],
        "sources": ["docs/README.md", "docs/GUIDE_NAVIGATION.md"],
    },
    {
        "number": "02",
        "title": "Documentation technique",
        "objective": "Expliquer l'architecture, les choix techniques et le modele de donnees pour rendre le projet comprehensible et maintenable.",
        "audience": "Developpeur, mainteneur, prestataire externe ou personne chargee de reprendre le projet.",
        "summary": [
            "Cette documentation sert de passerelle entre le fonctionnement metier et la realisation technique. Elle explique comment l'application est organisee sans obliger le lecteur a analyser directement tout le code source.",
            "La partie base de donnees est essentielle : elle montre comment les donnees de l'appel d'offres sont reliees entre elles et pourquoi l'application peut suivre plusieurs tours de consultation sans perdre l'historique.",
        ],
        "key_points": [
            "L'application repose sur un backend Node.js, une interface web et une base PostgreSQL.",
            "Le modele de donnees separe les projets, lots, articles, entreprises, offres, tours et questions.",
            "Les schemas visuels remplacent les diagrammes techniques bruts pour faciliter la lecture.",
        ],
        "sources": ["docs/GUIDE_TECHNIQUE.md", "docs/SCHEMA_BASE_DONNEES.md"],
    },
    {
        "number": "03",
        "title": "Documentation de securite",
        "objective": "Documenter les risques identifies, les protections mises en place et les points de vigilance restant a suivre.",
        "audience": "Direction, mainteneur technique, jury et toute personne evaluant la fiabilite du projet.",
        "summary": [
            "AO Link manipule des donnees sensibles : offres d'entreprises, montants, droits utilisateurs et informations de projets. La securite n'est donc pas un sujet secondaire mais une condition de mise en service.",
            "Ce livrable reformule les audits et corrections de maniere plus lisible. Les extraits de code sont resumes afin de mettre en avant la logique de protection plutot que l'implementation ligne par ligne.",
        ],
        "key_points": [
            "Les principaux risques traites concernent l'authentification, les roles, la configuration, les entrees utilisateur et les tokens.",
            "Les corrections appliquees reduisent les risques critiques et structurent une base de securite plus propre.",
            "Le document conserve aussi les limites et les actions futures, ce qui rend l'analyse plus transparente.",
        ],
        "sources": [
            "docs/SECURITY.md",
            "docs/_archive/audit/SECURITY_AUDIT.md",
            "docs/_archive/audit/SECURITY_FIXES_APPLIED.md",
            "docs/_archive/audit/SECURITY_IMPLEMENTATION_GUIDE.md",
            "docs/_archive/audit/ACTION_PLAN.md",
            "docs/_archive/audit/ATTACK_EXAMPLES.md",
            "docs/_archive/audit/REFRESH_TOKENS_HONEYPOT.md",
            "docs/_archive/reports/AUDIT_SUMMARY.md",
            "docs/_archive/reports/SECURITY_AUDIT_SUMMARY.md",
            "docs/_archive/SECURITY_AUDIT/README.md",
            "docs/_archive/SECURITY_AUDIT/01_REPORTS/README.md",
        ],
    },
    {
        "number": "04",
        "title": "Scripts et fichiers de deploiement",
        "objective": "Expliquer comment l'application peut etre installee, configuree et mise en production sur un environnement d'hebergement.",
        "audience": "Mainteneur, prestataire, administrateur systeme ou developpeur charge du deploiement.",
        "summary": [
            "Un logiciel n'a de valeur pour l'entreprise que s'il peut etre installe et relance de facon fiable. Ce livrable rassemble les procedures de deploiement et les controles associes.",
            "Les commandes techniques sont conservees uniquement quand elles sont utiles a l'exploitation. Les gros blocs de configuration sont resumes pour rendre le document plus facile a utiliser.",
        ],
        "key_points": [
            "Le deploiement couvre les variables d'environnement, le serveur applicatif, le proxy, le HTTPS et les controles de bon fonctionnement.",
            "Les scripts servent a securiser les operations repetitives et a limiter les oublis lors d'une mise en production.",
            "Le document distingue les actions de preparation, de lancement et de verification.",
        ],
        "sources": [
            "docs/DEPLOY_VPS.md",
            "docs/SETUP_DEMO.md",
            "docs/_archive/audit/DEPLOYMENT_SECURITY.md",
            "docs/_archive/audit/QUICK_START.md",
            "docs/_archive/SECURITY_AUDIT/04_SCRIPTS/README.md",
            "docs/_archive/SECURITY_AUDIT/05_INFRASTRUCTURE/README.md",
            "docs/check-security-fixes.sh",
            "docs/CORRECTIONS_INVENTORY.sh",
        ],
    },
    {
        "number": "05",
        "title": "Cahier de tests et resultats",
        "objective": "Montrer comment le fonctionnement de l'application a ete verifie et quels resultats valident le perimetre livre.",
        "audience": "Direction, jury, utilisateur metier et mainteneur.",
        "summary": [
            "Ce livrable apporte les preuves de validation du projet. Il explique les controles effectues et les resultats obtenus, afin de montrer que l'application ne repose pas uniquement sur une demonstration visuelle.",
            "La lecture est orientee vers la comprehension des scenarios testes : connexion, import, comparaison, securite, generation des questions et stabilite generale.",
        ],
        "key_points": [
            "Les tests confirment les fonctions principales attendues sur le perimetre de la V1.",
            "Les resultats permettent d'identifier ce qui est valide et ce qui devra encore etre consolide.",
            "Le cahier de tests sert aussi de base pour les futures non-regressions.",
        ],
        "sources": [
            "docs/_archive/reports/TEST_RESULTS.md",
            "docs/_archive/reports/VALIDATION_REPORT.md",
            "docs/_archive/reports/FINAL_REPORT.md",
            "docs/_archive/reports/VISUALIZATION.md",
        ],
    },
    {
        "number": "06",
        "title": "Maintenance et exploitation",
        "objective": "Prevoir les conditions de maintien en fonctionnement de l'application apres la livraison initiale.",
        "audience": "Entreprise, mainteneur, futur developpeur ou prestataire externe.",
        "summary": [
            "La maintenance garantit que l'outil reste utilisable apres la fin du projet. Elle couvre les sauvegardes, les migrations, les mises a jour et la reaction en cas d'incident.",
            "Ce livrable est important car AO Link a ete developpe par une personne principale. Une documentation claire limite la dependance a ce developpeur unique.",
        ],
        "key_points": [
            "Les procedures de maintenance rendent l'application plus durable.",
            "Les controles reguliers portent sur la base de donnees, les logs, les dependances et la securite.",
            "Le document facilite une reprise future par un tiers.",
        ],
        "sources": [
            "docs/MAINTENANCE.md",
            "docs/_archive/reports/CLEANUP_PLAN.md",
            "docs/_archive/SECURITY_AUDIT/02_GUIDES/README.md",
            "docs/_archive/SECURITY_AUDIT/03_CODE_FIXES/README.md",
        ],
    },
    {
        "number": "07",
        "title": "Annexes et documents de reference",
        "objective": "Regrouper les documents de cadrage et les references qui expliquent l'origine du besoin et le perimetre du projet.",
        "audience": "Jury, direction et lecteur souhaitant comprendre le contexte initial.",
        "summary": [
            "Ce livrable complete les documents precedents avec les supports de reference. Il donne du contexte : cahier des charges, elements de cadrage et documents qui ont servi a stabiliser le besoin.",
            "Il permet de relier les choix de developpement aux attentes formulees au depart du projet.",
        ],
        "key_points": [
            "Le cahier des charges formalise le besoin metier initial.",
            "Les annexes donnent une trace des decisions et des supports de travail.",
            "Elles servent de justification documentaire au perimetre livre.",
        ],
        "sources": ["docs/_archive/reports/CAHIER_DES_CHARGES_AOLINK.md", "docs/unused-report.txt"],
    },
]


SOURCE_INTROS = {
    "docs/README.md": "Cette partie donne une vue d'ensemble du depot et de la documentation disponible. Elle sert de porte d'entree pour comprendre rapidement le perimetre de l'application.",
    "docs/GUIDE_NAVIGATION.md": "Cette partie explique comment un utilisateur circule dans AO Link. Les schemas generes remplacent les diagrammes techniques afin de rendre le parcours plus lisible.",
    "docs/GUIDE_TECHNIQUE.md": "Cette partie presente l'architecture et les composants principaux. Elle permet a un mainteneur de comprendre l'organisation du projet sans lire immediatement tout le code.",
    "docs/SCHEMA_BASE_DONNEES.md": "Cette partie explique le modele de donnees. Le schema visuel montre les relations principales avant les tableaux de detail.",
    "docs/SECURITY.md": "Cette partie resume les mecanismes de securite effectivement visibles dans la version actuelle.",
    "docs/DEPLOY_VPS.md": "Cette partie decrit le deploiement sur VPS et les points de controle utiles pour exploiter l'application.",
    "docs/SETUP_DEMO.md": "Cette partie explique la mise en place d'un environnement de demonstration et les problemes courants.",
    "docs/MAINTENANCE.md": "Cette partie formalise les controles et operations utiles pour maintenir l'application dans le temps.",
}


def existing_sources(sources: list[str]) -> list[Path]:
    return [ROOT / source for source in sources if (ROOT / source).exists()]


def source_intro(source: Path) -> str:
    source_rel = rel(source)
    if source_rel in SOURCE_INTROS:
        return SOURCE_INTROS[source_rel]
    if "SECURITY" in source_rel.upper() or "audit" in source_rel.lower():
        return "Cette partie apporte une preuve ou un complement sur la securisation du projet. Les elements trop techniques sont resumes pour faire ressortir le risque, la mesure appliquee et l'impact."
    if "reports" in source_rel.lower() or "TEST" in source_rel.upper() or "VALIDATION" in source_rel.upper():
        return "Cette partie sert de trace de validation. Elle presente les resultats, les constats et les points de controle utiles pour justifier l'avancement du projet."
    if source.suffix.lower() == ".sh":
        return "Cette partie correspond a un script. Le livrable en donne la logique et les controles importants sans transformer le document en listing de code."
    return "Cette partie complete le livrable avec un document source du projet. Elle est conservee pour assurer la traçabilite de la documentation."


def livrable_body(livrable: dict) -> tuple[list[str], list[dict]]:
    sources = existing_sources(livrable["sources"])
    title = f"Livrable {livrable['number']} - {livrable['title']}"
    body = [
        *cover_page_xml(title, livrable["objective"]),
        paragraph_xml(title, "Heading1"),
        paragraph_xml(livrable["objective"]),
        paragraph_xml(f"Export genere le {datetime.now().strftime('%d/%m/%Y')}."),
        paragraph_xml(),
        paragraph_xml("Pour qui ?", "Heading2"),
        paragraph_xml(livrable["audience"]),
        paragraph_xml("Synthese du livrable", "Heading2"),
    ]
    for paragraph in livrable["summary"]:
        body.append(paragraph_xml(paragraph))

    body.append(paragraph_xml("Ce qu'il faut retenir", "Heading2"))
    for point in livrable["key_points"]:
        body.append(bullet_xml(point))

    body.extend([paragraph_xml("Documents inclus", "Heading2")])
    manifest_entries = []
    for index, source in enumerate(sources, start=1):
        source_title = title_from_file(source)
        body.append(numbered_xml(f"{source_title} - {rel(source)}", index))
        manifest_entries.append({"title": source_title, "source": rel(source)})

    for index, source in enumerate(sources, start=1):
        source_title = title_from_file(source)
        body.append(page_break_xml())
        body.append(paragraph_xml(f"Partie {index} - {source_title}", "Heading1"))
        body.append(paragraph_xml("Objectif de cette partie", "Heading2"))
        body.append(paragraph_xml(source_intro(source)))
        body.append(paragraph_xml(f"Source : {rel(source)}"))
        body.append(paragraph_xml())
        body.extend(markdown_to_body(source, include_title=False))

    return body, manifest_entries


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    summary_body = [
        *cover_page_xml("Sommaire des livrables", "Documentation AO Link"),
        paragraph_xml("Sommaire des livrables AO Link", "Heading1"),
        paragraph_xml("Regroupement pedagogique des annexes selon les sept livrables identifies dans le projet d'entreprise."),
        paragraph_xml(f"Export genere le {datetime.now().strftime('%d/%m/%Y')}."),
        paragraph_xml(),
    ]
    combined_body = [
        *cover_page_xml("Livrables AO Link", "Documentation complete regroupee"),
        paragraph_xml("Livrables AO Link - Documentation regroupee", "Heading1"),
        paragraph_xml("Document complet regroupant les sept livrables documentaires dans une version plus explicative et moins centree sur le code."),
        paragraph_xml(f"Export genere le {datetime.now().strftime('%d/%m/%Y')}."),
        paragraph_xml(),
    ]
    manifest = []

    for index, livrable in enumerate(LIVRABLES, start=1):
        body, entries = livrable_body(livrable)
        file_name = f"Livrable_{livrable['number']}_{slugify(livrable['title'])}.docx"
        write_docx(OUT_DIR / file_name, body)

        summary_body.append(
            numbered_xml(
                f"Livrable {livrable['number']} - {livrable['title']} - {len(entries)} document(s) - {file_name}",
                index,
            )
        )

        if index > 1:
            combined_body.append(page_break_xml())
        combined_body.extend(body)

        manifest.append(
            {
                "livrable": f"Livrable {livrable['number']}",
                "title": livrable["title"],
                "objective": livrable["objective"],
                "file": file_name,
                "documents": entries,
            }
        )

    write_docx(OUT_DIR / "00_Sommaire_des_livrables.docx", summary_body)
    write_docx(OUT_DIR / "Livrables_AO_Link_documentation_complete.docx", combined_body)
    (OUT_DIR / "manifest_livrables.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"Export termine : {len(LIVRABLES)} livrables + sommaire + document complet dans {OUT_DIR}")


if __name__ == "__main__":
    main()
