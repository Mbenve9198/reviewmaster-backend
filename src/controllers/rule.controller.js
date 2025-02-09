const Anthropic = require('@anthropic-ai/sdk');
const Rule = require('../models/rule.model');
const User = require('../models/user.model');
const Hotel = require('../models/hotel.model');
const Review = require('../models/review.model');

const anthropic = new Anthropic({
    apiKey: process.env.CLAUDE_API_KEY
});

const generateThemeAnalysisPrompt = (hotel, reviews) => {
    return `You are an advanced AI assistant specializing in hotel review analysis and automatic response rule generation. Your task is to analyze a set of reviews for ${hotel.name} and create a comprehensive set of automatic response rules.

IMPORTANT: You must respond ONLY with a valid JSON object. Do not include any explanatory text before or after the JSON.

Here are the reviews to analyze:
${JSON.stringify(reviews, null, 2)}

Before generating the final output, please perform a thorough analysis considering:

1. Overall sentiment and rating distribution
2. Recurring themes with example quotes
3. Unique or unexpected feedback requiring special attention
4. Language distribution and cultural considerations
5. Trends over time or seasonality
6. Interaction between different factors (rating, amenities, language)
7. Ways to make rules more specific and contextual

Guidelines for rule generation:

1. Text-based Rules (recurringThemes):
   - Identify common topics and subtopics (breakfast, cleanliness, staff, etc.)
   - Create both positive and negative variants with different sentiment degrees
   - Use "contains" for inclusive rules
   - Use "not_contains" for excluding specific terms
   - Include multilingual keywords when relevant
   - Consider seasonal variations

2. Rating-based Rules (ratingBasedRules):
   - Create specific rules for each rating (1-5 stars)
   - Use different response styles based on rating:
     * 1-2 stars: "professional" style for damage control
     * 3 stars: "personal" style to understand concerns
     * 4-5 stars: "friendly" style to enhance positivity
   - Use "equals", "greater_than", "less_than" operators
   - Consider rating ranges and combinations with specific topics

3. Complex Rules (complexRules):
   - Combine multiple factors (content, sentiment, rating, amenities)
   - Create rules for common scenarios and unique situations
   - Use appropriate keywords and response styles
   - Consider stay timing and circumstances

4. Language Rules:
   - Create language-specific responses
   - Ensure cultural appropriateness
   - Include common hospitality phrases
   - Consider regional variations

5. Response Text Guidelines:
   - Always include relevant placeholders:
     * {reviewer_name} for personalization
     * {hotel_name} for branding
     * {rating} when referencing scores
     * {mentioned_amenity} for specific features
   - Vary response length based on complexity
   - Include specific references to mentioned items
   - Add follow-up invitations when appropriate
   - Offer solutions for negative feedback

6. Style Selection Guidelines:
   - "professional": formal complaints, serious issues
   - "friendly": positive feedback, regular interactions
   - "personal": emotional content, special occasions
   - "sarcastic": light issues (use sparingly)
   - "challenging": when clarification needed

7. Use actual data from reviews:
   - Count real frequencies
   - Extract genuine quotes
   - Consider seasonal patterns
   - Account for recent trends

8. Prioritization:
   - Focus on high-frequency patterns
   - Prioritize recent reviews
   - Consider business impact
   - Balance positive and negative feedback

REMEMBER: Return ONLY a JSON object with exactly this structure, with no additional text:

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
            "text": string,
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
            "text": string,
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
            "text": string,
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
            "text": string,
            "settings": {
              "style": "professional" | "friendly" | "personal" | "sarcastic" | "challenging"
            }
          },
          "isActive": true
        }
      }
    ]
  }
}`;
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