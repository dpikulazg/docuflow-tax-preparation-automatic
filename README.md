

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
2. Copy [.env.example](.env.example) to `.env.local` and set the Gemini and Firebase values
3. Run the app:
   `npm run dev`
