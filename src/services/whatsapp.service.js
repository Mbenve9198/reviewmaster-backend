const twilio = require('twilio');
const WhatsAppAssistant = require('../models/whatsapp-assistant.model');
const Hotel = require('../models/hotel.model');

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

const whatsappService = {
  async handleIncomingMessage(message) {
    try {
      // Estrai il trigger name dal messaggio (es: #hotelname)
      const triggerMatch = message.Body.match(/#(\w+)/);
      if (!triggerMatch) return null;
      
      const triggerName = triggerMatch[1].toLowerCase();
      
      // Trova l'assistente corrispondente
      const assistant = await WhatsAppAssistant.findOne({ 
        triggerName: triggerName,
        isActive: true 
      });
      
      if (!assistant) return null;

      // Trova l'hotel corrispondente
      const hotel = await Hotel.findById(assistant.hotelId);
      if (!hotel) return null;

      // Cerca una regola che corrisponda al messaggio
      const matchingRule = assistant.rules.find(rule => {
        if (!rule.isActive) return false;
        
        const topic = rule.isCustom ? rule.customTopic : rule.topic;
        const messageText = message.Body.toLowerCase();
        
        return messageText.includes(topic.toLowerCase());
      });

      if (!matchingRule) return null;

      // Sostituisci le variabili nella risposta
      let response = matchingRule.response
        .replace(/{guest_name}/g, message.ProfileName || 'Guest')
        .replace(/{hotel_name}/g, hotel.name)
        .replace(/{time}/g, new Date().toLocaleTimeString());

      // Invia la risposta
      await client.messages.create({
        body: response,
        from: `whatsapp:${process.env.NEXT_PUBLIC_WHATSAPP_NUMBER}`,
        to: message.From,
        messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID
      });

      return response;
    } catch (error) {
      console.error('WhatsApp service error:', error);
      return null;
    }
  }
};

module.exports = whatsappService; 