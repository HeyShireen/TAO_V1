from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path

from export_docs_to_docx import (
    ROOT,
    bullet_xml,
    cover_page_xml,
    image_asset_xml,
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
SCREENSHOTS_DIR = ROOT / "docs" / "formation_aolink" / "captures"

USER_JOURNEY_SCREENSHOTS = [
    ("01_connexion_compte_demo.png", "Connexion au compte démo", "Accès à l'environnement démo avec les identifiants préremplis."),
    ("02_liste_projets.png", "Liste des projets", "Point d'entrée pour créer, ouvrir, editer ou partager un projet."),
    ("03_modal_edition_projet.png", "Édition d'un projet", "Mise à jour des informations principales et des partages associes."),
    ("04_modal_partage_projet.png", "Partage d'un projet", "Attribution des accès de lecture ou modification à un visionneur."),
    ("05_liste_tours.png", "Gestion des tours", "Suivi des phases de consultation du projet."),
    ("06_comparaison_tours.png", "Comparaison des tours", "Analyse des évolutions entre les phases et simulations de choix."),
    ("07_tour_liste_lots.png", "Lots d'un tour", "Accès aux lots rattachés à une phase donnee."),
    ("08_tour_config_questions.png", "Configuration globale des questions", "Définition des seuils qui pilotent les questions automatiques."),
    ("10_lot_donnees_comparatif.png", "Comparatif d'un lot", "Lecture des lignes MOE et des offres entreprises dans une vue de synthèse."),
    ("11_lot_donnees_edition.png", "Édition des données du lot", "Saisie et correction des articles, Quantités et offres."),
    ("12_lot_questions.png", "Questions du lot", "Revue des points de vigilance et préparation des échanges avec les entreprises."),
    ("13_lot_config_questions.png", "Configuration des questions du lot", "Ajustement des seuils au niveau d'un lot particulier."),
    ("14_parametres.png", "Paramètres et administration", "Gestion des utilisateurs, rôles, entreprises et droits."),
]


def screenshot_assets() -> list[dict]:
    assets = []
    for index, (filename, caption, _) in enumerate(USER_JOURNEY_SCREENSHOTS, start=1):
        path = SCREENSHOTS_DIR / filename
        if not path.exists():
            continue
        assets.append(
            {
                "path": path,
                "target": f"media/aolink_screenshot_{index:02d}.png",
                "rid": f"rIdAolinkScreenshot{index:02d}",
                "caption": f"Capture - {caption}",
                "cx": 6_600_000,
                "cy": 5_050_000,
            }
        )
    return assets


def user_journey_screenshots_body() -> list[str]:
    assets = screenshot_assets()
    by_filename = {
        filename: asset
        for (filename, _, _), asset in zip(
            [item for item in USER_JOURNEY_SCREENSHOTS if (SCREENSHOTS_DIR / item[0]).exists()],
            assets,
        )
    }
    body = [
        page_break_xml(),
        paragraph_xml("Parcours utilisateur illustre", "Heading1"),
        paragraph_xml(
            "Cette section alimente le livrable avec des captures reelles de la démo AO Link. "
            "Elles suivent le parcours métier depuis la connexion jusqu'à l'administration."
        ),
    ]
    for filename, caption, description in USER_JOURNEY_SCREENSHOTS:
        asset = by_filename.get(filename)
        if not asset:
            continue
        body.append(paragraph_xml(description))
        body.extend(image_asset_xml(asset))
    body.append(
        paragraph_xml(
            "Note: la fiche Questions au niveau tour était désactivée dans l'état observé avant sélection d'un lot. "
            "Le parcours questions est donc documenté depuis l'onglet Questions du lot."
        )
    )
    return body

LIVRABLES = [
    {
        "number": "01",
        "title": "Application web operationnelle",
        "objective": "Montrer que l'application AO Link répond au besoin métier : centraliser les appels d'offres, structurer les lots et produire des analyses exploitables.",
        "audience": "Direction, utilisateurs métier, jury et futur repreneur fonctionnel.",
        "summary": [
            "Ce livrable présente l'outil tel qu'il est utilisé par l'entreprise. Il ne s'agit pas seulement d'un dépôt de code : le document explique le parcours de travail attendu, depuis la connexion jusqu'aux exports.",
            "L'objectif est de permettre à un lecteur non développeur de comprendre ce que fait AO Link, à quel moment il intervient dans la phase ACT et quels gains il apporte par rapport aux anciens fichiers Excel.",
        ],
        "key_points": [
            "AO Link centralise les projets, les tours, les lots, les entreprises et les offres.",
            "Le parcours utilisateur est structure autour de quelques écrans principaux : projets, tours, lots, questions et exports.",
            "Le livrable montre la valeur métier de l'application avant d'entrer dans les détails techniques.",
        ],
        "sources": ["docs/README.md", "docs/GUIDE_NAVIGATION.md"],
    },
    {
        "number": "02",
        "title": "Documentation technique",
        "objective": "Expliquer l'architecture, les choix techniques et le modèle de données pour rendre le projet compréhensible et maintenable.",
        "audience": "développeur, mainteneur, prestataire externe ou personne chargee de reprendre le projet.",
        "summary": [
            "Cette documentation sert de passerelle entre le fonctionnement métier et la réalisation technique. Elle explique comment l'application est organisée sans obliger le lecteur à analyser directement tout le code source.",
            "La partie Base de données est essentielle : elle montre comment les Données de l'appel d'offres sont reliees entre elles et pourquoi l'application peut suivre plusieurs tours de consultation sans perdre l'historique.",
        ],
        "key_points": [
            "L'application repose sur un backend Node.js, une interface web et une base PostgreSQL.",
            "Le modèle de données sépare les projets, lots, articles, entreprises, offres, tours et questions.",
            "Les schemas visuels remplacent les diagrammes techniques bruts pour faciliter la lecture.",
        ],
        "sources": ["docs/GUIDE_TECHNIQUE.md", "docs/SCHEMA_BASE_DONNEES.md"],
    },
    {
        "number": "03",
        "title": "Documentation de sécurité",
        "objective": "Documenter les risques identifies, les protections mises en place et les points de vigilance restant à suivre.",
        "audience": "Direction, mainteneur technique, jury et toute personne evaluant la fiabilite du projet.",
        "summary": [
            "AO Link manipule des données sensibles : offres d'entreprises, montants, droits utilisateurs et informations de projets. la sécurité n'est donc pas un sujet secondaire mais une condition de mise en service.",
            "Ce livrable reformule les audits et corrections de maniere plus lisible. Les extraits de code sont résumés afin de mettre en avant la logique de protection plutot que l'implementation ligne par ligne.",
        ],
        "key_points": [
            "Les principaux risques traites concernent l'authentification, les rôles, la configuration, les entrées utilisateur et les tokens.",
            "Les corrections appliquées réduisent les risques critiques et structurent une base de sécurité plus propre.",
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
        "title": "Scripts et fichiers de déploiement",
        "objective": "Expliquer comment l'application peut être installée, configurée et mise en production sur un environnement d'hébergement.",
        "audience": "Mainteneur, prestataire, administrateur système ou développeur charge du déploiement.",
        "summary": [
            "Un logiciel n'a de valeur pour l'entreprise que s'il peut être installe et relancé de façon fiable. Ce livrable rassemble les procédures de déploiement et les contrôles associes.",
            "Les commandes techniques sont conservées uniquement quand elles sont utiles à l'exploitation. Les gros blocs de configuration sont résumés pour rendre le document plus facile à utiliser.",
        ],
        "key_points": [
            "Le déploiement couvre les variables d'environnement, le serveur applicatif, le proxy, le HTTPS et les contrôles de bon fonctionnement.",
            "Les scripts servent a sécuriser les opérations répétitives et à limiter les oublis lors d'une mise en production.",
            "Le document distingue les actions de préparation, de lancement et de vérification.",
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
        "title": "Cahier de tests et résultats",
        "objective": "Montrer comment le fonctionnement de l'application a été vérifié et quels résultats valident le périmètre livre.",
        "audience": "Direction, jury, utilisateur métier et mainteneur.",
        "summary": [
            "Ce livrable apporte les preuves de validation du projet. Il explique les contrôles effectués et les résultats obtenus, afin de montrer que l'application ne repose pas uniquement sur une démonstration visuelle.",
            "La lecture est orientée vers la compréhension des scénarios testés : connexion, import, comparaison, Sécurité, génération des questions et stabilité générale.",
        ],
        "key_points": [
            "Les tests confirment les fonctions principales attendues sur le périmètre de la V1.",
            "Les résultats permettent d'identifier ce qui est valide et ce qui devra encore être consolide.",
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
        "audience": "Entreprise, mainteneur, futur développeur ou prestataire externe.",
        "summary": [
            "La maintenance garantit que l'outil reste utilisable apres la fin du projet. Elle couvre les sauvegardes, les migrations, les mises a jour et la reaction en cas d'incident.",
            "Ce livrable est important car AO Link a été développé par une personne principale. Une documentation claire limite la dependance a ce développeur unique.",
        ],
        "key_points": [
            "Les procédures de maintenance rendent l'application plus durable.",
            "Les contrôles réguliers portent sur la Base de données, les logs, les dépendances et la sécurité.",
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
        "title": "Annexes et documents de référence",
        "objective": "Regrouper les documents de cadrage et les references qui expliquent l'origine du besoin et le périmètre du projet.",
        "audience": "Jury, direction et lecteur souhaitant comprendre le contexte initial.",
        "summary": [
            "Ce livrable complete les documents précédents avec les supports de référence. Il donne du contexte : cahier des charges, Éléments de cadrage et documents qui ont servi à stabiliser le besoin.",
            "Il permet de relier les choix de développement aux attentes formulees au depart du projet.",
        ],
        "key_points": [
            "Le cahier des charges formalise le besoin métier initial.",
            "Les annexes donnent une trace des décisions et des supports de travail.",
            "Elles servent de justification documentaire au périmètre livre.",
        ],
        "sources": ["docs/_archive/reports/CAHIER_DES_CHARGES_AOLINK.md", "docs/unused-report.txt"],
    },
]


SOURCE_INTROS = {
    "docs/README.md": "Cette partie donne une vue d'ensemble du dépôt et de la documentation disponible. Elle sert de porte d'entrée pour comprendre rapidement le périmètre de l'application.",
    "docs/GUIDE_NAVIGATION.md": "Cette partie explique comment un utilisateur circule dans AO Link. Les schemas générés remplacent les diagrammes techniques afin de rendre le parcours plus lisible.",
    "docs/GUIDE_TECHNIQUE.md": "Cette partie présente l'architecture et les composants principaux. Elle permet à un mainteneur de comprendre l'organisation du projet sans lire immédiatement tout le code.",
    "docs/SCHEMA_BASE_DONNEES.md": "Cette partie explique le modèle de données. le schéma visuel montre les relations principales avant les tableaux de détail.",
    "docs/SECURITY.md": "Cette partie résume les mécanismes de sécurité effectivement visibles dans la version actuelle.",
    "docs/DEPLOY_VPS.md": "Cette partie décrit le déploiement sur VPS et les points de contrôle utiles pour exploiter l'application.",
    "docs/SETUP_DEMO.md": "Cette partie explique la mise en place d'un environnement de démonstration et les problèmes courants.",
    "docs/MAINTENANCE.md": "Cette partie formalise les contrôles et opérations utiles pour maintenir l'application dans le temps.",
}


def existing_sources(sources: list[str]) -> list[Path]:
    return [ROOT / source for source in sources if (ROOT / source).exists()]


def source_intro(source: Path) -> str:
    source_rel = rel(source)
    if source_rel in SOURCE_INTROS:
        return SOURCE_INTROS[source_rel]
    if "SECURITY" in source_rel.upper() or "audit" in source_rel.lower():
        return "Cette partie apporte une preuve ou un complément sur la securisation du projet. Les Éléments trop techniques sont résumés pour faire ressortir le risque, la mesure appliquée et l'impact."
    if "reports" in source_rel.lower() or "TEST" in source_rel.upper() or "VALIDATION" in source_rel.upper():
        return "Cette partie sert de trace de validation. Elle présente les résultats, les constats et les points de contrôle utiles pour justifier l'avancement du projet."
    if source.suffix.lower() == ".sh":
        return "Cette partie correspond à un script. Le livrable en donne la logique et les contrôles importants sans transformer le document en listing de code."
    return "Cette partie complete le livrable avec un document source du projet. Elle est conservée pour assurer la traçabilité de la documentation."


def livrable_body(livrable: dict) -> tuple[list[str], list[dict]]:
    sources = existing_sources(livrable["sources"])
    title = f"Livrable {livrable['number']} - {livrable['title']}"
    body = [
        *cover_page_xml(title, livrable["objective"]),
        paragraph_xml(title, "Heading1"),
        paragraph_xml(livrable["objective"]),
        paragraph_xml(f"Export généré le {datetime.now().strftime('%d/%m/%Y')}."),
        paragraph_xml(),
        paragraph_xml("Pour qui ?", "Heading2"),
        paragraph_xml(livrable["audience"]),
        paragraph_xml("synthèse du livrable", "Heading2"),
    ]
    for paragraph in livrable["summary"]:
        body.append(paragraph_xml(paragraph))

    body.append(paragraph_xml("Ce qu'il faut retenir", "Heading2"))
    for point in livrable["key_points"]:
        body.append(bullet_xml(point))

    if livrable["number"] == "01":
        body.extend(user_journey_screenshots_body())

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
        paragraph_xml(f"Export généré le {datetime.now().strftime('%d/%m/%Y')}."),
        paragraph_xml(),
    ]
    combined_body = [
        *cover_page_xml("Livrables AO Link", "Documentation complete regroupee"),
        paragraph_xml("Livrables AO Link - Documentation regroupee", "Heading1"),
        paragraph_xml("Document complet regroupant les sept livrables documentaires dans une version plus explicative et moins centrée sur le code."),
        paragraph_xml(f"Export généré le {datetime.now().strftime('%d/%m/%Y')}."),
        paragraph_xml(),
    ]
    combined_assets = screenshot_assets()
    manifest = []

    for index, livrable in enumerate(LIVRABLES, start=1):
        body, entries = livrable_body(livrable)
        file_name = f"Livrable_{livrable['number']}_{slugify(livrable['title'])}.docx"
        extra_assets = screenshot_assets() if livrable["number"] == "01" else []
        write_docx(OUT_DIR / file_name, body, extra_assets=extra_assets)

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
    write_docx(OUT_DIR / "Livrables_AO_Link_documentation_complete.docx", combined_body, extra_assets=combined_assets)
    (OUT_DIR / "manifest_livrables.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"Export termine : {len(LIVRABLES)} livrables + sommaire + document complet dans {OUT_DIR}")


if __name__ == "__main__":
    main()
