import { createHash } from 'node:crypto';
import { setImmediate as yieldTask } from 'node:timers/promises';
import type { DocumentItem } from '../src/types.ts';
import { checkCancelled, cancellableWait } from './chat-cancellation.ts';
type Chunk = { id: string; text: string; blockId?: string; page?: number; offset: number; source: string; length: number };
export type DocumentIndex = { signature: string; enabled: boolean; chunks: Chunk[]; postings: Map<string, Map<number, number>>; characters: number; averageLength: number };
const cache = new Map<string, Promise<DocumentIndex>>();
export function retrievalTokens(text: string) {
  const lowered = text.normalize('NFKC').toLowerCase();
  const words: string[] = lowered.match(/[a-z0-9_]+/g) || [];
  for (const run of lowered.match(/[\u3400-\u9fff]+/g) || []) {
    if (run.length === 1) words.push(run);
    else for (let i = 0; i < run.length - 1; i++) words.push(run.slice(i, i + 2));
  }
  return words;
}
function pieces(document: DocumentItem) {
  const result: Array<{ text: string; blockId?: string; page?: number; source: string }> = [];
  for (const block of document.blocks) {
    if (block.type === 'image') continue;
    const text = block.type === 'table' && block.table
      ? block.table.rows.map(row => row.join(' | ')).join('\n')
      : block.content;
    if (text.trim()) result.push({ text, blockId: block.id, page: block.pdf?.page, source: `block:${block.id}` });
  }
  // Include native/OCR page text so original-layout and scanned PDF anchors are searchable.
  for (const page of document.pdfStructure?.pages || []) if (page.text.trim()) {
    result.push({ text: page.text, page: page.pageNumber, source: `${page.source}:page:${page.pageNumber}` });
  }
  return result;
}
export async function prepareDocument(document: DocumentItem): Promise<DocumentIndex> {
  const parts = pieces(document);
  const hash = createHash('sha256').update(JSON.stringify(['bm25-v1', document.userId, document.id, document.title, document.sourceBytes || 0]));
  let characters = 0;
  for (const part of parts) { hash.update(JSON.stringify(part)); characters += part.text.length; }
  const signature = hash.digest('hex');
  const key = `${document.userId}:${document.id}:${signature}`;
  const existing = cache.get(key); if (existing) return existing;
  const enabled = (document.sourceBytes || 0) > 10 * 1024 * 1024 || characters > 40_000;
  const task = (async () => {
    const chunks: Chunk[] = []; const postings = new Map<string, Map<number, number>>(); let totalTerms = 0;
    if (enabled) for (const part of parts) for (let start = 0; start < part.text.length; start += 900) {
      if (chunks.length % 32 === 0) await yieldTask();
      if (chunks.length >= 120_000) throw new Error('文档分块超过本地索引容量，未把不完整索引标记为就绪。');
      const text = part.text.slice(start, start + 1000);
      const terms = retrievalTokens(text); const frequencies = new Map<string, number>();
      for (const term of terms) frequencies.set(term, (frequencies.get(term) || 0) + 1);
      const number = chunks.length;
      chunks.push({ id: `${signature.slice(0, 16)}:${number}`, text, blockId: part.blockId, page: part.page, offset: start, source: part.source, length: terms.length });
      totalTerms += terms.length;
      for (const [term, frequency] of frequencies) {
        let posting = postings.get(term); if (!posting) { posting = new Map(); postings.set(term, posting); }
        posting.set(number, frequency);
      }
      if (start + 1000 >= part.text.length) break;
    }
    return { signature, enabled, chunks, postings, characters, averageLength: totalTerms / Math.max(1, chunks.length) };
  })();
  cache.set(key, task);
  // Keep only the newest version of a document and a bounded number of active documents.
  for (const old of cache.keys()) if (old !== key && old.startsWith(`${document.userId}:${document.id}:`)) cache.delete(old);
  while (cache.size > 3) cache.delete(cache.keys().next().value!);
  try { return await task; } catch (error) { if (cache.get(key) === task) cache.delete(key); throw error; }
}
export async function retrieveDocument(document: DocumentItem, question: string, selection: string) {
  checkCancelled(); const index = await cancellableWait(prepareDocument(document)); checkCancelled();
  const scores = new Map<number, number>();
  const questionTerms = new Set(retrievalTokens(question).slice(0, 512));
  const selectionTerms = new Set(retrievalTokens(selection.slice(0, 500)).slice(0, 256));
  for (const term of new Set([...questionTerms, ...selectionTerms])) {
    const posting = index.postings.get(term); if (!posting) continue;
    const idf = Math.log(1 + (index.chunks.length - posting.size + .5) / (posting.size + .5));
    for (const [number, tf] of posting) {
      const norm = tf + 1.2 * (.25 + .75 * index.chunks[number].length / Math.max(1, index.averageLength));
      scores.set(number, (scores.get(number) || 0) + (questionTerms.has(term) ? 1 : .2) * idf * tf * 2.2 / norm);
    }
  }
  const seen = new Set<string>(); const hits: Array<Chunk & { score: number }> = [];
  for (const [number, score] of [...scores].sort((a, b) => b[1] - a[1])) {
    const chunk = index.chunks[number]; const normalized = chunk.text.replace(/\s+/g, '');
    if (seen.has(normalized)) continue; seen.add(normalized); hits.push({ ...chunk, score });
    if (hits.length >= 6) break;
  }
  return { enabled: index.enabled, signature: index.signature, totalChunks: index.chunks.length, characters: index.characters, hits };
}
