const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const integrationController = require('../controllers/integration.controller');
const authMiddleware = require('../middleware/auth.middleware');
const checkEmailVerification = require('../middleware/verification.middleware');
const checkSubscription = require('../middleware/subscription.middleware');
const Integration = require('../models/integration.model');
const apifyService = require('../services/apify.service');

router.use(authMiddleware);
router.use(checkEmailVerification);
router.use(checkSubscription);

// Questa funzione era mancante nel controller
router.post('/hotel/:hotelId', integrationController.setupIntegration);
router.get('/hotel/:hotelId', integrationController.getHotelIntegrations);
router.post('/:integrationId/sync', integrationController.syncNow);

// Aggiungiamo la route DELETE
router.delete('/:integrationId', integrationController.deleteIntegration);

// Aggiungiamo il metodo updateIntegration al controller che mancava
router.get('/:integrationId/sync/status', async (req, res) => {
   try {
       const integration = await Integration.findById(req.params.integrationId)
           .select('status syncConfig stats')
           .lean();
           
       if (!integration) {
           return res.status(404).json({ message: 'Integration not found' });
       }
       
       res.json({
           status: integration.status,
           lastSync: integration.syncConfig.lastSync,
           nextSync: integration.syncConfig.nextScheduledSync,
           stats: integration.stats,
           error: integration.syncConfig.error
       });
   } catch (error) {
       res.status(500).json({ 
           message: 'Error fetching sync status',
           error: error.message 
       });
   }
});

router.get('/hotel/:hotelId/stats', async (req, res) => {
   try {
       const stats = await Integration.aggregate([
           { 
               $match: { 
                   hotelId: mongoose.Types.ObjectId(req.params.hotelId) 
               } 
           },
           {
               $group: {
                   _id: null,
                   totalReviews: { $sum: '$stats.totalReviews' },
                   syncedReviews: { $sum: '$stats.syncedReviews' },
                   activeIntegrations: {
                       $sum: { $cond: [{ $eq: ['$status', 'active'] }, 1, 0] }
                   },
                   errorIntegrations: {
                       $sum: { $cond: [{ $eq: ['$status', 'error'] }, 1, 0] }
                   }
               }
           }
       ]);

       res.json(stats[0] || {
           totalReviews: 0,
           syncedReviews: 0,
           activeIntegrations: 0,
           errorIntegrations: 0
       });
   } catch (error) {
       res.status(500).json({ 
           message: 'Error fetching integration stats',
           error: error.message 
       });
   }
});

module.exports = router;