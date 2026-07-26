import Anthropic from '@anthropic-ai/sdk';
import type { Account, AiProvider, Category } from '../types';
import { buildAccountContext, buildCategoryContext, DATE_RANGE_TOKENS, type DateRangeToken, type FilterSpec } from './nlquery';
import { todayISO } from './format';

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
  /** Built-in default. Overridable per provider in Settings — see `modelFor`. */
  model: string;
  /** Other known-good ids, offered in Settings so a stale default isn't a code change. */
  alternateModels: string[];
  keyPlaceholder: string;
  keyUrl: string;
}

export const AI_PROVIDERS: AiProviderDef[] = [
  {
    key: 'anthropic',
    label: 'Claude',
    model: 'claude-opus-4-8',
    alternateModels: ['claude-sonnet-5', 'claude-haiku-4-5-20251001'],
    keyPlaceholder: 'sk-ant-…',
    keyUrl: 'console.anthropic.com',
  },
  {
    key: 'gemini',
    label: 'Gemini',
    model: 'gemini-3.6-flash',
    alternateModels: ['gemini-3.5-flash-lite'],
    keyPlaceholder: 'AIza…',
    keyUrl: 'aistudio.google.com/apikey',
  },
];

export function providerDef(provider: AiProvider): AiProviderDef {
  return AI_PROVIDERS.find(p => p.key === provider) ?? AI_PROVIDERS[0];
}

/**
 * The model to actually call: a user override from Settings if present, else the built-in default.
 * Providers retire model ids on their own schedule, so this is deliberately editable at runtime —
 * a newer model shouldn't require rebuilding the app.
 */
export function modelFor(provider: AiProvider, overrides?: Partial<Record<AiProvider, string>>): string {
  return overrides?.[provider]?.trim() || providerDef(provider).model;
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
  model?: string,
): Promise<ApiCategorization[]> {
  const resolved = model?.trim() || providerDef(provider).model;
  return provider === 'gemini'
    ? categorizeWithGemini(apiKey, merchants, categories, resolved)
    : categorizeWithClaude(apiKey, merchants, categories, resolved);
}

// ---- Anthropic / Claude ----

async function categorizeWithClaude(apiKey: string, merchants: string[], categories: Category[], model: string): Promise<ApiCategorization[]> {
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
    model,
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

async function categorizeWithGemini(apiKey: string, merchants: string[], categories: Category[], model: string): Promise<ApiCategorization[]> {
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
    // Google retires model ids on its own schedule; make that case point at the fix rather than
    // leaving the user staring at a raw 404.
    if (response.status === 404) {
      throw new Error(`Model "${model}" isn't available to this API key. Set a current model in Settings → Model. (${message})`);
    }
    throw new Error(message);
  }

  const parts = body?.candidates?.[0]?.content?.parts;
  const text = Array.isArray(parts) ? parts.map((p: { text?: string }) => p.text ?? '').join('') : '';
  if (!text) return [];
  return normalizeResults(text);
}

// ---- LLM natural-language query -> structured filter spec ----
// Privacy: only the typed question plus category/account *names* are sent — never a transaction,
// amount, or date from the user's actual history. `nlquery.ts`'s `applyFilterSpec` runs the
// resulting spec against real data entirely on-device.

const QUERY_SYSTEM_PROMPT =
  'You translate a user\'s natural-language question about their own personal spending into a ' +
  'structured filter. You never see their actual transactions, amounts, or dates — only their ' +
  'question and the category/account names below. Resolve relative time phrases ("last month", ' +
  '"this year", "the last 90 days") to one of the fixed date_range tokens; only use "custom" with ' +
  'explicit ISO (YYYY-MM-DD) dates when the user names a specific range no token can express (e.g. ' +
  '"between March and May", "since June 1st"). Pick intent "sum" for "how much", "count" for "how ' +
  'many times", "average" for "average" or "typical", and "list" otherwise (e.g. "show me…"). Use ' +
  'null for anything the question doesn\'t mention.';

function buildQuerySystemPrompt(today: string): string {
  return `${QUERY_SYSTEM_PROMPT} Today's date is ${today}.`;
}

function buildQueryUserPrompt(query: string, categories: Category[], accounts: Account[]): string {
  return `Categories:\n${buildCategoryContext(categories)}\n\nAccounts:\n${buildAccountContext(accounts)}\n\nQuestion: ${query}`;
}

interface RawFilterSpec {
  intent: string;
  date_range: string;
  date_from: string | null;
  date_to: string | null;
  category_id: string | null;
  subcategory_id: string | null;
  merchant_contains: string | null;
  account_id: string | null;
  amount_min: number | null;
  amount_max: number | null;
}

const FILTER_SPEC_FIELDS = [
  'intent', 'date_range', 'date_from', 'date_to', 'category_id',
  'subcategory_id', 'merchant_contains', 'account_id', 'amount_min', 'amount_max',
];
const INTENTS: FilterSpec['intent'][] = ['sum', 'count', 'average', 'list'];

/** Parse the model's JSON payload and clamp it into our own shape, same discipline as normalizeResults. */
function normalizeFilterSpec(text: string): FilterSpec {
  let parsed: Partial<RawFilterSpec>;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('The model returned a response that was not valid JSON.');
  }
  const intent = INTENTS.includes(parsed.intent as FilterSpec['intent']) ? (parsed.intent as FilterSpec['intent']) : 'list';
  const dateRange = DATE_RANGE_TOKENS.includes(parsed.date_range as DateRangeToken) ? (parsed.date_range as DateRangeToken) : 'all_time';
  return {
    intent,
    dateRange,
    dateFrom: parsed.date_from || null,
    dateTo: parsed.date_to || null,
    categoryId: parsed.category_id || null,
    subcategoryId: parsed.subcategory_id || null,
    merchantContains: parsed.merchant_contains || null,
    accountId: parsed.account_id || null,
    amountMin: typeof parsed.amount_min === 'number' ? parsed.amount_min : null,
    amountMax: typeof parsed.amount_max === 'number' ? parsed.amount_max : null,
  };
}

/** Dispatch to whichever backend the user selected in Settings. */
export async function queryToFilterSpec(
  provider: AiProvider,
  apiKey: string,
  query: string,
  categories: Category[],
  accounts: Account[],
  model?: string,
): Promise<FilterSpec> {
  const resolved = model?.trim() || providerDef(provider).model;
  return provider === 'gemini'
    ? queryWithGemini(apiKey, query, categories, accounts, resolved)
    : queryWithClaude(apiKey, query, categories, accounts, resolved);
}

async function queryWithClaude(apiKey: string, query: string, categories: Category[], accounts: Account[], model: string): Promise<FilterSpec> {
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });

  const schema = {
    type: 'object' as const,
    properties: {
      intent: { type: 'string' as const, enum: INTENTS },
      date_range: { type: 'string' as const, enum: DATE_RANGE_TOKENS },
      date_from: { type: ['string', 'null'] as const },
      date_to: { type: ['string', 'null'] as const },
      category_id: { type: ['string', 'null'] as const },
      subcategory_id: { type: ['string', 'null'] as const },
      merchant_contains: { type: ['string', 'null'] as const },
      account_id: { type: ['string', 'null'] as const },
      amount_min: { type: ['number', 'null'] as const },
      amount_max: { type: ['number', 'null'] as const },
    },
    required: FILTER_SPEC_FIELDS,
    additionalProperties: false,
  };

  const response = await client.messages.create({
    model,
    max_tokens: 1024,
    system: buildQuerySystemPrompt(todayISO()),
    output_config: { format: { type: 'json_schema', schema } },
    messages: [{ role: 'user', content: buildQueryUserPrompt(query, categories, accounts) }],
  });

  const block = response.content.find(b => b.type === 'text');
  if (!block || block.type !== 'text') throw new Error('The model returned an empty response.');
  return normalizeFilterSpec(block.text);
}

async function queryWithGemini(apiKey: string, query: string, categories: Category[], accounts: Account[], model: string): Promise<FilterSpec> {
  const responseSchema = {
    type: 'OBJECT',
    properties: {
      intent: { type: 'STRING', enum: INTENTS },
      date_range: { type: 'STRING', enum: DATE_RANGE_TOKENS },
      date_from: { type: 'STRING', nullable: true },
      date_to: { type: 'STRING', nullable: true },
      category_id: { type: 'STRING', nullable: true },
      subcategory_id: { type: 'STRING', nullable: true },
      merchant_contains: { type: 'STRING', nullable: true },
      account_id: { type: 'STRING', nullable: true },
      amount_min: { type: 'NUMBER', nullable: true },
      amount_max: { type: 'NUMBER', nullable: true },
    },
    required: FILTER_SPEC_FIELDS,
  };

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: buildQuerySystemPrompt(todayISO()) }] },
        contents: [{ role: 'user', parts: [{ text: buildQueryUserPrompt(query, categories, accounts) }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema,
          maxOutputTokens: 2048,
        },
      }),
    },
  );

  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const message = body?.error?.message ?? `${response.status} ${response.statusText}`;
    if (response.status === 404) {
      throw new Error(`Model "${model}" isn't available to this API key. Set a current model in Settings → Model.`);
    }
    throw new Error(message);
  }

  const parts = body?.candidates?.[0]?.content?.parts;
  const text = Array.isArray(parts) ? parts.map((p: { text?: string }) => p.text ?? '').join('') : '';
  if (!text) throw new Error('The model returned an empty response.');
  return normalizeFilterSpec(text);
}
