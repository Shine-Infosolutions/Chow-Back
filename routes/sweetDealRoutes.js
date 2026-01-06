const express = require('express');
const router = express.Router();
const {
  getActiveDeal,
  createDeal,
  updateDeal,
  deleteDeal,
  getAllDeals
} = require('../controllers/sweetDealController');
const { upload } = require('../middleware');

// Public routes
router.get('/active', getActiveDeal);

// Admin routes (add auth middleware as needed)
router.get('/', getAllDeals);
router.post('/', upload.fields([{ name: 'video', maxCount: 1 }]), createDeal);
router.put('/:id', upload.fields([{ name: 'video', maxCount: 1 }]), updateDeal);
router.delete('/:id', deleteDeal);

module.exports = router;