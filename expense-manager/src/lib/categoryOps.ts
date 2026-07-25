import type { AppData, Category, Rule, Transaction } from '../types';
import { uid } from './format';

// ---- Category taxonomy CRUD (§4.4: add/edit/delete/merge categories and subcategories) ----
// Pure functions over AppData — the store reducer just calls these and returns the result.
// The hard part isn't the category list itself; it's that categoryId/subcategoryId are
// referenced from transactions (incl. splits) and rules, and none of those may be
// left pointing at a category that no longer exists.

/** Seeded catch-all bucket — protected from deletion/merge-away; the fallback target when a
 * split would otherwise be left with no valid category (TransactionSplit.categoryId is non-null). */
export const UNCATEGORIZED_ID = 'other';

export function isProtectedCategory(id: string): boolean {
  return id === UNCATEGORIZED_ID;
}

export function categoryNameTaken(categories: Category[], name: string, parentId: string | null, excludeId?: string): boolean {
  const n = name.trim().toLowerCase();
  return categories.some(c => c.id !== excludeId && c.parentId === parentId && c.name.trim().toLowerCase() === n);
}

export interface CategoryUsage {
  transactions: number;   // transactions whose top-level or subcategory field references this category
  splits: number;         // transactions with a split referencing this category
  rules: number;
}

/** How much data references this category (and, if it's top-level, its subcategories too). */
export function categoryUsage(data: AppData, id: string): CategoryUsage {
  const ids = descendantIds(data.categories, id);
  let transactions = 0, splits = 0;
  for (const t of data.transactions) {
    const directHit = !!((t.categoryId && ids.has(t.categoryId)) || (t.subcategoryId && ids.has(t.subcategoryId)));
    const splitHit = !!t.splits?.some(s => ids.has(s.categoryId) || (s.subcategoryId && ids.has(s.subcategoryId)));
    // `transactions` is the union of both — a transaction split against this category counts once
    // here even though its own top-level categoryId/subcategoryId are null (cleared by splitting);
    // `splits` is a subset count of how many of those specifically involve a split.
    if (directHit || splitHit) transactions++;
    if (splitHit) splits++;
  }
  const rules = data.rules.filter(r => ids.has(r.categoryId) || (r.subcategoryId && ids.has(r.subcategoryId))).length;
  return { transactions, splits, rules };
}

function descendantIds(categories: Category[], id: string): Set<string> {
  const cat = categories.find(c => c.id === id);
  if (!cat) return new Set([id]);
  if (cat.parentId) return new Set([id]);
  return new Set([id, ...categories.filter(c => c.parentId === id).map(c => c.id)]);
}

// ---- Add / edit ----

export function addCategory(data: AppData, name: string, color: string, parentId: string | null, id?: string): AppData {
  const category: Category = { id: id ?? uid(), name: name.trim(), parentId, color };
  return { ...data, categories: [...data.categories, category] };
}

export function editCategory(data: AppData, id: string, patch: { name?: string; color?: string }): AppData {
  return { ...data, categories: data.categories.map(c => c.id === id ? { ...c, ...patch } : c) };
}

// ---- Delete (with cascade + reassignment) ----

/**
 * Delete a category. `reassignTo` is another category's id to move affected data onto, or null to
 * leave plain transaction fields uncategorized (splits can never be null, so they fall back to
 * UNCATEGORIZED_ID instead of being left dangling). Deleting a top-level category cascades to its
 * subcategories.
 */
export function deleteCategory(data: AppData, id: string, reassignTo: string | null): AppData {
  const cat = data.categories.find(c => c.id === id);
  if (!cat || isProtectedCategory(id)) return data;

  if (!cat.parentId) {
    const removed = descendantIds(data.categories, id); // id + its subcategories
    const target = reassignTo ? data.categories.find(c => c.id === reassignTo) : null;
    const toTop = target ? (target.parentId ?? target.id) : null;

    const transactions = data.transactions.map(t => remapRemovedTop(t, removed, toTop, false));
    const rules = remapRulesRemovedTop(data.rules, removed, toTop, false);
    const categories = data.categories.filter(c => !removed.has(c.id));
    return { ...data, transactions, rules, categories };
  }

  // subcategory: default to "stay under the same parent, just clear the subcategory" when no target given
  const target = reassignTo ? data.categories.find(c => c.id === reassignTo) : null;
  const toTop = target ? (target.parentId ?? target.id) : cat.parentId;
  const toSub = target?.parentId ? target.id : null;

  const transactions = data.transactions.map(t => remapRemovedSub(t, id, toTop, toSub));
  const rules = remapRulesRemovedSub(data.rules, id, toTop, toSub);
  const categories = data.categories.filter(c => c.id !== id);
  return { ...data, transactions, rules, categories };
}

// ---- Merge (same level only — reassigns everything from `fromId` onto `intoId`, then removes it) ----

export function canMerge(categories: Category[], fromId: string, intoId: string): boolean {
  if (fromId === intoId || isProtectedCategory(fromId)) return false;
  const from = categories.find(c => c.id === fromId);
  const into = categories.find(c => c.id === intoId);
  if (!from || !into) return false;
  return !from.parentId === !into.parentId; // both top-level, or both subcategories
}

export function mergeCategory(data: AppData, fromId: string, intoId: string): AppData {
  if (!canMerge(data.categories, fromId, intoId)) return data;
  const from = data.categories.find(c => c.id === fromId)!;
  const into = data.categories.find(c => c.id === intoId)!;

  if (!from.parentId) {
    // top-level merge: reparent from's subcategories onto `into` instead of deleting them
    const removed = new Set([fromId]);
    const categories = data.categories
      .filter(c => c.id !== fromId)
      .map(c => c.parentId === fromId ? { ...c, parentId: intoId } : c);
    const transactions = data.transactions.map(t => remapRemovedTop(t, removed, intoId, true));
    const rules = remapRulesRemovedTop(data.rules, removed, intoId, true);
    return { ...data, transactions, rules, categories };
  }

  const toTop = into.parentId!;
  const transactions = data.transactions.map(t => remapRemovedSub(t, fromId, toTop, intoId));
  const rules = remapRulesRemovedSub(data.rules, fromId, toTop, intoId);
  const categories = data.categories.filter(c => c.id !== fromId);
  return { ...data, transactions, rules, categories };
}

// ---- Remap helpers ----

/** keepSub=true (merge): subcategories survived (reparented), so leave t.subcategoryId alone.
 *  keepSub=false (delete): subcategories were deleted too, so clear it. */
function remapRemovedTop(t: Transaction, removedTopIds: Set<string>, toTop: string | null, keepSub: boolean): Transaction {
  let next = t;
  if (t.categoryId && removedTopIds.has(t.categoryId)) {
    next = { ...next, categoryId: toTop, subcategoryId: keepSub ? next.subcategoryId : null };
  }
  if (t.splits) {
    let changed = false;
    const splits = t.splits.map(s => {
      if (!removedTopIds.has(s.categoryId)) return s;
      changed = true;
      return { ...s, categoryId: toTop ?? UNCATEGORIZED_ID, subcategoryId: keepSub ? s.subcategoryId : null };
    });
    if (changed) next = { ...next, splits };
  }
  return next;
}

function remapRemovedSub(t: Transaction, subId: string, toTop: string | null, toSub: string | null): Transaction {
  let next = t;
  if (t.subcategoryId === subId) {
    next = { ...next, categoryId: toTop ?? next.categoryId, subcategoryId: toSub };
  }
  if (t.splits) {
    let changed = false;
    const splits = t.splits.map(s => {
      if (s.subcategoryId !== subId) return s;
      changed = true;
      return { ...s, categoryId: toTop ?? UNCATEGORIZED_ID, subcategoryId: toSub };
    });
    if (changed) next = { ...next, splits };
  }
  return next;
}

function remapRulesRemovedTop(rules: Rule[], removedTopIds: Set<string>, toTop: string | null, keepSub: boolean): Rule[] {
  return rules.map(r => {
    if (!removedTopIds.has(r.categoryId)) return r;
    return { ...r, categoryId: toTop ?? UNCATEGORIZED_ID, subcategoryId: keepSub ? r.subcategoryId : null };
  });
}

function remapRulesRemovedSub(rules: Rule[], subId: string, toTop: string | null, toSub: string | null): Rule[] {
  return rules.map(r => r.subcategoryId === subId ? { ...r, categoryId: toTop ?? UNCATEGORIZED_ID, subcategoryId: toSub } : r);
}

