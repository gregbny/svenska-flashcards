#!/usr/bin/env python3
"""
Extraction du deck Anki .apkg -> cards.json + dossier media/

Usage:
    python3 extract.py 8000_most_common_swedish_words.apkg

Produit :
    - cards.json    : [{ id, swedish, english, audio_file }, ...]
    - media/        : tous les fichiers audio renommés depuis leurs numéros
"""

import json
import os
import re
import shutil
import sqlite3
import sys
import tempfile
import zipfile
from pathlib import Path

AUDIO_RE = re.compile(r"\[sound:([^\]]+)\]")
HTML_RE = re.compile(r"<[^>]+>")


def clean(text: str) -> str:
    """Strip HTML tags and [sound:] markers, collapse whitespace."""
    text = AUDIO_RE.sub("", text)
    text = HTML_RE.sub("", text)
    text = text.replace("&nbsp;", " ").replace("&amp;", "&")
    return " ".join(text.split()).strip()


def extract_audio(fields):
    for f in fields:
        m = AUDIO_RE.search(f)
        if m:
            return m.group(1)
    return None


def main(apkg_path: str) -> None:
    apkg = Path(apkg_path).resolve()
    if not apkg.exists():
        sys.exit(f"Fichier introuvable: {apkg}")

    out_dir = apkg.parent
    media_out = out_dir / "media"
    media_out.mkdir(exist_ok=True)

    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        print(f"Décompression {apkg.name}...")
        with zipfile.ZipFile(apkg, "r") as zf:
            zf.extractall(tmp_path)

        # Anki stocke un mapping {numéro: nom_fichier_original} dans "media"
        media_map_file = tmp_path / "media"
        media_map = {}
        if media_map_file.exists():
            media_map = json.loads(media_map_file.read_text(encoding="utf-8"))

        # Trouver la base SQLite (collection.anki2 ou .anki21)
        db_path = None
        for candidate in ("collection.anki21", "collection.anki2"):
            p = tmp_path / candidate
            if p.exists():
                db_path = p
                break
        if not db_path:
            sys.exit("Aucune base collection.anki2(1) trouvée dans le .apkg")

        print(f"Lecture de {db_path.name}...")
        conn = sqlite3.connect(db_path)
        rows = conn.execute("SELECT id, flds FROM notes").fetchall()
        conn.close()
        print(f"{len(rows)} notes trouvées.")

        cards = []
        copied = 0
        for note_id, flds in rows:
            fields = flds.split("\x1f")
            if len(fields) < 2:
                continue

            audio_filename = extract_audio(fields)
            cleaned = [clean(f) for f in fields]
            non_empty = [c for c in cleaned if c]
            if len(non_empty) < 2:
                continue

            swedish = non_empty[0]
            english = non_empty[1]

            audio_out_name = None
            if audio_filename:
                # Trouver le numéro correspondant dans media_map
                num = next(
                    (k for k, v in media_map.items() if v == audio_filename),
                    None,
                )
                if num is not None:
                    src = tmp_path / num
                    if src.exists():
                        dst = media_out / audio_filename
                        if not dst.exists():
                            shutil.copy2(src, dst)
                            copied += 1
                        audio_out_name = audio_filename

            cards.append(
                {
                    "id": note_id,
                    "swedish": swedish,
                    "english": english,
                    "audio_file": audio_out_name,
                }
            )

        cards_json = out_dir / "cards.json"
        cards_json.write_text(
            json.dumps(cards, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        print(f"OK: {len(cards)} cartes -> {cards_json}")
        print(f"OK: {copied} fichiers audio -> {media_out}")
        print(
            "\nProchaine étape: zipper le dossier media/ et l'AirDrop sur iPhone "
            "pour l'import dans la PWA."
        )


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("Usage: python3 extract.py <fichier.apkg>")
    main(sys.argv[1])
