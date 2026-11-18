/**
 * "Ask AI" for the Eisenhower Matrix.
 *
 * With a Claude API key in config.ts, the text you type is sent to Claude, which
 * returns structured tasks (quadrant, due date, reminder). Only the text you type
 * (or task titles/dates for "re-sort") is sent — never money data or notes.
 *
 * Without a key, a local rule-based parser does a decent job on its own.
 */
import { ANTHROPIC_API_KEY, ANTHROPIC_MODEL } from './config';
import { getAiKeySync } from './prefs';
import { reminderFromPreset, type ReminderPreset } from './reminderPresets';
import { quadrantOf, type QuadrantId, type Task } from './tasks';

export type Draft = {
  title: string;
  notes: string;
  urgent: boolean;
  important: boolean;
  due: Date | null;
  dueHasTime: boolean;
  remindAt: Date | null;
  effort: 'quick' | 'medium' | 'big' | null;
  delegatedTo: string;
  why: string;
};

const apiKey = () => getAiKeySync() || (ANTHROPIC_API_KEY.includes('REPLACE_ME') ? '' : ANTHROPIC_API_KEY);
export const aiEnabled = () => !!apiKey();

/* ───────── Claude ───────── */

export async function claude(system: string, user: string): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey(),
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 2000,
      system,
      messages: [{ role: 'user', content: user }],
    }),
  });
  if (!res.ok) throw new Error(`Claude error ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = await res.json();
  return (json.content ?? []).map((c: { text?: string }) => c.text ?? '').join('');
}

const extractJson = (s: string) => {
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start < 0 || end < 0) throw new Error('AI returned no JSON');
  return JSON.parse(s.slice(start, end + 1));
};

const nowContext = () => {
  const n = new Date();
  return `Now: ${n.toString()} (local time). ISO: ${n.toISOString()}. Week starts Monday.`;
};

const PARSE_SYSTEM = `You turn a person's messy brain-dump into tasks for an Eisenhower Matrix.
Return ONLY JSON: {"tasks":[{"title":string,"notes":string,"urgent":boolean,"important":boolean,
"due":string|null (local ISO 8601 like 2026-11-20T15:00:00, or date-only 2026-11-20),
"reminder":"none"|"at"|"15m"|"1h"|"1d"|"morning","effort":"quick"|"medium"|"big",
"delegatedTo":string,"why":string (max 12 words: why this quadrant)}]}
Rules: important = moves life, health, money, family, career or obligations forward.
urgent = needs action within ~48h or has real consequence if late. Short clear titles starting with a verb.
Split multiple tasks. Pick sensible reminders (timed events: "1h"; deadlines: "1d"; errands: "morning").
If someone else should do it, set delegatedTo.`;

async function aiParse(text: string): Promise<Draft[]> {
  const out = extractJson(await claude(PARSE_SYSTEM, `${nowContext()}\n\nBrain-dump:\n${text}`));
  return (out.tasks ?? []).map((t: Record<string, unknown>) => {
    const dueStr = typeof t.due === 'string' ? t.due : null;
    const dueHasTime = !!dueStr && dueStr.includes('T');
    const due = dueStr ? new Date(dueHasTime ? dueStr : `${dueStr}T12:00:00`) : null;
    const validDue = due && !isNaN(due.getTime()) ? due : null;
    return {
      title: String(t.title ?? '').slice(0, 120),
      notes: String(t.notes ?? ''),
      urgent: !!t.urgent,
      important: !!t.important,
      due: validDue,
      dueHasTime,
      remindAt: reminderFromPreset(validDue, (t.reminder as ReminderPreset) ?? 'none', dueHasTime),
      effort: (['quick', 'medium', 'big'] as const).includes(t.effort as never) ? (t.effort as Draft['effort']) : null,
      delegatedTo: String(t.delegatedTo ?? ''),
      why: String(t.why ?? ''),
    } satisfies Draft;
  });
}

const SORT_SYSTEM = `You review an Eisenhower Matrix and suggest corrections.
Return ONLY JSON: {"moves":[{"id":string,"to":"do"|"schedule"|"delegate"|"drop","why":string (max 12 words)}],"focus":[id,id,id] (the 3 tasks to do first today),"summary":string (max 30 words, friendly)}
Only include moves that genuinely improve the matrix. Consider due dates relative to now.`;

export type SortAdvice = { moves: { id: string; to: QuadrantId; why: string }[]; focus: string[]; summary: string };

export async function aiResort(tasks: Task[]): Promise<SortAdvice> {
  const open = tasks.filter((t) => !t.done);
  if (!aiEnabled()) return localResort(open);
  const list = open.map((t) => ({
    id: t.id,
    title: t.title,
    quadrant: quadrantOf(t),
    due: t.due?.toISOString() ?? null,
    effort: t.effort,
  }));
  const out = extractJson(await claude(SORT_SYSTEM, `${nowContext()}\n\nTasks:\n${JSON.stringify(list)}`));
  return { moves: out.moves ?? [], focus: out.focus ?? [], summary: out.summary ?? '' };
}

/* ───────── Local fallback ───────── */

const IMPORTANT = /\b(important|must|need to|bill|pay|tax|taxes|rent|mortgage|doctor|dentist|clinic|hospital|passport|visa|deadline|interview|insurance|bank|contract|exam|health|mom|dad|wife|husband|kids?|family|anniversary|birthday|renew|license|lawyer|school|landlord|leak|repair|car|job|work|boss|client|report|visa)\b|!/i;
const URGENT = /\b(urgent|asap|now|today|tonight|immediately|overdue|right away)\b/i;
const QUICK = /\b(call|text|email|reply|book|order|buy|pay)\b/i;
const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function parseWhen(s: string, now = new Date()) {
  const low = s.toLowerCase();
  let date: Date | null = null;
  const base = new Date(now);
  base.setHours(12, 0, 0, 0);

  if (/\b(today|tonight)\b/.test(low)) date = new Date(base);
  else if (/\btomorrow\b/.test(low)) date = new Date(base.getTime() + 86400000);
  else {
    const inDays = low.match(/\bin (\d+) days?\b/);
    const inWeeks = low.match(/\bin (\d+) weeks?\b/);
    const nextWeek = /\bnext week\b/.test(low);
    const dow = DAYS.findIndex((d) => new RegExp(`\\b(next )?${d.slice(0, 3)}(${d.slice(3)})?\\b`).test(low));
    const md = low.match(new RegExp(`\\b(${MONTHS.join('|')})[a-z]*\\.? (\\d{1,2})\\b`)) ?? null;
    const dm = low.match(new RegExp(`\\b(\\d{1,2}) (${MONTHS.join('|')})[a-z]*\\b`)) ?? null;
    if (inDays) date = new Date(base.getTime() + +inDays[1] * 86400000);
    else if (inWeeks) date = new Date(base.getTime() + +inWeeks[1] * 7 * 86400000);
    else if (dow >= 0) {
      date = new Date(base);
      let diff = (dow - base.getDay() + 7) % 7;
      if (diff === 0 || /\bnext\b/.test(low)) diff += diff === 0 ? 7 : 0;
      date.setDate(base.getDate() + diff);
    } else if (md || dm) {
      const mon = MONTHS.indexOf((md ? md[1] : dm![2]).slice(0, 3));
      const day = +(md ? md[2] : dm![1]);
      date = new Date(base.getFullYear(), mon, day, 12);
      if (date.getTime() < now.getTime() - 86400000) date.setFullYear(date.getFullYear() + 1);
    } else if (nextWeek) {
      date = new Date(base);
      date.setDate(base.getDate() + ((8 - base.getDay()) % 7 || 7));
    }
  }

  const tm = low.match(/\b(?:at )?(\d{1,2})(?::(\d{2}))?\s?(am|pm)\b/) ?? low.match(/\bat (\d{1,2})(?::(\d{2}))?\b/) ?? low.match(/\b(\d{1,2}):(\d{2})\b/);
  let hasTime = false;
  if (tm) {
    let h = +tm[1];
    const m = tm[2] ? +tm[2] : 0;
    const ap = tm[3];
    if (ap === 'pm' && h < 12) h += 12;
    if (ap === 'am' && h === 12) h = 0;
    if (!ap && h < 8) h += 12; // "at 3" → 3 pm
    if (h < 24 && m < 60) {
      date = date ?? new Date(base);
      date.setHours(h, m, 0, 0);
      hasTime = true;
    }
  }
  if (/\btonight\b/.test(low) && !hasTime && date) {
    date.setHours(19, 0, 0, 0);
    hasTime = true;
  }
  return { date, hasTime };
}

const WHEN_WORDS = [
  /\b(?:by|on|before|this|next|until)?\s*(?:today|tonight|tomorrow|next week|(?:mon|tues?|wed(?:nes)?|thu(?:rs)?|fri|sat(?:ur)?|sun)(?:day)?)\b/gi,
  /\b(?:at\s*)?\d{1,2}(?::\d{2})?\s?(?:am|pm)\b/gi,
  /\bat \d{1,2}(?::\d{2})?\b/gi,
  new RegExp(`\\b(?:by|before|on|until)?\\s*(?:${MONTHS.join('|')})[a-z]*\\.? \\d{1,2}(?:st|nd|rd|th)?\\b`, 'gi'),
  /\bin \d+ (?:days?|weeks?)\b/gi,
];
const clean = (s: string) =>
  WHEN_WORDS.reduce((acc, re) => acc.replace(re, ' '), s)
    .replace(/\b(urgent|asap|important|!+)\b/gi, '')
    .replace(/\s+(by|before|on|at|until)\s*$/i, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s\-–•*]+|[\s,.;]+$/g, '')
    .replace(/^./, (c) => c.toUpperCase());

export function localParse(text: string): Draft[] {
  return text
    .split(/\n|;|,(?![^(]*\))|\band also\b/i)
    .map((s) => s.trim())
    .filter((s) => s.length > 1)
    .map((s) => {
      const { date, hasTime } = parseWhen(s);
      const days = date ? (date.getTime() - Date.now()) / 86400000 : Infinity;
      const urgent = URGENT.test(s) || days < 2;
      const important = IMPORTANT.test(s);
      return {
        title: clean(s),
        notes: '',
        urgent,
        important,
        due: date,
        dueHasTime: hasTime,
        remindAt: reminderFromPreset(date, hasTime ? '1h' : 'morning', hasTime),
        effort: QUICK.test(s) ? 'quick' : null,
        delegatedTo: '',
        why: important ? (urgent ? 'Important and due soon' : 'Important, not pressing yet') : urgent ? 'Time-sensitive but low impact' : 'Nice-to-have',
      };
    });
}

function localResort(open: Task[]): SortAdvice {
  const now = Date.now();
  const moves: SortAdvice['moves'] = [];
  for (const t of open) {
    const q = quadrantOf(t);
    const days = t.due ? (t.due.getTime() - now) / 86400000 : Infinity;
    if (q === 'schedule' && days < 2) moves.push({ id: t.id, to: 'do', why: 'Due within 2 days — it is now urgent' });
    if (q === 'drop' && days < 2) moves.push({ id: t.id, to: 'delegate', why: 'Has a near deadline' });
  }
  const focus = open
    .filter((t) => quadrantOf(t) === 'do')
    .sort((a, b) => (a.due?.getTime() ?? 8.64e15) - (b.due?.getTime() ?? 8.64e15))
    .slice(0, 3)
    .map((t) => t.id);
  return { moves, focus, summary: moves.length ? `${moves.length} task(s) became urgent.` : 'Your matrix looks well sorted.' };
}

export async function parseTasks(text: string): Promise<{ drafts: Draft[]; usedAI: boolean }> {
  if (aiEnabled()) {
    try {
      return { drafts: await aiParse(text), usedAI: true };
    } catch {
      // fall through to local parser if offline / API issue
    }
  }
  return { drafts: localParse(text), usedAI: false };
}

/* ═════════ Universal "Ask Hearth" — tasks + money + shopping in one sentence ═════════ */

export type MoneyDraft = { type: 'expense' | 'income'; cents: number; category: string; note: string; forHome: boolean };
export type ItemDraft = { list: 'home' | 'mine'; text: string };
export type Interpretation = { tasks: Draft[]; money: MoneyDraft[]; items: ItemDraft[]; usedAI: boolean };

const EXPENSE_IDS = 'groceries,dining,coffee,transport,home,bills,shopping,health,fun,travel,gifts,other';
const INCOME_IDS = 'salary,side,refund,gift-in,other-in';

const UNIVERSAL_SYSTEM = `You are the assistant inside "Hearth", a couple's home app (Canada, CAD).
Split what the person said into three kinds of entries and return ONLY JSON:
{"tasks":[ same shape as below ],
 "money":[{"type":"expense"|"income","amount":number (dollars),"category": one of [${EXPENSE_IDS}] for expenses or [${INCOME_IDS}] for income,"note":string (merchant/what),"forHome":boolean}],
 "items":[{"list":"home"|"mine","text":string (one product per entry)}]}
Task shape: {"title","notes","urgent","important","due","reminder","effort","delegatedTo","why"} —
${PARSE_SYSTEM.split('Return ONLY JSON:')[1]}
Shopping items: "add X to the list", "we need X", "buy X" (when it's a product, not an errand) → items. Default list "home".
Money: anything already spent/paid/received with an amount → money. Shared household costs (groceries, rent, bills) → forHome true.`;

const CAT_WORDS: [RegExp, string][] = [
  [/\b(grocer|costco|walmart|loblaw|metro|iga|superstore|no frills|safeway|save-on|food basics|maxi)\w*/i, 'groceries'],
  [/\b(restaurant|dinner|lunch|breakfast|takeout|uber ?eats|doordash|skip|pizza|sushi)\b/i, 'dining'],
  [/\b(coffee|tim hortons|timmies|starbucks|cafe|latte)\b/i, 'coffee'],
  [/\b(gas|fuel|uber|lyft|taxi|transit|presto|compass|parking|bus|train)\b/i, 'transport'],
  [/\b(rent|ikea|furniture|home depot|canadian tire|repair)\b/i, 'home'],
  [/\b(hydro|electric|internet|phone bill|bill|insurance|rogers|bell|telus)\b/i, 'bills'],
  [/\b(amazon|clothes|shoes|mall|shopping)\b/i, 'shopping'],
  [/\b(pharmacy|doctor|dentist|gym|shoppers)\b/i, 'health'],
  [/\b(movie|netflix|concert|game|spotify)\b/i, 'fun'],
  [/\b(flight|hotel|airbnb|trip)\b/i, 'travel'],
  [/\b(gift|present)\b/i, 'gifts'],
];

/** Best-guess expense category from a merchant name or phrase (e.g. "COSTCO WHOLESALE #541"). */
export const guessCategory = (text: string) => CAT_WORDS.find(([re]) => re.test(text))?.[1] ?? 'other';

function localInterpret(text: string): Interpretation {
  const out: Interpretation = { tasks: [], money: [], items: [], usedAI: false };
  const clauses = text
    .split(/\n|;|\.\s|,\s(?=(?:and |also |then )?(?:i |we |add |buy |remind|spent|paid|got))|\band then\b|\balso\b/i)
    .map((s) => s.trim())
    .filter(Boolean);
  const taskText: string[] = [];
  for (const c of clauses) {
    const amt = c.match(/\$?\s?(\d+(?:[.,]\d{1,2})?)\s*(?:dollars?|bucks|\$)?/i);
    const incomeVerb = /\b(got paid|earned|received|income|salary|refund(?:ed)?)\b/i.test(c);
    const moneyVerb = !incomeVerb && /\b(spent|spend|paid|pay(?:ed)?|bought|cost|was charged)\b/i.test(c);
    if (amt && (moneyVerb || incomeVerb) && !/\bremind|\bneed to\b|\bby\b/i.test(c)) {
      const cents = Math.round(parseFloat(amt[1].replace(',', '.')) * 100);
      const income = incomeVerb;
      const cat = income ? (/refund/i.test(c) ? 'refund' : /salary|paycheque|paycheck|got paid/i.test(c) ? 'salary' : 'other-in') : (CAT_WORDS.find(([re]) => re.test(c))?.[1] ?? 'other');
      const at = c.match(/\b(?:at|from|on)\s+([A-Z][\w'&]*(?:\s[A-Z][\w'&]*)*)/);
      out.money.push({ type: income ? 'income' : 'expense', cents, category: cat, note: at?.[1] ?? '', forHome: ['groceries', 'home', 'bills'].includes(cat) });
      continue;
    }
    const listM = c.match(/^(?:please )?(?:add|put)\s+(.+?)\s+(?:to|on)\s+(?:the |our |my )?(home |shopping |grocery |my )?list\b/i) ?? c.match(/^(?:we need|buy|get|pick up)\s+(.+)$/i);
    if (listM && !/\b(remind|call|book|appointment|tomorrow|today|by)\b/i.test(c)) {
      const mine = /\bmy list\b/i.test(c);
      listM[1]
        .split(/,|\band\b/i)
        .map((s) => s.replace(/^(some|a|an|the)\s+/i, '').trim())
        .filter(Boolean)
        .forEach((t) => out.items.push({ list: mine ? 'mine' : 'home', text: t.replace(/^./, (x) => x.toUpperCase()) }));
      continue;
    }
    taskText.push(c.replace(/^(remind me to|i need to|i have to|don't forget to|need to)\s+/i, ''));
  }
  if (taskText.length) out.tasks = localParse(taskText.join('\n'));
  return out;
}

export async function interpret(text: string): Promise<Interpretation> {
  if (aiEnabled()) {
    try {
      const out = extractJson(await claude(UNIVERSAL_SYSTEM, `${nowContext()}\n\nThey said:\n${text}`));
      const tasks: Draft[] = (out.tasks ?? []).map((t: Record<string, unknown>) => {
        const dueStr = typeof t.due === 'string' ? t.due : null;
        const dueHasTime = !!dueStr && dueStr.includes('T');
        const d = dueStr ? new Date(dueHasTime ? dueStr : `${dueStr}T12:00:00`) : null;
        const due = d && !isNaN(d.getTime()) ? d : null;
        return {
          title: String(t.title ?? ''),
          notes: String(t.notes ?? ''),
          urgent: !!t.urgent,
          important: !!t.important,
          due,
          dueHasTime,
          remindAt: reminderFromPreset(due, (t.reminder as ReminderPreset) ?? 'none', dueHasTime),
          effort: (['quick', 'medium', 'big'] as const).includes(t.effort as never) ? (t.effort as Draft['effort']) : null,
          delegatedTo: String(t.delegatedTo ?? ''),
          why: String(t.why ?? ''),
        };
      });
      const money: MoneyDraft[] = (out.money ?? [])
        .filter((m: Record<string, unknown>) => typeof m.amount === 'number' && (m.amount as number) > 0)
        .map((m: Record<string, unknown>) => ({
          type: m.type === 'income' ? 'income' : 'expense',
          cents: Math.round((m.amount as number) * 100),
          category: String(m.category ?? 'other'),
          note: String(m.note ?? ''),
          forHome: !!m.forHome,
        }));
      const items: ItemDraft[] = (out.items ?? []).map((i: Record<string, unknown>) => ({
        list: i.list === 'mine' ? 'mine' : 'home',
        text: String(i.text ?? ''),
      }));
      return { tasks, money, items, usedAI: true };
    } catch {
      // fall back below
    }
  }
  return localInterpret(text);
}

/* ═════════ Email → tasks ═════════ */

export type EmailLike = { id: string; from: string; subject: string; date: Date; snippet: string };
export type EmailDraft = Draft & { emailId: string; from: string; subject: string };

const EMAIL_SYSTEM = `You read a person's recent emails (sender, subject, short preview) and find things THEY need to act on:
bills/payments due, appointments & bookings, deadlines, renewals/expiries, forms to sign, replies that are clearly expected,
deliveries needing action. IGNORE newsletters, marketing, receipts needing no action, notifications, social media.
Return ONLY JSON: {"tasks":[{"emailId":string,"title":string (verb first, short),"notes":string (key details: amounts, reference numbers, place),
"urgent":boolean,"important":boolean,"due":string|null (local ISO 8601 or date-only),"reminder":"none"|"at"|"15m"|"1h"|"1d"|"morning",
"effort":"quick"|"medium"|"big","delegatedTo":"","why":string (max 12 words)}]}
Return an empty list if nothing is actionable. One task per real action; never invent facts.`;

const ACTIONABLE =
  /\b(bill|invoice|payment (?:due|reminder)|amount due|due (?:date|on|by)|statement is ready|overdue|renew(?:al)?|expir(?:es|ing|y)|appointment|booking|reservation|confirm(?:ation)? (?:your|required)|action required|please (?:sign|review|complete|confirm|respond)|sign(?:ature)? (?:needed|required)|deadline|interview|reminder|rsvp|pick ?up|your order .* (?:ready|held))\b/i;
const NOT_ACTIONABLE = /\b(newsletter|unsubscribe|% off|sale|deal|webinar|digest|your receipt|order confirmed|has shipped|thanks for (?:your|shopping))\b/i;

function localEmailTasks(emails: EmailLike[]): EmailDraft[] {
  const out: EmailDraft[] = [];
  for (const e of emails) {
    const text = `${e.subject}. ${e.snippet}`;
    if (!ACTIONABLE.test(text) || NOT_ACTIONABLE.test(e.subject)) continue;
    const [d] = localParse(e.subject + ' ' + e.snippet.slice(0, 160));
    const bill = /\b(bill|invoice|payment|amount due|statement)\b/i.test(text);
    const appt = /\b(appointment|booking|reservation|interview)\b/i.test(text);
    const amount = text.match(/\$\s?\d[\d,]*(?:\.\d{2})?/)?.[0];
    const sender = e.from.split(/[<@]/)[0].trim();
    const subj = e.subject
      .replace(/^(re|fwd?|fw):\s*/i, '')
      .replace(/^(action required|reminder|appointment reminder|important|urgent)\s*[:\-–]\s*/i, '')
      .replace(/^./, (c) => c.toUpperCase())
      .slice(0, 70);
    const title = bill ? `Pay ${sender} bill${amount ? ` (${amount})` : ''}` : appt ? `Appointment: ${sender}` : subj;
    const base = d ?? localParse(e.subject)[0];
    out.push({
      ...base,
      remindAt: bill && base?.due ? reminderFromPreset(base.due, '1d', base.dueHasTime) : base?.remindAt ?? null,
      title,
      notes: `From ${e.from}\n“${e.subject}”\n${e.snippet.slice(0, 200)}`,
      important: true,
      urgent: d?.due ? (d.due.getTime() - Date.now()) / 86400000 < 2 : false,
      why: bill ? 'Money due — avoid late fees' : appt ? 'Commitment on your calendar' : 'Needs a response from you',
      emailId: e.id,
      from: e.from,
      subject: e.subject,
    });
  }
  return out;
}

export async function emailsToTasks(emails: EmailLike[]): Promise<{ drafts: EmailDraft[]; usedAI: boolean }> {
  if (!emails.length) return { drafts: [], usedAI: false };
  if (aiEnabled()) {
    try {
      const list = emails.map((e) => ({ emailId: e.id, from: e.from, subject: e.subject, date: e.date.toISOString(), preview: e.snippet.slice(0, 300) }));
      const out = extractJson(await claude(EMAIL_SYSTEM, `${nowContext()}\n\nEmails:\n${JSON.stringify(list)}`));
      const byId = new Map(emails.map((e) => [e.id, e]));
      const drafts: EmailDraft[] = (out.tasks ?? [])
        .filter((t: Record<string, unknown>) => byId.has(String(t.emailId)))
        .map((t: Record<string, unknown>) => {
          const e = byId.get(String(t.emailId))!;
          const dueStr = typeof t.due === 'string' ? t.due : null;
          const dueHasTime = !!dueStr && dueStr.includes('T');
          const dd = dueStr ? new Date(dueHasTime ? dueStr : `${dueStr}T12:00:00`) : null;
          const due = dd && !isNaN(dd.getTime()) ? dd : null;
          return {
            title: String(t.title ?? e.subject),
            notes: `${String(t.notes ?? '')}\n\nFrom ${e.from} — “${e.subject}”`.trim(),
            urgent: !!t.urgent,
            important: !!t.important,
            due,
            dueHasTime,
            remindAt: reminderFromPreset(due, (t.reminder as ReminderPreset) ?? 'none', dueHasTime),
            effort: (['quick', 'medium', 'big'] as const).includes(t.effort as never) ? (t.effort as Draft['effort']) : null,
            delegatedTo: String(t.delegatedTo ?? ''),
            why: String(t.why ?? ''),
            emailId: e.id,
            from: e.from,
            subject: e.subject,
          };
        });
      return { drafts, usedAI: true };
    } catch {
      // fall through
    }
  }
  return { drafts: localEmailTasks(emails), usedAI: false };
}
