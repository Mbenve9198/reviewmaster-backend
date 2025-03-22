const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const User = require('../models/user.model');
const Transaction = require('../models/transaction.model');
const mongoose = require('mongoose');
const WhatsAppAssistant = require('../models/whatsapp-assistant.model');

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
    console.log('Processing successful payment:', { // Log 4
        paymentIntentId: paymentIntent.id,
        metadata: paymentIntent.metadata
    });

    const userId = paymentIntent.metadata.userId;
    const credits = parseInt(paymentIntent.metadata.credits, 10);
    const pricePerCredit = parseFloat(paymentIntent.metadata.pricePerCredit);
    const isAutoTopUp = paymentIntent.metadata.autoTopUp === 'true';
    const hotelId = paymentIntent.metadata.hotelId;

    console.log('Parsed payment values:', { // Log 5
        userId,
        credits,
        pricePerCredit,
        isAutoTopUp,
        hotelId
    });

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
            await session.abortTransaction();
            session.endSession();
            return; // Importante: esce dalla funzione se la transazione è già stata processata
        }

        // Trova informazioni dell'utente per ottenere il suo customer ID
        const user = await User.findById(userId);
        
        if (user && user.stripeCustomerId && paymentIntent.payment_method) {
            try {
                // Salva questo metodo di pagamento come predefinito per il cliente
                console.log(`Attaching payment method ${paymentIntent.payment_method} to customer ${user.stripeCustomerId}`);
                
                await stripe.paymentMethods.attach(
                    paymentIntent.payment_method,
                    { customer: user.stripeCustomerId }
                );
                
                await stripe.customers.update(
                    user.stripeCustomerId,
                    { invoice_settings: { default_payment_method: paymentIntent.payment_method } }
                );
                
                console.log(`Metodo di pagamento impostato come predefinito per l'utente ${userId}`);
            } catch (err) {
                console.error('Error saving payment method:', err);
                // Continuiamo con la transazione anche se fallisce il salvataggio del metodo
            }
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
        const userUpdated = await User.findByIdAndUpdate(
            userId,
            { 
                $inc: { 'wallet.credits': credits },
                $push: { 
                    'wallet.history': {
                        type: 'credit_purchase',
                        amount: credits,
                        pricePerCredit,
                        transactionId: transaction._id,
                        isAutoTopUp
                    }
                }
            },
            { 
                session,
                new: true
            }
        );

        if (!userUpdated) {
            throw new Error('User not found');
        }

        // Se è un pagamento auto top-up, aggiorna la data dell'ultimo top-up nell'assistente
        if (isAutoTopUp && hotelId) {
            await WhatsAppAssistant.findOneAndUpdate(
                { hotelId },
                { 'creditSettings.lastAutoTopUp': new Date() },
                { session }
            );
        }

        await session.commitTransaction();
        console.log(`Successfully processed payment for user ${userId}: ${credits} credits added${isAutoTopUp ? ' (auto top-up)' : ''}`);
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