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

            const integration = await Integration.findById(integrationId)
                .populate('hotelId');

            if (!integration) {
                return res.status(404).json({ message: 'Integration not found' });
            }

            if (integration.hotelId.userId.toString() !== userId) {
                return res.status(403).json({ message: 'Unauthorized' });
            }

            const syncResult = await syncReviews(integration);

            res.json({
                message: 'Sync completed successfully',
                newReviews: syncResult.newReviews,
                totalReviews: syncResult.totalReviews
            });
        } catch (error) {
            console.error('Sync now error:', error);
            res.status(500).json({ 
                message: 'Error starting sync',
                error: error.message 
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
            maxReviews: integration.syncConfig.maxReviews,
            personalData: true
        };

        const reviews = await apifyService.runScraper(
            integration.platform,
            integration.url,
            config
        );

        const newReviews = await processAndSaveReviews(reviews, integration);
        await updateIntegrationStats(integration, reviews);

        return {
            newReviews: newReviews.length,
            totalReviews: reviews.length
        };
    } catch (error) {
        await handleSyncError(integration, error);
        throw error;
    }
}

async function processAndSaveReviews(reviews, integration) {
    const newReviews = [];

    for (const reviewData of reviews) {
        const existingReview = await Review.findOne({
            hotelId: integration.hotelId,
            platform: integration.platform,
            externalReviewId: reviewData.id
        });

        if (!existingReview) {
            const review = new Review({
                hotelId: integration.hotelId,
                integrationId: integration._id,
                platform: integration.platform,
                externalReviewId: reviewData.id,
                content: {
                    text: reviewData.text,
                    rating: reviewData.rating,
                    reviewerName: reviewData.reviewerName,
                    reviewerImage: reviewData.reviewerImage,
                    language: reviewData.language,
                    images: reviewData.images,
                    likes: reviewData.likes,
                    originalUrl: reviewData.url
                },
                metadata: {
                    originalCreatedAt: reviewData.dateAdded,
                    syncedAt: new Date()
                }
            });

            await review.save();
            newReviews.push(review);
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

module.exports = integrationController; 