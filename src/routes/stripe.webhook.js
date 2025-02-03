const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const User = require('../models/user.model');
const Transaction = require('../models/transaction.model');
const mongoose = require('mongoose');

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
                await handlePaymentFailed(event.data.object);
                break;
        }

        res.json({ received: true });
    } catch (err) {
        console.error('Error processing webhook:', err);
        res.status(500).json({ error: 'Webhook processing failed' });
    }
};

async function handleSuccessfulPayment(paymentIntent) {
    const userId = paymentIntent.metadata.userId;
    const credits = parseInt(paymentIntent.metadata.credits, 10);
    const pricePerCredit = parseFloat(paymentIntent.metadata.pricePerCredit);

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        // Verifica se esiste già una transazione completata per questo payment intent
        const existingTransaction = await Transaction.findOne({
            'metadata.stripePaymentIntentId': paymentIntent.id,
            status: 'completed'
        });

        if (existingTransaction) {
            console.log('Transaction already processed:', paymentIntent.id);
            return;
        }

        // Aggiorna lo stato della transazione
        const transaction = await Transaction.findOneAndUpdate(
            { 
                'metadata.stripePaymentIntentId': paymentIntent.id,
                status: 'pending'
            },
            { 
                status: 'completed',
                completedAt: new Date()
            },
            { 
                session,
                new: true
            }
        );

        if (!transaction) {
            throw new Error('Transaction not found or already processed');
        }

        // Aggiungi i crediti solo quando il pagamento è confermato
        const user = await User.findByIdAndUpdate(
            userId,
            { 
                $inc: { 'wallet.credits': credits },
                $push: { 
                    'wallet.history': {
                        type: 'credit_purchase',
                        amount: credits,
                        pricePerCredit,
                        transactionId: transaction._id
                    }
                }
            },
            { 
                session,
                new: true
            }
        );

        if (!user) {
            throw new Error('User not found');
        }

        await session.commitTransaction();
        console.log(`Successfully processed payment for user ${userId}: ${credits} credits added`);
    } catch (error) {
        await session.abortTransaction();
        console.error('Payment processing error:', error);
        // Aggiorna lo stato della transazione a failed se c'è un errore
        await Transaction.findOneAndUpdate(
            { 'metadata.stripePaymentIntentId': paymentIntent.id },
            { 
                status: 'failed',
                error: error.message
            }
        );
    } finally {
        session.endSession();
    }
}

async function handlePaymentFailed(paymentIntent) {
    try {
        // Aggiorna lo stato della transazione a failed
        await Transaction.findOneAndUpdate(
            { 'metadata.stripePaymentIntentId': paymentIntent.id },
            { 
                status: 'failed',
                error: paymentIntent.last_payment_error?.message || 'Payment failed',
                updatedAt: new Date()
            }
        );

        console.log(`Payment failed for payment intent ${paymentIntent.id}`);
    } catch (error) {
        console.error('Error handling failed payment:', error);
    }
}