const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const Transaction = require('../models/transaction.model');
const User = require('../models/user.model');

const PLAN_LIMITS = {
    host: 50,
    manager: 200,
    director: 500,
    trial: 10
};

const webhookController = {
    handleStripeWebhook: async (req, res) => {
        const sig = req.headers['stripe-signature'];
        let event;

        try {
            // Verifica la firma del webhook
            event = stripe.webhooks.constructEvent(
                req.rawBody, // Assicurati che express sia configurato per ricevere il body raw
                sig,
                process.env.STRIPE_WEBHOOK_SECRET
            );

            console.log('Webhook event type:', event.type);

            switch (event.type) {
                case 'payment_intent.created':
                    console.log('Payment intent created:', event.data.object.id);
                    break;

                case 'payment_intent.succeeded':
                    const paymentIntent = event.data.object;
                    console.log('Payment succeeded:', paymentIntent.id);
                    
                    // Aggiorna la transazione
                    await Transaction.findOneAndUpdate(
                        { 'metadata.stripePaymentIntentId': paymentIntent.id },
                        { 
                            status: 'completed',
                            completedAt: new Date()
                        }
                    );

                    // Aggiorna i crediti dell'utente
                    const { userId, credits } = paymentIntent.metadata;
                    await User.findByIdAndUpdate(userId, {
                        $inc: { 'wallet.credits': parseInt(credits) }
                    });
                    break;

                case 'payment_intent.payment_failed':
                    const failedPayment = event.data.object;
                    console.log('Payment failed for payment intent', failedPayment.id);
                    console.log('Failure reason:', failedPayment.last_payment_error?.message);
                    
                    // Aggiorna la transazione come fallita
                    await Transaction.findOneAndUpdate(
                        { 'metadata.stripePaymentIntentId': failedPayment.id },
                        { 
                            status: 'failed',
                            error: failedPayment.last_payment_error?.message || 'Payment failed',
                            updatedAt: new Date()
                        }
                    );
                    break;

                default:
                    console.log(`Unhandled event type ${event.type}`);
            }

            res.json({ received: true });
        } catch (err) {
            console.error('Webhook error:', err.message);
            return res.status(400).send(`Webhook Error: ${err.message}`);
        }
    },

    handleCheckoutCompleted: async (req, res) => {
        const sig = req.headers['stripe-signature'];
        let event;

        try {
            event = stripe.webhooks.constructEvent(
                req.body,
                sig,
                process.env.STRIPE_WEBHOOK_SECRET
            );
        } catch (err) {
            console.error('Webhook signature verification failed:', err.message);
            return res.status(400).send(`Webhook Error: ${err.message}`);
        }

        try {
            switch (event.type) {
                case 'checkout.session.completed':
                    await handleCheckoutCompleted(event.data.object);
                    break;
                case 'checkout.session.expired':
                    await handleCheckoutExpired(event.data.object);
                    break;
                case 'customer.subscription.updated':
                    await handleSubscriptionUpdated(event.data.object);
                    break;
                case 'customer.subscription.deleted':
                    await handleSubscriptionDeleted(event.data.object);
                    break;
                case 'customer.subscription.trial_will_end':
                    await handleTrialEnding(event.data.object);
                    break;
                case 'invoice.payment_failed':
                    await handlePaymentFailed(event.data.object);
                    break;
                case 'invoice.payment_action_required':
                    await handlePaymentActionRequired(event.data.object);
                    break;
                default:
                    console.log(`Unhandled event type ${event.type}`);
            }

            res.json({ received: true });
        } catch (err) {
            console.error('Error processing webhook:', err);
            res.status(500).send('Webhook processing failed');
        }
    },

    handleCheckoutCompleted: async function handleCheckoutCompleted(session) {
        const customerId = session.customer;
        const subscriptionId = session.subscription;
        const userEmail = session.client_reference_id; // Email dell'utente passata dalla pagina dei piani
        const plan = session.metadata?.plan?.toLowerCase(); // host, manager o director
        
        if (!userEmail) {
            console.error('No client_reference_id found in session');
            return;
        }

        if (!plan || !PLAN_LIMITS[plan]) {
            console.error('Invalid plan in metadata:', plan);
            return;
        }

        try {
            const user = await User.findOne({ email: userEmail });
            
            if (!user) {
                console.error('User not found with email:', userEmail);
                return;
            }

            await User.findByIdAndUpdate(
                user._id,
                {
                    'subscription.status': 'active',
                    'subscription.plan': plan,
                    'subscription.stripeCustomerId': customerId,
                    'subscription.stripeSubscriptionId': subscriptionId,
                    'subscription.responseCredits': PLAN_LIMITS[plan]
                }
            );

            console.log(`Subscription activated for user ${userEmail} with plan ${plan}`);
        } catch (error) {
            console.error('Error updating user after checkout:', error);
        }
    },

    handleCheckoutExpired: async function handleCheckoutExpired(session) {
        const userEmail = session.client_reference_id;
        
        if (!userEmail) {
            console.error('No client_reference_id found in session');
            return;
        }

        try {
            await User.findOneAndUpdate(
                { email: userEmail },
                { 'subscription.status': 'inactive' }
            );

            console.log(`Checkout expired for user ${userEmail}`);
        } catch (error) {
            console.error('Error handling expired checkout:', error);
        }
    },

    handleSubscriptionUpdated: async function handleSubscriptionUpdated(subscription) {
        const customerId = subscription.customer;
        const status = subscription.status;
        const plan = subscription.metadata?.plan?.toLowerCase();
        
        if (!plan || !PLAN_LIMITS[plan]) {
            console.error('Invalid plan in metadata:', plan);
            return;
        }

        try {
            const user = await User.findOne({ 'subscription.stripeCustomerId': customerId });
            
            if (!user) {
                console.error('User not found with stripeCustomerId:', customerId);
                return;
            }

            await User.findByIdAndUpdate(
                user._id,
                { 
                    'subscription.status': status,
                    'subscription.plan': plan,
                    'subscription.responseCredits': PLAN_LIMITS[plan]
                }
            );

            console.log(`Subscription updated for user ${user.email} - Status: ${status}, Plan: ${plan}`);
        } catch (error) {
            console.error('Error updating subscription:', error);
        }
    },

    handleSubscriptionDeleted: async function handleSubscriptionDeleted(subscription) {
        const customerId = subscription.customer;
        
        try {
            const user = await User.findOne({ 'subscription.stripeCustomerId': customerId });
            
            if (!user) {
                console.error('User not found with stripeCustomerId:', customerId);
                return;
            }

            await User.findByIdAndUpdate(
                user._id,
                { 
                    'subscription.status': 'cancelled',
                    'subscription.plan': 'trial',
                    'subscription.responseCredits': PLAN_LIMITS.trial,
                    $unset: {
                        'subscription.stripeCustomerId': "",
                        'subscription.stripeSubscriptionId': ""
                    }
                }
            );

            console.log(`Subscription cancelled for user ${user.email}`);
        } catch (error) {
            console.error('Error handling subscription deletion:', error);
        }
    },

    handleTrialEnding: async function handleTrialEnding(subscription) {
        const customerId = subscription.customer;
        
        try {
            const user = await User.findOne({ 'subscription.stripeCustomerId': customerId });
            
            if (!user) {
                console.error('User not found with stripeCustomerId:', customerId);
                return;
            }

            // Qui puoi implementare la logica per inviare una email di notifica
            console.log(`Trial ending soon for user ${user.email}`);
        } catch (error) {
            console.error('Error handling trial ending:', error);
        }
    },

    handlePaymentFailed: async function handlePaymentFailed(invoice) {
        const customerId = invoice.customer;
        
        try {
            const user = await User.findOne({ 'subscription.stripeCustomerId': customerId });
            
            if (!user) {
                console.error('User not found with stripeCustomerId:', customerId);
                return;
            }

            await User.findByIdAndUpdate(
                user._id,
                { 'subscription.status': 'past_due' }
            );

            // Qui puoi implementare la logica per inviare una email di notifica
            console.log(`Payment failed for user ${user.email}`);
        } catch (error) {
            console.error('Error handling payment failure:', error);
        }
    },

    handlePaymentActionRequired: async function handlePaymentActionRequired(invoice) {
        const customerId = invoice.customer;
        
        try {
            const user = await User.findOne({ 'subscription.stripeCustomerId': customerId });
            
            if (!user) {
                console.error('User not found with stripeCustomerId:', customerId);
                return;
            }

            // Qui puoi implementare la logica per inviare una email di notifica
            console.log(`Payment action required for user ${user.email}`);
        } catch (error) {
            console.error('Error handling payment action required:', error);
        }
    }
};

module.exports = webhookController;
