const Integration = require('../models/integration.model');
const Review = require('../models/review.model');
const Hotel = require('../models/hotel.model');
const apifyService = require('../services/apify.service');
const User = require('../models/user.model');
const { Resend } = require('resend');
const newReviewsEmailTemplate = require('../templates/new-reviews-email');
const resend = new Resend(process.env.RESEND_API_KEY);

const integrationController = {
    setupIntegration: async (req, res) => {
        try {
            const { hotelId, platform, url, placeId, syncConfig } = req.body;
            const userId = req.userId;

            // Validazione di base
            if (!hotelId || !platform || !url || !placeId) {
                return res.status(400).json({ message: 'Missing required fields' });
            }

            // Validazione URL per piattaforma
            if (platform === 'google') {
                if (!url.match(/^https:\/\/(www\.)?google\.com\/maps\/place\/.*/)) {
                    return res.status(400).json({
                        message: 'Invalid Google Maps URL format'
                    });
                }
            } else if (platform === 'booking') {
                if (!url.match(/^https:\/\/www\.booking\.com\/hotel\/[a-z]{2}\/.*\.[a-z]{2}\.html$/)) {
                    return res.status(400).json({
                        message: 'Invalid Booking.com URL format'
                    });
                }
            } else if (platform === 'tripadvisor') {
                if (!url.match(/^https:\/\/(www\.)?tripadvisor\.[a-z]+\/Hotel_Review-.*\.html$/)) {
                    return res.status(400).json({
                        message: 'Invalid TripAdvisor URL format'
                    });
                }
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
                await integrationController.initialSync(integration);
            } catch (syncError) {
                console.error('Initial sync error:', syncError);
                // Continuiamo anche se la sync iniziale fallisce
            }

            if (integration.syncConfig.type === 'automatic') {
                await scheduleSyncForIntegration(integration);
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

            console.log('Starting syncReviews...');
            const syncResult = await syncReviews(integration);
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

    async initialSync(integration) {
        try {
            console.log('Starting initial sync for integration:', integration._id);
            
            const config = {
                maxReviews: parseInt(integration.syncConfig.maxReviews) || 100
            };

            console.log('Initial sync config:', config);
            
            const reviews = await apifyService.runScraper(
                integration.platform,
                integration.url,
                config
            );

            console.log(`Retrieved ${reviews.length} reviews from scraper`);

            const existingReviews = await Review.find({
                hotelId: integration.hotelId,
                platform: integration.platform
            }).select('content.date externalId');

            const reviewsToImport = reviews.filter(review => {
                return !existingReviews.some(existing => 
                    existing.externalId === review.externalId || 
                    (existing.content.date && review.date && 
                     new Date(existing.content.date).getTime() === new Date(review.date).getTime())
                );
            });

            if (reviewsToImport.length > 0) {
                await Review.insertMany(reviewsToImport.map(review => ({
                    hotelId: integration.hotelId,
                    integrationId: integration._id,
                    platform: integration.platform,
                    externalId: review.externalId,
                    content: {
                        text: review.text || 'No review text provided',
                        rating: parseRating(review.rating),
                        date: review.date || new Date(),
                        author: review.author || 'Anonymous'
                    }
                })));
            }

            // Aggiorna le statistiche dell'integrazione
            await Integration.findByIdAndUpdate(integration._id, {
                $set: {
                    'syncConfig.lastSync': new Date(),
                    'stats.totalReviews': reviews.length,
                    'stats.syncedReviews': reviews.length,
                    'stats.lastSyncedReviewDate': new Date()
                }
            });

            return {
                newReviews: reviews.length,
                totalReviews: reviews.length
            };
        } catch (error) {
            console.error('Initial sync error:', error);
            throw error;
        }
    },

    incrementalSync: async (req, res) => {
        try {
            console.log('Starting incremental sync for integration:', req.params.integrationId);
            const { integrationId } = req.params;
            const userId = req.userId;

            // Verifica crediti utente e integrazione
            const user = await User.findById(userId);
            const integration = await Integration.findById(integrationId).populate({
                path: 'hotelId',
                select: 'userId name'
            });

            if (!integration) {
                console.log('Integration not found');
                return res.status(404).json({ message: 'Integration not found' });
            }

            // Aggiungiamo anche il controllo di autorizzazione
            if (integration.hotelId.userId.toString() !== userId) {
                return res.status(403).json({ message: 'Unauthorized' });
            }

            // Trova la data dell'ultima recensione importata
            const lastReview = await Review.findOne({
                hotelId: integration.hotelId,
                platform: integration.platform
            }).sort({ 'metadata.originalCreatedAt': -1 });
            console.log('Last review date:', lastReview?.metadata?.originalCreatedAt);

            const reviews = await apifyService.runScraper(
                integration.platform,
                integration.url,
                {
                    maxReviews: 100,
                    startDate: lastReview ? lastReview.metadata.originalCreatedAt : null
                }
            );

            const reviewsToImport = reviews.filter(review => {
                if (!lastReview) return true;
                const reviewDate = new Date(review.date);
                const lastDate = new Date(lastReview.metadata.originalCreatedAt);
                return reviewDate > lastDate;
            });

            const newReviewsCount = await processAndSaveReviews(reviewsToImport, integration, user);

            const nextSync = new Date();
            switch(integration.syncConfig.frequency) {
                case 'daily': nextSync.setDate(nextSync.getDate() + 1); break;
                case 'weekly': nextSync.setDate(nextSync.getDate() + 7); break;
                case 'monthly': nextSync.setMonth(nextSync.getMonth() + 1); break;
            }

            const updatedIntegration = await Integration.findByIdAndUpdate(
                integrationId,
                {
                    $set: {
                        status: 'active',
                        'syncConfig.lastSync': new Date(),
                        'syncConfig.nextScheduledSync': nextSync,
                        'stats.totalReviews': (integration.stats.totalReviews || 0) + newReviewsCount,
                        'stats.syncedReviews': (integration.stats.syncedReviews || 0) + newReviewsCount,
                        'stats.lastSyncedReviewDate': new Date()
                    }
                },
                { new: true }
            );

            res.json({ 
                message: 'Sync completed successfully',
                newReviews: newReviewsCount,
                integration: updatedIntegration,
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

async function syncReviews(integration) {
    try {
        const lastReview = await Review.findOne({
            hotelId: integration.hotelId,
            platform: integration.platform
        }).sort({ 'metadata.originalCreatedAt': -1 });

        const config = {
            maxReviews: 100,
            startDate: lastReview?.metadata?.originalCreatedAt?.toISOString()
        };

        console.log('Starting sync with config:', config);

        const reviews = await apifyService.runScraper(
            integration.platform,
            integration.url,
            config
        );

        console.log(`Retrieved ${reviews.length} reviews from scraper`);

        const newReviewsCount = await processAndSaveReviews(reviews, integration);
        console.log(`Saved ${newReviewsCount} new reviews`);

        // Aggiorna l'integrazione usando la stessa logica di incrementalSync
        const nextSync = new Date();
        switch(integration.syncConfig.frequency) {
            case 'daily': nextSync.setDate(nextSync.getDate() + 1); break;
            case 'weekly': nextSync.setDate(nextSync.getDate() + 7); break;
            case 'monthly': nextSync.setMonth(nextSync.getMonth() + 1); break;
        }

        const updatedIntegration = await Integration.findByIdAndUpdate(
            integration._id,
            {
                $set: {
                    status: 'active',
                    'syncConfig.lastSync': new Date(),
                    'syncConfig.nextScheduledSync': nextSync,
                    'stats.totalReviews': (integration.stats.totalReviews || 0) + newReviewsCount,
                    'stats.syncedReviews': (integration.stats.syncedReviews || 0) + newReviewsCount,
                    'stats.lastSyncedReviewDate': new Date()
                }
            },
            { new: true }
        );

        return {
            newReviews: newReviewsCount,
            integration: updatedIntegration,
            success: true
        };
    } catch (error) {
        console.error('Detailed sync error:', error);
        await handleSyncError(integration, error);
        throw error;
    }
}

async function processAndSaveReviews(reviews, integration, user) {
    try {
        const existingReviews = await Review.find({
            hotelId: integration.hotelId,
            platform: integration.platform
        }).select('content.date externalId');
        console.log(`Found ${existingReviews.length} existing reviews`);

        const lastReview = await Review.findOne({
            hotelId: integration.hotelId,
            platform: integration.platform
        }).sort({ 'metadata.originalCreatedAt': -1 });
        console.log('Last review date:', lastReview?.metadata?.originalCreatedAt);

        const reviewsToImport = reviews.filter(review => {
            if (!lastReview) return true;
            const reviewDate = new Date(review.date);
            const lastDate = new Date(lastReview.metadata.originalCreatedAt);
            return reviewDate > lastDate;
        });
        console.log(`Filtered ${reviewsToImport.length} reviews to import`);

        if (reviewsToImport.length === 0) {
            console.log('No new reviews to import, updating next sync...');
            return 0;
        }

        console.log('Starting to insert reviews...');
        const newReviews = [];
        for (const reviewData of reviewsToImport) {
            let mappedData = {};
            
            switch(integration.platform) {
                case 'google':
                    mappedData = {
                        externalId: reviewData.reviewId,
                        text: reviewData.text || reviewData.textTranslated || 'No text provided',
                        rating: reviewData.stars || 5,
                        reviewerName: reviewData.name || 'Anonymous',
                        reviewerImage: reviewData.reviewerPhotoUrl,
                        language: reviewData.language,
                        images: reviewData.reviewImageUrls ? reviewData.reviewImageUrls.map(url => ({
                            url: url,
                            caption: ''
                        })) : [],
                        likes: reviewData.likesCount || 0,
                        originalUrl: reviewData.reviewUrl,
                        date: reviewData.publishedAtDate
                    };
                    break;

                case 'booking':
                    mappedData = {
                        externalId: `${reviewData.userName}_${reviewData.reviewDate}`,
                        text: [
                            reviewData.reviewTitle,
                            `Liked: ${reviewData.likedText || 'No comments'}`,
                            reviewData.dislikedText ? `Disliked: ${reviewData.dislikedText}` : null
                        ].filter(Boolean).join('\n\n'),
                        rating: reviewData.rating, // Manteniamo il rating originale 1-10
                        reviewerName: reviewData.userName || 'Anonymous',
                        reviewerImage: null,
                        language: 'en',
                        images: [],
                        likes: 0,
                        originalUrl: null,
                        date: reviewData.reviewDate,
                        metadata: {
                            numberOfNights: reviewData.numberOfNights,
                            travelerType: reviewData.travelerType
                        }
                    };
                    break;

                case 'tripadvisor':
                    mappedData = {
                        externalId: reviewData.id || reviewData.reviewId,
                        text: reviewData.text || reviewData.review || 'No text provided',
                        rating: reviewData.rating || reviewData.bubbles / 10 || 5,
                        reviewerName: reviewData.userName || reviewData.user?.username || 'Anonymous',
                        reviewerImage: reviewData.userImage || reviewData.user?.avatar,
                        language: reviewData.language || 'en',
                        images: (reviewData.photos || []).map(photo => ({
                            url: photo.image || photo.url || photo,
                            caption: photo.caption || ''
                        })),
                        likes: reviewData.helpfulVotes || 0,
                        originalUrl: reviewData.url || reviewData.reviewUrl,
                        date: reviewData.publishedDate || reviewData.date
                    };
                    break;
            }

            const existingReview = await Review.findOne({
                hotelId: integration.hotelId,
                platform: integration.platform,
                externalReviewId: mappedData.externalId
            });

            if (!existingReview) {
                try {
                    const review = new Review({
                        hotelId: integration.hotelId,
                        integrationId: integration._id,
                        platform: integration.platform,
                        externalReviewId: mappedData.externalId,
                        content: {
                            text: mappedData.text,
                            rating: mappedData.rating,
                            reviewerName: mappedData.reviewerName,
                            reviewerImage: mappedData.reviewerImage,
                            language: mappedData.language,
                            images: mappedData.images,
                            likes: mappedData.likes,
                            originalUrl: mappedData.originalUrl
                        },
                        metadata: {
                            originalCreatedAt: new Date(mappedData.date),
                            syncedAt: new Date(),
                            numberOfNights: mappedData.metadata?.numberOfNights,
                            travelerType: mappedData.metadata?.travelerType
                        }
                    });

                    await review.save();
                    newReviews.push(review);
                } catch (error) {
                    console.error('Error saving review:', error, mappedData);
                }
            }
        }
        console.log(`Successfully inserted ${newReviews.length} reviews`);

        return newReviews.length;
    } catch (error) {
        console.error('Detailed error in processAndSaveReviews:', error);
        throw error;
    }
}

async function scheduleSyncForIntegration(integration) {
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

async function handleSyncError(integration, error) {
    integration.status = 'error';
    integration.syncConfig.error = {
        message: error.message,
        code: error.name,
        timestamp: new Date()
    };
    
    return await integration.save();
}

module.exports = integrationController;