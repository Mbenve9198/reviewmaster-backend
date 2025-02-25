const whatsappWebhookController = require('../controllers/whatsapp-webhook.controller');

// WhatsApp webhook route
router.post('/whatsapp', whatsappWebhookController.handleIncomingMessage); 