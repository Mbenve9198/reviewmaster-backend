const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const mongoose = require('mongoose');
require('dotenv').config();

const { setupCreditsResetJob } = require('./jobs/credits-reset.job');
const authMiddleware = require('./middleware/auth.middleware');
const checkEmailVerification = require('./middleware/verification.middleware');
const authRoutes = require('./routes/auth.routes');
const hotelRoutes = require('./routes/hotel.routes');
const reviewRoutes = require('./routes/review.routes');
const userRoutes = require('./routes/user.routes');
const integrationRoutes = require('./routes/integration.routes');
const analyticsRoutes = require('./routes/analytics.routes');

const app = express();

// Logging middleware
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
    console.log('Request Body:', req.body);
    next();
});

// Security middlewares
app.use(helmet());

// Configurazione CORS aggiornata
app.use(cors({
    origin: [
        'http://localhost:3000',
        'http://localhost:3001',
        'https://replai.app',
        'https://www.replai.app'
    ],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'stripe-signature'],
    exposedHeaders: ['Authorization'],
    preflightContinue: false,
    optionsSuccessStatus: 204
}));

// Gestione esplicita delle richieste OPTIONS
app.options('*', cors());

// Middleware specifico per il webhook di Stripe
app.use('/api/webhook/stripe', express.raw({ type: 'application/json' }));

// Standard middlewares
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check
app.get('/', (req, res) => {
    res.json({ message: 'ReviewMaster API is running' });
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/hotels', authMiddleware, checkEmailVerification, hotelRoutes);
app.use('/api/reviews', authMiddleware, checkEmailVerification, reviewRoutes);
app.use('/api/users', authMiddleware, checkEmailVerification, userRoutes);
app.use('/api/integrations', authMiddleware, checkEmailVerification, integrationRoutes);
app.use('/api/analytics', authMiddleware, checkEmailVerification, analyticsRoutes);

// Stripe webhook route
app.post('/api/webhook/stripe', require('./routes/stripe.webhook'));

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Error details:', {
        message: err.message,
        stack: err.stack,
        details: err.errors || {}
    });
    
    res.status(err.status || 500).json({
        message: err.message || 'Something went wrong!',
        error: process.env.NODE_ENV === 'development' ? err : {},
        details: err.errors
    });
});

// Database connection
mongoose.connect(process.env.MONGODB_URI)
    .then(() => {
        console.log('Connected to MongoDB');
        
        // Inizializza il cron job dopo la connessione al database
        setupCreditsResetJob();
        console.log('Credits reset job initialized');
        
        const PORT = process.env.PORT || 3000;
        app.listen(PORT, () => {
            console.log(`Server running on port ${PORT}`);
        });
    })
    .catch(err => {
        console.error('MongoDB connection error:', err);
        process.exit(1);
    });
