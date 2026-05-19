# Svenska — Flashcards PWA

App de flashcards suédois (deck Anki "8000 most common Swedish words"), installable sur iPhone, 100% offline après setup, hébergée sur GitHub Pages.

## État du repo

| Composant                      | Statut |
| ------------------------------ | ------ |
| Script d'extraction `.apkg`    | ✅ `extract.py` |
| UI Duolingo-style (HTML/CSS)   | ✅ `index.html` + `styles.css` |
| PWA shell (manifest + SW)      | ✅ `manifest.json` + `sw.js` |
| Navigation entre écrans        | ✅ `js/app.js` + `js/ui.js` |
| Logique métier (SM-2, IDB…)    | ✅ implémentée (`js/db.js`, `js/sm2.js`, `js/session.js`, `js/audio.js`, `js/import.js`) |
| Icônes                         | ⚠️ placeholders dans `icons/` |

Tous les modules JS avec logique sont marqués `🚧 STUB — Sonnet :` et contiennent des `console.warn('TODO: …')` pour repérage rapide.

## Étape 1 — Extraire le deck

```bash
python3 extract.py 8000_most_common_swedish_words.apkg
```

Produit :
- `cards.json` — `[{ id, swedish, english, audio_file }, …]`
- `media/` — tous les fichiers audio

## Étape 2 — Préparer le zip audio (à faire une fois, sur PC)

```bash
cd media && zip -r ../media.zip . && cd ..
```

→ AirDrop `media.zip` vers l'iPhone (atterrit dans Fichiers).

## Étape 3 — Déploiement GitHub Pages

1. Créer un repo public, pousser tout le contenu (sauf `.apkg` et `media/` qui sont trop gros — déjà gitignorés).
2. Settings → Pages → Source : `Deploy from a branch` → `main` / `(root)`.
3. Attendre l'URL `https://<user>.github.io/<repo>/`.

## Étape 4 — Installer sur iPhone

1. Ouvrir l'URL dans **Safari** (pas Chrome).
2. Bouton Partager → **"Sur l'écran d'accueil"**.
3. Lancer l'app depuis l'icône → écran de setup → sélectionner `media.zip`.
4. Une fois l'import IndexedDB terminé, l'app est offline-first.

## Stack

- Vanilla JS modules (pas de build)
- Tailwind via CDN (`cdn.tailwindcss.com`)
- JSZip via CDN (pour décompresser le zip audio)
- IndexedDB pour l'audio, localStorage pour l'état SM-2

## Golden path à valider manuellement

1. Extraire le deck avec `extract.py`
2. Zipper `media/` → `media.zip`
3. Ouvrir l'app → écran Setup → importer `media.zip`
4. Écran Home → vérifier streak et compteurs
5. "Commencer la session" → audio joue automatiquement
6. Flip carte → voir l'anglais
7. Évaluer avec les 3 boutons ; "Difficile" doit repasser en fin de queue
8. Finir 25 cartes → écran récap
9. Recharger l'app → état conservé (localStorage + IndexedDB)
