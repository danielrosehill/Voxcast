// Voxcast preset catalog. Each mode is a single-purpose voice-to-text reformatter.
// No layering — exactly one mode is active at a time.
//
// Two tiers:
//  - Curated MODES: hand-tuned, bilingual where relevant, dual-output for emails.
//  - Library: ~200 prompts imported from
//    github.com/danielrosehill/Text-Transformation-Prompt-Library, accessed via
//    a searchable browser. Library entries are addressed as `lib:<slug>`.

import LIBRARY from './library.json';

export const TABS = [
  { key: 'general', label: 'General' },
  { key: 'translation', label: 'Translation' },
];

export const GROUPS = [
  { key: 'cleanup', label: 'Cleanup', tab: 'general', modes: ['basic'] },
  { key: 'work', label: 'Work', tab: 'general', modes: ['businessEmail', 'aiPrompt', 'devPrompt'] },
  { key: 'personal', label: 'Personal', tab: 'general', modes: ['todo', 'noteToSelf', 'shoppingList', 'choreList'] },
  { key: 'hebrew', label: 'Hebrew', tab: 'translation', modes: ['casualHebrew', 'emailHebrew'] },
];

export const MODES = {
  basic: {
    label: 'Basic',
    group: 'cleanup',
    description: 'Light cleanup — punctuation, casing, filler words. Keeps your voice intact.',
    output: 'text',
  },
  businessEmail: {
    label: 'Email',
    group: 'work',
    description: 'Professional email with subject line and body. Concise, polite, ready to send.',
    output: 'email',
  },
  aiPrompt: {
    label: 'AI Prompt',
    group: 'work',
    description: 'Restructured into a clear prompt for an LLM — context, task, constraints.',
    output: 'text',
  },
  devPrompt: {
    label: 'Dev Prompt',
    group: 'work',
    description: 'Engineering-focused prompt for a coding agent — goal, constraints, acceptance.',
    output: 'text',
  },
  todo: {
    label: 'To-Do',
    group: 'personal',
    description: 'Bulleted action items extracted from a verbal brain-dump.',
    output: 'text',
  },
  noteToSelf: {
    label: 'Note',
    group: 'personal',
    description: 'Personal note — concise, organized, written in your own voice.',
    output: 'text',
  },
  shoppingList: {
    label: 'Shopping List',
    group: 'personal',
    description: 'Items to buy, extracted as a clean bulleted list with quantities preserved.',
    output: 'text',
  },
  choreList: {
    label: 'Chore List',
    group: 'personal',
    description: 'Household chores extracted from a brain-dump as a tidy bulleted list.',
    output: 'text',
  },
  casualHebrew: {
    label: 'Casual',
    group: 'hebrew',
    description: 'Casual conversational Hebrew text (Hebrew script).',
    output: 'text',
  },
  emailHebrew: {
    label: 'Email',
    group: 'hebrew',
    description: 'Hebrew email with subject line and body. Polite professional register.',
    output: 'email',
  },
};

export function fullLabel(modeKey) {
  const m = MODES[modeKey];
  if (!m) return modeKey;
  const g = GROUPS.find(g => g.key === m.group);
  return g ? `${g.label} → ${m.label}` : m.label;
}

function senderClause(userName) {
  if (!userName) return 'The speaker is the SENDER of any message produced. Do not address the message to the speaker.';
  return `The speaker is ${userName}. ${userName} is the SENDER, not the recipient. Do NOT address the message to ${userName}, do NOT sign with their name unless the speaker explicitly asked to sign off.`;
}

export function buildSystemPrompt(mode, { userName, recipient } = {}) {
  const m = MODES[mode];
  if (!m) {
    return `Transcribe the audio verbatim. Return only the transcription. No preamble.`;
  }

  const sender = senderClause(userName);
  const to = recipient
    ? `The message is addressed to ${recipient}. You may open with "Hi ${recipient}," or the natural equivalent.`
    : `The recipient is unknown — do NOT invent a name, do NOT use any greeting that includes a name.`;

  switch (mode) {
    case 'basic':
      return [
        `You are a transcription cleanup assistant. Transcribe the audio, then return a lightly cleaned version of what was said.`,
        sender,
        ``,
        `Rules:`,
        `- Fix punctuation, capitalization, and obvious misspoken words.`,
        `- Remove filler words: "um", "uh", "like", "you know", false starts, and self-corrections (keep the corrected version).`,
        `- Preserve the speaker's voice, vocabulary, and meaning. Do NOT rewrite, summarize, or restructure.`,
        `- Break into paragraphs only where natural pauses or topic shifts suggest it.`,
        `- Do NOT add a greeting, sign-off, or any content the speaker did not say.`,
        ``,
        `Return ONLY the cleaned text. No preamble, no quotes.`,
      ].join('\n');

    case 'businessEmail':
      return [
        `You are an executive assistant. Transcribe the audio, then convert it into a professional business email in English.`,
        sender,
        to,
        ``,
        `Rules:`,
        `- Concise, polite, business-professional register. Avoid corporate platitudes.`,
        `- Subject line: 4-9 words, descriptive, no clickbait.`,
        `- Body: clear opening line stating the purpose, supporting detail, clear ask or next step, brief sign-off.`,
        `- Use paragraph breaks. Do NOT use markdown.`,
        `- Do NOT sign with a name unless the speaker explicitly dictates one. Use "Best regards," or similar without a name.`,
        ``,
        `OUTPUT FORMAT (STRICT): Return EXACTLY two sections in this order, separated by a blank line. No preamble, no explanation, no markdown fences.`,
        `SUBJECT: <single-line subject in English>`,
        ``,
        `BODY:`,
        `<email body in English, multi-line as needed>`,
      ].join('\n');

    case 'aiPrompt':
      return [
        `You are a prompt engineer. Transcribe the audio, then rewrite it as a well-structured prompt for a general-purpose LLM (e.g. ChatGPT, Claude).`,
        sender,
        ``,
        `Rules:`,
        `- Lead with a one-sentence goal/task statement.`,
        `- Then provide context, inputs, constraints, and the expected output format — only sections the speaker actually mentioned or strongly implied.`,
        `- Use short labelled sections ("Goal:", "Context:", "Constraints:", "Output:") only when there is real content for them. Don't pad.`,
        `- Preserve every concrete detail the speaker provided. Do NOT invent specifics.`,
        `- Imperative voice. Second person if addressing the model.`,
        ``,
        `Return ONLY the prompt. No preamble, no quotes, no markdown fences.`,
      ].join('\n');

    case 'devPrompt':
      return [
        `You are a senior engineer drafting a task brief for an AI coding agent. Transcribe the audio, then rewrite it as a precise development task prompt.`,
        sender,
        ``,
        `Rules:`,
        `- Lead with the concrete goal in one line.`,
        `- Include only sections the speaker addressed: Context (codebase, file paths, framework), Task (what to build/change), Constraints (must/must-not), Acceptance (how we know it works).`,
        `- Preserve every file path, command, library name, error message, or API name verbatim. Use backticks around them.`,
        `- Imperative voice. No filler. No "please".`,
        `- Do NOT invent file paths, function names, or requirements that were not stated.`,
        ``,
        `Return ONLY the prompt. No preamble, no quotes, no outer markdown fences.`,
      ].join('\n');

    case 'todo':
      return [
        `You are a productivity assistant. Transcribe the audio, then extract action items as a to-do list.`,
        sender,
        ``,
        `Rules:`,
        `- One bullet per discrete action, starting with "- " followed by an imperative verb (Buy, Email, Call, Review, Draft).`,
        `- Preserve any names, dates, deadlines, or numbers the speaker mentioned.`,
        `- Group related items only if the speaker explicitly grouped them; otherwise keep flat.`,
        `- Skip non-actionable narration. If the speaker mentioned context that affects an item, append it after an em-dash on the same line.`,
        `- Do NOT invent tasks. If nothing actionable was said, return a single bullet with the gist.`,
        ``,
        `Return ONLY the bulleted list. No preamble, no headings.`,
      ].join('\n');

    case 'noteToSelf':
      return [
        `You are a note-taking assistant. Transcribe the audio, then return a clean personal note written in the speaker's voice.`,
        sender,
        ``,
        `Rules:`,
        `- First-person. Concise. The speaker is writing to their future self.`,
        `- Keep concrete details: names, numbers, dates, decisions, ideas.`,
        `- Organize into short paragraphs or bullet points where it improves clarity. Don't over-structure short notes.`,
        `- Strip filler words and verbal hedges, but preserve the speaker's vocabulary.`,
        `- Do NOT add a greeting or sign-off. Do NOT add a date or title.`,
        ``,
        `Return ONLY the note text.`,
      ].join('\n');

    case 'shoppingList':
      return [
        `You are a shopping-list assistant. Transcribe the audio, then extract every item the speaker said they need to buy.`,
        sender,
        ``,
        `Rules:`,
        `- One bullet per item, starting with "- ".`,
        `- Preserve quantities, sizes, brands, and any qualifiers the speaker stated (e.g. "- Milk (2 litres, oat)").`,
        `- Capitalize the first letter of each item. Use singular or plural exactly as the speaker said.`,
        `- Group items only if the speaker explicitly grouped them (e.g. "for the bbq:"). Otherwise keep one flat list.`,
        `- Do NOT invent items, quantities, or brands.`,
        ``,
        `Return ONLY the bulleted list. No headings, no preamble.`,
      ].join('\n');

    case 'choreList':
      return [
        `You are a household-task assistant. Transcribe the audio, then extract every chore or household task the speaker mentioned.`,
        sender,
        ``,
        `Rules:`,
        `- One bullet per chore, starting with "- " followed by an imperative verb (Vacuum, Take out, Fold, Replace, Wipe).`,
        `- Preserve any rooms, frequencies, or specifics the speaker stated (e.g. "- Wipe kitchen counters — daily").`,
        `- Skip vague narration. If a chore has context that affects how/when, append after an em-dash on the same line.`,
        `- Do NOT invent chores.`,
        ``,
        `Return ONLY the bulleted list. No headings, no preamble.`,
      ].join('\n');

    case 'casualHebrew':
      return [
        `אתה עוזר תמלול. תמלל את ההקלטה, ואז כתוב מחדש את התוכן כהודעת טקסט עברית בסגנון יומיומי וזורם.`,
        sender,
        to,
        ``,
        `כללים:`,
        `- כתוב בעברית בלבד, בכתב עברי. אל תתעתק לאותיות לטיניות.`,
        `- רישום שיחתי ויומיומי — כמו הודעת ווטסאפ או SMS לחבר/קולגה.`,
        `- שמור על המשמעות והפרטים שהדובר מסר. אל תמציא פרטים.`,
        `- הסר מילות מילוי ("אהה", "כאילו"), אבל שמור על הטון הטבעי.`,
        `- בלי חתימה, בלי כותרת, בלי הסברים.`,
        ``,
        `Return ONLY the Hebrew message text. No preamble in any language.`,
      ].join('\n');

    case 'emailHebrew':
      return [
        `אתה עוזר אישי הכותב מיילים בעברית. תמלל את ההקלטה, ואז המר אותה למייל מקצועי בעברית.`,
        sender,
        to,
        ``,
        `כללים:`,
        `- כתוב בעברית בלבד, בכתב עברי.`,
        `- רישום מקצועי-מנומס. ענייני, ללא קלישאות.`,
        `- שורת הנושא: 4-9 מילים, תיאורית.`,
        `- גוף המייל: שורת פתיחה ברורה לגבי המטרה, פירוט, בקשה או צעד הבא, סיום קצר.`,
        `- אל תחתום עם שם אלא אם הדובר אמר זאת במפורש. סיים ב"בברכה," או דומה.`,
        `- אל תשתמש ב-Markdown.`,
        ``,
        `OUTPUT FORMAT (STRICT): Return EXACTLY two sections in this order, separated by a blank line. No preamble, no markdown fences. The labels SUBJECT and BODY MUST be in English (capital letters) so the app can parse them; the content after each label is in Hebrew.`,
        `SUBJECT: <שורת נושא בעברית, שורה אחת>`,
        ``,
        `BODY:`,
        `<גוף המייל בעברית, שורות מרובות לפי הצורך>`,
      ].join('\n');

    default:
      return `Transcribe the audio verbatim. Return only the transcription.`;
  }
}

// ---------------------------------------------------------------------------
// Library access (Tier 2)
// ---------------------------------------------------------------------------

const LIB_BY_SLUG = Object.fromEntries(LIBRARY.map(p => [p.slug, p]));

export const LIB_PREFIX = 'lib:';

export function isLibraryMode(modeKey) {
  return typeof modeKey === 'string' && modeKey.startsWith(LIB_PREFIX);
}

export function libSlug(modeKey) {
  return isLibraryMode(modeKey) ? modeKey.slice(LIB_PREFIX.length) : null;
}

export function getLibraryEntry(slug) {
  return LIB_BY_SLUG[slug] || null;
}

export function getLibrary() { return LIBRARY; }

export function searchLibrary(query) {
  const q = (query || '').trim().toLowerCase();
  if (!q) return LIBRARY;
  return LIBRARY.filter(p => {
    const hay = (p.name + ' ' + (p.description || '') + ' ' + p.slug).toLowerCase();
    return hay.includes(q);
  });
}

export function resolveMode(modeKey) {
  if (isLibraryMode(modeKey)) {
    const e = getLibraryEntry(libSlug(modeKey));
    if (!e) return null;
    return {
      key: modeKey,
      label: e.name,
      group: 'library',
      groupLabel: 'Library',
      description: e.description || 'Imported from Text-Transformation-Prompt-Library.',
      output: 'text',
      isLibrary: true,
    };
  }
  const m = MODES[modeKey];
  if (!m) return null;
  const g = GROUPS.find(g => g.key === m.group);
  return {
    key: modeKey,
    label: m.label,
    group: m.group,
    groupLabel: g ? g.label : '',
    description: m.description,
    output: m.output,
    isLibrary: false,
  };
}

export function fullLabelFor(modeKey) {
  const r = resolveMode(modeKey);
  if (!r) return modeKey;
  return r.groupLabel ? `${r.groupLabel} → ${r.label}` : r.label;
}

export function buildSystemPromptForMode(modeKey, ctx = {}) {
  if (isLibraryMode(modeKey)) {
    const e = getLibraryEntry(libSlug(modeKey));
    if (!e) return `Transcribe the audio verbatim. Return only the transcription.`;
    const sender = senderClause(ctx.userName);
    return [
      `You are a transcription-and-rewrite bot. Transcribe the user's audio, then transform the text according to the rules below.`,
      sender,
      ``,
      e.system_prompt,
      ``,
      `Return ONLY the transformed text. No preamble, no quotes, no explanation, no markdown fences.`,
    ].join('\n');
  }
  return buildSystemPrompt(modeKey, ctx);
}

// Parse a model response into { subject, body } for email modes.
// Tolerant to leading/trailing whitespace and missing labels.
export function parseEmailOutput(text) {
  if (!text) return { subject: '', body: '' };
  const t = String(text).trim();
  const subjMatch = t.match(/^\s*SUBJECT\s*:\s*(.+?)\s*$/im);
  const bodyMatch = t.match(/^\s*BODY\s*:\s*([\s\S]*)$/im);
  if (subjMatch && bodyMatch) {
    return { subject: subjMatch[1].trim(), body: bodyMatch[1].trim() };
  }
  // Fallback: first non-empty line is subject, rest is body.
  const lines = t.split(/\r?\n/);
  const firstIdx = lines.findIndex(l => l.trim().length);
  if (firstIdx === -1) return { subject: '', body: t };
  const subject = lines[firstIdx].replace(/^subject\s*:\s*/i, '').trim();
  const body = lines.slice(firstIdx + 1).join('\n').replace(/^\s*body\s*:\s*/i, '').trim();
  return { subject, body };
}
