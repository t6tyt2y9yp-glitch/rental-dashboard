import { GoogleGenAI } from "@google/genai";

const MODEL = "gemini-4-hydrogen";

const SYSTEM_INSTRUCTION = `Analyze this handwritten rent receipt or notebook ledger.
Extract both of these values:
1. unitName: the tenant or unit identifier, usually written next to "RECEIVED from". Copy it as written. Examples: "9N", "Unit 1", "Unit 9".
2. currentReading: the current kWh reading. Examples: "666 Kwh", "666 kWh". Return only the number, without the unit.
Return ONLY a raw JSON object with exactly two keys: "unitName" (string) and "currentReading" (number).
Do not use markdown, code fences, or any other keys.
If the unit identifier is missing, use an empty string. If the kWh reading is missing, use null.`;

type ReceiptExtraction = {
  unitName: string;
  currentReading: number;
};

const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
]);

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

function parseImage(body: unknown): { data: string; mimeType: string } | null {
  if (!body || typeof body !== "object") {
    return null;
  }

  const record = body as Record<string, unknown>;
  const rawImage = record.image ?? record.imageBase64;
  if (typeof rawImage !== "string" || rawImage.trim().length === 0) {
    return null;
  }

  let mimeType =
    typeof record.mimeType === "string" ? record.mimeType.toLowerCase() : "";
  let data = rawImage.trim();

  const dataUrl = /^data:(image\/[a-z0-9.+-]+);base64,([\s\S]+)$/i.exec(data);
  if (dataUrl) {
    mimeType = dataUrl[1].toLowerCase();
    data = dataUrl[2];
  }

  data = data.replace(/\s/g, "");
  if (!mimeType) {
    mimeType = "image/jpeg";
  }

  if (!ALLOWED_MIME_TYPES.has(mimeType) || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) {
    return null;
  }

  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  const bytes = (data.length * 3) / 4 - padding;
  if (!Number.isFinite(bytes) || bytes <= 0 || bytes > MAX_IMAGE_BYTES) {
    return null;
  }

  return { data, mimeType };
}

function toNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "string") {
    const normalized = value.replace(/,/g, "").replace(/[^\d.-]/g, "");
    if (normalized === "" || normalized === "-" || normalized === ".") {
      return null;
    }
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function parseReceipt(text: string): ReceiptExtraction {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  const jsonText = fenced?.[1] ?? trimmed;
  const parsed: unknown = JSON.parse(jsonText);

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Model response was not a JSON object.");
  }

  const record = parsed as Record<string, unknown>;
  const unitName =
    typeof record.unitName === "string"
      ? record.unitName.trim()
      : record.unitName == null
        ? ""
        : String(record.unitName).trim();
  const currentReading = toNullableNumber(record.currentReading);

  if (currentReading === null) {
    throw new Error("The receipt did not include a kWh reading.");
  }

  return { unitName, currentReading };
}

function publicErrorMessage(error: unknown, apiKey: string) {
  const message =
    error instanceof Error ? error.message : "Receipt extraction failed.";
  return message.split(apiKey).join("[redacted]");
}

export async function POST(request: Request) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return jsonError("Server is missing GEMINI_API_KEY.", 500);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Request body must be JSON.", 400);
  }

  const image = parseImage(body);
  if (!image) {
    return jsonError(
      "Expected a base64 image in the image field, optionally as a data URL.",
      400,
    );
  }

  try {
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: MODEL,
      contents: [
        {
          inlineData: {
            mimeType: image.mimeType,
            data: image.data,
          },
        },
      ],
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        responseMimeType: "application/json",
        responseJsonSchema: {
          type: "object",
          additionalProperties: false,
          required: ["unitName", "currentReading"],
          properties: {
            unitName: { type: "string" },
            currentReading: {
              anyOf: [{ type: "number" }, { type: "null" }],
            },
          },
        },
      },
    });

    if (!response.text) {
      return jsonError("Model returned an empty response.", 502);
    }

    return Response.json(parseReceipt(response.text));
  } catch (error) {
    return jsonError(publicErrorMessage(error, apiKey), 502);
  }
}
