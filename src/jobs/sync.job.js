const cron = require('node-cron');
const Integration = require('../models/integration.model');
const syncService = require('../services/sync.service');

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
        await syncService.syncIntegration(integration);
    } catch (error) {
        console.error(`Sync failed for integration ${integration._id}:`, error);
    } finally {
        activeSyncs--;
    }
}

module.exports = { setupSyncJobs }; 