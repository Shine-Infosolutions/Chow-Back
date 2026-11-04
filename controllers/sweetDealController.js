const SweetDeal = require('../models/SweetDeal');
const { uploadToCloudinary } = require('../middleware');
const { asyncHandler, httpError, toStr, isValidId } = require('../utils/http');

const pickDeal = (body = {}, { partial }) => {
  const out = {};
  const has = (k) => Object.prototype.hasOwnProperty.call(body, k);
  if (has('title')) out.title = toStr(body.title).slice(0, 200);
  if (has('description')) out.description = toStr(body.description).slice(0, 2000);
  for (const k of ['originalPrice', 'salePrice']) {
    if (has(k)) {
      const n = Number(toStr(body[k]));
      if (!Number.isFinite(n) || n < 0) throw httpError(400, `Invalid ${k}`);
      out[k] = n;
    }
  }
  if (has('endDate')) {
    const d = new Date(toStr(body.endDate));
    if (isNaN(d.getTime())) throw httpError(400, 'Invalid endDate');
    out.endDate = d;
  }
  if (has('videoUrl') && toStr(body.videoUrl)) {
    const url = toStr(body.videoUrl);
    if (!/^https:\/\//i.test(url)) throw httpError(400, 'videoUrl must be an https URL');
    out.videoUrl = url;
  }
  if (has('isActive')) out.isActive = ['true', '1', 'on'].includes(toStr(body.isActive).toLowerCase());
  if (!partial) {
    for (const k of ['description', 'originalPrice', 'salePrice', 'endDate']) {
      if (out[k] === undefined || out[k] === '') throw httpError(400, `${k} is required`);
    }
  }
  return out;
};

// Upload is awaited BEFORE responding (serverless functions may be frozen after the response).
const uploadVideo = async (req) =>
  req.files?.video?.[0] ? uploadToCloudinary(req.files.video[0].buffer, 'video', 'chowdhry-deals') : null;

const getActiveDeal = asyncHandler(async (req, res) => {
  const deal = await SweetDeal.findOne({ isActive: true }).sort({ createdAt: -1 });
  if (!deal) throw httpError(404, 'No active deal found');
  res.json(deal);
});

const createDeal = asyncHandler(async (req, res) => {
  const data = pickDeal(req.body, { partial: false });
  const videoUrl = await uploadVideo(req); // 502 on failure — nothing saved
  if (videoUrl) data.videoUrl = videoUrl;
  if (data.isActive) await SweetDeal.updateMany({}, { isActive: false });
  const savedDeal = await new SweetDeal(data).save();
  res.status(201).json(savedDeal);
});

const updateDeal = asyncHandler(async (req, res) => {
  const id = toStr(req.params.id);
  if (!isValidId(id)) throw httpError(400, 'Invalid deal id');
  const data = pickDeal(req.body, { partial: true });
  const videoUrl = await uploadVideo(req);
  if (videoUrl) data.videoUrl = videoUrl;
  const deal = await SweetDeal.findByIdAndUpdate(id, { $set: data }, { new: true, runValidators: true });
  if (!deal) throw httpError(404, 'Deal not found');
  if (data.isActive) await SweetDeal.updateMany({ _id: { $ne: id } }, { isActive: false });
  res.json(deal);
});

const deleteDeal = asyncHandler(async (req, res) => {
  const deal = await SweetDeal.findByIdAndDelete(toStr(req.params.id));
  if (!deal) throw httpError(404, 'Deal not found');
  res.json({ success: true, message: 'Deal deleted successfully' });
});

const getAllDeals = asyncHandler(async (req, res) => {
  const deals = await SweetDeal.find().sort({ createdAt: -1 }).limit(100);
  res.json(deals);
});

module.exports = { getActiveDeal, createDeal, updateDeal, deleteDeal, getAllDeals };
