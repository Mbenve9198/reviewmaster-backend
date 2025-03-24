const Anthropic = require('@anthropic-ai/sdk');
const OpenAI = require('openai');
const redisService = require('./redisService');

// Singleton clients
let anthropicClient = null;
let openaiClient = null;

// Cache per le risposte simili
const REVIEW_RESPONSE_CACHE_TTL = 86400000; // 24 ore

/**
 * Inizializza e restituisce il client Anthropic
 * @returns Client Anthropic
 */
const getAnthropicClient = () => {
  if (!anthropicClient) {
    anthropicClient = new Anthropic({
      apiKey: process.env.CLAUDE_API_KEY,
    });
  }
  return anthropicClient;
};

/**
 * Inizializza e restituisce il client OpenAI
 * @returns Client OpenAI
 */
const getOpenAIClient = () => {
  if (!openaiClient) {
    openaiClient = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }
  return openaiClient;
};

/**
 * Genera una risposta usando Claude con circuit breaker e retry
 */
const generateClaudeResponse = async (systemPrompt, messages, options = {}) => {
  const anthropic = getAnthropicClient();
  const maxRetries = options.maxRetries || 2;
  const timeout = options.timeout || 30000; // 30 secondi

  // Controlla se il servizio è attualmente in fallimento (circuit breaker)
  const serviceStatus = await redisService.getServiceStatus('claude');
  if (serviceStatus === false) {
    console.log('Claude service is currently marked as down, skipping...');
    throw new Error('Claude service temporarily unavailable');
  }

  let retries = 0;
  
  while (retries <= maxRetries) {
    try {
      // Promise con timeout
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error(`Claude timeout after ${timeout}ms`)), timeout);
      });
      
      const responsePromise = anthropic.messages.create({
        model: options.model || "claude-3-7-sonnet-20250219",
        max_tokens: options.maxTokens || 1000,
        temperature: options.temperature || 0.7,
        system: systemPrompt,
        messages: messages
      });
      
      // Race tra risposta e timeout
      const response = await Promise.race([responsePromise, timeoutPromise]);
      
      // Se arriva qui, il servizio funziona - aggiorna lo stato nel circuito
      await redisService.setServiceStatus('claude', true);
      
      return {
        text: response?.content?.[0]?.text || '',
        provider: 'claude'
      };
    } catch (error) {
      console.error(`Claude error (attempt ${retries + 1}/${maxRetries + 1}):`, error.message);
      
      // Se ultimo tentativo, marca il servizio come non funzionante per 30 secondi
      if (retries === maxRetries) {
        console.error('Max retries reached for Claude API, marking service as down');
        await redisService.setServiceStatus('claude', false, 30000);
        throw error;
      }
      
      retries++;
      // Attesa esponenziale tra i tentativi
      await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, retries)));
    }
  }
};

/**
 * Genera una risposta usando OpenAI con circuit breaker e retry
 */
const generateOpenAIResponse = async (systemPrompt, messages, options = {}) => {
  const openai = getOpenAIClient();
  const maxRetries = options.maxRetries || 2;
  const timeout = options.timeout || 30000; // 30 secondi

  // Controlla se il servizio è attualmente in fallimento (circuit breaker)
  const serviceStatus = await redisService.getServiceStatus('openai');
  if (serviceStatus === false) {
    console.log('OpenAI service is currently marked as down, skipping...');
    throw new Error('OpenAI service temporarily unavailable');
  }

  let retries = 0;
  
  while (retries <= maxRetries) {
    try {
      // Prepara i messaggi nel formato OpenAI
      const openaiMessages = [
        { role: "system", content: systemPrompt },
        ...messages
      ];
      
      // Promise con timeout
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error(`OpenAI timeout after ${timeout}ms`)), timeout);
      });
      
      const responsePromise = openai.chat.completions.create({
        model: options.model || "gpt-4.5-preview-2025-02-27",
        messages: openaiMessages,
        max_tokens: options.maxTokens || 1000,
        temperature: options.temperature || 0.7
      });
      
      // Race tra risposta e timeout
      const response = await Promise.race([responsePromise, timeoutPromise]);
      
      // Se arriva qui, il servizio funziona - aggiorna lo stato nel circuito
      await redisService.setServiceStatus('openai', true);
      
      return {
        text: response?.choices?.[0]?.message?.content || '',
        provider: 'openai'
      };
    } catch (error) {
      console.error(`OpenAI error (attempt ${retries + 1}/${maxRetries + 1}):`, error.message);
      
      // Se ultimo tentativo, marca il servizio come non funzionante per 30 secondi
      if (retries === maxRetries) {
        console.error('Max retries reached for OpenAI API, marking service as down');
        await redisService.setServiceStatus('openai', false, 30000);
        throw error;
      }
      
      retries++;
      // Attesa esponenziale tra i tentativi
      await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, retries)));
    }
  }
};

/**
 * Genera una risposta usando prima Claude e poi fallback a OpenAI
 */
const generateAIResponse = async (systemPrompt, messages, options = {}) => {
  // Genera una chiave cache basata sul contenuto e sulle impostazioni
  const reviewText = messages.find(m => m.role === 'user')?.content || '';
  const cacheKey = `review_response:${Buffer.from(reviewText).toString('base64')}:${Buffer.from(systemPrompt).toString('base64').substring(0, 100)}`;
  
  // Verifica se abbiamo una risposta in cache
  const cachedResponse = await redisService.getCachedResponse(cacheKey);
  if (cachedResponse && !options.skipCache) {
    console.log('Using cached AI response');
    return cachedResponse;
  }
  
  try {
    // Prima prova con Claude
    const claudeResponse = await generateClaudeResponse(systemPrompt, messages, options);
    
    // Salva in cache per future richieste simili
    await redisService.cacheResponse(cacheKey, claudeResponse, REVIEW_RESPONSE_CACHE_TTL);
    
    return claudeResponse;
  } catch (claudeError) {
    console.log('Claude API failed, falling back to OpenAI:', claudeError.message);
    
    try {
      // Fallback a OpenAI
      const openaiResponse = await generateOpenAIResponse(systemPrompt, messages, options);
      
      // Salva in cache per future richieste simili
      await redisService.cacheResponse(cacheKey, openaiResponse, REVIEW_RESPONSE_CACHE_TTL);
      
      return openaiResponse;
    } catch (openaiError) {
      console.error('Both AI providers failed:', openaiError.message);
      throw new Error('Failed to generate response from both AI providers');
    }
  }
};

/**
 * Genera suggerimenti per migliorare una risposta
 */
const generateSuggestions = async (review, options = {}) => {
  const cacheKey = `suggestions:${Buffer.from(review.text).toString('base64')}`;
  
  // Verifica se abbiamo suggerimenti in cache
  const cachedSuggestions = await redisService.getCachedResponse(cacheKey);
  if (cachedSuggestions && !options.skipCache) {
    console.log('Using cached suggestions');
    return cachedSuggestions;
  }
  
  const suggestionsPrompt = `Based on this review: "${review.text}"

Generate 3 relevant suggestions for improving the response. Each suggestion should be a short question or request (max 6 words).

Consider:
- Specific points mentioned in the review
- The rating (${review.rating})
- Areas for improvement
- Positive aspects to emphasize

Format your response as a simple array of 3 strings, nothing else. For example:
["Address the breakfast complaint", "Highlight room cleanliness more", "Mention upcoming renovations"]`;

  try {
    // Prima prova con Claude per i suggerimenti
    const claudeResponse = await generateClaudeResponse(
      'You are a helpful assistant generating suggestions for improving hotel review responses.',
      [{ role: 'user', content: suggestionsPrompt }],
      { maxTokens: 150 }
    );
    
    let suggestions = [];
    try {
      suggestions = JSON.parse(claudeResponse.text);
    } catch (e) {
      console.error('Error parsing Claude suggestions:', e);
      suggestions = [];
    }
    
    // Salva in cache
    await redisService.cacheResponse(cacheKey, suggestions, REVIEW_RESPONSE_CACHE_TTL);
    
    return suggestions;
  } catch (claudeError) {
    // Fallback a OpenAI per i suggerimenti
    try {
      const openaiResponse = await generateOpenAIResponse(
        'You are a helpful assistant generating suggestions for improving hotel review responses.',
        [{ role: 'user', content: suggestionsPrompt }],
        { maxTokens: 150 }
      );
      
      let suggestions = [];
      try {
        suggestions = JSON.parse(openaiResponse.text);
      } catch (e) {
        console.error('Error parsing OpenAI suggestions:', e);
        suggestions = [];
      }
      
      // Salva in cache
      await redisService.cacheResponse(cacheKey, suggestions, REVIEW_RESPONSE_CACHE_TTL);
      
      return suggestions;
    } catch (openaiError) {
      console.error('Error generating suggestions with both providers:', openaiError);
      return [];
    }
  }
};

/**
 * Rileva la lingua di un testo
 * @param {string} text Testo da analizzare
 * @returns {string} Codice della lingua rilevata
 */
const detectLanguage = (text) => {
  const { franc } = require('franc-min');
  return franc(text);
};

module.exports = {
  getAnthropicClient,
  getOpenAIClient,
  generateAIResponse,
  generateSuggestions,
  detectLanguage
}; 