const express = require('express');
const router = express.Router();
const userController = require('../controllers/user.controller');
const authMiddleware = require('../middleware/auth.middleware');
const User = require('../models/user.model');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// Proteggi la rotta con il middleware di autenticazione
router.get('/stats', authMiddleware, userController.getStats);

// Endpoint per il portale Stripe
router.post('/create-portal-session', authMiddleware, async (req, res) => {
  try {
    console.log('Creating portal session for user:', req.userId);
    
    const user = await User.findById(req.userId);
    console.log('User found:', {
      id: user._id,
      email: user.email,
      stripeCustomerId: user.subscription?.stripeCustomerId
    });
    
    if (!user.subscription?.stripeCustomerId) {
      console.log('No Stripe customer ID found for user');
      return res.status(400).json({ message: 'No Stripe customer found' });
    }

    // Assicuriamoci che l'URL di ritorno sia completo
    const returnUrl = `${process.env.FRONTEND_URL}/billing`;
    console.log('Return URL:', returnUrl);

    console.log('Creating Stripe portal session...');
    const session = await stripe.billingPortal.sessions.create({
      customer: user.subscription.stripeCustomerId,
      return_url: returnUrl
    });
    console.log('Portal session created:', session.url);

    res.json({ url: session.url });
  } catch (error) {
    console.error('Error creating portal session:', {
      message: error.message,
      stack: error.stack
    });
    res.status(500).json({ 
      message: 'Error creating portal session',
      error: error.message 
    });
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
