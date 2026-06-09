/**
 * Chowdhry Sweet House — database seed
 *
 *   node seed.js            Upsert admin + catalog (non-destructive; safe to re-run)
 *   node seed.js --fresh    Wipe items/categories/subcategories first, then seed
 *                           (does NOT touch users or orders)
 *
 * Admin credentials can be overridden with SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD.
 * Product data is inspired by typical Gorakhpur sweet-house menus (sold as boxes
 * by weight). Images use a placeholder CDN — replace via Admin → Products later.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./models/User');
const Category = require('./models/Category');
const Subcategory = require('./models/Subcategory');
const Item = require('./models/Item');

const FRESH = process.argv.includes('--fresh');

const ADMIN = {
  name: 'Chowdhry Admin',
  email: process.env.SEED_ADMIN_EMAIL || 'admin@chowdhry.com',
  password: process.env.SEED_ADMIN_PASSWORD || 'Chowdhry@123',
  phone: '9415000000',
};

// Reliable placeholder image (brand pink). Swap for Cloudinary URLs via admin panel.
const img = (name) =>
  `https://placehold.co/600x400/d80a4e/ffffff?text=${encodeURIComponent(name)}`;

const CATEGORIES = [
  { name: 'Traditional Sweets',   description: 'Classic Indian mithai made fresh daily.',        displayRank: 1 },
  { name: 'Dry Fruit Delicacies', description: 'Premium kaju, badam & anjeer sweets.',           displayRank: 2 },
  { name: 'Bengali Sweets',       description: 'Soft, syrupy chhena specialities.',              displayRank: 3 },
  { name: 'Festive Gift Boxes',   description: 'Assorted & premium boxes for every occasion.',   displayRank: 4 },
  { name: 'Namkeen & Snacks',     description: 'Crunchy savouries to go with your chai.',        displayRank: 5 },
];

// sub name -> parent category name
const SUBCATEGORIES = [
  { name: 'Ladoo',                  category: 'Traditional Sweets' },
  { name: 'Peda',                   category: 'Traditional Sweets' },
  { name: 'Halwa',                  category: 'Traditional Sweets' },
  { name: 'Barfi',                  category: 'Traditional Sweets' },
  { name: 'Syrup Sweets',           category: 'Traditional Sweets' },
  { name: 'Kaju Sweets',            category: 'Dry Fruit Delicacies' },
  { name: 'Badam Sweets',           category: 'Dry Fruit Delicacies' },
  { name: 'Anjeer Sweets',          category: 'Dry Fruit Delicacies' },
  { name: 'Rasgulla & Cham Cham',   category: 'Bengali Sweets' },
  { name: 'Sandesh',                category: 'Bengali Sweets' },
  { name: 'Assorted Boxes',         category: 'Festive Gift Boxes' },
  { name: 'Premium Dry Fruit Boxes',category: 'Festive Gift Boxes' },
  { name: 'Bhujia & Sev',           category: 'Namkeen & Snacks' },
  { name: 'Mixtures',               category: 'Namkeen & Snacks' },
];

// tags map to the boolean flags the storefront's "featured" sections read.
const ITEMS = [
  { name: 'Kaju Katli (500g)', category: 'Dry Fruit Delicacies', subcategory: 'Kaju Sweets',
    price: 650, discountPrice: 599, stockQty: 80, weight: 500, uom: 'gm',
    shortDesc: 'Diamond-cut cashew barfi with a delicate silver vark.',
    longDesc: 'Our signature Kaju Katli — pure cashew, slow-cooked and hand-cut into thin diamonds. A Gorakhpur favourite for festivals and gifting.',
    tags: ['bestseller', 'popular', 'onsale'] },

  { name: 'Kaju Katli (1kg)', category: 'Dry Fruit Delicacies', subcategory: 'Kaju Sweets',
    price: 1250, discountPrice: 1199, stockQty: 50, weight: 1000, uom: 'gm',
    shortDesc: 'Family-size box of our classic cashew barfi.',
    longDesc: 'The full kilo box of Kaju Katli — perfect for large gatherings and Diwali hampers.',
    tags: ['bestrated', 'onsale'] },

  { name: 'Anjeer Barfi (500g)', category: 'Dry Fruit Delicacies', subcategory: 'Anjeer Sweets',
    price: 720, discountPrice: 679, stockQty: 60, weight: 500, uom: 'gm',
    shortDesc: 'Rich fig barfi, naturally sweet and packed with dry fruits.',
    longDesc: 'Premium figs blended with khoya and nuts — no refined sugar overload, just wholesome richness.',
    tags: ['popular', 'onsale'] },

  { name: 'Badam Barfi (500g)', category: 'Dry Fruit Delicacies', subcategory: 'Badam Sweets',
    price: 700, stockQty: 55, weight: 500, uom: 'gm',
    shortDesc: 'Smooth almond barfi topped with slivered badam.',
    longDesc: 'Stone-ground almonds cooked to a melt-in-the-mouth barfi. A premium pick for special occasions.',
    tags: ['bestrated'] },

  { name: 'Motichoor Ladoo (500g)', category: 'Traditional Sweets', subcategory: 'Ladoo',
    price: 320, discountPrice: 299, stockQty: 120, weight: 500, uom: 'gm',
    shortDesc: 'Fine boondi ladoos, soft and fragrant with cardamom.',
    longDesc: 'Tiny golden boondi bound in pure ghee and elaichi — the classic celebration sweet.',
    tags: ['bestseller', 'popular', 'onsale'] },

  { name: 'Besan Ladoo (500g)', category: 'Traditional Sweets', subcategory: 'Ladoo',
    price: 300, stockQty: 100, weight: 500, uom: 'gm',
    shortDesc: 'Roasted gram-flour ladoos in desi ghee.',
    longDesc: 'Slow-roasted besan with ghee and nuts — grainy, nutty and deeply comforting.',
    tags: ['popular'] },

  { name: 'Soan Papdi (500g)', category: 'Traditional Sweets', subcategory: 'Barfi',
    price: 260, discountPrice: 229, stockQty: 90, weight: 500, uom: 'box',
    shortDesc: 'Flaky, melt-in-mouth soan papdi cubes.',
    longDesc: 'Light, layered and feather-soft — boxed fresh and ready to gift.',
    tags: ['onsale'] },

  { name: 'Doodh Peda (500g)', category: 'Traditional Sweets', subcategory: 'Peda',
    price: 340, stockQty: 85, weight: 500, uom: 'gm',
    shortDesc: 'Creamy khoya pedas with a saffron touch.',
    longDesc: 'Thick reduced-milk pedas, lightly scented with saffron and cardamom.',
    tags: ['bestseller'] },

  { name: 'Gajar Halwa (500g)', category: 'Traditional Sweets', subcategory: 'Halwa',
    price: 280, stockQty: 70, weight: 500, uom: 'gm',
    shortDesc: 'Slow-cooked carrot halwa with ghee and nuts.',
    longDesc: 'Red carrots simmered in milk and ghee, finished with cashews and raisins. Best served warm.',
    tags: ['popular'] },

  { name: 'Milk Cake (500g)', category: 'Traditional Sweets', subcategory: 'Barfi',
    price: 360, stockQty: 75, weight: 500, uom: 'gm',
    shortDesc: 'Grainy caramelised milk cake (kalakand-style).',
    longDesc: 'Curdled milk cooked down to a soft, brown-centred cake — a North Indian classic.',
    tags: ['bestrated'] },

  { name: 'Gulab Jamun (1kg Tin)', category: 'Traditional Sweets', subcategory: 'Syrup Sweets',
    price: 380, discountPrice: 350, stockQty: 110, weight: 1000, uom: 'box',
    shortDesc: 'Soft khoya jamuns soaked in rose syrup.',
    longDesc: 'Deep-fried khoya dumplings in fragrant sugar syrup — ready-to-serve tin.',
    tags: ['bestseller', 'onsale'] },

  { name: 'Rasgulla (1kg Tin)', category: 'Bengali Sweets', subcategory: 'Rasgulla & Cham Cham',
    price: 360, stockQty: 95, weight: 1000, uom: 'box',
    shortDesc: 'Spongy chhena balls in light sugar syrup.',
    longDesc: 'Soft, springy rasgullas in a clear syrup — a Bengali sweet-shop staple.',
    tags: ['popular'] },

  { name: 'Cham Cham (500g)', category: 'Bengali Sweets', subcategory: 'Rasgulla & Cham Cham',
    price: 340, stockQty: 65, weight: 500, uom: 'gm',
    shortDesc: 'Oval chhena sweets rolled in coconut.',
    longDesc: 'Tender cham cham dusted with mawa and coconut — mildly sweet and aromatic.',
    tags: [] },

  { name: 'Kesar Sandesh (500g)', category: 'Bengali Sweets', subcategory: 'Sandesh',
    price: 420, discountPrice: 399, stockQty: 50, weight: 500, uom: 'gm',
    shortDesc: 'Delicate saffron sandesh from fresh chhena.',
    longDesc: 'Hand-moulded chhena sandesh infused with kesar — refined and not too sweet.',
    tags: ['bestrated', 'onsale'] },

  { name: 'Kalakand (500g)', category: 'Traditional Sweets', subcategory: 'Barfi',
    price: 380, stockQty: 60, weight: 500, uom: 'gm',
    shortDesc: 'Moist milk barfi with a grainy bite.',
    longDesc: 'Fresh paneer and milk cooked to a soft, juicy kalakand topped with pistachios.',
    tags: ['popular'] },

  { name: 'Assorted Mithai Gift Box (1kg)', category: 'Festive Gift Boxes', subcategory: 'Assorted Boxes',
    price: 950, discountPrice: 899, stockQty: 40, weight: 1000, uom: 'box',
    shortDesc: 'A curated mix of our best-selling sweets.',
    longDesc: 'Kaju katli, motichoor ladoo, milk cake, soan papdi and more — beautifully boxed for gifting.',
    tags: ['bestseller', 'bestrated', 'popular', 'onsale'] },

  { name: 'Premium Dry Fruit Box (1kg)', category: 'Festive Gift Boxes', subcategory: 'Premium Dry Fruit Boxes',
    price: 1499, discountPrice: 1399, stockQty: 35, weight: 1000, uom: 'box',
    shortDesc: 'Luxury assortment of dry-fruit barfis.',
    longDesc: 'Kaju, badam and anjeer sweets in a premium presentation box — our finest hamper.',
    tags: ['bestrated', 'onsale'] },

  { name: 'Bombay Mixture (400g)', category: 'Namkeen & Snacks', subcategory: 'Mixtures',
    price: 160, stockQty: 130, weight: 400, uom: 'gm',
    shortDesc: 'Crunchy spiced mixture with sev and peanuts.',
    longDesc: 'A savoury blend of sev, boondi, peanuts and curry leaves — the perfect chai companion.',
    tags: ['popular'] },

  { name: 'Aloo Bhujia (400g)', category: 'Namkeen & Snacks', subcategory: 'Bhujia & Sev',
    price: 150, stockQty: 140, weight: 400, uom: 'gm',
    shortDesc: 'Fine potato bhujia, crisp and lightly spiced.',
    longDesc: 'Thin, crunchy aloo bhujia made fresh — a household favourite.',
    tags: ['bestseller'] },

  { name: 'Khasta Mixture (400g)', category: 'Namkeen & Snacks', subcategory: 'Mixtures',
    price: 180, stockQty: 100, weight: 400, uom: 'gm',
    shortDesc: 'Hearty mixture with khasta kachori bits.',
    longDesc: 'A robust namkeen mix studded with crushed khasta and masala peanuts.',
    tags: [] },
];

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

  // 1. Admin (save() so the password pre-save hook hashes it)
  let admin = await User.findOne({ email: ADMIN.email });
  if (admin) {
    admin.name = ADMIN.name;
    admin.phone = ADMIN.phone;
    admin.role = 'admin';
    admin.status = 'active';
    admin.password = ADMIN.password; // re-hashed on save
    await admin.save();
    console.log(`Admin updated: ${ADMIN.email}`);
  } else {
    admin = new User({ ...ADMIN, role: 'admin', status: 'active' });
    await admin.save();
    console.log(`Admin created: ${ADMIN.email}`);
  }

  // 2. Optional clean slate for the catalog (never touches users/orders)
  if (FRESH) {
    const [i, s, c] = await Promise.all([
      Item.deleteMany({}),
      Subcategory.deleteMany({}),
      Category.deleteMany({}),
    ]);
    console.log(`--fresh: removed ${i.deletedCount} items, ${s.deletedCount} subcategories, ${c.deletedCount} categories`);
  }

  // 3. Categories (upsert by name)
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

  // 4. Subcategories (upsert by name)
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

  // 5. Items (upsert by name)
  let count = 0;
  for (const it of ITEMS) {
    await Item.findOneAndUpdate(
      { name: it.name },
      {
        name: it.name,
        categories: [catId[it.category]],
        subcategories: [subId[it.subcategory]],
        price: it.price,
        ...(it.discountPrice ? { discountPrice: it.discountPrice } : { discountPrice: undefined }),
        stockQty: it.stockQty,
        shortDesc: it.shortDesc,
        longDesc: it.longDesc,
        images: [img(it.name)],
        weight: it.weight,
        uom: it.uom,
        status: 'active',
        ...tagFlags(it.tags),
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    count++;
  }
  console.log(`Items ready: ${count}`);

  console.log('\n──────────────────────────────────────────');
  console.log(' Seed complete. Admin login:');
  console.log(`   Email:    ${ADMIN.email}`);
  console.log(`   Password: ${ADMIN.password}`);
  console.log('──────────────────────────────────────────');

  await mongoose.disconnect();
}

run().catch(async (err) => {
  console.error('Seed failed:', err.message);
  try { await mongoose.disconnect(); } catch {}
  process.exit(1);
});
