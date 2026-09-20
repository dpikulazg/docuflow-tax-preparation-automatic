# Copilot Instructions for DocuFlow Tax Preparation Automatic

## Project overview
This repository is a Vite + React single-page app for managing invoice documents in a tax/accounting workflow. The main user flow is: upload invoice PDF/image, run AI extraction, review/correct extracted data, and persist the result in Firebase Firestore. The app is designed around tenant-based access and document review workflows, not a generic CRUD app.

## Setup and validation commands
Use the project scripts from `package.json` rather than ad hoc commands.

- Install dependencies:
  npm install
- Local app startup:
  npm run dev
- Type-check / lint:
  npm run lint
- Production build:
  npm run build
- Preview/deploy:
  npm run preview
  npm run deploy

Environment variables are required before running locally. Copy `.env.example` to `.env.local` and fill in the Firebase and Gemini values. The app reads `VITE_*` vars from the browser and the Gemini key is exposed via `vite.config.ts` using `process.env.GEMINI_API_KEY`.

There is no dedicated test runner or test script in this repo. For validation, use `npm run lint` (TypeScript check) and `npm run build`.

## High-level architecture
- `src/App.tsx` is the main application shell and state orchestrator. It handles:
  - Firebase auth state (`onAuthStateChanged`)
  - user/profile fetching and tenant initialization
  - role-based document access (`admin`, `accountant`, `firm_user`, `legal`)
  - live Firestore subscriptions via `onSnapshot`
  - drag-and-drop invoice upload and AI recognition flow
- `src/lib/firebase.ts` initializes the Firebase app, auth, and Firestore with the configured database ID.
- `src/lib/gemini.ts` contains the Google GenAI invoice extraction pipeline. It sends a structured prompt and expects JSON output for invoice fields such as invoice number, totals, tax rates, and item lines.
- `src/components/InvoiceDetail.tsx` contains the review/edit UI for an extracted invoice. This is where users correct OCR results, update payment status, and add audit/feedback records.
- `src/types.ts` defines the app’s domain model: user profiles, tenant profiles, documents, recognized invoice data, audit entries, and OCR feedback.
- `src/components/ui/*` is the shadcn-style UI layer; most app visuals use Tailwind classes plus the component primitives in this directory.
- `vite.config.ts` wires in Vite React, Tailwind, and the Cloudflare Vite plugin for local preview/deploy flows.

## Key conventions in this codebase
- Firebase data model is entity-oriented, not JSON-API oriented. The app stores `users`, `tenants`, and `documents` as top-level collections, and uses document IDs and nested subcollections such as `documents/{id}/ocrFeedback` for correction records.
- Auth and profile setup are tightly coupled. On first login, `fetchProfile` creates a default tenant and profile if the user has no Firestore record yet.
- Role-aware access is enforced in the React layer, not purely through Firestore rules. For example, accountants subscribe to only the managed tenant set in `profile.managedTenants` and `clients`.
- Document creation is currently driven by local file reading + Gemini extraction in the `onDrop` flow. Files are base64-encoded and passed to `recognizeInvoice`, then inserted as a Firestore document with a `serverTimestamp()` createdAt.
- Data updates are lightweight and optimistic: form edits write directly to Firestore and related fields are updated by path-based property writes such as `recognizedData.invoiceNumber`.
- Styling uses Tailwind CSS and shadcn-compatible component primitives. Prefer extending existing UI primitives instead of creating ad hoc styling in component code.
- Most environment configuration is explicit and browser-facing: use `VITE_` prefixes for web app config, and keep Cloudflare/Vite integration aligned with the commands in `package.json`.

## When making changes
- Prefer modifying existing app-level abstractions (`App.tsx`, `src/lib/*`, `src/components/*`) instead of introducing a parallel architecture.
- Keep Firebase schema and data contracts aligned with `src/types.ts` when touching document/user data.
- Preserve the role-based and tenant-scoped data access patterns already used in the main app state.
- Keep AI extraction outputs structured as the schema expected by `src/lib/gemini.ts` and the `RecognizedData` type.
- Maintain consistency with the existing Tailwind/shadcn component patterns in `src/components/ui`.
