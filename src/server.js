const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
require('dotenv').config();

const { setupSyncJobs } = require('./jobs/sync.job');
const authMiddleware = require('./middleware/auth.middleware');
const checkEmailVerification = require('./middleware/verification.middleware');
const authRoutes = require('./routes/auth.routes');
const hotelRoutes = require('./routes/hotel.routes');
const reviewRoutes = require('./routes/review.routes');
const userRoutes = require('./routes/user.routes');
const integrationRoutes = require('./routes/integration.routes');
const analyticsRoutes = require('./routes/analytics.routes');
const walletRoutes = require('./routes/wallet.routes');
const bookRoutes = require('./routes/book.routes');
const checkCredits = require('./middleware/credits.middleware');
const ruleRoutes = require('./routes/rule.routes');
const whatsappAssistantRoutes = require('./routes/whatsapp-assistant.routes');
const whatsappAssistantController = require('./controllers/whatsapp-assistant.controller');

const app = express();

// Configurazione del body parser PRIMA delle routes
app.use(express.json({
    limit: '10mb',  // Aumentato a 10MB per gestire grandi batch di recensioni
    verify: (req, res, buf) => {
        // Log della dimensione del payload per monitoraggio
        const payloadSize = Buffer.byteLength(buf);
        if (payloadSize > 1024 * 1024) { // Se più di 1MB
            console.log(`Large payload received: ${(payloadSize / (1024 * 1024)).toFixed(2)}MB`);
        }
    }
}));
app.use(express.urlencoded({ 
    extended: true,
    limit: '10mb'  // Stesso limite per dati urlencoded
}));

// Logging middleware
app.use((req, res, next) => {
    const timestamp = new Date().toISOString();
    console.log(`${timestamp} - ${req.method} ${req.originalUrl}`);
    if (req.originalUrl !== '/api/webhook/stripe') {
        console.log('Request Body:', req.body);
    }
    next();
});

// Security middlewares
app.use(helmet());

// Configurazione CORS aggiornata
const corsOptions = {
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
};

// Applica CORS a tutte le route
app.use(cors(corsOptions));

// Gestione esplicita delle richieste OPTIONS per tutte le route
app.options('*', cors(corsOptions));

// Middleware specifico per il webhook di Stripe
app.use('/api/webhook/stripe', express.raw({ type: 'application/json' }));

// Health check
app.get('/', (req, res) => {
    res.json({ message: 'ReviewMaster API is running' });
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/hotels', authMiddleware, checkEmailVerification, hotelRoutes);
app.use('/api/reviews', authMiddleware, checkCredits, reviewRoutes);
app.use('/api/users', authMiddleware, checkEmailVerification, userRoutes);
app.use('/api/integrations', authMiddleware, checkCredits, integrationRoutes);
app.use('/api/analytics', authMiddleware, checkCredits, analyticsRoutes);
app.use('/api/wallet', authMiddleware, walletRoutes);
app.use('/api/books', authMiddleware, bookRoutes);
app.use('/api/rules', authMiddleware, checkCredits, ruleRoutes);

// WhatsApp Assistant routes - alcune route non richiedono autenticazione
app.use('/api/whatsapp-assistant', whatsappAssistantRoutes);

// Aggiungi una route specifica per il redirect che sia accessibile pubblicamente
app.get('/api/redirect/review', whatsappAssistantController.handleReviewRedirect);

// Stripe webhook route
app.post('/api/webhook/stripe', require('./routes/stripe.webhook'));

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Error details:', {
        message: err.message,
        stack: err.stack,
        details: err.errors || {}
    });
    
    // Se è un errore CORS, invia una risposta appropriata
    if (err.name === 'CORSError') {
        return res.status(405).json({
            message: 'CORS error: Method not allowed',
            error: process.env.NODE_ENV === 'development' ? err : {}
        });
    }
    
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
        
        setupSyncJobs();
        console.log('Review sync jobs initialized');
        
        const PORT = process.env.PORT || 3000;
        app.listen(PORT, () => {
            console.log(`Server running on port ${PORT}`);
        });
    })
    .catch(err => {
        console.error('MongoDB connection error:', err);
        process.exit(1);
    });
