import type { Category, Rule } from '../types';

// ---- Default category taxonomy (requirements §4.4) ----

interface SeedCat { id: string; name: string; color: string; subs: Array<[string, string]> }

const TAXONOMY: SeedCat[] = [
  { id: 'food', name: 'Food & Dining', color: '#4a9d86', subs: [['groceries', 'Groceries'], ['restaurants', 'Restaurants'], ['coffee', 'Coffee'], ['delivery', 'Delivery']] },
  { id: 'transport', name: 'Transportation', color: '#86b8a5', subs: [['gas', 'Gas'], ['rideshare', 'Rideshare'], ['transit', 'Public Transit'], ['parking', 'Parking'], ['auto', 'Auto Maintenance']] },
  { id: 'housing', name: 'Housing', color: '#1f6f5c', subs: [['rent', 'Rent/Mortgage'], ['utilities', 'Utilities'], ['home-ins', 'Insurance'], ['home-maint', 'Maintenance']] },
  { id: 'shopping', name: 'Shopping', color: '#c8892b', subs: [['clothing', 'Clothing'], ['electronics', 'Electronics'], ['home-goods', 'Home Goods']] },
  { id: 'entertainment', name: 'Entertainment', color: '#7c6f9c', subs: [['streaming', 'Streaming'], ['events', 'Events'], ['hobbies', 'Hobbies']] },
  { id: 'health', name: 'Health', color: '#b0736a', subs: [['medical', 'Medical'], ['pharmacy', 'Pharmacy'], ['fitness', 'Fitness']] },
  { id: 'subscriptions', name: 'Subscriptions', color: '#9aa06b', subs: [['software', 'Software'], ['memberships', 'Memberships']] },
  { id: 'travel', name: 'Travel', color: '#d9a441', subs: [['flights', 'Flights'], ['lodging', 'Lodging'], ['rental-cars', 'Rental Cars']] },
  { id: 'fees', name: 'Fees', color: '#a8988a', subs: [['bank-fees', 'Bank fees'], ['interest-charges', 'Interest charges']] },
  { id: 'other', name: 'Other / Uncategorized', color: '#cdc7bb', subs: [] },
];

export function seedCategories(): Category[] {
  const out: Category[] = [];
  for (const c of TAXONOMY) {
    out.push({ id: c.id, name: c.name, parentId: null, color: c.color });
    for (const [id, name] of c.subs) out.push({ id, name, parentId: c.id, color: c.color });
  }
  return out;
}

// ---- Seed categorization rules (pattern → category/subcategory) ----

const SEED_RULES: Array<[string, 'exact' | 'contains' | 'regex', string, string | null]> = [
  ['Whole Foods Market', 'exact', 'food', 'groceries'],
  ['Costco Wholesale', 'exact', 'food', 'groceries'],
  ["Trader Joe's", 'exact', 'food', 'groceries'],
  ['Safeway', 'exact', 'food', 'groceries'],
  ['Walmart', 'exact', 'food', 'groceries'],
  ['Starbucks', 'exact', 'food', 'coffee'],
  ['Blue Bottle Coffee', 'exact', 'food', 'coffee'],
  ["Peet's Coffee", 'exact', 'food', 'coffee'],
  ['Chipotle', 'exact', 'food', 'restaurants'],
  ["McDonald's", 'exact', 'food', 'restaurants'],
  ['DoorDash', 'exact', 'food', 'delivery'],
  ['Uber Eats', 'exact', 'food', 'delivery'],
  ['Shell', 'exact', 'transport', 'gas'],
  ['Chevron', 'exact', 'transport', 'gas'],
  ['Uber', 'exact', 'transport', 'rideshare'],
  ['Lyft', 'exact', 'transport', 'rideshare'],
  ['Netflix', 'exact', 'entertainment', 'streaming'],
  ['Spotify', 'exact', 'entertainment', 'streaming'],
  ['Hulu', 'exact', 'entertainment', 'streaming'],
  ['Adobe', 'exact', 'subscriptions', 'software'],
  ['Apple', 'exact', 'subscriptions', 'software'],
  ['The New York Times', 'exact', 'subscriptions', 'memberships'],
  ['Peloton', 'exact', 'health', 'fitness'],
  ['CVS Pharmacy', 'exact', 'health', 'pharmacy'],
  ['Walgreens', 'exact', 'health', 'pharmacy'],
  ['PG&E', 'exact', 'housing', 'utilities'],
  ['Xfinity', 'exact', 'housing', 'utilities'],
  ['Verizon', 'exact', 'housing', 'utilities'],
  ['T-Mobile', 'exact', 'housing', 'utilities'],
  ['GEICO', 'exact', 'housing', 'home-ins'],
  ['State Farm', 'exact', 'housing', 'home-ins'],
  ['The Home Depot', 'exact', 'housing', 'home-maint'],
  ["Lowe's", 'exact', 'housing', 'home-maint'],
  ['Target', 'exact', 'shopping', 'home-goods'],
  ['Amazon', 'exact', 'shopping', null],
  ['Southwest Airlines', 'exact', 'travel', 'flights'],
  ['United Airlines', 'exact', 'travel', 'flights'],
  ['Delta Air Lines', 'exact', 'travel', 'flights'],
  ['Airbnb', 'exact', 'travel', 'lodging'],
  ['Marriott', 'exact', 'travel', 'lodging'],
  ['RENT', 'contains', 'housing', 'rent'],
  ['MORTGAGE', 'contains', 'housing', 'rent'],
  ['ATM FEE', 'contains', 'fees', 'bank-fees'],
  ['OVERDRAFT', 'contains', 'fees', 'bank-fees'],
  ['INTEREST CHARGE', 'contains', 'fees', 'interest-charges'],
];

export function seedRules(): Rule[] {
  return SEED_RULES.map(([pat, type, cat, sub], i) => ({
    id: 'seed-' + i,
    merchantPattern: pat,
    matchType: type,
    categoryId: cat,
    subcategoryId: sub,
    createdFrom: 'system',
    createdAt: '2026-01-01T00:00:00Z',
  }));
}
