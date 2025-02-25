const WhatsAppAssistant = require('../models/whatsapp-assistant.model');
const WhatsappInteraction = require('../models/whatsapp-interaction.model');
const Hotel = require('../models/hotel.model');
const whatsappAssistantController = require('./whatsapp-assistant.controller');
const twilio = require('twilio');

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

const whatsappWebhookController = {
  handleIncomingMessage: async (req, res) => {
    try {
      console.log('Raw request body:', req.body);
      
      // Estrai i dati dal messaggio WhatsApp
      const message = {
        Body: req.body.Body,
        From: req.body.From,
        ProfileName: req.body.ProfileName || 'Guest'
      };
      
      console.log(`Messaggio ricevuto da ${message.ProfileName} (${message.From}): "${message.Body}"`);
      
      // Trova l'assistente attivo per questo numero WhatsApp
      const assistants = await WhatsAppAssistant.find({ isActive: true }).populate('hotelId');
      
      if (assistants.length === 0) {
        console.log('Nessun assistente attivo trovato');
        return res.status(200).send('OK'); // Rispondi con 200 per evitare tentativi ripetuti
      }
      
      // Cerca se esiste già un'interazione con questo numero
      let interaction = await WhatsappInteraction.findOne({ 
        phoneNumber: message.From 
      });
      
      let assistant;
      
      if (interaction) {
        // Trova l'assistente associato a questa interazione
        assistant = assistants.find(a => a.hotelId._id.toString() === interaction.hotelId.toString());
        
        console.log('Found active conversation with assistant:', {
          assistantId: assistant?._id,
          hotelName: assistant?.hotelId.name,
          lastInteraction: new Date()
        });
      } else {
        // Se è un nuovo utente, usa solo il primo assistente disponibile
        // (In futuro potresti implementare una logica più avanzata per scegliere l'assistente)
        assistant = assistants[0];
        
        // Crea una nuova interazione
        interaction = new WhatsappInteraction({
          hotelId: assistant.hotelId._id,
          phoneNumber: message.From,
          profileName: message.ProfileName,
          firstInteraction: new Date(),
          dailyInteractions: [{
            date: new Date(),
            count: 1
          }],
          conversationHistory: [{
            role: 'user',
            content: message.Body,
            timestamp: new Date()
          }]
        });
        
        // Salva l'interazione
        await interaction.save();
        
        console.log('Nuova interazione creata per:', {
          phoneNumber: message.From,
          profileName: message.ProfileName,
          hotelId: assistant.hotelId._id
        });
        
        // Schedule review request
        try {
          console.log('Tentativo di scheduling della recensione...');
          await whatsappAssistantController.scheduleReviewRequest(interaction, assistant);
          console.log('Recensione schedulata con successo');
        } catch (error) {
          console.error('Errore nello scheduling della recensione:', error);
        }
      }
      
      // Aggiorna l'interazione con il messaggio e l'ora
      if (interaction) {
        interaction.conversationHistory.push({
          role: 'user',
          content: message.Body,
          timestamp: new Date()
        });
        
        interaction.lastInteraction = new Date();
        await interaction.save();
      }
      
      // Procedi con la risposta...
      // (Questa parte rimane invariata)
      
      res.status(200).send('OK');
    } catch (error) {
      console.error('Errore nel webhook WhatsApp:', error);
      res.status(200).send('OK'); // Anche in caso di errore, rispondi con 200
    }
  }
};

module.exports = whatsappWebhookController; 