// models/book.model.js
const mongoose = require('mongoose');

const bookSchema = new mongoose.Schema({
    title: {
        type: String,
        required: true
    },
    author: String,
    fileId: {
        type: mongoose.Schema.Types.ObjectId
    },
    content: {
        type: String,
        required: true,
        text: true  // Abilita la ricerca full-text sull'intero contenuto
    },
    processedStatus: {
        type: String,
        enum: ['pending', 'processing', 'completed', 'failed'],
        default: 'pending'
    }
}, { timestamps: true });

// Creiamo un indice di testo sul contenuto per ricerche veloci
bookSchema.index({ content: 'text' });

module.exports = {
    Book: mongoose.model('Book', bookSchema)
};