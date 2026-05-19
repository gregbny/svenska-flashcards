#!/usr/bin/env python3
"""
Extraction du deck Anki .apkg -> cards.json + dossier media/

Usage:
    python3 extract.py 8000_most_common_swedish_words.apkg

Spécifique au deck Memrise "8000 most common Swedish words" (4 sous-modèles
avec des indices DIFFÉRENTS pour POS / Gender / Example / Pronunciation).
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
    for f in fields:
        m = AUDIO_RE.search(f)
        if m:
            return m.group(1)
    return None


def build_field_map(models):
    """
    Construit pour chaque mid un dict {logical_name: field_index}.
    Couvre Swedish, Swedish Alternatives, English, Pronunciation, Part of Speech,
    Gender, Example, Audio, Level.
    """
    LOGICAL = {
        'Swedish': 'swedish',
        'Swedish Alternatives': 'alternatives',
        'English': 'english',
        'Pronunciation': 'phonetic',
        'Part of Speech': 'pos',
        'Gender': 'gender',
        'Example': 'example',
        'Audio': 'audio',
        'Level': 'level',
    }
    out = {}
    for mid, model in models.items():
        m = {}
        for i, f in enumerate(model['flds']):
            key = LOGICAL.get(f['name'])
            if key:
                m[key] = i
        out[int(mid)] = m
    return out


def get(fields, idx):
    if idx is None or idx >= len(fields):
        return ""
    return fields[idx]


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
        models = json.loads(conn.execute("SELECT models FROM col").fetchone()[0])
        field_map = build_field_map(models)
        print(f"{len(field_map)} modèles analysés.")

        rows = conn.execute("SELECT id, mid, flds FROM notes").fetchall()
        conn.close()
        print(f"{len(rows)} notes trouvées.")

        cards = []
        copied = 0
        for note_id, mid, flds in rows:
            fields = flds.split("\x1f")
            fm = field_map.get(mid, {})

            swedish = clean(get(fields, fm.get('swedish')))
            english = clean(get(fields, fm.get('english')))
            if not swedish or not english:
                continue

            alternatives = clean(get(fields, fm.get('alternatives')))
            phonetic = clean(get(fields, fm.get('phonetic')))
            pos = clean(get(fields, fm.get('pos')))
            gender = clean(get(fields, fm.get('gender')))
            example = clean(get(fields, fm.get('example')))
            level_raw = clean(get(fields, fm.get('level')))

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
                "alternatives": alternatives or None,
                "audio_file": audio_out_name,
                "level": level,
                "pos": pos or None,
                "gender": gender or None,
                "example": example or None,
                "phonetic": phonetic or None,
            })

        cards.sort(key=lambda c: (c["level"] is None, c["level"] if c["level"] is not None else 9999, c["id"]))

        cards_json = out_dir / "cards.json"
        cards_json.write_text(
            json.dumps(cards, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        print(f"OK: {len(cards)} cartes -> {cards_json}")
        print(f"OK: {copied} nouveaux fichiers audio -> {media_out}")
        for key in ('alternatives', 'phonetic', 'pos', 'gender', 'example', 'audio_file', 'level'):
            n = sum(1 for c in cards if c.get(key))
            print(f"  {key:14}: {n}/{len(cards)} renseignés")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("Usage: python3 extract.py <fichier.apkg>")
    main(sys.argv[1])
