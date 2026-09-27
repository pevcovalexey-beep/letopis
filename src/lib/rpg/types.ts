export const STATS = [
  { key: "str", label: "Сила" },
  { key: "dex", label: "Ловкость" },
  { key: "con", label: "Телосложение" },
  { key: "int", label: "Разум" },
  { key: "per", label: "Восприятие" },
  { key: "cha", label: "Харизма" },
] as const;

export type StatKey = (typeof STATS)[number]["key"];

export type Stats = Record<StatKey, number>;

export const STAT_BUDGET = 35;

export const DEFAULT_MODEL = "deepseek/deepseek-v4.1-flash";

export const GROK_MODEL = "grok-4.5";

export const MODELS: { id: string; label: string }[] = [
  { id: "deepseek/deepseek-v4.1-flash", label: "DeepSeek V4.1 Flash" },
  { id: "google/gemini-3.8-flash", label: "Gemini 3.8 Flash" },
  { id: "anthropic/claude-sonnet-5", label: "Claude Sonnet 5" },
  { id: "anthropic/claude-opus-5.5", label: "Claude Opus 5.5" },
  { id: "openai/gpt-5.6-luna", label: "GPT-5.6 Luna" },
  { id: "x-ai/grok-4.7", label: "Grok 4.7" },
  { id: "moonshotai/kimi-k3", label: "Kimi K3" },
  { id: "z-ai/glm-5.3", label: "GLM 5.3" },
];

export type Phase = "world" | "hero" | "play";

export type Provider = "openrouter" | "grok";

export type Settings = {
  provider: Provider;
  apiKey: string;
  model: string;
};

export type Race = {
  id: string;
  name: string;
  description: string;
};

export type World = {
  title: string;
  genre: string;
  atmosphere: string;
  rules: string;
  races: Race[];
  place: string;
};

export type Skill = {
  id: string;
  name: string;
};

export type Hero = {
  name: string;
  race: string;
  age: string;
  appearance: string;
  stats: Stats;
  skills: Skill[];
};

export type Item = {
  id: string;
  name: string;
  qty: number;
  consumable: boolean;
  detail?: string;
  /** Hero's cash. One consumable stack the table spends and pays. */
  money?: boolean;
};

export type Npc = {
  id: string;
  name: string;
  age: string;
  appearance: string;
  clothing: string;
  status: string;
  goal: string;
  /** Race name from the world list, if the master set one. Looks live in the race description, not in this label. */
  race?: string;
};

export type Memory = Npc & {
  place: string;
};

export type Companion = Npc & {
  age: string;
  stats: Stats;
  skills: Skill[];
  inventory: Item[];
  wounds: string;
  pristine: boolean;
};

export type CheckAsk = {
  who: string;
  stat: StatKey;
  skill?: string;
};

export type Roll = {
  actorId: string;
  actorName: string;
  stat: StatKey;
  statLabel: string;
  statValue: number;
  modifier: number;
  /** Kept face. With a skill this is the higher of two rolls. */
  natural: number;
  /** Raw faces, in the order thrown. Length 2 when a skill granted advantage. */
  faces: number[];
  advantage: boolean;
  total: number;
  skill?: string;
};

export type Message = {
  id: string;
  role: "player" | "master" | "table";
  text: string;
  at: number;
  roll?: Roll | null;
  ledger?: string[];
};

export type ImageTarget =
  | { type: "scene"; title: string; text: string }
  | {
      type: "person";
      title: string;
      name: string;
      appearance: string;
      clothing: string;
      status: string;
      extra?: string;
      age?: string;
      race?: string;
    };

export type SheetFill = {
  age?: string;
  appearance?: string;
  clothing?: string;
  wounds?: string;
  stats?: Partial<Stats>;
  skills?: { name: string }[];
  inventory?: { name: string; qty: number; consumable: boolean; detail?: string }[];
};

export type TableSnapshot = {
  inventory: Item[];
  nearby: Npc[];
  companions: Companion[];
  location: string;
  conditions: string[];
};

export function uid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function defaultStats(): Stats {
  return { str: 5, dex: 5, con: 5, int: 5, per: 5, cha: 5 };
}

export function emptyWorld(): World {
  return { title: "", genre: "", atmosphere: "", rules: "", races: [], place: "" };
}

export function emptyHero(): Hero {
  return {
    name: "",
    race: "",
    age: "",
    appearance: "",
    stats: defaultStats(),
    skills: [],
  };
}

export function defaultSettings(): Settings {
  return { provider: "grok", apiKey: "", model: DEFAULT_MODEL };
}

export function statLabel(key: StatKey): string {
  return STATS.find((s) => s.key === key)?.label ?? key;
}

export function isStatKey(value: string): value is StatKey {
  return STATS.some((s) => s.key === value);
}

export function worldReady(world: World): boolean {
  return Boolean(world.genre.trim() || world.atmosphere.trim() || world.rules.trim());
}

export function masterReady(settings: Settings): boolean {
  if (settings.provider === "grok") return true;
  return Boolean(settings.apiKey.trim() && settings.model.trim());
}

export function pushMessage(list: Message[], message: Message): Message[] {
  const next = [...list, message];
  return next.length > 200 ? next.slice(next.length - 200) : next;
}
