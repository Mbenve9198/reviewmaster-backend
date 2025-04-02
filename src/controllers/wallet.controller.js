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
            const { credits, billingDetails, business_details } = req.body;
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
                    
                    const customerData = {
                        email: user.email,
                        name: user.name || 'Customer',
                        metadata: {
                            userId: userId.toString()
                        }
                    };
                    
                    // Aggiungi i dettagli di fatturazione se disponibili
                    if (billingDetails) {
                        customerData.name = billingDetails.name || customerData.name;
                        customerData.phone = billingDetails.phone;
                        customerData.address = billingDetails.address;
                        
                        // Salva i dettagli di fatturazione anche nel profilo utente
                        if (!user.billingAddress) {
                            user.billingAddress = {
                                name: billingDetails.name,
                                company: business_details?.name,
                                vatId: billingDetails.tax_ids?.find(tax => tax.type === 'eu_vat')?.value,
                                taxId: billingDetails.tax_ids?.find(tax => tax.type === 'it_pin')?.value,
                                address: {
                                    line1: billingDetails.address.line1,
                                    line2: billingDetails.address.line2,
                                    city: billingDetails.address.city,
                                    state: billingDetails.address.state,
                                    postalCode: billingDetails.address.postal_code,
                                    country: billingDetails.address.country,
                                },
                                phone: billingDetails.phone,
                                isDefault: true
                            };
                            await user.save();
                        }
                    }
                    
                    const customer = await stripe.customers.create(customerData);
                    
                    stripeCustomerId = customer.id;
                    
                    // Salva l'ID cliente Stripe nell'oggetto utente
                    await User.findByIdAndUpdate(userId, {
                        stripeCustomerId: stripeCustomerId
                    });
                    
                    console.log('Stripe customer created:', stripeCustomerId);
                } else if (billingDetails) {
                    // Aggiorna i dettagli del cliente Stripe esistente
                    await stripe.customers.update(stripeCustomerId, {
                        name: billingDetails.name,
                        phone: billingDetails.phone,
                        address: billingDetails.address
                    });
                    
                    // Aggiorna i metadati relativi all'azienda se disponibili
                    if (business_details?.name) {
                        await stripe.customers.update(stripeCustomerId, {
                            metadata: {
                                ...user.metadata,
                                company: business_details.name
                            }
                        });
                    }
                }

                // Crea il payment intent con i dettagli di fatturazione
                const paymentIntentData = {
                    amount, // es: 1500 centesimi = 15€
                    currency: 'eur',
                    customer: stripeCustomerId,
                    setup_future_usage: 'off_session', // Importante: permette di riutilizzare questo metodo di pagamento in futuro
                    
                    // Abilita Stripe Tax per il calcolo automatico dell'IVA
                    automatic_tax: {
                        enabled: true,
                    },
                    // Specifica che l'importo è al netto di tasse (verrà aggiunta l'IVA se necessario)
                    tax_behavior: 'exclusive',
                    
                    // Dettagli del cliente necessari per il calcolo delle tasse
                    customer_details: {
                        address: billingDetails?.address || {},
                        email: user.email,
                        name: billingDetails?.name || user.name,
                        phone: billingDetails?.phone,
                        tax_ids: billingDetails?.tax_ids || []
                    },
                    
                    // Abilita la raccolta degli ID fiscali (P.IVA, ecc.)
                    tax_id_collection: {
                        enabled: true
                    },
                    
                    metadata: {
                        userId,
                        credits,
                        pricePerCredit
                    },
                    automatic_payment_methods: {
                        enabled: true,
                        allow_redirects: 'never',
                        payment_method_types: ['card'] // Limita solo al pagamento con carta
                    },
                };
                
                // Aggiungi le informazioni di fatturazione al payment intent
                if (billingDetails) {
                    paymentIntentData.receipt_email = user.email; // Usa l'email dell'utente per la ricevuta
                    
                    // Le informazioni fiscali e l'indirizzo sono già impostate in customer_details
                    // Non è necessario impostare payment_method_data (che richiede anche il campo 'type')
                }
                
                const paymentIntent = await stripe.paymentIntents.create(paymentIntentData);

                // Ottieni l'importo totale con le tasse incluse (se presenti)
                const totalAmount = paymentIntent.amount;
                const taxAmount = paymentIntent.automatic_tax?.enabled ? 
                    (paymentIntent.automatic_tax.calculated_tax || 0) : 0;
                
                // Calcola il prezzo finale in euro (non in centesimi)
                const finalTotalPrice = totalAmount / 100;
                const taxPrice = taxAmount / 100;

                // Create pending transaction
                await Transaction.create({
                    userId,
                    type: 'purchase',
                    credits,
                    amount: finalTotalPrice, // Salviamo il prezzo totale in euro
                    status: 'pending',
                    description: `Purchase of ${credits} credits`,
                    metadata: {
                        stripePaymentIntentId: paymentIntent.id,
                        pricePerCredit,
                        baseAmount: totalPrice,
                        taxAmount: taxPrice,
                        hasTax: taxAmount > 0
                    }
                });

                res.json({
                    clientSecret: paymentIntent.client_secret,
                    amount: totalAmount, // Importo in centesimi inclusa IVA
                    baseAmount: amount, // Importo base in centesimi
                    taxAmount, // Importo IVA in centesimi
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
    },

    // Ottiene l'indirizzo di fatturazione dell'utente
    getBillingAddress: async (req, res) => {
        try {
            const userId = req.userId;
            
            if (!userId) {
                return res.status(401).json({ message: 'User not authenticated' });
            }
            
            const user = await User.findById(userId);
            
            if (!user) {
                return res.status(404).json({ message: 'User not found' });
            }
            
            return res.status(200).json({ 
                billingAddress: user.billingAddress || null 
            });
        } catch (error) {
            console.error('Error getting billing address:', error);
            return res.status(500).json({ 
                message: 'Error retrieving billing address', 
                error: error.message 
            });
        }
    },

    // Salva l'indirizzo di fatturazione dell'utente
    saveBillingAddress: async (req, res) => {
        try {
            const userId = req.userId;
            const billingAddressData = req.body;
            
            if (!userId) {
                return res.status(401).json({ message: 'User not authenticated' });
            }
            
            // Validazione
            if (!billingAddressData.name || !billingAddressData.address) {
                return res.status(400).json({ message: 'Incomplete address data' });
            }
            
            const user = await User.findById(userId);
            
            if (!user) {
                return res.status(404).json({ message: 'User not found' });
            }
            
            // Aggiorna l'indirizzo di fatturazione
            user.billingAddress = billingAddressData;
            await user.save();
            
            // Aggiorna anche i dettagli del cliente Stripe se esiste
            if (user.stripeCustomerId) {
                try {
                    await stripe.customers.update(user.stripeCustomerId, {
                        name: billingAddressData.name,
                        phone: billingAddressData.phone,
                        address: {
                            line1: billingAddressData.address.line1,
                            line2: billingAddressData.address.line2 || '',
                            city: billingAddressData.address.city,
                            state: billingAddressData.address.state || '',
                            postal_code: billingAddressData.address.postalCode,
                            country: billingAddressData.address.country,
                        },
                    });
                    
                    // Se c'è un'azienda, aggiunge anche i metadata
                    if (billingAddressData.company) {
                        await stripe.customers.update(user.stripeCustomerId, {
                            metadata: {
                                ...user.metadata,
                                company: billingAddressData.company,
                                vatId: billingAddressData.vatId || '',
                                taxId: billingAddressData.taxId || ''
                            }
                        });
                    }
                } catch (stripeError) {
                    console.error('Error updating Stripe customer:', stripeError);
                    // Non blocchiamo l'operazione se l'aggiornamento Stripe fallisce
                }
            }
            
            return res.status(200).json({ 
                message: 'Billing address saved successfully',
                billingAddress: user.billingAddress
            });
        } catch (error) {
            console.error('Error saving billing address:', error);
            return res.status(500).json({ 
                message: 'Error saving billing address', 
                error: error.message 
            });
        }
    }
};

module.exports = walletController;