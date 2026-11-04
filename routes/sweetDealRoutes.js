const express = require('express');
const router = express.Router();
const { getActiveDeal, createDeal, updateDeal, deleteDeal, getAllDeals } = require('../controllers/sweetDealController');
const { upload, verifyToken, verifyAdmin } = require('../middleware');

const admin = [verifyToken, verifyAdmin];
const media = upload.fields([{ name: 'video', maxCount: 1 }]);

router.get('/active', getActiveDeal);
router.get('/', admin, getAllDeals);
router.post('/', admin, media, createDeal);
router.put('/:id', admin, media, updateDeal);
router.delete('/:id', admin, deleteDeal);

module.exports = router;
