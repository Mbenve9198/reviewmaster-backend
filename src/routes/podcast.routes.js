const express = require('express');
const router = express.Router();
const podcastController = require('../controllers/podcast.controller');
const authenticateToken = require('../middleware/auth.middleware');

// Proteggi tutte le route con l'autenticazione
router.use(authenticateToken);

// Route per generare il podcast
router.post('/generate', podcastController.generatePodcast);

// Route per ottenere lo script del podcast
router.get('/:analysisId', podcastController.getPodcastScript);

module.exports = router; 