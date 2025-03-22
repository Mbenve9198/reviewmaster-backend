const User = require('../models/user.model');
const Transaction = require('../models/transaction.model');
const WhatsAppAssistant = require('../models/whatsapp-assistant.model');
const Hotel = require('../models/hotel.model');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const mongoose = require('mongoose');

// Costanti per il consumo di crediti
const CREDIT_COSTS = {
  INBOUND_MESSAGE: 0.5,
  OUTBOUND_MESSAGE: 0.5,
  SCHEDULED_MESSAGE: 1.0
};

/**
 * Verifica se l'hotel ha crediti sufficienti per un'operazione
 * @param {string} hotelId - ID dell'hotel
 * @param {string} operationType - Tipo di operazione (inbound, outbound, scheduled)
 * @returns {Promise<{hasCredits: boolean, credits: number, lowBalance: boolean}>}
 */
const checkCredits = async (hotelId) => {
  try {
    // Trova l'hotel e il suo utente
    const hotel = await Hotel.findById(hotelId);
    if (!hotel) {
      throw new Error('Hotel not found');
    }

    const user = await User.findById(hotel.userId);
    if (!user) {
      throw new Error('User not found');
    }

    // Calcola i crediti disponibili
    const availableCredits = user.wallet?.credits || 0;
    const freeCredits = Math.max(0, 1000 - (user.wallet?.freeScrapingUsed || 0));
    const totalCredits = availableCredits + freeCredits;

    // Determina se i crediti sono bassi (sotto la soglia minima)
    const assistant = await WhatsAppAssistant.findOne({ hotelId });
    const minimumThreshold = assistant?.creditSettings?.minimumThreshold || 50;
    const lowBalance = totalCredits < minimumThreshold;

    return {
      hasCredits: totalCredits > 0,
      credits: totalCredits,
      lowBalance
    };
  } catch (error) {
    console.error('Error checking credits:', error);
    throw error;
  }
};

/**
 * Consuma crediti per un'operazione WhatsApp
 * @param {string} hotelId - ID dell'hotel
 * @param {string} operationType - Tipo di operazione (inbound, outbound, scheduled)
 * @param {string} interactionId - ID dell'interazione WhatsApp
 * @param {string} description - Descrizione dell'operazione
 * @returns {Promise<boolean>} - True se i crediti sono stati consumati, false altrimenti
 */
const consumeCredits = async (hotelId, operationType, interactionId, description) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // Trova l'hotel e il suo utente
    const hotel = await Hotel.findById(hotelId).session(session);
    if (!hotel) {
      throw new Error('Hotel not found');
    }

    const user = await User.findById(hotel.userId).session(session);
    if (!user) {
      throw new Error('User not found');
    }

    // Determina il costo dell'operazione
    let creditCost;
    let actionType;
    
    switch (operationType) {
      case 'inbound':
        creditCost = CREDIT_COSTS.INBOUND_MESSAGE;
        actionType = 'whatsapp_inbound_message';
        break;
      case 'outbound':
        creditCost = CREDIT_COSTS.OUTBOUND_MESSAGE;
        actionType = 'whatsapp_outbound_message';
        break;
      case 'scheduled':
        creditCost = CREDIT_COSTS.SCHEDULED_MESSAGE;
        actionType = 'whatsapp_scheduled_message';
        break;
      default:
        throw new Error(`Unknown operation type: ${operationType}`);
    }

    // Calcola i crediti disponibili
    const availableCredits = user.wallet?.credits || 0;
    const freeCredits = Math.max(0, 1000 - (user.wallet?.freeScrapingUsed || 0));
    const totalCredits = availableCredits + freeCredits;

    // Verifica se ci sono abbastanza crediti
    if (totalCredits < creditCost) {
      await session.abortTransaction();
      session.endSession();
      return false;
    }

    // Determina quanti crediti gratuiti e quanti crediti pagati utilizzare
    const freeCreditsToUse = Math.min(freeCredits, creditCost);
    const paidCreditsToUse = creditCost - freeCreditsToUse;

    // Aggiorna i crediti dell'utente
    if (freeCreditsToUse > 0) {
      await User.findByIdAndUpdate(
        user._id,
        { $inc: { 'wallet.freeScrapingUsed': freeCreditsToUse } },
        { session }
      );
    }

    if (paidCreditsToUse > 0) {
      await User.findByIdAndUpdate(
        user._id,
        { $inc: { 'wallet.credits': -paidCreditsToUse } },
        { session }
      );
    }

    // Crea una transazione per questo consumo
    await Transaction.create(
      [{
        userId: user._id,
        type: 'usage',
        credits: -creditCost,
        description: description || `WhatsApp ${operationType} message`,
        status: 'completed',
        metadata: {
          actionType,
          hotelId,
          whatsappInteractionId: interactionId
        }
      }],
      { session }
    );

    // Verifica se è necessario un top-up automatico
    await checkAndTriggerAutoTopUp(hotelId, user._id, session);

    await session.commitTransaction();
    session.endSession();
    return true;
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.error('Error consuming credits:', error);
    throw error;
  }
};

/**
 * Verifica se è necessario un top-up automatico e lo attiva se necessario
 * @param {string} hotelId - ID dell'hotel
 * @param {string} userId - ID dell'utente
 * @param {mongoose.ClientSession} [session] - Sessione Mongoose esistente (opzionale)
 */
const checkAndTriggerAutoTopUp = async (hotelId, userId, existingSession = null) => {
  const session = existingSession || await mongoose.startSession();
  if (!existingSession) {
    session.startTransaction();
  }

  try {
    // Trova l'assistente WhatsApp dell'hotel
    const assistant = await WhatsAppAssistant.findOne({ hotelId }).session(session);
    if (!assistant || !assistant.creditSettings.autoTopUp) {
      // Auto top-up non attivo per questo hotel
      if (!existingSession) {
        await session.abortTransaction();
        session.endSession();
      }
      return;
    }

    // Trova l'utente
    const user = await User.findById(userId).session(session);
    if (!user) {
      throw new Error('User not found');
    }

    // Calcola i crediti disponibili
    const availableCredits = user.wallet?.credits || 0;
    
    // Verifica se il saldo è sotto la soglia minima
    if (availableCredits >= assistant.creditSettings.minimumThreshold) {
      // Il saldo è sufficiente, non serve top-up
      if (!existingSession) {
        await session.abortTransaction();
        session.endSession();
      }
      return;
    }

    // Verifica se c'è stato un top-up recente (evita multiple richieste in caso di errori)
    const lastAutoTopUp = assistant.creditSettings.lastAutoTopUp;
    const now = new Date();
    if (lastAutoTopUp && (now.getTime() - lastAutoTopUp.getTime() < 24 * 60 * 60 * 1000)) {
      // Top-up effettuato nelle ultime 24 ore, salta
      if (!existingSession) {
        await session.abortTransaction();
        session.endSession();
      }
      return;
    }

    // L'utente ha bisogno di un top-up automatico
    const topUpAmount = assistant.creditSettings.topUpAmount;
    const pricePerCredit = calculatePricePerCredit(topUpAmount);
    const totalPrice = topUpAmount * pricePerCredit;
    const amountInCents = Math.round(totalPrice * 100);

    // Verifica che l'utente abbia un ID cliente Stripe
    if (!user.stripeCustomerId) {
      console.error('User does not have a Stripe customer ID for auto top-up');
      if (!existingSession) {
        await session.abortTransaction();
        session.endSession();
      }
      return;
    }

    try {
      // Crea l'intent di pagamento off-session
      const paymentIntent = await stripe.paymentIntents.create({
        amount: amountInCents,
        currency: 'eur',
        customer: user.stripeCustomerId,
        payment_method_types: ['card'],
        off_session: true,
        confirm: true,
        metadata: {
          userId: userId.toString(),
          hotelId: hotelId.toString(),
          credits: topUpAmount.toString(),
          pricePerCredit: pricePerCredit.toString(),
          autoTopUp: 'true'
        },
      });

      // Crea una transazione in stato pending
      await Transaction.create(
        [{
          userId,
          type: 'purchase',
          credits: topUpAmount,
          amount: totalPrice,
          status: 'pending',
          description: `Auto top-up of ${topUpAmount} credits`,
          metadata: {
            stripePaymentIntentId: paymentIntent.id,
            pricePerCredit,
            actionType: 'whatsapp_auto_topup',
            hotelId
          }
        }],
        { session }
      );

      // Aggiorna la data dell'ultimo top-up
      await WhatsAppAssistant.findOneAndUpdate(
        { hotelId },
        { 'creditSettings.lastAutoTopUp': now },
        { session }
      );

      console.log(`Auto top-up initiated for hotel ${hotelId}, user ${userId}, amount: ${topUpAmount} credits`);
    } catch (stripeError) {
      console.error('Auto top-up payment failed:', stripeError);
      // Non facciamo fallire la transazione principale in caso di errore del top-up
    }

    if (!existingSession) {
      await session.commitTransaction();
      session.endSession();
    }
  } catch (error) {
    if (!existingSession) {
      await session.abortTransaction();
      session.endSession();
    }
    console.error('Error in auto top-up check:', error);
  }
};

/**
 * Calcola il prezzo per credito in base alla quantità
 * @param {number} credits - Numero di crediti
 * @returns {number} - Prezzo per credito
 */
const calculatePricePerCredit = (credits) => {
  if (credits >= 10000) return 0.10;
  if (credits >= 500) return 0.15;
  return 0.30;
};

module.exports = {
  checkCredits,
  consumeCredits,
  checkAndTriggerAutoTopUp,
  CREDIT_COSTS
}; 