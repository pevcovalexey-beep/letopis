import { isStatKey, type CheckAsk, type SheetFill, type StatKey, type Stats } from "./types.ts";

export type ParsedReply = {
  story: string;
  patch: unknown | null;
  check: CheckAsk | null;
  warn?: string;
};

const STORY_RE = /<story>([\s\S]*?)<\/story>/i;
const STATE_RE = /<state>([\s\S]*?)<\/state>/i;
const PATCH_KEY =
  /"inventory_add"|"inventory_remove"|"nearby"|"hero_conditions"|"companion_updates"|"location"|"check"|"люди"|"people"|"npcs"/;

export function parseMasterReply(raw: string): ParsedReply {
  const text = normalizeReply(raw);
  const storyMatch = text.match(STORY_RE);
  const stateMatch = text.match(STATE_RE);
  let story = storyMatch?.[1]?.trim() ?? "";
  let patch: unknown | null = null;
  let warn: string | undefined;

  if (stateMatch) {
    const parsed = extractJson(stateMatch[1]);
    if (parsed !== null) patch = parsed;
    else warn = "Лист игры не обновлён: в ответе сломан блок состояния.";
  }

  if (!story && stateMatch && stateMatch.index !== undefined) {
    story = text.slice(0, stateMatch.index).replace(/<\/?story>/gi, "").trim();
  }

  if (!story) {
    let rest = text.replace(STORY_RE, "").replace(STATE_RE, "").replace(/<state>[\s\S]*$/i, "").trim();
    if (!stateMatch) {
      const salvaged = salvagePatch(rest);
      if (salvaged) {
        patch = salvaged.value;
        rest = salvaged.rest;
      }
    }
    story = rest;
  }

  story = story.replace(/<state>[\s\S]*$/i, "").replace(/<\/?story>/gi, "").trim();
  if (!story && warn) {
    story = "Мастер не закончил реплику. Повторите действие — инвентарь не менялся.";
  }
  if (!story) story = "Мастер промолчал. Повторите действие.";
  return { story, patch, check: readCheck(patch), warn };
}

export function readCheck(patch: unknown): CheckAsk | null {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return null;
  const raw = (patch as { check?: unknown }).check;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const row = raw as { who?: unknown; stat?: unknown; skill?: unknown };
  const stat = canonStat(typeof row.stat === "string" ? row.stat : "");
  if (!stat) return null;
  const who = typeof row.who === "string" && row.who.trim() ? row.who.trim().slice(0, 80) : "hero";
  const skill = typeof row.skill === "string" ? row.skill.trim().slice(0, 40) : "";
  return { who, stat, skill: skill || undefined };
}

export function parsePurse(raw: string): { name: string; qty: number } | null {
  const value = extractJson(raw);
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as { name?: unknown; qty?: unknown };
  const name = typeof row.name === "string" ? row.name.trim().slice(0, 40) : "";
  const qtyRaw = typeof row.qty === "number" ? row.qty : Number(row.qty);
  if (!name || !Number.isFinite(qtyRaw)) return null;
  return { name, qty: Math.max(0, Math.min(9999, Math.round(qtyRaw))) };
}

export function extractJson(raw: string): unknown | null {
  const cleaned = loosen(raw);
  const direct = tryJson(cleaned);
  if (direct.ok) return direct.value;
  const chunks = balancedObjects(cleaned);
  for (let i = chunks.length - 1; i >= 0; i -= 1) {
    const parsed = tryJson(chunks[i] ?? "");
    if (parsed.ok) return parsed.value;
  }
  return null;
}

export function parseSheet(raw: string): SheetFill | null {
  const value = extractJson(raw);
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const o = value as Record<string, unknown>;
  const stats: Partial<Stats> = {};
  if (o.stats && typeof o.stats === "object" && !Array.isArray(o.stats)) {
    for (const [key, num] of Object.entries(o.stats as Record<string, unknown>)) {
      if (!isStatKey(key)) continue;
      const n = typeof num === "number" ? num : Number(num);
      if (!Number.isFinite(n)) continue;
      stats[key as StatKey] = Math.max(1, Math.min(10, Math.round(n)));
    }
  }
  const skills = Array.isArray(o.skills)
    ? o.skills.flatMap((item) => {
        const name =
          typeof item === "string"
            ? item.trim().slice(0, 40)
            : item && typeof item === "object" && typeof (item as { name?: unknown }).name === "string"
              ? (item as { name: string }).name.trim().slice(0, 40)
              : "";
        if (!name) return [];
        return [{ name }];
      })
    : undefined;
  const inventory = Array.isArray(o.inventory)
    ? o.inventory.flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const row = item as Record<string, unknown>;
        const name = typeof row.name === "string" ? row.name.trim().slice(0, 80) : "";
        if (!name) return [];
        const qtyRaw = typeof row.qty === "number" ? row.qty : Number(row.qty);
        const qty = Number.isFinite(qtyRaw) ? Math.max(1, Math.min(9999, Math.round(qtyRaw))) : 1;
        const consumable = typeof row.consumable === "boolean" ? row.consumable : qty > 1;
        const detail = typeof row.detail === "string" ? row.detail.trim().slice(0, 200) : undefined;
        return [{ name, qty, consumable, detail }];
      })
    : undefined;
  const text = (key: string, max: number) =>
    typeof o[key] === "string" ? (o[key] as string).trim().slice(0, max) : undefined;
  return {
    age: text("age", 40),
    appearance: text("appearance", 600),
    clothing: text("clothing", 300),
    wounds: text("wounds", 300),
    stats: Object.keys(stats).length ? stats : undefined,
    skills,
    inventory,
  };
}

function normalizeReply(raw: string): string {
  let text = raw.replace(/<think>[\s\S]*?<\/think>/gi, " ").replace(/<\/?think>/gi, " ");
  text = text.trim().replace(/^```(?:xml|markdown|md|html)?\s*/i, "").replace(/\s*```$/i, "").trim();
  if (/<story\b/i.test(text) && /<state\b/i.test(text) && !/<\/story>/i.test(text)) {
    text = text.replace(/<state\b/i, "</story>\n<state");
  }
  return text;
}

function canonStat(value: string): StatKey | null {
  const key = value.trim().toLowerCase().replace(/ё/g, "е");
  if (isStatKey(key)) return key;
  const table: Record<string, StatKey> = {
    сила: "str",
    strength: "str",
    ловкость: "dex",
    dexterity: "dex",
    телосложение: "con",
    выносливость: "con",
    constitution: "con",
    разум: "int",
    интеллект: "int",
    intelligence: "int",
    восприятие: "per",
    perception: "per",
    мудрость: "per",
    харизма: "cha",
    charisma: "cha",
  };
  return table[key] ?? null;
}

function loosen(input: string): string {
  return input
    .trim()
    .replace(/^\uFEFF/, "")
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .replace(/[“”]/g, '"')
    .replace(/,\s*([}\]])/g, "$1")
    .trim();
}

function balancedObjects(input: string): string[] {
  const found: string[] = [];
  let start = -1;
  let depth = 0;
  let quote = false;
  let escape = false;
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if (quote) {
      if (escape) escape = false;
      else if (ch === "\\") escape = true;
      else if (ch === '"') quote = false;
      continue;
    }
    if (ch === '"') {
      quote = true;
      continue;
    }
    if (ch === "{") {
      if (depth === 0) start = i;
      depth += 1;
    } else if (ch === "}" && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) found.push(input.slice(start, i + 1));
    }
  }
  return found;
}

function salvagePatch(story: string): { value: unknown; rest: string } | null {
  const key = story.lastIndexOf("{");
  if (key < 0) return null;
  const candidate = story.slice(key);
  if (!PATCH_KEY.test(candidate)) return null;
  const value = extractJson(candidate);
  if (value === null || typeof value !== "object") return null;
  return { value, rest: story.slice(0, key).trim() };
}

function tryJson(input: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(loosen(input)) };
  } catch {
    return { ok: false };
  }
}
