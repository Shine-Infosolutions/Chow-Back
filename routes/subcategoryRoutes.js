const express = require('express');
const router = express.Router();
const subcategoryController = require('../controllers/subcategoryController');

router.get('/all', subcategoryController.getSubcategories);
router.get('/get/:id', subcategoryController.getSubcategoryById);
router.get('/category/:categoryId', subcategoryController.getSubcategoriesByCategory);
router.post('/add', subcategoryController.createSubcategory);
router.put('/update/:id', subcategoryController.updateSubcategory);
router.delete('/delete/:id', subcategoryController.deleteSubcategory);

module.exports = router;