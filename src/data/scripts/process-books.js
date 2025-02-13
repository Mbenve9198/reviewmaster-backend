const mongoose = require('mongoose');
const { GridFSBucket } = require('mongodb');
const fs = require('fs').promises;
const path = require('path');
const pdf = require('pdf-parse');
require('dotenv').config();

// Schema definizione semplificata
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
        text: true  // Per abilitare la ricerca full-text
    },
    processedStatus: {
        type: String,
        enum: ['pending', 'processing', 'completed', 'failed'],
        default: 'pending'
    }
}, { timestamps: true });

const Book = mongoose.model('Book', bookSchema);

const books = [
    {
        filename: 'Creating Magic 10 Common Sense Leadership Strategies from a Life at Disney (Lee Cockerell) (Z-Library).pdf',
        title: 'Creating Magic 10 Common Sense Leadership Strategies from a Life at Disney',
        author: 'Lee Cockerell'
    },
    {
        filename: 'Setting the Table (Danny Meyer) (Z-Library).pdf',
        title: 'Setting the Table',
        author: 'Danny Meyer'
    },
    {
        filename: 'The heart of hospitality great hotel and restaurant leaders share their secrets (Solomon, Micah) (Z-Library).pdf',
        title: 'The heart of hospitality great hotel and restaurant leaders share their secrets',
        author: 'Solomon, Micah'
    }
];

async function processBook(bookInfo) {
    console.log(`Processing ${bookInfo.title}...`);

    try {
        // 1. Leggi il file
        const filePath = path.join(__dirname, '../books', bookInfo.filename);
        const fileContent = await fs.readFile(filePath);

        // 2. Salva in GridFS
        const bucket = new GridFSBucket(mongoose.connection.db);
        const uploadStream = bucket.openUploadStream(bookInfo.filename);
        
        await new Promise((resolve, reject) => {
            uploadStream.on('error', reject);
            uploadStream.on('finish', resolve);
            uploadStream.end(fileContent);
        });

        // 3. Estrai il testo dal PDF
        const data = await pdf(fileContent);
        
        // 4. Crea il record del libro con il testo completo
        const book = await Book.create({
            title: bookInfo.title,
            author: bookInfo.author,
            fileId: uploadStream.id,
            content: data.text,
            processedStatus: 'completed'
        });

        console.log(`Completed processing ${bookInfo.title}`);
        return book;
    } catch (error) {
        console.error(`Error processing ${bookInfo.title}:`, error);
        throw error;
    }
}

async function main() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Connected to MongoDB');

        for (const bookInfo of books) {
            await processBook(bookInfo);
        }

        console.log('All books processed');
    } catch (error) {
        console.error('Error:', error);
    } finally {
        await mongoose.disconnect();
    }
}

main();