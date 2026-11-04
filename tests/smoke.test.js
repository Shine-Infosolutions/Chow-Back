/* End-to-end smoke test for Chow-Back: plain http against the exported Express app.
 *   npm test        (uses mongodb-memory-server; without it only the no-DB checks run)
 * External services (Razorpay, distance APIs, SMTP, Cloudinary) are stubbed — no network calls.
 */
const path = require('path');
const http = require('http');
const crypto = require('crypto');

const BACK = path.resolve(__dirname, '..');

// Dummy secrets — never the real .env values (dotenv does not override already-set vars).
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.RAZORPAY_KEY_ID = 'rzp_test_dummy';
process.env.RAZORPAY_SECRET = 'rzp_dummy_secret';
process.env.RAZORPAY_WEBHOOK_SECRET = 'whsec_dummy';
process.env.DELHIVERY_WEBHOOK_SECRET = 'dlv_dummy';
process.env.SMTP_USER = '';
process.env.SMTP_PASS = '';
process.env.VAPID_PUBLIC_KEY = '';
process.env.VAPID_PRIVATE_KEY = '';
process.env.CLOUDINARY_CLOUD_NAME = '';
process.env.USE_REAL_DELHIVERY = 'false';
process.env.CRON_SECRET = 'cron_dummy';
process.env.MIN_ORDER_VALUE = '';
process.env.PLATFORM_FEE_PERCENT = '';
process.env.MONGODB_URI = '';
process.env.API_PUBLIC_URL = '';

// Capture dev-logged verification codes (SMTP is not configured in tests).
const codes = {};
const origLog = console.log;
console.log = (...args) => {
  const m = /\[mailer:dev\] verification code for (\S+): (\d{6})/.exec(args.join(' '));
  if (m) { codes[m[1]] = m[2]; return; }
  origLog(...args);
};

let passed = 0, failed = 0;
const ok = (cond, label, extra) => {
  if (cond) { passed++; console.log('  PASS', label); }
  else { failed++; console.log('  FAIL', label, extra !== undefined ? JSON.stringify(extra).slice(0, 400) : ''); }
};

let server, base;
const req = (method, url, { body, token, headers = {}, raw } = {}) => new Promise((resolve, reject) => {
  const data = raw !== undefined ? raw : body !== undefined ? JSON.stringify(body) : undefined;
  const r = http.request(base + url, {
    method,
    headers: {
      ...(data !== undefined ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
  }, (res) => {
    let buf = '';
    res.on('data', (c) => (buf += c));
    res.on('end', () => {
      let json = null;
      try { json = JSON.parse(buf); } catch {}
      resolve({ status: res.statusCode, json, text: buf, headers: res.headers });
    });
  });
  r.on('error', reject);
  r.setTimeout(30000, () => { r.destroy(new Error(`timeout ${method} ${url}`)); });
  if (data !== undefined) r.write(data);
  r.end();
});

const sign = (s, secret) => crypto.createHmac('sha256', secret).update(s).digest('hex');

async function noDbChecks() {
  console.log('\n# Auth / routing / signatures');
  const admin401 = [
    ['POST', '/api/categories/add'], ['PUT', '/api/categories/update/x'], ['DELETE', '/api/categories/delete/x'],
    ['POST', '/api/subcategories/add'], ['POST', '/api/items/add'], ['PUT', '/api/items/update/x'], ['DELETE', '/api/items/delete/x'],
    ['GET', '/api/items/admin/all'], ['GET', '/api/items/admin/get/x'],
    ['GET', '/api/sweet-deals'], ['POST', '/api/sweet-deals'], ['DELETE', '/api/sweet-deals/x'],
    ['GET', '/api/tickets'], ['PUT', '/api/tickets/x'], ['DELETE', '/api/tickets/x'], ['GET', '/api/tickets/x'],
    ['GET', '/api/orders'], ['GET', '/api/orders/admin'], ['GET', '/api/orders/admin/export'], ['GET', '/api/orders/failed'],
    ['GET', '/api/orders/my/abc'], ['GET', '/api/orders/abc'], ['GET', '/api/orders/abc/permissions'],
    ['PATCH', '/api/orders/abc/payment-status'], ['PATCH', '/api/orders/abc/status'], ['PATCH', '/api/orders/abc/delivery-status'],
    ['PATCH', '/api/orders/bulk/status'], ['POST', '/api/orders/abc/refund'], ['PATCH', '/api/orders/abc/cancel'],
    ['POST', '/api/payment/create-order'], ['POST', '/api/payment/verify'], ['POST', '/api/payment/failure'], ['POST', '/api/payment/clean-failed'],
    ['GET', '/api/users'], ['GET', '/api/users/abc/addresses'], ['POST', '/api/users/abc/addresses'],
    ['GET', '/api/search'], ['GET', '/api/search/customers'], ['GET', '/api/search/orders'],
    ['GET', '/api/dashboard/stats'], ['GET', '/api/reports/summary'], ['GET', '/api/reports/export'],
    ['POST', '/api/delhivery/create-shipment'], ['GET', '/api/delhivery/track-order/abc'],
    ['GET', '/api/auth/me'], ['GET', '/api/auth/profile/abc'], ['POST', '/api/auth/claim'],
  ];
  for (const [m, u] of admin401) {
    const r = await req(m, u, { body: m === 'GET' ? undefined : {} });
    ok(r.status === 401 && r.json?.success === false && typeof r.json?.message === 'string', `${m} ${u} -> 401 (got ${r.status})`, r.json);
  }
  const bad = await req('GET', '/api/orders/admin', { token: 'garbage' });
  ok(bad.status === 401, 'invalid token -> 401');

  const reg = await req('POST', '/api/auth/admin/register', { body: { name: 'x', email: 'a@b.c', password: 'x', phone: '1' } });
  ok(reg.status === 404 && reg.json?.success === false, 'POST /auth/admin/register -> 404', reg.json);
  for (const u of ['/api/payment/confirm', '/api/payment/fix-inconsistent', '/api/auth/address/abc']) {
    const r = await req('POST', u, { body: {} });
    ok(r.status === 404, `${u} removed -> 404 (got ${r.status})`);
  }

  const payload = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_x', order_id: 'order_x', amount: 100 } } } });
  const w1 = await req('POST', '/api/payment/webhook', { raw: payload, headers: { 'X-Razorpay-Signature': 'deadbeef' } });
  ok(w1.status === 400, 'razorpay webhook bad signature -> 400', w1.json);
  const w2 = await req('POST', '/api/payment/webhook', { raw: payload });
  ok(w2.status === 400, 'razorpay webhook missing signature -> 400', w2.json);
  // Signature over a re-serialised body must NOT match if bytes differ (raw-body verification).
  const spaced = payload.replace(/,/g, ', ');
  const w3 = await req('POST', '/api/payment/webhook', { raw: spaced, headers: { 'X-Razorpay-Signature': sign(payload, 'whsec_dummy') } });
  ok(w3.status === 400, 'webhook signature is checked over raw bytes', w3.json);

  const d1 = await req('POST', '/api/delhivery/webhook', { body: { waybill: 'X', status: 'Delivered' } });
  ok(d1.status === 401, 'delhivery webhook without secret header -> 401', d1.json);
  const d2 = await req('POST', '/api/delhivery/webhook', { body: { waybill: 'X' }, headers: { 'X-Delhivery-Signature': 'wrong' } });
  ok(d2.status === 401, 'delhivery webhook wrong secret -> 401');

  const inv = await req('GET', '/api/orders/5f5f5f5f5f5f5f5f5f5f5f5f/invoice', { headers: { Accept: 'application/json' } });
  ok(inv.status === 403, 'invoice without token -> 403', inv.json);

  const cfg = await req('GET', '/api/payment/config');
  ok(cfg.status === 200 && cfg.json.minOrderValue === 100 && cfg.json.paymentModes[0] === 'PREPAID', 'GET /payment/config', cfg.json);

  const nf = await req('GET', '/api/nope');
  ok(nf.status === 404 && nf.json?.success === false, 'unknown route -> 404 json');
  const badJson = await req('POST', '/api/auth/login', { raw: '{bad' });
  ok(badJson.status === 400 && badJson.json?.success === false, 'malformed JSON -> 400', badJson.json);
}

async function dbChecks() {
  const mongoose = require(path.join(BACK, 'node_modules/mongoose'));
  const Item = require(path.join(BACK, 'models/Item'));
  const Category = require(path.join(BACK, 'models/Category'));
  const User = require(path.join(BACK, 'models/User'));
  const Order = require(path.join(BACK, 'models/Order'));
  const config = require(path.join(BACK, 'config'));
  const services = require(path.join(BACK, 'services'));
  const addr = require(path.join(BACK, 'utils/addressValidation'));

  // Stubs: no network.
  require(path.join(BACK, 'node_modules/axios')).get = async () => { throw new Error('network disabled in tests'); };
  services.deliveryService.distanceService.calculateDistance = async () => 3;
  let rzpSeq = 0;
  const rzpOrders = new Map();
  const captured = new Map();
  config.razorpay.orders.create = async ({ amount }) => { const id = `order_t${++rzpSeq}`; rzpOrders.set(id, amount); return { id, amount, currency: 'INR' }; };
  config.razorpay.payments.fetch = async (pid) => captured.get(pid);
  config.razorpay.payments.refund = async (pid, { amount }) => ({ id: `rfnd_${pid}_${amount}`, status: 'processed', amount });

  console.log('\n# Auth');
  const r1 = await req('POST', '/api/auth/register', { body: { name: 'Asha Verma', email: 'Asha@Example.com ', phone: '+91 98765 43210', password: 'short' } });
  ok(r1.status === 400, 'register short password -> 400', r1.json);
  const r2 = await req('POST', '/api/auth/register', { body: { name: 'Asha Verma', email: 'Asha@Example.com ', phone: '+91 98765 43210', password: 'longenough1' } });
  ok(r2.status === 201 && r2.json.user.email === 'asha@example.com' && r2.json.user.phone === '9876543210' && !r2.json.user.password, 'register normalises email/phone, hides password', r2.json);
  const userA = r2.json.user; const tokA = r2.json.token;
  const dup = await req('POST', '/api/auth/register', { body: { name: 'Asha Verma', email: 'ASHA@example.com', phone: '9876543210', password: 'longenough1' } });
  ok(dup.status === 409, 'duplicate email -> 409', dup.json);
  const inj = await req('POST', '/api/auth/login', { body: { email: { $ne: null }, password: { $ne: null } } });
  ok(inj.status === 400 || inj.status === 401, `operator injection on login rejected (${inj.status})`, inj.json);
  const lg = await req('POST', '/api/auth/login', { body: { email: 'ASHA@example.com', password: 'longenough1' } });
  ok(lg.status === 200 && lg.json.user._id, 'login (case-insensitive)', lg.json);
  const me = await req('GET', '/api/auth/me', { token: tokA });
  ok(me.status === 200 && me.json.user._id === userA._id, 'GET /auth/me');

  ok(r2.json.user.isGuest === false && r2.json.requiresVerification === undefined, 'register: no verification step', r2.json);
  for (const u of ['/api/auth/verify-email', '/api/auth/resend-verification']) {
    const r = await req('POST', u, { body: { email: 'asha@example.com', code: '123456' } });
    ok(r.status === 404, `${u} removed -> 404`);
  }

  // Mobile-only guest checkout
  const gBad = await req('POST', '/api/auth/guest', { body: { phone: '12345' } });
  ok(gBad.status === 400, 'guest with invalid phone -> 400');
  const g1 = await req('POST', '/api/auth/guest', { body: { phone: '+91 98765 43210', name: 'Ravi Kumar' } });
  ok(g1.status === 201 && g1.json.user.isGuest === true && g1.json.user.phone === '9876543210' && g1.json.user._id !== userA._id && !g1.json.user.email && !g1.json.user.password,
    'guest with a phone that belongs to an existing account gets a NEW guest user', g1.json);
  const gPayload = JSON.parse(Buffer.from(g1.json.token.split('.')[1], 'base64').toString());
  ok(gPayload.guest === true && gPayload.exp - gPayload.iat === 90 * 86400, 'guest JWT: guest:true, 90-day expiry', gPayload);
  const UserModel = require(path.join(BACK, 'models/User'));
  const gDoc = await UserModel.findById(g1.json.user._id).lean();
  ok(!('email' in gDoc) && !('password' in gDoc), 'guest stored without email/password fields (sparse index safe)', gDoc);
  const tokG = g1.json.token; const guest = g1.json.user;
  const meG = await req('GET', '/api/auth/me', { token: tokG });
  ok(meG.status === 200 && meG.json.user.isGuest === true, '/auth/me for guest');
  const gLogin = await req('POST', '/api/auth/login', { body: { email: '9876543210', password: 'anything1' } });
  ok(gLogin.status === 401, 'guest cannot log in via /auth/login');

  const idor = await req('GET', `/api/auth/profile/${userA._id}`, { token: tokG });
  ok(idor.status === 403, 'IDOR profile -> 403');
  const idor2 = await req('GET', `/api/users/${userA._id}/addresses`, { token: tokG });
  ok(idor2.status === 403, 'IDOR addresses -> 403');
  const prof = await req('PUT', `/api/auth/profile/${userA._id}`, { token: tokA, body: { name: 'Asha V', address: [] } });
  ok(prof.status === 200, 'profile update ok');

  console.log('\n# Addresses');
  ok(addr.normalizePhone('09876543210') === '9876543210' && addr.normalizePhone('9999999999') === null && addr.normalizePhone('5876543210') === null, 'normalizePhone');
  const garbage = await req('POST', `/api/users/${userA._id}/addresses`, { token: tokA, body: { firstName: 'asdf', lastName: 'x', street: 'aaaa', city: 'zzzz', state: 'Narnia', postcode: '012345', phone: '1234' } });
  ok(garbage.status === 400 && garbage.json.code === 'INVALID_ADDRESS' && garbage.json.fieldErrors.firstName && garbage.json.fieldErrors.state && garbage.json.fieldErrors.phone, 'garbage address -> 400 INVALID_ADDRESS', garbage.json);
  const goodAddr = { firstName: 'Asha', lastName: 'Verma', street: '12 Golghar Road, Near Vijay Chowk', city: 'Gorakhpur', state: 'UP', postcode: '273001', phone: '98765 43210', altPhone: '9876543211' };
  const a1 = await req('POST', `/api/users/${userA._id}/addresses`, { token: tokA, body: goodAddr });
  ok(a1.status === 201 && a1.json.addressId && a1.json.address.state === 'Uttar Pradesh', 'valid address saved + state canonicalised', a1.json);
  const addrA = a1.json.addressId;
  const ga = await req('POST', `/api/users/${guest._id}/addresses`, { token: tokG, body: { ...goodAddr, firstName: 'Guest', lastName: 'Buyer' } });
  ok(ga.status === 201, 'guest saves an address', ga.json);
  const addrG = ga.json.addressId;
  const upd = await req('PUT', `/api/users/${userA._id}/addresses/${addrA}`, { token: tokA, body: { apartment: 'Flat 2' } });
  ok(upd.status === 200 && upd.json.addresses[0].apartment === 'Flat 2', 'partial address update');
  const delMissing = await req('DELETE', `/api/users/${userA._id}/addresses/5f5f5f5f5f5f5f5f5f5f5f5f`, { token: tokA });
  ok(delMissing.status === 404, 'delete missing address -> 404');

  console.log('\n# Catalog + admin');
  const adminDoc = await new User({ name: 'Admin User', email: 'admin@test.local', password: 'adminpassword1', phone: '9415000000', role: 'admin' }).save();
  const al = await req('POST', '/api/auth/admin/login', { body: { email: 'admin@test.local', password: 'adminpassword1' } });
  ok(al.status === 200, 'admin login');
  const tokAdm = al.json.token;
  const nonAdmin = await req('GET', '/api/orders/admin', { token: tokA });
  ok(nonAdmin.status === 403, 'non-admin on admin route -> 403');
  const cat = await Category.create({ name: 'Sweets' });
  const kaju = await Item.create({ name: 'Kaju <script>alert(1)</script>', categories: [cat._id], price: 200, discountPrice: 150, stockQty: 5, shortDesc: 'x', weight: 500 });
  const ladoo = await Item.create({ name: 'Ladoo', categories: [cat._id], price: 400, stockQty: 1, shortDesc: 'x', weight: 250 });
  const upItem = await req('PUT', `/api/items/update/${ladoo._id}`, { token: tokAdm, body: { stockQty: 0, isBestSeller: 'false', discountPrice: '' } });
  ok(upItem.status === 200 && upItem.json.item.stockQty === 0 && upItem.json.item.discountPrice === 0 && upItem.json.item.name === 'Ladoo', 'item update accepts explicit falsy values, keeps absent fields', upItem.json);
  const cat2 = await Category.create({ name: 'Namkeen' });
  const upCats = await req('PUT', `/api/items/update/${ladoo._id}`, { token: tokAdm, body: { categoriesJson: JSON.stringify([String(cat2._id)]), subcategoriesJson: '[]' } });
  ok(upCats.status === 200 && upCats.json.item.categories.length === 1 && upCats.json.item.categories[0]._id === String(cat2._id) && upCats.json.item.subcategories.length === 0, 'categoriesJson/subcategoriesJson replace + clear', upCats.json);
  await Item.updateOne({ _id: ladoo._id }, { stockQty: 1 });
  const cust = await req('GET', '/api/search/customers?q=asha', { token: tokAdm });
  ok(cust.status === 200 && cust.json.customers.length && cust.json.customers.every((c) => c.password === undefined), 'search/customers hides password', cust.json);
  const rx = await req('GET', '/api/search/items?q=' + encodeURIComponent('(a+)+$'));
  ok(rx.status === 200, 'regex input escaped');

  console.log('\n# Checkout');
  const toffee = await Item.create({ name: 'Toffee', categories: [cat._id], price: 50, stockQty: 50, shortDesc: 'x', weight: 50 });
  const low = await req('POST', '/api/payment/create-order', { token: tokA, body: { addressId: addrA, items: [{ itemId: String(toffee._id), quantity: 1, price: 1000 }] } });
  ok(low.status === 400 && low.json.code === 'MIN_ORDER_VALUE' && low.json.minOrderValue === 100 && low.json.message === 'Minimum order value is ₹100', 'below min order value -> 400 MIN_ORDER_VALUE', low.json);
  const cod = await req('POST', '/api/payment/create-order', { token: tokA, body: { addressId: addrA, paymentMode: 'COD', items: [{ itemId: String(kaju._id), quantity: 2 }] } });
  ok(cod.status === 400, 'COD rejected');
  const oos = await req('POST', '/api/payment/create-order', { token: tokA, body: { addressId: addrA, items: [{ itemId: String(ladoo._id), quantity: 2 }] } });
  ok(oos.status === 400, 'insufficient stock -> 400', oos.json);
  const co = await req('POST', '/api/payment/create-order', { token: tokA, body: { addressId: addrA, userId: guest._id, items: [{ itemId: String(kaju._id), quantity: 2, price: 1 }] } });
  ok(co.status === 200 && co.json.pricing.subtotal === 300 && co.json.pricing.gst === 15 && co.json.pricing.shipping === 0 && co.json.pricing.platformFee === 7 && co.json.pricing.total === 322, 'create-order prices from DB', co.json);
  const o1 = await Order.findById(co.json.dbOrderId);
  ok(String(o1.userId) === userA._id && o1.shippingAddress?.street && o1.deliveryProvider === 'SELF', 'userId from token + shippingAddress snapshot');
  ok((await Item.findById(kaju._id)).stockQty === 5, 'no stock change at create-order');
  const myBefore = await req('GET', `/api/orders/my/${userA._id}`, { token: tokA });
  ok(myBefore.status === 200 && myBefore.json.orders.length === 0, 'unpaid orders hidden from customer');

  const rzp = co.json.order.id;
  captured.set('pay_1', { id: 'pay_1', order_id: rzp, status: 'captured', amount: 32200, currency: 'INR', method: 'upi' });
  const wrongBind = await req('POST', '/api/payment/verify', { token: tokA, body: { dbOrderId: co.json.dbOrderId, razorpay_order_id: 'order_other', razorpay_payment_id: 'pay_1', razorpay_signature: sign('order_other|pay_1', 'rzp_dummy_secret') } });
  ok(wrongBind.status === 400, 'verify with foreign razorpay_order_id -> 400', wrongBind.json);
  const otherUser = await req('POST', '/api/payment/verify', { token: tokG, body: { dbOrderId: co.json.dbOrderId, razorpay_order_id: rzp, razorpay_payment_id: 'pay_1', razorpay_signature: sign(`${rzp}|pay_1`, 'rzp_dummy_secret') } });
  ok(otherUser.status === 403, 'verify on someone else\'s order -> 403');
  const badSig = await req('POST', '/api/payment/verify', { token: tokA, body: { dbOrderId: co.json.dbOrderId, razorpay_order_id: rzp, razorpay_payment_id: 'pay_1', razorpay_signature: 'ab'.repeat(32) } });
  ok(badSig.status === 400, 'bad signature -> 400');

  const vBody = { dbOrderId: co.json.dbOrderId, razorpay_order_id: rzp, razorpay_payment_id: 'pay_1', razorpay_signature: sign(`${rzp}|pay_1`, 'rzp_dummy_secret') };
  const whPayload = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: captured.get('pay_1') } } });
  const [v1, v2, wh] = await Promise.all([
    req('POST', '/api/payment/verify', { token: tokA, body: vBody }),
    req('POST', '/api/payment/verify', { token: tokA, body: vBody }),
    req('POST', '/api/payment/webhook', { raw: whPayload, headers: { 'X-Razorpay-Signature': sign(whPayload, 'whsec_dummy') } }),
  ]);
  ok(v1.status === 200 && v2.status === 200 && wh.status === 200 && v1.json.order.paymentStatus === 'paid', 'verify x2 + webhook race all succeed', [v1.json, v2.json, wh.json]);
  ok((await Item.findById(kaju._id)).stockQty === 3, 'stock decremented exactly once (5 -> 3)');
  const { fyOf } = require(path.join(BACK, 'services/invoiceNumbers'));
  const FY = fyOf(new Date());
  const inv1 = (await Order.findById(co.json.dbOrderId)).invoiceNumber;
  ok(inv1 === `CSH/${FY}/00001`, 'first paid order gets invoice number 00001', inv1);
  const v3 = await req('POST', '/api/payment/verify', { token: tokA, body: vBody });
  ok(v3.status === 200 && (await Order.findById(co.json.dbOrderId)).invoiceNumber === inv1, 'invoice number assigned once (re-verify keeps it)');
  const myAfter = await req('GET', `/api/orders/my/${userA._id}`, { token: tokA });
  ok(myAfter.json.orders.length === 1 && myAfter.json.orders[0].invoiceToken && myAfter.json.orders[0].adminNotes === undefined, 'paid order visible with invoiceToken');
  const invOk = await req('GET', `/api/orders/${co.json.dbOrderId}/invoice?t=${myAfter.json.orders[0].invoiceToken}`);
  ok(invOk.status === 200 && invOk.text.includes('Kaju &lt;script&gt;') && !invOk.text.includes('<script>alert'), 'invoice with token renders escaped HTML');
  const invBad = await req('GET', `/api/orders/${co.json.dbOrderId}/invoice?t=${'0'.repeat(32)}`);
  ok(invBad.status === 403, 'invoice with wrong token -> 403');

  console.log('\n# Failure -> retry (user B)');
  const co2 = await req('POST', '/api/payment/create-order', { token: tokG, body: { addressId: addrG, items: [{ itemId: String(kaju._id), quantity: 2 }] } });
  ok(co2.status === 200, 'guest create-order', co2.json);
  const fl = await req('POST', '/api/payment/failure', { token: tokG, body: { dbOrderId: co2.json.dbOrderId, error_reason: 'card declined' } });
  const o2a = await Order.findById(co2.json.dbOrderId);
  ok(fl.status === 200 && o2a.paymentStatus === 'failed' && o2a.status === 'pending', 'failure keeps status pending', o2a && { ps: o2a.paymentStatus, s: o2a.status });
  const pay2 = { id: 'pay_2', order_id: co2.json.order.id, status: 'captured', amount: co2.json.order.amount, currency: 'INR', method: 'card' };
  captured.set('pay_2', pay2);
  const v2g = await req('POST', '/api/payment/verify', { token: tokG, body: { dbOrderId: co2.json.dbOrderId, razorpay_order_id: co2.json.order.id, razorpay_payment_id: 'pay_2', razorpay_signature: sign(`${co2.json.order.id}|pay_2`, 'rzp_dummy_secret') } });
  const o2b = await Order.findById(co2.json.dbOrderId);
  ok(v2g.status === 200 && o2b.paymentStatus === 'paid' && o2b.status === 'confirmed', 'guest verify: failed -> paid on retry', v2g.json);
  ok((await Item.findById(kaju._id)).stockQty === 1, 'stock 3 -> 1');
  const myG = await req('GET', `/api/orders/my/${guest._id}`, { token: tokG });
  ok(myG.status === 200 && myG.json.orders.length === 1, 'guest sees own paid order in orders/my');
  ok(o2b.invoiceNumber === `CSH/${FY}/00002`, 'second paid order gets the next invoice number', o2b.invoiceNumber);
  const g2 = await req('POST', '/api/auth/guest', { body: { phone: '9876543210' } });
  ok(g2.status === 201 && g2.json.user._id !== guest._id, 'second /auth/guest with same phone -> DIFFERENT user', g2.json);
  const g2Other = await req('GET', `/api/orders/my/${guest._id}`, { token: g2.json.token });
  ok(g2Other.status === 403, "second guest cannot list first guest's orders");
  const g2One = await req('GET', `/api/orders/${co2.json.dbOrderId}`, { token: g2.json.token });
  ok(g2One.status === 403, "second guest cannot read first guest's order");
  const g2Mine = await req('GET', `/api/orders/my/${g2.json.user._id}`, { token: g2.json.token });
  ok(g2Mine.status === 200 && g2Mine.json.orders.length === 0, 'second guest sees no orders');
  const claimUsed = await req('POST', '/api/auth/claim', { token: g2.json.token, body: { name: 'Ravi Kumar', email: 'ASHA@example.com', password: 'longenough2' } });
  ok(claimUsed.status === 409, 'claim with an existing email -> 409', claimUsed.json);
  const claimFull = await req('POST', '/api/auth/claim', { token: tokA, body: { name: 'Asha Verma', email: 'x@example.com', password: 'longenough2' } });
  ok(claimFull.status === 409, 'claim on a full account -> 409');
  const claimOk = await req('POST', '/api/auth/claim', { token: g2.json.token, body: { name: 'Ravi Kumar', email: 'ravi@example.com', password: 'longenough2' } });
  ok(claimOk.status === 200 && claimOk.json.user.isGuest === false && claimOk.json.user.email === 'ravi@example.com', 'claim converts guest to full account', claimOk.json);
  const loginClaimed = await req('POST', '/api/auth/login', { body: { email: 'ravi@example.com', password: 'longenough2' } });
  ok(loginClaimed.status === 200 && loginClaimed.json.user._id === g2.json.user._id, 'login works after claim');

  console.log('\n# Amount mismatch + capture on cancelled order');
  await Item.updateOne({ _id: kaju._id }, { stockQty: 10 });
  const co3 = await req('POST', '/api/payment/create-order', { token: tokA, body: { addressId: addrA, items: [{ itemId: String(kaju._id), quantity: 2 }] } });
  const pay3bad = { id: 'pay_3', order_id: co3.json.order.id, status: 'captured', amount: 100, currency: 'INR' };
  captured.set('pay_3', pay3bad);
  const mm = await req('POST', '/api/payment/verify', { token: tokA, body: { dbOrderId: co3.json.dbOrderId, razorpay_order_id: co3.json.order.id, razorpay_payment_id: 'pay_3', razorpay_signature: sign(`${co3.json.order.id}|pay_3`, 'rzp_dummy_secret') } });
  ok(mm.status === 400 && (await Order.findById(co3.json.dbOrderId)).paymentStatus !== 'paid', 'captured amount mismatch -> 400, not paid', mm.json);
  const cancelUnpaid = await req('PATCH', `/api/orders/${co3.json.dbOrderId}/cancel`, { token: tokAdm, body: { reason: 'abandoned', refund: 'manual' } });
  ok(cancelUnpaid.status === 200 && cancelUnpaid.json.order.refundStatus === 'none' && cancelUnpaid.json.order.paymentStatus === 'cancelled', 'cancel unpaid with refund:manual does not mark refunded', cancelUnpaid.json);
  const pay3 = { id: 'pay_3b', order_id: co3.json.order.id, status: 'captured', amount: co3.json.order.amount, currency: 'INR' };
  const wh3p = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: pay3 } } });
  await req('POST', '/api/payment/webhook', { raw: wh3p, headers: { 'X-Razorpay-Signature': sign(wh3p, 'whsec_dummy') } });
  const o3 = await Order.findById(co3.json.dbOrderId);
  ok(o3.paymentStatus === 'paid' && o3.status === 'cancelled' && o3.refunds.length === 1 && o3.refundStatus === 'processed', 'capture on cancelled order -> automatic full refund', { ps: o3.paymentStatus, s: o3.status, r: o3.refunds, rs: o3.refundStatus });
  ok((await Item.findById(kaju._id)).stockQty === 10, 'no stock change for cancelled-capture');

  console.log('\n# Admin orders');
  const list = await req('GET', '/api/orders/admin?view=paid&limit=500', { token: tokAdm });
  ok(list.status === 200 && list.json.pagination.limit === 100 && list.json.counts.paid === 3 && list.json.counts.unpaid === 0, 'admin list paid view + capped limit + counts', list.json && { p: list.json.pagination, c: list.json.counts, s: list.json.summary });
  const row = list.json.orders.find((o) => o._id === co.json.dbOrderId);
  ok(row && row.customerPhone === '9876543210' && row.customerAltPhone === '9876543211' && row.customerFirstName === 'Asha' && row.shortId && row.invoiceToken && row.isGuest === false && row.paidAt && row.statusHistory.length >= 1 && row.razorpayData.some((r) => r.amountRupees === 322), 'admin row contact/timeline/amountRupees fields', row);
  const adminOne = await req('GET', `/api/orders/${co.json.dbOrderId}`, { token: tokAdm });
  const guestRow = list.json.orders.find((o) => o._id === co2.json.dbOrderId);
  ok(guestRow && guestRow.isGuest === true, 'admin row exposes isGuest');
  ok(adminOne.status === 200 && adminOne.json.order.shortId && adminOne.json.order.customerPhone && Array.isArray(adminOne.json.order.statusHistory), 'admin GET /orders/:id returns admin row shape', adminOne.json && Object.keys(adminOne.json.order || {}).length);
  const q = await req('GET', `/api/orders/admin?view=all&q=${co.json.dbOrderId.slice(-6)}`, { token: tokAdm });
  ok(q.status === 200 && q.json.orders.length === 1, 'search by last 6 of id', q.json && q.json.summary);
  const qInj = await req('GET', '/api/orders/admin?status[$ne]=x&view=all', { token: tokAdm });
  ok(qInj.status === 200, 'query operator injection ignored');
  const csv = await req('GET', '/api/orders/admin/export?view=all', { token: tokAdm });
  ok(csv.status === 200 && /text\/csv/.test(csv.headers['content-type']) && csv.text.includes('Order ID'), 'CSV export');
  const users = await req('GET', '/api/users?limit=1000', { token: tokAdm });
  ok(users.status === 200 && users.json.pagination.limit === 100 && users.json.users.every((u) => u.password === undefined && 'isGuest' in u) && users.json.users.find((u) => u._id === userA._id).orderCount === 2 && users.json.users.find((u) => u._id === userA._id).totalSpent === 322, 'GET /users caps limit, stats, no secrets', users.json && users.json.users.map((u) => [u.email, u.orderCount, u.totalSpent]));

  console.log('\n# Refunds / cancel / status machine');
  const id1 = co.json.dbOrderId;
  const over = await req('POST', `/api/orders/${id1}/refund`, { token: tokAdm, body: { amount: 1000, reason: 'x', mode: 'manual' } });
  ok(over.status === 400, 'refund > refundable -> 400', over.json);
  const part = await req('POST', `/api/orders/${id1}/refund`, { token: tokAdm, body: { amount: 50, reason: 'broken box', mode: 'manual' } });
  ok(part.status === 200 && part.json.order.refundStatus === 'partial' && part.json.order.refundedAmount === 50 && part.json.order.refundableAmount === 272, 'partial manual refund', part.json && part.json.order);
  ok(/^CSH\/CN\/\d{4}-\d{2}\/\d{5}$/.test(part.json.order.refunds[0].creditNoteNumber || ''), 'processed refund gets a credit-note number', part.json.order.refunds);
  config.razorpay.payments.refund = async (pid, { amount }) => ({ id: `rfnd_${pid}_${amount}`, status: 'processed', amount, acquirer_data: { arn: 'ARN123456789' } });
  const rp = await req('POST', `/api/orders/${id1}/refund`, { token: tokAdm, body: { amount: 22, reason: 'goodwill', mode: 'razorpay' } });
  ok(rp.status === 200 && rp.json.order.refundedAmount === 72, 'razorpay partial refund', rp.json && rp.json.order);
  ok(rp.json.order.refunds[1].arn === 'ARN123456789' && rp.json.order.refunds[1].creditNoteNumber, 'refund stores ARN + credit note', rp.json.order.refunds);
  const custView = await req('GET', `/api/orders/${id1}`, { token: tokA });
  ok(custView.json.order.refunds[1].arn === 'ARN123456789' && custView.json.order.refunds[1].creditNoteNumber && custView.json.order.invoiceNumber, 'customer order shows arn, creditNoteNumber, invoiceNumber');
  const stockBefore = (await Item.findById(kaju._id)).stockQty;
  const cancel = await req('PATCH', `/api/orders/${id1}/cancel`, { token: tokAdm, body: { reason: 'customer request', refund: 'auto' } });
  ok(cancel.status === 200 && cancel.json.order.status === 'cancelled' && cancel.json.order.refundStatus === 'processed' && cancel.json.order.refundedAmount === 322, 'cancel paid with auto refund of the remainder', cancel.json && cancel.json.order);
  ok((await Item.findById(kaju._id)).stockQty === stockBefore + 2, 'cancel restocks once');
  const cancel2 = await req('PATCH', `/api/orders/${id1}/cancel`, { token: tokAdm, body: { refund: 'none' } });
  ok(cancel2.status === 409, 'cancel twice -> 409');
  const st1 = await req('PATCH', `/api/orders/${id1}/status`, { token: tokAdm, body: { status: 'cancelled' } });
  ok(st1.status === 409, 'status cancelled on cancelled -> 409');
  ok((await Item.findById(kaju._id)).stockQty === stockBefore + 2, 'no double restock');

  const id2 = co2.json.dbOrderId;
  const ofd = await req('PATCH', `/api/orders/${id2}/delivery-status`, { token: tokAdm, body: { deliveryStatus: 'OUT_FOR_DELIVERY' } });
  ok(ofd.status === 200 && ofd.json.order.status === 'shipped', 'SELF -> OUT_FOR_DELIVERY');
  const dlv = await req('PATCH', `/api/orders/${id2}/status`, { token: tokAdm, body: { status: 'delivered' } });
  ok(dlv.status === 200 && dlv.json.order.deliveredAt, 'delivered sets deliveredAt', dlv.json);
  const back = await req('PATCH', `/api/orders/${id2}/delivery-status`, { token: tokAdm, body: { deliveryStatus: 'PENDING' } });
  ok(back.status === 409, 'DELIVERED -> PENDING -> 409', back.json);
  const unpay = await req('PATCH', `/api/orders/${id2}/payment-status`, { token: tokAdm, body: { paymentStatus: 'pending' } });
  ok(unpay.status === 409, 'cannot un-pay a paid order');
  const bulk = await req('PATCH', '/api/orders/bulk/status', { token: tokAdm, body: { orderIds: [id2, 'bad'], deliveryStatus: 'OUT_FOR_DELIVERY' } });
  ok(bulk.status === 200 && bulk.json.updated === 0 && bulk.json.failed.length === 2, 'bulk reports per-order failures', bulk.json);

  // Manual paid path.
  await Item.updateOne({ _id: kaju._id }, { stockQty: 10 });
  const co4 = await req('POST', '/api/payment/create-order', { token: tokA, body: { addressId: addrA, items: [{ itemId: String(kaju._id), quantity: 2 }] } });
  const noNote = await req('PATCH', `/api/orders/${co4.json.dbOrderId}/payment-status`, { token: tokAdm, body: { paymentStatus: 'paid' } });
  ok(noNote.status === 400, 'manual paid requires note');
  const manual = await req('PATCH', `/api/orders/${co4.json.dbOrderId}/payment-status`, { token: tokAdm, body: { paymentStatus: 'paid', note: 'UPI to shop QR' } });
  ok(manual.status === 200 && manual.json.order.paymentStatus === 'paid' && manual.json.order.razorpayData.some((r) => r.source === 'manual_confirmation'), 'manual paid', manual.json && manual.json.order.paymentStatus);
  ok((await Item.findById(kaju._id)).stockQty === 8, 'manual paid decrements stock');

  // Refund webhook.
  const o4 = await Order.findById(co4.json.dbOrderId);
  config.razorpay.payments.refund = async () => ({ id: 'rfnd_pending', status: 'pending' });
  // order 4 has no captured razorpay payment id (manual) -> razorpay refund must 409
  const rpManual = await req('POST', `/api/orders/${o4._id}/refund`, { token: tokAdm, body: { reason: 'x', mode: 'razorpay' } });
  ok(rpManual.status === 409, 'razorpay refund on manually-paid order -> 409', rpManual.json);
  const rpPending = await req('POST', `/api/orders/${id2}/refund`, { token: tokAdm, body: { amount: 10, reason: 'late', mode: 'razorpay', restock: false } });
  ok(rpPending.status === 200 && rpPending.json.order.refundStatus === 'pending', 'pending razorpay refund', rpPending.json && rpPending.json.order);
  const rfp = JSON.stringify({ event: 'refund.failed', payload: { refund: { entity: { id: 'rfnd_pending', payment_id: 'pay_2', amount: 1000 } } } });
  const rfw = await req('POST', '/api/payment/webhook', { raw: rfp, headers: { 'X-Razorpay-Signature': sign(rfp, 'whsec_dummy') } });
  const o2c = await Order.findById(id2);
  ok(rfw.status === 200 && o2c.refundStatus === 'failed' && o2c.refundedAmount === 0, 'refund.failed webhook releases the amount', { rs: o2c.refundStatus, ra: o2c.refundedAmount });

  console.log('\n# Dashboard / reports / tickets / cleanup');
  const dash = await req('GET', '/api/dashboard/stats', { token: tokAdm });
  ok(dash.status === 200 && dash.json.newOrders === 4 && 'refundsPending' in dash.json && 'lowStock' in dash.json && typeof dash.json.openTickets === 'number', 'dashboard stats (paid only)', dash.json);
  const rep = await req('GET', '/api/reports/summary', { token: tokAdm });
  ok(rep.status === 200 && rep.json.salesByDay.length === 30 && rep.json.kpis.paidOrders === 4 && rep.json.topProducts.length >= 1, 'reports summary', rep.json && rep.json.kpis);
  const repCsv = await req('GET', '/api/reports/export?type=products', { token: tokAdm });
  ok(repCsv.status === 200 && /text\/csv/.test(repCsv.headers['content-type']), 'reports export csv');
  const t = await req('POST', '/api/tickets', { token: tokG, body: { fullName: 'Ravi Kumar', subject: 'Where', message: 'Where is my order', userId: userA._id } });
  ok(t.status === 201 && t.json.ticket.userId === guest._id, 'ticket userId from token, not body', t.json);
  const tOther = await req('GET', `/api/tickets/${t.json.ticket._id}`, { token: tokA });
  ok(tOther.status === 403, 'ticket IDOR -> 403');
  await Order.create({ userId: adminDoc._id, addressId: adminDoc._id, deliveryPincode: '273001', items: [{ itemId: kaju._id, quantity: 1, price: 1 }], totalAmount: 1, paymentStatus: 'failed', createdAt: new Date(Date.now() - 48 * 3600e3) });
  const clean = await req('POST', '/api/payment/clean-failed', { token: tokAdm });
  ok(clean.status === 200 && clean.json.deleted === 1, 'clean-failed deletes only old unpaid', clean.json);

  console.log('\n# Settings');
  const pub = await req('GET', '/api/settings/public');
  ok(pub.status === 200 && pub.json.settings.business.name === 'Chowdhry Sweet House' && pub.json.settings.checkout.minOrderValue === 100 && pub.json.settings.checkout.platformFeePercent === 2
    && pub.json.settings.internal === undefined && pub.json.settings.notifications === undefined && pub.json.settings.settingsHistory === undefined && pub.json.settings.legal.pan === undefined,
    'public settings: defaults, hides internal/notifications/history/PAN', pub.json);
  const pubCors = await req('GET', '/api/settings/public', { headers: { Origin: 'https://chowdhrysweethouse.in' } });
  ok(pubCors.headers['access-control-allow-origin'] === 'https://chowdhrysweethouse.in', 'settings/public allowed cross-origin for the storefront');
  ok(pub.headers['x-content-type-options'] === 'nosniff', 'helmet security headers present');
  const putAnon = await req('PUT', '/api/settings', { body: { section: 'internal', data: { notes: 'x' } } });
  ok(putAnon.status === 401, 'PUT /settings unauthenticated -> 401');
  const putUser = await req('PUT', '/api/settings', { token: tokA, body: { section: 'internal', data: { notes: 'x' } } });
  ok(putUser.status === 403, 'PUT /settings non-admin -> 403');
  const putBad = await req('PUT', '/api/settings', { token: tokAdm, body: { section: 'legal', data: { gstin: 'NOT-A-GSTIN', fssaiLicense: '12' } } });
  ok(putBad.status === 400 && putBad.json.fieldErrors['legal.gstin'] && putBad.json.fieldErrors['legal.fssaiLicense'], 'invalid settings -> 400 dotted fieldErrors', putBad.json);
  const putInt = await req('PUT', '/api/settings', { token: tokAdm, body: { section: 'internal', data: { notes: 'secret note' } } });
  ok(putInt.status === 200 && putInt.json.settings.settingsHistory.at(-1).section === 'internal' && putInt.json.settings.settingsHistory.at(-1).by.name === 'Admin User' && putInt.json.settings.updatedBy.name === 'Admin User', 'settings audit history with user names', putInt.json && putInt.json.settings.settingsHistory);
  const putLegal = await req('PUT', '/api/settings', { token: tokAdm, body: { section: 'legal', data: { gstin: '09ABCDE1234F1ZY', fssaiLicense: '12345678901234', grievanceOfficer: { name: 'R. Chowdhry', email: 'grievance@example.com' } } } });
  ok(putLegal.status === 200, 'valid legal settings saved', putLegal.json);
  const pub2 = await req('GET', '/api/settings/public');
  ok(!JSON.stringify(pub2.json).includes('secret note') && pub2.json.settings.legal.gstin === '09ABCDE1234F1ZY', 'public subset hides internal notes, shows GSTIN');

  const setCheckout = (data) => req('PUT', '/api/settings', { token: tokAdm, body: { section: 'checkout', data } });
  const setLegal = (data) => req('PUT', '/api/settings', { token: tokAdm, body: { section: 'legal', data } });
  await Item.updateOne({ _id: kaju._id }, { stockQty: 50 });
  await setCheckout({ minOrderValue: 500 });
  const minS = await req('POST', '/api/payment/create-order', { token: tokA, body: { addressId: addrA, items: [{ itemId: String(kaju._id), quantity: 2 }] } });
  ok(minS.status === 400 && minS.json.code === 'MIN_ORDER_VALUE' && minS.json.minOrderValue === 500, 'min order value from settings', minS.json);
  await setCheckout({ minOrderValue: null, orderingEnabled: false, orderingPausedMessage: 'Closed for Diwali' });
  const paused = await req('POST', '/api/payment/create-order', { token: tokA, body: { addressId: addrA, items: [{ itemId: String(kaju._id), quantity: 2 }] } });
  ok(paused.status === 503 && paused.json.code === 'ORDERING_PAUSED' && paused.json.message === 'Closed for Diwali', 'ordering paused -> 503', paused.json);
  const cfgP = await req('GET', '/api/payment/config');
  ok(cfgP.json.orderingEnabled === false && cfgP.json.orderingPausedMessage === 'Closed for Diwali' && cfgP.json.gstScheme === 'regular' && cfgP.json.pricesIncludeGst === false && cfgP.json.platformFeePercent === 2 && cfgP.json.minOrderValue === 100, '/payment/config reflects settings', cfgP.json);
  await setCheckout({ orderingEnabled: true });

  await setLegal({ gstScheme: 'composition' });
  const comp = await req('POST', '/api/payment/create-order', { token: tokA, body: { addressId: addrA, items: [{ itemId: String(kaju._id), quantity: 2 }] } });
  ok(comp.status === 200 && comp.json.pricing.gst === 0 && comp.json.pricing.total === 306 && comp.json.pricing.gstScheme === 'composition', 'composition scheme: no GST charged', comp.json && comp.json.pricing);
  const compOrder = await Order.findById(comp.json.dbOrderId);
  ok(compOrder.gstScheme === 'composition' && compOrder.gstAmount === 0, 'order stores tax snapshot');
  captured.set('pay_c', { id: 'pay_c', order_id: comp.json.order.id, status: 'captured', amount: comp.json.order.amount, currency: 'INR', method: 'upi' });
  await req('POST', '/api/payment/verify', { token: tokA, body: { dbOrderId: comp.json.dbOrderId, razorpay_order_id: comp.json.order.id, razorpay_payment_id: 'pay_c', razorpay_signature: sign(`${comp.json.order.id}|pay_c`, 'rzp_dummy_secret') } });
  const compPaid = await Order.findById(comp.json.dbOrderId);
  const compInv = await req('GET', `/api/orders/${comp.json.dbOrderId}/invoice?t=${require(path.join(BACK, 'utils')).invoiceTokenFor(comp.json.dbOrderId)}`);
  ok(compInv.status === 200 && compInv.text.includes('BILL OF SUPPLY') && compInv.text.includes('Composition taxable person') && compInv.text.includes(compPaid.invoiceNumber), 'composition invoice is a Bill of Supply with number', compPaid.invoiceNumber);
  await setLegal({ gstScheme: 'regular' });
  await setCheckout({ pricesIncludeGst: true });
  const incl = await req('POST', '/api/payment/create-order', { token: tokA, body: { addressId: addrA, items: [{ itemId: String(kaju._id), quantity: 2 }] } });
  ok(incl.status === 200 && incl.json.pricing.gst === 14.29 && incl.json.pricing.gstIncluded === true && incl.json.pricing.total === 306, 'inclusive pricing extracts GST, never adds it', incl.json && incl.json.pricing);
  await setCheckout({ pricesIncludeGst: false, platformFeePercent: 0 });
  const nofee = await req('POST', '/api/payment/create-order', { token: tokA, body: { addressId: addrA, items: [{ itemId: String(kaju._id), quantity: 2 }] } });
  ok(nofee.status === 200 && nofee.json.pricing.platformFee === 0 && nofee.json.pricing.total === 315, 'platform fee 0 from settings', nofee.json && nofee.json.pricing);
  await setCheckout({ platformFeePercent: null });

  // Tax invoice: CGST/SGST for intra-state (UP → UP), legal header from settings.
  const taxInv = await req('GET', `/api/orders/${co2.json.dbOrderId}/invoice?t=${require(path.join(BACK, 'utils')).invoiceTokenFor(co2.json.dbOrderId)}`);
  ok(taxInv.text.includes('TAX INVOICE') && taxInv.text.includes('CGST') && taxInv.text.includes('SGST') && taxInv.text.includes('09ABCDE1234F1ZY') && taxInv.text.includes('12345678901234') && taxInv.text.includes('R. Chowdhry') && taxInv.text.includes('2106'), 'tax invoice: GSTIN, FSSAI, HSN, CGST/SGST, grievance');

  const paid = await Order.find({ invoiceNumber: { $exists: true } }).select('invoiceNumber').lean();
  const seqs = paid.map((o) => Number(o.invoiceNumber.split('/').pop())).sort((a, b) => a - b);
  ok(seqs.length >= 4 && seqs.every((n, i) => n === i + 1), 'invoice numbers are sequential with no gaps/duplicates', paid.map((o) => o.invoiceNumber));

  console.log('\n# Pages / sitemap');
  const pp = await req('GET', '/api/pages/privacy-policy');
  ok(pp.status === 200 && pp.json.page.content.includes('Chowdhry Sweet House') && pp.json.page.content.includes('R. Chowdhry') && pp.json.page.content.includes('grievance@example.com') && !pp.json.page.content.includes('{{') && pp.json.page.isTemplate === true && pp.json.page.rawContent === undefined, 'policy page resolves placeholders from settings', pp.json && pp.json.page.content.slice(0, 200));
  const unknownPage = await req('GET', '/api/pages/nope');
  ok(unknownPage.status === 404, 'unknown page -> 404');
  const pAnon = await req('PUT', '/api/pages/terms', { body: { published: false } });
  ok(pAnon.status === 401, 'PUT page unauthenticated -> 401');
  const unpub = await req('PUT', '/api/pages/terms', { token: tokAdm, body: { published: false, content: '# Terms\n{{business.name}} at {{business.address}}' } });
  ok(unpub.status === 200 && unpub.json.page.isTemplate === false && unpub.json.page.updatedBy.name === 'Admin User', 'admin saves page (template flag cleared)', unpub.json);
  const termsPub = await req('GET', '/api/pages/terms');
  ok(termsPub.status === 404, 'unpublished page -> 404 publicly');
  const termsAdm = await req('GET', '/api/pages/terms', { token: tokAdm });
  ok(termsAdm.status === 200 && termsAdm.json.page.published === false && termsAdm.json.page.rawContent.includes('{{business.name}}'), 'admin can read drafts');
  const plist = await req('GET', '/api/pages', { token: tokAdm });
  ok(plist.status === 200 && plist.json.pages.length === 7 && plist.json.pages.some((p) => p.isTemplate), 'GET /pages (admin) lists pages with flags');
  const sm = await req('GET', '/api/sitemap.xml');
  ok(sm.status === 200 && /application\/xml/.test(sm.headers['content-type']) && sm.text.includes(`/product/${kaju._id}`) && sm.text.includes('/privacy-policy') && sm.text.includes('/about') && sm.text.includes('/contact') && sm.text.includes('/specials') && !sm.text.includes('/terms<'), 'sitemap: static pages, published policies only, products');

  console.log('\n# Items / delivery');
  const food = await req('PUT', `/api/items/update/${kaju._id}`, { token: tokAdm, body: { foodType: 'veg', allergensJson: '["milk","nuts"]', ingredients: 'Cashew, sugar', netWeight: '500 g', shelfLifeDays: '', gstRate: '', hsnCode: '2106', shippable: 'false' } });
  ok(food.status === 200 && food.json.item.allergens.join() === 'milk,nuts' && food.json.item.netWeight === '500 g' && food.json.item.shelfLifeDays === undefined && food.json.item.shippable === false, 'item food-info fields', food.json && food.json.item);
  const badAllergen = await req('PUT', `/api/items/update/${kaju._id}`, { token: tokAdm, body: { allergensJson: '["peanut-butter"]' } });
  ok(badAllergen.status === 400, 'invalid allergen -> 400');
  const { _assertShippable } = require(path.join(BACK, 'controllers/paymentController'));
  let ns = null; try { _assertShippable('DELHIVERY', [{ name: 'Rasgulla', shippable: false }]); } catch (e) { ns = e; }
  ok(ns && ns.status === 400 && ns.extra.code === 'NOT_SHIPPABLE', 'courier order with perishable items -> NOT_SHIPPABLE');
  let okLocal = true; try { _assertShippable('SELF', [{ name: 'Rasgulla', shippable: false }]); } catch { okLocal = false; }
  ok(okLocal, 'local delivery allows non-shippable items');
  const dc = await req('GET', '/api/delivery/check/273001?weight=500');
  ok(dc.status === 200 && dc.json.serviceable && typeof dc.json.eta === 'string', 'delivery check returns eta', dc.json);

  console.log('\n# Cron reconcile');
  const cNo = await req('GET', '/api/cron/reconcile');
  ok(cNo.status === 401, 'cron without secret -> 401');
  const cBad = await req('GET', '/api/cron/reconcile', { headers: { Authorization: 'Bearer wrong' } });
  ok(cBad.status === 401, 'cron with wrong secret -> 401');
  const recon = await req('POST', '/api/payment/create-order', { token: tokA, body: { addressId: addrA, items: [{ itemId: String(kaju._id), quantity: 2 }] } });
  const reconRzp = recon.json.order.id;
  config.razorpay.orders.fetchPayments = async (oid) => ({ items: oid === reconRzp ? [{ id: 'pay_r', order_id: oid, status: 'captured', amount: recon.json.order.amount, currency: 'INR', method: 'upi' }] : [] });
  const cOk = await req('GET', '/api/cron/reconcile', { headers: { Authorization: 'Bearer cron_dummy' } });
  const reconOrder = await Order.findById(recon.json.dbOrderId);
  ok(cOk.status === 200 && cOk.json.confirmed === 1 && reconOrder.paymentStatus === 'paid' && reconOrder.invoiceNumber && reconOrder.razorpayData.some((r) => r.source === 'reconcile'), 'reconcile confirms a missed captured payment', cOk.json);
  const cAgain = await req('GET', '/api/cron/reconcile', { headers: { Authorization: 'Bearer cron_dummy' } });
  ok(cAgain.json.confirmed === 0, 'reconcile is idempotent', cAgain.json);

  console.log('\n# Account deletion');
  const delAdm = await req('DELETE', '/api/auth/account', { token: tokAdm });
  ok(delAdm.status === 403, 'admin cannot self-delete');
  const ordersBefore = await Order.countDocuments({ userId: userA._id });
  const del = await req('DELETE', '/api/auth/account', { token: tokA });
  ok(del.status === 200 && del.json.success === true, 'DELETE /auth/account');
  const gone = await UserModel.findById(userA._id).lean();
  ok(gone.isDeleted === true && gone.name === 'Deleted user' && !gone.email && !gone.password && !gone.phone && gone.address.length === 0 && gone.tokenVersion === 1, 'user anonymised', gone);
  const oldTok = await req('GET', '/api/auth/me', { token: tokA });
  ok(oldTok.status === 401, 'old token revoked after deletion');
  ok((await Order.countDocuments({ userId: userA._id })) === ordersBefore && ordersBefore > 0, 'orders retained for GST records');
  const relogin = await req('POST', '/api/auth/login', { body: { email: 'asha@example.com', password: 'longenough1' } });
  ok(relogin.status === 401, 'deleted account cannot log in');

  console.log('\n# Rate limiting');
  let last;
  for (let i = 0; i < 11; i++) last = await req('POST', '/api/auth/login', { body: { email: 'rl@test.local', password: 'wrongpassword' } });
  ok(last.status === 429, 'login rate limited after 10 attempts', last.status);

  await mongoose.disconnect();
}

(async () => {
  let mongod = null;
  try {
    const { MongoMemoryServer } = require('mongodb-memory-server');
    mongod = await MongoMemoryServer.create();
    process.env.MONGODB_URI = mongod.getUri('chowtest');
  } catch (e) {
    console.log('mongodb-memory-server unavailable — DB-backed tests skipped:', e.message);
    process.env.MONGODB_URI = '';
  }
  const app = require(path.join(BACK, 'server.js'));
  server = http.createServer(app).listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  try {
    await noDbChecks();
    if (mongod) await dbChecks();
  } catch (e) {
    failed++;
    console.error('ERROR', e);
  } finally {
    server.close();
    if (mongod) await mongod.stop();
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
  }
})();
