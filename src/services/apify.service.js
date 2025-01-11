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
        if (!actorId) throw new Error(`Unsupported platform: ${platform}`);

        const endpoint = `${APIFY_BASE_URL}/${actorId}/run-sync-get-dataset-items`;
        
        const input = this._getDefaultConfig(platform, { ...config, url });

        try {
            const response = await axios.post(endpoint, input, {
                params: { token: this.token },
                headers: { 'Content-Type': 'application/json' }
            });

            return response.data;
        } catch (error) {
            throw this._handleError(error);
        }
    }

    _getDefaultConfig(platform, config) {
        switch (platform) {
            case 'google':
                return {
                    maxReviews: config.maxReviews === 'all' ? null : parseInt(config.maxReviews),
                    personalData: true,
                    maxImages: 0,
                    maxCrawledPlaces: 1,
                    startUrls: [{ url: config.url }]
                };
            case 'tripadvisor':
                return {
                    maxReviews: config.maxReviews === 'all' ? null : parseInt(config.maxReviews),
                    personalData: true,
                    includeAttractions: false,
                    includeRestaurants: false,
                    includeHotels: true,
                    startUrls: [{ url: config.url }]
                };
            case 'booking':
                return {
                    maxReviewsPerHotel: config.maxReviews === 'all' ? null : parseInt(config.maxReviews),
                    reviewScores: ['ALL'],
                    sortReviewsBy: 'f_recent_desc',
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
}

module.exports = new ApifyService();