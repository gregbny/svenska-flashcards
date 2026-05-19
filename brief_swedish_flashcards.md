# Brief Claude Code — Swedish Flashcard PWA

## Contexte

Application de flashcards suédois, installable sur iPhone (PWA), hébergée sur GitHub Pages.  
15 min/jour sur l'app, départ en Suède le **20 juillet** (62 jours de pratique à partir du 19 mai).

---

## Source de données

Fichier `deck.apkg` fourni (193 Mo) — deck Anki "8000 most common Swedish words", avec audio pour chaque carte.

### Étape 1 — Extraction (script Python à fournir)

- Renommer `.apkg` en `.zip`, extraire
- Parser `collection.anki2` (SQLite) → table `notes`, champ `flds` (séparateur `\x1f`)
- Extraire les fichiers audio du dossier `media/`
- Exporter un `cards.json` propre : `{ id, swedish, english, audio_file }`

---

## Audio — stockage local (pas d'hébergement)

Pas de compression, pas d'hébergement des fichiers audio.

**Flow one-time setup :**
1. Sur PC : zipper le dossier `media/` extrait du `.apkg`
2. AirDrop du zip vers l'iPhone → atterrit dans l'app Fichiers iOS
3. Dans la PWA : écran de setup avec bouton **"Importer l'audio"**
4. L'utilisateur sélectionne le `.zip` via file picker
5. La PWA extrait avec **JSZip** et stocke tous les fichiers dans **IndexedDB**
6. Lecture audio ensuite via `URL.createObjectURL()` depuis IndexedDB
7. L'écran de setup disparaît définitivement une fois l'import terminé

IndexedDB supporte largement 193 Mo. Après l'import, l'app est 100% offline.

---

## Algorithme

Répétition espacée **SM-2** (open source).

- Session quotidienne : ~25 cartes (15 min)
- Nouvelles cartes/jour : 10 max
- Révisions : le reste du quota
- Priorité aux **2000 premiers mots** du deck (les plus fréquents)
- État persisté en **localStorage** (pas de backend)

---

## Features MVP

- Carte recto (suédois) → clic → verso (anglais + phonétique si dispo)
- Lecture audio automatique à l'affichage du recto
- Boutons de feedback : ❌ Difficile / 😐 Correct / ✅ Facile
- Compteur de session : X/25 cartes
- Streak journalier
- Écran de fin de session avec récap
- Offline first via Service Worker
- Écran de setup one-time pour l'import audio (voir section Audio)

---

## Design

Style **Duolingo** :

- Couleur principale : vert `#58CC02`
- Fond : blanc / gris très clair
- Coins très arrondis : `rounded-2xl`
- Ombres douces
- Typographie bold et lisible
- Boutons larges tactiles (hauteur min 48px)
- Micro-animations sur les boutons de feedback

**Tailwind CSS.** Mobile first, optimisé iPhone (viewport 390px).

---

## Déploiement

- Repo GitHub public
- GitHub Pages (branche `gh-pages` ou dossier `/docs`)
- `manifest.json` + Service Worker → installable iOS via "Ajouter à l'écran d'accueil"
- Icône app : 🇸🇪

---

## Livrables attendus

1. **Script Python** d'extraction du `.apkg` → `cards.json` + dossier `media/`
2. **App web PWA** (HTML/CSS/JS vanilla ou React léger)
3. **Instructions** de déploiement GitHub Pages
4. **Instructions** d'installation iOS + import audio
