const axios = require('axios');
const { isGorakhpurPincode } = require('../config/gorakhpurPincodes');

const createAxiosInstance = (baseURL, timeout = 10000) => {
  return axios.create({
    ...(baseURL && { baseURL }),
    timeout,
    headers: { 'User-Agent': 'ChowApp/1.0' }
  });
};

const axiosInstance = createAxiosInstance();

// ==================== SHARED HELPERS ====================

// Orders store providers in UPPERCASE ('SELF' | 'DELHIVERY'); delivery quotes use lowercase.
// Always compare through this helper.
const normalizeProvider = (p) => {
  const v = String(p || '').trim().toUpperCase();
  if (v === 'SELF' || v === 'LOCAL') return 'SELF';
  if (v === 'DELHIVERY') return 'DELHIVERY';
  return null;
};

// THE Delhivery status -> internal deliveryStatus map (used by the webhook and tracking).
const DELHIVERY_STATUS_MAP = {
  'manifested': 'SHIPMENT_CREATED',
  'shipped': 'SHIPMENT_CREATED',
  'dispatched': 'SHIPMENT_CREATED',
  'in transit': 'IN_TRANSIT',
  'out for delivery': 'OUT_FOR_DELIVERY',
  'delivered': 'DELIVERED',
  'rto initiated': 'RTO',
  'rto-initiated': 'RTO',
  'rto delivered': 'RTO',
  'rto-delivered': 'RTO',
  'rto': 'RTO',
  'lost': 'RTO',
  'damaged': 'RTO',
  'cancelled': 'PRE_PICKUP_CANCEL',
  'canceled': 'PRE_PICKUP_CANCEL'
};
const mapDelhiveryStatus = (status) => DELHIVERY_STATUS_MAP[String(status || '').trim().toLowerCase()] || null;

// Fee charged when geocoding fails (never free). Override with LOCAL_DELIVERY_FALLBACK_FEE.
const LOCAL_DELIVERY_FALLBACK_FEE = Number(process.env.LOCAL_DELIVERY_FALLBACK_FEE) || 100;

const coordCache = new Map();

// ==================== DISTANCE SERVICE ====================

class DistanceService {
  async calculateDistance(fromPincode, toPincode) {
    try {
      const [fromCoords, toCoords] = await Promise.all([
        this._getCoordinates(fromPincode),
        this._getCoordinates(toPincode)
      ]);

      if (!fromCoords || !toCoords) return null;

      try {
        const response = await axiosInstance.get(
          `https://router.project-osrm.org/route/v1/driving/${fromCoords[0]},${fromCoords[1]};${toCoords[0]},${toCoords[1]}?overview=false`,
          { timeout: 3000 }
        );
        
        if (response.data.routes?.[0]?.distance) {
          return Math.round(response.data.routes[0].distance / 1000 * 100) / 100;
        }
      } catch {
        // Fallback to Haversine
      }

      return this._haversineDistance(fromCoords[1], fromCoords[0], toCoords[1], toCoords[0]);
    } catch {
      return null;
    }
  }

  async _getCoordinates(pincode) {
    pincode = String(pincode);
    if (!/^\d{6}$/.test(pincode)) return null;
    if (coordCache.has(pincode)) return coordCache.get(pincode);
    try {
      const response = await axiosInstance.get(
        `https://nominatim.openstreetmap.org/search?format=json&countrycodes=in&postalcode=${pincode}&limit=1`,
        { timeout: 3000 }
      );
      const data = response.data;
      const coords = data[0] ? [parseFloat(data[0].lon), parseFloat(data[0].lat)] : null;
      if (coords) {
        if (coordCache.size > 1000) coordCache.delete(coordCache.keys().next().value);
        coordCache.set(pincode, coords);
      }
      return coords;
    } catch {
      return null;
    }
  }

  _haversineDistance(lat1, lon1, lat2, lon2) {
    const toRad = x => x * Math.PI / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat/2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon/2) ** 2;
    return Math.round(6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)) * 100) / 100;
  }
}

// ==================== DELHIVERY SERVICE ====================

class DelhiveryService {
  constructor() {
    this.baseURL = process.env.DELHIVERY_BASE_URL || 'https://track.delhivery.com';
    this.token = process.env.DELHIVERY_TOKEN;
    this.pickupPincode = process.env.DELHIVERY_PICKUP_PIN || '273002';
    this.useRealAPI = process.env.USE_REAL_DELHIVERY === 'true';
    this.distanceService = new DistanceService();
    
    this.axiosInstance = createAxiosInstance(this.baseURL, 15000);
    this.axiosInstance.defaults.headers['Authorization'] = `Token ${this.token}`;
    this.axiosInstance.defaults.headers['Content-Type'] = 'application/json';
  }

  async checkPincode(pincode) {
    if (!this._validatePincode(pincode)) {
      return { success: false, error: 'Valid 6-digit pincode required' };
    }
    
    if (!this.useRealAPI) {
      return this._mockCheckPincode(pincode);
    }

    try {
      const response = await this.axiosInstance.get('/api/kinko/v1/invoice/charges/.json', {
        params: { md: 'S', ss: 'Delivered', d_pin: pincode, o_pin: this.pickupPincode, cgm: 1 }
      });
      
      const rateData = response.data?.[0];
      return rateData?.total_amount !== undefined
        ? { success: true, serviceable: true, city: rateData.destination_city || 'Unknown', state: rateData.destination_state || 'Unknown' }
        : { success: false, serviceable: false };
    } catch {
      return { success: false, serviceable: false };
    }
  }

  async calculateRate({ pickupPincode, deliveryPincode, weight }) {
    if (!deliveryPincode || !weight || weight <= 0) {
      return { success: false, error: 'Valid delivery pincode and weight required' };
    }
    
    if (!this.useRealAPI) {
      return this._mockCalculateRate({ pickupPincode, deliveryPincode, weight });
    }

    try {
      const response = await this.axiosInstance.get('/api/kinko/v1/invoice/charges/.json', {
        params: {
          md: 'S', ss: 'Delivered', d_pin: deliveryPincode,
          o_pin: pickupPincode || this.pickupPincode, cgm: Math.ceil(weight / 1000)
        }
      });

      const rateData = response.data?.[0];
      return rateData
        ? { success: true, rate: rateData.total_amount || 0, currency: 'INR', breakdown: rateData }
        : { success: false, error: 'No rate data received' };
    } catch (error) {
      return { success: false, error: `Rate calculation failed: ${error.message}` };
    }
  }

  async createShipment(orderData) {
    try {
      if (!orderData?.orderId) {
        return { success: false, error: 'Order data with orderId is required' };
      }
      
      if (isGorakhpurPincode(orderData.pincode)) {
        return { success: false, error: 'Gorakhpur orders use self-delivery' };
      }
      
      if (!this.useRealAPI) {
        return this._mockCreateShipment(orderData);
      }

      const shipmentData = this._buildShipmentPayload(orderData);
      
      const response = await this.axiosInstance.post('/cmu/create.json', 
        `format=json&data=${JSON.stringify(shipmentData)}`,
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 15000 }
      );

      const packageData = response.data.packages?.[0];
      
      return packageData?.waybill
        ? { success: true, waybill: packageData.waybill, status: 'SHIPMENT_CREATED', estimatedDelivery: packageData.expected_delivery_date }
        : { success: false, error: 'No waybill received from Delhivery API' };
    } catch (error) {
      console.error('Delhivery shipment creation error:', error.message);
      return { success: false, error: `Shipment creation failed: ${error.message}` };
    }
  }

  async trackShipment(waybill) {
    if (!waybill) {
      return { success: false, error: 'Waybill number is required' };
    }
    
    if (!this.useRealAPI) {
      return this._mockTrackShipment(waybill);
    }

    try {
      const response = await this.axiosInstance.get('/v1/packages/json/', { params: { waybill } });
      const shipment = response.data.ShipmentData?.[0];
      
      if (!shipment) {
        return { success: false, error: 'Shipment not found' };
      }
      
      const shipmentInfo = shipment.Shipment;
      return {
        success: true,
        status: this._mapDelhiveryStatus(shipmentInfo?.Status?.Status),
        location: shipmentInfo?.Origin,
        expectedDelivery: shipmentInfo?.ExpectedDeliveryDate,
        currentLocation: shipmentInfo?.Destination,
        trackingHistory: shipment.ShipmentTrack || []
      };
    } catch (error) {
      return { success: false, error: `Tracking failed: ${error.message}` };
    }
  }

  _validatePincode(pincode) {
    return typeof pincode === 'string' && /^\d{6}$/.test(pincode);
  }

  _buildShipmentPayload(orderData) {
    const requiredFields = ['customerName', 'address', 'pincode', 'city', 'state', 'phone', 'orderId'];
    
    for (const field of requiredFields) {
      if (!orderData[field]) {
        throw new Error(`Missing required field: ${field}`);
      }
    }
    
    const env = process.env;
    
    return {
      shipments: [{
        name: String(orderData.customerName).substring(0, 50),
        add: String(orderData.address).substring(0, 200),
        pin: String(orderData.pincode),
        city: String(orderData.city).substring(0, 50),
        state: String(orderData.state).substring(0, 50),
        country: 'India',
        phone: String(orderData.phone).replace(/[^0-9]/g, '').substring(0, 10),
        order: String(orderData.orderId).substring(0, 50),
        payment_mode: orderData.paymentMode || 'PREPAID',
        return_pin: env.RETURN_PINCODE || this.pickupPincode,
        return_city: env.RETURN_CITY || 'Gorakhpur',
        return_phone: env.RETURN_PHONE || '9999999999',
        return_add: env.RETURN_ADDRESS || 'Return Address',
        return_state: env.RETURN_STATE || 'Uttar Pradesh',
        products_desc: String(orderData.itemsDescription || 'Food Items').substring(0, 300),
        hsn_code: '21069099',
        cod_amount: 0,
        order_date: new Date().toISOString().split('T')[0],
        total_amount: Math.round(Number(orderData.totalAmount) || 0),
        seller_add: env.SELLER_ADDRESS || 'Seller Address',
        seller_name: env.SELLER_NAME || 'Chow',
        seller_inv: `INV-${Date.now()}`,
        quantity: Number(orderData.totalQuantity) || 1,
        waybill: '',
        shipment_width: 15,
        shipment_height: 10,
        shipment_length: 20,
        weight: Math.max(1, Math.ceil((Number(orderData.totalWeight) || 500) / 1000)),
        seller_gst_tin: env.SELLER_GST || '',
        shipping_mode: 'Surface',
        address_type: 'home'
      }]
    };
  }

  _mapDelhiveryStatus(delhiveryStatus) {
    return mapDelhiveryStatus(delhiveryStatus) || 'PENDING';
  }

  _mockCheckPincode(pincode) {
    const nonServiceable = ['000000', '999999', '123456'];
    return nonServiceable.includes(pincode)
      ? { success: false, serviceable: false }
      : { success: true, serviceable: true, city: 'Mock City', state: 'Mock State' };
  }

  async _mockCalculateRate({ pickupPincode, deliveryPincode, weight }) {
    const baseRate = 50;
    const weightInKg = Math.ceil(weight / 1000);
    const weightRate = weightInKg * 15;
    const fuelSurcharge = Math.round((baseRate + weightRate) * 0.1);
    
    let estimatedDistance = 25;
    try {
      const realDistance = await this.distanceService.calculateDistance(
        pickupPincode || this.pickupPincode, deliveryPincode
      );
      if (realDistance) estimatedDistance = realDistance;
    } catch {
      // Use fallback distance
    }
    
    const totalRate = baseRate + weightRate + fuelSurcharge;
    return {
      success: true, rate: totalRate, distance: estimatedDistance, currency: 'INR',
      breakdown: { baseRate, weightRate, fuelSurcharge, total: totalRate }
    };
  }

  _mockCreateShipment(orderData) {
    const timestamp = Date.now();
    const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
    const waybill = `MOCK${timestamp.toString().slice(-8)}${random}`;
    
    return {
      success: true, waybill, status: 'SHIPMENT_CREATED',
      estimatedDelivery: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    };
  }

  _mockTrackShipment(waybill) {
    const waybillTime = parseInt(String(waybill).replace('MOCK', ''), 10) || Date.now();
    const ageInHours = (Date.now() - waybillTime) / (1000 * 60 * 60);
    
    let status = 'SHIPMENT_CREATED', location = 'Origin Hub';
    if (ageInHours > 24) { status = 'IN_TRANSIT'; location = 'Transit Hub'; }
    if (ageInHours > 48) { status = 'DELIVERED'; location = 'Destination'; }
    
    return {
      success: true, status, location,
      expectedDelivery: new Date(waybillTime + 3 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      trackingHistory: [
        { status: 'SHIPMENT_CREATED', timestamp: new Date(waybillTime).toISOString(), location: 'Origin Hub' },
        ...(ageInHours > 24 ? [{ status: 'IN_TRANSIT', timestamp: new Date(waybillTime + 24 * 60 * 60 * 1000).toISOString(), location: 'Transit Hub' }] : []),
        ...(ageInHours > 48 ? [{ status: 'DELIVERED', timestamp: new Date(waybillTime + 48 * 60 * 60 * 1000).toISOString(), location: 'Destination' }] : [])
      ]
    };
  }
}

// ==================== DELIVERY SERVICE ====================

class DeliveryService {
  constructor() {
    this.delhiveryService = new DelhiveryService();
    this.distanceService = new DistanceService();
    this.basePincode = process.env.BASE_PINCODE || '273001';
  }

  async getDeliveryInfo(pincode, weight = 500, opts = {}) {
    pincode = typeof pincode === 'string' || typeof pincode === 'number' ? String(pincode).trim() : '';
    if (!/^\d{6}$/.test(pincode)) {
      return { success: false, error: 'Valid 6-digit pincode required' };
    }

    // Gorakhpur-only launch: Delhivery is disabled. Non-Gorakhpur pincodes are
    // not serviceable. (_getDelhiveryPricing is kept dormant for re-enabling later.)
    if (!isGorakhpurPincode(pincode)) {
      return {
        success: false,
        serviceable: false,
        message: 'We currently deliver only within Gorakhpur.',
        error: 'We currently deliver only within Gorakhpur.'
      };
    }

    return await this._getSelfDeliveryPricing(pincode, weight, opts);
  }

  async _getSelfDeliveryPricing(pincode, weight, opts = {}) {
    // Overall cap so a slow geocoder can't stall checkout.
    let timer;
    const distance = await Promise.race([
      this.distanceService.calculateDistance(this.basePincode, pincode),
      new Promise((resolve) => { timer = setTimeout(() => resolve(null), 6000); })
    ]).finally(() => clearTimeout(timer));
    const FREE_RADIUS_KM = 5;

    // Geocoding failure -> charge the configured fallback fee (never free).
    if (distance == null || !Number.isFinite(distance)) {
      const charge = Number.isFinite(opts.fallbackFee) ? opts.fallbackFee : LOCAL_DELIVERY_FALLBACK_FEE;
      return {
        success: true, serviceable: true, provider: 'self', displayName: 'Local Delivery',
        charge, distance: null, distanceUnknown: true, freeWithinKm: FREE_RADIUS_KM,
        breakdown: { fallback: true, total: charge }
      };
    }

    // Free delivery within 5 km of the store; charged beyond that.
    let charge, breakdown;
    if (distance <= FREE_RADIUS_KM) {
      charge = 0;
      breakdown = { baseRate: 0, distanceRate: 0, weightRate: 0, total: 0, freeWithinKm: FREE_RADIUS_KM };
    } else {
      const baseRate = 30;
      const distanceRate = Math.max(0, (distance - FREE_RADIUS_KM) * 5);
      const weightRate = Math.max(0, (Math.ceil(weight / 1000) - 1) * 10);
      charge = Math.round(baseRate + distanceRate + weightRate);
      breakdown = { baseRate, distanceRate, weightRate, total: charge };
    }

    return {
      success: true, serviceable: true, provider: 'self', displayName: 'Local Delivery',
      charge, distance, freeWithinKm: FREE_RADIUS_KM,
      breakdown
    };
  }

  async _getDelhiveryPricing(pincode, weight) {
    try {
      const response = await this.delhiveryService.calculateRate({ deliveryPincode: pincode, weight });

      if (!response.success) {
        return { success: false, serviceable: false, error: response.error || 'Pincode not serviceable' };
      }

      const distance = await this.distanceService.calculateDistance(this.basePincode, pincode);

      return {
        success: true, serviceable: true, provider: 'delhivery', displayName: 'Delhivery',
        charge: response.rate, distance, eta: '1-3 business days', breakdown: response.breakdown
      };
    } catch {
      return { success: false, serviceable: false, error: 'Delivery service unavailable' };
    }
  }

  validateDeliveryProvider(pincode, selectedProvider) {
    const isGorakhpur = isGorakhpurPincode(pincode);
    const provider = normalizeProvider(selectedProvider);
    const fail = (msg) => { const e = new Error(msg); e.status = 400; e.expose = true; throw e; };

    if (!provider) fail('Unknown delivery provider');
    if (isGorakhpur && provider === 'DELHIVERY') fail('Delhivery cannot be used for Gorakhpur deliveries');
    if (!isGorakhpur && provider === 'SELF') fail('Local delivery only available for Gorakhpur pincodes');
    return true;
  }

  shouldCreateDelhiveryShipment(order) {
    return normalizeProvider(order?.deliveryProvider) === 'DELHIVERY' &&
           order?.paymentStatus === 'paid' && 
           order?.status === 'confirmed' && 
           !order?.waybill;
  }
}

// ==================== EXPORTS ====================

module.exports = {
  normalizeProvider,
  mapDelhiveryStatus,
  DELHIVERY_STATUS_MAP,
  LOCAL_DELIVERY_FALLBACK_FEE,
  distanceService: new DistanceService(),
  delhiveryService: new DelhiveryService(),
  deliveryService: new DeliveryService()
};