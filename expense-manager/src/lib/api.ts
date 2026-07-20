import Anthropic from '@anthropic-ai/sdk';
import type { Category } from '../types';

// ---- LLM categorization fallback (§4.4 step 3) ----
// Privacy: only merchant names are sent — never amounts, dates, or accounts.
// Results are cached as learned rules by the caller so a merchant is never queried twice.

export interface ApiCategorization {
  merchant: string;
  categoryId: string | null;
  subcategoryId: string | null;
  confidence: number;
}

export async function categorizeMerchants(
  apiKey: string,
  merchants: string[],
  categories: Category[],
): Promise<ApiCategorization[]> {
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });

  const taxonomy = categories
    .filter(c => !c.parentId)
    .map(c => {
      const subs = categories.filter(s => s.parentId === c.id).map(s => s.id);
      return `${c.id}${subs.length ? ` (subcategories: ${subs.join(', ')})` : ''}`;
    })
    .join('\n');

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
    model: 'claude-opus-4-8',
    max_tokens: 4096,
    system:
      'You classify merchant names from bank statements into spending categories. ' +
      'Use only the category and subcategory ids provided. If a merchant is genuinely ambiguous, ' +
      'use null for category_id. Confidence is 0 to 1.',
    output_config: {
      format: { type: 'json_schema', schema },
    },
    messages: [
      {
        role: 'user',
        content: `Categories:\n${taxonomy}\n\nClassify these merchants:\n${merchants.map(m => `- ${m}`).join('\n')}`,
      },
    ],
  });

  const block = response.content.find(b => b.type === 'text');
  if (!block || block.type !== 'text') return [];
  const parsed = JSON.parse(block.text) as { results: Array<{ merchant: string; category_id: string | null; subcategory_id: string | null; confidence: number }> };
  return parsed.results.map(r => ({
    merchant: r.merchant,
    categoryId: r.category_id,
    subcategoryId: r.subcategory_id,
    confidence: Math.min(Math.max(r.confidence, 0), 1),
  }));
}
