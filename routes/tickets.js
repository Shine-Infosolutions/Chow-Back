const express = require('express');
const router = express.Router();
const ticketController = require('../controllers/ticketController');
const { verifyToken } = require('../middleware');

// Create ticket (contact form or order-linked support request)
router.post('/', ticketController.createTicket);

// Get all tickets (admin list)
router.get('/', ticketController.getAllTickets);

// Get tickets raised by a specific customer
router.get('/my/:userId', ticketController.getMyTickets);

// Get a single ticket (full thread)
router.get('/:id', ticketController.getTicketById);

// Reply to a ticket (customer or admin — role decided from the token)
router.post('/:id/reply', verifyToken, ticketController.replyToTicket);

// Update ticket status (admin)
router.put('/:id', ticketController.updateTicket);

// Delete ticket (admin)
router.delete('/:id', ticketController.deleteTicket);

module.exports = router;
