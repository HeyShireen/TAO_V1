"""Régressions de l'aperçu multi-offres, avec API fictive et navigateur réel.

Lancer : python server/tests/import-isolation.browser.py
Prérequis : Playwright Python et Microsoft Edge (ou --browser CHEMIN).
Aucun serveur applicatif ni accès à la base de données n'est nécessaire.
"""

import argparse
import json
import re
import sys
from email import policy
from email.parser import BytesParser
from pathlib import Path

from playwright.sync_api import sync_playwright


PUBLIC = Path(__file__).resolve().parents[1] / "src" / "app" / "public"
ORIGIN = "http://127.0.0.1:9917"
FILES = ["Offre-A.xlsx", "Offre-B.xlsx", "Offre-C.xlsx"]
MAPPINGS = [
    {"num": [1], "designation": [2], "unit": 3, "qty": 4, "unit_price": 5, "amount": 6},
    {"num": [1], "designation": [2], "unit": 3, "qty": 5, "unit_price": 4, "amount": 6},
    {"num": [1], "designation": [2], "unit": 3, "qty": 6, "unit_price": 5, "amount": 4},
]


def multipart(request):
    message = BytesParser(policy=policy.default).parsebytes(
        ("Content-Type: " + request.header_value("content-type") + "\r\n\r\n").encode()
        + request.post_data_buffer
    )
    fields = {}
    for part in message.iter_parts():
        name = part.get_param("name", header="content-disposition")
        fields[name] = part.get_filename() or part.get_payload(decode=True).decode()
    return fields


class ImportPreview:
    def __init__(self, browser):
        self.context = browser.new_context(viewport={"width": 1500, "height": 1200})
        self.context.route("**/*", self.route)
        self.page = self.context.new_page()
        self.page.set_default_timeout(10000)
        self.errors = []
        self.page.on("pageerror", lambda error: self.errors.append(str(error)))
        self.hold_next = False
        self.fail_next = False
        self.pending = []
        self.preview_requests = []
        self.applied = []

    def route(self, route):
        request = route.request
        url = request.url
        if not url.startswith(ORIGIN + "/"):
            route.abort()
            return
        path = url[len(ORIGIN):].split("?")[0]
        if path.endswith("/import-preview"):
            fields = multipart(request)
            self.preview_requests.append(fields)
            if self.fail_next:
                self.fail_next = False
                route.fulfill(status=400, json={"error": "Échec fictif de l'aperçu"})
                return
            if self.hold_next:
                self.hold_next = False
                self.pending.append((route, fields))
                return
            self.fulfill_preview(route, fields)
        elif path.endswith("/import-apply"):
            fields = multipart(request)
            self.applied.append(json.loads(fields["params"]))
            route.fulfill(json={"mode": "offer", "matched": 2, "totalItems": 3})
        elif path == "/app":
            html = PUBLIC.joinpath("index.html").read_text(encoding="utf-8")
            # L'initialisation concerne uniquement la modale d'import. Les autres
            # écrans ne doivent ni s'authentifier ni effectuer de requêtes métier.
            html = re.sub(r"<script\b[^>]*>.*?</script>", "", html, flags=re.S)
            route.fulfill(content_type="text/html", body=html)
        elif not path.startswith("/api/") and PUBLIC.joinpath(path.lstrip("/")).is_file():
            asset = PUBLIC.joinpath(path.lstrip("/"))
            content_type = {".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png"}.get(asset.suffix)
            route.fulfill(path=str(asset), content_type=content_type)
        else:
            route.fulfill(status=404, json={"error": "Route absente de la fixture"})

    def fulfill_preview(self, route, fields):
        index = FILES.index(fields["file"])
        header = int(fields.get("headerRow") or (2 + index * 3))
        rows = [
            {"_rowNum": header + i, "1": str(i), "2": f"Poste {i}", "3": "m2",
             "4": 10 + i, "5": 20 + i, "6": 100 + i, "7": 30 + i}
            for i in range(1, 4)
        ]
        route.fulfill(json={
            "sheets": [f"Feuille {index + 1}"], "selectedSheet": f"Feuille {index + 1}",
            "headerRow": header, "headers": [{"index": i, "name": f"Colonne {i}"} for i in range(1, 8)],
            "suggestedMapping": MAPPINGS[index], "previewRows": rows, "totalRows": len(rows),
            "fileId": f"cache-{index}", "detectedOptionRows": [], "replaceImpact": {},
        })

    def load(self):
        self.page.goto(ORIGIN + "/app")
        self.page.add_script_tag(content=PUBLIC.joinpath("app.js").read_text(encoding="utf-8"))
        self.page.evaluate("""() => {
          currentLot = {id: 214}; currentRound = {id: 8}; currentProject = {id: 3};
          currentUser = {id: 1, role: 'responsable'}; lotCompanies = [];
          bindSmartImport(); document.querySelector('#open-import-modal').click();
        }""")
        self.page.locator("#import-modal").wait_for(state="visible")

    def select_files(self, count=3):
        self.load()
        self.page.locator("#import-mode-offer").click()
        self.page.locator("#import-file-input").set_input_files([
            {"name": name, "mimeType": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "buffer": name.encode()}
            for name in FILES[:count]
        ])
        for index in range(count):
            self.page.locator(".import-company-name-input").nth(index).fill(f"Entreprise {index + 1}")
        self.page.locator("#import-go-step2").click()
        self.wait_for_file(0)

    def wait_for_file(self, index):
        self.page.wait_for_function("index => importState.mappingOwnerIndex === index && !document.querySelector('#import-step-2').classList.contains('hidden') && document.querySelector('#global-loader').classList.contains('hidden')", arg=index)
        if self.page.locator("#import-toggle-controls").get_attribute("aria-expanded") == "false":
            self.page.locator("#import-toggle-controls").click()

    def modify_first(self):
        self.page.locator('#import-preview-head select[data-col-idx="7"]').select_option("qty")
        self.page.locator('#import-preview-body button[title="Supprimer cette ligne"]').first.click()

    def snapshot(self):
        return self.page.evaluate("() => ({mapping: importState.mapping, excluded: [...importState.excludedRows], header: importState.preview.headerRow, owner: importState.mappingOwnerIndex})")

    def close(self):
        for route, _ in self.pending:
            try:
                route.abort()
            except Exception:
                pass
        self.context.unroute_all(behavior="ignoreErrors")
        self.context.close()


def independent_files(app):
    app.select_files()
    app.modify_first()
    first = app.snapshot()
    app.page.locator("#import-next-file").click()
    app.wait_for_file(1)
    second = app.snapshot()
    assert second["mapping"] == first["mapping"], f"Le premier mapping n'a pas été repris par B : {second}"
    assert second["excluded"] == [], f"Exclusions recopiées sur B : {second}"
    assert second["header"] == 5, f"L'en-tête de A a été imposé à B : {second}"
    app.page.locator('#import-preview-head select[data-col-idx="6"]').select_option("")
    app.page.locator('#import-preview-head select[data-col-idx="3"]').select_option("designation")
    app.page.locator('#import-preview-body button[title="Supprimer cette ligne"]').nth(1).click()
    second = app.snapshot()
    app.page.locator("#import-prev-file").click()
    app.wait_for_file(0)
    assert app.snapshot() == first, "Les réglages du premier fichier n'ont pas été conservés"
    # Même le premier fichier devient indépendant une fois le mapping copié.
    app.page.locator('#import-preview-head select[data-col-idx="4"]').select_option("qty")
    app.page.locator("#import-next-file").click()
    app.wait_for_file(1)
    assert app.snapshot() == second, "Les modifications de B ont été écrasées en repassant par A"
    app.page.locator("#import-next-file").click()
    app.wait_for_file(2)
    assert app.snapshot()["mapping"] == first["mapping"], "C a reçu les retouches de A ou B au lieu du mapping initial"
    assert app.snapshot()["excluded"] == []


def interrupted_navigation(app):
    app.select_files()
    app.modify_first()
    first = app.snapshot()
    app.hold_next = True
    app.page.locator("#import-next-file").click()
    # Le brouillon automatique se déclenche avant que l'aperçu B ne réponde.
    app.page.wait_for_timeout(500)
    app.page.reload()
    app.load()
    app.page.locator("#notify-ok").click()
    app.page.locator("#import-toggle-controls").click()
    restored = app.snapshot()
    assert restored["owner"] == 0, f"L'aperçu de A a été restauré sous le fichier B : {restored}"
    assert restored == first, "Le brouillon ne décrit plus le fichier affiché avant l'interruption"
    app.page.locator("#import-next-file").click()
    app.wait_for_file(1)
    assert app.snapshot()["mapping"] == first["mapping"], "Le mapping initial a été perdu à la restauration"
    assert app.snapshot()["excluded"] == [], "La restauration du brouillon a transmis les exclusions à B"


def batch_payloads(app):
    app.select_files()
    app.modify_first()
    base_mapping = app.snapshot()["mapping"]
    app.page.locator("#import-confirm").click()
    app.page.locator("#import-step-3").wait_for(state="visible")
    assert len(app.applied) == 3
    assert app.applied[0]["mapping"]["qty"] == 7
    assert app.applied[0]["excludedRows"] == [3]
    for index in (1, 2):
        params = app.applied[index]
        assert params["mapping"] == base_mapping, f"Le fichier {index + 1} n'a pas hérité du premier mapping : {params}"
        assert params["excludedRows"] == []
        assert params["headerRow"] == 2 + index * 3
        assert params["sheetName"] == f"Feuille {index + 1}"


def empty_mapping_blocks_batch(app):
    app.select_files()
    app.page.locator("#import-next-file").click()
    app.wait_for_file(1)
    for column in range(1, 8):
        app.page.locator(f'#import-preview-head select[data-col-idx="{column}"]').select_option("")
    app.page.locator("#import-prev-file").click()
    app.wait_for_file(0)
    app.page.locator("#import-next-file").click()
    app.wait_for_file(1)
    assert app.snapshot()["mapping"] == {}, "Les colonnes retirées ont été rétablies automatiquement"
    app.page.locator("#import-prev-file").click()
    app.wait_for_file(0)
    app.page.locator("#import-confirm").click()
    app.page.locator("#notify-modal").wait_for(state="visible")
    assert FILES[1] in app.page.locator("#notify-message").inner_text()
    assert app.applied == [], "Une offre a été importée avant la validation du mapping de toutes les offres"


def removing_file_keeps_owners(app):
    app.select_files()
    app.modify_first()
    base_mapping = app.snapshot()["mapping"]
    app.page.locator("#import-next-file").click()
    app.wait_for_file(1)
    app.page.locator('#import-preview-body button[title="Supprimer cette ligne"]').nth(1).click()
    second = app.snapshot()
    app.page.locator("#import-back-step1").click()
    app.page.locator('.btn-remove-file[data-file-index="0"]').click()
    app.page.locator("#import-go-step2").click()
    app.wait_for_file(0)
    second["owner"] = 0
    assert app.snapshot() == second, "Retirer A a déplacé les réglages de B vers un autre fichier"
    app.page.locator("#import-next-file").click()
    app.wait_for_file(1)
    assert app.snapshot()["mapping"] == base_mapping
    assert app.snapshot()["excluded"] == []


def header_and_failed_preview(app):
    app.select_files()
    app.page.locator("#import-header-row").fill("4")
    app.page.locator("#import-header-row").press("Tab")
    app.page.wait_for_function("() => importState.preview.headerRow === 4 && document.querySelector('#global-loader').classList.contains('hidden')")
    app.modify_first()
    first = app.snapshot()
    app.fail_next = True
    app.page.locator("#import-next-file").click()
    app.page.locator("#notify-modal").wait_for(state="visible")
    app.page.locator("#notify-ok").click()
    assert app.snapshot() == first, "L'échec du chargement de B a changé l'offre courante"
    app.page.locator("#import-next-file").click()
    app.wait_for_file(1)
    assert app.snapshot()["header"] == 5
    assert app.snapshot()["excluded"] == []
    app.page.locator("#import-prev-file").click()
    app.wait_for_file(0)
    assert app.snapshot() == first


def added_file_inherits_original_mapping(app):
    app.select_files(count=2)
    app.modify_first()
    first = app.snapshot()
    app.page.locator("#import-next-file").click()
    app.wait_for_file(1)
    app.page.locator('#import-preview-head select[data-col-idx="4"]').select_option("qty")
    app.page.locator('#import-preview-head select[data-col-idx="3"]').select_option("designation")
    second = app.snapshot()
    app.page.locator("#import-modal-close").click()
    app.page.wait_for_timeout(500)
    app.load()
    app.page.locator("#notify-ok").click()
    app.wait_for_file(1)
    assert app.snapshot() == second
    app.page.locator("#import-back-step1").click()
    app.page.locator("#import-file-input").set_input_files([
        {"name": FILES[2], "mimeType": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "buffer": FILES[2].encode()}
    ])
    app.page.locator(".import-company-name-input").nth(2).fill("Entreprise 3")
    app.page.locator('.btn-open-config[data-file-index="2"]').click()
    app.wait_for_file(2)
    assert app.snapshot()["mapping"] == first["mapping"], "Le fichier ajouté après restauration a reçu les retouches de B"
    assert app.snapshot()["excluded"] == []
    app.page.locator("#import-confirm").click()
    app.page.locator("#import-step-3").wait_for(state="visible")
    assert [params["mapping"] for params in app.applied] == [first["mapping"], second["mapping"], first["mapping"]]
    assert [params["excludedRows"] for params in app.applied] == [[3], [], []]


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--browser", default=r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe")
    parser.add_argument("--screenshots", type=Path)
    args = parser.parse_args()
    failures = []
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=args.browser, headless=True)
        for scenario in (independent_files, interrupted_navigation, batch_payloads,
                         empty_mapping_blocks_batch, removing_file_keeps_owners, header_and_failed_preview,
                         added_file_inherits_original_mapping):
            app = ImportPreview(browser)
            try:
                scenario(app)
                assert not app.errors, app.errors
                print(f"OK {scenario.__name__}")
            except Exception as error:
                failures.append(scenario.__name__)
                print(f"ECHEC {scenario.__name__}: {error}")
            finally:
                if args.screenshots:
                    args.screenshots.mkdir(parents=True, exist_ok=True)
                    app.page.screenshot(path=str(args.screenshots / f"{scenario.__name__}.png"))
                app.close()
        browser.close()
    raise SystemExit(1 if failures else 0)


if __name__ == "__main__":
    main()
