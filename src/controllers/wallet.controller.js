const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const User = require('../models/user.model');
const Transaction = require('../models/transaction.model');
const creditService = require('../services/creditService');
const AppSettings = require('../models/app-settings.model');

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
            
            const [user, transactions, settings] = await Promise.all([
                User.findById(userId),
                Transaction.getLatestTransactions(userId, 10),
                AppSettings.getGlobalSettings()
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
                recentTransactions: transactions.map(t => t.getFormattedDetails())
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
    }
};

module.exports = walletController;