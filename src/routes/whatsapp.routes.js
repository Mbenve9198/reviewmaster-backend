const express = require('express');
const router = express.Router();
const whatsappController = require('../controllers/whatsapp.controller');

router.post('/webhook', whatsappController.handleWebhook);

module.exports = router;