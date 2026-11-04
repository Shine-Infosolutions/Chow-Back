const { deliveryService } = require('../services');
const { getSettings, effectiveDelivery } = require('../services/settings');
const { asyncHandler, httpError, toStr } = require('../utils/http');

exports.checkDeliveryOptions = asyncHandler(async (req, res) => {
  const pincode = toStr(req.params.pincode);
  if (!pincode) throw httpError(400, 'Pincode is required');
  const weight = Math.min(100000, Math.max(1, parseInt(toStr(req.query.weight), 10) || 500));
  const { localFallbackFee, sameDayCutoff } = effectiveDelivery(await getSettings());
  const info = await deliveryService.getDeliveryInfo(pincode, weight, { fallbackFee: localFallbackFee });
  if (info.serviceable && info.provider === 'self' && !info.eta) {
    info.eta = `Same-day delivery on orders paid before ${sameDayCutoff}; later orders arrive the next day.`;
  }
  res.json(info);
});
