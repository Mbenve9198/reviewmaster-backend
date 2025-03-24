/**
 * Script per il benchmark delle prestazioni del controller delle recensioni
 * Utilizzo: NODE_ENV=production node src/benchmarks/review-response.benchmark.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const axios = require('axios');
const { performance } = require('perf_hooks');
const redisService = require('../services/redisService');

// Configurazione
const API_URL = process.env.API_URL || 'http://localhost:3000/api';
const JWT_TOKEN = process.env.TEST_JWT_TOKEN;
const NUM_REQUESTS = 10; // Numero di richieste per test
const PARALLEL_REQUESTS = 5; // Richieste parallele
const REDIS_ENABLED = true; // Modificare per testare con/senza Redis

// Configura axios con token di autorizzazione
const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Authorization': `Bearer ${JWT_TOKEN}`,
    'Content-Type': 'application/json'
  }
});

// Array di recensioni di esempio per i test
const sampleReviews = [
  "Our stay was excellent! The staff was very friendly and the room was clean and comfortable. The breakfast was delicious with many options. Will definitely come back!",
  "Decent hotel but could use some improvements. The bathroom was a bit small and the shower pressure was weak. Staff was friendly though and the location is convenient.",
  "Terrible experience. The room was dirty, the staff was rude, and the breakfast was cold. Avoid this place at all costs!",
  "Beautiful hotel with amazing views! The room was spacious and well-appointed. Only drawback was the noisy AC unit.",
  "Good value for money. Not luxury but clean and functional. The staff was helpful with directions and recommendations."
];

// Configura la connessione al DB per i test
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => console.log('MongoDB connected for benchmarking'))
.catch(err => console.error('MongoDB connection error:', err));

// Funzione di utilità per attendere un tempo specificato
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Funzione per simulare una richiesta di risposta a recensione
const generateReviewResponse = async (reviewIdx, hotelId, userId) => {
  const startTime = performance.now();
  let success = false;
  let responseTime = 0;
  
  try {
    const response = await api.post('/reviews/generate-response', {
      hotelId,
      review: {
        text: sampleReviews[reviewIdx % sampleReviews.length],
        rating: Math.floor(Math.random() * 3) + 3, // Rating 3-5
        reviewerName: `Test User ${reviewIdx}`
      },
      responseSettings: {
        style: Math.random() > 0.5 ? 'professional' : 'friendly',
        length: ['short', 'medium', 'long'][Math.floor(Math.random() * 3)]
      },
      generateSuggestions: false
    });
    
    success = response.status === 200;
    responseTime = performance.now() - startTime;
    
    return {
      success,
      responseTime,
      error: null
    };
  } catch (error) {
    responseTime = performance.now() - startTime;
    return {
      success: false,
      responseTime,
      error: error.response?.data?.message || error.message
    };
  }
};

// Funzione per eseguire batch di richieste in parallelo
const runParallelBatch = async (startIdx, batchSize, hotelId, userId) => {
  const promises = [];
  
  for (let i = 0; i < batchSize; i++) {
    promises.push(generateReviewResponse(startIdx + i, hotelId, userId));
  }
  
  return Promise.all(promises);
};

// Funzione principale di benchmark
const runBenchmark = async () => {
  console.log(`Starting benchmark with Redis ${REDIS_ENABLED ? 'enabled' : 'disabled'}`);
  console.log(`Total requests: ${NUM_REQUESTS}, Parallel requests: ${PARALLEL_REQUESTS}`);
  
  // Se Redis è disabilitato per il test, svuota la cache prima
  if (!REDIS_ENABLED) {
    try {
      const redis = await redisService.getClient();
      await redis.flushAll();
      console.log('Redis cache cleared for testing without cache');
    } catch (error) {
      console.error('Error clearing Redis cache:', error);
    }
  }
  
  // Assicurati di avere un hotel e userId validi per i test
  const hotelId = process.env.TEST_HOTEL_ID;
  const userId = process.env.TEST_USER_ID;
  
  if (!hotelId || !userId) {
    console.error('TEST_HOTEL_ID and TEST_USER_ID must be set in .env for benchmarking');
    process.exit(1);
  }
  
  // Statistiche per i risultati
  const results = {
    totalRequests: NUM_REQUESTS,
    successfulRequests: 0,
    failedRequests: 0,
    totalResponseTime: 0,
    minResponseTime: Number.MAX_SAFE_INTEGER,
    maxResponseTime: 0,
    errorBreakdown: {}
  };
  
  const startTime = performance.now();
  
  // Esegui le richieste in batch paralleli
  for (let i = 0; i < NUM_REQUESTS; i += PARALLEL_REQUESTS) {
    const batchSize = Math.min(PARALLEL_REQUESTS, NUM_REQUESTS - i);
    console.log(`Running batch ${i / PARALLEL_REQUESTS + 1}, size: ${batchSize}`);
    
    const batchResults = await runParallelBatch(i, batchSize, hotelId, userId);
    
    // Analizza i risultati del batch
    batchResults.forEach(result => {
      if (result.success) {
        results.successfulRequests++;
      } else {
        results.failedRequests++;
        const errorMessage = result.error || 'Unknown error';
        results.errorBreakdown[errorMessage] = (results.errorBreakdown[errorMessage] || 0) + 1;
      }
      
      results.totalResponseTime += result.responseTime;
      results.minResponseTime = Math.min(results.minResponseTime, result.responseTime);
      results.maxResponseTime = Math.max(results.maxResponseTime, result.responseTime);
    });
    
    // Pausa tra i batch per evitare di sovraccaricare l'API
    if (i + PARALLEL_REQUESTS < NUM_REQUESTS) {
      await sleep(1000);
    }
  }
  
  const totalTime = performance.now() - startTime;
  
  // Calcola e mostra i risultati
  results.averageResponseTime = results.totalResponseTime / NUM_REQUESTS;
  results.requestsPerSecond = (NUM_REQUESTS / totalTime) * 1000;
  results.totalTimeSeconds = totalTime / 1000;
  
  console.log('\nBenchmark Results:');
  console.log('===================');
  console.log(`Redis Enabled: ${REDIS_ENABLED}`);
  console.log(`Total Requests: ${results.totalRequests}`);
  console.log(`Successful Requests: ${results.successfulRequests} (${(results.successfulRequests / results.totalRequests * 100).toFixed(2)}%)`);
  console.log(`Failed Requests: ${results.failedRequests} (${(results.failedRequests / results.totalRequests * 100).toFixed(2)}%)`);
  console.log(`Total Time: ${results.totalTimeSeconds.toFixed(2)}s`);
  console.log(`Requests/Second: ${results.requestsPerSecond.toFixed(2)}`);
  console.log(`Average Response Time: ${results.averageResponseTime.toFixed(2)}ms`);
  console.log(`Min Response Time: ${results.minResponseTime.toFixed(2)}ms`);
  console.log(`Max Response Time: ${results.maxResponseTime.toFixed(2)}ms`);
  
  if (results.failedRequests > 0) {
    console.log('\nError Breakdown:');
    for (const [error, count] of Object.entries(results.errorBreakdown)) {
      console.log(`- ${error}: ${count} occurrences`);
    }
  }
  
  // Chiudi le connessioni
  mongoose.disconnect();
  try {
    const redis = await redisService.getClient();
    await redis.quit();
  } catch (error) {
    console.error('Error closing Redis connection:', error);
  }
};

// Esegui il benchmark
runBenchmark().catch(err => {
  console.error('Benchmark error:', err);
  process.exit(1);
}); 