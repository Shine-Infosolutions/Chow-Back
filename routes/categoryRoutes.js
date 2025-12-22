const express = require('express');
const router = express.Router();
const categoryController = require('../controllers/categoryController');

router.get('/all', categoryController.getAllCategories);
router.get('/', categoryController.getCategories);
router.get('/get/:id', categoryController.getCategoryById);
router.post('/add', categoryController.createCategory);
router.put('/update/:id', categoryController.updateCategory);
router.delete('/delete/:id', categoryController.deleteCategory);

module.exports = router;