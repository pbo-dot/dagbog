// AI-analyse via Claude API direkte fra browseren med ejerens egen API-nøgle.
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import { formatFull, formatLong, formatMonth, formatWeek, weekDays, weekId, addDays } from './dates';
import { moodLabel, type ChatTurn, type Entry, type Settings } from './types';

export class AIError extends Error {}

function client(settings: Settings) {
  if (!settings.ai.apiKey) throw new AIError('Der mangler en API-nøgle under Indstillinger → AI-analyse.');
  return new Anthropic({ apiKey: settings.ai.apiKey, dangerouslyAllowBrowser: true });
}

// Server-side fallback ved afvisning er kun relevant for Opus/Sonnet/Fable.
function fallbackFor(model: string) {
  return /opus|sonnet|fable/.test(model)
    ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const }
    : {};
}

function explain(e: unknown): never {
  if (e instanceof AIError) throw e;
  if (e instanceof Anthropic.AuthenticationError) throw new AIError('API-nøglen blev afvist. Tjek den under Indstillinger.');
  if (e instanceof Anthropic.PermissionDeniedError) throw new AIError('API-nøglen har ikke adgang til denne model.');
  if (e instanceof Anthropic.NotFoundError) throw new AIError('Modellen findes ikke. Tjek modelnavnet under Indstillinger.');
  if (e instanceof Anthropic.RateLimitError) throw new AIError('For mange forespørgsler lige nu. Prøv igen om lidt.');
  if (e instanceof Anthropic.APIConnectionError) throw new AIError('Ingen forbindelse til Claude. Er du online?');
  if (e instanceof Anthropic.APIError) throw new AIError(`Claude svarede med en fejl (${e.status}).`);
  throw new AIError('Noget gik galt med AI-analysen.');
}

const FRIEND = `Du er "den kloge ven" i en privat dagbogsapp. Én person skriver dagbog til sig selv, og du læser med, når personen beder om det.

Tone:
- Ærlig og varm. Du belærer ikke og moraliserer ikke.
- Du må gerne anerkende følelser ("det lyder hårdt"), men peg helst på mønstre og still spørgsmål frem for at give færdige svar.
- Mønstre formuleres som iagttagelser, ikke domme, fx "Du skrev oftere om søvn i uger med mange møder."
- Skriv på naturligt, enkelt dansk i du-form. Kort og konkret frem for generelt. Ingen floskler, ingen emojis.
- Du er ikke terapeut og stiller ikke diagnoser.
- Hold dig til det, der faktisk står i dagbogen. Find ikke på detaljer.

Hvis teksten rummer tegn på krise – fx tanker om selvmord eller selvskade, at personen ikke kan holde til mere, eller at personen er i fare – skal du sige det varmt og direkte og opfordre til at tale med nogen nu. I Danmark: Livslinien 70 201 201 (anonym rådgivning), egen læge/lægevagten 1813, eller 112 ved akut fare.`;

function entryBlock(e: Entry, maxChars?: number): string {
  const head = [formatLong(e.date), e.mood ? `humør: ${moodLabel(e.mood)}` : '', e.tags.length ? `tags: ${e.tags.join(', ')}` : '']
    .filter(Boolean)
    .join(' · ');
  const text = maxChars && e.text.length > maxChars ? `${e.text.slice(0, maxChars)} …` : e.text;
  const good = e.good.filter(Boolean);
  return `### ${e.date} (${head})\n${text}${good.length ? `\nGode ting: ${good.join('; ')}` : ''}`;
}

function textOf(content: Anthropic.Beta.BetaContentBlock[]): string {
  return content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
}

// ---------------- Ugeopsummering ----------------

const WeekSchema = z.object({
  threeWords: z.array(z.string()).describe('Præcis tre enkeltord, der beskriver ugen'),
  takeaway: z.string().describe('Én sætning om, hvad personen kan tage med sig fra ugen'),
  summary: z.string().describe('Kort opsummering i ren tekst (3-6 sætninger): ugens hovedtemaer og de følelser, der gik igen'),
  themes: z.array(z.string()).describe('2-4 hovedtemaer som korte udtryk'),
  feelings: z.array(z.string()).describe('Følelser, der gik igen'),
  patterns: z.array(z.string()).describe('Højst to iagttagelser om mønstre – gerne på tværs af ugerne. Tom liste hvis intet er tydeligt.'),
  reflection: z.string().describe('Ét åbent refleksionsspørgsmål'),
  nextWeekQuestion: z.string().describe('Ét spørgsmål til næste uge, fx "Hvad vil du give plads til?"'),
  crisis: z.boolean().describe('true hvis der er tegn på krise'),
});
export type WeekAI = z.infer<typeof WeekSchema>;

export async function summarizeWeek(settings: Settings, id: string, entries: Record<string, Entry>): Promise<WeekAI> {
  const days = weekDays(id);
  const thisWeek = days.map((d) => entries[d]).filter(Boolean);
  if (!thisWeek.length) throw new AIError('Der er ingen dage i ugen at opsummere.');

  // Kort kontekst fra de foregående 8 uger, så mønstre på tværs kan ses.
  const earlier: string[] = [];
  for (let w = 1; w <= 8; w++) {
    const wid = weekId(addDays(days[0], -7 * w));
    const es = weekDays(wid).map((d) => entries[d]).filter(Boolean);
    if (es.length) earlier.push(`## ${formatWeek(wid)}\n${es.map((e) => entryBlock(e, 300)).join('\n')}`);
  }

  const prompt = `Her er dagbogen for ${formatWeek(id)}:

${thisWeek.map((e) => entryBlock(e)).join('\n\n')}
${earlier.length ? `\n\nTil sammenligning, korte uddrag fra de foregående uger (brug dem kun til at se mønstre):\n\n${earlier.join('\n\n')}` : ''}

Lav ugens opsummering.`;

  try {
    const res = await client(settings).beta.messages.parse({
      model: settings.ai.analysisModel,
      max_tokens: 16000,
      system: FRIEND,
      output_config: { effort: 'medium', format: betaZodOutputFormat(WeekSchema) },
      messages: [{ role: 'user', content: prompt }],
      ...fallbackFor(settings.ai.analysisModel),
    });
    if (res.stop_reason === 'refusal' || !res.parsed_output) throw new AIError('Claude kunne ikke lave en opsummering af denne uge.');
    const out = res.parsed_output;
    return { ...out, threeWords: out.threeWords.slice(0, 3), patterns: out.patterns.slice(0, 2) };
  } catch (e) {
    explain(e);
  }
}

// ---------------- Gå dybere (samtale) ----------------

export async function goDeeper(settings: Settings, weekLabel: string, weekText: string, history: ChatTurn[]): Promise<string> {
  const first: Anthropic.Beta.BetaMessageParam = {
    role: 'user',
    content: `Dagbogen for ${weekLabel}:\n\n${weekText}\n\nJeg vil gerne gå lidt dybere med ugen. Giv mig en lidt længere refleksion (to til fire korte afsnit): hvad ser du, hvad kunne ligge bag, og et par spørgsmål jeg kan tænke over. Ingen overskrifter eller punktlister.`,
  };
  const messages: Anthropic.Beta.BetaMessageParam[] = [first, ...history.map((t) => ({ role: t.role, content: t.text }))];
  try {
    const res = await client(settings).beta.messages.create({
      model: settings.ai.analysisModel,
      max_tokens: 16000,
      system: FRIEND,
      output_config: { effort: 'medium' },
      messages,
      ...fallbackFor(settings.ai.analysisModel),
    });
    if (res.stop_reason === 'refusal') throw new AIError('Claude ville ikke svare på dette.');
    return textOf(res.content);
  } catch (e) {
    explain(e);
  }
}

export function weekTextFor(id: string, entries: Record<string, Entry>): string {
  return weekDays(id).map((d) => entries[d]).filter(Boolean).map((e) => entryBlock(e)).join('\n\n');
}

// ---------------- Månedskapitel ----------------

const MonthSchema = z.object({
  title: z.string().describe('En kort, rolig titel på kapitlet (2-6 ord)'),
  text: z.string().describe('Kapitlet: 2-4 korte afsnit adskilt af tomme linjer, skrevet i jeg-form som personens egen tekst'),
  themes: z.array(z.string()).describe('3-5 hovedtemaer som korte mærkater (1-3 ord)'),
});
export type MonthAI = z.infer<typeof MonthSchema>;

export async function writeMonthChapter(settings: Settings, id: string, entries: Entry[]): Promise<MonthAI> {
  if (!entries.length) throw new AIError('Der er ingen dage i måneden.');
  const prompt = `Her er dagbogen for ${formatMonth(id)}:

${entries.map((e) => entryBlock(e)).join('\n\n')}

Skriv et udkast til månedens kapitel. Det er et udkast, som personen selv retter i, så skriv det i jeg-form, som om personen ser tilbage på måneden: hvad fyldte, hvad ændrede sig, og hvad der var godt. Hold dig til det, der står.`;
  try {
    const res = await client(settings).beta.messages.parse({
      model: settings.ai.analysisModel,
      max_tokens: 16000,
      system: FRIEND,
      output_config: { effort: 'medium', format: betaZodOutputFormat(MonthSchema) },
      messages: [{ role: 'user', content: prompt }],
      ...fallbackFor(settings.ai.analysisModel),
    });
    if (res.stop_reason === 'refusal' || !res.parsed_output) throw new AIError('Claude kunne ikke skrive kapitlet.');
    return { ...res.parsed_output, themes: res.parsed_output.themes.slice(0, 5) };
  } catch (e) {
    explain(e);
  }
}

// ---------------- Søgning med naturligt sprog ----------------

const SearchSchema = z.object({
  results: z.array(
    z.object({
      date: z.string().describe('Datoen YYYY-MM-DD for en relevant dag'),
      quotes: z.array(z.string()).describe('1-2 korte, ordrette uddrag fra dagens tekst, som er relevante'),
    }),
  ),
});

export interface AIHit {
  date: string;
  quotes: string[];
}

export async function searchDiary(settings: Settings, query: string, entries: Entry[]): Promise<AIHit[]> {
  const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date));
  // Groft loft, så vi holder os langt under modellens kontekstvindue.
  let corpus = sorted.map((e) => entryBlock(e)).join('\n\n');
  if (corpus.length > 2_000_000) corpus = corpus.slice(corpus.length - 2_000_000);

  try {
    const res = await client(settings).beta.messages.parse({
      model: settings.ai.searchModel,
      max_tokens: 8000,
      output_config: { effort: 'low', format: betaZodOutputFormat(SearchSchema) },
      system: [
        {
          type: 'text',
          text: 'Du er søgefunktionen i en privat dagbog. Find de dage, der passer til brugerens søgning – også når ordene ikke matcher præcist (synonymer, omskrivninger, stemninger). Returnér højst 15 dage, mest relevante først. Citater skal være ordrette fra dagens tekst. Returnér en tom liste, hvis intet passer.',
        },
        { type: 'text', text: `DAGBOGEN:\n\n${corpus}`, cache_control: { type: 'ephemeral' } },
      ],
      messages: [{ role: 'user', content: `Søgning: ${query}` }],
    });
    if (res.stop_reason === 'refusal' || !res.parsed_output) return [];
    return res.parsed_output.results;
  } catch (e) {
    explain(e);
  }
}

// ---------------- Samtale ----------------

const ConversationSchema = z.object({
  title: z.string().describe('Kort titel på samtalen (2-6 ord), fx "Lægebesøg om knæet"'),
  summary: z.string().describe('Resumé i ren tekst (2-5 sætninger): hvad samtalen handlede om, og hvad der blev sagt af betydning'),
  agreements: z.array(z.string()).describe('Konkrete aftaler: hvem gør hvad og hvornår. Tom liste hvis ingen.'),
  remember: z.array(z.string()).describe('Ting personen skal huske eller gøre, fx tider, navne, medicin, beskeder. Tom liste hvis ingen.'),
  people: z.array(z.string()).describe('Navne på dem, personen talte med eller som blev nævnt. Kun navne, der står i teksten.'),
  events: z
    .array(
      z.object({
        title: z.string().describe('Kort titel til kalenderen, fx "Kontrol hos lægen"'),
        date: z.string().describe('Datoen YYYY-MM-DD. Regn relative angivelser ("i morgen", "om tre uger", "på fredag") ud fra samtalens dato.'),
        time: z.string().describe('Klokkeslæt HH:MM, eller tom streng hvis der ikke blev nævnt et klokkeslæt'),
        durationMinutes: z.number().describe('Varighed i minutter; 60 hvis det ikke blev nævnt'),
        place: z.string().describe('Sted, eller tom streng'),
      }),
    )
    .describe('Aftaler og begivenheder med en dato (nævnt direkte eller som "om tre uger"), som personen kan lægge i sin kalender. Kun det, der står i teksten. Tom liste hvis ingen.'),
});
export type ConversationAI = z.infer<typeof ConversationSchema>;

const MEMORY_HELPER = `Du hjælper en person med at huske sine samtaler. Personen har optaget en samtale, og du får teksten fra talegenkendelsen. Teksten kan have fejl, mangle tegnsætning og ikke angive, hvem der siger hvad.

- Skriv på enkelt, klart dansk i du-form ("Du talte med …").
- Hold dig strengt til det, der står. Find ikke på navne, tal, tider eller aftaler. Er noget uklart eller måske hørt forkert, så sig det ("det lød som …").
- Det vigtigste er aftaler og ting at huske: tider, datoer, navne, medicin, hvem der gør hvad.
- Kort og konkret. Ingen emojis.`;

export async function summarizeConversation(settings: Settings, date: string, transcript: string, knownPeople: string[]): Promise<ConversationAI> {
  const text = transcript.trim();
  if (!text) throw new AIError('Der er ingen tekst at lave et resumé af.');
  const prompt = `Samtalen er fra ${formatFull(date)} (${date}).${knownPeople.length ? `\nKendte personer i dagbogen (brug samme stavemåde, hvis de nævnes): ${knownPeople.join(', ')}.` : ''}

TEKST FRA OPTAGELSEN:
${text.length > 400_000 ? text.slice(0, 400_000) : text}

Lav et resumé af samtalen.`;
  try {
    const res = await client(settings).beta.messages.parse({
      model: settings.ai.analysisModel,
      max_tokens: 16000,
      system: MEMORY_HELPER,
      output_config: { effort: 'medium', format: betaZodOutputFormat(ConversationSchema) },
      messages: [{ role: 'user', content: prompt }],
      ...fallbackFor(settings.ai.analysisModel),
    });
    if (res.stop_reason === 'refusal' || !res.parsed_output) throw new AIError('Claude kunne ikke lave et resumé af samtalen.');
    return res.parsed_output;
  } catch (e) {
    explain(e);
  }
}

export async function testKey(settings: Settings): Promise<void> {
  try {
    await client(settings).messages.create({
      model: settings.ai.searchModel,
      max_tokens: 16,
      messages: [{ role: 'user', content: 'Svar kun: ok' }],
    });
  } catch (e) {
    explain(e);
  }
}
