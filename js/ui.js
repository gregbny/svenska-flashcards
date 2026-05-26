/** Tiny screen switcher. */

const SCREENS = ['loading', 'setup', 'home', 'study', 'done', 'account'];

export const ui = {
  show(name) {
    for (const s of SCREENS) {
      const el = document.getElementById(`screen-${s}`);
      if (!el) continue;
      if (s === name) el.classList.remove('hidden');
      else el.classList.add('hidden');
    }
  },
};
