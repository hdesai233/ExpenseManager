import Anthropic from '@anthropic-ai/sdk';
import type { AiProvider, Category } from '../types';

// ---- LLM categorization fallback (§4.4 step 3) ----
// Privacy: only merchant names are sent — never amounts, dates, or accounts.
// Results are cached as learned rules by the caller so a merchant is never queried twice.
//
// Two interchangeable backends. Both get the same system prompt, the same taxonomy, and are
// pinned to a JSON schema, so switching providers doesn't change the shape of what comes back.

export interface ApiCategorization {
  merchant: string;
  categoryId: string | null;
  subcategoryId: string | null;
  confidence: number;
}

export interface AiProviderDef {
  key: AiProvider;
  label: string;
  model: string;
  keyPlaceholder: string;
  keyUrl: string;
}

export const AI_PROVIDERS: AiProviderDef[] = [
  {
    key: 'anthropic',
    label: 'Claude',
    model: 'claude-opus-4-8',
    keyPlaceholder: 'sk-ant-…',
    keyUrl: 'console.anthropic.com',
  },
  {
    key: 'gemini',
    label: 'Gemini',
    model: 'gemini-2.5-flash',
    keyPlaceholder: 'AIza…',
    keyUrl: 'aistudio.google.com/apikey',
  },
];

export function providerDef(provider: AiProvider): AiProviderDef {
  return AI_PROVIDERS.find(p => p.key === provider) ?? AI_PROVIDERS[0];
}

const SYSTEM_PROMPT =
  'You classify merchant names from bank statements into spending categories. ' +
  'Use only the category and subcategory ids provided. If a merchant is genuinely ambiguous, ' +
  'use null for category_id. Confidence is 0 to 1.';

function buildTaxonomy(categories: Category[]): string {
  return categories
    .filter(c => !c.parentId)
    .map(c => {
      const subs = categories.filter(s => s.parentId === c.id).map(s => s.id);
      return `${c.id}${subs.length ? ` (subcategories: ${subs.join(', ')})` : ''}`;
    })
    .join('\n');
}

function buildUserPrompt(merchants: string[], categories: Category[]): string {
  return `Categories:\n${buildTaxonomy(categories)}\n\nClassify these merchants:\n${merchants.map(m => `- ${m}`).join('\n')}`;
}

interface RawResult {
  merchant: string;
  category_id: string | null;
  subcategory_id: string | null;
  confidence: number;
}

/** Parse the model's JSON payload and clamp it into our own shape. */
function normalizeResults(text: string): ApiCategorization[] {
  let parsed: { results?: RawResult[] };
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('The model returned a response that was not valid JSON.');
  }
  if (!Array.isArray(parsed.results)) return [];
  return parsed.results.map(r => ({
    merchant: String(r.merchant ?? ''),
    categoryId: r.category_id ?? null,
    subcategoryId: r.subcategory_id ?? null,
    confidence: Math.min(Math.max(Number(r.confidence) || 0, 0), 1),
  }));
}

/** Dispatch to whichever backend the user selected in Settings. */
export async function categorizeMerchants(
  provider: AiProvider,
  apiKey: string,
  merchants: string[],
  categories: Category[],
): Promise<ApiCategorization[]> {
  return provider === 'gemini'
    ? categorizeWithGemini(apiKey, merchants, categories)
    : categorizeWithClaude(apiKey, merchants, categories);
}

// ---- Anthropic / Claude ----

async function categorizeWithClaude(apiKey: string, merchants: string[], categories: Category[]): Promise<ApiCategorization[]> {
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });

  const schema = {
    type: 'object' as const,
    properties: {
      results: {
        type: 'array' as const,
        items: {
          type: 'object' as const,
          properties: {
            merchant: { type: 'string' as const },
            category_id: { type: ['string', 'null'] as const },
            subcategory_id: { type: ['string', 'null'] as const },
            confidence: { type: 'number' as const },
          },
          required: ['merchant', 'category_id', 'subcategory_id', 'confidence'],
          additionalProperties: false,
        },
      },
    },
    required: ['results'],
    additionalProperties: false,
  };

  const response = await client.messages.create({
    model: providerDef('anthropic').model,
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    output_config: { format: { type: 'json_schema', schema } },
    messages: [{ role: 'user', content: buildUserPrompt(merchants, categories) }],
  });

  const block = response.content.find(b => b.type === 'text');
  if (!block || block.type !== 'text') return [];
  return normalizeResults(block.text);
}

// ---- Google / Gemini ----
// Called over plain REST rather than pulling in a second SDK: one fetch, no bundle cost, and
// no browser-environment escape hatch to opt into. The key travels in a header, never the URL.

async function categorizeWithGemini(apiKey: string, merchants: string[], categories: Category[]): Promise<ApiCategorization[]> {
  const model = providerDef('gemini').model;

  // Gemini's responseSchema is an OpenAPI subset: uppercase type names, `nullable` instead of
  // a union type, and no `additionalProperties`.
  const responseSchema = {
    type: 'OBJECT',
    properties: {
      results: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            merchant: { type: 'STRING' },
            category_id: { type: 'STRING', nullable: true },
            subcategory_id: { type: 'STRING', nullable: true },
            confidence: { type: 'NUMBER' },
          },
          required: ['merchant', 'category_id', 'subcategory_id', 'confidence'],
        },
      },
    },
    required: ['results'],
  };

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: 'user', parts: [{ text: buildUserPrompt(merchants, categories) }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema,
          maxOutputTokens: 8192,
        },
      }),
    },
  );

  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const message = body?.error?.message ?? `${response.status} ${response.statusText}`;
    throw new Error(message);
  }

  const parts = body?.candidates?.[0]?.content?.parts;
  const text = Array.isArray(parts) ? parts.map((p: { text?: string }) => p.text ?? '').join('') : '';
  if (!text) return [];
  return normalizeResults(text);
}
