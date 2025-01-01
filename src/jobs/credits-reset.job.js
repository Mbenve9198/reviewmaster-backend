const cron = require('node-cron');
const User = require('../models/user.model');

// Funzione che verrà eseguita dal cron job
async function resetCredits() {
    const now = new Date();
    
    try {
        // Trova tutti gli utenti che necessitano un reset
        const usersToReset = await User.find({
            'subscription.status': 'active',
            'subscription.nextResetDate': { $lte: now }
        });

        console.log(`Found ${usersToReset.length} users needing credits reset`);

        for (const user of usersToReset) {
            try {
                await user.resetCredits();
                console.log(`Reset credits for user ${user._id}`);
            } catch (error) {
                console.error(`Error resetting credits for user ${user._id}:`, error);
            }
        }
    } catch (error) {
        console.error('Error in resetCredits job:', error);
    }
}

// Configura il cron job per eseguire ogni ora
// Questo ci permette di catturare i reset necessari senza dover aspettare il giorno successivo
// se per qualche motivo il job fallisce
function setupCreditsResetJob() {
    cron.schedule('0 * * * *', async () => {
        console.log('Running credits reset job...');
        await resetCredits();
    });
}

module.exports = {
    setupCreditsResetJob
};