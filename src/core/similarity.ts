/**
 * Content Similarity Module (pure logic subset)
 *
 * Extracts key terms from markdown content for similarity matching.
 * Only the pure-logic extractKeyTerms function is ported here;
 * the database-dependent findSimilarNotes lives in the db layer.
 */

const STOP_WORDS = new Set([
  'the', 'be', 'to', 'of', 'and', 'a', 'in', 'that', 'have', 'i',
  'it', 'for', 'not', 'on', 'with', 'he', 'as', 'you', 'do', 'at',
  'this', 'but', 'his', 'by', 'from', 'they', 'we', 'say', 'her',
  'she', 'or', 'an', 'will', 'my', 'one', 'all', 'would', 'there',
  'their', 'what', 'so', 'up', 'out', 'if', 'about', 'who', 'get',
  'which', 'go', 'me', 'when', 'make', 'can', 'like', 'time', 'no',
  'just', 'him', 'know', 'take', 'people', 'into', 'year', 'your',
  'good', 'some', 'could', 'them', 'see', 'other', 'than', 'then',
  'now', 'look', 'only', 'come', 'its', 'over', 'think', 'also',
  'back', 'after', 'use', 'two', 'how', 'our', 'work', 'first',
  'well', 'way', 'even', 'new', 'want', 'because', 'any', 'these',
  'give', 'day', 'most', 'us', 'is', 'was', 'are', 'been', 'has',
  'had', 'did', 'being', 'were', 'does', 'done', 'may', 'should',
  'each', 'much', 'need', 'very', 'still', 'between', 'own',
]);

export function extractKeyTerms(content: string, maxTerms: number = 15): string[] {
  // Strip frontmatter
  const bodyMatch = content.match(/^---[\s\S]*?---\n([\s\S]*)$/);
  const body = bodyMatch ? bodyMatch[1] : content;

  // Strip markdown syntax, wikilinks, URLs, code blocks
  const cleaned = body
    .replace(/```[\s\S]*?```/g, '') // code blocks
    .replace(/`[^`]+`/g, '') // inline code
    .replace(/\[\[([^\]|]+)(\|[^\]]+)?\]\]/g, '$1') // wikilinks -> text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // markdown links -> text
    .replace(/https?:\/\/\S+/g, '') // URLs
    .replace(/[#*_~>|=-]+/g, ' ') // markdown formatting
    .replace(/\d+/g, ' '); // numbers

  // Tokenize and count
  const words = cleaned.toLowerCase().split(/\W+/).filter(w => w.length > 2);
  const freq = new Map<string, number>();
  for (const w of words) {
    if (STOP_WORDS.has(w)) continue;
    freq.set(w, (freq.get(w) || 0) + 1);
  }

  // Sort by frequency, take top N
  return Array.from(freq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxTerms)
    .map(([word]) => word);
}
