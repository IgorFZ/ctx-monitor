export type LinkEntry = { url: string; title: string; source: string; priority: number; order: number };
export type Collection = { scan(value: unknown, source?: string, depth?: number): void; list(): LinkEntry[] };
export type Message = {
  role: string; text?: string;
  toolUses?: { id?: string; tool_use_id?: string; name?: string; tool?: string; result?: unknown; text?: string }[];
  toolResults?: { tool_use_id: string; result?: unknown; text?: string }[];
};
export const MAX_LINKS: number;
export function normalizeUrl(value: unknown): string | null;
export function createCollection(seed?: LinkEntry[]): Collection;
export function createMessageCollector(): { consume(message: Message): void; list(): LinkEntry[] };
export function collectMessages(messages: Message[]): LinkEntry[];
export function markdownLinks(links: LinkEntry[]): string;
export type Category = 'pr' | 'issue' | 'branch' | 'commit' | 'ci' | 'code' | 'search' | 'docs' | 'local' | 'other';
export type CategorizedLink = LinkEntry & { category: Category; ref: string };
export const CATEGORIES: [Category, string][];
export function categorize(link: { url: string; source: string }): { category: Category; ref: string };
export function groupLinks(links: LinkEntry[]): { id: Category; label: string; links: CategorizedLink[] }[];
export function displayTitle(link: { url: string; title: string; source: string }, ref?: string): string;
