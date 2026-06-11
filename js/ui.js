/** Tiny screen switcher. */

const SCREENS = ['loading', 'setup', 'home', 'study', 'match', 'done', 'account', 'reading', 'reader'];

export const ui = {
  show(name) {
    for (const s of SCREENS) {
      const el = document.getElementById(`screen-${s}`);
      if (!el) continue;
      if (s === name) {
        el.classList.remove('hidden');
        // Réarme l'animation d'entrée (le reflow force le redémarrage)
        el.classList.remove('screen-enter');
        void el.offsetWidth;
        el.classList.add('screen-enter');
      } else {
        el.classList.add('hidden');
      }
    }
  },
};
