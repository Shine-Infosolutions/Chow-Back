const express = require('express');
const router = express.Router();
const ticketController = require('../controllers/ticketController');

// Create ticket
router.post('/', ticketController.createTicket);

// Get all tickets
router.get('/', ticketController.getAllTickets);

// Get ticket by ID
router.get('/:id', ticketController.getTicketById);

// Update ticket
router.put('/:id', ticketController.updateTicket);

// Delete ticket
router.delete('/:id', ticketController.deleteTicket);

module.exports = router;