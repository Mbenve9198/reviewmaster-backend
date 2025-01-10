const cron = require('node-cron');
const Integration = require('../models/integration.model');
const Review = require('../models/review.model');
const apifyService = require('../services/apify.service');

const MAX_CONCURRENT_SYNCS = 5;
const SYNC_INTERVAL_MS = 1000;
let activeSyncs = 0;

function setupSyncJobs() {
    cron.schedule('0 2 * * *', () => processSyncQueue('daily'));
    cron.schedule('0 3 * * 1', () => processSyncQueue('weekly'));
    cron.schedule('0 4 1 * *', () => processSyncQueue('monthly'));
    cron.schedule('0 * * * *', () => { activeSyncs = 0; });
}

async function processSyncQueue(frequency) {
    try {
        const integrations = await Integration.find({
            'status': 'active',
            'syncConfig.type': 'automatic',
            'syncConfig.frequency': frequency,
            'syncConfig.nextScheduledSync': { $lte: new Date() }
        }).populate('hotelId');

        for (const integration of integrations) {
            while (activeSyncs >= MAX_CONCURRENT_SYNCS) {
                await new Promise(resolve => setTimeout(resolve, SYNC_INTERVAL_MS));
            }
            processIntegration(integration);
        }
    } catch (error) {
        console.error('Error processing sync queue:', error);
    }
}

async function processIntegration(integration) {
    activeSyncs++;
    try {
        const config = {
            language: integration.syncConfig.language,
            maxReviews: 100,
            personalData: true
        };

        const reviews = await apifyService.runScraper(
            integration.platform,
            integration.url,
            config
        );

        await processAndSaveReviews(reviews, integration);
        await updateIntegrationStats(integration, reviews);
    } catch (error) {
        console.error(`Sync failed for integration ${integration._id}:`, error);
        await handleSyncError(integration, error);
    } finally {
        activeSyncs--;
    }
}

async function processAndSaveReviews(reviews, integration) {
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
        }
    }
}

async function handleSyncError(integration, error) {
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

async function updateIntegrationStats(integration, reviews) {
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

module.exports = { setupSyncJobs }; 