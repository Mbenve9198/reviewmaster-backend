const { Resend } = require('resend');
const User = require('../models/user.model');
const paymentFailedEmailTemplate = require('../templates/payment-failed-email');
const paymentSuccessEmailTemplate = require('../templates/payment-success-email');

const resend = new Resend(process.env.RESEND_API_KEY);

const notificationService = {
  /**
   * Invia una notifica email all'utente per informarlo di un pagamento fallito
   * @param {Object} options - Opzioni per l'email
   * @param {string} options.userId - ID dell'utente a cui inviare l'email
   * @param {number} options.amount - Importo del pagamento fallito
   * @param {number} options.credits - Quantità di crediti che dovevano essere acquistati
   * @param {string} options.reason - Motivo del fallimento del pagamento
   * @param {string} options.paymentIntentId - ID del Payment Intent di Stripe
   * @returns {Promise<boolean>} - True se l'email è stata inviata con successo
   */
  sendPaymentFailedEmail: async (options) => {
    try {
      const { userId, amount, credits, reason, paymentIntentId } = options;
      
      // Ottieni le informazioni dell'utente
      const user = await User.findById(userId);
      if (!user || !user.email) {
        console.error('User not found or no email available for payment failed notification', { userId });
        return false;
      }
      
      const userName = user.name || user.email.split('@')[0];
      const dashboardUrl = process.env.FRONTEND_URL;
      
      // Invia l'email usando Resend
      const response = await resend.emails.send({
        from: 'Replai <noreply@replai.app>',
        to: user.email,
        subject: 'Your auto top-up payment has failed',
        html: paymentFailedEmailTemplate(
          userName,
          amount,
          credits,
          dashboardUrl,
          reason
        ),
        tags: [
          {
            name: 'category',
            value: 'payment'
          },
          {
            name: 'event',
            value: 'payment_failed'
          },
          {
            name: 'paymentIntentId',
            value: paymentIntentId
          }
        ]
      });
      
      console.log('Payment failed email sent to user', { 
        userId, 
        email: user.email,
        responseId: response.id
      });
      
      return true;
    } catch (error) {
      console.error('Error sending payment failed email:', error);
      return false;
    }
  },

  /**
   * Invia una notifica email all'utente per informarlo di un pagamento completato con successo
   * @param {Object} options - Opzioni per l'email
   * @param {string} options.userId - ID dell'utente a cui inviare l'email
   * @param {number} options.amount - Importo del pagamento
   * @param {number} options.credits - Quantità di crediti acquistati
   * @param {boolean} options.isAutoTopUp - Se il pagamento era un top-up automatico
   * @param {string} options.paymentIntentId - ID del Payment Intent di Stripe
   * @returns {Promise<boolean>} - True se l'email è stata inviata con successo
   */
  sendPaymentSuccessEmail: async (options) => {
    try {
      const { userId, amount, credits, isAutoTopUp, paymentIntentId } = options;
      
      // Ottieni le informazioni dell'utente
      const user = await User.findById(userId);
      if (!user || !user.email) {
        console.error('User not found or no email available for payment success notification', { userId });
        return false;
      }
      
      const userName = user.name || user.email.split('@')[0];
      const dashboardUrl = process.env.FRONTEND_URL;
      
      // Invia l'email usando Resend
      const response = await resend.emails.send({
        from: 'Replai <noreply@replai.app>',
        to: user.email,
        subject: isAutoTopUp ? 'Your auto top-up was successful' : 'Your payment was successful',
        html: paymentSuccessEmailTemplate(
          userName,
          amount,
          credits,
          dashboardUrl,
          isAutoTopUp
        ),
        tags: [
          {
            name: 'category',
            value: 'payment'
          },
          {
            name: 'event',
            value: 'payment_success'
          },
          {
            name: 'paymentIntentId',
            value: paymentIntentId
          }
        ]
      });
      
      console.log('Payment success email sent to user', { 
        userId, 
        email: user.email,
        responseId: response.id,
        isAutoTopUp
      });
      
      return true;
    } catch (error) {
      console.error('Error sending payment success email:', error);
      return false;
    }
  }
};

module.exports = notificationService; 