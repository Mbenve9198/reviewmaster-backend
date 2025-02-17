const express = require('express');
const router = express.Router();
const whatsappAssistantController = require('../controllers/whatsapp-assistant.controller');
const authMiddleware = require('../middleware/auth.middleware');

router.use(authMiddleware);

router.post('/', whatsappAssistantController.createAssistant);
router.get('/check-name/:name', whatsappAssistantController.checkTriggerName);
router.get('/:hotelId', whatsappAssistantController.getAssistant);
router.patch('/:hotelId', whatsappAssistantController.updateAssistant);

module.exports = router; 