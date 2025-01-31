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
            
            // Determina il prompt in base al tipo di richiesta
            let systemPrompt;
            if (previousMessages) {
                systemPrompt = `Sei un esperto analista del settore hospitality che sta avendo una conversazione con un albergatore.
                
CONTESTO HOTEL:
Nome: ${hotel.name}
Tipo: ${hotel.type}
Descrizione: ${hotel.description}

STILE DI RISPOSTA:
- Rispondi in modo conversazionale e naturale
- Focalizzati specificamente sulla domanda posta
- Non ripetere l'intera analisi strutturata
- Evita di usare sezioni formattate o titoli
- Usa i dati a supporto delle tue argomentazioni ma in modo naturale
- Mantieni un tono professionale ma amichevole
- Se citi recensioni, integrare le citazioni nel discorso
- Se menzioni statistiche, fallo in modo conversazionale

ESEMPIO DI RISPOSTA NATURALE:
"Guardando i dati delle recensioni, il problema del rumore è stato menzionato da 15 ospiti, principalmente per due motivi: l'isolamento tra le camere e i rumori dalla strada. Un ospite ha scritto che 'anche se la camera era all'ultimo piano, i rumori dalla strada erano molto evidenti'. Considerando che l'hotel ha 25 camere, suggerirei..."

CONTESTUALIZZAZIONE:
- Considera sempre la dimensione e il tipo di hotel nelle tue risposte
- Adatta i suggerimenti alle reali possibilità della struttura
- Mantieni le raccomandazioni pratiche e realizzabili

Rispondi alla domanda dell'utente tenendo presente questo contesto e queste linee guida.`;
            } else {
                systemPrompt = `Sei un esperto analista del settore hospitality con oltre 20 anni di esperienza. Analizza ${reviews.length} recensioni da ${platforms.join(', ')} per la struttura ${hotel.name} (${hotel.type}).

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
- Opportunità di sviluppo realistiche per questa tipologia di struttura`;
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
                                content: previousMessages ? 
                                    `Contesto dell'analisi precedente:\n${JSON.stringify(analysisData, null, 2)}\n\nDomanda dell'utente: ${previousMessages}` :
                                    `${systemPrompt}\n\nDati da analizzare:\n${JSON.stringify(analysisData, null, 2)}`
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
                                content: previousMessages ? 
                                    `Contesto dell'analisi precedente:\n${JSON.stringify(analysisData, null, 2)}\n\nDomanda dell'utente: ${previousMessages}` :
                                    `Recensioni da analizzare:\n${JSON.stringify(analysisData, null, 2)}`
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