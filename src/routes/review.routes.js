const express = require('express');
const router = express.Router();
const reviewController = require('../controllers/review.controller');
const authMiddleware = require('../middleware/auth.middleware');

// Proteggi tutte le route
router.use(authMiddleware);

// Routes per le recensioni
router.post('/generate', (req, res) => reviewController.generateResponse(req, res));
router.get('/hotel/:hotelId', (req, res) => reviewController.getHotelReviews(req, res));
router.get('/stats/:hotelId', (req, res) => reviewController.getReviewStats(req, res));
router.delete('/:reviewId', (req, res) => reviewController.deleteReview(req, res));
router.post('/bulk-delete', (req, res) => reviewController.bulkDeleteReviews(req, res));

module.exports = router;