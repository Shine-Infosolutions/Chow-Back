const express = require('express');
const router = express.Router();
const itemController = require('../controllers/itemController');
const { upload } = require('../middleware');

router.get('/all', itemController.getItems);
router.get('/admin/all', itemController.getAdminItems);
router.get('/get/:id', itemController.getItemById);
router.get('/admin/get/:id', itemController.getAdminItemById);
router.get('/category/:categoryId', itemController.getItemsByCategory);
router.get('/subcategory/:subcategoryId', itemController.getItemsBySubcategory);
router.get('/featured/:type', itemController.getFeaturedItems);
router.post('/add', upload.fields([{ name: 'images', maxCount: 3 }, { name: 'video', maxCount: 1 }]), itemController.createItem);
router.put('/update/:id', upload.fields([{ name: 'images', maxCount: 3 }, { name: 'video', maxCount: 1 }]), itemController.updateItem);
router.delete('/delete/:id', itemController.deleteItem);

module.exports = router;