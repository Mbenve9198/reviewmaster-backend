const User = require('../models/user.model');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const Hotel = require('../models/hotel.model');
const verificationController = require('./verification.controller');
const crypto = require('crypto');
const { Resend } = require('resend');
const resetPasswordEmailTemplate = require('../templates/reset-password-email');

const resend = new Resend(process.env.RESEND_API_KEY);

// Funzione per inviare email di notifica agli amministratori
const sendAdminNotificationEmail = async (user) => {
    try {
        await resend.emails.send({
            from: 'Replai <noreply@replai.app>',
            to: ['marco@midachat.com', 'federico@midachat.com'],
            subject: 'New User Registration on Replai',
            html: `
                <div style="font-family: Arial, sans-serif; padding: 20px; max-width: 600px;">
                    <h2>New User Registration</h2>
                    <p>A new user has registered on Replai:</p>
                    <ul>
                        <li><strong>Email:</strong> ${user.email}</li>
                        <li><strong>Name:</strong> ${user.name}</li>
                        <li><strong>Company:</strong> ${user.companyName || 'Not provided'}</li>
                        <li><strong>Phone:</strong> ${user.phoneNumber || 'Not provided'}</li>
                        <li><strong>Registration Time:</strong> ${new Date().toISOString()}</li>
                    </ul>
                    <p>You might want to reach out to welcome them to the platform.</p>
                </div>
            `
        });
        console.log('Admin notification email sent successfully');
    } catch (error) {
        console.error('Error sending admin notification email:', error);
        // Non interrompiamo il flusso di registrazione se la notifica fallisce
    }
};

const authController = {
    // Registrazione nuovo utente
    register: async (req, res) => {
        try {
            const { email, password, name, phoneNumber, companyName } = req.body;
            console.log('Registering user:', { email, name, companyName });

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
                phoneNumber,
                companyName,
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
            
            // Invia email di notifica agli amministratori
            await sendAdminNotificationEmail(user);

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
    },

    // Richiesta reset password
    requestPasswordReset: async (req, res) => {
        try {
            console.log('Reset password request received:', req.body);
            const { email } = req.body;
            
            if (!email) {
                console.log('No email provided in request');
                return res.status(400).json({ 
                    message: 'Email is required' 
                });
            }

            const user = await User.findOne({ email });
            console.log('User found:', user ? 'yes' : 'no');
            
            if (!user) {
                return res.status(200).json({ 
                    message: 'If an account exists with this email, you will receive a password reset link.' 
                });
            }

            // Genera token di reset
            const resetToken = crypto.randomBytes(32).toString('hex');
            const resetTokenExpiry = Date.now() + 3600000; // 1 ora

            user.resetPasswordToken = resetToken;
            user.resetPasswordExpires = resetTokenExpiry;
            await user.save();

            // Rimuoviamo eventuali slash finali dal FRONTEND_URL
            const frontendUrl = (process.env.FRONTEND_URL || 'https://replai.app').replace(/\/+$/, '');
            const resetLink = `${frontendUrl}/reset-password?token=${resetToken}`;
            
            console.log('Generated reset link:', resetLink);

            console.log('Attempting to send reset email to:', email);
            // Invia email usando Resend
            try {
                await resend.emails.send({
                    from: 'Replai <noreply@replai.app>',
                    to: user.email,
                    subject: 'Reset your Replai password',
                    html: resetPasswordEmailTemplate(resetLink)
                });
                console.log('Reset email sent successfully');
            } catch (emailError) {
                console.error('Error sending reset email:', emailError);
                throw emailError;
            }

            res.json({ 
                message: 'If an account exists with this email, you will receive a password reset link.' 
            });
        } catch (error) {
            console.error('Password reset request error:', error);
            res.status(500).json({ 
                message: 'Error processing password reset request',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    },

    // Reset password
    resetPassword: async (req, res) => {
        try {
            console.log('Reset password request received:', req.body);
            const { token, newPassword } = req.body;
            
            if (!token || !newPassword) {
                console.log('Missing required fields:', { token: !!token, newPassword: !!newPassword });
                return res.status(400).json({ message: 'Token and new password are required' });
            }

            // Aggiungiamo più logging per il debug
            console.log('Looking for user with token:', token);
            const user = await User.findOne({
                resetPasswordToken: token,
                resetPasswordExpires: { $gt: Date.now() }
            }).select('+resetPasswordToken +resetPasswordExpires');

            if (!user) {
                // Log per capire perché non troviamo l'utente
                const expiredUser = await User.findOne({ resetPasswordToken: token });
                if (expiredUser) {
                    console.log('Token found but expired. Expiry:', expiredUser.resetPasswordExpires, 'Current:', Date.now());
                    return res.status(400).json({ message: 'Reset token has expired. Please request a new one.' });
                } else {
                    console.log('No user found with this token');
                    return res.status(400).json({ message: 'Invalid reset token. Please request a new password reset.' });
                }
            }

            console.log('User found, updating password for user:', user.email);
            const hashedPassword = await bcrypt.hash(newPassword, 10);
            
            user.password = hashedPassword;
            user.resetPasswordToken = undefined;
            user.resetPasswordExpires = undefined;
            await user.save();
            console.log('Password updated successfully');

            res.json({ message: 'Password reset successful. Please login with your new password.' });
        } catch (error) {
            console.error('Password reset error:', error);
            res.status(500).json({ message: 'Error resetting password. Please try again.' });
        }
    }
};

module.exports = authController;