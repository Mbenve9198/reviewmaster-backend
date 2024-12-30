const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const User = require('../models/user.model');

const PLAN_LIMITS = {
    host: 50,
    manager: 200,
    director: 500,
    trial: 10
};

exports.handleWebhook = async (req, res) => {
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
};

async function handleCheckoutCompleted(session) {
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
}

async function handleCheckoutExpired(session) {
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
}

async function handleSubscriptionUpdated(subscription) {
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
}

async function handleSubscriptionDeleted(subscription) {
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
}

async function handleTrialEnding(subscription) {
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
}

async function handlePaymentFailed(invoice) {
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
}

async function handlePaymentActionRequired(invoice) {
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

module.exports = {
    handleWebhook,
    handleCheckoutCompleted,
    handleCheckoutExpired,
    handleSubscriptionUpdated,
    handleSubscriptionDeleted,
    handleTrialEnding,
    handlePaymentFailed,
    handlePaymentActionRequired
};
