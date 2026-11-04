// Public URLs / brand constants shared by server.js (CORS) and the email templates.
const ALLOWED_ORIGINS = [
  'https://chow-front-five.vercel.app',
  'https://www.chowdhrysweethouse.in',
  'https://chowdhrysweethouse.in',
  'http://localhost:3000',
  'http://localhost:5173',
];

// FRONTEND_URL wins; otherwise the first production origin allowed by CORS.
const frontendUrl = () =>
  (process.env.FRONTEND_URL || ALLOWED_ORIGINS.find((o) => o.startsWith('https://'))).replace(/\/+$/, '');

const BRAND = {
  name: 'Chowdhry Sweet House',
  tagline: 'Love at First Bite',
  city: 'Gorakhpur, Uttar Pradesh',
  phoneDisplay: '+91 75250 25100',
  phoneTel: '+917525025100',
  whatsapp: 'https://wa.me/917525025100',
  instagram: 'https://www.instagram.com/chowdhry_sweet_house/',
  colors: {
    primary: '#d80a4e',
    primaryDark: '#b8083e',
    deep: '#8b1a3a',
    cream: '#fdf6ee',
    creamAlt: '#f7efe9',
    gold: '#e8a317',
    text: '#2b2b2b',
    muted: '#6b6b6b',
  },
};

module.exports = { ALLOWED_ORIGINS, frontendUrl, BRAND };
