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
  const customerId = session.customer;
  
  const subscription = await stripe.subscriptions.retrieve(session.subscription);
  const priceId = subscription.items.data[0].price.id;

  const planMap = {
    'price_host': 'host',
    'price_manager': 'manager',
    'price_director': 'director'
  };

  const plan = planMap[priceId] || 'trial';

  const user = await User.findOneAndUpdate(
    { 'subscription.stripeCustomerId': customerId },
    {
      'subscription.plan': plan,
      'subscription.status': 'active',
      'subscription.responseCredits': getCreditsForPlan(plan),
      'subscription.hotelsLimit': getHotelsLimitForPlan(plan)
    },
    { new: true }
  );

  if (!user) {
    throw new Error('User not found');
  }
}

async function handleSubscriptionUpdate(subscription) {
  const customerId = subscription.customer;
  const status = subscription.status;

  const user = await User.findOneAndUpdate(
    { 'subscription.stripeCustomerId': customerId },
    {
      'subscription.status': status
    },
    { new: true }
  );

  if (!user) {
    throw new Error('User not found');
  }
}

async function handleSubscriptionCancellation(subscription) {
  const customerId = subscription.customer;

  const user = await User.findOneAndUpdate(
    { 'subscription.stripeCustomerId': customerId },
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
