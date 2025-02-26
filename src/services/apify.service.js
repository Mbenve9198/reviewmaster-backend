const axios = require('axios');

const APIFY_BASE_URL = 'https://api.apify.com/v2/acts';
const ACTORS = {
    google: 'compass~google-maps-reviews-scraper',
    tripadvisor: 'maxcopell~tripadvisor-reviews',
    booking: 'voyager~booking-reviews-scraper'
};

class ApifyService {
    constructor() {
        this.token = process.env.APIFY_API_KEY;
    }

    async runScraper(platform, url, config) {
        const actorId = ACTORS[platform];
        
        if (!actorId) {
            throw new Error(`Unsupported platform: ${platform}`);
        }
        
        try {
            console.log(`Starting Apify scraper for ${platform} with config:`, config);
            
            const input = this._prepareInput(platform, url, config);
            
            const response = await axios.post(
                `${APIFY_BASE_URL}/${actorId}/runs`,
                {
                    ...input,
                    timeout: 300, // 5 minutes timeout
                    memory: 4096, // 4GB memory
                    build: 'latest'
                },
                {
                    headers: {
                        'Authorization': `Bearer ${this.token}`,
                        'Content-Type': 'application/json'
                    }
                }
            );
            
            const runId = response.data.data.id;
            console.log(`Apify run started with ID: ${runId}`);
            
            // Poll for completion
            let isComplete = false;
            let attempts = 0;
            const maxAttempts = 60; // 5 minutes with 5-second intervals
            
            while (!isComplete && attempts < maxAttempts) {
                await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds
                
                const statusResponse = await axios.get(
                    `${APIFY_BASE_URL}/${actorId}/runs/${runId}`,
                    {
                        headers: {
                            'Authorization': `Bearer ${this.token}`
                        }
                    }
                );
                
                const status = statusResponse.data.data.status;
                attempts++;
                
                if (status === 'SUCCEEDED') {
                    isComplete = true;
                } else if (status === 'FAILED' || status === 'ABORTED' || status === 'TIMED-OUT') {
                    console.error(`Apify run ${runId} ended with status: ${status}`);
                    throw new Error(`Scraping failed with status: ${status}`);
                }
                
                console.log(`Apify run status (attempt ${attempts}/${maxAttempts}): ${status}`);
            }
            
            if (!isComplete) {
                throw new Error('Scraping timed out');
            }
            
            // Get dataset items
            const datasetResponse = await axios.get(
                `${APIFY_BASE_URL}/${actorId}/runs/${runId}/dataset/items`,
                {
                    headers: {
                        'Authorization': `Bearer ${this.token}`
                    },
                    params: {
                        format: 'json',
                        clean: 1
                    }
                }
            );
            
            const reviews = datasetResponse.data;
            console.log(`Retrieved ${reviews.length} reviews from Apify (requested ${config.maxReviews})`);
            
            // Check if we got fewer reviews than requested
            if (reviews.length < parseInt(config.maxReviews) && reviews.length > 0) {
                console.log(`Note: Received fewer reviews (${reviews.length}) than requested (${config.maxReviews}). This may be due to platform limitations.`);
            }
            
            return reviews;
        } catch (error) {
            console.error('Apify scraper error:', error.response?.data || error.message);
            throw this._handleApifyError(error);
        }
    }

    _getDefaultConfig(platform, config) {
        const startDate = config.startDate ? new Date(config.startDate).toISOString().split('T')[0] : null;

        switch (platform) {
            case 'google':
                return {
                    language: config.language || 'en',
                    maxReviews: config.maxReviews === 'all' ? null : parseInt(config.maxReviews),
                    personalData: true,
                    maxImages: 0,
                    maxCrawledPlaces: 1,
                    reviewsSort: 'newest',
                    ...(startDate && { reviewsStartDate: startDate }),
                    startUrls: [{ url: config.url }]
                };
            case 'tripadvisor':
                return {
                    maxReviewsPerQuery: config.maxReviews === 'all' ? null : parseInt(config.maxReviews),
                    personalData: true,
                    includeAttractions: false,
                    includeRestaurants: false,
                    includeHotels: true,
                    reviewsLanguages: ['ALL_REVIEW_LANGUAGES'],
                    reviewRatings: ['ALL_REVIEW_RATINGS'],
                    ...(startDate && { lastReviewDate: startDate }),
                    startUrls: [{ url: config.url }]
                };
            case 'booking':
                return {
                    maxReviewsPerHotel: config.maxReviews === 'all' ? null : parseInt(config.maxReviews),
                    reviewScores: ['ALL'],
                    sortReviewsBy: 'f_recent_desc',
                    ...(startDate && { cutoffDate: startDate }),
                    startUrls: [{ 
                        url: config.url,
                        method: 'GET'
                    }]
                };
            default:
                return {
                    maxReviews: config.maxReviews === 'all' ? null : parseInt(config.maxReviews),
                    personalData: true,
                    startUrls: [{ url: config.url }]
                };
        }
    }

    _handleError(error) {
        if (error.response) {
            const status = error.response.status;
            const data = error.response.data;

            switch (status) {
                case 401:
                    return new Error('Invalid Apify API token');
                case 429:
                    return new Error('Rate limit exceeded');
                case 404:
                    return new Error('Actor not found');
                default:
                    return new Error(`Apify error: ${data.message || 'Unknown error'}`);
            }
        }
        return error;
    }

    _handleApifyError(error) {
        // Implement the logic to handle Apify-specific errors
        return this._handleError(error);
    }

    _prepareInput(platform, url, config) {
        const input = this._getDefaultConfig(platform, config);
        input.url = url;
        return input;
    }
}

module.exports = new ApifyService();