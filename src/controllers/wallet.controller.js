const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const User = require('../models/user.model');
const Transaction = require('../models/transaction.model');

const calculatePricePerCredit = (credits) => {
    if (credits < 200) return 0.30;
    if (credits < 1000) return 0.24;
    return 0.20;
};

const walletController = {
    createPaymentIntent: async (req, res) => {
        try {
            const { credits } = req.body;
            const userId = req.userId;

            if (!credits || credits < 34) { // Minimo 10€
                return res.status(400).json({ 
                    message: 'Minimum credits amount is 34' 
                });
            }

            const user = await User.findById(userId);
            if (!user) {
                return res.status(404).json({ message: 'User not found' });
            }

            const pricePerCredit = calculatePricePerCredit(credits);
            const amount = Math.round(credits * pricePerCredit * 100); // Stripe wants amount in cents

            const paymentIntent = await stripe.paymentIntents.create({
                amount,
                currency: 'eur',
                metadata: {
                    userId,
                    credits,
                    pricePerCredit
                }
            });

            // Create pending transaction
            await Transaction.create({
                userId,
                type: 'purchase',
                credits,
                amount: amount / 100,
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
            
            const [user, transactions] = await Promise.all([
                User.findById(userId),
                Transaction.getLatestTransactions(userId, 10)
            ]);

            if (!user) {
                return res.status(404).json({ message: 'User not found' });
            }

            res.json({
                credits: user.wallet.credits,
                freeScrapingUsed: user.wallet.freeScrapingUsed,
                freeScrapingRemaining: 1000 - user.wallet.freeScrapingUsed,
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
            const limit = parseInt(req.query.limit) || 20;
            const skip = (page - 1) * limit;

            const [transactions, total] = await Promise.all([
                Transaction.find({ userId })
                    .sort({ createdAt: -1 })
                    .skip(skip)
                    .limit(limit)
                    .exec(),
                Transaction.countDocuments({ userId })
            ]);

            res.json({
                transactions: transactions.map(t => t.getFormattedDetails()),
                pagination: {
                    page,
                    limit,
                    total,
                    pages: Math.ceil(total / limit)
                }
            });
        } catch (error) {
            console.error('Get transactions error:', error);
            res.status(500).json({ 
                message: 'Error fetching transactions',
                error: error.message 
            });
        }
    }
};

module.exports = walletController;