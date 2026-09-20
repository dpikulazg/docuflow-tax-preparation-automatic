# DocuFlow Tax Preparation Automatic

  - Invoice number (Broj računa)
  - Date (Datum računa)
  - Due date (Datum dospijeća)
  - Total amount (Ukupni iznos) in EUR
  - Currency (Valuta)
  - Supplier Name (Naziv prodavatelja/dobavljača)
  - Supplier OIB (OIB prodavatelja)
  - Supplier IBAN (IBAN prodavatelja)
  - Buyer Name (Naziv kupca)
  - Buyer OIB (OIB kupca)
  - Payment Model (Model plaćanja, npr. HR01)
  - Payment Reference (Poziv na broj primatelja)
  - Tax rates (PDV stope: 25%, 13%, 5%) and their amounts
  - Items (Stavke) with description, quantity, unit price, and tax rate.
  


**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Copy [.env.example](.env.example) to `.env.local` and configure the Gemini and Cloudflare values.
3. Enable R2 in the Cloudflare Dashboard, then create the bucket named in `wrangler.jsonc`:
   `npx wrangler r2 bucket create docuflow-files`
4. Configure Cloudflare Access with Google sign-in for the deployed hostname.
5. Apply the database migration:
   `npx wrangler d1 migrations apply docuflow --remote`
6. Deploy:
   `npm run deploy`
7. Run locally:
   `npm run dev`

Cloudflare Access must be enabled before the API can return a session. R2 cannot be created by Wrangler until R2 is enabled for the account.

For local development, use `wrangler dev` after configuring local Access headers or deploy to a Cloudflare hostname.
