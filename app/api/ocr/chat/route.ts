export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const { question, documentText, fields, filename } = await request.json() as {
      question: string;
      documentText: string;
      fields?: Array<{ label: string; value: string }>;
      filename?: string;
    };

    if (!question || !question.trim()) {
      return Response.json({ error: "Please enter a valid question." }, { status: 400 });
    }

    const apiKey = process.env.GEMINI_API_KEY;

    const fieldsContext = fields?.length
      ? fields.map((f) => `- ${f.label}: ${f.value}`).join("\n")
      : "No structured fields extracted.";

    const systemPrompt = `You are Sitaara AI, an expert Indian Property Verification Assistant.
Answer the user's question accurately based strictly on the provided property document text and extracted metadata.

Document Filename: ${filename || "Uploaded Document"}
Extracted Metadata Fields:
${fieldsContext}

Full Extracted Document OCR Text:
"""
${documentText || "No document text available."}
"""

Guidelines:
- Provide clear, concise, and helpful answers.
- Highlight exact names, plot/survey numbers, village/tehsil/district, areas, and dates where applicable.
- If information is not found in the document, state clearly that it is not present in the record.
- Use bullet points for structured lists if helpful.`;

    if (!apiKey) {
      // Intelligent local fallback if API key is not configured
      const qLower = question.toLowerCase();
      let answer = "";
      if (qLower.includes("owner") || qLower.includes("holder") || qLower.includes("name")) {
        const ownerField = fields?.find((f) => f.label.toLowerCase().includes("owner") || f.label.toLowerCase().includes("applicant"));
        answer = ownerField ? `The recorded owner is **${ownerField.value}**.` : "Owner details extracted from document text.";
      } else if (qLower.includes("survey") || qLower.includes("khasra") || qLower.includes("plot")) {
        const surveyField = fields?.find((f) => f.label.toLowerCase().includes("survey") || f.label.toLowerCase().includes("khasra"));
        answer = surveyField ? `The survey / plot reference is **${surveyField.value}**.` : "Survey number mentioned in the document text.";
      } else if (qLower.includes("area") || qLower.includes("size") || qLower.includes("extent")) {
        const areaField = fields?.find((f) => f.label.toLowerCase().includes("area") || f.label.toLowerCase().includes("extent"));
        answer = areaField ? `The parcel size / area is **${areaField.value}**.` : "Extent specified in document details.";
      } else {
        answer = `Based on document "${filename || "Uploaded Scan"}": The document has been digitized. Configure GEMINI_API_KEY for dynamic generative Q&A across complex Indian legal scripts.`;
      }
      return Response.json({ answer, sources: fields?.slice(0, 3) || [] });
    }

    const model = process.env.GEMINI_OCR_MODEL || "gemini-3.6-flash";
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        contents: [{
          role: "user",
          parts: [{ text: `${systemPrompt}\n\nUser Question: ${question}` }],
        }],
        generationConfig: { temperature: 0.2 },
      }),
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(`Gemini API returned ${response.status}`);
    }

    const payload = await response.json();
    const answer = payload?.candidates?.[0]?.content?.parts?.[0]?.text || "No response generated.";

    return Response.json({ answer });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Q&A request failed.";
    return Response.json({ error: message }, { status: 500 });
  }
}
