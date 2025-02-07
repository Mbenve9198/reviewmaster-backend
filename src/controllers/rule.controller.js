const Anthropic = require('@anthropic-ai/sdk');
const Rule = require('../models/rule.model');
const User = require('../models/user.model');
const Hotel = require('../models/hotel.model');
const Review = require('../models/review.model');

const anthropic = new Anthropic({
    apiKey: process.env.CLAUDE_API_KEY
});

const generateThemeAnalysisPrompt = (hotel, reviews) => {
    return `Analizza queste recensioni dell'hotel ${hotel.name} e identifica modelli ricorrenti per creare regole di risposta automatica. 
    Restituisci un oggetto JSON con questa struttura esatta:

{
  "meta": {
    "hotelName": "${hotel.name}",
    "reviewCount": ${reviews.length},
    "languages": ["it", "en", "de"]
  },
  "recurringThemes": [
    {
      "theme": "Colazione",
      "sentiment": "positive",
      "frequency": 45,
      "keywords": ["colazione", "breakfast", "cornetti"],
      "exampleQuote": "La colazione era ottima e abbondante",
      "suggestedRule": {
        "name": "Apprezzamento Colazione",
        "condition": {
          "field": "content.text",
          "operator": "contains",
          "value": ["colazione", "breakfast"]
        },
        "response": {
          "text": "Grazie per aver apprezzato la nostra colazione! Ci impegniamo ogni giorno per offrire prodotti freschi e di qualità...",
          "settings": {
            "style": "friendly",
            "length": "medium"
          }
        }
      }
    }
  ],
  "commonIssues": [
    {
      "issue": "Rumore strada",
      "frequency": 28,
      "keywords": ["rumoroso", "traffico", "noisy"],
      "exampleQuote": "Camera rumorosa a causa del traffico",
      "suggestedRule": {
        "name": "Gestione Lamentele Rumore",
        "condition": {
          "field": "content.text",
          "operator": "contains",
          "value": ["rumore", "rumoroso", "noisy"]
        },
        "response": {
          "text": "Ci scusiamo per il disagio causato dal rumore. Stiamo implementando migliorie per l'insonorizzazione...",
          "settings": {
            "style": "professional",
            "length": "long"
          }
        }
      }
    }
  ],
  "ratingBasedRules": [
    {
      "rating": 5,
      "frequency": 120,
      "suggestedRule": {
        "name": "Risposta 5 stelle",
        "condition": {
          "field": "content.rating",
          "operator": "equals",
          "value": 5
        },
        "response": {
          "text": "Siamo davvero felici che il suo soggiorno sia stato eccellente...",
          "settings": {
            "style": "friendly",
            "length": "medium"
          }
        }
      }
    }
  ]
}

Linee guida:
1. Usa dati reali dalle recensioni per tutte le metriche
2. Includi citazioni testuali dalle recensioni
3. Proponi regole specifiche e pertinenti
4. Considera le diverse lingue delle recensioni
5. Bilancia tra regole basate sul testo e sul rating
6. Proponi risposte che rispecchino lo stile dell'hotel

Recensioni da analizzare: ${JSON.stringify(reviews, null, 2)}`;
};

const ruleController = {
    analyzeThemes: async (req, res) => {
        try {
            const { hotelId } = req.params;
            const userId = req.userId;

            // Verifica utente e crediti
            const user = await User.findById(userId);
            if (!user) {
                return res.status(404).json({ message: 'User not found' });
            }

            const creditCost = 10;
            const totalCreditsAvailable = (user.wallet?.credits || 0) + (user.wallet?.freeScrapingRemaining || 0);
            
            if (totalCreditsAvailable < creditCost) {
                return res.status(403).json({ 
                    message: 'Insufficient credits. Please purchase more credits to continue.',
                    type: 'NO_CREDITS'
                });
            }

            // Verifica hotel e recupera recensioni
            const hotel = await Hotel.findOne({ _id: hotelId, userId });
            if (!hotel) {
                return res.status(404).json({ message: 'Hotel not found' });
            }

            const reviews = await Review.find({ hotelId })
                .select('content.text content.rating content.language metadata.originalCreatedAt')
                .sort({ 'metadata.originalCreatedAt': -1 })
                .limit(200)
                .lean();

            if (reviews.length === 0) {
                return res.status(400).json({ 
                    message: 'No reviews found for analysis' 
                });
            }

            // Genera l'analisi con Claude
            const message = await anthropic.messages.create({
                model: "claude-3-5-sonnet-20241022",
                max_tokens: 4000,
                temperature: 0,
                system: "You are an expert hospitality industry analyst.",
                messages: [
                    {
                        role: "user",
                        content: generateThemeAnalysisPrompt(hotel, reviews)
                    }
                ]
            });

            let analysis;
            if (message?.content?.[0]?.text) {
                analysis = message.content[0].text;
                if (analysis.includes('```')) {
                    analysis = analysis.replace(/```json\n?|\n?```/g, '').trim();
                }

                // Verifica JSON valido
                try {
                    JSON.parse(analysis);
                } catch (e) {
                    console.error('Invalid JSON response from AI:', e);
                    throw new Error('AI returned invalid JSON format');
                }
            }

            // Deduci i crediti
            let freeCreditsToDeduct = Math.min(user.wallet?.freeScrapingRemaining || 0, creditCost);
            let paidCreditsToDeduct = creditCost - freeCreditsToDeduct;

            await User.findByIdAndUpdate(userId, {
                $inc: { 
                    'wallet.credits': -paidCreditsToDeduct,
                    'wallet.freeScrapingRemaining': -freeCreditsToDeduct
                }
            });

            res.json({ 
                analysis: JSON.parse(analysis),
                reviewsAnalyzed: reviews.length,
                creditsRemaining: totalCreditsAvailable - creditCost
            });

        } catch (error) {
            console.error('Theme analysis error:', error);
            res.status(500).json({ 
                message: 'Error analyzing themes',
                error: error.message 
            });
        }
    },

    createRule: async (req, res) => {
        try {
            // Log per debugging
            console.log('Received request body:', JSON.stringify(req.body, null, 2));

            const { hotelId, name, condition, response, isActive } = req.body;
            const userId = req.userId;

            // Verifica autorizzazione hotel
            const hotel = await Hotel.findOne({ _id: hotelId, userId });
            if (!hotel) {
                return res.status(404).json({ message: 'Hotel not found' });
            }

            // Crea la regola con la struttura esatta ricevuta dal frontend
            const rule = new Rule({
                hotelId,
                name,
                condition,
                response,
                isActive
            });

            console.log('Rule to be saved:', JSON.stringify(rule, null, 2));

            const savedRule = await rule.save();
            console.log('Saved rule:', JSON.stringify(savedRule, null, 2));
            
            res.status(201).json(savedRule);

        } catch (error) {
            console.error('Create rule error:', error);
            // Log più dettagliato dell'errore
            if (error.errors) {
                console.error('Validation errors:', JSON.stringify(error.errors, null, 2));
            }
            res.status(500).json({ 
                message: 'Error creating rule',
                error: error.message,
                details: error.errors
            });
        }
    },

    getRules: async (req, res) => {
        try {
            const { hotelId } = req.params;
            const userId = req.userId;

            const hotel = await Hotel.findOne({ _id: hotelId, userId });
            if (!hotel) {
                return res.status(404).json({ message: 'Hotel not found' });
            }

            const rules = await Rule.find({ hotelId }).sort({ priority: -1 });
            res.json(rules);

        } catch (error) {
            console.error('Get rules error:', error);
            res.status(500).json({ message: 'Error fetching rules' });
        }
    },

    updateRule: async (req, res) => {
        try {
            const { ruleId } = req.params;
            const { name, condition, response } = req.body;
            const userId = req.userId;

            const rule = await Rule.findById(ruleId).populate({
                path: 'hotelId',
                select: 'userId'
            });

            if (!rule) {
                return res.status(404).json({ message: 'Rule not found' });
            }

            if (rule.hotelId.userId.toString() !== userId) {
                return res.status(403).json({ message: 'Unauthorized' });
            }

            Object.assign(rule, {
                name,
                condition,
                response
            });

            await rule.save();
            res.json(rule);

        } catch (error) {
            console.error('Update rule error:', error);
            res.status(500).json({ message: 'Error updating rule' });
        }
    },

    toggleRule: async (req, res) => {
        try {
            const { ruleId } = req.params;
            const { isActive } = req.body;
            const userId = req.userId;

            const rule = await Rule.findById(ruleId).populate({
                path: 'hotelId',
                select: 'userId'
            });

            if (!rule) {
                return res.status(404).json({ message: 'Rule not found' });
            }

            if (rule.hotelId.userId.toString() !== userId) {
                return res.status(403).json({ message: 'Unauthorized' });
            }

            rule.isActive = isActive;
            await rule.save();
            
            res.json(rule);

        } catch (error) {
            console.error('Toggle rule error:', error);
            res.status(500).json({ message: 'Error toggling rule' });
        }
    },

    deleteRule: async (req, res) => {
        try {
            const { ruleId } = req.params;
            const userId = req.userId;

            const rule = await Rule.findById(ruleId).populate({
                path: 'hotelId',
                select: 'userId'
            });

            if (!rule) {
                return res.status(404).json({ message: 'Rule not found' });
            }

            if (rule.hotelId.userId.toString() !== userId) {
                return res.status(403).json({ message: 'Unauthorized' });
            }

            await Rule.deleteOne({ _id: ruleId });
            res.json({ message: 'Rule deleted successfully' });

        } catch (error) {
            console.error('Delete rule error:', error);
            res.status(500).json({ message: 'Error deleting rule' });
        }
    }
};

module.exports = ruleController; 