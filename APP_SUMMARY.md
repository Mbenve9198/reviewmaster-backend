1. Application Overview
This application is a hotel management and review analysis platform that allows hotel owners and managers to manage their properties, integrate third-party review platforms, analyze customer feedback using AI, and handle billing and subscription services.

Main Technologies Used
Frontend: Next.js, React, Tailwind CSS, TypeScript, Framer Motion
Backend: Node.js, Express.js, MongoDB, Mongoose, Stripe API, Apify (web scraping), OpenAI & Anthropic API (AI analytics)
Other Integrations: Stripe (billing), Google, Booking.com, TripAdvisor (reviews)
2. Frontend Architecture
Framework & Libraries
Framework: Next.js (React-based)
UI Library: Tailwind CSS, Lucide Icons, Framer Motion (animations)
State Management: Custom hooks (useAuth, useWallet, useUserStats, useReviews)
Styling: Tailwind CSS
Routing: Next.js file-based routing
Data Fetching: fetch API, useEffect hooks, Next.js API routes
Key Components
Authentication: Login, signup, email verification, reset password
Billing: Stripe integration for subscription plans
Hotel Settings: Manage multiple hotel properties and AI-generated responses
Integrations: Connect Google, Booking.com, TripAdvisor for review aggregation
Analytics Dashboard: AI-driven sentiment analysis for reviews
User Interface Components: Cards, buttons, chat bubbles, modals, tables, pagination, toasts
Routing Structure
/login
/signup
/billing
/hotel-settings/[id]
/integrations
/reviews
/rules
/verify-email
3. Backend Architecture
Framework & Libraries
Framework: Node.js with Express.js
Database: MongoDB (Mongoose ORM)
Authentication: JWT-based authentication with bcrypt password hashing
Payments & Subscriptions: Stripe API integration
AI & Web Scraping: OpenAI, Anthropic AI, Apify Service (for automated review scraping)
API Structure & Endpoints
Authentication (auth.controller.js)
POST /api/auth/register – Register new users
POST /api/auth/login – Authenticate users
GET /api/auth/profile – Fetch user profile
POST /api/auth/request-password-reset – Request password reset
POST /api/auth/reset-password – Reset user password
Hotel Management (hotel.controller.js)
GET /api/hotels – List all hotels
GET /api/hotels/:id – Get a specific hotel
POST /api/hotels – Create a new hotel
PUT /api/hotels/:id – Update hotel details
Review Management (review.controller.js)
GET /api/reviews – Fetch reviews for a hotel
POST /api/reviews/sync – Sync reviews from third-party platforms
POST /api/reviews/analyze – AI-based review analysis
Billing & Subscriptions (stripe.webhook.js)
Handles Stripe webhooks for checkout.session.completed, customer.subscription.updated, and customer.subscription.deleted
Updates user subscription status in MongoDB
Integration with Third-Party Platforms (integration.controller.js)
POST /api/integrations/setup – Connect Google, Booking, TripAdvisor
POST /api/integrations/sync – Fetch latest reviews
Uses Apify for scraping reviews
Database Schema
Users
_id, email, password, subscription, wallet
Hotels
_id, name, description, managerName, reviews
Reviews
_id, hotelId, rating, content, platform
Integrations
_id, hotelId, platform, placeId, url, status
Authentication & Authorization
JWT-based authentication
Middleware-based role & access control
4. Integration Points
Frontend & Backend Communication
Uses Next.js API routes and standard fetch() calls
JWT is used for authentication on API requests
Webhooks for Stripe subscription updates
Third-Party Services Integrated
Google, Booking, TripAdvisor for review data
Stripe for subscription billing
OpenAI & Anthropic Claude AI for review analysis
Apify for web scraping
5. Key Features
Authentication & User Management
User registration, login, email verification
JWT authentication and session handling
Hotel & Review Management
Manage multiple hotels
Sync and analyze customer reviews
AI-powered sentiment analysis
Billing & Subscription
Stripe integration for different pricing tiers
Subscription management via Stripe webhooks
Integration with Third-Party Review Platforms
Connect Google, Booking.com, TripAdvisor
Automatic review fetching and syncing
AI-Powered Analytics
Sentiment analysis using OpenAI & Anthropic Claude
Actionable insights from customer reviews
6. Development Workflow
Build & Deployment
Frontend: Deployed via Vercel
Backend: Hosted on Render.com
Database: MongoDB Atlas
CI/CD Pipeline: Not explicitly mentioned, but can be added with GitHub Actions
Testing Strategy
Unit tests for controllers and services
Integration tests for API endpoints
Manual testing for frontend UI interactions
7. Potential Areas for Improvement or Expansion
1. Performance Optimization
Reduce API response time by implementing caching (Redis)
Optimize database queries (add indexing for high-traffic collections)
2. Enhancing AI Analysis
Implement fine-tuned AI models for more accurate sentiment analysis
Improve prompt engineering for better review insights
3. User Dashboard Enhancements
Add more analytics (engagement metrics, trends)
Improve UI/UX for better usability
4. Additional Review Integrations
Expand to new platforms (e.g., Yelp, Trustpilot)
Allow CSV imports for offline reviews
5. Automation & Notification System
Implement push notifications for new reviews
Automate email alerts for review trends