# Sources & licences

Cette app combine plusieurs contenus tiers. Le code applicatif est à moi
(voir [LICENSE](LICENSE)), mais les **données** (mots, audio, classements
de fréquence) viennent de tiers et restent soumises à leurs licences
d'origine. Toute redistribution doit les respecter.

> **Usage prévu : strictement personnel / éducatif, non commercial.**
> Tu ne dois pas utiliser cette app, son audio ou son contenu textuel
> pour un produit commercial ou un service rémunéré.

## 1. Audio des prononciations — Forvo

Les ~8 000 fichiers MP3 distribués via [GitHub Releases](https://github.com/gregbny/svenska-flashcards/releases)
proviennent de [Forvo.com](https://forvo.com), enregistrés par des
contributeurs natifs suédois.

- **Licence** : [Creative Commons BY-NC-SA 3.0](https://creativecommons.org/licenses/by-nc-sa/3.0/) (voir [forvo.com/license](https://forvo.com/license/))
- **Attribution** : chaque fichier MP3 porte dans ses tags ID3 l'URL Forvo
  d'origine (champ `COMM`), par exemple `https://forvo.com/word/<mot>/#sv`.
  Le contributeur précis est visible sur cette page.
- **Pas d'usage commercial.**
- **Partage à l'identique** : tout dérivé doit conserver la même licence.

Le pack n'a **pas** été modifié au-delà du conditionnement en zip.

## 2. Liste de vocabulaire — Anki "8000 most common Swedish words"

Les paires mot/traduction de `cards.json` proviennent du deck Anki
communautaire *"8000 most common Swedish words"* (origine Memrise).
Le deck a été extrait par `extract.py`. La licence exacte de ce deck
n'est pas explicite ; il est diffusé librement sur AnkiWeb depuis
plusieurs années par des contributeurs anonymes.

→ Tout reproche d'un ayant droit identifié serait pris au sérieux et
mènerait au retrait des données concernées. Contact via les issues du
repo.

## 3. Classement de fréquence + niveaux CEFR — Kelly List

Les champs `freq_rank` et `cefr` viennent de la
[**Swedish Kelly List**](https://spraakbanken.gu.se/en/resources/kelly)
(Språkbanken, Université de Göteborg).

- **Licence** : [CC-BY 4.0](https://creativecommons.org/licenses/by/4.0/)
- **Attribution** : Volodina, E. & Kokkinakis, S.J. (2012).
  *Introducing the Swedish Kelly-list, a new lexical e-resource for Swedish.*
  LREC 2012. Université de Göteborg, Språkbanken.

## 4. Phrases d'exemple et conjugaisons (champ `enrichment`)

Générées via le modèle Claude (Anthropic). Conformément aux
[CGU Anthropic](https://www.anthropic.com/legal/commercial-terms), les
sorties appartiennent à l'utilisateur (moi). Diffusées ici sans
restriction additionnelle. Qualité non garantie — corrections bienvenues
par PR.

## 5. Code de l'application

Tout le code JavaScript / HTML / CSS de l'app (`js/`, `index.html`,
`styles.css`, `sw.js`, `manifest.json`, scripts Python) est sous
[MIT](LICENSE) — utilise, modifie, redistribue librement.

## Si vous êtes un ayant droit

Si vous identifiez un contenu sous votre licence diffusé ici de manière
incompatible, ouvrez une issue sur le repo : le contenu concerné sera
retiré rapidement.
