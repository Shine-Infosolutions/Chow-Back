const express = require('express');
const router = express.Router();
const categoryController = require('../controllers/categoryController');
const { verifyToken, verifyAdmin } = require('../middleware');

const admin = [verifyToken, verifyAdmin];

router.get('/all', categoryController.getAllCategories);
router.get('/', categoryController.getCategories);
router.get('/get/:id', categoryController.getCategoryById);
router.post('/add', admin, categoryController.createCategory);
router.put('/update/:id', admin, categoryController.updateCategory);
router.delete('/delete/:id', admin, categoryController.deleteCategory);

module.exports = router;
