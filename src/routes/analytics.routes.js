const express = require('express');
const router = express.Router();
const analyticsController = require('../controllers/analytics.controller');
const authenticateToken = require('../middleware/auth.middleware');

// Proteggi tutte le route con l'autenticazione
router.use(authenticateToken);

// Route per l'analisi delle recensioni
router.post('/analyze', analyticsController.analyzeReviews);

// Nuove route per la gestione delle analisi salvate
router.get('/', analyticsController.getAnalyses);
router.get('/:id', analyticsController.getAnalysis);
router.patch('/:id/rename', analyticsController.renameAnalysis);
router.delete('/:id', analyticsController.deleteAnalysis);
router.post('/:id/follow-up', analyticsController.getFollowUpAnalysis);

// Nuove route per i piani di valorizzazione e risoluzione
router.post('/value-plan', analyticsController.getValuePlan);
router.post('/solution-plan', analyticsController.getSolutionPlan);

// Gestione esplicita delle richieste OPTIONS per queste route specifiche
router.options('/value-plan', (req, res) => {
    res.status(204).end();
});

router.options('/solution-plan', (req, res) => {
    res.status(204).end();
});

router.get('/:id/reviews/:category/:itemId', analyticsController.getGroupedReviews);

module.exports = router; 