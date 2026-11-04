const express = require('express');
const router = express.Router();
const itemController = require('../controllers/itemController');
const { upload, verifyToken, verifyAdmin } = require('../middleware');

const admin = [verifyToken, verifyAdmin];
// Auth runs BEFORE multer so unauthenticated uploads are never buffered.
const media = upload.fields([{ name: 'images', maxCount: 3 }, { name: 'video', maxCount: 1 }]);

router.get('/all', itemController.getItems);
router.get('/admin/all', admin, itemController.getAdminItems);
router.get('/get/:id', itemController.getItemById);
router.get('/admin/get/:id', admin, itemController.getAdminItemById);
router.get('/category/:categoryId', itemController.getItemsByCategory);
router.get('/subcategory/:subcategoryId', itemController.getItemsBySubcategory);
router.get('/featured/:type', itemController.getFeaturedItems);
router.post('/add', admin, media, itemController.createItem);
router.put('/update/:id', admin, media, itemController.updateItem);
router.delete('/delete/:id', admin, itemController.deleteItem);

module.exports = router;
