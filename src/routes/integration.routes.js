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

function extractPlaceId(url, platform) {
   try {
       switch (platform) {
           case 'google':
               return url.split('/place/')[1]?.split('/')[0] || '';
           case 'tripadvisor':
               return url.split('Hotel_Review-')[1]?.split('-')[0] || '';
           case 'booking':
               return url.split('/hotel/')[1]?.split('.')[0] || '';
           default:
               return '';
       }
   } catch (error) {
       console.error('Error extracting placeId:', error);
       return '';
   }
}

router.post('/verify-url', async (req, res) => {
   try {
       const { url, platform } = req.body;
       
       if (!url || !platform) {
           return res.status(400).json({
               valid: false,
               message: 'URL and platform are required'
           });
       }

       const config = { maxReviews: 1 };
       await apifyService.runScraper(platform, url, config);
       let placeId = extractPlaceId(url, platform);

       res.json({ 
           valid: true,
           placeId,
           message: 'URL verified successfully'
       });
   } catch (error) {
       res.status(400).json({ 
           valid: false,
           message: error.message
       });
   }
});

router.post('/hotel/:hotelId', integrationController.setupIntegration);
router.get('/hotel/:hotelId', integrationController.getHotelIntegrations);
router.delete('/:integrationId', integrationController.deleteIntegration);
router.post('/:integrationId/sync', integrationController.syncNow);

// Gestione dell'update dell'integrazione
router.put('/:integrationId', async (req, res) => {
    try {
        const { integrationId } = req.params;
        const { syncConfig, status } = req.body;
        const userId = req.userId;

        const integration = await Integration.findById(integrationId)
            .populate('hotelId');

        if (!integration) {
            return res.status(404).json({ message: 'Integration not found' });
        }

        // Verifica che l'utente sia autorizzato
        if (!integration.hotelId || integration.hotelId.userId.toString() !== userId) {
            return res.status(403).json({ message: 'Unauthorized' });
        }

        // Aggiorna la configurazione se fornita
        if (syncConfig) {
            integration.syncConfig = {
                ...integration.syncConfig,
                ...syncConfig
            };
        }

        // Aggiorna lo stato se fornito
        if (status) {
            integration.status = status;
        }

        await integration.save();

        // Se il tipo di sync è cambiato in automatico, schedula la prossima sync
        if (syncConfig?.type === 'automatic') {
            const nextSync = new Date();
            switch(integration.syncConfig.frequency) {
                case 'daily':
                    nextSync.setDate(nextSync.getDate() + 1);
                    break;
                case 'weekly':
                    nextSync.setDate(nextSync.getDate() + 7);
                    break;
                case 'monthly':
                    nextSync.setMonth(nextSync.getMonth() + 1);
                    break;
            }
            integration.syncConfig.nextScheduledSync = nextSync;
            await integration.save();
        }

        res.json(integration);
    } catch (error) {
        console.error('Update integration error:', error);
        res.status(500).json({ 
            message: 'Error updating integration',
            error: error.message 
        });
    }
});

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
                   hotelId: new mongoose.Types.ObjectId(req.params.hotelId)
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