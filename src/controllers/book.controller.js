// controllers/book.controller.js
const mongoose = require('mongoose');
const { GridFSBucket } = require('mongodb');
const { Book, BookChunk } = require('../models/book.model');
const { PDFLoader } = require('langchain/document_loaders/fs/pdf');
const { OpenAIEmbeddings } = require('langchain/embeddings/openai');

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

            // Crea il record del libro
            const book = await Book.create({
                title: req.body.title,
                author: req.body.author,
                fileId: uploadStream.id
            });

            // Avvia il processing in background
            processBook(book._id).catch(console.error);

            res.json(book);
        } catch (error) {
            console.error('Error uploading book:', error);
            res.status(500).json({ message: 'Error uploading book' });
        }
    }
};

async function processBook(bookId) {
    const book = await Book.findById(bookId);
    if (!book) return;

    try {
        book.processedStatus = 'processing';
        await book.save();

        const bucket = new GridFSBucket(mongoose.connection.db);
        const downloadStream = bucket.openDownloadStream(book.fileId);
        
        // Processa il PDF
        const chunks = await loadAndChunkPDF(downloadStream);
        
        // Crea embeddings e salva i chunks
        const embeddings = new OpenAIEmbeddings();
        
        for (const chunk of chunks) {
            const embedding = await embeddings.embedQuery(chunk.content);
            await BookChunk.create({
                bookId: book._id,
                content: chunk.content,
                embedding,
                metadata: chunk.metadata
            });
        }

        book.processedStatus = 'completed';
        await book.save();
    } catch (error) {
        console.error('Error processing book:', error);
        book.processedStatus = 'failed';
        await book.save();
    }
}

module.exports = bookController;