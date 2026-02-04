# Stripe Subscription Setup (Test Mode)

This project supports Stripe subscriptions without real bank linking. Use Stripe test mode and test cards.

## 1. Install Stripe CLI (optional but recommended)
- Download: https://stripe.com/docs/stripe-cli#install
- Authenticate: `stripe login`

## 2. Create Products and Prices (test mode)
- Go to https://dashboard.stripe.com/test/products
- Create two products: "Basic" and "Premium"
- For each product, add a recurring price (e.g., monthly)
- Copy the `price_...` IDs for both plans

## 3. Configure environment variables
Create a `.env` file in the project root:

```
PORT=3000
NODE_ENV=development
SESSION_SECRET=replace_with_a_secure_random_string


STRIPE_SECRET_KEY=<STRIPE_SECRET_KEY>
STRIPE_PRICE_BASIC=<PRICE_ID_BASIC>
STRIPE_PRICE_PREMIUM=<PRICE_ID_PREMIUM>
STRIPE_WEBHOOK_SECRET=<WEBHOOK_SECRET>
```
- `STRIPE_SECRET_KEY`: Stripe test secret key from https://dashboard.stripe.com/test/developers
- `STRIPE_PRICE_BASIC`, `STRIPE_PRICE_PREMIUM`: Price IDs from step 2
- `STRIPE_WEBHOOK_SECRET`: See step 4

## 4. Webhook for subscription status
Run the listener and copy the webhook secret:

```
stripe listen --forward-to localhost:3000/webhooks/stripe
```

This prints a webhook secret. Paste it into `.env` as `STRIPE_WEBHOOK_SECRET` (use the value shown by the CLI).

> If you skip the webhook, checkout works but subscription status won't sync automatically. You can still test checkout redirection.

## 5. Start the app

```
npm install
npm start
```

Go to `/pages/pricing`, pick a plan, and proceed to Stripe Checkout using a test card:
- 4242 4242 4242 4242
- Any future expiry, any CVC, any name

## 6. Manage subscription
Optionally call:
- `POST /api/billing/create-portal-session` (requires login) to open Stripe Customer Portal.

## Notes
- Premium features (e.g., DOCX export) are gated and require `subscriptionStatus = active`. The webhook updates this status.
- This integration is test-mode only. No bank account is needed. Replace keys with live ones when ready.
