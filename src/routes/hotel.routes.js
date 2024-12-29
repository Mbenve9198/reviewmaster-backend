const express = require('express');
const router = express.Router();
const hotelController = require('../controllers/hotel.controller');
const authMiddleware = require('../middleware/auth.middleware');

// Proteggi tutte le route degli hotel
router.use(authMiddleware);

// Routes per gli hotel
router.post('/', (req, res) => hotelController.createHotel(req, res));
router.get('/', (req, res) => hotelController.getHotels(req, res));
router.get('/:id', (req, res) => hotelController.getHotel(req, res));
router.put('/:id', (req, res) => hotelController.updateHotel(req, res));
router.delete('/:id', (req, res) => hotelController.deleteHotel(req, res));

module.exports = router;