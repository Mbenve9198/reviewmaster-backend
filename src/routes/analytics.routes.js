const express = require('express');
const router = express.Router();
const analyticsController = require('../controllers/analytics.controller');
const authMiddleware = require('../middleware/auth.middleware');

// Proteggi tutte le route con l'autenticazione
router.use(authMiddleware);

// Route per l'analisi delle recensioni
router.post('/analyze', analyticsController.analyzeReviews);

module.exports = router; 