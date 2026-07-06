from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
CAPTURES_DIR = ROOT / "docs" / "formation_aolink" / "captures"
OUT_PATH = ROOT / "docs" / "formation_aolink" / "parcours_utilisateur_aolink.gif"

OUTPUT_WIDTH = 1280
OUTPUT_HEIGHT = 720
BANNER_HEIGHT = 90
FRAME_DURATION_MS = 2100
INTRO_DURATION_MS = 2600
OUTRO_DURATION_MS = 3000


STEPS = [
    ("01_connexion_compte_demo.png", "1/27 - Connexion au compte demo"),
    ("02_liste_projets.png", "2/27 - Tableau de bord des projets"),
    ("03_modal_edition_projet.png", "3/27 - Edition des informations projet"),
    ("04_modal_partage_projet.png", "4/27 - Partage du projet"),
    ("05_liste_tours.png", "5/27 - Liste des tours"),
    ("05_modal_export_rao.png", "6/27 - Export RAO / dossier affaire"),
    ("05_modal_edition_tour.png", "7/27 - Edition d'un tour"),
    ("06_comparaison_tours.png", "8/27 - Comparaison des tours"),
    ("06_selection_options_tours.png", "9/27 - Selection des options"),
    ("06_simulation_tours.png", "10/27 - Simulation de choix entreprises"),
    ("06_modal_export_comparaison_tours.png", "11/27 - Export de la comparaison"),
    ("07_tour_liste_lots.png", "12/27 - Liste des lots d'un tour"),
    ("07_modal_creation_lot.png", "13/27 - Creation d'un lot"),
    ("07_modal_edition_lot.png", "14/27 - Edition d'un lot"),
    ("07_modal_import_dpgf_lots.png", "15/27 - Import DPGF pour creer les lots"),
    ("07_modal_export_phase.png", "16/27 - Export de la phase"),
    ("08_tour_config_questions.png", "17/27 - Configuration globale des questions"),
    ("10_lot_donnees_comparatif.png", "18/27 - Comparatif d'un lot"),
    ("10_modal_export_lot_comparatif.png", "19/27 - Export du comparatif de lot"),
    ("11_lot_donnees_edition.png", "20/27 - Edition des donnees"),
    ("11_modal_import_lot.png", "21/27 - Import dans un lot"),
    ("11_modal_export_donnees_edition.png", "22/27 - Export des donnees"),
    ("12_lot_questions.png", "23/27 - Questions du lot"),
    ("12_modal_edition_questions.png", "24/27 - Edition des questions"),
    ("12_modal_envoi_questions.png", "25/27 - Suivi et envoi des questions"),
    ("13_lot_config_questions.png", "26/27 - Configuration des questions du lot"),
    ("14_parametres.png", "27/27 - Parametres et administration"),
]


def load_font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    candidates = [
        Path("C:/Windows/Fonts/arialbd.ttf" if bold else "C:/Windows/Fonts/arial.ttf"),
        Path("C:/Windows/Fonts/segoeuib.ttf" if bold else "C:/Windows/Fonts/segoeui.ttf"),
    ]
    for path in candidates:
        if path.exists():
            return ImageFont.truetype(str(path), size=size)
    return ImageFont.load_default()


TITLE_FONT = load_font(32, bold=True)
BODY_FONT = load_font(21)
SMALL_FONT = load_font(16)


def cover_image_from_top(image: Image.Image, width: int, height: int) -> Image.Image:
    ratio = max(width / image.width, height / image.height)
    width = int(image.width * ratio)
    resized_height = int(image.height * ratio)
    resized = image.resize((width, resized_height), Image.Resampling.LANCZOS)
    left = max((resized.width - OUTPUT_WIDTH) // 2, 0)
    return resized.crop((left, 0, left + OUTPUT_WIDTH, height))


def draw_banner(draw: ImageDraw.ImageDraw, size: tuple[int, int], label: str) -> None:
    width, _ = size
    draw.rectangle((0, 0, width, BANNER_HEIGHT), fill=(12, 24, 30))
    draw.rectangle((0, BANNER_HEIGHT - 3, width, BANNER_HEIGHT), fill=(76, 126, 148))
    draw.text((30, 16), "AO Link - parcours utilisateur", font=TITLE_FONT, fill=(238, 246, 249))
    draw.text((30, 58), label, font=BODY_FONT, fill=(188, 212, 222))


def make_frame(filename: str, label: str) -> Image.Image:
    source = Image.open(CAPTURES_DIR / filename).convert("RGB")
    content_height = OUTPUT_HEIGHT - BANNER_HEIGHT
    content = cover_image_from_top(source, OUTPUT_WIDTH, content_height)
    frame = Image.new("RGB", (OUTPUT_WIDTH, OUTPUT_HEIGHT), (232, 237, 241))
    frame.paste(content, (0, BANNER_HEIGHT))
    draw = ImageDraw.Draw(frame)
    draw_banner(draw, frame.size, label)
    return frame


def make_title_frame(title: str, subtitle: str, duration_label: str = "") -> Image.Image:
    frame = Image.new("RGB", (OUTPUT_WIDTH, OUTPUT_HEIGHT), (12, 24, 30))
    draw = ImageDraw.Draw(frame)
    draw.rectangle((0, OUTPUT_HEIGHT - 10, OUTPUT_WIDTH, OUTPUT_HEIGHT), fill=(76, 126, 148))
    draw.text((62, 112), title, font=TITLE_FONT, fill=(238, 246, 249))
    draw.text((62, 168), subtitle, font=BODY_FONT, fill=(188, 212, 222))
    if duration_label:
        draw.text((62, OUTPUT_HEIGHT - 86), duration_label, font=SMALL_FONT, fill=(140, 169, 182))
    return frame


def quantize(frame: Image.Image) -> Image.Image:
    return frame.quantize(colors=128, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.FLOYDSTEINBERG)


def main() -> None:
    missing = [filename for filename, _ in STEPS if not (CAPTURES_DIR / filename).exists()]
    if missing:
        raise FileNotFoundError("Captures manquantes: " + ", ".join(missing))

    frames = [
        make_title_frame(
            "AO Link",
            "Parcours utilisateur complet dans l'application",
            "Connexion -> projets -> tours -> lots -> questions -> administration",
        )
    ]
    frames.extend(make_frame(filename, label) for filename, label in STEPS)
    frames.append(make_title_frame("Fin du parcours", "Les fonctions principales sont couvertes."))

    durations = [INTRO_DURATION_MS] + [FRAME_DURATION_MS] * len(STEPS) + [OUTRO_DURATION_MS]
    paletted_frames = [quantize(frame) for frame in frames]

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    paletted_frames[0].save(
        OUT_PATH,
        save_all=True,
        append_images=paletted_frames[1:],
        duration=durations,
        loop=0,
        optimize=True,
        disposal=2,
    )

    size_mb = OUT_PATH.stat().st_size / (1024 * 1024)
    print(f"GIF cree: {OUT_PATH.relative_to(ROOT)} ({len(frames)} frames, {size_mb:.1f} Mo)")


if __name__ == "__main__":
    main()
