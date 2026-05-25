"""
Enrich cards.json with example sentences (Swedish + French) and verb conjugations.

Uses Claude Haiku via the Anthropic API. Batches ~20 cards per call.

Adds an `enrichment` object to each card:
  {
    "example_sv": "Jag talar svenska.",
    "example_fr": "Je parle suédois.",
    "conjugation": {"present": "talar", "preterite": "talade", "supine": "talat"}
      # verbs only; omitted otherwise
  }

Usage:
  ANTHROPIC_API_KEY=... python3 enrich_examples.py [--cefr A1,A2] [--limit N] [--force]
"""
import argparse
import json
import os
import sys
import time
from pathlib import Path

try:
    from anthropic import Anthropic
except ImportError:
    sys.exit("pip install anthropic")

CARDS_PATH = Path(__file__).parent / "cards.json"
MODEL = "claude-haiku-4-5-20251001"
BATCH_SIZE = 20

SYSTEM = """Tu es un linguiste suédophone qui prépare des fiches pour un francophone débutant (A1-B1).

Pour chaque carte (lemme suédois + traduction anglaise indicative), produis :
- example_sv : UNE phrase suédoise courte (5-10 mots), naturelle, utilisant le mot dans son sens principal. Sujet explicite (jag / du / hon / vi …). Pas d'idiome rare.
- example_fr : traduction française naturelle de cette phrase, fidèle au sens.
- conjugation : UNIQUEMENT pour les verbes (lemme commençant par "att "). Donne les 3 formes principales :
    * present  (ex: talar)
    * preterite (ex: talade)
    * supine    (ex: talat, SANS "har")
  Pour les autres POS, omets entièrement la clé conjugation.

Règles strictes :
- Phrase d'exemple TOUJOURS au présent simple si possible, sinon prétérit.
- Pour les prépositions/conjonctions/adverbes : phrase qui montre clairement leur usage (ex: "som" → "Han är stark som en björn.").
- Sortie : JSON pur, un tableau d'objets dans l'ordre reçu, sans markdown, sans commentaire.
- Format : [{"id": 123, "example_sv": "...", "example_fr": "...", "conjugation": {...}}, ...]
- Pour les non-verbes : [{"id": 124, "example_sv": "...", "example_fr": "..."}]
"""


def build_user_prompt(batch):
    lines = []
    for c in batch:
        pos = c.get("pos") or "?"
        lines.append(
            f'- id={c["id"]}  sv="{c["swedish"]}"  en="{c.get("english","")}"  pos="{pos}"'
        )
    return "Génère les enrichissements pour ces cartes :\n" + "\n".join(lines)


def call_llm(client, batch):
    msg = client.messages.create(
        model=MODEL,
        max_tokens=4096,
        system=SYSTEM,
        messages=[{"role": "user", "content": build_user_prompt(batch)}],
    )
    text = msg.content[0].text.strip()
    # Strip possible code fences
    if text.startswith("```"):
        text = text.split("\n", 1)[1]
        if text.endswith("```"):
            text = text.rsplit("```", 1)[0]
        if text.startswith("json"):
            text = text[4:]
    return json.loads(text)


def needs_enrichment(card, force):
    if force:
        return True
    e = card.get("enrichment")
    if not e:
        return True
    if not e.get("example_sv") or not e.get("example_fr"):
        return True
    if (card.get("pos") or "").startswith("verb") or (card.get("swedish") or "").startswith("att "):
        if not e.get("conjugation"):
            return True
    return False


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cefr", default="A1,A2", help="comma-separated CEFR levels to process")
    ap.add_argument("--limit", type=int, default=0, help="max cards to enrich (0 = all)")
    ap.add_argument("--force", action="store_true", help="re-enrich even if already done")
    ap.add_argument("--save-every", type=int, default=5, help="save after N batches")
    args = ap.parse_args()

    levels = {x.strip() for x in args.cefr.split(",") if x.strip()}
    client = Anthropic()

    cards = json.loads(CARDS_PATH.read_text(encoding="utf-8"))
    by_id = {c["id"]: c for c in cards}

    todo = [c for c in cards if c.get("cefr") in levels and needs_enrichment(c, args.force)]
    if args.limit:
        todo = todo[: args.limit]
    print(f"Cards to enrich: {len(todo)} (cefr={sorted(levels)}, limit={args.limit or '—'})")

    if not todo:
        return

    batches = [todo[i : i + BATCH_SIZE] for i in range(0, len(todo), BATCH_SIZE)]
    done = 0
    for bi, batch in enumerate(batches, 1):
        for attempt in range(3):
            try:
                results = call_llm(client, batch)
                break
            except Exception as e:
                print(f"  batch {bi} attempt {attempt+1} failed: {e}")
                time.sleep(2 * (attempt + 1))
        else:
            print(f"  batch {bi} GIVEN UP")
            continue

        got = 0
        for r in results:
            cid = r.get("id")
            c = by_id.get(cid)
            if not c:
                continue
            enr = {"example_sv": r.get("example_sv"), "example_fr": r.get("example_fr")}
            if r.get("conjugation"):
                enr["conjugation"] = r["conjugation"]
            c["enrichment"] = enr
            got += 1
        done += got
        print(f"  batch {bi}/{len(batches)}: +{got}  (total {done}/{len(todo)})")

        if bi % args.save_every == 0:
            CARDS_PATH.write_text(
                json.dumps(cards, ensure_ascii=False, indent=2), encoding="utf-8"
            )

    CARDS_PATH.write_text(
        json.dumps(cards, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"Done. Enriched {done} cards. Wrote {CARDS_PATH.name}")


if __name__ == "__main__":
    main()
