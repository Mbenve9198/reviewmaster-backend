const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const User = require('../models/user.model');
const Transaction = require('../models/transaction.model');

module.exports = async (req, res) => {
    const sig = req.headers['stripe-signature'];
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    let event;

    try {
        event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    } catch (err) {
        console.error('Webhook Error:', err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    try {
        console.log('Webhook event type:', event.type);

        switch (event.type) {
            case 'payment_intent.succeeded':
                await handleSuccessfulPayment(event.data.object);
                break;

            case 'payment_intent.payment_failed':
                await handleFailedPayment(event.data.object);
                break;
        }

        res.json({ received: true });
    } catch (err) {
        console.error('Error processing webhook:', err);
        res.status(500).json({ error: 'Webhook processing failed' });
    }
};

async function handleSuccessfulPayment(paymentIntent) {
    const { userId, credits, pricePerCredit } = paymentIntent.metadata;

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        // Update the transaction status
        await Transaction.findOneAndUpdate(
            { 'metadata.stripePaymentIntentId': paymentIntent.id },
            { status: 'completed' },
            { session }
        );

        // Add credits to user's wallet
        await User.findByIdAndUpdate(
            userId,
            { $inc: { 'wallet.credits': credits } },
            { session }
        );

        await session.commitTransaction();
        
        console.log(`Successfully added ${credits} credits to user ${userId}`);
    } catch (error) {
        await session.abortTransaction();
        throw error;
    } finally {
        session.endSession();
    }
}

async function handleFailedPayment(paymentIntent) {
    try {
        // Update the transaction status to failed
        await Transaction.findOneAndUpdate(
            { 'metadata.stripePaymentIntentId': paymentIntent.id },
            { status: 'failed' }
        );

        console.log(`Payment failed for payment intent ${paymentIntent.id}`);
    } catch (error) {
        console.error('Error handling failed payment:', error);
        throw error;
    }
}