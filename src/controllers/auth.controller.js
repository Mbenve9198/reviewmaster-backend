const User = require('../models/user.model');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const Hotel = require('../models/hotel.model');
const verificationController = require('./verification.controller');

const authController = {
    // Registrazione nuovo utente
    register: async (req, res) => {
        try {
            const { email, password, name } = req.body;
            console.log('Registering user:', { email, name });

            // Verifica se l'utente esiste già
            const existingUser = await User.findOne({ email });
            if (existingUser) {
                return res.status(400).json({ message: 'Email already registered' });
            }

            // Hash della password
            const hashedPassword = await bcrypt.hash(password, 10);

            // Crea nuovo utente
            const user = new User({
                email,
                password: hashedPassword,
                name,
                isVerified: false,
                subscription: {
                    plan: 'trial',
                    status: 'active',
                    responseCredits: 10,
                    hotelsLimit: 1,
                    responsesLimit: 10,
                    trialEndsAt: new Date(+new Date() + 14 * 24 * 60 * 60 * 1000)
                }
            });

            await user.save();
            console.log('User saved:', user._id);

            // Invia email di verifica
            await verificationController.sendVerificationEmail(user);

            // Restituisci solo un messaggio di successo, senza token
            res.status(201).json({
                message: 'Registration successful. Please check your email to verify your account.'
            });
        } catch (error) {
            console.error('Registration error:', error);
            res.status(500).json({ message: 'Error creating user', error: error.message });
        }
    },

    // Login utente
    login: async (req, res) => {
        try {
            const { email, password } = req.body;
            
            // Trova l'utente
            const user = await User.findOne({ email });
            if (!user) {
                return res.status(401).json({ message: 'Invalid credentials' });
            }

            // Verifica la password
            const isValidPassword = await bcrypt.compare(password, user.password);
            if (!isValidPassword) {
                return res.status(401).json({ message: 'Invalid credentials' });
            }

            // Se l'utente non è verificato, invia un codice specifico
            if (!user.isVerified) {
                // Invia nuovamente l'email di verifica
                await verificationController.sendVerificationEmail(user);
                
                return res.status(403).json({ 
                    message: 'Please verify your email before logging in. A new verification email has been sent.',
                    code: 'EMAIL_NOT_VERIFIED'
                });
            }

            // Genera il token
            const token = jwt.sign(
                { userId: user._id },
                process.env.JWT_SECRET,
                { expiresIn: '24h' }
            );

            // Log per debug
            console.log('Generated token:', token);
            console.log('User ID:', user._id);

            // Invia la risposta
            res.json({
                token,
                user: {
                    id: user._id,
                    email: user.email,
                    name: user.name,
                    isVerified: user.isVerified
                }
            });
        } catch (error) {
            console.error('Login error:', error);
            res.status(500).json({ message: 'Internal server error' });
        }
    },

    // Ottieni profilo utente
    getProfile: async (req, res) => {
        try {
            const user = await User.findById(req.userId).select('-password');
            if (!user) {
                return res.status(404).json({ message: 'User not found' });
            }
            res.json(user);
        } catch (error) {
            console.error('Get profile error:', error);
            res.status(500).json({ message: 'Error fetching profile' });
        }
    }
};

module.exports = authController;