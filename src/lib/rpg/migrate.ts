import { DEFAULT_MODEL, uid, type Provider, type Race, type Skill } from "./types.ts";

function skillName(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const name = (value as { name?: unknown }).name;
  return typeof name === "string" ? name.trim().slice(0, 40) : "";
}

function asSkills(value: unknown): Skill[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const name = skillName(item);
    if (!name) return [];
    const idRaw = (item as { id?: unknown }).id;
    const id = typeof idRaw === "string" && idRaw.trim() ? idRaw : uid();
    return [{ id, name }];
  });
}

function asRaces(value: unknown): Race[] {
  if (typeof value === "string") {
    const description = value.trim().slice(0, 4000);
    return description ? [{ id: uid(), name: "Народы", description }] : [];
  }
  if (!Array.isArray(value)) return [];
  return value
    .flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const row = item as { id?: unknown; name?: unknown; description?: unknown };
      const name = typeof row.name === "string" ? row.name.slice(0, 48) : "";
      const description = typeof row.description === "string" ? row.description.slice(0, 800) : "";
      if (!name.trim() && !description.trim()) return [];
      const id = typeof row.id === "string" && row.id.trim() ? row.id : uid();
      return [{ id, name, description }];
    })
    .slice(0, 16);
}

function asProvider(value: unknown, apiKey: string): Provider {
  if (value === "grok" || value === "openrouter") return value;
  return apiKey.trim() ? "openrouter" : "grok";
}

export function migrateSave(persisted: unknown): unknown {
  if (!persisted || typeof persisted !== "object") return persisted;
  const state = persisted as Record<string, unknown>;
  const settings =
    state.settings && typeof state.settings === "object" ? (state.settings as Record<string, unknown>) : {};
  const apiKey = typeof settings.apiKey === "string" ? settings.apiKey : "";
  const model = typeof settings.model === "string" && settings.model.trim() ? settings.model : DEFAULT_MODEL;
  state.settings = {
    provider: asProvider(settings.provider, apiKey),
    apiKey,
    model,
  };

  const world = state.world && typeof state.world === "object" ? (state.world as Record<string, unknown>) : {};
  world.races = asRaces(world.races);
  state.world = world;

  const hero = state.hero && typeof state.hero === "object" ? (state.hero as Record<string, unknown>) : null;
  if (hero) hero.skills = asSkills(hero.skills);

  if (Array.isArray(state.companions)) {
    for (const companion of state.companions) {
      if (!companion || typeof companion !== "object") continue;
      const row = companion as Record<string, unknown>;
      row.skills = asSkills(row.skills);
    }
  }

  const pending = state.pendingRoll;
  if (pending && typeof pending === "object") {
    const roll = pending as Record<string, unknown>;
    const natural = typeof roll.natural === "number" ? roll.natural : 1;
    if (!Array.isArray(roll.faces) || roll.faces.length === 0) roll.faces = [natural];
    if (typeof roll.advantage !== "boolean") roll.advantage = false;
  }

  if (Array.isArray(state.messages)) {
    for (const message of state.messages) {
      if (!message || typeof message !== "object") continue;
      const row = message as Record<string, unknown>;
      const roll = row.roll;
      if (!roll || typeof roll !== "object") continue;
      const dice = roll as Record<string, unknown>;
      const natural = typeof dice.natural === "number" ? dice.natural : 1;
      if (!Array.isArray(dice.faces) || dice.faces.length === 0) dice.faces = [natural];
      if (typeof dice.advantage !== "boolean") dice.advantage = false;
    }
  }

  return state;
}
