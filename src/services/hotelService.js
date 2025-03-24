const Hotel = require('../models/hotel.model');
const Rule = require('../models/rule.model');
const User = require('../models/user.model');
const redisService = require('./redisService');

// Cache TTL in millisecondi
const HOTEL_CACHE_TTL = 600000; // 10 minuti
const RULES_CACHE_TTL = 300000; // 5 minuti

/**
 * Ottiene un hotel con caching
 * @param {string} hotelId - ID dell'hotel
 * @param {string} userId - ID dell'utente (per verifica proprietà)
 * @returns {Promise<Object>} - Hotel o null
 */
const getHotelWithCache = async (hotelId, userId) => {
  try {
    // Genera chiave cache
    const cacheKey = `hotel:${hotelId}`;
    
    // Controlla se l'hotel è nella cache
    const cachedHotel = await redisService.getCachedResponse(cacheKey);
    if (cachedHotel) {
      // Verifica che l'hotel appartenga all'utente
      if (cachedHotel.userId.toString() === userId) {
        return cachedHotel;
      }
      return null;
    }
    
    // Se non in cache, ottieni dal database
    const hotel = await Hotel.findOne({ _id: hotelId, userId }).lean();
    
    // Se esiste, salva in cache
    if (hotel) {
      await redisService.cacheResponse(cacheKey, hotel, HOTEL_CACHE_TTL);
    }
    
    return hotel;
  } catch (error) {
    console.error('Error getting hotel from cache:', error);
    // Fallback al database in caso di errore Redis
    return await Hotel.findOne({ _id: hotelId, userId }).lean();
  }
};

/**
 * Ottiene le regole attive di un hotel con caching
 * @param {string} hotelId - ID dell'hotel
 * @returns {Promise<Array>} - Lista di regole attive
 */
const getActiveRulesWithCache = async (hotelId) => {
  try {
    // Genera chiave cache
    const cacheKey = `hotel:${hotelId}:rules:active`;
    
    // Controlla se le regole sono nella cache
    const cachedRules = await redisService.getCachedResponse(cacheKey);
    if (cachedRules) {
      return cachedRules;
    }
    
    // Se non in cache, ottieni dal database
    const rules = await Rule.find({ 
      hotelId: hotelId, 
      isActive: true 
    }).sort({ priority: -1 }).lean();
    
    // Salva in cache
    await redisService.cacheResponse(cacheKey, rules, RULES_CACHE_TTL);
    
    return rules;
  } catch (error) {
    console.error('Error getting active rules from cache:', error);
    // Fallback al database in caso di errore Redis
    return await Rule.find({ 
      hotelId: hotelId, 
      isActive: true 
    }).sort({ priority: -1 }).lean();
  }
};

/**
 * Ottiene un utente con caching
 * @param {string} userId - ID dell'utente
 * @returns {Promise<Object>} - Utente o null
 */
const getUserWithCache = async (userId) => {
  try {
    // Genera chiave cache
    const cacheKey = `user:${userId}`;
    
    // Controlla se l'utente è nella cache
    const cachedUser = await redisService.getCachedResponse(cacheKey);
    if (cachedUser) {
      return cachedUser;
    }
    
    // Se non in cache, ottieni dal database
    const user = await User.findById(userId).lean();
    
    // Se esiste, salva in cache
    if (user) {
      await redisService.cacheResponse(cacheKey, user, HOTEL_CACHE_TTL);
    }
    
    return user;
  } catch (error) {
    console.error('Error getting user from cache:', error);
    // Fallback al database in caso di errore Redis
    return await User.findById(userId).lean();
  }
};

/**
 * Ottiene simultaneamente hotel, utente e regole attive
 * @param {string} hotelId - ID dell'hotel
 * @param {string} userId - ID dell'utente
 * @returns {Promise<{hotel, user, activeRules}>} - Oggetti richiesti
 */
const getHotelDataWithRules = async (hotelId, userId) => {
  try {
    // Esegui le query in parallelo
    const [hotel, user, activeRules] = await Promise.all([
      getHotelWithCache(hotelId, userId),
      getUserWithCache(userId),
      getActiveRulesWithCache(hotelId)
    ]);
    
    return { hotel, user, activeRules };
  } catch (error) {
    console.error('Error getting hotel data with rules:', error);
    throw error;
  }
};

/**
 * Invalida la cache di un hotel quando viene modificato
 * @param {string} hotelId - ID dell'hotel
 */
const invalidateHotelCache = async (hotelId) => {
  try {
    const redis = await redisService.getClient();
    await redis.del(`hotel:${hotelId}`);
    await redis.del(`hotel:${hotelId}:rules:active`);
  } catch (error) {
    console.error('Error invalidating hotel cache:', error);
  }
};

module.exports = {
  getHotelWithCache,
  getUserWithCache,
  getActiveRulesWithCache,
  getHotelDataWithRules,
  invalidateHotelCache
}; 