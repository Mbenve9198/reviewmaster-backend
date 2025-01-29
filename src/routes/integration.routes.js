const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const integrationController = require('../controllers/integration.controller');
const authMiddleware = require('../middleware/auth.middleware');
const checkEmailVerification = require('../middleware/verification.middleware');
const checkCredits = require('../middleware/credits.middleware');
const Integration = require('../models/integration.model');
const apifyService = require('../services/apify.service');

// Proteggi tutte le routes con auth, verifica email e credits check
router.use(authMiddleware);
router.use(checkEmailVerification);
router.use(checkCredits);

// Routes per le integrazioni
router.get('/hotel/:hotelId', integrationController.getHotelIntegrations);
router.post('/hotel/:hotelId', integrationController.createIntegration);
router.put('/:integrationId', integrationController.updateIntegration);
router.delete('/:integrationId', integrationController.deleteIntegration);

// Route per lo stato della sincronizzazione
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
            lastSync: integration.syncConfig?.lastSync,
            nextSync: integration.syncConfig?.nextScheduledSync,
            stats: integration.stats,
            error: integration.syncConfig?.error
        });
    } catch (error) {
        console.error('Sync status error:', error);
        res.status(500).json({ 
            message: 'Error fetching sync status',
            error: error.message 
        });
    }
});

// Route per avviare una sincronizzazione manuale
router.post('/:integrationId/sync', integrationController.syncNow);

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