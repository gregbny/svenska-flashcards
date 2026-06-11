/**
 * Construction des exercices selon la maturité de la carte.
 *
 * Modes :
 *   - 'flash'   : recto SV → verso EN, 3 boutons de feedback (mode classique)
 *   - 'mc'      : SV affiché, 4 propositions EN  (compréhension écrite)
 *   - 'listen'  : audio joué, 4 propositions SV   (compréhension orale)
 *   - 'reverse' : EN affiché, 4 propositions SV   (rappel / production)
 *   - 'enett'   : pour les noms, choisir l'article "en" ou "ett" (2 options)
 *
 * Priorité utilisateur : COMPRÉHENSION > PRODUCTION
 * → listen et mc pèsent plus que reverse / enett.
 */

const NUM_OPTIONS = 4;
const DISTRACTOR_WINDOW = 400;
const ART_RE = /^(en|ett)\s+/i;
const ART_VERB_RE = /^(en|ett|att)\s+/i;
const SENT_PUNCT = /[.,!?;:»«"]+$/;
const BUILD_MIN_TOKENS = 3;
const BUILD_MAX_TOKENS = 8;

function isArticledNoun(card) {
  return card?.pos === 'noun' && ART_RE.test(card.swedish || '');
}

/**
 * Réduit une glose anglaise verbeuse (style dictionnaire) à son 1er sens,
 * lisible sur une tuile. Ex :
 *   "1. much, many, a lot (of); 2. [~ folk] a lot of people"  → "much, many, a lot (of)"
 *   "1. inside, into; 2. [jag gick ~ i huset] I went into..."  → "inside, into"
 * Sûr : renvoie la chaîne d'origine si le résultat serait vide.
 */
export function shortGloss(s) {
  if (!s) return s;
  const orig = String(s).trim();
  let t = orig
    .replace(/\[[^\]]*\]/g, ' ')        // retire les exemples [ ... ]
    .replace(/^\s*\d+\.\s*/, '');        // retire un préfixe "1. "
  t = t.split(/\s*;\s*\d+\.\s*/)[0];    // coupe au 2e sens numéroté
  t = t.split(/\s*;\s*/)[0];            // sinon, garde la 1re clause avant ";"
  t = t.replace(/\s{2,}/g, ' ').replace(/[\s,;:]+$/, '').trim();
  return t || orig;
}

/**
 * Découpe la phrase d'exemple suédoise en mots (ponctuation retirée).
 * Renvoie null si la carte n'a pas de couple example_sv/example_fr
 * exploitable, ou si la phrase est trop courte/longue pour l'exercice
 * de reconstruction (on veut rester faisable, pas frustrant).
 */
function sentenceTokens(card) {
  const sv = card?.enrichment?.example_sv;
  const fr = card?.enrichment?.example_fr;
  if (!sv || !fr) return null;
  const tokens = sv
    .trim()
    .split(/\s+/)
    .map((w) => w.replace(SENT_PUNCT, ''))
    .filter(Boolean);
  if (tokens.length < BUILD_MIN_TOKENS || tokens.length > BUILD_MAX_TOKENS) return null;
  return tokens;
}

function hasExample(card) {
  const e = card?.enrichment;
  return !!(e && e.example_sv && e.example_fr);
}

/**
 * Prépare un texte à trou : on masque de préférence LE mot de la carte
 * (retrouvé dans la phrase), sinon le mot de contenu le plus long.
 * Renvoie { answer, maskedSentence, tokensBare } ou null si inexploitable.
 */
function clozeData(card) {
  if (!hasExample(card)) return null;
  const sv = card.enrichment.example_sv.trim();
  const rawTokens = sv.split(/\s+/); // garde la ponctuation pour l'affichage
  if (rawTokens.length < 3 || rawTokens.length > 12) return null;

  const bare = rawTokens.map((t) => t.replace(/^[«"'(]+/, '').replace(SENT_PUNCT, ''));
  const stem = (card.swedish || '')
    .replace(ART_VERB_RE, '')
    .trim()
    .split(/\s+/)[0]
    ?.toLowerCase() || '';

  // 1) on tente de masquer le mot de la carte (radical commun)
  let idx = -1;
  if (stem.length >= 2) {
    idx = bare.findIndex((w) => {
      const lw = w.toLowerCase();
      if (lw.length < 2) return false;
      return lw === stem || lw.startsWith(stem) || stem.startsWith(lw);
    });
  }
  // 2) sinon : le mot le plus long (≥ 3 lettres)
  if (idx < 0) {
    let bestLen = 2;
    bare.forEach((w, i) => { if (w.length > bestLen) { bestLen = w.length; idx = i; } });
  }
  if (idx < 0) return null;

  const answer = bare[idx];
  if (!answer || answer.length < 2) return null;

  const trailing = (rawTokens[idx].match(SENT_PUNCT) || [''])[0];
  const masked = rawTokens.slice();
  masked[idx] = '____' + trailing;
  return { answer, maskedSentence: masked.join(' '), tokensBare: bare };
}

export function pickMode(card, cardState) {
  const reps = cardState?.reps ?? 0;
  const hasAudio = !!card.audio_file;
  const noun = isArticledNoun(card);
  const r = Math.random();

  if (reps === 0) return 'flash';

  if (reps === 1) {
    // Phase reconnaissance : mc dominant, soupçon de en/ett pour les noms
    if (noun && r < 0.15) return 'enett';
    return 'mc';
  }

  // reps >= 2 : phase consolidation — priorité aux exercices riches
  // (build/cloze) dès qu'une phrase exemple existe (100% des A1/A2).
  const canBuild = !!sentenceTokens(card);
  const canCloze = hasExample(card);
  if (canBuild && r < 0.25) return 'build';
  if (canCloze && r < 0.50) return 'cloze';
  if (hasAudio && r < 0.72) return 'listen';
  if (r < 0.88) return 'mc';
  if (r < 0.96) return 'reverse';
  if (noun) return 'enett';
  return 'mc';
}

/**
 * Construit l'exercice complet pour une carte donnée.
 *
 * Retour :
 *   { mode, card, options?, correctIndex?, promptText? }
 *   - mode='flash'  → rien d'autre
 *   - mode='mc'     → options = [textes EN], correctIndex
 *   - mode='listen' → options = [textes SV], correctIndex (prompt = audio)
 *   - mode='reverse'→ options = [textes SV], correctIndex, promptText = EN
 *   - mode='enett'  → options = ['en','ett'], correctIndex, promptText = noun sans article
 */
export function buildExercise(card, cardState, allCards, forcedMode = null) {
  let mode = forcedMode ?? pickMode(card, cardState);
  if (mode === 'flash') return { mode, card };

  if (mode === 'build') {
    const tokens = sentenceTokens(card);
    if (tokens) {
      const distractors = pickWordDistractors(card, allCards, tokens, 2);
      const tiles = shuffle([...tokens, ...distractors]);
      return {
        mode,
        card,
        tokens,                              // ordre correct (mots nus)
        tiles,                               // banque mélangée (mots + intrus)
        promptText: card.enrichment.example_fr,
        sentence: card.enrichment.example_sv, // affichée si erreur
      };
    }
    mode = 'mc'; // garde-fou : phrase inutilisable → repli sur mc
  }

  if (mode === 'cloze') {
    const cd = clozeData(card);
    if (cd) {
      const used = [cd.answer, ...cd.tokensBare];
      const distractors = pickWordDistractors(card, allCards, used, NUM_OPTIONS - 1);
      const options = shuffle([cd.answer, ...distractors]);
      const correctIndex = options.indexOf(cd.answer);
      return {
        mode,
        card,
        options,
        correctIndex,
        promptText: card.enrichment.example_fr, // indice FR
        maskedSentence: cd.maskedSentence,
        sentence: card.enrichment.example_sv,
      };
    }
    mode = 'mc'; // garde-fou
  }

  if (mode === 'enett') {
    const m = card.swedish.match(ART_RE);
    const article = (m?.[1] || 'en').toLowerCase();
    const stripped = card.swedish.replace(ART_RE, '');
    const options = ['en', 'ett'];
    const correctIndex = options.indexOf(article);
    return { mode, card, options, correctIndex, promptText: stripped };
  }

  // mc / listen / reverse → 4 options
  const optionField = mode === 'mc' ? 'english' : 'swedish';
  const correctValue = card[optionField];
  const distractors = pickDistractors(card, allCards, optionField, NUM_OPTIONS - 1);
  let options = shuffle([correctValue, ...distractors]);
  const correctIndex = options.indexOf(correctValue);

  // QCM : on raccourcit les gloses anglaises pour des options lisibles,
  // mais seulement si elles restent toutes distinctes (sinon ambiguïté).
  if (mode === 'mc') {
    const short = options.map(shortGloss);
    if (new Set(short.map((x) => x.toLowerCase())).size === short.length) {
      options = short;
    }
  }

  const promptText =
    mode === 'reverse' ? shortGloss(card.english) :
    mode === 'mc'      ? card.swedish :
    null; // listen: pas de prompt texte

  return { mode, card, options, correctIndex, promptText };
}

function pickDistractors(card, allCards, field, n) {
  const targetRank = card.freq_rank ?? 1000;
  const targetCefr = card.cefr;
  const targetPos = card.pos;

  const pool = allCards.filter((c) => {
    if (c.id === card.id) return false;
    const v = c[field];
    if (!v || v === card[field]) return false;
    return true;
  });

  // Tier 1 : même CEFR + même POS + fréquence proche (distracteurs les plus convaincants)
  const tier1 = pool.filter((c) =>
    c.cefr === targetCefr &&
    c.pos === targetPos &&
    Math.abs((c.freq_rank ?? 9999) - targetRank) <= DISTRACTOR_WINDOW,
  );
  // Tier 2 : même CEFR + fréquence proche
  const tier2 = pool.filter((c) =>
    c.cefr === targetCefr &&
    Math.abs((c.freq_rank ?? 9999) - targetRank) <= DISTRACTOR_WINDOW,
  );
  // Tier 3 : fréquence vaguement proche, CEFR libre
  const tier3 = pool.filter((c) =>
    Math.abs((c.freq_rank ?? 9999) - targetRank) <= DISTRACTOR_WINDOW * 2,
  );

  const chosen = new Set();
  const result = [];
  for (const tier of [tier1, tier2, tier3, pool]) {
    const shuffled = shuffle([...tier]);
    for (const c of shuffled) {
      const v = c[field];
      if (chosen.has(v)) continue;
      chosen.add(v);
      result.push(v);
      if (result.length === n) return result;
    }
  }
  return result;
}

/**
 * Mots-intrus pour la reconstruction : des mots suédois simples issus
 * d'autres cartes, absents de la phrase cible. On prend le 1er mot du
 * lemme (sans article en/ett/att) pour éviter les multi-mots bizarres.
 */
function pickWordDistractors(card, allCards, tokens, n) {
  const used = new Set(tokens.map((t) => t.toLowerCase()));
  const out = [];
  const pool = shuffle([...allCards]);
  for (const c of pool) {
    if (out.length >= n) break;
    if (c.id === card.id || !c.swedish) continue;
    const stripped = c.swedish.replace(ART_VERB_RE, '').trim();
    const w = (stripped.split(/\s+/)[0] || '').replace(SENT_PUNCT, '');
    if (w.length < 2 || /[^A-Za-zÀ-ÿåäöÅÄÖ]/.test(w)) continue;
    const lw = w.toLowerCase();
    if (used.has(lw)) continue;
    used.add(lw);
    out.push(w);
  }
  return out;
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
