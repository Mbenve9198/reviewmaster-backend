const Anthropic = require('@anthropic-ai/sdk');
const Rule = require('../models/rule.model');
const User = require('../models/user.model');
const Hotel = require('../models/hotel.model');
const Review = require('../models/review.model');
const creditService = require('../services/creditService');

const anthropic = new Anthropic({
    apiKey: process.env.CLAUDE_API_KEY
});

const generateThemeAnalysisPrompt = (hotel, reviews) => {
    return `You are an advanced AI assistant specializing in hotel review analysis and response strategy generation. Your task is to analyze reviews for ${hotel.name} and create response guidelines that will help generate contextually appropriate responses.

IMPORTANT: You must respond ONLY with a valid JSON object. Do not include any explanatory text before or after the JSON.

Here are the reviews to analyze:
${JSON.stringify(reviews, null, 2)}

Before generating the final output, please analyze:

1. Overall sentiment patterns
2. Recurring themes and topics
3. Cultural and linguistic nuances
4. Guest expectations and pain points
5. Unique selling points mentioned
6. Common misunderstandings or issues
7. Positive aspects frequently highlighted

Guidelines for creating response strategies:

1. Text-based Rules (recurringThemes):
   - Identify key topics (breakfast, cleanliness, staff, etc.)
   - For each topic, create guidelines on:
     * What aspects to acknowledge
     * What hotel policies or features to highlight
     * How to address concerns
     * What specific information to include
   - Consider both positive and negative mentions
   - Include multilingual considerations

2. Rating-based Rules (ratingBasedRules):
   - Create specific response strategies for each rating level
   - Focus on:
     * What aspects to prioritize in the response
     * How to acknowledge the rating
     * What specific hotel features to emphasize
     * How to handle criticism or praise
     * What type of future-oriented statements to include

3. Complex Rules (complexRules):
   - Create guidelines for complex scenarios like:
     * Mixed feedback (positive + negative)
     * Specific combinations of issues
     * Seasonal or event-related feedback
     * Special circumstances
   - Include instructions on:
     * How to balance different aspects
     * What elements to prioritize
     * How to structure the response

4. Language Rules:
   - Create cultural and linguistic guidelines for each language
   - Include:
     * Cultural sensitivity points
     * Formal vs informal approach
     * Key phrases to include/avoid
     * Cultural context considerations

REMEMBER: Return ONLY a JSON object with exactly this structure. The response.text should contain GUIDELINES for responding, not actual response templates:

{
  "analysis": {
    "recurringThemes": [
      {
        "theme": string,
        "frequency": number,
        "exampleQuote": string,
        "suggestedRule": {
          "name": string,
          "condition": {
            "field": "content.text",
            "operator": "contains" | "not_contains" | "equals",
            "value": string[]
          },
          "response": {
            "text": string, // GUIDELINES on how to respond, not a template
            "settings": {
              "style": "professional" | "friendly" | "personal" | "sarcastic" | "challenging"
            }
          },
          "isActive": true
        }
      }
    ],
    "ratingBasedRules": [
      {
        "ratingCondition": string,
        "frequency": number,
        "exampleQuote": string,
        "suggestedRule": {
          "name": string,
          "condition": {
            "field": "content.rating",
            "operator": "equals" | "greater_than" | "less_than",
            "value": number
          },
          "response": {
            "text": string, // GUIDELINES on how to handle this rating level
            "settings": {
              "style": "professional" | "friendly" | "personal" | "sarcastic" | "challenging"
            }
          },
          "isActive": true
        }
      }
    ],
    "complexRules": [
      {
        "scenario": string,
        "frequency": number,
        "exampleQuote": string,
        "suggestedRule": {
          "name": string,
          "condition": {
            "field": "content.text",
            "operator": "contains",
            "value": string[]
          },
          "response": {
            "text": string, // GUIDELINES for handling complex scenarios
            "settings": {
              "style": "professional" | "friendly" | "personal" | "sarcastic" | "challenging"
            }
          },
          "isActive": true
        }
      }
    ],
    "languageRules": [
      {
        "language": "it" | "en" | "de" | "fr",
        "frequency": number,
        "suggestedRule": {
          "name": string,
          "condition": {
            "field": "content.language",
            "operator": "equals",
            "value": string
          },
          "response": {
            "text": string, // Cultural and linguistic guidelines
            "settings": {
              "style": "professional" | "friendly" | "personal" | "sarcastic" | "challenging"
            }
          },
          "isActive": true
        }
      }
    ]
  }
}

IMPORTANT NOTE ABOUT RULE VALUES: For the "value" field in text-based conditions, use ONLY ONE CONCEPTUAL TOPIC instead of multiple keywords. The AI will interpret the semantic meaning of the topic without needing to match specific keywords. For example, use ["breakfast"] instead of ["colazione", "breakfast", "caffè"].

Example of a good guideline (not a template):
"When guests mention breakfast quality issues, address their specific concerns, explain our quality control process, highlight our fresh ingredients policy, mention any recent or planned improvements, and invite them to try our breakfast during their next stay. If they mentioned specific items, acknowledge those specifically."

Example of what NOT to do (template):
"Dear {reviewer_name}, thank you for your feedback about our breakfast. We source fresh ingredients daily and our chef prepares everything fresh each morning..."`;
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
            
            // Utilizza il servizio centralizzato per verificare i crediti
            const creditStatus = await creditService.checkCredits(hotelId);
            if (!creditStatus.hasCredits || creditStatus.credits < creditCost) {
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

            // Variabile per tenere traccia dello stato della risposta
            let responseHasBeenSent = false;

            try {
                // Consuma i crediti attraverso il servizio centralizzato
                const creditsConsumed = await creditService.consumeCredits(
                    hotelId, 
                    'review_analysis', 
                    null, 
                    'Theme analysis'
                );

                if (!creditsConsumed) {
                    return res.status(403).json({ 
                        message: 'Failed to consume credits. Please try again later.',
                        type: 'CREDIT_ERROR'
                    });
                }

                // Aggiorna lo stato dei crediti dopo il consumo
                const updatedCreditStatus = await creditService.checkCredits(hotelId);
                
                // Imposta il flag che indica che una risposta è stata inviata
                responseHasBeenSent = true;
                
                // Invia la risposta al client
                res.json({ 
                    analysis: JSON.parse(analysis),
                    reviewsAnalyzed: reviews.length,
                    creditsRemaining: updatedCreditStatus.credits
                });
            } catch (error) {
                console.error('Credit operation error:', error);
                if (!responseHasBeenSent) {
                    return res.status(500).json({ 
                        message: 'Error processing credits', 
                        error: error.message 
                    });
                }
            }
        } catch (error) {
            console.error('Error in themeAnalysis:', error);
            return res.status(500).json({ 
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