#!/usr/bin/env python3
"""
Extraction du deck Anki .apkg -> cards.json + dossier media/

Usage:
    python3 extract.py 8000_most_common_swedish_words.apkg

Produit :
    - cards.json    : [{ id, swedish, english, audio_file, level, pos, example, phonetic }]
    - media/        : tous les fichiers audio renommés

Spécifique au deck Memrise "8000 most common Swedish words" (4 sous-modèles).
Structure des champs :
    [0]  Swedish               ← recto
    [1]  Swedish Alternatives  (conjugaisons)
    [4]  English               ← verso
    [8]  Pronunciation         (Part 1 uniquement)
    [9]  Part of Speech        (Part 1, Part 2, Part 3) — [10] dans Part 4 ? non, c'est [9]
    [10] Example               (Parts 2-4)
    [12] Level                 (1 = mot le plus fréquent)
"""

import json
import re
import shutil
import sqlite3
import sys
import tempfile
import zipfile
from pathlib import Path

AUDIO_RE = re.compile(r"\[sound:([^\]]+)\]")
HTML_RE = re.compile(r"<[^>]+>")


def clean(text):
    text = AUDIO_RE.sub("", text)
    text = HTML_RE.sub("", text)
    text = text.replace("&nbsp;", " ").replace("&amp;", "&")
    return " ".join(text.split()).strip()


def extract_audio_from_fields(fields):
    """Cherche [sound:xxx] dans tous les champs."""
    for f in fields:
        m = AUDIO_RE.search(f)
        if m:
            return m.group(1)
    return None


def safe(fields, idx):
    return fields[idx] if idx < len(fields) else ""


def main(apkg_path):
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

        media_map_file = tmp_path / "media"
        media_map = {}
        if media_map_file.exists():
            media_map = json.loads(media_map_file.read_text(encoding="utf-8"))
        rev_map = {v: k for k, v in media_map.items()}

        db_path = None
        for c in ("collection.anki21", "collection.anki2"):
            p = tmp_path / c
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
            if len(fields) < 5:
                continue

            swedish = clean(safe(fields, 0))
            english = clean(safe(fields, 4))
            phonetic = clean(safe(fields, 8))
            pos = clean(safe(fields, 9))
            example = clean(safe(fields, 10))
            level_raw = clean(safe(fields, 12))

            if not swedish or not english:
                continue

            try:
                level = int(level_raw) if level_raw else None
            except ValueError:
                level = None

            audio_filename = extract_audio_from_fields(fields)
            audio_out_name = None
            if audio_filename:
                num = rev_map.get(audio_filename)
                if num is not None:
                    src = tmp_path / num
                    if src.exists():
                        dst = media_out / audio_filename
                        if not dst.exists():
                            shutil.copy2(src, dst)
                            copied += 1
                        audio_out_name = audio_filename

            cards.append({
                "id": note_id,
                "swedish": swedish,
                "english": english,
                "audio_file": audio_out_name,
                "level": level,
                "pos": pos or None,
                "example": example or None,
                "phonetic": phonetic or None,
            })

        # Tri par level (fréquence) — None à la fin
        cards.sort(key=lambda c: (c["level"] is None, c["level"] if c["level"] is not None else 9999, c["id"]))

        cards_json = out_dir / "cards.json"
        cards_json.write_text(
            json.dumps(cards, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        print(f"OK: {len(cards)} cartes -> {cards_json}")
        print(f"OK: {copied} nouveaux fichiers audio -> {media_out}")
        with_audio = sum(1 for c in cards if c["audio_file"])
        print(f"Cartes avec audio: {with_audio}/{len(cards)}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("Usage: python3 extract.py <fichier.apkg>")
    main(sys.argv[1])
