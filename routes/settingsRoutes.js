const express = require('express');
const settingsController = require('../controllers/settingsController');
const { verifyToken, verifyAdmin, optionalAuth } = require('../middleware');

const admin = [verifyToken, verifyAdmin];

// Mounted at /api/settings
const settingsRouter = express.Router();
settingsRouter.get('/public', settingsController.getPublicSettings);
settingsRouter.get('/', admin, settingsController.getSettings);
settingsRouter.put('/', admin, settingsController.updateSettings);

// Mounted at /api/pages
const pagesRouter = express.Router();
pagesRouter.get('/', admin, settingsController.listPages);
pagesRouter.get('/:slug', optionalAuth, settingsController.getPage); // admin token → drafts too
pagesRouter.put('/:slug', admin, settingsController.updatePage);

module.exports = { settingsRouter, pagesRouter };
