const axios = require('axios');

const APIFY_BASE_URL = 'https://api.apify.com/v2/acts';
const ACTORS = {
    google: 'compass~google-maps-reviews-scraper',
    tripadvisor: 'maxcopell~tripadvisor-reviews',
    booking: 'arel~booking-com-reviews-scraper'
};

class ApifyService {
    constructor() {
        this.token = process.env.APIFY_API_KEY;
    }

    async runScraper(platform, url, config) {
        const actorId = ACTORS[platform];
        if (!actorId) throw new Error(`Unsupported platform: ${platform}`);

        const endpoint = `${APIFY_BASE_URL}/${actorId}/run-sync-get-dataset-items`;
        
        const input = {
            ...this._getDefaultConfig(platform, config),
            startUrls: [{ url }]
        };

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
        const base = {
            maxReviews: config.maxReviews === 'all' ? null : parseInt(config.maxReviews),
            personalData: true
        };

        switch (platform) {
            case 'google':
                return {
                    ...base,
                    maxImages: 0,
                    maxCrawledPlaces: 1
                };
            case 'tripadvisor':
                return {
                    ...base,
                    includeAttractions: false,
                    includeRestaurants: false,
                    includeHotels: true
                };
            case 'booking':
                return {
                    ...base,
                    minScore: 1,
                    maxScore: 10,
                    minimizeRequestCount: true
                };
            default:
                return base;
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