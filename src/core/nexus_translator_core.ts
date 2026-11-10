/* =============================================================================


 * nexus_translator_core.ts — NEXUS Translator portable core


 * Targets: Safari/WKWebView PWA, Capacitor, React Native (Hermes), Node 18+,


 * Cloudflare Workers. Zero dependencies. Requires fetch + AbortController.


 * RadioDramaEngine needs a Web Audio implementation (browser, or injected,


 * e.g. react-native-audio-api).


 * ========================================================================== */




// ---------------------------------------------------------------------------


// 1. Domain types


// ---------------------------------------------------------------------------


export type Genre = 'WUXIA' | 'XIANXIA' | 'PERIOD' | 'MODERN';


export type GlossaryCategory = 'CHARACTER' | 'PLACE' | 'TECHNIQUE' | 'CULTIVATION';


export type Gender = 'MALE' | 'FEMALE' | 'UNKNOWN';


export type RelationshipType = 'FAMILY' | 'MASTER' | 'LOVER' | 'ENEMY';


export type NonStoryKind =


  | 'STORY' | 'SYSTEM_MESSAGE_IN_WORLD'


  | 'AUTHOR_NOTE' | 'NAVIGATION_TEXT' | 'CREDITS' | 'ADVERTISEMENT';




export interface GlossaryTerm {


  sourceTerm: string;


  translatedTerm: string;


  category: GlossaryCategory;


  confidence: number;          // 0..1


  cultivationOrder?: number;   // ordering of CULTIVATION realms


  aliases?: string[];


  locked?: boolean;            // locked story_memory entry → hard constraint


}




export interface CharacterProfile {


  sourceName: string;


  thaiName: string;


  gender: Gender;


  selfPronoun?: string;        // e.g. "ข้า", "ผม"


  note?: string;


}




export interface CharacterRelationship {


  from: string;                // sourceName


  to: string;                  // sourceName


  type: RelationshipType;


  activeFromChapter: number;


  activeUntilChapter?: number;


  fromCallsTo?: string;        // how `from` addresses `to`, e.g. "ท่านอาจารย์"


  note?: string;


}




export interface NonStoryPattern {


  domain: string;              // e.g. "example-novels.com"


  pattern: string;             // RegExp source


  flags?: string;


  kind: Exclude<NonStoryKind, 'STORY' | 'SYSTEM_MESSAGE_IN_WORLD'>;


}




export interface ChapterInput {


  novelId: string;


  chapterNumber: number;


  sourceText: string;


  genre: Genre;


  sourceDomain?: string;


  previousChapterTranslated?: string;


  glossary: GlossaryTerm[];


  characters: CharacterProfile[];


  relationships: CharacterRelationship[];


  spellingMemory?: Record<string, string>;   // 汉字 → Thai syllable (SpellingMemoryHook)


  nonStoryPatterns?: NonStoryPattern[];


  resume?: Record<number, string>;           // lineIndex → saved translation (checkpoint resume)


}




export type IssueCode =


  | 'MISSING' | 'EMPTY' | 'DUPLICATE_TAG' | 'CJK_RESIDUAL' | 'FOREIGN_RESIDUAL'


  | 'NUMBER_MISMATCH' | 'NUMBER_FORMAT' | 'GLOSSARY_VIOLATION';




export interface LineIssue { code: IssueCode; detail: string; }




export interface LineResult {


  index: number;               // 1-based, == NNNN in <LINE_NNNN>


  kind: NonStoryKind;


  source: string;


  translated: string | null;


  issues: LineIssue[];


  repaired: boolean;


}




export interface ProviderCallRecord {


  endpointId: string; model: string; promptTokens: number; outputTokens: number;


  costUsd: number; finishReason: string; purpose: 'translate' | 'repair';


}




export interface TranslationTelemetry {


  status: 'COMPLETED' | 'COMPLETED_WITH_ISSUES' | 'PROVIDERS_EXHAUSTED' | 'ABORTED';


  error?: string;


  linesTotal: number; linesStory: number; linesNonStory: number;


  linesFailed: number; linesRepaired: number; repairRounds: number;


  promptTokens: number; outputTokens: number; estimatedCostUsd: number;


  cjkResidualRatio: number; durationMs: number;


  calls: ProviderCallRecord[];


}




export interface ChapterResult {


  lines: LineResult[];


  translatedText: string;


  ttsText: string;


  telemetry: TranslationTelemetry;


}




// ---------------------------------------------------------------------------


// 2. Small utilities


// ---------------------------------------------------------------------------


function abortError(): Error { const e = new Error('Aborted'); e.name = 'AbortError'; return e; }


const isAbort = (e: unknown) => (e as Error)?.name === 'AbortError';




export function sleep(ms: number, signal?: AbortSignal): Promise<void> {


  return new Promise((resolve, reject) => {


    if (signal?.aborted) return reject(abortError());


    const onAbort = () => { clearTimeout(t); reject(abortError()); };


    const t = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);


    signal?.addEventListener('abort', onAbort, { once: true });


  });


}




const tail = (s: string, n: number) => (s.length <= n ? s : s.slice(s.length - n));


const pad4 = (n: number) => String(n).padStart(4, '0');


const rand = (a: number, b: number) => a + Math.random() * (b - a);


const randInt = (a: number, b: number) => Math.floor(rand(a, b + 1));




function chunk<T>(arr: T[], size: number): T[][] {


  const out: T[][] = [];


  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));


  return out;


}




/** Locale-independent thousands separator (Hermes-safe; no Intl needed). */


export function formatThousands(n: number): string {


  const neg = n < 0;


  const [i, f] = Math.abs(n).toString().split('.');


  return (neg ? '-' : '') + i.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (f ? '.' + f : '');


}




export function splitParagraphs(text: string): string[] {


  return text


    .replace(/\u3000/g, ' ')


    .split(/\r?\n/)


    .map(s => s.trim())


    .filter(s => s.length > 0);


}




// ---------------------------------------------------------------------------


// 3. Provider layer — Gemini multi-key + Groq failover


// ---------------------------------------------------------------------------


export const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';


/** As specified by the product spec — verify against Groq's GET /openai/v1/models. */


export const DEFAULT_GROQ_MODEL = 'qwen/qwen3.8-27b';




export type ProviderFamily = 'gemini' | 'groq';


export type ProviderErrorKind = 'QUOTA' | 'AUTH' | 'CONTENT_FILTER' | 'TRANSIENT' | 'BAD_REQUEST';




export class ProviderError extends Error {


  endpointId?: string;


  constructor(


    public readonly kind: ProviderErrorKind,


    message: string,


    public readonly status?: number,


    public readonly retryAfterMs?: number,


  ) { super(message); this.name = 'ProviderError'; }


}




export class AllProvidersFailedError extends Error {
  constructor(public readonly errors: ProviderError[]) {
    const details = errors.length > 0
      ? errors.map(e => `[${e.endpointId ?? 'Endpoint'}] ${e.kind}: ${e.message}`).join(' | ')
      : 'ไม่พบคีย์ API หรือทุก Endpoint ใช้งานไม่ได้';
    super(details);
    this.name = 'AllProvidersFailedError';
  }
}




export interface LLMRequest {


  system: string;


  user: string;


  temperature?: number;


  maxOutputTokens?: number;


  signal?: AbortSignal;


}




export interface LLMResponse {


  text: string;


  promptTokens: number;


  outputTokens: number;


  finishReason: string;


  endpointId: string;


  model: string;


}




export interface LLMEndpoint {


  readonly id: string;


  readonly family: ProviderFamily;


  readonly model: string;


  call(req: LLMRequest): Promise<LLMResponse>;


}




interface HttpResult { status: number; text: string; headers: Headers; }




async function httpPostJson(


  url: string, headers: Record<string, string>, body: unknown, timeoutMs: number, outer?: AbortSignal,


): Promise<HttpResult> {


  const ctrl = new AbortController();


  const onAbort = () => ctrl.abort();


  outer?.addEventListener('abort', onAbort, { once: true });


  const timer = setTimeout(() => ctrl.abort(), timeoutMs);


  try {


    const res = await fetch(url, {


      method: 'POST',


      headers: { 'Content-Type': 'application/json', ...headers },


      body: JSON.stringify(body),


      signal: ctrl.signal,


    });


    const text = await res.text();


    return { status: res.status, text, headers: res.headers };


  } catch (e) {


    if (outer?.aborted) throw abortError();


    throw new ProviderError('TRANSIENT', `Network/timeout: ${(e as Error)?.message ?? e}`);


  } finally {


    clearTimeout(timer);


    outer?.removeEventListener('abort', onAbort);


  }


}




function parseRetryAfterMs(body: string, headers: Headers): number | undefined {


  const h = headers.get('retry-after');


  if (h && !isNaN(Number(h))) return Number(h) * 1000;


  const m = body.match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/);


  if (m) return Math.ceil(parseFloat(m[1]) * 1000);


  if (/PerDay|per day|daily/i.test(body)) return 60 * 60 * 1000; // daily quota → long cooldown


  return undefined;


}




function classifyHttpError(status: number, body: string, headers: Headers): ProviderError {
  let snippet = body.slice(0, 300);
  try {
    const parsed = JSON.parse(body);
    if (parsed.error?.message) {
      snippet = parsed.error.message;
    } else if (typeof parsed.error === 'string') {
      snippet = parsed.error;
    }
  } catch {
    // keep raw snippet
  }

  if (status === 429) return new ProviderError('QUOTA', snippet, status, parseRetryAfterMs(body, headers));
  if (status === 401 || status === 403 || /API_KEY_INVALID|invalid api key/i.test(body))
    return new ProviderError('AUTH', snippet, status);
  if (status === 408 || status === 498 || status >= 500)
    return new ProviderError('TRANSIENT', snippet, status, parseRetryAfterMs(body, headers));
  return new ProviderError('BAD_REQUEST', snippet, status);
}




function safeJson(text: string): any {


  try { return JSON.parse(text); }


  catch { throw new ProviderError('TRANSIENT', 'Malformed JSON from provider'); }


}




/** Removes <think>…</think> reasoning blocks (Qwen3 & similar). */


export function stripReasoning(text: string): string {


  let t = text.replace(/<think>[\s\S]*?<\/think>/gi, '');


  if (/^\s*<think>/i.test(t)) {


    const i = t.search(/<LINE_\d{4}>/);


    t = i >= 0 ? t.slice(i) : '';


  }


  return t.trim();


}




const GEMINI_FILTER_REASONS = new Set(['SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII', 'RECITATION', 'IMAGE_SAFETY']);




export interface GeminiOptions {


  model?: string;


  baseUrl?: string;              // point at your proxy to keep keys server-side


  timeoutMs?: number;


  thinkingBudget?: number;       // e.g. 0 for flash models to save output budget


  safetyThreshold?: 'BLOCK_NONE' | 'BLOCK_ONLY_HIGH' | 'BLOCK_MEDIUM_AND_ABOVE';


  label?: string;


}




export function createGeminiEndpoint(apiKey: string, o: GeminiOptions = {}): LLMEndpoint {


  const model = o.model ?? DEFAULT_GEMINI_MODEL;


  const base = (o.baseUrl ?? 'https://generativelanguage.googleapis.com/v1beta').replace(/\/$/, '');


  const id = o.label ?? `gemini:${model}:…${apiKey.slice(-4)}`;


  const threshold = o.safetyThreshold ?? 'BLOCK_NONE';


  const safetySettings = [


    'HARM_CATEGORY_HARASSMENT', 'HARM_CATEGORY_HATE_SPEECH',


    'HARM_CATEGORY_SEXUALLY_EXPLICIT', 'HARM_CATEGORY_DANGEROUS_CONTENT',


  ].map(category => ({ category, threshold }));




  return {


    id, family: 'gemini', model,


    async call(req) {


      const generationConfig: Record<string, unknown> = {


        temperature: req.temperature ?? 0.3,


        maxOutputTokens: req.maxOutputTokens ?? 16000,


      };


      if (o.thinkingBudget !== undefined) generationConfig.thinkingConfig = { thinkingBudget: o.thinkingBudget };




      const url = `${base}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
      const r = await httpPostJson(
        url,
        { 'x-goog-api-key': apiKey },
        {
          systemInstruction: { parts: [{ text: req.system }] },


          contents: [{ role: 'user', parts: [{ text: req.user }] }],


          generationConfig, safetySettings,


        },


        o.timeoutMs ?? 180_000, req.signal,


      );


      if (r.status < 200 || r.status >= 300) throw classifyHttpError(r.status, r.text, r.headers);




      const data = safeJson(r.text);


      if (data?.promptFeedback?.blockReason)


        throw new ProviderError('CONTENT_FILTER', `Prompt blocked: ${data.promptFeedback.blockReason}`);


      const cand = data?.candidates?.[0];


      if (!cand) throw new ProviderError('CONTENT_FILTER', 'No candidates returned');


      const text: string = (cand.content?.parts ?? [])


        .filter((p: any) => !p.thought && typeof p.text === 'string')


        .map((p: any) => p.text).join('');


      const finishReason: string = cand.finishReason ?? 'UNKNOWN';


      if (!text.trim() && GEMINI_FILTER_REASONS.has(finishReason))


        throw new ProviderError('CONTENT_FILTER', `Candidate blocked: ${finishReason}`);


      if (!text.trim()) throw new ProviderError('TRANSIENT', `Empty response (${finishReason})`);




      const u = data.usageMetadata ?? {};


      return {


        text, finishReason, endpointId: id, model,


        promptTokens: u.promptTokenCount ?? 0,


        outputTokens: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0),


      };


    },


  };


}




export interface GroqOptions {


  model?: string;


  baseUrl?: string;


  timeoutMs?: number;


  extraBody?: Record<string, unknown>;   // e.g. { reasoning_format: 'hidden' } if supported by the model


  label?: string;


}




export function createGroqEndpoint(apiKey: string, o: GroqOptions = {}): LLMEndpoint {


  const model = o.model ?? DEFAULT_GROQ_MODEL;


  const base = (o.baseUrl ?? 'https://api.groq.com/openai/v1').replace(/\/$/, '');


  const id = o.label ?? `groq:${model}:…${apiKey.slice(-4)}`;


  return {


    id, family: 'groq', model,


    async call(req) {


      const r = await httpPostJson(


        `${base}/chat/completions`,


        { Authorization: `Bearer ${apiKey}` },


        {


          model,


          messages: [{ role: 'system', content: req.system }, { role: 'user', content: req.user }],


          temperature: req.temperature ?? 0.3,


          max_completion_tokens: req.maxOutputTokens ?? 16000,


          stream: false,


          ...(o.extraBody ?? {}),


        },


        o.timeoutMs ?? 180_000, req.signal,


      );


      if (r.status < 200 || r.status >= 300) throw classifyHttpError(r.status, r.text, r.headers);


      const data = safeJson(r.text);


      const choice = data?.choices?.[0];


      const finishReason: string = choice?.finish_reason ?? 'unknown';


      const text = stripReasoning(choice?.message?.content ?? '');


      if (finishReason === 'content_filter') throw new ProviderError('CONTENT_FILTER', 'Groq content filter');


      if (!text) throw new ProviderError('TRANSIENT', `Empty response (${finishReason})`);


      return {


        text, finishReason, endpointId: id, model,


        promptTokens: data.usage?.prompt_tokens ?? 0,


        outputTokens: data.usage?.completion_tokens ?? 0,


      };


    },


  };


}




export interface EndpointHealth { cooldownUntil: number; disabled: boolean; consecutiveFailures: number; }




export interface FailoverEvent {


  type: 'attempt' | 'success' | 'error' | 'cooldown-wait';


  endpointId?: string;


  kind?: ProviderErrorKind;


  message?: string;


  waitMs?: number;


}




export interface FailoverOptions {


  maxTransientRetries?: number;   // per endpoint, default 2


  baseBackoffMs?: number;         // default 800


  maxCooldownWaitMs?: number;     // wait for earliest cooldown if all keys are rate-limited, default 65s


  defaultQuotaCooldownMs?: number;// default 60s


  onEvent?: (e: FailoverEvent) => void;


}




/**


 * Ordered failover: endpoints are tried in the given order (primary Gemini key →


 * secondary Gemini keys → Groq). Policy:


 *  - TRANSIENT       → retry with jittered backoff, then short cooldown and move on


 *  - QUOTA           → cooldown (Retry-After / RetryInfo aware), next endpoint


 *  - AUTH            → disable endpoint for this session


 *  - CONTENT_FILTER  → skip the whole provider family (other keys hit the same filter)


 *  - BAD_REQUEST     → skip the family (e.g. context too long for that model)


 */


export class FailoverClient {


  private readonly health = new Map<string, EndpointHealth>();




  constructor(private readonly endpoints: LLMEndpoint[], private readonly opts: FailoverOptions = {}) {


    if (!endpoints.length) throw new Error('FailoverClient requires at least one endpoint');


  }




  snapshotHealth(): Record<string, EndpointHealth> { return Object.fromEntries(this.health); }


  restoreHealth(s: Record<string, EndpointHealth>): void {


    for (const [k, v] of Object.entries(s)) this.health.set(k, { ...v });


  }




  async generate(req: LLMRequest): Promise<LLMResponse> {


    const maxWait = this.opts.maxCooldownWaitMs ?? 65_000;


    let lastErrors: ProviderError[] = [];


    for (let pass = 0; pass < 2; pass++) {


      const errors: ProviderError[] = [];


      const skippedFamilies = new Set<ProviderFamily>();


      for (const ep of this.endpoints) {


        if (skippedFamilies.has(ep.family)) continue;


        const h = this.h(ep.id);


        if (h.disabled || h.cooldownUntil > Date.now()) continue;


        const r = await this.tryEndpoint(ep, h, req, errors);


        if (r.ok) return r.value;


        if (r.skipFamily) skippedFamilies.add(ep.family);


      }


      lastErrors = errors;


      const recoverable = errors.every(e => e.kind === 'QUOTA' || e.kind === 'TRANSIENT');


      const wait = this.earliestCooldown() - Date.now();


      if (pass === 0 && recoverable && wait > 0 && wait <= maxWait) {


        this.opts.onEvent?.({ type: 'cooldown-wait', waitMs: wait });


        await sleep(wait + 250, req.signal);


        continue;


      }


      break;


    }


    throw new AllProvidersFailedError(lastErrors);


  }




  private h(id: string): EndpointHealth {


    let h = this.health.get(id);


    if (!h) { h = { cooldownUntil: 0, disabled: false, consecutiveFailures: 0 }; this.health.set(id, h); }


    return h;


  }




  private earliestCooldown(): number {


    let min = Infinity;


    for (const ep of this.endpoints) {


      const h = this.h(ep.id);


      if (!h.disabled) min = Math.min(min, h.cooldownUntil);


    }


    return min;


  }




  private async tryEndpoint(


    ep: LLMEndpoint, h: EndpointHealth, req: LLMRequest, errors: ProviderError[],


  ): Promise<{ ok: true; value: LLMResponse } | { ok: false; skipFamily: boolean }> {


    const maxRetries = this.opts.maxTransientRetries ?? 2;


    const base = this.opts.baseBackoffMs ?? 800;


    for (let attempt = 0; ; attempt++) {


      this.opts.onEvent?.({ type: 'attempt', endpointId: ep.id });


      try {


        const value = await ep.call(req);


        h.consecutiveFailures = 0;


        this.opts.onEvent?.({ type: 'success', endpointId: ep.id });


        return { ok: true, value };


      } catch (raw) {


        if (req.signal?.aborted || isAbort(raw)) throw raw;


        const err = raw instanceof ProviderError


          ? raw : new ProviderError('TRANSIENT', String((raw as Error)?.message ?? raw));


        err.endpointId = ep.id;


        errors.push(err);


        h.consecutiveFailures++;


        this.opts.onEvent?.({ type: 'error', endpointId: ep.id, kind: err.kind, message: err.message });




        if (err.kind === 'TRANSIENT') {


          if (attempt < maxRetries) {


            await sleep(err.retryAfterMs ?? base * 2 ** attempt + rand(0, 400), req.signal);


            continue;


          }


          h.cooldownUntil = Date.now() + 20_000;


          return { ok: false, skipFamily: false };


        }


        if (err.kind === 'QUOTA') {


          h.cooldownUntil = Date.now() + (err.retryAfterMs ?? this.opts.defaultQuotaCooldownMs ?? 60_000);


          return { ok: false, skipFamily: false };


        }


        if (err.kind === 'AUTH') { h.disabled = true; return { ok: false, skipFamily: false }; }


        if (err.kind === 'BAD_REQUEST') { h.disabled = true; return { ok: false, skipFamily: false }; }


        return { ok: false, skipFamily: true }; // CONTENT_FILTER


      }


    }


  }


}




// ---------------------------------------------------------------------------


// 4. <LINE_NNNN> protocol


// ---------------------------------------------------------------------------


export const lineTag = (n: number) => `LINE_${pad4(n)}`;




/** Prevent source text from forging protocol tags. */


const neutralizeTags = (s: string) =>


  s.replace(/<\/?(?:LINE|SOURCE|CONTEXT_BEFORE|CONTEXT_AFTER|FAILED_ATTEMPT|ISSUES)_\d{4}>/g, '');




export function formatLines(lines: Array<{ index: number; source: string }>): string {


  return lines.map(l => `<${lineTag(l.index)}>${neutralizeTags(l.source)}</${lineTag(l.index)}>`).join('\n');


}




export interface ParsedLines {


  lines: Map<number, string>;          // first non-empty occurrence


  occurrences: Map<number, string[]>;  // every occurrence (used to pick best in repair)


  duplicates: Set<number>;


  recovered: Set<number>;              // parsed leniently (missing close tag)


}




export function parseLines(raw: string): ParsedLines {


  const text = stripReasoning(raw).replace(/```[a-zA-Z]*\n?/g, '');


  const occurrences = new Map<number, string[]>();


  const strict = /<LINE_(\d{4})>([\s\S]*?)<\/LINE_\1>/g;


  let m: RegExpExecArray | null;


  while ((m = strict.exec(text))) {


    const id = parseInt(m[1], 10);


    const arr = occurrences.get(id) ?? [];


    arr.push(m[2].trim());


    occurrences.set(id, arr);


  }


  // Lenient recovery: <LINE_0007>text   (no closing tag, terminated by next tag or EOF)


  const recovered = new Set<number>();


  const loose = /<LINE_(\d{4})>([\s\S]*?)(?=<LINE_\d{4}>|$)/g;


  while ((m = loose.exec(text))) {


    const id = parseInt(m[1], 10);


    if (occurrences.has(id)) continue;


    const body = m[2].replace(/<\/LINE_\d{4}>/g, '').trim();


    if (body) { occurrences.set(id, [body]); recovered.add(id); }


  }


  const lines = new Map<number, string>();


  const duplicates = new Set<number>();


  for (const [id, arr] of occurrences) {


    if (arr.length > 1) duplicates.add(id);


    lines.set(id, arr.find(s => s.length > 0) ?? arr[0]);


  }


  return { lines, occurrences, duplicates, recovered };


}




export interface AlignmentReport { missing: number[]; duplicates: number[]; unexpected: number[]; ok: boolean; }




export function validateAlignment(expectedIds: number[], parsed: ParsedLines): AlignmentReport {


  const expected = new Set(expectedIds);


  const missing = expectedIds.filter(id => !parsed.lines.has(id));


  const unexpected = [...parsed.lines.keys()].filter(id => !expected.has(id));


  const duplicates = [...parsed.duplicates].filter(id => expected.has(id));


  return { missing, duplicates, unexpected, ok: !missing.length && !duplicates.length && !unexpected.length };


}




// ---------------------------------------------------------------------------


// 5. Residual script detection


// ---------------------------------------------------------------------------


const CJK_RUN_RE =


  /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\u3040-\u30FF\u3100-\u312F\uAC00-\uD7AF\u{20000}-\u{2FA1F}]+/gu;


const CJK_CHAR_RE =


  /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\u3040-\u30FF\u3100-\u312F\uAC00-\uD7AF\u{20000}-\u{2FA1F}]/gu;


const LATIN_RUN_RE = /[A-Za-z][A-Za-z'’-]+(?:[\s,]+[A-Za-z][A-Za-z'’-]+){3,}/g;




export function findCjkResidue(text: string): string[] { return text.match(CJK_RUN_RE) ?? []; }


export function countCjk(text: string): number { return (text.match(CJK_CHAR_RE) ?? []).length; }




export function cjkResidualRatio(text: string): number {


  const total = text.replace(/\s/g, '').length;


  return total ? countCjk(text) / total : 0;


}




/** Flags ≥4 consecutive Latin words in the Thai output unless the source already had English prose. */


export function findForeignResidue(source: string, translated: string): string[] {


  if (/[A-Za-z]{2,}(?:\s+[A-Za-z]{2,}){3,}/.test(source)) return [];


  return translated.match(LATIN_RUN_RE) ?? [];


}




// ---------------------------------------------------------------------------


// 6. Chinese → Arabic number validator (idiom-aware)


// ---------------------------------------------------------------------------


const CN_DIGIT: Record<string, number> = {


  '零': 0, '〇': 0, '一': 1, '壹': 1, '二': 2, '贰': 2, '貳': 2, '两': 2, '兩': 2,


  '三': 3, '叁': 3, '四': 4, '肆': 4, '五': 5, '伍': 5, '六': 6, '陆': 6, '陸': 6,


  '七': 7, '柒': 7, '八': 8, '捌': 8, '九': 9, '玖': 9,


};


const CN_SMALL_UNIT: Record<string, number> = { '十': 10, '拾': 10, '百': 100, '佰': 100, '千': 1000, '仟': 1000 };


const CN_BIG_UNIT: Record<string, number> = { '万': 1e4, '萬': 1e4, '亿': 1e8, '億': 1e8 };


const CN_NUM_CLASS = [...Object.keys(CN_DIGIT), ...Object.keys(CN_SMALL_UNIT), ...Object.keys(CN_BIG_UNIT)].join('');


const isCnNum = (c: string) => c in CN_DIGIT || c in CN_SMALL_UNIT || c in CN_BIG_UNIT;




/** Known numeric idioms/set phrases whose numbers must NOT be validated. Extend per genre. */


export const NUMERIC_IDIOMS: string[] = [


  '一五一十', '三三两两', '一干二净', '千千万万', '百发百中', '百战百胜', '千变万化', '千军万马',


  '千辛万苦', '千言万语', '千山万水', '万水千山', '千真万确', '千方百计', '十万火急', '十万八千里',


  '九牛一毛', '一日三秋', '三十六计', '七七八八', '乱七八糟', '万古长青', '三千世界', '三千大千世界',


  '一千零一', '百年好合', '千秋万代', '万众一心', '一传十十传百', '以一当十', '一以当百',


];




/** Parses 三千五百 / 一万两千 / 三万五 (colloquial) / 二零二四 (positional). */


export function parseChineseNumeral(token: string): number | null {


  const chars = [...token];


  if (!chars.length) return null;


  const hasUnit = chars.some(c => c in CN_SMALL_UNIT || c in CN_BIG_UNIT);


  if (!hasUnit) {


    let v = 0;


    for (const c of chars) { const d = CN_DIGIT[c]; if (d === undefined) return null; v = v * 10 + d; }


    return v;


  }


  let total = 0, section = 0, num = 0, lastUnit = 1, prevUnit = false, abbrev = false;


  for (const c of chars) {


    const d = CN_DIGIT[c];


    if (d !== undefined) { num = d; abbrev = prevUnit; prevUnit = false; continue; }


    const su = CN_SMALL_UNIT[c];


    if (su !== undefined) {


      section += (num || 1) * su; num = 0; lastUnit = su; prevUnit = true; abbrev = false; continue;


    }


    const bu = CN_BIG_UNIT[c];


    if (bu !== undefined) {


      if (section === 0 && num === 0 && total > 0) total *= bu;          // 一万亿


      else { total += (section + num || 1) * bu; }


      section = 0; num = 0; lastUnit = bu; prevUnit = true; abbrev = false; continue;


    }


    return null;


  }


  section += abbrev && num && lastUnit >= 100 ? (num * lastUnit) / 10 : num;  // 三千五 → 3500


  return total + section;


}




function overlapsIdiom(line: string, start: number, end: number): boolean {


  for (const idiom of NUMERIC_IDIOMS) {


    let from = 0, i: number;


    while ((i = line.indexOf(idiom, from)) >= 0) {


      if (i < end && i + idiom.length > start) return true;


      from = i + 1;


    }


  }


  // Shape heuristic for 成语 like 千军万马 / 九死一生 / 四面八方: [num, x, num, x]


  for (let ws = Math.max(0, start - 3); ws < end; ws++) {


    const w = [...line.slice(ws, ws + 4)];


    if (w.length !== 4 || !w.every(c => /[\u4E00-\u9FFF]/.test(c))) continue;


    if (isCnNum(w[0]) && !isCnNum(w[1]) && isCnNum(w[2]) && !isCnNum(w[3])) return true;


  }


  return false;


}




export interface SourceNumber { raw: string; value: number; expected: string; isYear: boolean; }




const NUM_TOKEN_RE = new RegExp(


  `((?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.\\d+)?)\\s*([万萬亿億])?|([${CN_NUM_CLASS}]+)`, 'g');




export function extractSourceNumbers(line: string, threshold = 100): SourceNumber[] {


  const src = line.replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xfee0));


  const out: SourceNumber[] = [];


  let m: RegExpExecArray | null;


  NUM_TOKEN_RE.lastIndex = 0;


  while ((m = NUM_TOKEN_RE.exec(src))) {


    const start = m.index, end = start + m[0].length;


    const next = src[end] ?? '';


    let value: number | null;


    let isYear = false;


    if (m[1]) {


      value = parseFloat(m[1].replace(/,/g, '')) * (m[2] ? CN_BIG_UNIT[m[2]] : 1);


      isYear = !m[2] && /^\d{4}$/.test(m[1]) && next === '年';


    } else {


      const tok = m[3];


      if (/^[百佰千仟万萬亿億]/.test(tok)) continue;                         // literary: 千里, 万物, 千万(副词)


      if (/[一二两兩三四五六七八九壹贰貳叁肆伍陆陸柒捌玖]{2}/.test(tok) && /[十拾百佰千仟万萬亿億]/.test(tok))


        continue;                                                              // approximate: 三四百, 两三千


      if (overlapsIdiom(src, start, end)) continue;


      value = parseChineseNumeral(tok);


      isYear = value !== null && !/[十拾百佰千仟万萬亿億]/.test(tok) && next === '年' && value >= 1000 && value < 3000;


    }


    if (value === null || !isFinite(value)) continue;


    value = Math.round(value * 100) / 100;


    if (value < threshold) continue;


    out.push({ raw: m[0], value, isYear, expected: isYear ? String(value) : formatThousands(value) });


  }


  return out;


}




export function checkNumbers(source: string, translated: string, threshold = 100): LineIssue[] {


  const issues: LineIssue[] = [];


  const expected = extractSourceNumbers(source, threshold);


  const pool: string[] = translated.match(/\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/g) ?? [];


  for (const exp of expected) {


    let i = pool.indexOf(exp.expected);


    if (i >= 0) { pool.splice(i, 1); continue; }


    i = pool.findIndex(t => t.replace(/,/g, '') === exp.expected.replace(/,/g, ''));


    if (i >= 0) {


      pool.splice(i, 1);


      issues.push({ code: 'NUMBER_FORMAT', detail: `"${exp.raw}" must be written as ${exp.expected}` });


    } else {


      issues.push({ code: 'NUMBER_MISMATCH', detail: `"${exp.raw}" (= ${exp.expected}) missing or changed` });


    }


  }


  // Large Arabic numbers without separators that aren't years


  const bare = /(ปี\s*|ค\.ศ\.\s*|พ\.ศ\.\s*)?(?<![\d,.])(\d{4,})(?![\d,])/g;


  let m: RegExpExecArray | null;


  while ((m = bare.exec(translated))) {


    if (m[1] || (m[2].length === 4 && expected.some(e => e.isYear && e.expected === m![2]))) continue;


    issues.push({ code: 'NUMBER_FORMAT', detail: `${m[2]} must use thousands separators (${formatThousands(+m[2])})` });


  }


  return issues;


}




// ---------------------------------------------------------------------------


// 7. Glossary compliance


// ---------------------------------------------------------------------------


export class GlossaryMatcher {


  private readonly forms: Array<{ form: string; term: GlossaryTerm }>;


  constructor(terms: GlossaryTerm[], strictConfidence = 0.85) {


    this.forms = terms


      .filter(t => t.locked || t.confidence >= strictConfidence)


      .flatMap(t => [t.sourceTerm, ...(t.aliases ?? [])].filter(Boolean).map(form => ({ form, term: t })))


      .sort((a, b) => b.form.length - a.form.length);   // longest match wins (林动天 before 林动)


  }


  check(source: string, translated: string): LineIssue[] {


    let masked = source;


    const seen = new Set<GlossaryTerm>();


    const issues: LineIssue[] = [];


    for (const { form, term } of this.forms) {


      if (!masked.includes(form)) continue;


      masked = masked.split(form).join('\u0000'.repeat(form.length));


      if (seen.has(term)) continue;


      seen.add(term);


      if (!translated.includes(term.translatedTerm))


        issues.push({ code: 'GLOSSARY_VIOLATION', detail: `${form} → must be "${term.translatedTerm}"` });


    }


    return issues;


  }


}




export interface ValidationContext { glossary: GlossaryMatcher; numberThreshold: number; }




export function validateLine(source: string, translated: string | null | undefined, ctx: ValidationContext): LineIssue[] {


  if (translated == null) return [{ code: 'MISSING', detail: 'Line was not returned' }];


  if (!translated.trim()) return source.trim() ? [{ code: 'EMPTY', detail: 'Empty translation' }] : [];


  const issues: LineIssue[] = [];


  const cjk = findCjkResidue(translated);


  if (cjk.length) issues.push({ code: 'CJK_RESIDUAL', detail: `Untranslated: ${cjk.slice(0, 6).join(', ')}` });


  const latin = findForeignResidue(source, translated);


  if (latin.length) issues.push({ code: 'FOREIGN_RESIDUAL', detail: `Foreign text: ${latin[0].slice(0, 60)}` });


  issues.push(...checkNumbers(source, translated, ctx.numberThreshold));


  issues.push(...ctx.glossary.check(source, translated));


  return issues;


}




const ISSUE_WEIGHT: Record<IssueCode, number> = {


  MISSING: 100, EMPTY: 100, CJK_RESIDUAL: 25, GLOSSARY_VIOLATION: 12,


  NUMBER_MISMATCH: 10, NUMBER_FORMAT: 4, FOREIGN_RESIDUAL: 6, DUPLICATE_TAG: 3,


};


export const issueScore = (issues: LineIssue[]) => issues.reduce((s, i) => s + ISSUE_WEIGHT[i.code], 0);




// ---------------------------------------------------------------------------


// 8. Non-story classifier


// ---------------------------------------------------------------------------


const IN_WORLD_SYSTEM_RE =


  /^\s*(?:[【\[〖]\s*(?:系统|系統|叮|任务|任務|提示|面板|属性|屬性|恭喜|警告|奖励|獎勵|System|Quest|Status)|叮[!！~～\s])|宿主/i;




const BUILTIN_NON_STORY: Array<{ kind: NonStoryKind; re: RegExp }> = [


  { kind: 'ADVERTISEMENT', re: /(?:https?:\/\/|www\.|\.(?:com|net|org|cc|la|info)\b|最新章[节節]|手[机機]阅读|手機閱讀|笔趣阁|筆趣閣|请记住本站|請記住本站|本站域名|免费阅读|天才一秒记住)/i },


  { kind: 'AUTHOR_NOTE', re: /^\s*(?:作者有话说|作者有話說|作者的话|作者按|题外话|PS[:：.\s]|P\.S\.|求(?:月票|推荐票|推薦票|收藏|订阅|訂閱|打赏)|感谢.{0,30}(?:打赏|月票|盟主|推荐票))/i },


  { kind: 'NAVIGATION_TEXT', re: /^\s*(?:上一[章页頁]|下一[章页頁]|返回目录|目录|目錄|章节目录|加入书签|加入書籤|Previous Chapter|Next Chapter|Table of Contents)\s*$|(?:上一章|下一章).{0,6}(?:目录|书签)/i },


  { kind: 'CREDITS', re: /^\s*(?:翻译|翻譯|校对|校對|Translator|Translated by|Editor|Edited by|TL|ED|PR)\s*[:：]/i },


];




export function classifyNonStory(paragraphs: string[], domain?: string, patterns: NonStoryPattern[] = []): NonStoryKind[] {


  const domainRules = patterns


    .filter(p => !domain || domain.endsWith(p.domain))


    .flatMap(p => { try { return [{ kind: p.kind as NonStoryKind, re: new RegExp(p.pattern, p.flags ?? 'i') }]; } catch { return []; } });




  const n = paragraphs.length;


  let trailingAuthorBlock = false;


  return paragraphs.map((p, i) => {


    if (IN_WORLD_SYSTEM_RE.test(p)) return 'SYSTEM_MESSAGE_IN_WORLD';


    if (trailingAuthorBlock) return 'AUTHOR_NOTE';


    for (const r of [...domainRules, ...BUILTIN_NON_STORY]) {


      if (r.re.test(p)) {


        if (r.kind === 'AUTHOR_NOTE' && i >= n * 0.6) trailingAuthorBlock = true; // rest of chapter is the note


        return r.kind;


      }


    }


    return 'STORY';


  });


}




// ---------------------------------------------------------------------------


// 9. Prompt builder (glossary, relationships, pronoun matrix, spelling memory)


// ---------------------------------------------------------------------------


export const PRONOUN_MATRIX: Record<Genre, string> = {


  WUXIA: [


    '- 我/吾 → ข้า ; 在下 → ข้าน้อย/ผู้น้อย (ถ่อมตน)',


    '- 你 → เจ้า ; ต่อผู้อาวุโสหรือผู้มีฐานะสูง → ท่าน',


    '- 他 → เขา ; 她 → นาง',


    '- 师父 → ท่านอาจารย์ ; 前辈 → ท่านผู้อาวุโส ; 大侠 → จอมยุทธ์',


    '- ไม่ใช้ ครับ/ค่ะ ในบทสนทนาโบราณ ผู้น้อยชายใช้ "ขอรับ" ผู้น้อยหญิงใช้ "เจ้าค่ะ"',


  ].join('\n'),


  XIANXIA: [


    '- 我 → ข้า ; 本座/本尊 → ข้า (ผู้มีอำนาจสูง) ; 在下/晚辈 → ผู้น้อย',


    '- 你 → เจ้า ; ต่อผู้อาวุโส → ท่าน ; 道友 → สหายเต๋า',


    '- 他 → เขา ; 她 → นาง',


    '- 师兄 → ศิษย์พี่ ; 师姐 → ศิษย์พี่หญิง ; 师弟 → ศิษย์น้อง ; 师妹 → ศิษย์น้องหญิง',


    '- 师父/师尊 → ท่านอาจารย์ ; 宗主 → เจ้าสำนัก ; 老祖 → ท่านบรรพชน',


    '- ไม่ใช้ ครับ/ค่ะ ผู้น้อยชายใช้ "ขอรับ" ผู้น้อยหญิงใช้ "เจ้าค่ะ"',


  ].join('\n'),


  PERIOD: [


    '- 朕 → เรา (จักรพรรดิ) ; 陛下 → ฝ่าบาท ; 王爷 → ท่านอ๋อง ; 娘娘 → พระสนม/เหนียงเหนียง',


    '- 臣 → กระหม่อม (ขุนนางชาย) / หม่อมฉัน (หญิง) ; 本宫 → เปิ่นกง ; 奴婢 → บ่าว',


    '- 你 → เจ้า ; 他 → เขา ; 她 → นาง',


    '- ผู้น้อยชายลงท้าย "ขอรับ/พ่ะย่ะค่ะ" ผู้น้อยหญิงลงท้าย "เจ้าค่ะ/เพคะ" ตามเพศผู้พูด',


  ].join('\n'),


  MODERN: [


    '- 我 → ผม (ผู้พูดชาย) / ฉัน (ผู้พูดหญิง) ; สนิทกันอาจใช้ ฉัน/นาย/เธอ',


    '- 你 → คุณ (สุภาพ) / นาย / เธอ (สนิท) ; 他 → เขา ; 她 → เธอ',


    '- คำลงท้ายสุภาพ: ครับ (ผู้พูดชาย) / ค่ะ, คะ (ผู้พูดหญิง) เท่านั้น',


  ].join('\n'),


};




export interface PromptContext {


  genre: Genre;


  chapterNumber: number;


  glossary: GlossaryTerm[];


  characters: CharacterProfile[];


  relationships: CharacterRelationship[];


  spellingMemory: Record<string, string>;


  strictConfidence: number;


}




/** Narrows context to what appears in this chapter (keeps prompts small). */


export function selectRelevantContext(input: ChapterInput, strictConfidence: number, maxTerms = 400): PromptContext {


  const src = input.sourceText;


  const appears = (t: GlossaryTerm) => [t.sourceTerm, ...(t.aliases ?? [])].some(f => f && src.includes(f));


  const glossary = input.glossary


    .filter(t => t.category === 'CULTIVATION' || appears(t))


    .slice(0, maxTerms);


  const characters = input.characters.filter(c => src.includes(c.sourceName));


  const present = new Set(characters.map(c => c.sourceName));


  const relationships = input.relationships.filter(r =>


    input.chapterNumber >= r.activeFromChapter &&


    (r.activeUntilChapter === undefined || input.chapterNumber <= r.activeUntilChapter) &&


    (present.has(r.from) || present.has(r.to)));


  const spellingMemory: Record<string, string> = {};


  for (const [han, thai] of Object.entries(input.spellingMemory ?? {})) if (src.includes(han)) spellingMemory[han] = thai;


  return { genre: input.genre, chapterNumber: input.chapterNumber, glossary, characters, relationships, spellingMemory, strictConfidence };


}




export function buildSystemPrompt(ctx: PromptContext): string {


  const parts: string[] = [];


  parts.push('You are NEXUS, a professional Chinese→Thai web-novel translator. Produce faithful, natural, literary Thai that reads well aloud as an audiobook.');


  parts.push(`## OUTPUT PROTOCOL (STRICT)


- Each input line is wrapped as <LINE_NNNN>…</LINE_NNNN>. Return EVERY line exactly once with the SAME tag, in the same order.


- One input line = one output line. Never merge, split, skip, reorder or invent lines. Output nothing outside the tags: no notes, no markdown.


- If a line is only punctuation or symbols, copy it unchanged inside its tag.


- In-world system/game messages (e.g. 【系统提示】) are part of the story: translate them and keep their brackets.`);


  parts.push(`## SCRIPT RULES


- The output must contain ZERO Chinese, Japanese or Korean characters. Transliterate names; translate everything else.`);


  parts.push(`## NUMBER RULES (deterministic)


- Quantities ≥ 100 → Arabic digits WITH thousands separators: 三千 → 3,000 ; 一万两千 → 12,000 ; 1.5万 → 15,000.


- Calendar years have no separator: 二零二四年 → ปี 2024.


- Quantities below 100 may be Thai words if more natural.


- Never convert numbers inside idioms (成语) such as 一心一意, 千军万马, 十万火急 — translate the idiom's meaning.`);


  parts.push(`## PRONOUNS & REGISTER (${ctx.genre})\n${PRONOUN_MATRIX[ctx.genre]}


- Gendered particles follow the SPEAKER's gender, never the listener's. If the speaker's gender is unknown, omit the particle.`);




  if (ctx.characters.length) {


    parts.push('## CHARACTERS (names are locked)\n' + ctx.characters.map(c =>


      `- ${c.sourceName} → ${c.thaiName} | ${c.gender === 'MALE' ? 'ชาย (ครับ/ขอรับ)' : c.gender === 'FEMALE' ? 'หญิง (ค่ะ/เจ้าค่ะ)' : 'ไม่ทราบเพศ'}` +


      (c.selfPronoun ? ` | แทนตัวเองว่า "${c.selfPronoun}"` : '') + (c.note ? ` | ${c.note}` : '')).join('\n'));


  }


  if (ctx.relationships.length) {


    const nameOf = (s: string) => ctx.characters.find(c => c.sourceName === s)?.thaiName ?? s;


    parts.push(`## RELATIONSHIPS ACTIVE IN CHAPTER ${ctx.chapterNumber}\n` + ctx.relationships.map(r =>


      `- ${nameOf(r.from)} → ${nameOf(r.to)}: ${r.type}` +


      (r.fromCallsTo ? `; addresses them as "${r.fromCallsTo}"` : '') + (r.note ? `; ${r.note}` : '')).join('\n'));


  }


  const locked = ctx.glossary.filter(t => t.category !== 'CULTIVATION' && (t.locked || t.confidence >= ctx.strictConfidence));


  const preferred = ctx.glossary.filter(t => t.category !== 'CULTIVATION' && !(t.locked || t.confidence >= ctx.strictConfidence));


  const fmt = (t: GlossaryTerm) =>


    `- ${t.sourceTerm}${t.aliases?.length ? ` (${t.aliases.join('/')})` : ''} → ${t.translatedTerm} [${t.category}]`;


  if (locked.length) parts.push('## GLOSSARY — MANDATORY (use exactly)\n' + locked.map(fmt).join('\n'));


  if (preferred.length) parts.push('## GLOSSARY — PREFERRED\n' + preferred.map(fmt).join('\n'));


  const ladder = ctx.glossary.filter(t => t.category === 'CULTIVATION')


    .sort((a, b) => (a.cultivationOrder ?? 0) - (b.cultivationOrder ?? 0));


  if (ladder.length) parts.push('## CULTIVATION REALMS (low → high, mandatory)\n' +


    ladder.map((t, i) => `${i + 1}. ${t.sourceTerm} → ${t.translatedTerm}`).join('\n'));


  const spell = Object.entries(ctx.spellingMemory);


  if (spell.length) parts.push('## TRANSLITERATION MEMORY (use these syllables for any NEW names)\n' +


    spell.map(([h, t]) => `${h}=${t}`).join(', '));


  return parts.join('\n\n');


}




export function buildTranslatePrompt(batch: Array<{ index: number; source: string }>, previousContext: string): string {


  const ids = batch.map(l => lineTag(l.index));


  return [


    previousContext


      ? `<PREVIOUS_CONTEXT>\n${previousContext}\n</PREVIOUS_CONTEXT>\n(Read-only Thai text that precedes this passage. Use it for continuity. Do NOT translate or repeat it.)`


      : '',


    `Translate the ${batch.length} lines below. Required tags, in order: ${ids.join(', ')}.`,


    '<SOURCE>', formatLines(batch), '</SOURCE>',


  ].filter(Boolean).join('\n');


}




export interface RepairItem {


  index: number;


  source: string;


  failed: string | null;


  issues: LineIssue[];


  before?: { source: string; translated: string | null };


  after?: { source: string; translated: string | null };


}




export function buildRepairPrompt(items: RepairItem[]): string {


  const blocks = items.map(it => {


    const n = pad4(it.index);


    const ctxBlock = (tag: string, c?: { source: string; translated: string | null }) => c


      ? `<${tag}_${n}>\n[SOURCE] ${neutralizeTags(c.source)}\n[THAI] ${c.translated ?? '(not available)'}\n</${tag}_${n}>`


      : `<${tag}_${n}>(start/end of passage)</${tag}_${n}>`;


    return [


      `<REPAIR_TASK id="${n}">`,


      ctxBlock('CONTEXT_BEFORE', it.before),


      `<SOURCE_${n}>${neutralizeTags(it.source)}</SOURCE_${n}>`,


      `<FAILED_ATTEMPT_${n}>${it.failed ?? '(missing)'}</FAILED_ATTEMPT_${n}>`,


      `<ISSUES_${n}>\n${it.issues.map(i => `- ${i.code}: ${i.detail}`).join('\n')}\n</ISSUES_${n}>`,


      ctxBlock('CONTEXT_AFTER', it.after),


      '</REPAIR_TASK>',


    ].join('\n');


  });


  return [


    'SURGICAL REPAIR MODE. Re-translate ONLY the SOURCE line of each task, fixing every listed issue while obeying all system rules.',


    'CONTEXT_BEFORE / CONTEXT_AFTER are read-only — use them for continuity, pronouns and tone; never output them.',


    `Return exactly ${items.length} tag(s): ${items.map(i => lineTag(i.index)).join(', ')} — format <LINE_NNNN>Thai text</LINE_NNNN>, nothing else.`,


    '', ...blocks,


  ].join('\n');


}




// ---------------------------------------------------------------------------


// 10. NEXUS Translation & Repair Engine


// ---------------------------------------------------------------------------


export interface ModelPricing { inputPerMTok: number; outputPerMTok: number; }




export interface NexusProgress {


  phase: 'classify' | 'translate' | 'repair' | 'done';


  batch?: number; totalBatches?: number; round?: number; failedLines?: number;


}




export interface CheckpointSnapshot {


  novelId: string; chapterNumber: number;


  translations: Record<number, string>;   // persist → pass back as ChapterInput.resume


}




export interface EngineOptions {


  client: Pick<FailoverClient, 'generate'>;


  maxBatchChars?: number;          // source chars per call (default 2,500 CJK chars)


  maxBatchLines?: number;          // default 120


  maxRepairRounds?: number;        // default 3


  maxRepairLinesPerCall?: number;  // default 20


  previousContextChars?: number;   // default 3,000


  strictGlossaryConfidence?: number; // default 0.85


  numberThreshold?: number;        // default 100


  temperature?: number;            // default 0.3


  repairTemperature?: number;      // default 0.2


  maxOutputTokens?: number;        // default 16,000


  keepNonStoryInOutput?: boolean;  // default false


  pricing?: Record<string, ModelPricing>;


  onProgress?: (p: NexusProgress) => void;


  onCheckpoint?: (s: CheckpointSnapshot) => void | Promise<void>;


}




export class NexusTranslationEngine {


  constructor(private readonly o: EngineOptions) {}




  private get cfg() {


    const o = this.o;


    return {


      maxBatchChars: o.maxBatchChars ?? 2500, maxBatchLines: o.maxBatchLines ?? 120,


      maxRepairRounds: o.maxRepairRounds ?? 3, maxRepairLinesPerCall: o.maxRepairLinesPerCall ?? 20,


      prevChars: o.previousContextChars ?? 3000, strict: o.strictGlossaryConfidence ?? 0.85,


      numberThreshold: o.numberThreshold ?? 100, temperature: o.temperature ?? 0.3,


      repairTemperature: o.repairTemperature ?? 0.2, maxOutputTokens: o.maxOutputTokens ?? 16000,


    };


  }




  async translateChapter(input: ChapterInput, signal?: AbortSignal): Promise<ChapterResult> {


    const c = this.cfg;


    const t0 = Date.now();


    const tel: TranslationTelemetry = {


      status: 'COMPLETED', linesTotal: 0, linesStory: 0, linesNonStory: 0, linesFailed: 0,


      linesRepaired: 0, repairRounds: 0, promptTokens: 0, outputTokens: 0,


      estimatedCostUsd: 0, cjkResidualRatio: 0, durationMs: 0, calls: [],


    };




    // 1. Split + classify


    this.o.onProgress?.({ phase: 'classify' });


    const paragraphs = splitParagraphs(input.sourceText);


    if (paragraphs.length > 9999) throw new Error('Chapter exceeds 9,999 lines (LINE_NNNN limit)');


    const kinds = classifyNonStory(paragraphs, input.sourceDomain, input.nonStoryPatterns);


    const lines: LineResult[] = paragraphs.map((source, i) =>


      ({ index: i + 1, kind: kinds[i], source, translated: null, issues: [], repaired: false }));


    const work = lines.filter(l => l.kind === 'STORY' || l.kind === 'SYSTEM_MESSAGE_IN_WORLD');


    const workPos = new Map(work.map((l, i) => [l.index, i]));




    const vctx: ValidationContext = {


      glossary: new GlossaryMatcher(input.glossary, c.strict),


      numberThreshold: c.numberThreshold,


    };


    const system = buildSystemPrompt(selectRelevantContext(input, c.strict));




    // Resume from checkpoint (iOS may kill the process mid-chapter)


    if (input.resume) for (const l of work) {


      const saved = input.resume[l.index];


      if (saved != null) { l.translated = saved; l.issues = validateLine(l.source, saved, vctx); }


    }




    try {


      // 2. Batched translation with rolling context


      let rolling = tail(input.previousChapterTranslated ?? '', c.prevChars);


      const batches = this.makeBatches(work.filter(l => l.translated == null), c.maxBatchChars, c.maxBatchLines);


      for (let bi = 0; bi < batches.length; bi++) {


        const batch = batches[bi];


        this.o.onProgress?.({ phase: 'translate', batch: bi + 1, totalBatches: batches.length });


        const resp = await this.call(system, buildTranslatePrompt(batch, rolling), c.temperature, 'translate', tel, signal);


        const parsed = parseLines(resp.text);


        for (const l of batch) {


          l.translated = parsed.lines.get(l.index) ?? null;


          l.issues = validateLine(l.source, l.translated, vctx);


          if (parsed.duplicates.has(l.index)) l.issues.push({ code: 'DUPLICATE_TAG', detail: 'Tag returned more than once' });


        }


        rolling = tail(rolling + '\n' + batch.map(l => l.translated ?? '').join('\n'), c.prevChars);


        await this.checkpoint(input, work);


      }




      // 3. Surgical repair loop


      for (let round = 1; round <= c.maxRepairRounds; round++) {


        const failed = work.filter(l => l.issues.length > 0);


        if (!failed.length) break;


        tel.repairRounds = round;


        this.o.onProgress?.({ phase: 'repair', round, failedLines: failed.length });


        for (const group of chunk(failed, c.maxRepairLinesPerCall)) {


          const items: RepairItem[] = group.map(l => {


            const p = workPos.get(l.index)!;


            const b = work[p - 1], a = work[p + 1];


            return {


              index: l.index, source: l.source, failed: l.translated, issues: l.issues,


              before: b ? { source: b.source, translated: b.translated } : undefined,


              after: a ? { source: a.source, translated: a.translated } : undefined,


            };


          });


          const resp = await this.call(system, buildRepairPrompt(items), c.repairTemperature, 'repair', tel, signal);


          const parsed = parseLines(resp.text);


          for (const l of group) {


            const candidates = parsed.occurrences.get(l.index) ?? [];


            let best: { text: string; issues: LineIssue[] } | null = null;


            for (const cand of candidates) {


              const ci = validateLine(l.source, cand, vctx);


              if (!best || issueScore(ci) < issueScore(best.issues)) best = { text: cand, issues: ci };


            }


            if (best && issueScore(best.issues) < issueScore(l.issues)) {


              l.translated = best.text; l.issues = best.issues; l.repaired = true;


            }


          }


        }


        await this.checkpoint(input, work);


      }


      tel.status = work.some(l => l.issues.length) ? 'COMPLETED_WITH_ISSUES' : 'COMPLETED';


    } catch (e) {


      if (isAbort(e)) tel.status = 'ABORTED';


      else if (e instanceof AllProvidersFailedError) tel.status = 'PROVIDERS_EXHAUSTED';


      else throw e;


      tel.error = (e as Error).message;


      for (const l of work) if (l.translated == null && !l.issues.length) l.issues = [{ code: 'MISSING', detail: 'Not translated (job interrupted)' }];


    }




    // 4. Assemble output + telemetry


    const keepNonStory = this.o.keepNonStoryInOutput ?? false;


    const translatedText = lines


      .filter(l => keepNonStory || l.kind === 'STORY' || l.kind === 'SYSTEM_MESSAGE_IN_WORLD')


      .map(l => (l.kind === 'STORY' || l.kind === 'SYSTEM_MESSAGE_IN_WORLD') ? (l.translated ?? `⟦${l.source}⟧`) : l.source)


      .join('\n');


    const ttsText = work


      .filter(l => l.translated && !l.issues.some(i => i.code === 'MISSING' || i.code === 'EMPTY'))


      .map(l => normalizeForTts(l.translated!))


      .filter(Boolean)


      .join('\n');




    const allThai = work.map(l => l.translated ?? '').join('');


    tel.linesTotal = lines.length;


    tel.linesStory = work.length;


    tel.linesNonStory = lines.length - work.length;


    tel.linesFailed = work.filter(l => l.issues.length).length;


    tel.linesRepaired = work.filter(l => l.repaired).length;


    tel.cjkResidualRatio = cjkResidualRatio(allThai);


    tel.durationMs = Date.now() - t0;


    this.o.onProgress?.({ phase: 'done' });


    return { lines, translatedText, ttsText, telemetry: tel };


  }




  private makeBatches(ls: LineResult[], maxChars: number, maxLines: number): LineResult[][] {


    const out: LineResult[][] = [];


    let cur: LineResult[] = [], size = 0;


    for (const l of ls) {


      if (cur.length && (size + l.source.length > maxChars || cur.length >= maxLines)) { out.push(cur); cur = []; size = 0; }


      cur.push(l); size += l.source.length;


    }


    if (cur.length) out.push(cur);


    return out;


  }




  private async call(


    system: string, user: string, temperature: number, purpose: 'translate' | 'repair',


    tel: TranslationTelemetry, signal?: AbortSignal,


  ): Promise<LLMResponse> {


    const r = await this.o.client.generate({ system, user, temperature, maxOutputTokens: this.cfg.maxOutputTokens, signal });


    const price = this.o.pricing?.[r.model];


    const costUsd = price ? (r.promptTokens * price.inputPerMTok + r.outputTokens * price.outputPerMTok) / 1e6 : 0;


    tel.calls.push({ endpointId: r.endpointId, model: r.model, promptTokens: r.promptTokens, outputTokens: r.outputTokens, costUsd, finishReason: r.finishReason, purpose });


    tel.promptTokens += r.promptTokens;


    tel.outputTokens += r.outputTokens;


    tel.estimatedCostUsd += costUsd;


    return r;


  }




  private async checkpoint(input: ChapterInput, work: LineResult[]): Promise<void> {


    if (!this.o.onCheckpoint) return;


    const translations: Record<number, string> = {};


    for (const l of work) if (l.translated != null && !l.issues.some(i => i.code === 'MISSING')) translations[l.index] = l.translated;


    await this.o.onCheckpoint({ novelId: input.novelId, chapterNumber: input.chapterNumber, translations });


  }


}




/** Cleans a line for TTS: drops residual CJK, decorative brackets, repeated punctuation. */


export function normalizeForTts(s: string): string {


  return s


    .replace(CJK_RUN_RE, ' ')


    .replace(/[【】〖〗「」『』]/g, ' ')


    .replace(/(…|\.{3,}){2,}/g, '…')


    .replace(/[~～]+/g, ' ')


    .replace(/\s{2,}/g, ' ')


    .trim();


}




// ---------------------------------------------------------------------------


// 11. Radio Drama — procedural Web Audio soundscapes


// ---------------------------------------------------------------------------


export type SceneId =


  | 'RAIN' | 'STORM' | 'FOREST' | 'CAVE' | 'BATTLE' | 'FIRE'


  | 'NIGHT' | 'CROWD' | 'BREAKTHROUGH' | 'TENSION' | 'SADNESS';




export const THAI_SCENE_KEYWORDS: Record<SceneId, RegExp> = {


  RAIN: /ฝน|ละอองน้ำ|หยาดน้ำฟ้า|เปียกปอน/g,


  STORM: /พายุ|ฟ้าร้อง|ฟ้าผ่า|สายฟ้า|อสนี|อัสนี|ทัณฑ์สวรรค์|ฟ้าคำราม/g,


  FOREST: /ป่า(?!ช้า)|พงไพร|ไพรพฤกษ์|ต้นไม้|ใบไม้|หุบเขา|ขุนเขา|เสียงนก/g,


  CAVE: /ถ้ำ|คูหา|อุโมงค์|ใต้ดิน|ห้องลับ|สุสาน|ซากโบราณ/g,


  BATTLE: /ดาบ|กระบี่|ทวน|ต่อสู้|ปะทะ|ฟาดฟัน|โจมตี|ประมือ|หมัด|ฝ่ามือ|ศึก/g,


  FIRE: /เปลวไฟ|เปลวเพลิง|เพลิง|กองไฟ|เตาหลอม|เตาโอสถ|หลอมโอสถ|ปรุงยา|เผาไหม้|ลุกไหม้|ไฟ(?!ฟ้า)/g,


  NIGHT: /กลางคืน|ราตรี|ยามดึก|ดึกสงัด|แสงจันทร์|จันทรา|ดวงจันทร์|ดวงดาว|รัตติกาล/g,


  CROWD: /โรงเตี๊ยม|ร้านสุรา|ร้านน้ำชา|ตลาด|ฝูงชน|ผู้คนมากมาย|จอแจ|อึกทึก|งานเลี้ยง|โรงประมูล/g,


  BREAKTHROUGH: /ทะลวง|ฝ่าด่าน|ทะลุขั้น|ทะลุระดับ|บรรลุ|เลื่อนขั้น|ขอบเขตใหม่|ปราณพลุ่งพล่าน/g,


  TENSION: /ตึงเครียด|จิตสังหาร|เจตนาสังหาร|อันตราย|หวาดกลัว|ขนลุก|เย็นเยียบ|แรงกดดัน|ซุ่มโจมตี/g,


  SADNESS: /เศร้า|โศก|ร่ำไห้|ร้องไห้|น้ำตา|อาลัย|สิ้นใจ|ลาลับ|ปวดร้าว|ขมขื่น/g,


};




const SCENE_PROFILE: Record<SceneId, { gain: number; send: number; kind: 'ambience' | 'music' }> = {


  RAIN: { gain: 0.55, send: 0.15, kind: 'ambience' }, STORM: { gain: 0.7, send: 0.2, kind: 'ambience' },


  FOREST: { gain: 0.5, send: 0.2, kind: 'ambience' }, CAVE: { gain: 0.6, send: 0.9, kind: 'ambience' },


  BATTLE: { gain: 0.55, send: 0.25, kind: 'ambience' }, FIRE: { gain: 0.5, send: 0.1, kind: 'ambience' },


  NIGHT: { gain: 0.45, send: 0.25, kind: 'ambience' }, CROWD: { gain: 0.45, send: 0.15, kind: 'ambience' },


  BREAKTHROUGH: { gain: 0.5, send: 0.5, kind: 'music' }, TENSION: { gain: 0.5, send: 0.35, kind: 'music' },


  SADNESS: { gain: 0.45, send: 0.6, kind: 'music' },


};




export function detectScenes(text: string, keywords = THAI_SCENE_KEYWORDS): Map<SceneId, number> {


  const hits = new Map<SceneId, number>();


  for (const id of Object.keys(keywords) as SceneId[]) {


    const n = (text.match(keywords[id]) ?? []).length;


    if (n) hits.set(id, n);


  }


  return hits;


}




type NoiseColor = 'white' | 'pink' | 'brown';


const midiHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);




function makeNoise(ctx: BaseAudioContext, color: NoiseColor, seconds = 6): AudioBuffer {


  const len = Math.floor(ctx.sampleRate * seconds);


  const buf = ctx.createBuffer(1, len, ctx.sampleRate);


  const d = buf.getChannelData(0);


  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;


  for (let i = 0; i < len; i++) {


    const w = Math.random() * 2 - 1;


    if (color === 'white') d[i] = w * 0.5;


    else if (color === 'pink') {           // Paul Kellet's refined method


      b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759;


      b2 = 0.969 * b2 + w * 0.153852;    b3 = 0.8665 * b3 + w * 0.3104856;


      b4 = 0.55 * b4 + w * 0.5329522;    b5 = -0.7616 * b5 - w * 0.016898;


      d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926;


    } else { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }


  }


  return buf;


}




function makeImpulse(ctx: BaseAudioContext, seconds = 2.8, decay = 2.6): AudioBuffer {


  const len = Math.floor(ctx.sampleRate * seconds);


  const buf = ctx.createBuffer(2, len, ctx.sampleRate);


  for (let ch = 0; ch < 2; ch++) {


    const d = buf.getChannelData(ch);


    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);


  }


  return buf;


}




interface BurstOpts {


  color?: NoiseColor; dur: number; peak: number; attack?: number;


  filter?: BiquadFilterType; freq?: number; freqEnd?: number; q?: number;


}




class SynthKit {


  readonly noise: Record<NoiseColor, AudioBuffer>;


  constructor(readonly ctx: AudioContext) {


    this.noise = { white: makeNoise(ctx, 'white'), pink: makeNoise(ctx, 'pink'), brown: makeNoise(ctx, 'brown') };


  }




  tone(dest: AudioNode, when: number, f0: number, f1: number, dur: number,


       type: OscillatorType, peak: number, attack = 0.005): void {


    const { ctx } = this;


    const o = ctx.createOscillator(); o.type = type;


    o.frequency.setValueAtTime(f0, when);


    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), when + dur);


    const g = ctx.createGain();


    g.gain.setValueAtTime(0.0001, when);


    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), when + Math.min(attack, dur * 0.5));


    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);


    o.connect(g); g.connect(dest);


    o.start(when); o.stop(when + dur + 0.05);


    o.onended = () => { o.disconnect(); g.disconnect(); };


  }




  pad(dest: AudioNode, when: number, hz: number, dur: number, peak: number): void {


    const { ctx } = this;


    const g = ctx.createGain();


    g.gain.setValueAtTime(0.0001, when);


    g.gain.linearRampToValueAtTime(peak, when + Math.min(1.8, dur * 0.4));


    g.gain.setValueAtTime(peak, when + dur * 0.7);


    g.gain.linearRampToValueAtTime(0.0001, when + dur);


    g.connect(dest);


    const oscs = [ctx.createOscillator(), ctx.createOscillator()];


    oscs[0].type = 'triangle'; oscs[0].frequency.value = hz;


    oscs[1].type = 'sine'; oscs[1].frequency.value = hz; oscs[1].detune.value = 5;


    for (const o of oscs) { o.connect(g); o.start(when); o.stop(when + dur + 0.1); }


    oscs[0].onended = () => { oscs.forEach(o => o.disconnect()); g.disconnect(); };


  }




  noiseBurst(dest: AudioNode, when: number, o: BurstOpts): void {


    const { ctx } = this;


    const src = ctx.createBufferSource();


    src.buffer = this.noise[o.color ?? 'white'];


    const g = ctx.createGain();


    const attack = Math.min(o.attack ?? 0.002, o.dur * 0.5);


    g.gain.setValueAtTime(0.0001, when);


    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, o.peak), when + attack);


    g.gain.exponentialRampToValueAtTime(0.0001, when + o.dur);


    let f: BiquadFilterNode | null = null;


    if (o.filter) {


      f = ctx.createBiquadFilter(); f.type = o.filter; f.Q.value = o.q ?? 0.8;


      f.frequency.setValueAtTime(o.freq ?? 1000, when);


      if (o.freqEnd) f.frequency.exponentialRampToValueAtTime(o.freqEnd, when + o.dur);


      src.connect(f); f.connect(g);


    } else src.connect(g);


    g.connect(dest);


    const maxOffset = Math.max(0, src.buffer.duration - o.dur - 0.1);


    src.start(when, Math.random() * maxOffset, o.dur + 0.05);


    src.onended = () => { src.disconnect(); f?.disconnect(); g.disconnect(); };


  }


}




abstract class SoundLayer {


  readonly out: GainNode;


  private readonly send: GainNode;


  private readonly loops: AudioScheduledSourceNode[] = [];


  private readonly timers: Record<string, number> = {};




  constructor(protected readonly kit: SynthKit, dest: AudioNode, reverbIn: AudioNode | null, sendLevel: number) {


    const ctx = kit.ctx;


    this.out = ctx.createGain(); this.out.gain.value = 0.0001; this.out.connect(dest);


    this.send = ctx.createGain(); this.send.gain.value = sendLevel;


    if (reverbIn) { this.out.connect(this.send); this.send.connect(reverbIn); }


  }




  protected get ctx(): AudioContext { return this.kit.ctx; }


  abstract build(): void;


  tick(_now: number, _until: number): void { /* optional event scheduling */ }




  fadeTo(level: number, sec: number): void {


    const t = this.ctx.currentTime, g = this.out.gain;


    g.cancelScheduledValues(t);


    g.setValueAtTime(Math.max(0.0001, g.value), t);


    g.linearRampToValueAtTime(Math.max(0.0001, level), t + sec);


  }




  dispose(afterSec: number): void {


    setTimeout(() => {


      for (const s of this.loops) { try { s.stop(); } catch { /* already stopped */ } }


      this.out.disconnect(); this.send.disconnect();


    }, afterSec * 1000 + 50);


  }




  protected loopNoise(color: NoiseColor): AudioBufferSourceNode {


    const s = this.ctx.createBufferSource();


    s.buffer = this.kit.noise[color]; s.loop = true;


    s.start(this.ctx.currentTime, Math.random() * s.buffer.duration);


    this.loops.push(s); return s;


  }


  protected osc(type: OscillatorType, hz: number): OscillatorNode {


    const o = this.ctx.createOscillator(); o.type = type; o.frequency.value = hz;


    o.start(); this.loops.push(o); return o;


  }


  protected filter(type: BiquadFilterType, freq: number, q = 0.707): BiquadFilterNode {


    const f = this.ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q; return f;


  }


  protected gain(v: number): GainNode { const g = this.ctx.createGain(); g.gain.value = v; return g; }


  protected lfo(rateHz: number, depth: number, param: AudioParam): void {


    const o = this.osc('sine', rateHz); const g = this.gain(depth); o.connect(g); g.connect(param);


  }


  /** Lookahead event scheduler with random gaps; resyncs after timer throttling. */


  protected every(key: string, now: number, until: number, minGap: number, maxGap: number, fn: (t: number) => void): void {


    let t = this.timers[key] ?? now + rand(0, maxGap);


    if (t < now) t = now + rand(0, minGap);


    while (t < until) { fn(t); t += rand(minGap, maxGap); }


    this.timers[key] = t;


  }


}




class RainLayer extends SoundLayer {


  protected density = 1;


  build(): void {


    const hp = this.filter('highpass', 400), lp = this.filter('lowpass', 6500), g = this.gain(0.5 * this.density);


    this.loopNoise('pink').connect(hp); hp.connect(lp); lp.connect(g); g.connect(this.out);


  }


  tick(now: number, until: number): void {


    this.every('drop', now, until, 0.03 / this.density, 0.14 / this.density, t =>


      this.kit.noiseBurst(this.out, t, { dur: rand(0.01, 0.03), filter: 'bandpass', freq: rand(2500, 7000), q: 3, peak: rand(0.05, 0.18) }));


  }


}




class StormLayer extends RainLayer {


  build(): void {


    this.density = 1.6;


    super.build();


    const lp = this.filter('lowpass', 150), g = this.gain(0.35);


    this.loopNoise('brown').connect(lp); lp.connect(g); g.connect(this.out);


    this.lfo(0.09, 0.15, g.gain);


  }


  tick(now: number, until: number): void {


    super.tick(now, until);


    this.every('thunder', now, until, 7, 18, t => {


      this.kit.noiseBurst(this.out, t, { dur: 0.25, filter: 'highpass', freq: 1500, peak: 0.25, attack: 0.004 });


      this.kit.noiseBurst(this.out, t + 0.05, { color: 'brown', dur: rand(2.5, 5), filter: 'lowpass', freq: 900, freqEnd: 90, peak: 0.9, attack: 0.08 });


    });


  }


}




class ForestLayer extends SoundLayer {


  build(): void {


    const bp = this.filter('bandpass', 500, 0.8), g = this.gain(0.3);


    this.loopNoise('pink').connect(bp); bp.connect(g); g.connect(this.out);


    this.lfo(0.08, 250, bp.frequency);


    const hp = this.filter('highpass', 3000), rustle = this.gain(0.03);


    this.loopNoise('white').connect(hp); hp.connect(rustle); rustle.connect(this.out);


    this.lfo(0.13, 0.025, rustle.gain);


  }


  tick(now: number, until: number): void {


    this.every('bird', now, until, 1.2, 5, t => {


      const base = rand(2600, 4200);


      let at = t;


      for (let i = 0, n = randInt(2, 5); i < n; i++) {


        this.kit.tone(this.out, at, base * rand(0.95, 1.1), base * rand(1.15, 1.45), rand(0.05, 0.11), 'sine', rand(0.04, 0.09));


        at += rand(0.09, 0.16);


      }


    });


  }


}




class CaveLayer extends SoundLayer {


  build(): void {


    const lp = this.filter('lowpass', 120), g = this.gain(0.5);


    this.loopNoise('brown').connect(lp); lp.connect(g); g.connect(this.out);


    const bp = this.filter('bandpass', 300, 5), res = this.gain(0.05);


    this.loopNoise('brown').connect(bp); bp.connect(res); res.connect(this.out);


  }


  tick(now: number, until: number): void {


    this.every('drip', now, until, 0.6, 2.8, t => {


      const f = rand(900, 1800);


      this.kit.tone(this.out, t, f, f * 0.45, 0.08, 'sine', 0.14, 0.002);


    });


  }


}




class BattleLayer extends SoundLayer {


  private beat = 0;


  private static readonly PATTERN = [0.45, 0.45, 0.225, 0.225, 0.45, 0.9];


  build(): void {


    const lp = this.filter('lowpass', 90), g = this.gain(0.2);


    this.loopNoise('brown').connect(lp); lp.connect(g); g.connect(this.out);


  }


  tick(now: number, until: number): void {


    this.every('clash', now, until, 0.7, 2.4, t => {


      this.kit.noiseBurst(this.out, t, { dur: 0.22, filter: 'bandpass', freq: 600, freqEnd: 2400, q: 1.2, peak: 0.12, attack: 0.15 });


      const hit = t + 0.22, base = rand(480, 820);


      [1, 2.76, 5.4, 8.93, 13.34].forEach((ratio, i) =>


        this.kit.tone(this.out, hit, base * ratio, base * ratio * 0.998, 1.2 / (1 + i * 0.5), 'sine', 0.22 / (1 + i * 0.7), 0.001));


      this.kit.noiseBurst(this.out, hit, { dur: 0.04, filter: 'highpass', freq: 2500, peak: 0.35, attack: 0.001 });


    });


    const key = 'drum';


    let t = (this as any)[key] as number | undefined ?? now;


    if (t < now) t = now;


    while (t < until) {


      const accent = this.beat % BattleLayer.PATTERN.length === 0;


      this.kit.tone(this.out, t, accent ? 95 : 80, 42, accent ? 0.45 : 0.3, 'sine', accent ? 0.7 : 0.4, 0.004);


      this.kit.noiseBurst(this.out, t, { color: 'brown', dur: 0.12, filter: 'lowpass', freq: 400, peak: accent ? 0.35 : 0.2 });


      t += BattleLayer.PATTERN[this.beat++ % BattleLayer.PATTERN.length];


    }


    (this as any)[key] = t;


  }


}




class FireLayer extends SoundLayer {


  build(): void {


    const lp = this.filter('lowpass', 450), roar = this.gain(0.45);


    this.loopNoise('brown').connect(lp); lp.connect(roar); roar.connect(this.out);


    this.lfo(0.3, 0.12, roar.gain);


    const hp = this.filter('highpass', 5000), hiss = this.gain(0.015);


    this.loopNoise('white').connect(hp); hp.connect(hiss); hiss.connect(this.out);


  }


  tick(now: number, until: number): void {


    this.every('crackle', now, until, 0.02, 0.3, t => {


      const pops = Math.random() < 0.15 ? 3 : 1;


      for (let i = 0; i < pops; i++)


        this.kit.noiseBurst(this.out, t + i * 0.025, { dur: rand(0.003, 0.012), filter: 'bandpass', freq: rand(1500, 5000), q: 1.5, peak: rand(0.08, 0.35), attack: 0.0005 });


    });


  }


}




class NightLayer extends SoundLayer {


  build(): void {


    const lp = this.filter('lowpass', 350), g = this.gain(0.1);


    this.loopNoise('pink').connect(lp); lp.connect(g); g.connect(this.out);


  }


  private chirp(t: number, f: number, peak: number): void {


    for (let i = 0, n = randInt(2, 4); i < n; i++) this.kit.tone(this.out, t + i * 0.045, f, f, 0.025, 'sine', peak, 0.003);


  }


  tick(now: number, until: number): void {


    this.every('cricketA', now, until, 0.35, 1.1, t => this.chirp(t, rand(4300, 4700), 0.035));


    this.every('cricketB', now, until, 0.5, 1.6, t => this.chirp(t, rand(3700, 3900), 0.018));


    this.every('owl', now, until, 12, 30, t => {


      this.kit.tone(this.out, t, 420, 380, 0.35, 'sine', 0.05, 0.05);


      this.kit.tone(this.out, t + 0.5, 400, 360, 0.6, 'sine', 0.05, 0.05);


    });


  }


}




class CrowdLayer extends SoundLayer {


  private voices: Array<{ g: GainNode; f: BiquadFilterNode }> = [];


  build(): void {


    const base = this.filter('bandpass', 600, 0.6), bg = this.gain(0.12);


    this.loopNoise('pink').connect(base); base.connect(bg); bg.connect(this.out);


    for (let i = 0; i < 5; i++) {


      const f = this.filter('bandpass', rand(350, 1100), 3), g = this.gain(0.0001);


      this.loopNoise('pink').connect(f); f.connect(g); g.connect(this.out);


      this.voices.push({ g, f });


    }


  }


  tick(now: number, until: number): void {


    this.voices.forEach((v, i) => this.every(`v${i}`, now, until, 0.08, 0.28, t => {


      v.g.gain.setTargetAtTime(Math.random() < 0.35 ? 0.0001 : rand(0.05, 0.18), t, 0.04);


      if (Math.random() < 0.2) v.f.frequency.setTargetAtTime(rand(300, 1200), t, 0.1);


    }));


    this.every('cup', now, until, 2, 7, t => {


      const f = rand(2400, 3400);


      this.kit.tone(this.out, t, f, f * 0.99, 0.35, 'sine', 0.05, 0.001);


      this.kit.tone(this.out, t, f * 2.7, f * 2.68, 0.2, 'sine', 0.02, 0.001);


    });


  }


}




class BreakthroughLayer extends SoundLayer {


  private lp!: BiquadFilterNode;


  private arpStep = 0;


  private static readonly ARP = [69, 72, 74, 76, 79, 81, 84, 81, 79, 76, 74, 72];


  build(): void {


    this.lp = this.filter('lowpass', 200, 8);


    const g = this.gain(0.12);


    for (const [hz, det] of [[110, 0], [110, 8], [165, 0], [220, -6]] as const) {


      const o = this.osc('sawtooth', hz); o.detune.value = det; o.connect(this.lp);


    }


    this.lp.connect(g); g.connect(this.out);


  }


  tick(now: number, until: number): void {


    this.every('sweep', now, until, 14, 14, t => {


      this.lp.frequency.setValueAtTime(180, t);


      this.lp.frequency.exponentialRampToValueAtTime(3500, t + 12);


    });


    this.every('arp', now, until, 0.18, 0.18, t => {


      const hz = midiHz(BreakthroughLayer.ARP[this.arpStep++ % BreakthroughLayer.ARP.length]);


      this.kit.tone(this.out, t, hz, hz, 0.6, 'triangle', 0.035, 0.005);


    });


  }


}




class TensionLayer extends SoundLayer {


  build(): void {


    const g = this.gain(0.18);


    this.osc('sine', 55).connect(g); this.osc('sine', 58.27).connect(g);   // minor-second rub


    g.connect(this.out);


    this.lfo(0.2, 0.06, g.gain);


    const hi = this.osc('triangle', 311.13), hg = this.gain(0.015);


    this.lfo(5, 3, hi.frequency);


    hi.connect(hg); hg.connect(this.out);


  }


  tick(now: number, until: number): void {


    this.every('heart', now, until, 0.85, 1.05, t => {


      this.kit.tone(this.out, t, 62, 40, 0.14, 'sine', 0.5, 0.004);


      this.kit.tone(this.out, t + 0.22, 58, 38, 0.16, 'sine', 0.38, 0.004);


    });


  }


}




class SadnessLayer extends SoundLayer {


  private padBus!: BiquadFilterNode;


  private chordIdx = 0;


  private static readonly PROG = [[57, 60, 64], [53, 57, 60], [55, 60, 64], [55, 59, 62]]; // Am F C G


  private static readonly MELODY = [69, 72, 74, 76, 81];


  build(): void { this.padBus = this.filter('lowpass', 1600); this.padBus.connect(this.out); }


  tick(now: number, until: number): void {


    this.every('chord', now, until, 6, 6, t => {


      for (const n of SadnessLayer.PROG[this.chordIdx++ % SadnessLayer.PROG.length]) this.kit.pad(this.padBus, t, midiHz(n), 6.6, 0.05);


    });


    this.every('melody', now, until, 1.5, 3.5, t => {


      const hz = midiHz(SadnessLayer.MELODY[randInt(0, SadnessLayer.MELODY.length - 1)]);


      this.kit.tone(this.out, t, hz, hz, 2.2, 'triangle', 0.05, 0.01);


    });


  }


}




const LAYER_FACTORY: Record<SceneId, new (k: SynthKit, d: AudioNode, r: AudioNode | null, s: number) => SoundLayer> = {


  RAIN: RainLayer, STORM: StormLayer, FOREST: ForestLayer, CAVE: CaveLayer, BATTLE: BattleLayer,


  FIRE: FireLayer, NIGHT: NightLayer, CROWD: CrowdLayer, BREAKTHROUGH: BreakthroughLayer,


  TENSION: TensionLayer, SADNESS: SadnessLayer,


};




export interface RadioDramaOptions {


  createContext?: () => AudioContext;   // inject e.g. react-native-audio-api's AudioContext


  masterVolume?: number;                // default 0.35


  duckLevel?: number;                   // gain while TTS speaks, default 0.45


  decay?: number;                       // per-paragraph scene decay, default 0.72


  activationThreshold?: number;         // default 0.2


  maxAmbienceLayers?: number;           // default 2 (+1 music layer)


  lookaheadSec?: number;                // default 0.4


  keywords?: Partial<Record<SceneId, RegExp>>;


}




export class RadioDramaEngine {


  private ctx: AudioContext | null = null;


  private kit!: SynthKit;


  private mix!: GainNode; private duck!: GainNode; private master!: GainNode;


  private reverbIn: AudioNode | null = null;


  private readonly layers = new Map<SceneId, SoundLayer>();


  private readonly levels = new Map<SceneId, number>();


  private timer: ReturnType<typeof setInterval> | null = null;


  private readonly keywords: Record<SceneId, RegExp>;


  private wantRunning = false;


  private onVisibility = () => { if (this.wantRunning && this.ctx && this.ctx.state !== 'running') this.ctx.resume().catch(() => {}); };




  constructor(private readonly opts: RadioDramaOptions = {}) {


    this.keywords = { ...THAI_SCENE_KEYWORDS, ...(opts.keywords ?? {}) } as Record<SceneId, RegExp>;


  }




  /** MUST be called from a user gesture (tap) on iOS. */


  async unlock(): Promise<void> {


    if (!this.ctx) this.init();


    const ctx = this.ctx!;


    try { const nav = (globalThis as any).navigator; if (nav?.audioSession) nav.audioSession.type = 'playback'; } catch { /* Safari 16.4+ only */ }


    if (ctx.state !== 'running') await ctx.resume();


    const b = ctx.createBuffer(1, 1, ctx.sampleRate), s = ctx.createBufferSource();


    s.buffer = b; s.connect(ctx.destination); s.start();


    this.wantRunning = true;


    if (!this.timer) this.timer = setInterval(() => this.tick(), 100);


  }




  /** Feed each paragraph as TTS reaches it. Returns the active scenes. */


  onParagraph(text: string): SceneId[] {


    const hits = detectScenes(text, this.keywords);


    const decay = this.opts.decay ?? 0.72;


    for (const id of Object.keys(SCENE_PROFILE) as SceneId[]) {


      const prev = this.levels.get(id) ?? 0, hit = hits.get(id) ?? 0;


      this.levels.set(id, hit ? Math.min(1, Math.max(prev, 0.5 + 0.25 * hit)) : prev * decay);


    }


    const th = this.opts.activationThreshold ?? 0.2;


    const ranked = [...this.levels.entries()].filter(([, v]) => v >= th).sort((a, b) => b[1] - a[1]);


    const stormOn = ranked.some(([id]) => id === 'STORM');


    const ambience = ranked.filter(([id]) => SCENE_PROFILE[id].kind === 'ambience' && !(stormOn && id === 'RAIN'))


      .slice(0, this.opts.maxAmbienceLayers ?? 2);


    const music = ranked.filter(([id]) => SCENE_PROFILE[id].kind === 'music').slice(0, 1);


    const active = new Map<SceneId, number>([...ambience, ...music]);


    this.reconcile(active);


    return [...active.keys()];


  }




  /** Duck ambience under speech: call from utterance onstart / onend. */


  setSpeaking(active: boolean): void {


    if (!this.ctx) return;


    this.duck.gain.setTargetAtTime(active ? (this.opts.duckLevel ?? 0.45) : 1, this.ctx.currentTime, 0.25);


  }




  setMasterVolume(v: number): void {


    if (this.ctx) this.master.gain.setTargetAtTime(Math.max(0, Math.min(1, v)), this.ctx.currentTime, 0.1);


  }




  /** Fade everything out (e.g. chapter end). */


  reset(): void { this.levels.clear(); this.reconcile(new Map()); }




  async suspend(): Promise<void> { this.wantRunning = false; await this.ctx?.suspend(); }


  async resume(): Promise<void> { this.wantRunning = true; await this.ctx?.resume(); }




  async dispose(): Promise<void> {


    if (this.timer) clearInterval(this.timer);


    this.timer = null; this.wantRunning = false;


    (globalThis as any).document?.removeEventListener?.('visibilitychange', this.onVisibility);


    for (const l of this.layers.values()) l.dispose(0);


    this.layers.clear();


    await this.ctx?.close();


    this.ctx = null;


  }




  private init(): void {


    const factory = this.opts.createContext ?? (() => {


      const AC = (globalThis as any).AudioContext ?? (globalThis as any).webkitAudioContext;


      if (!AC) throw new Error('Web Audio API unavailable — inject createContext');


      return new AC({ latencyHint: 'playback' });


    });


    const ctx = factory();


    this.ctx = ctx;


    this.kit = new SynthKit(ctx);


    this.mix = ctx.createGain();


    this.duck = ctx.createGain();


    const comp = ctx.createDynamicsCompressor();


    comp.threshold.value = -18; comp.ratio.value = 4;


    this.master = ctx.createGain(); this.master.gain.value = this.opts.masterVolume ?? 0.35;


    this.mix.connect(this.duck); this.duck.connect(comp); comp.connect(this.master); this.master.connect(ctx.destination);


    if (typeof (ctx as any).createConvolver === 'function') {


      const conv = ctx.createConvolver(); conv.buffer = makeImpulse(ctx);


      const ret = ctx.createGain(); ret.gain.value = 0.35;


      conv.connect(ret); ret.connect(this.mix);


      this.reverbIn = conv;


    }


    ctx.onstatechange = () => {


      const st = ctx.state as string;  // iOS Safari may report 'interrupted'


      if ((st === 'interrupted' || st === 'suspended') && this.wantRunning) setTimeout(this.onVisibility, 500);


    };


    (globalThis as any).document?.addEventListener?.('visibilitychange', this.onVisibility);


  }




  private reconcile(active: Map<SceneId, number>): void {


    if (!this.ctx) return;


    for (const [id, level] of active) {


      const profile = SCENE_PROFILE[id];


      let layer = this.layers.get(id);


      if (!layer) {


        layer = new LAYER_FACTORY[id](this.kit, this.mix, this.reverbIn, profile.send);


        layer.build();


        this.layers.set(id, layer);


        layer.fadeTo(profile.gain * level, 2.5);


      } else layer.fadeTo(profile.gain * level, 1.5);


    }


    for (const [id, layer] of this.layers) {


      if (active.has(id)) continue;


      layer.fadeTo(0, 3);


      layer.dispose(3.2);


      this.layers.delete(id);


    }


  }




  private tick(): void {


    const ctx = this.ctx;


    if (!ctx || ctx.state !== 'running') return;


    const now = ctx.currentTime, until = now + (this.opts.lookaheadSec ?? 0.4);


    for (const layer of this.layers.values()) {


      try { layer.tick(now, until); } catch (e) { console.warn('[RadioDrama] layer tick failed', e); }


    }


  }


}




/* =============================================================================


 * USAGE EXAMPLE


 * -----------------------------------------------------------------------------


 * const client = new FailoverClient([


 *   createGeminiEndpoint(KEY_PRIMARY,   { thinkingBudget: 0 }),


 *   createGeminiEndpoint(KEY_SECONDARY, { thinkingBudget: 0 }),


 *   createGroqEndpoint(GROQ_KEY),                       // qwen fallback


 * ], { onEvent: e => console.debug('[failover]', e) });


 *


 * const engine = new NexusTranslationEngine({


 *   client,


 *   onCheckpoint: s => db.saveCheckpoint(s),            // IndexedDB / SQLite


 *   pricing: { 'gemini-2.5-flash': { inputPerMTok: 0, outputPerMTok: 0 } }, // fill from your billing


 * });


 * const result = await engine.translateChapter({ ...chapterInput, resume: await db.loadCheckpoint(id) });


 *


 * // Radio Drama + Web Speech (foreground PWA)


 * const drama = new RadioDramaEngine();


 * playButton.onclick = async () => {


 *   await drama.unlock();


 *   for (const text of result.ttsText.split('\n')) {


 *     drama.onParagraph(text);


 *     await new Promise<void>(done => {


 *       const u = new SpeechSynthesisUtterance(text);


 *       u.lang = 'th-TH';


 *       u.onstart = () => drama.setSpeaking(true);


 *       u.onend = () => { drama.setSpeaking(false); done(); };


 *       u.onerror = () => { drama.setSpeaking(false); done(); };


 *       speechSynthesis.speak(u);


 *     });


 *   }


 *   drama.reset();


 * };


 * ========================================================================== */