"""
Enrich cards.json with Kelly List frequency rank and CEFR level.

Sources:
- Kelly List (Språkbanken, Univ. Göteborg), CC-BY-4.0
- File: kelly.xls (Swedish-Kelly_M3_CEFR.xls)

Adds two fields to each card:
- freq_rank: int | null  -- rank 1..8425 in Kelly (lower = more frequent)
- cefr:      "A1".."C2" | null
"""
import json
import xlrd

KELLY_XLS = "kelly.xls"
CARDS_IN = "cards.json"
CARDS_OUT = "cards.json"


CEFR_ORDER = {"A1": 1, "A2": 2, "B1": 3, "B2": 4, "C1": 5, "C2": 6}

# Top-frequency function words that Kelly omits (lemmas for copula, conjunctions, etc.)
# All treated as A1, rank 0 (i.e. learn first).
BOOTSTRAP_A1 = {
    # conjunctions / copulas Kelly omits
    "och", "att vara", "eller", "ej",
    # pronouns (subject/object/reflexive/possessive)
    "inte", "någon", "de", "sig", "mig", "dig", "dem", "vår", "dess",
    # essential common verbs not in Kelly as verbs
    "att skola", "att ta", "att böra", "att ge", "att klä",
    # very common adverbs / temporal
    "sedan", "idag", "också", "istället", "nu för tiden",
}


def load_kelly():
    """Return dict: surface_form -> (rank, cefr).

    Only word-class-correct surface forms are stored, to avoid cross-class collisions
    (e.g., the noun 'en vara' must not match the card 'att vara').
    """
    wb = xlrd.open_workbook(KELLY_XLS)
    s = wb.sheet_by_name("Swedish_M3_CEFR")
    out = {}
    for r in range(1, s.nrows):
        rank = int(s.cell_value(r, 0))
        cefr = s.cell_value(r, 3).strip()
        lemma = s.cell_value(r, 6).strip()
        wclass = s.cell_value(r, 7).strip()
        if not lemma:
            continue
        if wclass == "verb":
            key = f"att {lemma}"
        elif wclass == "noun-en":
            key = f"en {lemma}"
        elif wclass == "noun-ett":
            key = f"ett {lemma}"
        else:
            key = lemma
        prev = out.get(key)
        if prev is None or rank < prev[0]:
            out[key] = (rank, cefr)
    return out


def main():
    kelly = load_kelly()
    print(f"Kelly entries (surface forms): {len(kelly)}")

    with open(CARDS_IN, "r", encoding="utf-8") as f:
        cards = json.load(f)

    matched = 0
    bootstrapped = 0
    cefr_counts = {}
    for c in cards:
        sw = (c.get("swedish") or "").strip()
        hit = kelly.get(sw)
        if not hit and "," in sw:
            # plural form like "en bok, två böcker" → try singular only
            hit = kelly.get(sw.split(",", 1)[0].strip())
        if hit:
            rank, cefr = hit
            c["freq_rank"] = rank
            c["cefr"] = cefr or None
            matched += 1
        elif sw in BOOTSTRAP_A1:
            c["freq_rank"] = 0
            c["cefr"] = "A1"
            bootstrapped += 1
        else:
            c["freq_rank"] = None
            c["cefr"] = None
        if c["cefr"]:
            cefr_counts[c["cefr"]] = cefr_counts.get(c["cefr"], 0) + 1

    print(f"Matched (Kelly): {matched} / {len(cards)} ({100*matched/len(cards):.1f}%)")
    print(f"Bootstrapped function words: {bootstrapped}")
    print(f"Unmatched: {len(cards) - matched - bootstrapped}")
    print(f"CEFR distribution: {cefr_counts}")

    # Quick sanity check on famous mis-tagged cards
    for probe in ["en svält", "analog", "och", "att vara", "att ha", "jag", "teoretisk", "fullkomligt", "i"]:
        for c in cards:
            if c.get("swedish") == probe:
                print(f"  {probe!r:20} memrise_level={c.get('level')} freq_rank={c.get('freq_rank')} cefr={c.get('cefr')}")
                break

    with open(CARDS_OUT, "w", encoding="utf-8") as f:
        json.dump(cards, f, ensure_ascii=False, indent=2)
    print(f"Wrote {CARDS_OUT}")


if __name__ == "__main__":
    main()
