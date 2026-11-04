const Item = require('../models/Item');
const Page = require('../models/Page');
const { frontendUrl } = require('../config/site');
const { asyncHandler } = require('../utils/http');

const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

// GET /api/sitemap.xml — public. Static storefront pages, published policy pages, active products.
exports.sitemap = asyncHandler(async (req, res) => {
  const base = frontendUrl();
  await require('./settingsController').ensureDefaultPages();
  const [items, pages] = await Promise.all([
    Item.find({ status: { $ne: 'inactive' } }).select('_id updatedAt').sort({ updatedAt: -1 }).limit(45000).lean(),
    Page.find({ published: true }).select('slug updatedAt').lean(),
  ]);

  const urls = [
    { loc: `${base}/`, changefreq: 'daily', priority: '1.0' },
    { loc: `${base}/shop`, changefreq: 'daily', priority: '0.9' },
    { loc: `${base}/specials`, changefreq: 'weekly', priority: '0.8' },
    { loc: `${base}/about`, changefreq: 'monthly', priority: '0.5' },
    { loc: `${base}/contact`, changefreq: 'monthly', priority: '0.5' },
    // Published policy pages (about/contact are always listed above).
    ...pages.filter((p) => !['about', 'contact'].includes(p.slug))
      .map((p) => ({ loc: `${base}/${p.slug}`, lastmod: p.updatedAt, changefreq: 'monthly', priority: '0.3' })),
    ...items.map((i) => ({ loc: `${base}/product/${i._id}`, lastmod: i.updatedAt, changefreq: 'weekly', priority: '0.7' })),
  ];

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${xml(u.loc)}</loc>${u.lastmod ? `<lastmod>${new Date(u.lastmod).toISOString()}</lastmod>` : ''}<changefreq>${u.changefreq}</changefreq><priority>${u.priority}</priority></url>`).join('\n')}
</urlset>`;
  res.set('Content-Type', 'application/xml; charset=utf-8');
  res.set('Cache-Control', 'public, max-age=3600');
  res.send(body);
});
