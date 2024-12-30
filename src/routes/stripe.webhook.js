const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

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

  await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/users/subscription`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      stripeCustomerId: customerId,
      plan: plan,
      status: 'active'
    })
  });
}

async function handleSubscriptionUpdate(subscription) {
  const customerId = subscription.customer;
  const status = subscription.status;

  await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/users/subscription`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      stripeCustomerId: customerId,
      status: status
    })
  });
}

async function handleSubscriptionCancellation(subscription) {
  const customerId = subscription.customer;

  await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/users/subscription`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      stripeCustomerId: customerId,
      status: 'canceled',
      plan: 'trial'
    })
  });
}