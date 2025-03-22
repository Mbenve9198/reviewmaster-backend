const express = require('express');
const router = express.Router();
const whatsappWebhookController = require('../controllers/whatsapp-webhook.controller');

// WhatsApp webhook route
router.post('/whatsapp', whatsappWebhookController.handleIncomingMessage);

module.exports = router; 