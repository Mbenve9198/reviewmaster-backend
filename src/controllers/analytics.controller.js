const Anthropic = require('@anthropic-ai/sdk');
const OpenAI = require('openai');
const Review = require('../models/review.model');
const User = require('../models/user.model');
const Hotel = require('../models/hotel.model');

const anthropic = new Anthropic({
    apiKey: process.env.CLAUDE_API_KEY
});

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

const analyticsController = {
    analyzeReviews: async (req, res) => {
        try {
            const { reviews, previousMessages } = req.body;
            const userId = req.userId;

            // Verifica l'utente e calcola il costo dei crediti
            const user = await User.findById(userId);
            if (!user) {
                return res.status(404).json({ message: 'User not found' });
            }

            // Calcola il costo dei crediti in base al tipo di richiesta
            let creditCost;
            if (previousMessages) {
                creditCost = 1; // Follow-up question
            } else {
                // Prima analisi
                creditCost = reviews.length <= 100 ? 10 : 15;
            }

            // Verifica se l'utente ha crediti disponibili
            const totalCreditsAvailable = (user.wallet?.credits || 0) + (user.wallet?.freeScrapingRemaining || 0);
            if (totalCreditsAvailable < creditCost) {
                return res.status(403).json({ 
                    message: 'Insufficient credits available. Please purchase more credits to continue.',
                    type: 'NO_CREDITS'
                });
            }

            if (!Array.isArray(reviews) || reviews.length === 0) {
                return res.status(400).json({ 
                    message: 'Reviews array is required and must not be empty' 
                });
            }

            // Ottieni i dettagli dell'hotel
            const hotel = await Hotel.findById(reviews[0].hotelId);
            if (!hotel) {
                return res.status(404).json({ 
                    message: 'Hotel not found' 
                });
            }

            const reviewsData = reviews.map(review => ({
                content: review.content?.text || '',
                rating: review.content?.rating || 0,
                date: review.metadata?.originalCreatedAt || new Date().toISOString(),
                platform: review.metadata?.platform || 'unknown'
            }));

            // Aggiungi i dettagli dell'hotel ai dati da analizzare
            const analysisData = {
                reviews: reviewsData,
                hotel: {
                    name: hotel.name,
                    type: hotel.type,
                    description: hotel.description
                }
            };

            // Calcola alcune statistiche di base
            const avgRating = (reviewsData.reduce((acc, r) => acc + r.rating, 0) / reviews.length).toFixed(1);
            const platforms = [...new Set(reviewsData.map(r => r.platform))];
            
            // Determina se è una domanda di follow-up
            let systemPrompt;
            if (previousMessages) {
                // Prompt conversazionale per follow-up
                systemPrompt = `Sei un esperto analista del settore hospitality con oltre 20 anni di esperienza.
Rispondi alla domanda dell'utente in modo conversazionale e naturale, considerando sempre il contesto della struttura:

CONTESTO STRUTTURA:
${hotel.name} (${hotel.type})
${hotel.description}

Mantieni le risposte:
- Concrete e pratiche
- Specifiche per questa struttura
- Realistiche considerando dimensione e risorse
- Supportate da dati quando possibile
- In tono professionale ma conversazionale`;
            } else {
                // Prompt originale per la prima analisi
                systemPrompt = `Sei un esperto analista del settore hospitality con oltre 20 anni di esperienza.
Analizza ${reviews.length} recensioni da ${platforms.join(', ')} per la struttura ${hotel.name} (${hotel.type}).

CONTESTO STRUTTURA:
${hotel.description}

Considera attentamente la dimensione, il tipo e le caratteristiche della struttura descritte sopra quando proponi soluzioni e migliorie. Adatta budget e tempi di implementazione in base alla tipologia e dimensione della struttura.

FORMATO OUTPUT RICHIESTO:
====================
📊 PANORAMICA
====================
- Rating medio: ${avgRating}/5
- Recensioni analizzate: ${reviews.length}
- Periodo: [data più vecchia] - [data più recente]
- Piattaforme: ${platforms.join(', ')}

====================
⚠️ PROBLEMI CHIAVE
====================
[Per ogni problema con almeno 3 menzioni]

PROBLEMA: [Titolo]
Frequenza: [X recensioni su ${reviews.length}]
> "[citazione più rappresentativa]"
Impatto: [ALTO/MEDIO/BASSO]

SOLUZIONE PROPOSTA:
- Azione concreta da implementare (considerando dimensione e risorse della struttura)
- Tempo stimato per implementazione
- Costo stimato (€/€€/€€€)
- ROI atteso
- Fattibilità basata sul contesto della struttura

====================
💪 PUNTI DI FORZA
====================
[Per ogni punto di forza citato frequentemente]

PUNTO DI FORZA: [Titolo]
Menzionato in: [X recensioni]
> "[citazione più efficace per marketing]"
Come valorizzarlo:
- Suggerimento per marketing adatto alla dimensione della struttura
- Opportunità di sviluppo realistiche per questa tipologia di struttura

LINEE GUIDA:
- Usa dati quantitativi dove possibile
- Cita SEMPRE la fonte (es: "menzionato in 5 recensioni su Booking")
- NO pattern se menzionati meno di 3 volte
- Prioritizza per impatto sul business
- Suggerisci solo azioni concrete e fattibili per questa specifica struttura
- Se non ci sono dati sufficienti per un'analisi, specificalo
- Inserisci sempre una citazione testuale per ogni punto
- Considera sempre il contesto e le dimensioni della struttura nelle raccomandazioni`;
            }

            // Funzione di retry con delay esponenziale
            const retryWithExponentialBackoff = async (fn, maxRetries = 3, initialDelay = 1000) => {
                for (let i = 0; i < maxRetries; i++) {
                    try {
                        return await fn();
                    } catch (error) {
                        if (error?.error?.type === 'overloaded_error' && i < maxRetries - 1) {
                            const delay = initialDelay * Math.pow(2, i);
                            await new Promise(resolve => setTimeout(resolve, delay));
                            continue;
                        }
                        throw error;
                    }
                }
            };

            let analysis;
            let provider;
            
            // Prima prova con Claude
            try {
                const message = await retryWithExponentialBackoff(async () => {
                    return await anthropic.messages.create({
                        model: "claude-3-5-sonnet-20241022",
                        max_tokens: 4000,
                        temperature: 0,
                        system: systemPrompt,
                        messages: [
                            {
                                role: "user",
                                content: `${systemPrompt}\n\nDati da analizzare:\n${JSON.stringify(analysisData, null, 2)}`
                            }
                        ]
                    });
                });

                if (message?.content?.[0]?.text) {
                    analysis = message.content[0].text;
                    provider = 'claude';
                }
            } catch (claudeError) {
                console.log('Claude failed, trying OpenAI:', claudeError);
                
                // Fallback a OpenAI
                try {
                    const completion = await openai.chat.completions.create({
                        model: "gpt-4o",
                        messages: [
                            {
                                role: "system",
                                content: systemPrompt
                            },
                            {
                                role: "user",
                                content: `Recensioni da analizzare:\n${JSON.stringify(analysisData, null, 2)}`
                            }
                        ],
                        temperature: 0,
                        max_tokens: 4000
                    });

                    if (completion?.choices?.[0]?.message?.content) {
                        analysis = completion.choices[0].message.content;
                        provider = 'gpt4';
                    }
                } catch (openaiError) {
                    console.error('OpenAI fallback failed:', openaiError);
                    throw new Error('Both AI services failed to generate analysis');
                }
            }

            if (!analysis) {
                throw new Error('Failed to generate analysis from both AI services');
            }

            // Solo dopo aver verificato che l'analisi è stata generata con successo, scala i crediti
            let freeCreditsToDeduct = Math.min(user.wallet?.freeScrapingRemaining || 0, creditCost);
            let paidCreditsToDeduct = creditCost - freeCreditsToDeduct;

            await User.findByIdAndUpdate(userId, {
                $inc: { 
                    'wallet.credits': -paidCreditsToDeduct,
                    'wallet.freeScrapingRemaining': -freeCreditsToDeduct
                }
            });

            res.json({ 
                analysis,
                reviewsAnalyzed: reviews.length,
                avgRating,
                platforms,
                creditsRemaining: totalCreditsAvailable - creditCost,
                provider
            });

        } catch (error) {
            console.error('Analysis error:', error);
            res.status(500).json({ 
                message: 'Error analyzing reviews',
                error: error.message 
            });
        }
    }
};

module.exports = analyticsController;