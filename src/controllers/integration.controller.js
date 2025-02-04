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
                totalReviews: syncResult.totalReviews
            });
        } catch (error) {
            console.error('Sync now detailed error:', {
                message: error.message,
                stack: error.stack
            });
            res.status(500).json({ 
                message: 'Error starting sync',
                error: error.message
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
            const integrationId = req.params.id;
            const updates = req.body;

            const integration = await Integration.findOneAndUpdate(
                { _id: integrationId, userId: req.userId },
                updates,
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

            // Salva tutte le recensioni senza filtro per data
            await Review.insertMany(reviews.map(review => ({
                hotelId: integration.hotelId,
                integrationId: integration._id,
                platform: integration.platform,
                content: {
                    text: review.text,
                    rating: review.rating,
                    date: review.date,
                    author: review.author
                }
            })));

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
            const { integrationId } = req.params;
            const userId = req.userId;
            const integration = await Integration.findById(integrationId).populate({
                path: 'hotelId',
                select: 'userId name'  // Aggiungiamo 'name' per l'email template
            });
            
            if (!integration) {
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
            }).sort({ 'content.date': -1 });

            const lastReviewDate = lastReview ? lastReview.content.date : null;
            
            // Configura il scraper solo con maxReviews e startDate
            const config = {
                maxReviews: 100,
                startDate: lastReviewDate
            };

            const reviews = await apifyService.runScraper(
                integration.platform,
                integration.url,
                config
            );

            // Filtra ulteriormente le recensioni per sicurezza
            const reviewsToImport = reviews.filter(review => {
                return !lastReviewDate || new Date(review.date) > new Date(lastReviewDate);
            });

            if (reviewsToImport.length === 0) {
                return res.json({ 
                    message: 'No new reviews to import',
                    newReviews: 0 
                });
            }

            // Salva le nuove recensioni
            await Review.insertMany(reviewsToImport.map(review => ({
                hotelId: integration.hotelId,
                integrationId: integration._id,
                platform: integration.platform,
                content: {
                    text: review.text || '',
                    rating: review.rating || 1,  // Minimo rating accettato è 1
                    date: review.date || new Date(),
                    author: review.author || 'Anonymous'
                }
            })));

            // Aggiorna le statistiche dell'integrazione
            await Integration.findByIdAndUpdate(integrationId, {
                $set: {
                    'syncConfig.lastSync': new Date(),
                    'stats.totalReviews': reviews.length,
                    'stats.syncedReviews': (integration.stats.syncedReviews || 0) + reviewsToImport.length,
                    'stats.lastSyncedReviewDate': new Date()
                }
            });

            // Invia email di notifica
            try {
                const user = await User.findById(integration.hotelId.userId);
                
                if (user && user.email) {
                    const appUrl = process.env.FRONTEND_URL || 'https://replai.app';
                    
                    await resend.emails.send({
                        from: 'Replai <noreply@replai.app>',
                        to: user.email,
                        subject: `${reviewsToImport.length} new reviews for ${integration.hotelId.name}`,
                        html: newReviewsEmailTemplate(
                            integration.hotelId.name,
                            reviewsToImport.length,
                            integration.platform,
                            appUrl
                        )
                    });
                    
                    console.log(`Manual sync notification sent to ${user.email}`);
                }
            } catch (emailError) {
                console.error('Error sending sync notification:', emailError);
                // Continuiamo anche se l'invio dell'email fallisce
            }

            res.json({ 
                message: 'Sync completed successfully',
                newReviews: reviewsToImport.length 
            });

        } catch (error) {
            console.error('Sync error:', error);
            res.status(500).json({ 
                message: 'Error during sync',
                error: error.message 
            });
        }
    }
};

async function syncReviews(integration) {
    try {
        const config = {
            maxReviews: parseInt(integration.syncConfig.maxReviews) || 100,
            language: integration.syncConfig.language || 'en'
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
                        url: photo.url || photo,
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