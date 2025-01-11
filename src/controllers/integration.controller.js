const Integration = require('../models/integration.model');
const Review = require('../models/review.model');
const Hotel = require('../models/hotel.model');
const apifyService = require('../services/apify.service');

const integrationController = {
    setupIntegration: async (req, res) => {
        try {
            const { hotelId, platform, placeId, url, syncConfig } = req.body;
            const userId = req.userId;

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
                    maxReviews: syncConfig?.maxReviews || '100'
                }
            });

            await integration.save();

            // Esegui la sincronizzazione iniziale
            try {
                await syncReviews(integration);
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

            console.log('Integration found:', {
                id: integration._id,
                platform: integration.platform,
                url: integration.url,
                syncConfig: integration.syncConfig
            });

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
                totalReviews: syncResult.totalReviews
            });
        } catch (error) {
            console.error('Sync now detailed error:', {
                message: error.message,
                stack: error.stack
            });
            res.status(500).json({ 
                message: 'Error starting sync',
                error: error.message,
                details: process.env.NODE_ENV === 'development' ? error.stack : undefined
            });
        }
    },

    updateIntegration: async (req, res) => {
        try {
            const { integrationId } = req.params;
            const { syncConfig, status } = req.body;
            const userId = req.userId;

            const integration = await Integration.findById(integrationId)
                .populate('hotelId');

            if (!integration) {
                return res.status(404).json({ message: 'Integration not found' });
            }

            if (integration.hotelId.userId.toString() !== userId) {
                return res.status(403).json({ message: 'Unauthorized' });
            }

            if (syncConfig) {
                integration.syncConfig = {
                    ...integration.syncConfig,
                    ...syncConfig
                };
            }

            if (status) {
                integration.status = status;
            }

            await integration.save();

            if (syncConfig?.type === 'automatic' && integration.syncConfig.type === 'manual') {
                await scheduleSyncForIntegration(integration);
            }

            res.json(integration);
        } catch (error) {
            console.error('Update integration error:', error);
            res.status(500).json({ 
                message: 'Error updating integration',
                error: error.message 
            });
        }
    },

    getHotelIntegrations: async (req, res) => {
        try {
            const { hotelId } = req.params;
            const userId = req.userId;

            const hotel = await Hotel.findOne({ _id: hotelId, userId });
            if (!hotel) {
                return res.status(404).json({ message: 'Hotel not found' });
            }

            const integrations = await Integration.find({ hotelId });
            res.json(integrations);
        } catch (error) {
            console.error('Get integrations error:', error);
            res.status(500).json({ 
                message: 'Error fetching integrations',
                error: error.message 
            });
        }
    },

    deleteIntegration: async (req, res) => {
        try {
            const { integrationId } = req.params;
            const userId = req.userId;

            const integration = await Integration.findById(integrationId)
                .populate('hotelId');

            if (!integration) {
                return res.status(404).json({ message: 'Integration not found' });
            }

            if (integration.hotelId.userId.toString() !== userId) {
                return res.status(403).json({ message: 'Unauthorized' });
            }

            await integration.remove();
            res.json({ message: 'Integration deleted successfully' });
        } catch (error) {
            console.error('Delete integration error:', error);
            res.status(500).json({ 
                message: 'Error deleting integration',
                error: error.message 
            });
        }
    }
};

// Funzioni di utilità
async function syncReviews(integration) {
    try {
        const config = {
            maxReviews: parseInt(integration.syncConfig.maxReviews) || 100,
            personalData: true,
            language: integration.syncConfig.language
        };

        console.log('Starting sync with config:', config);
        console.log('Integration details:', {
            platform: integration.platform,
            url: integration.url,
            hotelId: integration.hotelId
        });

        const reviews = await apifyService.runScraper(
            integration.platform,
            integration.url,
            config
        );

        console.log(`Retrieved ${reviews.length} reviews from scraper`);

        const newReviews = await processAndSaveReviews(reviews, integration);
        console.log(`Saved ${newReviews.length} new reviews`);
        
        await updateIntegrationStats(integration, reviews);
        console.log('Updated integration stats');

        return {
            newReviews: newReviews.length,
            totalReviews: reviews.length
        };
    } catch (error) {
        console.error('Detailed sync error:', {
            message: error.message,
            stack: error.stack,
            integration: {
                id: integration._id,
                platform: integration.platform,
                url: integration.url
            }
        });
        await handleSyncError(integration, error);
        throw error;
    }
}

async function processAndSaveReviews(reviews, integration) {
    const newReviews = [];
    for (const reviewData of reviews) {
        // Mappiamo i campi in base alla piattaforma
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
            case 'tripadvisor':
                mappedData = {
                    externalId: reviewData.id || reviewData.reviewId,
                    text: reviewData.text || reviewData.review || 'No text provided',
                    rating: reviewData.rating || reviewData.bubbles / 10 || 5,
                    reviewerName: reviewData.userName || reviewData.user?.username || 'Anonymous',
                    reviewerImage: reviewData.userImage || reviewData.user?.avatar,
                    language: reviewData.language || 'en',
                    images: (reviewData.photos || []).map(photo => ({
                        url: photo.url || photo,
                        caption: photo.caption || ''
                    })),
                    likes: reviewData.helpfulVotes || 0,
                    originalUrl: reviewData.url || reviewData.reviewUrl,
                    date: reviewData.publishedDate || reviewData.date
                };
                break;
            // Aggiungi altri casi per altre piattaforme
            default:
                console.warn(`Platform ${integration.platform} not explicitly handled`);
                mappedData = {
                    externalId: reviewData.reviewId || reviewData.id,
                    text: reviewData.text || 'No text provided',
                    rating: reviewData.rating || 5,
                    reviewerName: reviewData.name || 'Anonymous',
                    reviewerImage: reviewData.reviewerImage,
                    language: reviewData.language || 'en',
                    images: [],
                    likes: 0,
                    originalUrl: reviewData.url,
                    date: reviewData.date
                };
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
                        syncedAt: new Date()
                    }
                });

                await review.save();
                newReviews.push(review);
            } catch (error) {
                console.error('Error saving review:', error, mappedData);
            }
        }
    }
    return newReviews;
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

async function updateIntegrationStats(integration, reviews) {
    integration.stats = {
        totalReviews: reviews.length,
        syncedReviews: integration.stats.syncedReviews + reviews.length,
        lastSyncedReviewDate: new Date()
    };
    
    return await integration.save();
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