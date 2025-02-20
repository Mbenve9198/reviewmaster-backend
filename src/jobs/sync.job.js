const cron = require('node-cron');
const Integration = require('../models/integration.model');
const Review = require('../models/review.model');
const User = require('../models/user.model');
const apifyService = require('../services/apify.service');
const { Resend } = require('resend');
const newReviewsEmailTemplate = require('../templates/new-reviews-email');
const Hotel = require('../models/hotel.model');

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
            'status': { $in: ['active', 'pending'] },
            'syncConfig.type': 'automatic',
            'syncConfig.frequency': frequency,
            $or: [
                { 'syncConfig.nextScheduledSync': { $lte: new Date() } },
                { 'status': 'pending' }
            ]
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

        return await processAndSaveReviews(reviews, integration);
    } catch (error) {
        console.error(`Sync failed for integration ${integration._id}:`, error);
        await handleSyncError(integration, error);
    } finally {
        activeSyncs--;
    }
}

async function processAndSaveReviews(reviews, integration) {
    try {
        const existingReviews = await Review.find({
            hotelId: integration.hotelId,
            platform: integration.platform
        }).select('content.date externalId');

        const lastReview = await Review.findOne({
            hotelId: integration.hotelId,
            platform: integration.platform
        }).sort({ 'content.date': -1 });
        const lastReviewDate = lastReview ? lastReview.content.date : null;

        const reviewsToImport = reviews.filter(review => {
            if (!lastReviewDate) return true;
            const reviewDate = new Date(review.date);
            return reviewDate > new Date(lastReviewDate);
        });

        if (reviewsToImport.length === 0) {
            const nextSync = new Date();
            switch(integration.syncConfig.frequency) {
                case 'daily': nextSync.setDate(nextSync.getDate() + 1); break;
                case 'weekly': nextSync.setDate(nextSync.getDate() + 7); break;
                case 'monthly': nextSync.setMonth(nextSync.getMonth() + 1); break;
            }

            await Integration.findByIdAndUpdate(integration._id, {
                $set: {
                    status: 'active',
                    'syncConfig.lastSync': new Date(),
                    'syncConfig.nextScheduledSync': nextSync
                }
            });
            return 0;
        }

        await Review.insertMany(reviewsToImport.map(review => ({
            hotelId: integration.hotelId,
            integrationId: integration._id,
            platform: integration.platform,
            externalId: review.externalId,
            content: {
                text: review.text || 'No review text provided',
                rating: review.rating || 5,
                date: review.date || new Date(),
                author: review.author || 'Anonymous'
            }
        })));

        const nextSync = new Date();
        switch(integration.syncConfig.frequency) {
            case 'daily': nextSync.setDate(nextSync.getDate() + 1); break;
            case 'weekly': nextSync.setDate(nextSync.getDate() + 7); break;
            case 'monthly': nextSync.setMonth(nextSync.getMonth() + 1); break;
        }

        const wasStatusPending = integration.status === 'pending';
        
        const updatedIntegration = await Integration.findByIdAndUpdate(integration._id, {
            $set: {
                status: 'active',
                'syncConfig.lastSync': new Date(),
                'syncConfig.nextScheduledSync': nextSync,
                'stats.totalReviews': reviews.length
            },
            $inc: {
                'stats.syncedReviews': reviewsToImport.length
            }
        }, { new: true });

        if (wasStatusPending) {
            console.log(`Integration ${integration._id} activated after first sync`);
        }

        if (reviewsToImport.length > 0 || wasStatusPending) {
            try {
                const hotel = await Hotel.findById(integration.hotelId);
                const user = await User.findById(hotel.userId);
                
                await resend.emails.send({
                    from: 'Replai <notifications@replai.io>',
                    to: user.email,
                    subject: wasStatusPending 
                        ? `Integration Setup Complete - ${hotel.name}`
                        : `New Reviews Alert - ${hotel.name}`,
                    html: newReviewsEmailTemplate(
                        hotel.name,
                        reviewsToImport.length,
                        integration.platform,
                        process.env.APP_URL,
                        wasStatusPending
                    )
                });
            } catch (emailError) {
                console.error('Failed to send email notification:', emailError);
            }
        }

        return reviewsToImport.length;
    } catch (error) {
        console.error('Error in processAndSaveReviews:', error);
        throw error;
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

module.exports = { setupSyncJobs }; 