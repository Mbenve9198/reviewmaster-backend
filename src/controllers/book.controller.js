// controllers/book.controller.js
const mongoose = require('mongoose');
const { GridFSBucket } = require('mongodb');
const { Book, BookChunk } = require('../models/book.model');
const pdf = require('pdf-parse');  // Usiamo pdf-parse invece di PDFLoader

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
        
        // Salva i chunks
        for (const chunk of chunks) {
            await BookChunk.create({
                bookId: book._id,
                content: chunk.content,
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

async function loadAndChunkPDF(downloadStream) {
    // Converti lo stream in buffer
    const chunks = [];
    for await (const chunk of downloadStream) {
        chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);
    
    // Usa pdf-parse per estrarre il testo
    const data = await pdf(buffer);
    
    // Dividi il testo in chunks
    return splitIntoChunks(data.text);
}

async function splitIntoChunks(text, maxChunkSize = 2000) {
    // Divide in paragrafi preservando la struttura originale
    const paragraphs = text.split(/\n\s*\n/);
    const chunks = [];
    let currentChunk = '';
    let currentSize = 0;

    for (const paragraph of paragraphs) {
        const trimmedParagraph = paragraph.trim();
        if (!trimmedParagraph) continue;

        if (currentSize + trimmedParagraph.length > maxChunkSize && currentChunk) {
            chunks.push(currentChunk.trim());
            currentChunk = '';
            currentSize = 0;
        }
        currentChunk += trimmedParagraph + '\n\n';
        currentSize += trimmedParagraph.length + 2;
    }

    if (currentChunk) {
        chunks.push(currentChunk.trim());
    }

    return chunks.map(content => ({
        content,
        metadata: {}  // Puoi aggiungere metadati se necessario
    }));
}

module.exports = bookController;