/**
 * Config Tailwind pour la précompilation (remplace le CDN, trop lent au boot).
 *
 * Régénérer tailwind.css après tout ajout de classe dans index.html ou js/ :
 *   npx tailwindcss@3.4.17 -i tw-input.css -o tailwind.css --minify
 */
module.exports = {
  content: ['./index.html', './js/*.js'],
  theme: {
    extend: {
      colors: {
        duo: {
          green: '#58CC02',
          greenDark: '#46A302',
          red: '#FF4B4B',
          orange: '#FF9600',
          blue: '#1CB0F6',
          ink: '#3C3C3C',
          soft: '#F7F7F7',
          border: '#E5E5E5',
        },
      },
      boxShadow: {
        duo: '0 4px 0 0 rgb(0 0 0 / 0.08)',
        duoBtn: '0 4px 0 0 var(--btn-shadow, #46A302)',
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', 'system-ui', 'sans-serif'],
      },
    },
  },
};
