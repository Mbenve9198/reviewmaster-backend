/**
 * Script di migrazione per trasferire le impostazioni di credito da WhatsAppAssistant al nuovo modello UserCreditSettings
 * 
 * Per eseguire:
 * NODE_ENV=production node backend/src/migrations/migrate-credit-settings.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const WhatsAppAssistant = require('../models/whatsapp-assistant.model');
const UserCreditSettings = require('../models/user-credit-settings.model');
const User = require('../models/user.model');

async function migrateData() {
  try {
    console.log('Connessione al database...');
    await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    console.log('Connesso al database con successo');

    // Trova tutti gli assistenti WhatsApp con impostazioni di credito
    const assistants = await WhatsAppAssistant.find({}).populate('userId');
    console.log(`Trovati ${assistants.length} assistenti WhatsApp`);

    let migratedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    // Processa ogni assistente
    for (const assistant of assistants) {
      try {
        if (!assistant.userId) {
          console.log(`Assistente ${assistant._id} non ha un utente associato, saltato.`);
          skippedCount++;
          continue;
        }

        // Verifica se esistono già impostazioni di credito per questo utente
        const existingSettings = await UserCreditSettings.findOne({ userId: assistant.userId._id });
        
        if (existingSettings) {
          console.log(`L'utente ${assistant.userId._id} ha già impostazioni di credito, saltato.`);
          skippedCount++;
          continue;
        }

        // Crea nuove impostazioni di credito basate su quelle dell'assistente
        const newCreditSettings = new UserCreditSettings({
          userId: assistant.userId._id,
          minimumThreshold: assistant.creditSettings?.minimumThreshold || 50,
          topUpAmount: assistant.creditSettings?.topUpAmount || 100,
          autoTopUp: assistant.creditSettings?.autoTopUp || false,
          lastAutoTopUp: assistant.creditSettings?.lastAutoTopUp || null
        });

        // Salva le nuove impostazioni
        await newCreditSettings.save();
        migratedCount++;
        
        console.log(`Migrate impostazioni di credito per l'utente ${assistant.userId._id}`);
      } catch (err) {
        console.error(`Errore durante la migrazione dell'assistente ${assistant._id}:`, err);
        errorCount++;
      }
    }

    // Trova utenti che non hanno un assistente WhatsApp
    const allUsers = await User.find({});
    console.log(`Trovati ${allUsers.length} utenti totali`);

    for (const user of allUsers) {
      try {
        // Verifica se esistono già impostazioni di credito per questo utente
        const existingSettings = await UserCreditSettings.findOne({ userId: user._id });
        
        if (existingSettings) {
          continue; // Utente già elaborato
        }

        // Verifica se l'utente ha un assistente WhatsApp
        const hasAssistant = assistants.some(a => a.userId && a.userId._id.toString() === user._id.toString());
        
        if (hasAssistant) {
          continue; // L'utente ha un assistente ed è stato elaborato nel ciclo precedente
        }

        // Crea impostazioni di credito predefinite per l'utente
        const newCreditSettings = new UserCreditSettings({
          userId: user._id,
          minimumThreshold: 50,
          topUpAmount: 100,
          autoTopUp: false,
          lastAutoTopUp: null
        });

        // Salva le nuove impostazioni
        await newCreditSettings.save();
        migratedCount++;
        
        console.log(`Create impostazioni di credito predefinite per l'utente ${user._id}`);
      } catch (err) {
        console.error(`Errore durante la creazione delle impostazioni per l'utente ${user._id}:`, err);
        errorCount++;
      }
    }

    console.log('Migrazione completata!');
    console.log(`Migrazione eseguita per ${migratedCount} utenti`);
    console.log(`Saltati ${skippedCount} utenti (già migrati o senza userId)`);
    console.log(`Errori: ${errorCount}`);
  } catch (err) {
    console.error('Errore durante la migrazione:', err);
  } finally {
    await mongoose.disconnect();
    console.log('Disconnesso dal database');
  }
}

// Esegui la migrazione
migrateData(); 