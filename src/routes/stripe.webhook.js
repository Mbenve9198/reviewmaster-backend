const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const User = require('../models/user.model');

function getCreditsForPlan(plan) {
  const credits = {
    'trial': 3,
    'host': 20,
    'manager': 80,
    'director': 500
  }
  return credits[plan] || 0
}

function getHotelsLimitForPlan(plan) {
  const limits = {
    'trial': 1,
    'host': 1,
    'manager': 5,
    'director': 15
  }
  return limits[plan] || 0
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
      'subscription.plan': 'host', // Aggiusta in base al prezzo
      'subscription.status': 'active',
      'subscription.responseCredits': getCreditsForPlan('host'),  // Aggiusta in base al prezzo
      'subscription.hotelsLimit': getHotelsLimitForPlan('host')   // Aggiusta in base al prezzo
    },
    { new: true }
  );

  if (!user) {
    throw new Error('User not found');
  }
}

async function handleSubscriptionUpdate(subscription) {
  console.log('Subscription metadata:', subscription.metadata);
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

async function handleSubscriptionCancellation(subscription) {
  console.log('Subscription metadata:', subscription.metadata);
  const userId = subscription.metadata.user_id;

  const user = await User.findByIdAndUpdate(
    userId,
    {
      'subscription.status': 'canceled',
      'subscription.plan': 'trial',
      'subscription.responseCredits': getCreditsForPlan('trial'),
      'subscription.hotelsLimit': getHotelsLimitForPlan('trial')
    },
    { new: true }
  );

  if (!user) {
    throw new Error('User not found');
  }
}
