const Anthropic = require('@anthropic-ai/sdk');

const analyticsController = {
    analyzeReviews: async (req, res) => {
        try {
            const { reviews, prompt } = req.body;
            const userId = req.userId;

            if (!Array.isArray(reviews) || reviews.length === 0) {
                return res.status(400).json({ 
                    message: 'Reviews array is required and must not be empty' 
                });
            }

            const reviewsData = reviews.map(review => ({
                content: review.content?.text || '',
                rating: review.content?.rating || 0,
                date: review.metadata?.originalCreatedAt || new Date().toISOString(),
                platform: review.platform || 'unknown'
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
- Inserisci sempre una citazione testuale per ogni punto

Rispondi nella stessa lingua del prompt.`;

            const message = await anthropic.messages.create({
                model: "claude-3-5-sonnet-20241022",
                max_tokens: 4000,
                temperature: 0,
                system: systemPrompt,
                messages: [
                    {
                        role: "user",
                        content: `${prompt}\n\nRecensioni da analizzare:\n${JSON.stringify(reviewsData, null, 2)}`
                    }
                ]
            });

            if (!message?.content?.[0]?.text) {
                throw new Error('Invalid response from AI');
            }

            res.json({ 
                analysis: message.content[0].text,
                reviewsAnalyzed: reviews.length,
                avgRating,
                platforms
            });

        } catch (error) {
            console.error('Review analysis error:', error);
            res.status(500).json({ 
                message: 'Error analyzing reviews',
                error: error.message 
            });
        }
    }
};

module.exports = analyticsController;