// Finds a verification code in one message. Pure, because a setting behind this deletes the
// mail once the code is copied, and something irreversible has to be reproducible.
//
// Precision over recall: a missed code costs one retype, a false one costs a real mail, so
// any doubt means no. The stages are normalise, blank the noise into an equal number of
// spaces so every offset stays valid, find keywords, collect candidates, take the hardest
// evidence and the earliest on a tie.

import type { CodeConfidence } from '../core/prefs-store';


//===========================
// Types
//===========================

export interface CodeCandidate {
  code: string;
  confidence: CodeConfidence;
}

interface ScoredCandidate extends CodeCandidate {
  index: number;
  alnum: boolean;
}

interface Span {
  start: number;
  end: number;
}


//===========================
// Constants
//===========================

const MIN_LENGTH = 4;
const MAX_LENGTH = 8;

const KEYWORD_WINDOW = 60;

const NEGATIVE_WINDOW = 40;

const KEYWORD_SOURCE = [
  'verification\\s*code',
  'security\\s*code',
  'confirmation\\s*code',
  'authentication\\s*code',
  'pass\\s*code',
  'one[\\s-]*time\\s+(?:code|password|passcode|pin)',
  '\\botp\\b',
  '\\b2fa\\b',
  'two[\\s-]*factor',
  'verificatie\\s*code',
  'beveiligings?\\s*code',
  'eenmalige\\s*code',
  'bevestigings?\\s*code',
  'inlog\\s*code',
].join('|');

const NEGATIVE_SOURCE = [
  'factuur\\w*',
  'invoice',
  'order\\s*(?:nummer|number|nr)',
  'ordernummer',
  'klant\\s*nummer|klantnummer',
  'customer\\s*(?:number|id)',
  'rekening\\s*nummer|rekeningnummer',
  'account\\s*number',
  'referentie\\w*',
  'reference',
  'tracking\\w*',
  'track\\s*&\\s*trace',
  'zending\\w*',
  'pakket',
  'ticket\\w*',
  'polis\\w*',
  'lidnummer',
  '\\biban\\b',
  '\\bbsn\\b',
  '\\bkvk\\b',
  '\\bbtw\\b',
  '\\bvat\\b',
  'bedrag',
  'amount',
  'totaal',
  '\\btotal\\b',
  'postcode',
  'telefoon\\w*',
  '\\bphone\\b',
].join('|');

const HINT_SOURCE = [
  '\\bcodes?\\b',
  '\\bpin\\b',
  'verif\\w*',
  'bevestig\\w*',
  'confirm\\w*',
  'authenticat\\w*',
  'aanmeld\\w*',
  'inlog\\w*',
  'log\\s*in',
  'sign\\s*in',
  'security',
  'beveilig\\w*',
  'eenmalig\\w*',
  '\\b2fa\\b',
  '\\botp\\b',
  'two[\\s-]*factor',
].join('|');

const YEAR = /^(?:19|20)\d{2}$/;

const UNIT = /^\d{1,4}(?:KB|MB|GB|TB|PX|PT|AM|PM|EUR|USD|GBP)$/;

const FORBIDDEN_BEFORE = '_#$€£¥+';
const FORBIDDEN_AFTER = '_%°';

const INLINE_TAG = 'b|strong|i|em|u|span|font|small|big|sub|sup|wbr|mark|tt|code';
const DIGIT_GLUE = new RegExp(`(?<=\\d)(?:</?(?:${INLINE_TAG})\\b[^>]*>)+(?=\\d)`, 'gi');

const NOISE: readonly RegExp[] = [
  /(?:https?:\/\/|mailto:|www\.)\S+/gi,
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
  /#[A-Za-z0-9]{3,8}\b/g,
  /\b0x[A-Fa-f0-9]+\b/gi,
  /[€$£¥]\s*\d[\d.,]*/g,
  /\b\d[\d.,]*\s*(?:eur|usd|gbp|euro'?s?|dollars?|cent)\b/gi,
  /\b\d[\d.,]*\s*,-/g,
  /\b\d[\d.,]*\s*%/g,
  /(?:\+|\b00)\d[\d\s().-]{5,}\d/g,
  /\(\d{2,4}\)\s*[\d\s.-]{5,}\d/g,
  /\b0\d[\s.-]?\d{4}[\s.-]?\d{4}\b/g,
  /\b0\d{2}[\s.-]?\d{3}[\s.-]?\d{4}\b/g,
  /\b0\d{3}[\s.-]?\d{3}[\s.-]?\d{3}\b/g,
  /\d+(?:[.,:/\-\u2013]\d+)+/g,
  /\b\d{1,3}(?:\s\d{3})+\b/g,
  /[A-Za-z0-9]*\d{9,}[A-Za-z0-9]*/g,
];


//===========================
// Exported functions
//===========================

/**
 * Finds the verification code in one message
 *
 * The hardest evidence wins, and the earliest candidate on a tie. A candidate's own
 * confidence is the strength of the evidence behind it, never the user's setting; the
 * setting only decides how much evidence is enough.
 *
 * @param input
 * @param confidence how sure the user asked to be
 * @returns the code, or null when there is any doubt
 */
export function findVerificationCode(
  input: { subject: string; body: string },
  confidence: CodeConfidence,
): string | null {
  const { text, subjectEnd } = haystack(input);
  const scanned = blankNoise(text);
  const candidates = collect(scanned, subjectEnd, keywordSpans(scanned));

  const accepts = (c: ScoredCandidate): boolean =>
    c.alnum ? confidence === 'high' && c.confidence === 'high' : c.confidence === 'high' || confidence === 'medium';

  for (const c of candidates) if (c.confidence === 'high' && accepts(c)) return c.code;
  for (const c of candidates) if (accepts(c)) return c.code;
  return null;
}

/**
 * Whether a subject is worth fetching the body for
 *
 * Deliberately looser than the search itself: this is a gate that saves a fetch, and too
 * strict a gate discards mail nothing can recover.
 *
 * @param subject
 * @returns true when the body might hold a code
 */
export function subjectSuggestsCode(subject: string): boolean {
  const text = clean(subject ?? '');
  if (!text) return false;
  if (new RegExp(KEYWORD_SOURCE, 'i').test(text)) return true;
  if (new RegExp(HINT_SOURCE, 'i').test(text)) return true;
  for (const m of blankNoise(text).matchAll(/(?<![A-Za-z0-9_])(\d{4,8})(?![A-Za-z0-9_])/g)) {
    if (!YEAR.test(m[1])) return true;
  }
  return false;
}


//===========================
// Helper functions
//===========================

const blanks = (m: string): string => ' '.repeat(m.length);

function looksLikeHtml(text: string): boolean {
  return /<\/?(?:html|body|head|div|table|tbody|tr|td|th|p|br|span|a|img|style|script|meta|font|center|b|strong|i|em|ul|ol|li|h[1-6])\b[^>]*>/i.test(
    text,
  );
}

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;/g, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&amp;/gi, '&');
}

function stripHtml(text: string): string {
  return text
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(DIGIT_GLUE, '')
    .replace(/<br\b[^>]*>/gi, '\n')
    .replace(/<\/(?:p|div|tr|td|table|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]*>/g, ' ');
}

function flatten(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function clean(text: string): string {
  const withoutTags = looksLikeHtml(text) ? stripHtml(text) : text;
  return flatten(decodeEntities(withoutTags));
}

/**
 * Puts the subject and the body in one string
 *
 * @param input
 * @returns the text, and where the subject ends in it
 * @private
 */
function haystack(input: { subject: string; body: string }): { text: string; subjectEnd: number } {
  const subject = clean(input.subject ?? '');
  const body = clean(input.body ?? '');
  return { text: `${subject}\n${body}`, subjectEnd: subject.length };
}

function blankNoise(text: string): string {
  let out = text;
  for (const pattern of NOISE) out = out.replace(pattern, blanks);
  return out;
}

function keywordSpans(text: string): Span[] {
  const out: Span[] = [];
  for (const m of text.matchAll(new RegExp(KEYWORD_SOURCE, 'gi'))) {
    if (m.index === undefined) continue;
    out.push({ start: m.index, end: m.index + m[0].length });
  }
  return out;
}

/**
 * The distance between a keyword and a token
 *
 * @param span the keyword
 * @param start of the token
 * @param end of the token
 * @returns the characters between them, or 0 when they overlap
 * @private
 */
function gap(span: Span, start: number, end: number): number {
  if (start >= span.end) return start - span.end;
  if (end <= span.start) return span.start - end;
  return 0;
}

/**
 * Whether the characters around a token allow it to be a code
 *
 * @param text
 * @param start of the token
 * @param end of the token
 * @returns false for the likes of #1234 and 1234%
 * @private
 */
function boundaryOk(text: string, start: number, end: number): boolean {
  const before = start > 0 ? text[start - 1] : '';
  const after = end < text.length ? text[end] : '';
  if (before && FORBIDDEN_BEFORE.includes(before)) return false;
  if (after && FORBIDDEN_AFTER.includes(after)) return false;
  return true;
}

/**
 * Whether a word just before a token says it is a number of another kind
 *
 * @param text
 * @param start of the token
 * @returns true when the token belongs to an invoice, an order, a policy
 * @private
 */
function negativeNear(text: string, start: number): boolean {
  const before = text.slice(Math.max(0, start - NEGATIVE_WINDOW), start);
  return new RegExp(NEGATIVE_SOURCE, 'i').test(before);
}

/**
 * Every token that could be a code, with the evidence behind it
 *
 * A token in the subject counts as backed when the message has a keyword anywhere, since a
 * subject is too short to hold one within the window.
 *
 * @param text with the noise already blanked
 * @param subjectEnd
 * @param keywords
 * @returns {ScoredCandidate[]} in the order they appear
 * @private
 */
function collect(text: string, subjectEnd: number, keywords: Span[]): ScoredCandidate[] {
  const out: ScoredCandidate[] = [];
  for (const m of text.matchAll(/[A-Za-z0-9]+/g)) {
    const token = m[0];
    const start = m.index;
    if (start === undefined) continue;
    const end = start + token.length;
    if (token.length < MIN_LENGTH || token.length > MAX_LENGTH) continue;

    const digitsOnly = /^\d+$/.test(token);
    const alnum = !digitsOnly && /^(?=[A-Z0-9]*\d)(?=[A-Z0-9]*[A-Z])[A-Z0-9]+$/.test(token);
    if (!digitsOnly && !alnum) continue;
    if (alnum && UNIT.test(token)) continue;
    if (!boundaryOk(text, start, end)) continue;
    if (negativeNear(text, start)) continue;

    const adjacent = keywords.some((k) => gap(k, start, end) <= KEYWORD_WINDOW);
    const backed = adjacent || (start < subjectEnd && keywords.length > 0);
    if (alnum && !backed) continue;
    if (YEAR.test(token) && !adjacent) continue;

    out.push({ code: token, confidence: backed ? 'high' : 'medium', index: start, alnum });
  }
  return out;
}
