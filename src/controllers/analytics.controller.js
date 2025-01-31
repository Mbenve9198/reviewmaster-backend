const Anthropic = require('@anthropic-ai/sdk');
const OpenAI = require('openai');
const Review = require('../models/review.model');
const User = require('../models/user.model');

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

            const reviewsData = reviews.map(review => ({
                content: review.content?.text || '',
                rating: review.content?.rating || 0,
                date: review.metadata?.originalCreatedAt || new Date().toISOString(),
                platform: review.metadata?.platform || 'unknown'
            }));

            // Calcola alcune statistiche di base
            const avgRating = (reviewsData.reduce((acc, r) => acc + r.rating, 0) / reviews.length).toFixed(1);
            const platforms = [...new Set(reviewsData.map(r => r.platform))];
            
            const systemPrompt = `Sei un esperto analista del settore hospitality con oltre 20 anni di esperienza.
Analizza ${reviews.length} recensioni da ${platforms.join(', ')} e fornisci insights strategici.

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
- Azione concreta da implementare
- Tempo stimato per implementazione
- Costo stimato (€/€€/€€€)
- ROI atteso

====================
💪 PUNTI DI FORZA
====================
[Per ogni punto di forza citato frequentemente]

PUNTO DI FORZA: [Titolo]
Menzionato in: [X recensioni]
> "[citazione più efficace per marketing]"
Come valorizzarlo:
- Suggerimento per marketing
- Opportunità di sviluppo

LINEE GUIDA:
- Usa dati quantitativi dove possibile
- Cita SEMPRE la fonte (es: "menzionato in 5 recensioni su Booking")
- NO pattern se menzionati meno di 3 volte
- Prioritizza per impatto sul business
- Suggerisci solo azioni concrete e fattibili
- Se non ci sono dati sufficienti per un'analisi, specificalo
- Inserisci sempre una citazione testuale per ogni punto`;

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
                                content: `${systemPrompt}\n\nRecensioni da analizzare:\n${JSON.stringify(reviewsData, null, 2)}`
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
                                content: `Recensioni da analizzare:\n${JSON.stringify(reviewsData, null, 2)}`
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