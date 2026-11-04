const Order = require("../models/Order");
const Item = require("../models/Item");
const { razorpay } = require("../config");
const { deliveryService, normalizeProvider } = require("../services");
const {
  verifyRazorpaySignature,
  verifyWebhookSignature,
} = require("../utils");
const {
  confirmPayment,
  applyRefundWebhook,
  unitPriceOf,
  appendNote,
} = require("../services/orderService");
const { assertValidAddress } = require("../utils/addressValidation");
const { assertOwnerOrAdmin } = require("../middleware");
const { historyEntry } = require("../utils/orderStatusDeriver");
const { asyncHandler, httpError, toStr, isValidId, round2 } = require("../utils/http");

const { getSettings, effectiveCheckout, effectiveDelivery } = require("../services/settings");
const { computePricing } = require("../services/pricing");

const MAX_LINES = 50;
const MAX_QTY_PER_LINE = 100;

// Sanity cap (guards against paise/rupee mix-ups); configurable.
const maxOrderAmount = () => Number(process.env.MAX_ORDER_AMOUNT) || 100000;

const orderSummary = (o) => ({
  _id: o._id,
  status: o.status,
  paymentStatus: o.paymentStatus,
  totalAmount: o.totalAmount,
  invoiceNumber: o.invoiceNumber || null,
});

/* -------------------- PUBLIC CONFIG -------------------- */
// All values come from Settings (env vars are only fallbacks when a field is unset).
exports.getConfig = asyncHandler(async (req, res) => {
  const c = effectiveCheckout(await getSettings());
  res.json({
    success: true,
    minOrderValue: c.minOrderValue,
    platformFeePercent: c.platformFeePercent,
    pricesIncludeGst: c.pricesIncludeGst,
    gstScheme: c.gstScheme,
    defaultGstRate: c.defaultGstRate,
    orderingEnabled: c.orderingEnabled,
    orderingPausedMessage: c.orderingPausedMessage,
    paymentModes: ["PREPAID"],
  });
});

/* -------------------- CREATE ORDER (PENDING) --------------- */
exports.createOrder = asyncHandler(async (req, res) => {
  const settings = await getSettings();
  const checkout = effectiveCheckout(settings);
  const deliveryCfg = effectiveDelivery(settings);
  if (!checkout.orderingEnabled) {
    throw httpError(503, checkout.orderingPausedMessage || "We are not accepting online orders right now. Please try again later.", { code: "ORDERING_PAUSED" });
  }

  // Legacy clients wrap the body in `orderData`; only addressId + items are read either way.
  const src = req.body?.orderData && typeof req.body.orderData === "object" ? req.body.orderData : req.body || {};

  const paymentMode = toStr(src.paymentMode || req.body?.paymentMode);
  if (paymentMode && paymentMode.toUpperCase() !== "PREPAID") {
    throw httpError(400, "Only prepaid orders are supported");
  }

  const addressId = toStr(src.addressId);
  if (!isValidId(addressId)) throw httpError(400, "A saved delivery address is required");

  if (!Array.isArray(src.items) || !src.items.length) throw httpError(400, "Your cart is empty");
  if (src.items.length > MAX_LINES) throw httpError(400, `At most ${MAX_LINES} different items per order`);

  // Merge duplicate lines and validate quantities.
  const qtyById = new Map();
  for (const line of src.items) {
    const itemId = toStr(line?.itemId?._id || line?.itemId);
    const quantity = Number(line?.quantity);
    if (!isValidId(itemId)) throw httpError(400, "Invalid item in cart");
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QTY_PER_LINE) {
      throw httpError(400, `Quantity must be a whole number between 1 and ${MAX_QTY_PER_LINE}`);
    }
    qtyById.set(itemId, (qtyById.get(itemId) || 0) + quantity);
  }

  // Address comes from the user's saved addresses (never from the request body), re-validated.
  const saved = req.user.address?.id(addressId);
  if (!saved) throw httpError(400, "Delivery address not found. Please select a saved address.");
  const shippingAddress = await assertValidAddress(saved.toObject());
  const pincode = shippingAddress.postcode;

  // Prices / weights / tax info / availability from the DB.
  const dbItems = await Item.find({ _id: { $in: [...qtyById.keys()] } });
  const byId = new Map(dbItems.map((i) => [String(i._id), i]));
  const lines = [];
  for (const [itemId, quantity] of qtyById) {
    const it = byId.get(itemId);
    if (!it || it.status !== "active") throw httpError(400, "An item in your cart is no longer available");
    if ((it.stockQty || 0) < quantity) {
      throw httpError(400, `Only ${Math.max(0, it.stockQty || 0)} left in stock for ${it.name}`);
    }
    lines.push({
      itemId: it._id,
      name: it.name,
      quantity,
      price: unitPriceOf(it),
      weight: Number(it.weight) || 500,
      gstRate: Number.isFinite(it.gstRate) && it.gstRate !== null ? it.gstRate : checkout.defaultGstRate,
      hsnCode: it.hsnCode || checkout.defaultHsn,
      shippable: it.shippable === true,
    });
  }

  const subtotal = round2(lines.reduce((s, l) => s + l.price * l.quantity, 0));
  const minValue = checkout.minOrderValue;
  if (subtotal < minValue) {
    throw httpError(400, `Minimum order value is ₹${minValue}`, { code: "MIN_ORDER_VALUE", minOrderValue: minValue });
  }

  const totalWeight = lines.reduce((s, l) => s + l.weight * l.quantity, 0);
  const deliveryInfo = await deliveryService.getDeliveryInfo(pincode, totalWeight, { fallbackFee: deliveryCfg.localFallbackFee });
  if (!deliveryInfo.serviceable) {
    throw httpError(400, deliveryInfo.error || "Delivery not available to this pincode");
  }
  const deliveryProvider = normalizeProvider(deliveryInfo.provider);
  deliveryService.validateDeliveryProvider(pincode, deliveryProvider); // throws 400
  assertShippable(deliveryProvider, lines);

  let shippingTotal = round2(deliveryInfo.charge || 0);
  if (deliveryProvider === "SELF" && deliveryCfg.localFreeAboveAmount > 0 && subtotal >= deliveryCfg.localFreeAboveAmount) {
    shippingTotal = 0;
  }
  const pricing = computePricing({ lines, shipping: shippingTotal, settings });
  const total = pricing.total;
  const totalPaise = Math.round(total * 100);

  if (total > maxOrderAmount()) {
    throw httpError(400, `Orders above ₹${maxOrderAmount()} can't be placed online. Please contact the shop.`);
  }
  if (!razorpay) throw httpError(503, "Payment gateway is not configured. Please contact support.");

  const razorpayOrder = await razorpay.orders.create({
    amount: totalPaise,
    currency: "INR",
    receipt: `rcpt_${Date.now()}`,
    notes: { userId: String(req.user._id) },
  });

  const orderDoc = await Order.create({
    userId: req.user._id,
    addressId: saved._id,
    shippingAddress: {
      firstName: shippingAddress.firstName,
      lastName: shippingAddress.lastName,
      street: shippingAddress.street,
      apartment: shippingAddress.apartment,
      city: shippingAddress.city,
      state: shippingAddress.state,
      postcode: shippingAddress.postcode,
      phone: shippingAddress.phone,
      altPhone: shippingAddress.altPhone || undefined,
      email: shippingAddress.email || req.user.email || undefined,
    },
    deliveryPincode: pincode,
    items: lines.map(({ shippable, ...l }) => l),
    totalAmount: total,
    platformFee: pricing.platformFee,
    platformFeePercent: pricing.platformFeePercent,
    gstScheme: pricing.gstScheme,
    pricesIncludeGst: pricing.gstIncluded,
    gstAmount: pricing.gst,
    currency: "INR",
    shipping: {
      provider: deliveryProvider,
      total: shippingTotal,
      breakdown: deliveryInfo.breakdown || {},
    },
    totalWeight,
    distance: deliveryInfo.distance ?? null,
    paymentMode: "PREPAID",
    deliveryProvider,
    deliveryProviderDisplay: deliveryInfo.displayName,
    status: "pending",
    paymentStatus: "pending",
    deliveryStatus: "PENDING",
    razorpayData: [{
      orderId: razorpayOrder.id,
      status: "created",
      amount: razorpayOrder.amount,
      currency: "INR",
      createdAt: new Date(),
    }],
  });
  // Nothing else happens here: stock, invoice number, emails and push only fire once the payment is captured.

  res.json({
    success: true,
    order: { id: razorpayOrder.id, amount: razorpayOrder.amount, currency: razorpayOrder.currency || "INR" },
    dbOrderId: orderDoc._id,
    keyId: process.env.RAZORPAY_KEY_ID,
    pricing: {
      subtotal: pricing.subtotal,
      gst: pricing.gst,
      gstIncluded: pricing.gstIncluded,
      gstScheme: pricing.gstScheme,
      shipping: pricing.shipping,
      platformFee: pricing.platformFee,
      platformFeePercent: pricing.platformFeePercent,
      total,
    },
    delivery: {
      provider: deliveryProvider,
      providerDisplay: deliveryInfo.displayName,
      distance: deliveryInfo.distance ?? null,
    },
    // legacy fields still read by older storefront builds
    shippingCharge: shippingTotal,
    deliveryProvider,
    deliveryProviderDisplay: deliveryInfo.displayName,
  });
});

// Courier (Delhivery) orders may only contain items marked shippable. Local delivery: always allowed.
const assertShippable = (provider, lines) => {
  if (provider !== "DELHIVERY") return;
  const bad = lines.filter((l) => !l.shippable).map((l) => l.name);
  if (bad.length) {
    throw httpError(400, `These items can only be delivered locally: ${bad.join(", ")}`, { code: "NOT_SHIPPABLE", items: bad });
  }
};
exports._assertShippable = assertShippable;

/* -------------------- VERIFY PAYMENT -------------------- */
exports.verifyPayment = asyncHandler(async (req, res) => {
  const dbOrderId = toStr(req.body?.dbOrderId);
  const rzpOrderId = toStr(req.body?.razorpay_order_id);
  const rzpPaymentId = toStr(req.body?.razorpay_payment_id);
  const signature = toStr(req.body?.razorpay_signature);

  if (!isValidId(dbOrderId)) throw httpError(400, "dbOrderId is required");
  if (!rzpOrderId || !rzpPaymentId || !signature) throw httpError(400, "Payment details are incomplete");

  const order = await Order.findById(dbOrderId);
  if (!order) throw httpError(404, "Order not found");
  assertOwnerOrAdmin(req, order.userId);

  // The Razorpay order must be one we created for THIS order.
  if (!order.razorpayData.some((d) => d.orderId === rzpOrderId)) {
    throw httpError(400, "Payment does not belong to this order");
  }
  if (!verifyRazorpaySignature(rzpOrderId, rzpPaymentId, signature)) {
    throw httpError(400, "Invalid payment signature");
  }

  if (order.paymentStatus === "paid") {
    return res.json({ success: true, order: orderSummary(order), orderId: order._id });
  }
  if (!razorpay) throw httpError(503, "Payment gateway is not configured.");

  const payment = await razorpay.payments.fetch(rzpPaymentId);
  if (payment.order_id !== rzpOrderId) throw httpError(400, "Payment does not belong to this order");

  const expectedPaise = Math.round(order.totalAmount * 100);
  if (payment.status === "captured") {
    if (Number(payment.amount) !== expectedPaise || (payment.currency && payment.currency !== "INR")) {
      await Order.updateOne(
        { _id: order._id },
        {
          $push: { razorpayData: { orderId: rzpOrderId, paymentId: rzpPaymentId, amount: payment.amount, status: "amount_mismatch", source: "verify_payment", createdAt: new Date() } },
          $set: { adminNotes: appendNote(order.adminNotes, `AMOUNT MISMATCH: captured ${payment.amount} paise, expected ${expectedPaise}`) },
        }
      );
      throw httpError(400, "Paid amount does not match the order total. Our team will contact you.");
    }
    const { order: confirmed } = await confirmPayment(order._id, payment, { source: "verify_payment" });
    return res.json({ success: true, order: orderSummary(confirmed), orderId: confirmed._id });
  }

  // Authorized but not captured yet → the webhook will confirm it.
  await Order.updateOne(
    { _id: order._id },
    {
      $push: {
        razorpayData: {
          orderId: rzpOrderId,
          paymentId: rzpPaymentId,
          status: "signature_verified",
          signatureVerified: true,
          source: "verify_payment",
          createdAt: new Date(),
        },
      },
    }
  );
  res.json({ success: true, pending: true, order: orderSummary(order), orderId: order._id });
});

/* -------------------- PAYMENT FAILURE -------------------- */
// Records the failed attempt only. Status stays `pending` so a retry in the same modal can still confirm.
exports.handlePaymentFailure = asyncHandler(async (req, res) => {
  const dbOrderId = toStr(req.body?.dbOrderId);
  if (!isValidId(dbOrderId)) throw httpError(400, "dbOrderId is required");
  const reason = (toStr(req.body?.error_reason) || toStr(req.body?.reason) || "Payment failed or cancelled").slice(0, 300);
  const rzpOrderId = toStr(req.body?.razorpay_order_id) || undefined;

  const order = await Order.findById(dbOrderId);
  if (!order) throw httpError(404, "Order not found");
  assertOwnerOrAdmin(req, order.userId);
  if (order.paymentStatus === "paid") throw httpError(409, "Payment already completed for this order");

  const updated = await Order.findOneAndUpdate(
    { _id: order._id, paymentStatus: { $ne: "paid" } },
    {
      $set: { paymentStatus: "failed", lastPaymentError: reason },
      $push: {
        razorpayData: { orderId: rzpOrderId, status: "failed", errorReason: reason, source: "api", createdAt: new Date() },
        statusHistory: historyEntry({ ...order.toObject(), paymentStatus: "failed" }, { note: `Payment failed: ${reason}` }),
      },
    },
    { new: true }
  );
  if (!updated) throw httpError(409, "Payment already completed for this order");
  res.json({ success: true, orderId: updated._id, order: orderSummary(updated) });
});

/* -------------------- RAZORPAY WEBHOOK -------------------- */
exports.razorpayWebhook = async (req, res, next) => {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) {
    return res.status(503).json({ success: false, message: "Webhook not configured" });
  }
  const signature = req.headers["x-razorpay-signature"];
  if (!req.rawBody || !verifyWebhookSignature(req.rawBody, typeof signature === "string" ? signature : "", secret)) {
    return res.status(400).json({ success: false, message: "Invalid signature" });
  }

  try {
    const event = toStr(req.body?.event);
    const payload = req.body?.payload || {};

    if (event === "refund.processed" || event === "refund.failed") {
      const order = await applyRefundWebhook(event, payload.refund?.entity);
      return res.json({ received: true, event, orderId: order?._id || null });
    }

    const payment = payload.payment?.entity;
    const rzpOrderId = payment?.order_id || payload.order?.entity?.id;
    if (!rzpOrderId) return res.json({ received: true, event, ignored: true });

    const order = await Order.findOne({ "razorpayData.orderId": rzpOrderId });
    if (!order) return res.json({ received: true, event, message: "Order not found" });

    switch (event) {
      case "payment.captured":
      case "order.paid": {
        if (!payment) break;
        if (payment.status && payment.status !== "captured") break;
        const expectedPaise = Math.round(order.totalAmount * 100);
        if (Number(payment.amount) !== expectedPaise) {
          await Order.updateOne(
            { _id: order._id },
            {
              $push: { razorpayData: { orderId: rzpOrderId, paymentId: payment.id, amount: payment.amount, status: "amount_mismatch", source: "webhook", createdAt: new Date() } },
              $set: { adminNotes: appendNote(order.adminNotes, `AMOUNT MISMATCH (webhook): captured ${payment.amount} paise, expected ${expectedPaise}`) },
            }
          );
          break;
        }
        await confirmPayment(order._id, payment, { source: "webhook" });
        break;
      }
      case "payment.failed": {
        const reason = (payment?.error_description || "Payment failed").slice(0, 300);
        await Order.updateOne(
          { _id: order._id, paymentStatus: { $ne: "paid" } },
          {
            $set: { paymentStatus: "failed", lastPaymentError: reason },
            $push: {
              razorpayData: {
                orderId: rzpOrderId,
                paymentId: payment?.id,
                status: "failed",
                errorReason: reason,
                failureCode: payment?.error_code,
                failureDescription: payment?.error_description,
                source: "webhook",
                createdAt: new Date(),
              },
              statusHistory: historyEntry({ ...order.toObject(), paymentStatus: "failed" }, { note: `Payment failed (webhook): ${reason}` }),
            },
          }
        );
        break;
      }
      case "payment.authorized":
        await Order.updateOne(
          { _id: order._id },
          { $push: { razorpayData: { orderId: rzpOrderId, paymentId: payment?.id, status: "authorized", amount: payment?.amount, method: payment?.method, source: "webhook", createdAt: new Date() } } }
        );
        break;
      default:
        break;
    }
    res.json({ received: true, event, orderId: order._id });
  } catch (err) {
    next(err); // non-2xx → Razorpay retries
  }
};

/* -------------------- CLEAN ABANDONED ORDERS (admin) -------------------- */
// Deletes only never-paid orders (pending/failed) older than 24h with no captured/authorized payment.
exports.cleanFailedOrders = asyncHandler(async (req, res) => {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const result = await Order.deleteMany({
    paymentStatus: { $in: ["pending", "failed"] },
    createdAt: { $lt: cutoff },
    "razorpayData.status": { $nin: ["paid", "captured", "authorized", "signature_verified", "amount_mismatch"] },
    "refunds.0": { $exists: false },
  });
  res.json({ success: true, deleted: result.deletedCount });
});
