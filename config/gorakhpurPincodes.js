// Gorakhpur (GKP) pincodes for local delivery
const GORAKHPUR_PINCODES = new Set([
  '273001', '273002', '273003', '273004', '273005', '273006', '273007', '273008', '273009', '273010',
  '273011', '273012', '273013', '273014', '273015', '273016', '273017', '273018', '273019', '273020',
  '273401', '273402', '273403', '273404', '273405', '273406', '273407', '273408', '273409', '273410'
]);

const isGorakhpurPincode = (pincode) => GORAKHPUR_PINCODES.has(String(pincode));

const getLocalDeliveryCharge = (totalWeight = 500) => 30; // Flat rate for local delivery

module.exports = {
  GORAKHPUR_PINCODES: Array.from(GORAKHPUR_PINCODES),
  isGorakhpurPincode,
  getLocalDeliveryCharge
};