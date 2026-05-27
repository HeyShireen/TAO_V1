from __future__ import annotations

from pathlib import Path

from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "docs" / "formation_aolink" / "captures"
EDGE = Path(r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe")
BASE_URL = "https://demo.ao-link.fr"
DEMO_EMAIL = "demo@ao-link.fr"
DEMO_PASSWORD = "DemoAoLink2026!"


def capture(page, name: str) -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    page.evaluate(
        """
        () => {
          document.querySelectorAll('.loader-overlay').forEach(el => el.classList.add('hidden'));
          document.querySelectorAll('#demo-tip-popover').forEach(el => el.classList.remove('is-visible'));
          window.scrollTo(0, 0);
        }
        """
    )
    page.wait_for_timeout(500)
    page.screenshot(path=OUT_DIR / f"{name}.png", full_page=False)
    print(f"capture: {name}.png")


def safe_click(page, selector: str, timeout: int = 5000) -> bool:
    try:
        locator = page.locator(selector).first
        locator.wait_for(state="visible", timeout=timeout)
        locator.scroll_into_view_if_needed()
        locator.click()
        page.wait_for_timeout(900)
        return True
    except PlaywrightTimeoutError:
        return False


def visible(page, selector: str) -> bool:
    return page.locator(selector).count() > 0 and page.locator(selector).first.is_visible()


def main() -> None:
    if not EDGE.exists():
        raise FileNotFoundError(EDGE)

    with sync_playwright() as p:
        browser = p.chromium.launch(
            executable_path=str(EDGE),
            headless=True,
            args=["--disable-extensions", "--no-first-run", "--no-default-browser-check"],
        )
        context = browser.new_context(
            viewport={"width": 1440, "height": 1100},
            locale="fr-FR",
            ignore_https_errors=True,
        )
        page = context.new_page()

        page.goto(BASE_URL + "/login", wait_until="networkidle", timeout=45_000)
        page.wait_for_selector("#login-form", timeout=20_000)
        capture(page, "01_connexion_compte_demo")

        # Les seuls champs envoyes sont email/password. Ne jamais ajouter website_url,
        # phone_number ou company_name, qui sont les champs honeypot serveur.
        page.locator("#login-email").fill(DEMO_EMAIL)
        page.locator("#login-password").fill(DEMO_PASSWORD)
        page.locator("#login-btn").click()
        page.wait_for_url("**/app", timeout=45_000)
        page.wait_for_selector("#projects-table tbody tr", timeout=45_000)
        capture(page, "02_liste_projets")

        if safe_click(page, "[data-edit-id]", timeout=2500):
            page.wait_for_selector("#edit-project-modal:not(.hidden)", timeout=10_000)
            capture(page, "03_modal_edition_projet")
            page.evaluate("document.querySelector('#edit-project-modal')?.classList.add('hidden')")

        if safe_click(page, "[data-share-id]", timeout=2500):
            page.wait_for_selector("#share-modal:not(.hidden)", timeout=10_000)
            capture(page, "04_modal_partage_projet")
            page.evaluate("document.querySelector('#share-modal')?.classList.add('hidden')")

        safe_click(page, "#projects-table tbody tr button.btn:not(.ghost)", timeout=15_000)
        page.wait_for_selector("#rounds-list", timeout=45_000)
        capture(page, "05_liste_tours")

        if safe_click(page, "[data-rounds-tab='rounds-compare-view']"):
            page.wait_for_selector("#rounds-compare-view:not(.hidden)", timeout=10_000)
            capture(page, "06_comparaison_tours")

        safe_click(page, "[data-rounds-tab='rounds-list-view']")
        if safe_click(page, ".round-card", timeout=10_000):
            page.wait_for_selector("#round-content:not(.hidden)", timeout=20_000)
            capture(page, "07_tour_liste_lots")

            if safe_click(page, "[data-tour-tab='tour-config']:not([disabled])", timeout=2500):
                capture(page, "08_tour_config_questions")

            if safe_click(page, "[data-tour-tab='tour-questions']:not([disabled])", timeout=2500):
                capture(page, "09_tour_fiches_questions")

            safe_click(page, "[data-tour-tab='tour-lots']")
            if safe_click(page, "#lots-table tbody tr button.btn", timeout=10_000):
                page.wait_for_selector("#tab-lot:not(.hidden)", timeout=30_000)
                capture(page, "10_lot_donnees_comparatif")

                if visible(page, "#mode-edit") and safe_click(page, "#mode-edit", timeout=2500):
                    capture(page, "11_lot_donnees_edition")

                if safe_click(page, "[data-subtab='subtab-questions-editor']", timeout=5000):
                    page.wait_for_selector("#subtab-questions-editor:not(.hidden)", timeout=20_000)
                    capture(page, "12_lot_questions")

                if visible(page, "[data-subtab='subtab-config']") and safe_click(page, "[data-subtab='subtab-config']", timeout=2500):
                    capture(page, "13_lot_config_questions")

        if safe_click(page, "[data-tab='tab-settings']", timeout=5000):
            page.wait_for_selector("#tab-settings:not(.hidden)", timeout=20_000)
            capture(page, "14_parametres")

        browser.close()


if __name__ == "__main__":
    main()
