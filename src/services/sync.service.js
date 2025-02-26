const Integration = require('../models/integration.model');
const Review = require('../models/review.model');
const Hotel = require('../models/hotel.model');
const User = require('../models/user.model');
const apifyService = require('./apify.service');
const { Resend } = require('resend');
const newReviewsEmailTemplate = require('../templates/new-reviews-email');

const resend = new Resend(process.env.RESEND_API_KEY);

class SyncService {
    async syncIntegration(integration, options = {}) {
        try {
            console.log(`Starting sync for integration ${integration._id} (${integration.platform})`);
            
            // Configura le opzioni di sincronizzazione
            const config = this._prepareSyncConfig(integration, options);
            
            // Esegui lo scraper
            const reviews = await apifyService.runScraper(
                integration.platform,
                integration.url,
                config
            );
            
            console.log(`Retrieved ${reviews.length} reviews from ${integration.platform}`);
            
            // Processa e salva le recensioni
            const result = await this.processAndSaveReviews(reviews, integration);
            
            // Aggiorna lo stato dell'integrazione
            await this._updateIntegrationAfterSync(integration, result.newReviews, options.manual);
            
            // Invia notifiche se necessario
            if (result.newReviews > 0 || integration.status === 'pending') {
                await this._sendNotifications(integration, result.newReviews);
            }
            
            return {
                success: true,
                newReviews: result.newReviews,
                totalReviews: reviews.length,
                integration: await Integration.findById(integration._id)
            };
        } catch (error) {
            console.error(`Sync error for integration ${integration._id}:`, error);
            await this._handleSyncError(integration, error);
            throw error;
        }
    }
    
    async processAndSaveReviews(reviews, integration) {
        try {
            // Mappa le recensioni in un formato standardizzato
            const mappedReviews = this._mapReviewsByPlatform(reviews, integration.platform);
            
            // Trova l'ultima recensione per data
            const lastReview = await Review.findOne({
                hotelId: integration.hotelId,
                platform: integration.platform
            }).sort({ 'metadata.originalCreatedAt': -1 });
            
            // Filtra solo le recensioni più recenti dell'ultima
            const reviewsToImport = this._filterNewReviews(mappedReviews, lastReview);
            
            console.log(`Filtered ${reviewsToImport.length} new reviews to import`);
            
            if (reviewsToImport.length === 0) {
                return { newReviews: 0 };
            }
            
            // Salva le nuove recensioni
            const savedReviews = await this._saveReviews(reviewsToImport, integration);
            
            return { newReviews: savedReviews.length };
        } catch (error) {
            console.error('Error processing reviews:', error);
            throw error;
        }
    }
    
    _prepareSyncConfig(integration, options) {
        const config = {
            language: integration.syncConfig.language || 'en',
            maxReviews: integration.syncConfig.maxReviews || '100'
        };
        
        // Se abbiamo un'ultima recensione, usiamo la sua data come punto di partenza
        if (options.incrementalSync !== false) {
            return Review.findOne({
                hotelId: integration.hotelId,
                platform: integration.platform
            })
            .sort({ 'metadata.originalCreatedAt': -1 })
            .then(lastReview => {
                if (lastReview && lastReview.metadata?.originalCreatedAt) {
                    config.startDate = lastReview.metadata.originalCreatedAt;
                }
                return config;
            });
        }
        
        return config;
    }
    
    _mapReviewsByPlatform(reviews, platform) {
        return reviews.map(reviewData => {
            let mappedData = {};
            
            switch(platform) {
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
                        rating: reviewData.rating,
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
            
            return mappedData;
        });
    }
    
    _filterNewReviews(mappedReviews, lastReview) {
        if (!lastReview) return mappedReviews;
        
        const lastDate = new Date(lastReview.metadata?.originalCreatedAt || lastReview.content.date);
        
        return mappedReviews.filter(review => {
            const reviewDate = new Date(review.date);
            return reviewDate > lastDate;
        });
    }
    
    async _saveReviews(reviewsToImport, integration) {
        const savedReviews = [];
        
        for (const reviewData of reviewsToImport) {
            try {
                // Verifica se la recensione esiste già
                const existingReview = await Review.findOne({
                    hotelId: integration.hotelId,
                    platform: integration.platform,
                    externalReviewId: reviewData.externalId
                });
                
                if (!existingReview) {
                    const review = new Review({
                        hotelId: integration.hotelId,
                        integrationId: integration._id,
                        platform: integration.platform,
                        externalReviewId: reviewData.externalId,
                        content: {
                            text: reviewData.text,
                            rating: reviewData.rating,
                            reviewerName: reviewData.reviewerName,
                            reviewerImage: reviewData.reviewerImage,
                            language: reviewData.language,
                            images: reviewData.images,
                            likes: reviewData.likes,
                            originalUrl: reviewData.originalUrl
                        },
                        metadata: {
                            originalCreatedAt: new Date(reviewData.date),
                            syncedAt: new Date(),
                            numberOfNights: reviewData.metadata?.numberOfNights,
                            travelerType: reviewData.metadata?.travelerType
                        }
                    });
                    
                    await review.save();
                    savedReviews.push(review);
                }
            } catch (error) {
                console.error('Error saving review:', error, reviewData);
            }
        }
        
        return savedReviews;
    }
    
    async _updateIntegrationAfterSync(integration, newReviewsCount, isManualSync) {
        const nextSync = this._calculateNextSyncDate(integration.syncConfig.frequency);
        const wasStatusPending = integration.status === 'pending';
        
        const updateData = {
            status: 'active',
            'syncConfig.lastSync': new Date(),
            'syncConfig.nextScheduledSync': nextSync,
            'stats.totalReviews': (integration.stats?.totalReviews || 0) + newReviewsCount
        };
        
        if (newReviewsCount > 0) {
            updateData['stats.syncedReviews'] = (integration.stats?.syncedReviews || 0) + newReviewsCount;
            updateData['stats.lastSyncedReviewDate'] = new Date();
        }
        
        await Integration.findByIdAndUpdate(integration._id, { $set: updateData });
    }
    
    _calculateNextSyncDate(frequency) {
        const nextSync = new Date();
        switch(frequency) {
            case 'daily': nextSync.setDate(nextSync.getDate() + 1); break;
            case 'weekly': nextSync.setDate(nextSync.getDate() + 7); break;
            case 'monthly': nextSync.setMonth(nextSync.getMonth() + 1); break;
        }
        return nextSync;
    }
    
    async _sendNotifications(integration, newReviewsCount) {
        try {
            const hotel = await Hotel.findById(integration.hotelId);
            const user = await User.findById(hotel.userId);
            
            const wasStatusPending = integration.status === 'pending';
            
            await resend.emails.send({
                from: 'Replai <notifications@replai.io>',
                to: user.email,
                subject: wasStatusPending 
                    ? `Integration Setup Complete - ${hotel.name}`
                    : `New Reviews Alert - ${hotel.name}`,
                html: newReviewsEmailTemplate(
                    hotel.name,
                    newReviewsCount,
                    integration.platform,
                    process.env.APP_URL,
                    wasStatusPending
                )
            });
        } catch (emailError) {
            console.error('Failed to send email notification:', emailError);
        }
    }
    
    async _handleSyncError(integration, error) {
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
}

module.exports = new SyncService(); 