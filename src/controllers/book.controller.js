// controllers/book.controller.js
const mongoose = require('mongoose');
const { GridFSBucket } = require('mongodb');
const { Book } = require('../models/book.model');
const pdf = require('pdf-parse');

const bookController = {
    uploadBook: async (req, res) => {
        try {
            const bucket = new GridFSBucket(mongoose.connection.db);
            const uploadStream = bucket.openUploadStream(req.file.originalname);
            
            // Salva il file in GridFS
            await new Promise((resolve, reject) => {
                uploadStream.on('error', reject);
                uploadStream.on('finish', resolve);
                uploadStream.end(req.file.buffer);
            });

            // Estrai il testo dal PDF
            const data = await pdf(req.file.buffer);

            // Crea il record del libro con il testo completo
            const book = await Book.create({
                title: req.body.title,
                author: req.body.author,
                fileId: uploadStream.id,
                content: data.text,
                processedStatus: 'completed'
            });

            res.json(book);
        } catch (error) {
            console.error('Error uploading book:', error);
            res.status(500).json({ message: 'Error uploading book' });
        }
    },

    // Esempio di ricerca nel testo completo
    searchBooks: async (req, res) => {
        try {
            const { query } = req.query;
            const books = await Book.find(
                { $text: { $search: query } },
                { score: { $meta: "textScore" } }
            )
            .sort({ score: { $meta: "textScore" } });
            
            res.json(books);
        } catch (error) {
            console.error('Error searching books:', error);
            res.status(500).json({ message: 'Error searching books' });
        }
    }
};

module.exports = bookController;