const axios = require('axios');

const APIFY_BASE_URL = 'https://api.apify.com';
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
                `${APIFY_BASE_URL}/v2/acts/${actorId}/runs`,
                input,
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
                    `${APIFY_BASE_URL}/v2/acts/${actorId}/runs/${runId}`,
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
                    
                    // Ottieni i dettagli dell'esecuzione fallita
                    const runDetails = await this._getRunDetails(actorId, runId);
                    console.error(`Apify run ${runId} details:`, JSON.stringify(runDetails.details, null, 2));
                    console.error(`Apify run ${runId} logs:`, runDetails.logs);
                    
                    // Analizza i log per identificare problemi comuni
                    const logs = runDetails.logs || '';
                    
                    if (logs.includes('captcha') || logs.includes('CAPTCHA')) {
                        throw new Error(`Scraping failed: CAPTCHA detected. The platform may be blocking automated access.`);
                    } else if (logs.includes('blocked') || logs.includes('rate limit')) {
                        throw new Error(`Scraping failed: Access blocked or rate limited by the platform.`);
                    } else if (logs.includes('not found') || logs.includes('404')) {
                        throw new Error(`Scraping failed: The requested page or resource was not found.`);
                    } else if (logs.includes('invalid URL') || logs.includes('malformed URL')) {
                        throw new Error(`Scraping failed: The URL provided is invalid or malformed.`);
                    } else {
                        throw new Error(`Scraping failed with status: ${status}. Check logs for details.`);
                    }
                }
                
                console.log(`Apify run status (attempt ${attempts}/${maxAttempts}): ${status}`);
            }
            
            if (!isComplete) {
                throw new Error('Scraping timed out');
            }
            
            // Prima di recuperare il dataset
            console.log(`Attempting to get dataset with URL: ${APIFY_BASE_URL}/v2/actor-runs/${runId}/dataset/items`);

            try {
                const datasetResponse = await axios.get(
                    `${APIFY_BASE_URL}/v2/actor-runs/${runId}/dataset/items`,
                    {
                        headers: {
                            'Authorization': `Bearer ${this.token}`
                        }
                    }
                );
                
                // Verifica il formato della risposta
                console.log(`Got dataset response with status ${datasetResponse.status}`);
                
                const reviews = datasetResponse.data;
                console.log(`Retrieved ${reviews.length} reviews from Apify (requested ${config.maxReviews})`);
                
                // Check if we got fewer reviews than requested
                if (reviews.length < parseInt(config.maxReviews) && reviews.length > 0) {
                    console.log(`Note: Received fewer reviews (${reviews.length}) than requested (${config.maxReviews}). This may be due to platform limitations.`);
                }
                
                return reviews;
            } catch (datasetError) {
                console.error('Dataset fetch error details:', datasetError.response?.data || datasetError.message);
                throw new Error(`Failed to fetch dataset: ${datasetError.message}`);
            }
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
                    reviewsOrigin: 'google',
                    ...(startDate && { reviewsStartDate: startDate }),
                    startUrls: []
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
                    startUrls: []
                };
            case 'booking':
                return {
                    maxReviewsPerHotel: config.maxReviews === 'all' ? null : parseInt(config.maxReviews),
                    reviewScores: ['ALL'],
                    sortReviewsBy: 'f_recent_desc',
                    ...(startDate && { cutoffDate: startDate }),
                    startUrls: []
                };
            default:
                return {
                    maxReviews: config.maxReviews === 'all' ? null : parseInt(config.maxReviews),
                    personalData: true,
                    startUrls: []
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
        // Estrai il messaggio di errore dalla risposta di Apify
        if (error.response && error.response.data && error.response.data.error) {
            const apiError = error.response.data.error;
            
            console.log("Detailed Apify error:", JSON.stringify(apiError, null, 2));
            
            // Errori specifici dell'API
            switch (apiError.type) {
                case 'invalid-input':
                    if (apiError.message.includes('startUrls') && apiError.message.includes('valid URLs')) {
                        return new Error('The provided URL is invalid or not supported by this platform. Please check the URL format and try again.');
                    }
                    return new Error(`Invalid input: ${apiError.message}`);
                    
                case 'rate-limit-exceeded':
                    return new Error('Rate limit exceeded. Please try again later.');
                    
                default:
                    return new Error(`Apify error: ${apiError.message || apiError.type}`);
            }
        }
        
        // Se l'errore è nell'oggetto error direttamente
        if (error.data && error.data.error) {
            const apiError = error.data.error;
            return new Error(`Apify error: ${apiError.message || apiError.type || JSON.stringify(apiError)}`);
        }
        
        // Errori di rete o altri errori
        if (error.code === 'ECONNREFUSED' || error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT') {
            return new Error('Connection to scraping service failed. Please try again later.');
        }
        
        return new Error(error.message || 'Unknown error during scraping');
    }

    _prepareInput(platform, url, config) {
        const input = this._getDefaultConfig(platform, config);
        
        // Per Google Maps, usiamo l'URL originale senza modifiche
        if (platform === 'google') {
            console.log(`Using original URL: ${url}`);
            
            // Usa l'URL originale senza modifiche
            input.startUrls = [{
                url: url,
                method: "GET"
            }];
            
            // Aggiungi anche searchStrings come fallback
            const placeNameMatch = url.match(/place\/([^/@]+)/);
            if (placeNameMatch && placeNameMatch[1]) {
                const placeName = decodeURIComponent(placeNameMatch[1].replace(/\+/g, ' '));
                console.log(`Also adding search string: ${placeName}`);
                input.searchStrings = [placeName];
            }
        } else {
            // Per altre piattaforme, usa l'URL così com'è
            input.startUrls = [{ 
                url: url,
                method: "GET"
            }];
        }
        
        // Stampa l'input completo per debug
        console.log(`Final input for ${platform}:`, JSON.stringify(input, null, 2));
        
        return input;
    }

    async _getRunDetails(actorId, runId) {
        try {
            // Ottieni i dettagli dell'esecuzione
            const runResponse = await axios.get(
                `${APIFY_BASE_URL}/v2/acts/${actorId}/runs/${runId}`,
                {
                    headers: {
                        'Authorization': `Bearer ${this.token}`
                    }
                }
            );
            
            // Ottieni i log dell'esecuzione
            const logResponse = await axios.get(
                `${APIFY_BASE_URL}/v2/acts/${actorId}/runs/${runId}/log`,
                {
                    headers: {
                        'Authorization': `Bearer ${this.token}`
                    }
                }
            );
            
            return {
                details: runResponse.data.data,
                logs: logResponse.data
            };
        } catch (error) {
            console.error('Error getting run details:', error.message);
            return {
                details: null,
                logs: 'Could not retrieve logs'
            };
        }
    }
}

module.exports = new ApifyService();