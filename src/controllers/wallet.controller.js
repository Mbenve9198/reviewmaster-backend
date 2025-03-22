const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const User = require('../models/user.model');
const Transaction = require('../models/transaction.model');
const creditService = require('../services/creditService');
const AppSettings = require('../models/app-settings.model');
const UserCreditSettings = require('../models/user-credit-settings.model');

const calculatePricePerCredit = (credits) => {
    if (credits >= 10000) return 0.10;
    if (credits >= 500) return 0.15;
    return 0.30;
};

const walletController = {
    createPaymentIntent: async (req, res) => {
        try {
            const { credits } = req.body;
            const userId = req.userId;

            console.log('Creating payment intent with credits:', credits);

            if (!credits || credits < 34) {
                return res.status(400).json({ 
                    message: 'Minimum credits amount is 34' 
                });
            }

            const user = await User.findById(userId);
            if (!user) {
                return res.status(404).json({ message: 'User not found' });
            }

            const pricePerCredit = calculatePricePerCredit(credits);
            const totalPrice = credits * pricePerCredit; // Calcola il prezzo in euro
            const amount = Math.round(totalPrice * 100); // Converti in centesimi per Stripe

            console.log('Payment intent details:', {
                credits,
                pricePerCredit,
                totalPrice,
                amountInCents: amount
            });

            try {
                // Se l'utente non ha già un ID cliente Stripe, creane uno
                let stripeCustomerId = user.stripeCustomerId;
                
                if (!stripeCustomerId) {
                    console.log('Creating Stripe customer for user:', userId);
                    
                    const customer = await stripe.customers.create({
                        email: user.email,
                        name: user.name || 'Customer',
                        metadata: {
                            userId: userId.toString()
                        }
                    });
                    
                    stripeCustomerId = customer.id;
                    
                    // Salva l'ID cliente Stripe nell'oggetto utente
                    await User.findByIdAndUpdate(userId, {
                        stripeCustomerId: stripeCustomerId
                    });
                    
                    console.log('Stripe customer created:', stripeCustomerId);
                }

                const paymentIntent = await stripe.paymentIntents.create({
                    amount, // es: 1500 centesimi = 15€
                    currency: 'eur',
                    customer: stripeCustomerId,
                    setup_future_usage: 'off_session', // Importante: permette di riutilizzare questo metodo di pagamento in futuro
                    metadata: {
                        userId,
                        credits,
                        pricePerCredit
                    },
                    automatic_payment_methods: {
                        enabled: true,
                    },
                });

                // Create pending transaction
                await Transaction.create({
                    userId,
                    type: 'purchase',
                    credits,
                    amount: totalPrice, // Salviamo il prezzo in euro
                    status: 'pending',
                    description: `Purchase of ${credits} credits`,
                    metadata: {
                        stripePaymentIntentId: paymentIntent.id,
                        pricePerCredit
                    }
                });

                res.json({
                    clientSecret: paymentIntent.client_secret,
                    amount,
                    credits,
                    pricePerCredit
                });
            } catch (stripeError) {
                console.error('Stripe error:', stripeError);
                return res.status(402).json({
                    message: 'Payment failed',
                    error: stripeError.message,
                    code: stripeError.code
                });
            }
        } catch (error) {
            console.error('Create payment intent error:', error);
            res.status(500).json({ 
                message: 'Error creating payment intent',
                error: error.message 
            });
        }
    },

    getWalletInfo: async (req, res) => {
        try {
            const userId = req.userId;
            
            const [user, transactions, settings, failedTransactions] = await Promise.all([
                User.findById(userId),
                Transaction.getLatestTransactions(userId, 10),
                AppSettings.getGlobalSettings(),
                // Ottieni le ultime transazioni fallite
                Transaction.find({ 
                    userId: userId,
                    status: 'failed',
                    type: 'purchase' // Solo le ricariche fallite
                })
                .sort({ createdAt: -1 })
                .limit(5)
                .exec()
            ]);

            if (!user) {
                return res.status(404).json({ message: 'User not found' });
            }

            // Utilizza il valore delle impostazioni o il valore di fallback dal creditService
            const initialFreeCredits = settings?.credits?.initialFreeCredits || creditService.getInitialFreeCredits();
            
            res.json({
                credits: user.wallet.credits,
                freeScrapingUsed: user.wallet.freeScrapingUsed,
                freeScrapingRemaining: Math.max(0, initialFreeCredits - user.wallet.freeScrapingUsed),
                recentTransactions: transactions.map(t => t.getFormattedDetails()),
                failedTransactions: failedTransactions.map(t => t.getFormattedDetails())
            });
        } catch (error) {
            console.error('Get wallet info error:', error);
            res.status(500).json({ 
                message: 'Error fetching wallet info',
                error: error.message 
            });
        }
    },

    getTransactions: async (req, res) => {
        try {
            const userId = req.userId;
            const page = parseInt(req.query.page) || 1;
            const limit = parseInt(req.query.limit) || 10;
            const skip = (page - 1) * limit;

            // Modifichiamo la query per prendere solo le transazioni completate
            const transactions = await Transaction.find({ 
                userId,
                status: 'completed' // Mostra solo le transazioni completate
            })
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit);

            // Contiamo solo le transazioni completate
            const total = await Transaction.countDocuments({ 
                userId,
                status: 'completed'
            });

            const totalPages = Math.ceil(total / limit);

            res.json({
                transactions,
                pagination: {
                    currentPage: page,
                    totalPages,
                    totalItems: total,
                    itemsPerPage: limit
                }
            });
        } catch (error) {
            console.error('Get transactions error:', error);
            res.status(500).json({ 
                message: 'Failed to fetch transactions',
                error: error.message 
            });
        }
    },

    getStripeCustomerId: async (req, res) => {
        try {
            const userId = req.userId;
            
            const user = await User.findById(userId);
            if (!user) {
                return res.status(404).json({ message: 'User not found' });
            }

            res.json({
                stripeCustomerId: user.stripeCustomerId || null
            });
        } catch (error) {
            console.error('Error getting Stripe customer ID:', error);
            res.status(500).json({ 
                message: 'Failed to get Stripe customer ID',
                error: error.message 
            });
        }
    },

    // Nuovo metodo per ottenere le impostazioni utente incluse le credit settings
    getUserSettings: async (req, res) => {
        try {
            const userId = req.userId;
            
            const [user, creditSettings, transactions, settings, failedTransactions] = await Promise.all([
                User.findById(userId),
                UserCreditSettings.findOne({ userId }),
                Transaction.getLatestTransactions(userId, 10),
                AppSettings.getGlobalSettings(),
                Transaction.find({ 
                    userId: userId,
                    status: 'failed',
                    type: 'purchase'
                })
                .sort({ createdAt: -1 })
                .limit(5)
                .exec()
            ]);

            if (!user) {
                return res.status(404).json({ message: 'User not found' });
            }

            // Se non esistono impostazioni, crea il default
            if (!creditSettings) {
                const newSettings = await UserCreditSettings.create({
                    userId,
                    minimumThreshold: 50,
                    topUpAmount: 200,
                    autoTopUp: false
                });
                
                // Utilizza il valore delle impostazioni o il valore di fallback dal creditService
                const initialFreeCredits = settings?.credits?.initialFreeCredits || creditService.getInitialFreeCredits();
                
                // Restituisci le informazioni complete
                return res.json({
                    _id: user._id,
                    email: user.email,
                    name: user.name,
                    credits: user.wallet.credits,
                    freeScrapingUsed: user.wallet.freeScrapingUsed,
                    freeScrapingRemaining: Math.max(0, initialFreeCredits - user.wallet.freeScrapingUsed),
                    recentTransactions: transactions.map(t => t.getFormattedDetails()),
                    failedTransactions: failedTransactions.map(t => t.getFormattedDetails()),
                    creditSettings: newSettings
                });
            }

            // Utilizza il valore delle impostazioni o il valore di fallback dal creditService
            const initialFreeCredits = settings?.credits?.initialFreeCredits || creditService.getInitialFreeCredits();
            
            // Restituisci le informazioni complete
            res.json({
                _id: user._id,
                email: user.email,
                name: user.name,
                credits: user.wallet.credits,
                freeScrapingUsed: user.wallet.freeScrapingUsed,
                freeScrapingRemaining: Math.max(0, initialFreeCredits - user.wallet.freeScrapingUsed),
                recentTransactions: transactions.map(t => t.getFormattedDetails()),
                failedTransactions: failedTransactions.map(t => t.getFormattedDetails()),
                creditSettings
            });
        } catch (error) {
            console.error('Get user settings error:', error);
            res.status(500).json({ 
                message: 'Error fetching user settings',
                error: error.message 
            });
        }
    },

    // Nuovo metodo per aggiornare le impostazioni di credito dell'utente
    updateUserSettings: async (req, res) => {
        try {
            const userId = req.userId;
            const { creditSettings } = req.body;
            
            if (!creditSettings) {
                return res.status(400).json({ message: 'Credit settings are required' });
            }
            
            const user = await User.findById(userId);
            if (!user) {
                return res.status(404).json({ message: 'User not found' });
            }
            
            let userCreditSettings = await UserCreditSettings.findOne({ userId });
            
            if (!userCreditSettings) {
                userCreditSettings = new UserCreditSettings({
                    userId,
                    minimumThreshold: creditSettings.minimumThreshold || 50,
                    topUpAmount: creditSettings.topUpAmount || 200,
                    autoTopUp: creditSettings.autoTopUp !== undefined ? creditSettings.autoTopUp : false
                });
            } else {
                userCreditSettings.minimumThreshold = creditSettings.minimumThreshold || userCreditSettings.minimumThreshold;
                userCreditSettings.topUpAmount = creditSettings.topUpAmount || userCreditSettings.topUpAmount;
                userCreditSettings.autoTopUp = creditSettings.autoTopUp !== undefined ? creditSettings.autoTopUp : userCreditSettings.autoTopUp;
            }
            
            await userCreditSettings.save();
            
            // Restituisci solo le impostazioni aggiornate per semplicità
            res.json({
                message: 'Credit settings updated successfully',
                creditSettings: userCreditSettings
            });
        } catch (error) {
            console.error('Update user settings error:', error);
            res.status(500).json({ 
                message: 'Error updating user settings',
                error: error.message 
            });
        }
    }
};

module.exports = walletController;