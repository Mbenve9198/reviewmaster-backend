const User = require('../models/user.model');
const Transaction = require('../models/transaction.model');
const WhatsAppAssistant = require('../models/whatsapp-assistant.model');
const Hotel = require('../models/hotel.model');
const AppSettings = require('../models/app-settings.model');
const UserCreditSettings = require('../models/user-credit-settings.model');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const mongoose = require('mongoose');

// Valori di default che saranno sostituiti dai valori caricati dal database
let CREDIT_COSTS = {
  INBOUND_MESSAGE: 0.5,
  OUTBOUND_MESSAGE: 0.5,
  SCHEDULED_MESSAGE: 1.0,
  REVIEW_RESPONSE: 2.0,
  REVIEW_ANALYSIS: 1.0
};

let INITIAL_FREE_CREDITS = 50; // Valore predefinito di 50 crediti gratuiti

/**
 * Carica le impostazioni dal database
 */
const loadSettings = async () => {
  try {
    console.log('Caricamento impostazioni applicazione...');
    const settings = await AppSettings.getGlobalSettings();
    
    if (settings && settings.credits) {
      INITIAL_FREE_CREDITS = settings.credits.initialFreeCredits || INITIAL_FREE_CREDITS;
      
      // Aggiorna i costi delle operazioni se presenti nelle impostazioni
      if (settings.credits.costs) {
        CREDIT_COSTS.INBOUND_MESSAGE = settings.credits.costs.inboundMessage || CREDIT_COSTS.INBOUND_MESSAGE;
        CREDIT_COSTS.OUTBOUND_MESSAGE = settings.credits.costs.outboundMessage || CREDIT_COSTS.OUTBOUND_MESSAGE;
        CREDIT_COSTS.SCHEDULED_MESSAGE = settings.credits.costs.scheduledMessage || CREDIT_COSTS.SCHEDULED_MESSAGE;
        CREDIT_COSTS.REVIEW_RESPONSE = settings.credits.costs.reviewResponse || CREDIT_COSTS.REVIEW_RESPONSE;
        CREDIT_COSTS.REVIEW_ANALYSIS = settings.credits.costs.reviewAnalysis || CREDIT_COSTS.REVIEW_ANALYSIS;
      }
      
      console.log(`Impostazioni caricate: ${INITIAL_FREE_CREDITS} crediti gratuiti iniziali`);
      console.log('Costi operazioni:', CREDIT_COSTS);
    }
  } catch (error) {
    console.error('Errore nel caricamento delle impostazioni:', error);
    // Mantieni i valori di default in caso di errore
  }
};

// Carica le impostazioni all'avvio del servizio
loadSettings();

/**
 * Restituisce il valore attuale dei crediti gratuiti iniziali
 * @returns {number} - Il valore dei crediti gratuiti iniziali
 */
const getInitialFreeCredits = () => {
  return INITIAL_FREE_CREDITS;
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
    const freeCredits = Math.max(0, INITIAL_FREE_CREDITS - (user.wallet?.freeScrapingUsed || 0));
    const totalCredits = availableCredits + freeCredits;

    // Determina se i crediti sono bassi utilizzando le impostazioni utente
    const userCreditSettings = await UserCreditSettings.findOne({ userId: user._id });
    const minimumThreshold = userCreditSettings?.minimumThreshold || 50;
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
      case 'review_response':
        creditCost = CREDIT_COSTS.REVIEW_RESPONSE;
        actionType = 'review_response';
        break;
      case 'review_analysis':
        creditCost = CREDIT_COSTS.REVIEW_ANALYSIS;
        actionType = 'review_analysis';
        break;
      default:
        throw new Error(`Unknown operation type: ${operationType}`);
    }

    // Calcola i crediti disponibili
    const availableCredits = user.wallet?.credits || 0;
    const freeCredits = Math.max(0, INITIAL_FREE_CREDITS - (user.wallet?.freeScrapingUsed || 0));
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

    // Log dettagliato dell'addebito
    console.log(`==== DETTAGLIO ADDEBITO CREDITI ====`);
    console.log(`- Utente: ${user._id}`);
    console.log(`- Hotel: ${hotelId}`);
    console.log(`- Operazione: ${operationType}`);
    console.log(`- Costo totale: ${creditCost} crediti`);
    console.log(`- Crediti gratuiti utilizzati: ${freeCreditsToUse}`);
    console.log(`- Crediti pagati utilizzati: ${paidCreditsToUse}`);
    console.log(`- Crediti rimanenti: ${(user.wallet?.credits || 0) - paidCreditsToUse}`);
    console.log(`- Crediti gratuiti rimanenti: ${Math.max(0, INITIAL_FREE_CREDITS - (user.wallet?.freeScrapingUsed || 0) - freeCreditsToUse)}`);

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

    // Verifica che l'operazione sia andata a buon fine
    const updatedUser = await User.findById(user._id).session(session);
    if (!updatedUser) {
      console.error('Errore: impossibile verificare l\'aggiornamento dell\'utente');
      throw new Error('Failed to update user credits');
    }

    // Verifica che i crediti siano stati effettivamente sottratti
    const expectedCredits = (user.wallet?.credits || 0) - paidCreditsToUse;
    if (updatedUser.wallet?.credits !== expectedCredits) {
      console.error('Errore: i crediti non sono stati aggiornati correttamente');
      console.error(`- Crediti attesi: ${expectedCredits}`);
      console.error(`- Crediti effettivi: ${updatedUser.wallet?.credits}`);
      throw new Error('Credit deduction verification failed');
    }

    console.log(`Addebito crediti completato con successo per l'utente ${user._id}`);

    // Conferma la transazione di crediti prima
    await session.commitTransaction();
    session.endSession();

    // MODIFICA: Gestisci l'auto top-up in modo completamente asincrono
    // Questo garantisce che l'operazione principale non sia influenzata da eventuali errori dell'auto top-up
    try {
      // Avvia il controllo dell'auto top-up in background, senza attenderne il completamento
      checkAndTriggerAutoTopUp(hotelId, user._id)
        .catch(error => {
          // Log dell'errore senza interrompere il flusso principale
          console.error('Auto top-up background error:', error.message);
        });
    } catch (autoTopUpError) {
      // In caso di errori, li registriamo senza impattare l'operazione principale
      console.error('Error scheduling auto top-up check:', autoTopUpError);
    }

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
  // Se viene passata una sessione esistente, usala, altrimenti crea una nuova sessione
  let session;
  let ownSession = false;
  
  try {
    if (existingSession) {
      session = existingSession;
    } else {
      session = await mongoose.startSession();
      session.startTransaction();
      ownSession = true;
    }

    // Usa solo le impostazioni utente per il top-up automatico
    const userCreditSettings = await UserCreditSettings.findOne({ userId }).session(session);
    
    // Se l'utente non ha impostazioni o non ha attivato l'auto top-up, esci
    if (!userCreditSettings || !userCreditSettings.autoTopUp) {
      if (ownSession) {
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
    if (availableCredits >= userCreditSettings.minimumThreshold) {
      // Il saldo è sufficiente, non serve top-up
      if (ownSession) {
        await session.abortTransaction();
        session.endSession();
      }
      return;
    }

    // Verifica se c'è stato un top-up recente (evita multiple richieste in caso di errori)
    const lastAutoTopUp = userCreditSettings.lastAutoTopUp;
    const now = new Date();
    if (lastAutoTopUp && (now.getTime() - lastAutoTopUp.getTime() < 24 * 60 * 60 * 1000)) {
      // Top-up effettuato nelle ultime 24 ore, salta
      if (ownSession) {
        await session.abortTransaction();
        session.endSession();
      }
      return;
    }

    // L'utente ha bisogno di un top-up automatico
    const topUpAmount = userCreditSettings.topUpAmount;
    const pricePerCredit = calculatePricePerCredit(topUpAmount);
    const totalPrice = topUpAmount * pricePerCredit;
    const amountInCents = Math.round(totalPrice * 100);

    // Verifica che l'utente abbia un ID cliente Stripe
    if (!user.stripeCustomerId) {
      console.error('User does not have a Stripe customer ID for auto top-up');
      if (ownSession) {
        await session.abortTransaction();
        session.endSession();
      }
      return;
    }

    try {
      // Ottieni il metodo di pagamento predefinito del cliente
      const customer = await stripe.customers.retrieve(
        user.stripeCustomerId, 
        { expand: ['invoice_settings.default_payment_method'] }
      );
      
      const defaultPaymentMethod = customer?.invoice_settings?.default_payment_method;
      
      if (!defaultPaymentMethod) {
        console.error('User does not have a default payment method for auto top-up');
        if (ownSession) {
          await session.abortTransaction();
          session.endSession();
        }
        return;
      }
      
      console.log(`Utilizzo metodo di pagamento predefinito: ${defaultPaymentMethod.id} per auto top-up`);

      // Crea l'intent di pagamento off-session
      const paymentIntent = await stripe.paymentIntents.create({
        amount: amountInCents,
        currency: 'eur',
        customer: user.stripeCustomerId,
        payment_method: defaultPaymentMethod.id, // Usa il metodo di pagamento predefinito
        off_session: true,
        confirm: true,
        metadata: {
          userId: userId.toString(),
          hotelId: hotelId ? hotelId.toString() : '',
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
            actionType: 'auto_topup',
            hotelId: hotelId || null
          }
        }],
        { session }
      );

      // Aggiorna la data dell'ultimo top-up
      await UserCreditSettings.findOneAndUpdate(
        { userId },
        { lastAutoTopUp: now },
        { session }
      );

      console.log(`Auto top-up initiated for user ${userId}, amount: ${topUpAmount} credits`);
    } catch (stripeError) {
      console.error('Auto top-up payment failed:', stripeError);
      // Registra soltanto l'errore senza far fallire l'operazione principale
    }

    if (ownSession) {
      await session.commitTransaction();
      session.endSession();
    }
  } catch (error) {
    if (ownSession && session) {
      await session.abortTransaction();
      session.endSession();
    }
    console.error('Error in auto top-up check:', error);
    // Propaga l'errore solo se siamo in un metodo indipendente
    throw error;
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
  CREDIT_COSTS,
  getInitialFreeCredits
}; 