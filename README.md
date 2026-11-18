# GODIA PRIME PAY

A new standalone payment-collection project for Safaricom M-PESA.

## Included in this starter

- `public/index.html` — mobile-friendly frontend with customer-local storage, STK Push interface placeholder, USSD assistance, favourite banner and notification centre.
- `src/index.js` — Cloudflare Worker starter with a health endpoint and static asset serving.
- `wrangler.toml` — Cloudflare Workers configuration.
- `migrations/0001_initial.sql` — initial database schema for customers and payment records (not applied automatically).

## Important status

This is a starter repository, not a live payment system yet.

- The STK Push button is deliberately not connected until production Daraja credentials, callback handling, validation and payment reconciliation are configured securely.
- The USSD action opens `*334#` on the phone running the app. It does not remotely open USSD on a customer's phone.
- A customer must authorize every M-PESA payment. Never collect or store an M-PESA PIN.
- Do not put Daraja consumer secrets, passkeys, access tokens or other credentials in frontend files or GitHub.
- Actual STK Push requests and payment confirmations require internet access for the backend.

## First GitHub upload

Upload the contents of this ZIP into your private repository `GODIA-PRIME-PAY`, keeping the folder structure.

## Cloudflare setup

1. Create a new Cloudflare Worker for this project.
2. Connect this GitHub repository or deploy with Wrangler.
3. Configure the Worker asset binding and D1 database only after reviewing the schema.
4. Add Daraja production credentials as encrypted Worker secrets, never as plain text in `wrangler.toml`.
5. Configure the Safaricom callback URL and verify callbacks before recording a payment as successful.

## Local preview

Open `public/index.html` in a browser for a frontend preview. Some mobile browser features, including dialing USSD, depend on the device and browser.
