/**
 * One-off (re-runnable) content update: writes a punchy shortDesc (used on product
 * cards) and a long-form, SEO-optimised longDesc (used on the detail page) for every
 * product, matched by base name so all size/weight variants get the same copy.
 *
 * Run:  node scripts/updateProductDescriptions.js
 *       node scripts/updateProductDescriptions.js --dry   (preview, no writes)
 */
require('dotenv').config();
const mongoose = require('mongoose');
const Item = require('../models/Item');

const DRY_RUN = process.argv.includes('--dry');

// Ordered most-specific first so startsWith() matching is unambiguous
// (e.g. "Dry Fruits Mix Fruit Laddu" must win over "Dry Fruits Mix").
const COPY = [
  {
    key: 'Badam Patisha Slice',
    short: 'Flaky, ghee-rich patisha layered with finely ground almonds — light, crisp and melt-in-the-mouth.',
    long: "Experience the royal taste of Badam Patisha from Chowdhry Sweet House, Gorakhpur's trusted name in traditional Indian sweets since 1970. Each slice is crafted from gram flour and pure desi ghee, spun into delicate, flaky layers and generously enriched with finely ground almonds (badam) for a crisp bite that melts the moment it touches your tongue. Unlike ordinary soan papdi, our badam patisha balances a light, airy texture with a deep, nutty richness that keeps you reaching for more. Freshly prepared in small batches to lock in flavour and aroma, it pairs beautifully with evening chai and makes an elegant gift for Diwali, Raksha Bandhan, weddings and corporate hampers. Order badam patisha online and enjoy authentic Gorakhpur mithai delivered fresh to your doorstep.",
  },
  {
    key: 'Dry Fruits Mix Fruit Laddu',
    short: 'A wholesome laddoo loaded with cashews, almonds, figs and dates — rich, nutty and satisfying.',
    long: "Treat yourself to the wholesome goodness of our Dry Fruits Mix Fruit Laddu, a nourishing classic from Chowdhry Sweet House in Gorakhpur. Each laddu is hand-rolled with a generous blend of premium cashews, almonds, pistachios, figs and dates, delivering a rich, nutty bite that is as satisfying as it is energising. Naturally packed with the goodness of dry fruits, these laddoos are a wholesome choice for festive thalis, everyday indulgence, post-workout energy or thoughtful gifting during Diwali, Raksha Bandhan and family celebrations. Prepared fresh in small batches with pure ingredients and no compromise on quality, they carry the authentic taste Gorakhpur has loved since 1970. Order dry fruit laddu online and savour traditional Indian mithai, delivered fresh to your door.",
  },
  {
    key: 'Dry Fruits Mix',
    short: 'A premium assortment of cashews, almonds, pistachios and juicy anjeer — wholesome luxury to snack or gift.',
    long: "Gift the finest with our Premium Dry Fruits Mix from Chowdhry Sweet House, Gorakhpur. This luxurious assortment brings together carefully handpicked cashews, almonds, pistachios and plump, juicy anjeer (figs), each selected for its freshness, flavour and natural nutrition. Wholesome and free from artificial additives, it is the perfect healthy snack for the whole family and an elegant, ready-to-gift box for Diwali, Bhai Dooj, weddings, housewarmings and corporate gifting. Every box is freshly packed to preserve crunch and aroma, reflecting the trusted premium quality Gorakhpur has relied on since 1970. Buy premium dry fruits online and send a gift of health and happiness, delivered fresh to your doorstep.",
  },
  {
    key: 'Fruits Barfi And Aampapad Box',
    short: 'A festive gift box pairing soft fruit barfi with tangy, sun-ripened aam papad — sweet meets tangy.',
    long: "Celebrate every occasion with our Fruit Barfi and Aam Papad Gift Box, a vibrant festive favourite from Chowdhry Sweet House, Gorakhpur. This thoughtfully curated box pairs soft, delicately fruit-flavoured barfi with chewy, tangy aam papad (sun-ripened mango fruit leather), creating an irresistible balance of sweet and tangy in every bite. Beautifully presented and freshly prepared, it is an ideal gift for Diwali, Raksha Bandhan, Holi and family celebrations, and a delightful treat to keep at home for unexpected guests. Made with quality ingredients and the authentic taste Gorakhpur has trusted since 1970, this colourful assortment brings joy to any sweet table. Order your fruit barfi and aam papad gift box online for fresh doorstep delivery.",
  },
  {
    key: 'Kaju Barfi Sugarfree',
    short: 'All the richness of classic kaju barfi, made sugar-free — indulgence you can feel good about.',
    long: "Indulge without the guilt with our Sugar-Free Kaju Barfi from Chowdhry Sweet House, Gorakhpur. We take the same beloved recipe — premium cashews slow-cooked to a silky, melt-in-the-mouth fudge — and craft it entirely without added sugar, so you can enjoy rich, authentic mithai while staying mindful of your health. A thoughtful choice for diabetics, fitness-conscious sweet lovers and anyone watching their sugar intake, this sugar-free kaju katli makes an inclusive gift for Diwali, Raksha Bandhan and family gatherings where everyone can partake. Freshly prepared in small batches with pure ingredients, it delivers all the indulgence of classic kaju barfi with none of the compromise. Order sugar-free kaju barfi online and enjoy guilt-free Gorakhpur mithai delivered fresh to your door.",
  },
  {
    key: 'Kaju Barfi',
    short: 'The timeless cashew classic — smooth, melt-in-the-mouth barfi crowned with edible silver leaf.',
    long: "Discover the timeless luxury of Kaju Barfi (Kaju Katli) from Chowdhry Sweet House, Gorakhpur's most-loved sweet shop since 1970. Made from pure, premium cashews slow-cooked to silky, melt-in-the-mouth perfection and finished with a delicate layer of edible silver leaf (chandi ka vark), this is the king of Indian mithai and a festive essential in every household. Its smooth texture and refined, balanced sweetness make it the ideal gift for Diwali, Raksha Bandhan, Bhai Dooj, weddings and corporate hampers. Prepared fresh in small batches with no artificial flavours or colours, our kaju barfi carries the authentic taste Gorakhpur has cherished for generations. Buy kaju barfi / kaju katli online and have premium Indian sweets delivered fresh to your doorstep.",
  },
  {
    key: 'Karachi Halwa',
    short: 'A glossy, jewel-like halwa — chewy, aromatic and studded with crunchy nuts.',
    long: "Savour the rich, nostalgic taste of Karachi Halwa (Bombay Halwa) from Chowdhry Sweet House, Gorakhpur. This traditional delicacy is slow-cooked with pure desi ghee to a glossy, jewel-like sheen and a soft, chewy bite, then generously studded with crunchy cashews and almonds for the perfect contrast of textures. Aromatic, vibrant and utterly irresistible, it is a long-time favourite that is equally delightful warm or at room temperature. A wonderful addition to festive sweet boxes and gifting hampers for Diwali, Holi and weddings, our karachi halwa is freshly prepared in small batches to preserve its signature flavour and aroma. Order karachi halwa online and enjoy authentic Gorakhpur mithai, trusted since 1970, delivered fresh to your home.",
  },
  {
    key: 'Mewa Bites Mix',
    short: 'Bite-sized dry-fruit delights packed with cashews, almonds and pistachios — sweet, crunchy and moreish.',
    long: "Delight your senses with our Mewa Bites Mix from Chowdhry Sweet House, Gorakhpur — bite-sized jewels of premium dry fruits crafted for pure indulgence. Each piece is loaded with the finest cashews, almonds and pistachios, delivering the perfect harmony of natural sweetness and satisfying crunch in every mouthful. Elegantly presented and easy to share, mewa bites make a luxurious, ready-to-gift treat for Diwali, Raksha Bandhan, weddings and corporate gifting, as well as a wholesome snack to keep handy for guests. Freshly prepared with carefully selected ingredients, they reflect the premium quality and authentic taste Gorakhpur has trusted since 1970. Order mewa bites online and gift a box of rich, nutty goodness delivered fresh to your doorstep.",
  },
  {
    key: 'Navratan Laddoo',
    short: 'A regal laddoo crafted from nine premium dry fruits and nuts — rich, colourful and full of flavour.',
    long: "Experience royalty in every bite with our Navratan Laddoo from Chowdhry Sweet House, Gorakhpur. Inspired by the 'navratan', or nine precious gems, this regal laddoo brings together nine handpicked dry fruits and nuts to create a rich, colourful and wonderfully textured sweet that feels truly special. Luxurious yet wholesome, it is a standout choice for festive celebrations, pujas and premium gifting during Diwali, Raksha Bandhan and weddings. Prepared fresh in small batches with quality ingredients and pure ghee, our navratan laddu carries the authentic, time-honoured taste Gorakhpur has cherished since 1970. Order navratan laddoo online and bring home a regal Indian mithai, delivered fresh to your doorstep.",
  },
  {
    key: 'Patisha',
    short: 'Featherlight, flaky strands of patisha that melt instantly — delicately sweet and made with pure ghee.',
    long: "Relish the melt-in-the-mouth magic of authentic Patisha (Soan Papdi) from Chowdhry Sweet House, Gorakhpur's trusted sweet shop since 1970. Spun into featherlight, flaky strands using rice flour, sugar and pure desi ghee, our patisha offers a delicate, gentle sweetness and a uniquely airy texture that dissolves instantly on the tongue. A beloved Indian classic, it is the perfect companion to a hot cup of chai and a festive staple for Diwali, Raksha Bandhan, Holi and family gatherings. Freshly prepared in small batches to retain its crisp, flaky character, our patisha makes a light, elegant and budget-friendly gift that everyone enjoys. Order patisha / soan papdi online and savour traditional Gorakhpur mithai delivered fresh to your home.",
  },
  {
    key: 'Pinni Laddoo',
    short: 'A hearty winter laddoo of whole-wheat, pure ghee and dry fruits — warming, rich and traditional.',
    long: "Warm up with the wholesome richness of Pinni Laddoo from Chowdhry Sweet House, Gorakhpur — a cherished North Indian winter delicacy. Slow-roasted with whole-wheat flour (atta) and pure desi ghee, then generously loaded with almonds and other dry fruits, each pinni is hearty, energising and deeply satisfying. Traditionally enjoyed through the colder months and festive seasons, atta pinni is comfort food at its most authentic and a nourishing treat for the whole family. Freshly prepared in small batches with premium ingredients, our pinni laddu carries the genuine homestyle taste Gorakhpur has loved since 1970. Order pinni laddoo online and bring home the warmth of traditional Punjabi mithai, delivered fresh to your doorstep.",
  },
  {
    key: 'Premium Dry Fruit Mix',
    short: 'A luxury gift box of four signature delicacies — Rajkamal, Anjeer King, Kaju Deepak and Gulkand Roll.',
    long: "Make a lasting impression with our Premium Dry Fruit Mix gift box from Chowdhry Sweet House, Gorakhpur — an exquisite assortment of four signature delicacies in one luxurious box. Inside you will find the rich Rajkamal, the fig-laden Anjeer King, the cashew-crafted Kaju Deepak and the fragrant, rose-scented Gulkand Roll, each made with the finest dry fruits and time-honoured craftsmanship. Elegantly presented and freshly packed, it is the ultimate statement gift for Diwali, weddings, housewarmings and corporate gifting, and a memorable indulgence for life's special occasions. Reflecting the premium quality Gorakhpur has trusted since 1970, this curated selection celebrates the very best of Indian mithai. Order our premium dry fruit sweet box online for fresh, doorstep delivery.",
  },
  {
    key: 'Special Box',
    short: 'Four favourites in one box — Besan Gajak, Fruit Roll, Kaju Barfi and Pinni — a little something for everyone.',
    long: "Enjoy the best of variety with our Special Assorted Sweet Box from Chowdhry Sweet House, Gorakhpur — four house favourites thoughtfully brought together in one box. Savour crunchy Besan Gajak, fruity Fruit Roll, classic melt-in-the-mouth Kaju Barfi and ghee-rich Pinni, each crafted to perfection so there is something for every taste. Ideal for sharing with family, welcoming guests or gifting during Diwali, Raksha Bandhan, Holi and weddings, this assortment takes the guesswork out of choosing a single sweet. Freshly prepared with quality ingredients and the authentic taste Gorakhpur has trusted since 1970, it is a crowd-pleasing addition to any celebration. Order our assorted mithai gift box online and enjoy fresh doorstep delivery.",
  },
  {
    key: 'VIP Mix Mithai',
    short: 'Our finest mixed selection — cashews, anjeer, pinni and besan gajak in one indulgent gift box.',
    long: "Celebrate in style with our VIP Mix Mithai from Chowdhry Sweet House, Gorakhpur — a premium curation of our most-loved treats in one indulgent gift box. This deluxe assortment brings together rich cashew delicacies, juicy anjeer (fig) sweets, ghee-rich pinni and crunchy besan gajak, offering a luxurious range of flavours and textures in every box. Beautifully presented and freshly prepared, it is the perfect choice for grand celebrations, premium gifting and impressing guests during Diwali, weddings and corporate occasions. Backed by the trusted quality and authentic taste Gorakhpur has cherished since 1970, our VIP mix is Indian mithai at its very finest. Order VIP mix mithai online and send a truly special gift, delivered fresh to the doorstep.",
  },
];

const findCopy = (name = '') => COPY.find((c) => name.trim().startsWith(c.key)) || null;

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
  const items = await Item.find({}).select('name shortDesc longDesc');

  let updated = 0;
  const unmatched = [];

  for (const item of items) {
    const copy = findCopy(item.name);
    if (!copy) {
      unmatched.push(item.name);
      continue;
    }
    console.log(`✓ ${item.name}  (long: ${copy.long.length} chars)`);
    if (!DRY_RUN) {
      item.shortDesc = copy.short;
      item.longDesc = copy.long;
      await item.save();
    }
    updated += 1;
  }

  console.log('\n────────────────────────────');
  console.log(`${DRY_RUN ? '[DRY RUN] would update' : 'Updated'}: ${updated}/${items.length}`);
  if (unmatched.length) console.log('No copy matched (left unchanged):\n  - ' + unmatched.join('\n  - '));

  await mongoose.disconnect();
})().catch((e) => {
  console.error('Failed:', e.message);
  process.exit(1);
});
