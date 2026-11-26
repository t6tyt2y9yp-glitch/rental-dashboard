import { GoogleGenAI } from "@google/genai";

const MODEL = "gemini-4-hydrogen";

const SYSTEM_INSTRUCTION = `Analyze this handwritten rental receipt or notebook ledger page.
Extract ALL of these fields:
1. unit: the tenant or unit identifier next to "RECEIVED from" (e.g. "9n", "9N", "Unit 1"). Copy as written.
2. current_kwh: the current kWh meter reading number only (e.g. 666 from "666 Kwh").
3. payment_date: the receipt date as ISO YYYY-MM-DD (e.g. "2026-11-18" from "Date: November 18, 2026").
4. rent_paid: the rent peso amount as a number (e.g. 2500 from "₱2,500 + ₱126").
5. electricity_paid: the electricity peso amount as a number (e.g. 126).
6. billing_period: ALWAYS extract the period text from "As payment for" / "payment for" (e.g. "October - November 2026", "Oct - Nov 2026"). Copy the period as written when readable. If the billing period is missing, blank, cut off, or unreadable, return null (not an empty string and not a guess).
7. total_paid: the total peso amount paid as a number (e.g. 2626).

Return ONLY a raw JSON object with exactly these keys:
unit (string), current_kwh (number|null), payment_date (string|null), rent_paid (number|null), electricity_paid (number|null), billing_period (string|null), total_paid (number|null).
Do not use markdown or code fences.
If a field is missing, use an empty string for unit/payment_date strings, null for billing_period when unreadable/missing, or null for numbers.`;

type ReceiptExtraction = {
  unit: string;
  current_kwh: number | null;
  payment_date: string | null;
  rent_paid: number | null;
  electricity_paid: number | null;
  billing_period: string | null;
  total_paid: number | null;
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

function toNullableString(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  const text = String(value).trim();
  return text ? text : null;
}

function toIsoDate(value: unknown): string | null {
  const text = toNullableString(value);
  if (!text) {
    return null;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return text;
  }

  const parsed = Date.parse(text);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  return new Date(parsed).toISOString().slice(0, 10);
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
  const unit =
    toNullableString(record.unit) ??
    toNullableString(record.unitName) ??
    "";
  const current_kwh =
    toNullableNumber(record.current_kwh) ??
    toNullableNumber(record.currentReading);
  const payment_date = toIsoDate(record.payment_date);
  const rent_paid = toNullableNumber(record.rent_paid);
  const electricity_paid = toNullableNumber(record.electricity_paid);
  const billing_period = toNullableString(record.billing_period);
  const total_paid =
    toNullableNumber(record.total_paid) ?? toNullableNumber(record.amountPaid);

  if (current_kwh === null) {
    throw new Error("The receipt did not include a kWh reading.");
  }

  return {
    unit,
    current_kwh,
    payment_date,
    rent_paid,
    electricity_paid,
    billing_period,
    total_paid,
  };
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
          required: [
            "unit",
            "current_kwh",
            "payment_date",
            "rent_paid",
            "electricity_paid",
            "billing_period",
            "total_paid",
          ],
          properties: {
            unit: { type: "string" },
            current_kwh: {
              anyOf: [{ type: "number" }, { type: "null" }],
            },
            payment_date: {
              anyOf: [{ type: "string" }, { type: "null" }],
            },
            rent_paid: {
              anyOf: [{ type: "number" }, { type: "null" }],
            },
            electricity_paid: {
              anyOf: [{ type: "number" }, { type: "null" }],
            },
            billing_period: {
              anyOf: [{ type: "string" }, { type: "null" }],
            },
            total_paid: {
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
