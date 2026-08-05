# Sitaara Verify

Multilingual document OCR and property-verification workspace for Indian land records.

## What is implemented

- PDF and image upload with the original page on the left.
- Clean, searchable, re-typeset text on the right.
- Server-side Gemini OCR for printed and handwritten Indian scripts.
- Conservative low-confidence handwriting review before legal text is accepted.
- Local persistence of the uploaded file, OCR response, and confirmed corrections.
- Delete removes the uploaded document and OCR response from browser storage.
- Print-to-PDF export of the reviewed reading-order document.
- OpenStreetMap plot overlay with editable coordinates and transparency.

## Setup

Requirements: Node.js 22.13 or newer.

```powershell
npm install
Copy-Item .env.example .env.local
npm run dev
```

Create a new Gemini API key in Google AI Studio, then set it only in `.env.local`:

```dotenv
GEMINI_API_KEY=your_new_key
GEMINI_OCR_MODEL=gemini-3.6-flash
```

Never prefix the key with `NEXT_PUBLIC_`, embed it in `app/page.tsx`, or commit `.env.local`. The browser uploads the selected document to `/api/ocr/gemini`; that server-only route calls Gemini and returns normalized OCR data. Inline uploads are capped at 19 MB.

For Vercel, create the same two environment variables in Project Settings → Environment Variables. Redeploy after adding or rotating the key.

## Accuracy and privacy policy

Gemini output is assistive OCR, not verified legal evidence. Lines below the confidence threshold remain editable and highlighted until a reviewer confirms them against the original scan.

Documents are transmitted to Google for processing. The API key stays on the application server, but the workflow is not local/private OCR. Review the Google API data-use settings before processing sensitive property records; the Gemini free tier can use submitted content to improve products.

## Verification

```powershell
npm run lint
npm test
```
