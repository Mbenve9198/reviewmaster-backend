const express = require('express');
const router = express.Router();
const whatsappAssistantController = require('../controllers/whatsapp-assistant.controller');
const authMiddleware = require('../middleware/auth.middleware');

// Webhook route (NO AUTH!)
router.post('/webhook', whatsappAssistantController.handleWebhook);

// Route per il redirect (senza autenticazione perché usata da utenti esterni)
router.get('/redirect/review', whatsappAssistantController.handleReviewRedirect);

// Rest of routes with auth
router.use(authMiddleware);
router.post('/', whatsappAssistantController.createAssistant);
router.get('/check-name/:name', whatsappAssistantController.checkTriggerName);
router.get('/:hotelId', whatsappAssistantController.getAssistant);
router.patch('/:hotelId', whatsappAssistantController.updateAssistant);

// Routes per le regole
router.post('/:hotelId/rules', whatsappAssistantController.addRule);
router.put('/:hotelId/rules/:ruleId', whatsappAssistantController.updateRule);
router.delete('/:hotelId/rules/:ruleId', whatsappAssistantController.deleteRule);

// Routes per i limiti di messaggi
router.get('/:hotelId/message-limits', whatsappAssistantController.getMessageLimits);
router.put('/:hotelId/message-limits', whatsappAssistantController.updateMessageLimits);

router.get('/:hotelId/conversations', whatsappAssistantController.getConversations);

router.get('/:hotelId/analytics', whatsappAssistantController.getAnalytics);

router.post('/:hotelId/sentiment-analysis', whatsappAssistantController.generateSentimentAnalysis);
router.get('/:hotelId/sentiment-analysis', whatsappAssistantController.getSentimentAnalysisHistory);

module.exports = router; 