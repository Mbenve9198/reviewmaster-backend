const Integration = require('../models/integration.model');
const Review = require('../models/review.model');
const Hotel = require('../models/hotel.model');
const User = require('../models/user.model');
const syncService = require('../services/sync.service');

const integrationController = {
    setupIntegration: async (req, res) => {
        try {
            const { hotelId, platform, url, placeId, syncConfig } = req.body;
            const userId = req.userId;

            // Validazione di base
            if (!hotelId || !platform || !url || !placeId) {
                return res.status(400).json({ message: 'Missing required fields' });
            }

            const hotel = await Hotel.findOne({ _id: hotelId, userId });
            if (!hotel) {
                return res.status(404).json({ message: 'Hotel not found' });
            }

            const existingIntegration = await Integration.findOne({ hotelId, platform });
            if (existingIntegration) {
                return res.status(400).json({ 
                    message: `Integration with ${platform} already exists for this hotel` 
                });
            }

            const integration = new Integration({
                hotelId,
                platform,
                placeId,
                url,
                syncConfig: {
                    type: syncConfig?.type || 'manual',
                    frequency: syncConfig?.frequency || 'weekly',
                    maxReviews: syncConfig?.maxReviews || '100',
                    language: syncConfig?.language || 'en'
                }
            });

            // Calcola nextScheduledSync se è automatico
            if (integration.syncConfig.type === 'automatic') {
                const nextSync = new Date();
                switch(integration.syncConfig.frequency) {
                    case 'daily': nextSync.setDate(nextSync.getDate() + 1); break;
                    case 'weekly': nextSync.setDate(nextSync.getDate() + 7); break;
                    case 'monthly': nextSync.setMonth(nextSync.getMonth() + 1); break;
                }
                integration.syncConfig.nextScheduledSync = nextSync;
            }

            await integration.save();

            // Esegui la sincronizzazione iniziale
            try {
                await syncService.syncIntegration(integration, { incrementalSync: false });
            } catch (syncError) {
                console.error('Initial sync error:', syncError);
                // Continuiamo anche se la sync iniziale fallisce
            }

            res.status(201).json(integration);
        } catch (error) {
            console.error('Setup integration error:', error);
            res.status(500).json({ 
                message: 'Error setting up integration',
                error: error.message 
            });
        }
    },

    syncNow: async (req, res) => {
        try {
            const { integrationId } = req.params;
            const userId = req.userId;

            console.log('Starting sync for integration:', integrationId);

            const integration = await Integration.findById(integrationId)
                .populate('hotelId');

            if (!integration) {
                console.log('Integration not found:', integrationId);
                return res.status(404).json({ message: 'Integration not found' });
            }

            if (!integration.hotelId || !integration.hotelId.userId) {
                console.error('Invalid hotel data:', integration.hotelId);
                return res.status(400).json({ message: 'Invalid hotel data' });
            }

            if (integration.hotelId.userId.toString() !== userId) {
                console.log('Unauthorized sync attempt:', {
                    requestUserId: userId,
                    hotelUserId: integration.hotelId.userId
                });
                return res.status(403).json({ message: 'Unauthorized' });
            }

            console.log('Starting sync...');
            const syncResult = await syncService.syncIntegration(integration, { manual: true });
            console.log('Sync completed:', syncResult);

            res.json({
                message: 'Sync completed successfully',
                newReviews: syncResult.newReviews,
                integration: syncResult.integration,
                success: true
            });
        } catch (error) {
            console.error('Sync now detailed error:', {
                message: error.message,
                stack: error.stack
            });
            res.status(500).json({ 
                message: 'Error starting sync',
                error: error.message,
                success: false
            });
        }
    },

    getHotelIntegrations: async (req, res) => {
        try {
            const hotelId = req.params.hotelId;
            
            // Verifica che l'utente abbia abbastanza crediti per l'operazione
            const user = await User.findById(req.userId);
            if (!user) {
                return res.status(404).json({ message: 'User not found' });
            }

            const integrations = await Integration.find({ hotelId })
                .sort({ createdAt: -1 });

            res.json(integrations);
        } catch (error) {
            console.error('Get hotel integrations error:', error);
            res.status(500).json({ 
                message: 'Failed to fetch integrations',
                error: error.message 
            });
        }
    },

    createIntegration: async (req, res) => {
        try {
            const hotelId = req.params.hotelId;
            const integrationData = req.body;

            // Verifica che l'utente abbia abbastanza crediti per l'operazione
            const user = await User.findById(req.userId);
            if (!user) {
                return res.status(404).json({ message: 'User not found' });
            }

            // Crea la nuova integrazione
            const integration = await Integration.create({
                ...integrationData,
                hotelId,
                userId: req.userId
            });

            res.status(201).json(integration);
        } catch (error) {
            console.error('Create integration error:', error);
            res.status(500).json({ 
                message: 'Failed to create integration',
                error: error.message 
            });
        }
    },

    updateIntegration: async (req, res) => {
        try {
            const { integrationId } = req.params;
            const update = req.body;

            // Se stiamo passando a sync manuale, resetta nextScheduledSync
            if (update.syncConfig && update.syncConfig.type === 'manual') {
                update.syncConfig.nextScheduledSync = null;
            }

            const integration = await Integration.findByIdAndUpdate(
                integrationId,
                { $set: update },
                { new: true }
            );

            if (!integration) {
                return res.status(404).json({ message: 'Integration not found' });
            }

            res.json(integration);
        } catch (error) {
            console.error('Update integration error:', error);
            res.status(500).json({ 
                message: 'Failed to update integration',
                error: error.message 
            });
        }
    },

    deleteIntegration: async (req, res) => {
        try {
            const { integrationId } = req.params;
            const userId = req.userId;

            // Prima troviamo l'integrazione e verifichiamo che appartenga all'hotel dell'utente
            const integration = await Integration.findById(integrationId)
                .populate('hotelId');

            if (!integration) {
                return res.status(404).json({ message: 'Integration not found' });
            }

            // Verifichiamo che l'utente sia proprietario dell'hotel
            if (integration.hotelId.userId.toString() !== userId) {
                return res.status(403).json({ message: 'Unauthorized' });
            }

            // Elimina tutte le reviews associate all'integrazione
            await Review.deleteMany({ 
                hotelId: integration.hotelId,
                platform: integration.platform 
            });

            // Elimina l'integrazione
            await Integration.findByIdAndDelete(integrationId);

            res.json({ message: 'Integration and associated reviews deleted successfully' });
        } catch (error) {
            console.error('Delete integration error:', error);
            res.status(500).json({ 
                message: 'Error deleting integration',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    },

    incrementalSync: async (req, res) => {
        try {
            const { integrationId } = req.params;
            const userId = req.userId;

            // Verifica crediti utente e integrazione
            const integration = await Integration.findById(integrationId).populate({
                path: 'hotelId',
                select: 'userId name'
            });

            if (!integration) {
                return res.status(404).json({ message: 'Integration not found' });
            }

            // Aggiungiamo anche il controllo di autorizzazione
            if (integration.hotelId.userId.toString() !== userId) {
                return res.status(403).json({ message: 'Unauthorized' });
            }

            const syncResult = await syncService.syncIntegration(integration, { manual: true });

            res.json({ 
                message: 'Sync completed successfully',
                newReviews: syncResult.newReviews,
                integration: syncResult.integration,
                success: true
            });
        } catch (error) {
            console.error('Detailed sync error:', error);
            res.status(500).json({ 
                message: error.message || 'Error during sync',
                success: false
            });
        }
    }
};

module.exports = integrationController;