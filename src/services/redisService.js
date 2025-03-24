const { createClient } = require('redis');

// Singleton client
let client;

// Configurazioni e tempi di scadenza in ms
const CONFIGS = {
  REQUEST_CACHE_TTL: 60000, // 1 minuto
  LOCK_TTL: 10000,          // 10 secondi
  RESPONSE_CACHE_TTL: 86400000, // 24 ore
  MAX_RETRY_ATTEMPTS: 3,
  RETRY_DELAY: 1000,        // 1 secondo
};

/**
 * Inizializza e restituisce il client Redis
 * @returns {Object} client Redis
 */
const getClient = async () => {
  if (client && client.isOpen) {
    return client;
  }

  client = createClient({
    username: 'default',
    password: process.env.REDIS_PASSWORD,
    socket: {
      host: process.env.REDIS_HOST,
      port: parseInt(process.env.REDIS_PORT)
    }
  });

  client.on('error', err => console.error('Redis Client Error', err));
  
  try {
    await client.connect();
    console.log('Redis client connected successfully');
    return client;
  } catch (error) {
    console.error('Failed to connect to Redis:', error);
    throw error;
  }
};

/**
 * Ottiene un lock distribuito
 * @param {string} key - Chiave del lock
 * @param {number} ttl - Time-to-live in millisecondi
 * @returns {Promise<boolean>} - true se il lock è stato ottenuto
 */
const acquireLock = async (key, ttl = CONFIGS.LOCK_TTL) => {
  const redis = await getClient();
  
  // Utilizziamo NX per settare il valore solo se non esiste
  const result = await redis.set(`lock:${key}`, Date.now(), {
    NX: true,
    PX: ttl
  });
  
  return result === 'OK';
};

/**
 * Rilascia un lock distribuito
 * @param {string} key - Chiave del lock
 */
const releaseLock = async (key) => {
  const redis = await getClient();
  await redis.del(`lock:${key}`);
};

/**
 * Controlla se una richiesta è duplicata
 * @param {string} requestKey - Chiave univoca della richiesta
 * @param {number} dedupeWindow - Finestra di tempo in ms per considerare duplicata
 * @returns {Promise<boolean>} - true se è una richiesta duplicata
 */
const isDuplicateRequest = async (requestKey, dedupeWindow = 10000) => {
  const redis = await getClient();
  
  const lastRequestTime = await redis.get(`request:${requestKey}`);
  
  if (lastRequestTime) {
    const timeSinceLastRequest = Date.now() - parseInt(lastRequestTime);
    return timeSinceLastRequest < dedupeWindow;
  }
  
  return false;
};

/**
 * Registra una richiesta nel sistema di deduplicazione
 * @param {string} requestKey - Chiave univoca della richiesta
 * @param {number} ttl - Time-to-live in millisecondi
 */
const registerRequest = async (requestKey, ttl = CONFIGS.REQUEST_CACHE_TTL) => {
  const redis = await getClient();
  await redis.set(`request:${requestKey}`, Date.now(), {
    PX: ttl
  });
};

/**
 * Memorizza una risposta nella cache
 * @param {string} cacheKey - Chiave della cache
 * @param {*} data - Dati da memorizzare
 * @param {number} ttl - Time-to-live in millisecondi
 */
const cacheResponse = async (cacheKey, data, ttl = CONFIGS.RESPONSE_CACHE_TTL) => {
  const redis = await getClient();
  await redis.set(`cache:${cacheKey}`, JSON.stringify(data), {
    PX: ttl
  });
};

/**
 * Ottiene una risposta dalla cache
 * @param {string} cacheKey - Chiave della cache
 * @returns {Promise<*>} - Dati memorizzati o null se non trovati
 */
const getCachedResponse = async (cacheKey) => {
  const redis = await getClient();
  
  const cachedData = await redis.get(`cache:${cacheKey}`);
  
  if (cachedData) {
    try {
      return JSON.parse(cachedData);
    } catch (error) {
      console.error('Error parsing cached data:', error);
      return null;
    }
  }
  
  return null;
};

/**
 * Implementa un rate limiter distribuito
 * @param {string} resourceKey - Chiave della risorsa (es. userId, IP)
 * @param {number} limit - Limite massimo di richieste
 * @param {number} window - Finestra di tempo in secondi
 * @returns {Promise<{allowed: boolean, current: number, remaining: number}>}
 */
const rateLimit = async (resourceKey, limit = 10, window = 60) => {
  const redis = await getClient();
  const key = `ratelimit:${resourceKey}`;
  
  const current = await redis.incr(key);
  
  // Se è la prima richiesta, imposta TTL
  if (current === 1) {
    await redis.expire(key, window);
  }
  
  return {
    allowed: current <= limit,
    current,
    remaining: Math.max(0, limit - current)
  };
};

/**
 * Memorizza nella cache temporaneo token per circuit breaker
 * @param {string} service - Nome del servizio (es. 'claude', 'openai')
 * @param {boolean} isWorking - Stato del servizio
 * @param {number} ttl - Time-to-live in millisecondi
 */
const setServiceStatus = async (service, isWorking, ttl = 60000) => {
  const redis = await getClient();
  await redis.set(`service:${service}:status`, isWorking ? '1' : '0', {
    PX: ttl
  });
};

/**
 * Ottiene lo stato del servizio dalla cache
 * @param {string} service - Nome del servizio
 * @returns {Promise<boolean|null>} - true se il servizio funziona, false se non funziona, null se non presente
 */
const getServiceStatus = async (service) => {
  const redis = await getClient();
  
  const status = await redis.get(`service:${service}:status`);
  
  if (status === null) return null;
  return status === '1';
};

module.exports = {
  getClient,
  acquireLock,
  releaseLock,
  isDuplicateRequest,
  registerRequest,
  cacheResponse,
  getCachedResponse,
  rateLimit,
  setServiceStatus,
  getServiceStatus,
  CONFIGS
}; 