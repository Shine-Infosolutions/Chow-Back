/**
 * Chowdhry Sweet House — Zomato catalog seed (clean slate)
 *
 *   node seedZomato.js          Wipe the old/dummy catalog, then seed ONLY the
 *                               real Zomato-listed sweets (safe to re-run)
 *
 * Source: products from the shop's Zomato listing (see provided screenshots).
 * Each size option ("250gm", "500gm", "1kg", ...) is stored as a SEPARATE Item,
 * matching the convention already used in seed.js (e.g. "Kaju Katli (500g)").
 *
 * Pricing: the curated menu.html (2025-26) scheme where the product matches it;
 * products not present in menu.html keep their live Zomato screenshot price
 * (marked "kept" below).
 *
 * Images: real product photos downloaded into Chow-Front/public/menuphotos/ and
 * referenced by relative path (served from the storefront origin).
 *
 * DESTRUCTIVE on the catalog: it deletes ALL existing Items, Categories and
 * Subcategories so the storefront shows only these products. It NEVER touches
 * users or orders.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const Category = require('./models/Category');
const Subcategory = require('./models/Subcategory');
const Item = require('./models/Item');

// Reliable placeholder image (brand pink) — fallback if a product has no photo.
const img = (name) =>
  `https://placehold.co/600x400/d80a4e/ffffff?text=${encodeURIComponent(name)}`;

// Real product photos, downloaded from Zomato and served from the frontend's
// public/menuphotos/ folder. Relative paths resolve against the storefront origin.
const IMAGES = {
  'Patisha':                    '/menuphotos/patisha.jpg',
  'Navratan Laddoo':            '/menuphotos/navratan-laddoo.jpg',
  'Karachi Halwa':              '/menuphotos/karachi-halwa.jpg',
  'Dry Fruits Mix Fruit Laddu': '/menuphotos/dry-fruits-mix-fruit-laddu.jpg',
  'Pinni Laddoo':               '/menuphotos/pinni-laddoo.jpg',
  'Badam Patisha Slice':        '/menuphotos/badam-patisha-slice.jpg',
  'Kaju Barfi':                 '/menuphotos/kaju-barfi.jpg',
  'Kaju Barfi Sugarfree':       '/menuphotos/kaju-barfi-sugarfree.jpg',
  'Mewa Bites Mix':             '/menuphotos/mewa-bites-mix.jpg',
  'VIP Mix Mithai':             '/menuphotos/vip-mix-mithai.jpg',
  'Dry Fruits Mix':             '/menuphotos/dry-fruits-mix.jpg',
  'Fruits Barfi And Aampapad Box': '/menuphotos/fruits-barfi-aampapad-box.jpg',
  'Special Box (Mix Of 4 - Besan Gajak, Fruit Roll, Kaju Barfi, Pinni)': '/menuphotos/special-box-mix-of-4.jpg',
  'Premium Dry Fruit Mix (Rajkamal, Anjeer King, Kaju Deepak, Gulkand Roll)': '/menuphotos/premium-dry-fruit-mix.jpg',
};

// Categories this seed needs (upsert by name — reuses the ones from seed.js).
const CATEGORIES = [
  { name: 'Traditional Sweets',   description: 'Classic Indian mithai made fresh daily.',      displayRank: 1 },
  { name: 'Dry Fruit Delicacies', description: 'Premium kaju, badam & anjeer sweets.',         displayRank: 2 },
  { name: 'Festive Gift Boxes',   description: 'Assorted & premium boxes for every occasion.', displayRank: 4 },
];

// Subcategory name -> parent category name (new ones are created as needed).
const SUBCATEGORIES = [
  { name: 'Ladoo',                   category: 'Traditional Sweets' },
  { name: 'Halwa',                   category: 'Traditional Sweets' },
  { name: 'Patisha & Slices',        category: 'Traditional Sweets' },   // new
  { name: 'Kaju Sweets',             category: 'Dry Fruit Delicacies' },
  { name: 'Dry Fruit Ladoo',         category: 'Dry Fruit Delicacies' }, // new
  { name: 'Mewa & Bites',            category: 'Dry Fruit Delicacies' }, // new
  { name: 'Assorted Boxes',          category: 'Festive Gift Boxes' },
  { name: 'Premium Dry Fruit Boxes', category: 'Festive Gift Boxes' },
];

/**
 * Each product lists its variants (one Item per variant). `weight` is in grams,
 * `uom` is the unit shown to the customer. Prices/descriptions are taken verbatim
 * from the Zomato listing.
 */
const PRODUCTS = [
  {
    name: 'Patisha', category: 'Traditional Sweets', subcategory: 'Patisha & Slices',
    shortDesc: 'Savor the delicate, flaky layers of our Patisha, a traditional sweet made with rice flour, sugar, and ghee. Its melt-in-your-mouth texture and subtle sweetness make it a truly irresistible delicacy.',
    variants: [
      { label: '250gm', price: 254, weight: 250, uom: 'gm' },
      { label: '500gm', price: 507, weight: 500, uom: 'gm' },
    ],
  },
  {
    name: 'Navratan Laddoo', category: 'Traditional Sweets', subcategory: 'Ladoo',
    shortDesc: 'A colorful and flavorful ladoo made with nine different dry fruits and nuts.',
    variants: [
      { label: '250gm', price: 312, weight: 250, uom: 'gm' },
      { label: '500gm', price: 624, weight: 500, uom: 'gm' },
    ],
  },
  {
    name: 'Karachi Halwa', category: 'Traditional Sweets', subcategory: 'Halwa',
    shortDesc: 'A rich, jewel-like halwa studded with nuts — chewy, glossy and aromatic.',
    variants: [
      { label: '250gm', price: 286, weight: 250, uom: 'gm' },
      { label: '500gm', price: 572, weight: 500, uom: 'gm' },
      { label: '1kg',   price: 1144, weight: 1000, uom: 'kg' },
    ],
  },
  {
    name: 'Dry Fruits Mix Fruit Laddu', category: 'Dry Fruit Delicacies', subcategory: 'Dry Fruit Ladoo',
    shortDesc: 'A nutritious and flavorful ladoo made with a mix of dry fruits and nuts, a wholesome treat.',
    variants: [
      { label: '250gm', price: 480, weight: 250, uom: 'gm' },
      { label: '500gm', price: 960, weight: 500, uom: 'gm' },
    ],
  },
  {
    name: 'Pinni Laddoo', category: 'Traditional Sweets', subcategory: 'Ladoo',
    shortDesc: 'A winter delight, made with whole wheat flour, ghee, sugar, and dry fruits.',
    variants: [
      { label: '250gm', price: 312, weight: 250, uom: 'gm' },
      { label: '500gm', price: 624, weight: 500, uom: 'gm' },
    ],
  },
  {
    name: 'Badam Patisha Slice', category: 'Traditional Sweets', subcategory: 'Patisha & Slices',
    shortDesc: 'A perfectly round, golden-brown pastry filled with a luscious blend of crushed pistachios, almonds, and cashews. Every bite is a symphony of flavors and textures.',
    // NOTE: Zomato listed this product's variant rows as "Besan Gajak - 500gm / 1 Kg".
    // Treated as a data slip — variants named after the product for consistency.
    variants: [
      { label: '500gm', price: 480, weight: 500, uom: 'gm' },
      { label: '1kg',   price: 960, weight: 1000, uom: 'kg' },
    ],
  },
  {
    name: 'Kaju Barfi', category: 'Dry Fruit Delicacies', subcategory: 'Kaju Sweets',
    shortDesc: 'A rich and creamy sweet made with cashew nuts and silver leaf as garnish.',
    tags: ['popular', 'bestseller'], // "Highly reordered" on Zomato
    variants: [
      { label: '250gm', price: 520, weight: 250, uom: 'gm' },
      { label: '500gm', price: 1040, weight: 500, uom: 'gm' },
    ],
  },
  {
    name: 'Kaju Barfi Sugarfree', category: 'Dry Fruit Delicacies', subcategory: 'Kaju Sweets',
    shortDesc: 'Indulge in the rich, creamy taste of cashews without the guilt. Our sugar-free kaju barfi is a perfect blend of sweetness and health.',
    tags: ['popular'], // "Highly reordered" on Zomato
    variants: [
      { label: '100gm', price: 299, weight: 100, uom: 'gm' },
      { label: '250gm', price: 748, weight: 250, uom: 'gm' },
    ],
  },
  {
    name: 'Mewa Bites Mix', category: 'Dry Fruit Delicacies', subcategory: 'Mewa & Bites',
    shortDesc: 'Indulge in the perfect blend of sweetness and crunch with our delectable Mewa Bites. Each bite is a burst of flavor, packed with premium dry fruits like cashews, almonds, and pistachios — a delightful treat for any occasion.',
    variants: [
      { label: '15 Pieces', price: 728, weight: 300, uom: 'pcs', piecesPerUnit: 15 },
    ],
  },
  {
    name: 'VIP Mix Mithai', category: 'Festive Gift Boxes', subcategory: 'Premium Dry Fruit Boxes',
    shortDesc: 'Savor the goodness of our Premium Dry Fruits Box, featuring a delightful mix of cashews, anjeer (figs), pinni, and besan gajak. This curated selection combines rich flavors and textures, making it perfect for snacking or gifting.',
    variants: [
      { label: '1kg', price: 1520, weight: 1000, uom: 'kg' },
    ],
  },
  {
    name: 'Dry Fruits Mix', category: 'Festive Gift Boxes', subcategory: 'Premium Dry Fruit Boxes',
    shortDesc: 'Indulge in our Premium Dry Fruits Box, a delightful assortment featuring the finest cashews, luscious anjeer (figs), crunchy almonds, and vibrant pistachios. Perfect for snacking or gifting, this luxurious mix offers a rich source of nutrients and flavor.',
    variants: [
      { label: '1kg', price: 1900, weight: 1000, uom: 'kg' },
    ],
  },
  {
    name: 'Fruits Barfi And Aampapad Box', category: 'Festive Gift Boxes', subcategory: 'Assorted Boxes',
    shortDesc: 'Celebrate Diwali with our vibrant gifting box featuring delightful Fruit Barfi and tangy Aam Papad. Each treat is a perfect blend of flavors and freshness, making it an ideal gift for loved ones.',
    variants: [
      { label: '500gm', price: 520, weight: 500, uom: 'gm' },
    ],
  },
  {
    name: 'Special Box (Mix Of 4 - Besan Gajak, Fruit Roll, Kaju Barfi, Pinni)',
    category: 'Festive Gift Boxes', subcategory: 'Assorted Boxes',
    shortDesc: 'An assorted gifting box with a mix of four favourites — Besan Gajak, Fruit Roll, Kaju Barfi and Pinni.',
    variants: [
      { label: '500gm', price: 585, weight: 500, uom: 'gm' },
    ],
  },
  {
    name: 'Premium Dry Fruit Mix (Rajkamal, Anjeer King, Kaju Deepak, Gulkand Roll)',
    category: 'Festive Gift Boxes', subcategory: 'Premium Dry Fruit Boxes',
    shortDesc: 'This exquisite gift box is perfect for any occasion, whether it\'s a festive celebration, a corporate gift, or a personal indulgence. Immerse yourself in the delightful flavors and textures of this premium sweet and dry fruit assortment.',
    variants: [
      { label: '500gm', price: 960, weight: 500, uom: 'gm' },
    ],
  },
];

const DEFAULT_STOCK = 50;

const tagFlags = (tags = []) => ({
  isBestSeller: tags.includes('bestseller'),
  isBestRated: tags.includes('bestrated'),
  isOnSale: tags.includes('onsale'),
  isPopular: tags.includes('popular'),
});

async function run() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI not set in .env');
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
  console.log('Connected to MongoDB');

  // 0. Clean slate — remove the old/dummy catalog (never users or orders)
  const [delI, delS, delC] = await Promise.all([
    Item.deleteMany({}),
    Subcategory.deleteMany({}),
    Category.deleteMany({}),
  ]);
  console.log(`Cleared catalog: ${delI.deletedCount} items, ${delS.deletedCount} subcategories, ${delC.deletedCount} categories`);

  // 1. Categories (upsert by name — does not disturb existing ones)
  const catId = {};
  for (const c of CATEGORIES) {
    const doc = await Category.findOneAndUpdate(
      { name: c.name },
      { ...c, status: 'active' },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    catId[c.name] = doc._id;
  }
  console.log(`Categories ready: ${Object.keys(catId).length}`);

  // 2. Subcategories (upsert by name)
  const subId = {};
  for (const s of SUBCATEGORIES) {
    const doc = await Subcategory.findOneAndUpdate(
      { name: s.name },
      { name: s.name, categories: [catId[s.category]], status: 'active' },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    subId[s.name] = doc._id;
  }
  console.log(`Subcategories ready: ${Object.keys(subId).length}`);

  // 3. Items — one per variant, upserted by full name (e.g. "Kaju Barfi - 250gm")
  let count = 0;
  for (const p of PRODUCTS) {
    for (const v of p.variants) {
      const name = `${p.name} - ${v.label}`;
      await Item.findOneAndUpdate(
        { name },
        {
          name,
          categories: [catId[p.category]],
          subcategories: [subId[p.subcategory]],
          price: v.price,
          discountPrice: undefined,
          stockQty: DEFAULT_STOCK,
          shortDesc: p.shortDesc,
          longDesc: p.longDesc || p.shortDesc,
          images: [IMAGES[p.name] || img(name)],
          weight: v.weight,
          uom: v.uom,
          ...(v.piecesPerUnit ? { piecesPerUnit: v.piecesPerUnit } : {}),
          status: 'active',
          ...tagFlags(p.tags),
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
      count++;
    }
  }
  console.log(`Items ready: ${count} (across ${PRODUCTS.length} products)`);

  console.log('\n──────────────────────────────────────────');
  console.log(' Zomato catalog seed complete.');
  console.log(' Remember to upload the real product photos via Admin → Products.');
  console.log('──────────────────────────────────────────');

  await mongoose.disconnect();
}

run().catch(async (err) => {
  console.error('Seed failed:', err.message);
  try { await mongoose.disconnect(); } catch {}
  process.exit(1);
});
