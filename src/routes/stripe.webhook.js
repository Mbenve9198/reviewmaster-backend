const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const axios = require('axios');

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

  try {
    await axios.put(`${process.env.NEXT_PUBLIC_API_URL}/api/users/subscription`, {
      stripeCustomerId: customerId,
      plan: plan,
      status: 'active'
    });
  } catch (error) {
    console.error('Error updating subscription:', error);
    throw error;
  }
}

async function handleSubscriptionUpdate(subscription) {
  const customerId = subscription.customer;
  const status = subscription.status;

  try {
    await axios.put(`${process.env.NEXT_PUBLIC_API_URL}/api/users/subscription`, {
      stripeCustomerId: customerId,
      status: status
    });
  } catch (error) {
    console.error('Error updating subscription status:', error);
    throw error;
  }
}

async function handleSubscriptionCancellation(subscription) {
  const customerId = subscription.customer;

  try {
    await axios.put(`${process.env.NEXT_PUBLIC_API_URL}/api/users/subscription`, {
      stripeCustomerId: customerId,
      status: 'canceled',
      plan: 'trial'
    });
  } catch (error) {
    console.error('Error cancelling subscription:', error);
    throw error;
  }
}
