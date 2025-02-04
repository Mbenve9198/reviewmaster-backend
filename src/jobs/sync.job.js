const cron = require('node-cron');
const Integration = require('../models/integration.model');
const Review = require('../models/review.model');
const User = require('../models/user.model');
const apifyService = require('../services/apify.service');
const { Resend } = require('resend');
const newReviewsEmailTemplate = require('../templates/new-reviews-email');

const resend = new Resend(process.env.RESEND_API_KEY);

const MAX_CONCURRENT_SYNCS = 5;
const SYNC_INTERVAL_MS = 1000;
let activeSyncs = 0;

async function setupSyncJobs() {
    console.log('Setting up sync jobs...');
    
    // Esegui sync giornaliero alle 2 AM
    cron.schedule('0 2 * * *', () => {
        console.log('Running daily sync job at:', new Date().toISOString());
        processSyncQueue('daily');
    });
    
    // Esegui sync settimanale il lunedì alle 3 AM
    cron.schedule('0 3 * * 1', () => {
        console.log('Running weekly sync job at:', new Date().toISOString());
        processSyncQueue('weekly');
    });
    
    // Esegui sync mensile il primo del mese alle 4 AM
    cron.schedule('0 4 1 * *', () => {
        console.log('Running monthly sync job at:', new Date().toISOString());
        processSyncQueue('monthly');
    });
    
    // Reset contatore sync ogni ora
    cron.schedule('0 * * * *', () => {
        console.log('Resetting active syncs counter at:', new Date().toISOString());
        activeSyncs = 0;
    });

    console.log('All sync jobs have been scheduled');
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
            maxReviews: 100
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
    let newReviewsCount = 0;
    
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
            newReviewsCount++;
        }
    }

    // Se ci sono nuove recensioni, invia la notifica email
    if (newReviewsCount > 0) {
        try {
            const hotel = await integration.hotelId.populate('userId');
            const user = await User.findById(hotel.userId);
            
            if (user && user.email) {
                const appUrl = process.env.FRONTEND_URL || 'https://replai.app';
                
                await resend.emails.send({
                    from: 'Replai <noreply@replai.app>',
                    to: user.email,
                    subject: `${newReviewsCount} new reviews for ${hotel.name}`,
                    html: newReviewsEmailTemplate(
                        hotel.name,
                        newReviewsCount,
                        integration.platform,
                        appUrl
                    )
                });
                
                console.log(`New reviews notification sent to ${user.email}`);
            }
        } catch (error) {
            console.error('Error sending new reviews notification:', error);
        }
    }

    return newReviewsCount;
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