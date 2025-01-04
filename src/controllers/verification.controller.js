const { Resend } = require('resend');
const User = require('../models/user.model');
const crypto = require('crypto');
const verificationEmailTemplate = require('../templates/verification-email');

const resend = new Resend(process.env.RESEND_API_KEY);

const verificationController = {
    sendVerificationEmail: async (user) => {
        try {
            const verificationToken = crypto.randomBytes(32).toString('hex');
            const verificationTokenExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 ore

            await User.findByIdAndUpdate(user._id, {
                verificationToken,
                verificationTokenExpires
            });

            const verificationLink = `${process.env.FRONTEND_URL}/verify-email?token=${verificationToken}`;
            
            await resend.emails.send({
                from: 'Replai <noreply@replai.app>',
                to: user.email,
                subject: 'Verify your Replai account',
                html: verificationEmailTemplate(verificationLink)
            });

            return true;
        } catch (error) {
            console.error('Send verification email error:', error);
            return false;
        }
    },

    verifyEmail: async (req, res) => {
        try {
            const { token } = req.body;

            const user = await User.findOne({
                verificationToken: token,
                verificationTokenExpires: { $gt: Date.now() }
            });

            if (!user) {
                return res.status(400).json({
                    message: 'Invalid or expired verification token'
                });
            }

            user.isVerified = true;
            user.verificationToken = undefined;
            user.verificationTokenExpires = undefined;
            await user.save();

            res.json({ message: 'Email verified successfully' });
        } catch (error) {
            console.error('Email verification error:', error);
            res.status(500).json({ message: 'Error verifying email' });
        }
    }
};

module.exports = verificationController;