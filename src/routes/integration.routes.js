const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const integrationController = require('../controllers/integration.controller');
const authMiddleware = require('../middleware/auth.middleware');
const checkEmailVerification = require('../middleware/verification.middleware');
const checkSubscription = require('../middleware/subscription.middleware');
const Integration = require('../models/integration.model');
const apifyService = require('../services/apify.service');

// Proteggi tutte le routes con autenticazione e verifica email
router.use(authMiddleware);
router.use(checkEmailVerification);
router.use(checkSubscription);

// Routes per la gestione delle integrazioni
router.post('/:hotelId', 
    (req, res) => integrationController.setupIntegration(req, res)
);

router.get('/hotel/:hotelId',
    (req, res) => integrationController.getHotelIntegrations(req, res)
);

router.put('/:integrationId',
    (req, res) => integrationController.updateIntegration(req, res)
);

router.delete('/:integrationId',
    (req, res) => integrationController.deleteIntegration(req, res)
);

// Routes per la sincronizzazione
router.post('/:integrationId/sync',
    (req, res) => integrationController.syncNow(req, res)
);

// Funzione di utilità per estrarre il placeId
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

// Route per verificare la validità di un URL/placeId
router.post('/verify-url', async (req, res) => {
    try {
        const { url, platform } = req.body;
        
        if (!url || !platform) {
            return res.status(400).json({
                valid: false,
                message: 'URL and platform are required'
            });
        }

        // Verifica con Apify
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

// Route per ottenere lo stato di una sincronizzazione
router.get('/:integrationId/sync/status',
    async (req, res) => {
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
    }
);

// Route per ottenere le statistiche aggregate
router.get('/hotel/:hotelId/stats',
    async (req, res) => {
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
                            $sum: { 
                                $cond: [{ $eq: ['$status', 'active'] }, 1, 0] 
                            }
                        },
                        errorIntegrations: {
                            $sum: { 
                                $cond: [{ $eq: ['$status', 'error'] }, 1, 0] 
                            }
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
    }
);

module.exports = router; 