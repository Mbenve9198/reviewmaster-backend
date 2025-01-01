const express = require('express');
const router = express.Router();
const userController = require('../controllers/user.controller');
const authMiddleware = require('../middleware/auth.middleware');
const User = require('../models/user.model');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// Proteggi la rotta con il middleware di autenticazione
router.get('/stats', authMiddleware, userController.getStats);

// Nuovo endpoint per il portale Stripe
router.post('/create-portal-session', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    
    if (!user.subscription.stripeCustomerId) {
      return res.status(400).json({ message: 'No Stripe customer found' });
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: user.subscription.stripeCustomerId,
      return_url: `${process.env.FRONTEND_URL}/billing`,
    });

    res.json({ url: session.url });
  } catch (error) {
    console.error('Error creating portal session:', error);
    res.status(500).json({ message: 'Error creating portal session' });
  }
});

router.put('/subscription', async (req, res) => {
  try {
    const { stripeCustomerId, plan, status } = req.body

    const user = await User.findOneAndUpdate(
      { 'subscription.stripeCustomerId': stripeCustomerId },
      {
        'subscription.plan': plan,
        'subscription.status': status,
        'subscription.responseCredits': getCreditsForPlan(plan),
        'subscription.hotelsLimit': getHotelsLimitForPlan(plan)
      },
      { new: true }
    )

    if (!user) {
      return res.status(404).json({ message: 'User not found' })
    }

    res.json(user)
  } catch (error) {
    console.error('Update subscription error:', error)
    res.status(500).json({ message: 'Error updating subscription' })
  }
})

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

module.exports = router;
