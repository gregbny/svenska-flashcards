# Handover — Enrichissement cards.json (A1+A2)

## Contexte
On enrichit `cards.json` (PWA d'apprentissage du suédois) avec, pour chaque carte de niveau A1 ou A2 :
- `example_sv` : phrase d'exemple courte en suédois (5-10 mots, sujet explicite, présent de préférence)
- `example_fr` : traduction française fidèle
- `conjugation` : `{present, preterite, supine}` UNIQUEMENT si la carte est un verbe (lemme `att …` ou pos contient `verb`). Supine sans `har`.

L'app affiche déjà ces champs proprement (cf. `js/app.js:renderConjugation` + `js/app.js:renderFlash`). Il ne manque que la donnée.

## État actuel
2663 cartes A1+A2 ont été splittées en 20 chunks (134 cartes chacun) dans `/tmp/enrich/input_NN.json` (NN = 00..19).

Les chunks déjà produits dans `/tmp/enrich/output_NN.json` :
- 00, 01, 02, 03, 04, 05, 06 → OK
- les autres : à refaire ou en attente

## Format d'entrée (`input_NN.json`)
```json
[
  {"id": 1598022787258, "swedish": "och", "english": "and", "pos": "conjunction"},
  ...
]
```

## Format de sortie attendu (`output_NN.json`)
```json
[
  {"id": 1598022787258, "example_sv": "Han och hon är vänner.", "example_fr": "Lui et elle sont amis."},
  {"id": 1598022787263, "example_sv": "Jag är trött i kväll.", "example_fr": "Je suis fatigué ce soir.",
   "conjugation": {"present": "är", "preterite": "var", "supine": "varit"}}
]
```
- Tableau JSON pur, pas de markdown.
- Un objet par carte d'entrée, dans le même ordre.
- `conjugation` uniquement pour les verbes (`swedish` commence par `"att "` ou `pos` contient `"verb"`).
- Diacritiques suédois (å ä ö) et français (é è à ç ô î…) corrects.
- Pour prépositions / conjonctions / adverbes : phrase montrant clairement l'usage (ex: `som` → "Han är stark som en björn.").

## Prompt à coller à un modèle plus léger (Haiku, ChatGPT, etc.)

> Tu es un linguiste suédophone. Pour chaque carte ci-dessous (lemme suédois A1-A2 + traduction anglaise), produis un objet JSON avec :
> - `example_sv` : phrase suédoise courte (5-10 mots), naturelle, présent, sujet explicite.
> - `example_fr` : traduction française fidèle.
> - `conjugation` si le lemme commence par `att ` ou si pos contient `verb` : `{present, preterite, supine}` (supine sans `har`). Sinon omets la clé.
>
> Renvoie un tableau JSON pur, un objet par carte, dans l'ordre reçu. Pas de markdown.
>
> Cartes :
> [coller le contenu de input_NN.json ici]

## Merge final
Une fois tous les `output_NN.json` produits :

```bash
cd /Users/grebonat/AnkiPWA
python3 - <<'EOF'
import json, glob
from pathlib import Path

cards = json.load(open('cards.json'))
by_id = {c['id']: c for c in cards}

merged = 0
for f in sorted(glob.glob('/tmp/enrich/output_*.json')):
    for r in json.load(open(f)):
        c = by_id.get(r['id'])
        if not c: continue
        enr = {'example_sv': r.get('example_sv'), 'example_fr': r.get('example_fr')}
        if r.get('conjugation'):
            enr['conjugation'] = r['conjugation']
        c['enrichment'] = enr
        merged += 1

json.dump(cards, open('cards.json', 'w'), ensure_ascii=False, indent=2)
print(f'Merged {merged} cards into cards.json')
EOF

git add cards.json
git commit -m "Enrich A1+A2 cards with examples + conjugations"
git push
```
