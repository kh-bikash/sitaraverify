export const runtime = "edge";
export const dynamic = "force-dynamic";

const MAX_INLINE_BYTES = 19 * 1024 * 1024;
const DEFAULT_MODEL = "gemini-3.6-flash";

type UnknownRecord = Record<string, unknown>;

function bufferToBase64(buffer: ArrayBuffer): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(buffer).toString("base64");
  }
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
  }
  return btoa(binary);
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numberOr(value: unknown, fallback: number) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function textOrEmpty(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function parseModelJson(value: string) {
  const unfenced = value.replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
  const start = unfenced.indexOf("{");
  const end = unfenced.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("Gemini did not return structured OCR data.");
  return JSON.parse(unfenced.slice(start, end + 1)) as unknown;
}

function mimeTypeFor(file: File) {
  if (file.type) return file.type;
  const lowerName = file.name.toLowerCase();
  if (lowerName.endsWith(".pdf")) return "application/pdf";
  if (lowerName.endsWith(".png")) return "image/png";
  if (lowerName.endsWith(".webp")) return "image/webp";
  if (lowerName.endsWith(".tif") || lowerName.endsWith(".tiff")) return "image/tiff";
  return "image/jpeg";
}

function promptFor(language: string) {
  return `You are the OCR engine for an Indian property-document verification system.

Transcribe EVERY visible printed and handwritten line from every page. Preserve the original Unicode script, spelling, numbers, line order, and page order. The expected language selection is "${language}", but the document may mix English with Hindi, Marathi, Tamil, Telugu, Kannada, Bengali, Assamese, Gujarati, Punjabi, Malayalam, Odia, Urdu, Sanskrit, or other Indian languages.

Critical legal-document rules:
- Never silently correct a name, plot number, survey number, date, amount, or boundary.
- Never invent missing text. Write "[illegible]" for text that cannot be read.
- Mark handwriting with handwritten=true.
- Give a conservative confidence from 0 to 1. Use less than 0.68 whenever a reviewer should compare the line with the scan.
- Bounding boxes use [x1,y1,x2,y2] coordinates normalized to a 0-1000 page.
- Extract property fields only when explicitly visible. Do not infer them.

Return ONLY valid JSON matching this shape:
{
  "language": "detected languages",
  "pages": [
    {
      "page": 1,
      "width": 1000,
      "height": 1000,
      "lines": [
        {"text": "exact text", "confidence": 0.91, "box": [0,0,0,0], "handwritten": false}
      ],
      "layout_blocks": [
        {"label": "text|title|table|form|header|footer", "content": "exact block text", "box": [0,0,0,0], "order": 1}
      ]
    }
  ],
  "table_count": 0,
  "fields": [
    {"label": "Survey / plot number", "value": "exact visible value", "type": "survey_number", "confidence": 0.9}
  ]
}`;
}

function normalizeResult(raw: unknown, filename: string, model: string, elapsedSeconds: number) {
  if (!isRecord(raw)) throw new Error("Gemini returned an invalid OCR object.");
  const rawPages = Array.isArray(raw.pages) ? raw.pages : [];
  const pages = rawPages.flatMap((rawPage, pageIndex) => {
    if (!isRecord(rawPage)) return [];
    const rawLines = Array.isArray(rawPage.lines) ? rawPage.lines : [];
    const lines = rawLines.flatMap((rawLine) => {
      if (!isRecord(rawLine)) return [];
      const text = textOrEmpty(rawLine.text);
      if (!text) return [];
      const handwritten = rawLine.handwritten === true;
      const confidence = clamp(numberOr(rawLine.confidence, handwritten ? 0.55 : 0.82), 0, 1);
      const rawBox = Array.isArray(rawLine.box) ? rawLine.box.slice(0, 4) : [];
      const box = rawBox.length === 4 ? rawBox.map((item) => clamp(numberOr(item, 0), 0, 1000)) : [0, 0, 0, 0];
      return [{ text, confidence, box }];
    });
    const rawBlocks = Array.isArray(rawPage.layout_blocks) ? rawPage.layout_blocks : [];
    const layoutBlocks = rawBlocks.flatMap((rawBlock, blockIndex) => {
      if (!isRecord(rawBlock)) return [];
      const content = textOrEmpty(rawBlock.content);
      if (!content) return [];
      const rawBox = Array.isArray(rawBlock.box) ? rawBlock.box.slice(0, 4) : [];
      return [{
        label: textOrEmpty(rawBlock.label) || "text",
        content,
        box: rawBox.length === 4 ? rawBox.map((item) => clamp(numberOr(item, 0), 0, 1000)) : [0, 0, 0, 0],
        order: Math.max(1, Math.round(numberOr(rawBlock.order, blockIndex + 1))),
      }];
    });
    const pageNumber = Math.max(1, Math.round(numberOr(rawPage.page, pageIndex + 1)));
    const text = lines.map((line) => line.text).join("\n");
    const confidence = lines.length ? lines.reduce((sum, line) => sum + line.confidence, 0) / lines.length : 0;
    return [{
      page: pageNumber,
      width: Math.max(1, numberOr(rawPage.width, 1000)),
      height: Math.max(1, numberOr(rawPage.height, 1000)),
      lines,
      layout_blocks: layoutBlocks,
      text,
      confidence,
    }];
  });
  if (!pages.length) throw new Error("Gemini did not detect any document pages.");

  const rawFields = Array.isArray(raw.fields) ? raw.fields : [];
  const fields = rawFields.flatMap((rawField) => {
    if (!isRecord(rawField)) return [];
    const value = textOrEmpty(rawField.value);
    if (!value) return [];
    return [{
      label: textOrEmpty(rawField.label) || "Extracted field",
      value,
      type: textOrEmpty(rawField.type) || "other",
      confidence: clamp(numberOr(rawField.confidence, 0.65), 0, 1),
    }];
  });
  const allLines = pages.flatMap((page) => page.lines);
  const confidence = allLines.length ? allLines.reduce((sum, line) => sum + line.confidence, 0) / allLines.length : 0;

  return {
    filename,
    engine: model,
    language: textOrEmpty(raw.language) || "Auto · India",
    warning: "Gemini transcription is an assistive result. Confirm handwriting and all legal identifiers against the original scan before export.",
    elapsed_seconds: elapsedSeconds,
    confidence,
    line_count: allLines.length,
    layout_block_count: pages.reduce((sum, page) => sum + page.layout_blocks.length, 0),
    table_count: Math.max(0, Math.round(numberOr(raw.table_count, 0))),
    fields,
    text: pages.map((page) => page.text).join("\n\n"),
    pages,
  };
}

export async function POST(request: Request) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return Response.json({ detail: "Gemini OCR is not configured. Add GEMINI_API_KEY to the server environment." }, { status: 503 });
  }

  try {
    const form = await request.formData();
    const file = form.get("file");
    const language = textOrEmpty(form.get("language")) || "auto-india";
    if (!(file instanceof File)) return Response.json({ detail: "Upload a PDF or image file." }, { status: 400 });
    if (file.size === 0) return Response.json({ detail: "The uploaded file is empty." }, { status: 400 });
    if (file.size > MAX_INLINE_BYTES) {
      return Response.json({ detail: "Gemini inline OCR accepts files up to 19 MB in this application." }, { status: 413 });
    }

    const model = process.env.GEMINI_OCR_MODEL?.trim() || DEFAULT_MODEL;
    const startedAt = performance.now();
    const data = bufferToBase64(await file.arrayBuffer());
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        contents: [{
          role: "user",
          parts: [
            { text: promptFor(language) },
            { inline_data: { mime_type: mimeTypeFor(file), data } },
          ],
        }],
        generationConfig: { temperature: 0 },
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(25000),
    });
    const payload = await response.json().catch(() => null) as UnknownRecord | null;
    if (!response.ok) {
      const apiError = payload && isRecord(payload.error) ? textOrEmpty(payload.error.message) : "";
      throw new Error(apiError || `Gemini returned HTTP ${response.status}.`);
    }
    const candidates = payload && Array.isArray(payload.candidates) ? payload.candidates : [];
    const firstCandidate = isRecord(candidates[0]) ? candidates[0] : null;
    const content = firstCandidate && isRecord(firstCandidate.content) ? firstCandidate.content : null;
    const parts = content && Array.isArray(content.parts) ? content.parts : [];
    const responseText = parts.map((part) => isRecord(part) ? textOrEmpty(part.text) : "").filter(Boolean).join("\n");
    if (!responseText) throw new Error("Gemini returned an empty OCR response.");
    const raw = parseModelJson(responseText);
    const elapsedSeconds = Math.round((performance.now() - startedAt) / 100) / 10;
    return Response.json(normalizeResult(raw, file.name, model, elapsedSeconds), {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Gemini OCR failed.";
    return Response.json({ detail: message }, { status: 502 });
  }
}
