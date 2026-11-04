const Page = require('../models/Page');
const User = require('../models/User');
const { PAGES } = require('../services/defaultPages');
const { getSettings, publicSettings, updateSection, resolvePlaceholders } = require('../services/settings');
const { asyncHandler, httpError, toStr } = require('../utils/http');
const { isAdmin } = require('../middleware');

/* -------------------------------- Settings -------------------------------- */

// Replace user ids in updatedBy / settingsHistory[].by with {_id, name}.
const withUserNames = async (s) => {
  const ids = [s.updatedBy, ...(s.settingsHistory || []).map((h) => h.by)].filter(Boolean).map(String);
  const users = ids.length ? await User.find({ _id: { $in: [...new Set(ids)] } }).select('name').lean() : [];
  const byId = new Map(users.map((u) => [String(u._id), { _id: u._id, name: u.name }]));
  const ref = (id) => (id ? byId.get(String(id)) || { _id: id, name: null } : null);
  return {
    ...s,
    updatedBy: ref(s.updatedBy),
    settingsHistory: (s.settingsHistory || []).slice(-50).map((h) => ({ section: h.section, by: ref(h.by), at: h.at })),
  };
};

exports.ensureDefaultPages = () => ensureDefaultPages();

exports.getPublicSettings = asyncHandler(async (req, res) => {
  const s = await getSettings();
  res.set('Cache-Control', 'public, max-age=60');
  res.json({ success: true, settings: publicSettings(s) });
});

exports.getSettings = asyncHandler(async (req, res) => {
  const s = await getSettings({ fresh: true });
  res.json({ success: true, settings: await withUserNames(s) });
});

// PUT { section, data } — partial update of one section (400 with dotted fieldErrors).
exports.updateSettings = asyncHandler(async (req, res) => {
  const section = toStr(req.body?.section);
  const settings = await updateSection(section, req.body?.data, req.user._id);
  res.json({ success: true, settings: await withUserNames(settings) });
});

/* ---------------------------------- Pages --------------------------------- */

// Insert any missing default templates (never overwrites an existing page).
let pagesEnsured = false;
const ensureDefaultPages = async () => {
  // (also used by the sitemap)
  if (pagesEnsured) return;
  await Page.bulkWrite(
    Object.entries(PAGES).map(([slug, p]) => ({
      updateOne: {
        filter: { slug },
        update: { $setOnInsert: { slug, title: p.title, content: p.content, published: true, isTemplate: true } },
        upsert: true,
      },
    })),
    { ordered: false }
  );
  pagesEnsured = true;
};

const checkSlug = (slug) => {
  if (!Page.SLUGS.includes(slug)) throw httpError(404, 'Page not found');
  return slug;
};

const pageOut = (p, s, { admin }) => ({
  slug: p.slug,
  title: p.title,
  content: resolvePlaceholders(p.content, s),
  ...(admin ? { rawContent: p.content } : {}),
  published: p.published,
  isTemplate: p.isTemplate === true,
  ...(admin && p.isTemplate ? { reviewNote: 'Default template — review before use (not legal advice).' } : {}),
  updatedAt: p.updatedAt,
  updatedBy: p.updatedBy ? { _id: p.updatedBy._id || p.updatedBy, name: p.updatedBy.name || null } : null,
});

// Public: resolved markdown; drafts 404. Admin token: drafts too (+ rawContent with placeholders).
exports.getPage = asyncHandler(async (req, res) => {
  const slug = checkSlug(toStr(req.params.slug));
  await ensureDefaultPages();
  const admin = isAdmin(req);
  const page = await Page.findOne({ slug }).populate('updatedBy', 'name').lean();
  if (!page || (!page.published && !admin)) throw httpError(404, 'Page not found');
  res.json({ success: true, page: pageOut(page, await getSettings(), { admin }) });
});

exports.listPages = asyncHandler(async (req, res) => {
  await ensureDefaultPages();
  const [pages, s] = await Promise.all([Page.find().populate('updatedBy', 'name').sort({ slug: 1 }).lean(), getSettings()]);
  res.json({ success: true, pages: pages.map((p) => pageOut(p, s, { admin: true })) });
});

exports.updatePage = asyncHandler(async (req, res) => {
  const slug = checkSlug(toStr(req.params.slug));
  const set = { isTemplate: false, updatedBy: req.user._id };
  if (req.body?.title !== undefined) {
    const title = toStr(req.body.title);
    if (title.length < 2 || title.length > 120) throw httpError(400, 'Title must be 2–120 characters');
    set.title = title;
  }
  if (req.body?.content !== undefined) {
    if (typeof req.body.content !== 'string' || req.body.content.length > 100000) throw httpError(400, 'Content must be text up to 100,000 characters');
    set.content = req.body.content;
  }
  if (req.body?.published !== undefined) set.published = req.body.published === true || req.body.published === 'true';
  await ensureDefaultPages();
  const page = await Page.findOneAndUpdate({ slug }, { $set: set }, { new: true, upsert: true, setDefaultsOnInsert: true })
    .populate('updatedBy', 'name').lean();
  res.json({ success: true, page: pageOut(page, await getSettings(), { admin: true }) });
});
