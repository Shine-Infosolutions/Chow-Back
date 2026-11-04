const express = require('express');
const router = express.Router();
const subcategoryController = require('../controllers/subcategoryController');
const { verifyToken, verifyAdmin } = require('../middleware');

const admin = [verifyToken, verifyAdmin];

router.get('/all', subcategoryController.getSubcategories);
router.get('/get/:id', subcategoryController.getSubcategoryById);
router.get('/category/:categoryId', subcategoryController.getSubcategoriesByCategory);
router.post('/add', admin, subcategoryController.createSubcategory);
router.put('/update/:id', admin, subcategoryController.updateSubcategory);
router.delete('/delete/:id', admin, subcategoryController.deleteSubcategory);

module.exports = router;
