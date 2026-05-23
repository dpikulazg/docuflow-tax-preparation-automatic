import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export async function recognizeInvoice(base64Image: string, mimeType: string) {
  const prompt = `Extract data from this Croatian invoice (Račun). 
  Focus on:
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
  
  Return the data in a structured JSON format.`;

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: [
      {
        parts: [
          { text: prompt },
          { inlineData: { data: base64Image, mimeType } }
        ]
      }
    ],
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          invoiceNumber: { type: Type.STRING },
          date: { type: Type.STRING },
          dueDate: { type: Type.STRING },
          totalAmount: { type: Type.NUMBER },
          currency: { type: Type.STRING },
          supplierName: { type: Type.STRING },
          supplierOib: { type: Type.STRING },
          supplierIban: { type: Type.STRING },
          buyerName: { type: Type.STRING },
          buyerOib: { type: Type.STRING },
          paymentModel: { type: Type.STRING },
          paymentReference: { type: Type.STRING },
          taxRates: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                rate: { type: Type.NUMBER },
                amount: { type: Type.NUMBER }
              }
            }
          },
          items: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                description: { type: Type.STRING },
                quantity: { type: Type.NUMBER },
                unitPrice: { type: Type.NUMBER },
                taxRate: { type: Type.NUMBER }
              }
            }
          }
        }
      }
    }
  });

  return JSON.parse(response.text);
}
