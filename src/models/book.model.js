// models/book.model.js
const mongoose = require('mongoose');

const bookSchema = new mongoose.Schema({
    title: {
        type: String,
        required: true
    },
    author: String,
    fileId: {
        type: mongoose.Schema.Types.ObjectId  // riferimento al file in GridFS
    },
    processedStatus: {
        type: String,
        enum: ['pending', 'processing', 'completed', 'failed'],
        default: 'pending'
    }
}, { timestamps: true });

const bookChunkSchema = new mongoose.Schema({
    bookId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Book',
        required: true
    },
    content: {
        type: String,
        required: true,
        text: true // Per abilitare la ricerca full-text
    },
    metadata: {
        pageNumber: Number,
        chapter: String,
        bookTitle: String,
        bookAuthor: String
    }
}, { timestamps: true });

module.exports = {
    Book: mongoose.model('Book', bookSchema),
    BookChunk: mongoose.model('BookChunk', bookChunkSchema)
};