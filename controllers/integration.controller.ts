import { Integration } from '../models/integration.model';
import { Review } from '../models/review.model';
import { Hotel } from '../models/hotel.model';
import { apifyService } from '../services/apify.service';

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
                    language: syncConfig?.language || 'en'
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

    // ... altri metodi rimangono invariati ...
};

// Funzioni di utilità aggiornate
async function syncReviews(integration: any) {
    try {
        const config = {
            language: integration.syncConfig.language,
            maxReviews: 100,
            personalData: true
        };

        // Usa il nuovo servizio Apify
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

async function processAndSaveReviews(reviews: any[], integration: any) {
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

async function handleSyncError(integration: any, error: any) {
    const errorUpdate = {
        status: 'error',
        'syncConfig.error': {
            message: error.message,
            code: error.code || 'SYNC_ERROR',
            timestamp: new Date()
        }
    };

    if (error.message.includes('Rate limit exceeded')) {
        errorUpdate.status = 'disconnected';
    }

    await Integration.findByIdAndUpdate(integration._id, { $set: errorUpdate });
}

async function updateIntegrationStats(integration: any, reviews: any[]) {
    const nextSync = new Date();
    switch(integration.syncConfig.frequency) {
        case 'daily': nextSync.setDate(nextSync.getDate() + 1); break;
        case 'weekly': nextSync.setDate(nextSync.getDate() + 7); break;
        case 'monthly': nextSync.setMonth(nextSync.getMonth() + 1); break;
    }

    await Integration.findByIdAndUpdate(integration._id, {
        $set: {
            status: 'active',
            'stats.totalReviews': reviews.length,
            'stats.syncedReviews': reviews.length,
            'stats.lastSyncedReviewDate': new Date(),
            'syncConfig.lastSync': new Date(),
            'syncConfig.nextScheduledSync': nextSync
        }
    });
}

export { integrationController }; 