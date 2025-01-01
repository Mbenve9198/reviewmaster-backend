const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const User = require('../models/user.model');

function getCreditsForPlan(plan) {
  const credits = {
    'trial': 10,
    'host': 20,
    'manager': 200,
    'director': 500
  }
  return credits[plan] || 0
}

function getHotelsLimitForPlan(plan) {
  const limits = {
    'trial': 1,
    'host': 2,
    'manager': 5,
    'director': 15
  }
  return limits[plan] || 0
}

// Nuova funzione per calcolare la prossima data di reset
function calculateNextResetDate(currentDate = new Date()) {
  return new Date(
    currentDate.getFullYear(),
    currentDate.getMonth() + 1,
    currentDate.getDate()
  );
}

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
    console.log('Webhook payload:', JSON.stringify(event.data.object, null, 2));

    switch (event.type) {
      case 'checkout.session.completed':
        const session = event.data.object;
        await updateUserSubscription(session);
        break;

      case 'customer.subscription.updated':
        const subscription = event.data.object;
        await handleSubscriptionUpdate(subscription);
        break;

      case 'customer.subscription.deleted':
        const deletedSubscription = event.data.object;
        await handleSubscriptionCancellation(deletedSubscription);
        break;

      case 'invoice.payment_succeeded':
        const successfulInvoice = event.data.object;
        await handleSuccessfulPayment(successfulInvoice);
        break;

      case 'invoice.payment_failed':
        const invoice = event.data.object;
        await handleFailedPayment(invoice);
        break;
    }

    res.json({ received: true });
  } catch (err) {
    console.error('Error processing webhook:', err);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
};

async function updateUserSubscription(session) {
  const userId = session.client_reference_id;

  const user = await User.findByIdAndUpdate(
    userId,
    {
      'subscription.stripeCustomerId': session.customer,
      'subscription.plan': 'host',
      'subscription.status': 'active',
      'subscription.responseCredits': getCreditsForPlan('host'),
      'subscription.hotelsLimit': getHotelsLimitForPlan('host'),
      'subscription.nextResetDate': calculateNextResetDate()
    },
    { new: true }
  );

  if (!user) {
    throw new Error('User not found');
  }
}

async function handleSubscriptionUpdate(subscription) {
  const userId = subscription.metadata.user_id;

  const user = await User.findByIdAndUpdate(
    userId,
    {
      'subscription.status': subscription.status
    },
    { new: true }
  );

  if (!user) {
    throw new Error('User not found');
  }
}

async function handleSuccessfulPayment(invoice) {
  const customerId = invoice.customer;
  
  // Quando il pagamento va a buon fine, resettiamo i crediti e aggiorniamo la data del prossimo reset
  const user = await User.findOne({ 'subscription.stripeCustomerId': customerId });
  
  if (!user) {
    throw new Error('User not found');
  }

  // Reset dei crediti e aggiornamento data
  await user.resetCredits();
}

async function handleSubscriptionCancellation(subscription) {
  const customerId = subscription.customer;

  const user = await User.findOneAndUpdate(
    { 'subscription.stripeCustomerId': customerId },
    {
      'subscription.status': 'canceled',
      'subscription.plan': 'trial',
      'subscription.responseCredits': getCreditsForPlan('trial'),
      'subscription.hotelsLimit': getHotelsLimitForPlan('trial'),
      'subscription.nextResetDate': calculateNextResetDate()
    },
    { new: true }
  );

  if (!user) {
    throw new Error('User not found');
  }
}

async function handleFailedPayment(invoice) {
  const customerId = invoice.customer;

  const user = await User.findOneAndUpdate(
    { 'subscription.stripeCustomerId': customerId },
    {
      'subscription.status': 'past_due',
      'subscription.responseCredits': 0
    },
    { new: true }
  );

  if (!user) {
    throw new Error('User not found');
  }
}
