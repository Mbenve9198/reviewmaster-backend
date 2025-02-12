const express = require('express');
const router = express.Router();
const analyticsController = require('../controllers/analytics.controller');
const authMiddleware = require('../middleware/auth.middleware');

// Proteggi tutte le route con l'autenticazione
router.use(authMiddleware);

// Route per l'analisi delle recensioni
router.post('/analyze', analyticsController.analyzeReviews);

// Nuove route per la gestione delle analisi salvate
router.get('/', analyticsController.getAnalyses);
router.get('/:id', analyticsController.getAnalysis);
router.patch('/:id/rename', analyticsController.renameAnalysis);
router.delete('/:id', analyticsController.deleteAnalysis);
router.post('/:id/follow-up', analyticsController.getFollowUpAnalysis);

module.exports = router; 