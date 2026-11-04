const express = require('express');
const router = express.Router();
const ticketController = require('../controllers/ticketController');
const { verifyToken, verifyAdmin, optionalAuth, requireOwnerOrAdmin } = require('../middleware');

const admin = [verifyToken, verifyAdmin];

router.post('/', optionalAuth, ticketController.createTicket); // public; userId from token if present
router.get('/', admin, ticketController.getAllTickets);
router.get('/my/:userId', verifyToken, requireOwnerOrAdmin('userId'), ticketController.getMyTickets);
router.get('/:id', verifyToken, ticketController.getTicketById); // owner or admin (checked in controller)
router.post('/:id/reply', verifyToken, ticketController.replyToTicket);
router.put('/:id', admin, ticketController.updateTicket);
router.delete('/:id', admin, ticketController.deleteTicket);

module.exports = router;
