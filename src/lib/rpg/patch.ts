import {
  defaultStats,
  uid,
  type Companion,
  type Item,
  type Memory,
  type Npc,
  type SheetFill,
  type TableSnapshot,
} from "./types.ts";

export function norm(value: string): string {
  return value.trim().toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ");
}

export function cloneSnapshot(snapshot: TableSnapshot): TableSnapshot {
  return {
    location: snapshot.location,
    conditions: [...snapshot.conditions],
    inventory: snapshot.inventory.map(cloneItem),
    nearby: snapshot.nearby.map((npc) => ({ ...npc })),
    companions: snapshot.companions.map(cloneCompanion),
  };
}

export function applyMasterPatch(
  snapshot: TableSnapshot,
  patch: unknown,
): { next: TableSnapshot; ledger: string[] } {
  const next = cloneSnapshot(snapshot);
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    return { next, ledger: [] };
  }
  const src = canonPatch(patch as Record<string, unknown>);
  const ledger: string[] = [];

  if (Array.isArray(src.inventory_remove)) {
    const notes: string[] = [];
    next.inventory = removeItems(next.inventory, src.inventory_remove, notes);
    ledger.push(...notes);
  }
  if (Array.isArray(src.inventory_add)) {
    const notes: string[] = [];
    next.inventory = addItems(next.inventory, src.inventory_add, notes);
    ledger.push(...notes);
  }

  let leftThePlace = false;
  if (typeof src.location === "string") {
    const location = src.location.trim().slice(0, 120);
    if (location && !samePlace(location, next.location)) {
      next.location = location;
      ledger.push(`Место: ${location}`);
      leftThePlace = true;
    } else if (location) {
      next.location = location;
    }
  }

  if (Array.isArray(src.hero_conditions)) {
    const conditions = src.hero_conditions
      .map((item) => (typeof item === "string" ? item.trim().slice(0, 140) : ""))
      .filter(Boolean)
      .slice(0, 12);
    if (conditions.join("|") !== next.conditions.join("|")) {
      next.conditions = conditions;
      ledger.push(conditions.length ? `Состояния: ${conditions.join("; ")}` : "Состояния сняты");
    }
  }

  const people = peopleArray(src);
  if (people) {
    const before = roster(next.nearby);
    next.nearby = readNearby(people, next.companions, next.nearby);
    const after = roster(next.nearby);
    if (before !== after) {
      ledger.push(next.nearby.length ? `Люди: ${after}` : "В поле зрения никого");
    }
  } else if (leftThePlace) {
    next.nearby = [];
  } else {
    next.nearby = next.nearby.filter((npc) => !isInParty(npc, next.companions));
  }

  if (Array.isArray(src.companion_updates)) {
    for (const update of src.companion_updates) {
      applyCompanionUpdate(next.companions, update, ledger);
    }
    next.nearby = next.nearby.filter((npc) => !isInParty(npc, next.companions));
  }

  return { next, ledger };
}

export function addItems(items: Item[], rawList: unknown[], ledger: string[]): Item[] {
  const next = items.map(cloneItem);
  for (const raw of rawList) {
    if (next.length >= 60) {
      ledger.push("Инвентарь полон — новая вещь не добавлена.");
      break;
    }
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    const name = clip(row.name, 80);
    const qty = qtyOf(row.qty, 1);
    if (!name || qty <= 0) continue;
    const detail = clip(row.detail, 200);
    const flag = typeof row.consumable === "boolean" ? row.consumable : undefined;
    const existing = findItem(next, name);
    if (existing) {
      existing.qty = Math.min(9999, existing.qty + qty);
      if (flag === true) existing.consumable = true;
      if (detail) existing.detail = detail;
      ledger.push(`+${qty} · ${existing.name}`);
    } else {
      next.push({
        id: uid(),
        name,
        qty,
        consumable: flag ?? qty > 1,
        detail: detail || undefined,
      });
      ledger.push(`+${qty} · ${name}`);
    }
  }
  return next;
}

export function removeItems(items: Item[], rawList: unknown[], ledger: string[]): Item[] {
  const next = items.map(cloneItem);
  for (const raw of rawList) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    const name = clip(row.name, 80);
    const qty = qtyOf(row.qty, 1);
    if (!name || qty <= 0) continue;
    const existing = findItem(next, name);
    if (!existing) {
      ledger.push(`Списание «${name}» отклонено — такого предмета нет.`);
      continue;
    }
    const removed = Math.min(existing.qty, qty);
    existing.qty -= removed;
    if (removed < qty) {
      ledger.push(`«${existing.name}»: списано ${removed} из ${qty}. Больше не было.`);
    } else {
      ledger.push(`−${removed} · ${existing.name}`);
    }
  }
  return next.filter((item) => item.qty > 0 || item.money);
}

export function sheetToCompanion(companion: Companion, fill: SheetFill): Companion {
  const stats = { ...companion.stats };
  if (fill.stats) {
    for (const [key, value] of Object.entries(fill.stats)) {
      if (value === undefined) continue;
      stats[key as keyof typeof stats] = value;
    }
  }
  return {
    ...companion,
    age: fill.age || companion.age,
    appearance: fill.appearance || companion.appearance,
    clothing: fill.clothing || companion.clothing,
    wounds: fill.wounds ?? companion.wounds,
    stats: { ...defaultStats(), ...stats },
    skills:
      fill.skills?.map((skill) => ({ id: uid(), name: skill.name })) ?? companion.skills,
    inventory:
      fill.inventory?.map((item) => ({
        id: uid(),
        name: item.name,
        qty: item.qty,
        consumable: item.consumable,
        detail: item.detail,
      })) ?? companion.inventory,
    pristine: false,
  };
}

function applyCompanionUpdate(companions: Companion[], raw: unknown, ledger: string[]) {
  if (!raw || typeof raw !== "object") return;
  const row = raw as Record<string, unknown>;
  const id = clip(row.id, 60);
  const name = clip(row.name, 80);
  const target = companions.find(
    (companion) => (id && companion.id === id) || (name && norm(companion.name) === norm(name)),
  );
  if (!target) {
    if (name || id) {
      ledger.push(`Правка отряда пропущена: нет «${name || id}». В отряд переводят только кнопкой.`);
    }
    return;
  }
  const status = clip(row.status, 300);
  const appearance = clip(row.appearance, 1000);
  const clothing = clip(row.clothing, 500);
  const goal = clip(row.goal, 300);
  if (status) target.status = status;
  if (appearance) target.appearance = appearance;
  if (clothing) target.clothing = clothing;
  if (goal) target.goal = goal;
  if (typeof row.wounds === "string") target.wounds = clip(row.wounds, 300);
  const notes: string[] = [];
  if (Array.isArray(row.inventory_remove)) {
    target.inventory = removeItems(target.inventory, row.inventory_remove, notes);
  }
  if (Array.isArray(row.inventory_add)) {
    target.inventory = addItems(target.inventory, row.inventory_add, notes);
  }
  if (notes.length) ledger.push(`${target.name}: ${notes.join("; ")}`);
}

function readNearby(rawList: unknown[], companions: Companion[], previous: Npc[]): Npc[] {
  const nearby: Npc[] = [];
  const seen = new Set<string>();
  rawList.forEach((raw, index) => {
    if (nearby.length >= 12) return;
    const npc = readNpc(raw);
    if (!npc) return;
    if (isInParty(npc, companions)) return;
    const prior =
      previous.find((item) => item.id === npc.id) ??
      previous.find((item) => norm(item.name) === norm(npc.name)) ??
      nearby.find((item) => norm(item.name) === norm(npc.name));
    if (prior && nearby.some((item) => item.id === prior.id)) {
      const held = nearby.find((item) => item.id === prior.id);
      if (!held) return;
      if (npc.age) held.age = npc.age;
      if (npc.appearance) held.appearance = npc.appearance;
      if (npc.clothing) held.clothing = npc.clothing;
      if (npc.status) held.status = npc.status;
      if (npc.goal) held.goal = npc.goal;
      if (npc.race) held.race = npc.race;
      return;
    }
    let id = prior?.id || npc.id;
    if (seen.has(id)) id = `${id}-${index + 1}`;
    seen.add(id);
    nearby.push({ ...npc, id });
  });
  return nearby;
}

function readNpc(raw: unknown): Npc | null {
  if (typeof raw === "string") {
    const name = clip(raw, 80);
    if (!name) return null;
    return { id: slug(name), name, age: "", appearance: "", clothing: "", status: "", goal: "" };
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const name = field(row, ["name", "имя", "who"], 80);
  if (!name) return null;
  return {
    id: field(row, ["id"], 60) || slug(name),
    name,
    age: field(row, ["age", "возраст"], 40),
    appearance: field(row, ["appearance", "внешность", "description", "описание", "look"], 1000),
    clothing: field(row, ["clothing", "одежда", "clothes"], 500),
    status: field(row, ["status", "статус", "doing"], 300),
    goal: field(row, ["goal", "цель"], 300),
    race: field(row, ["race", "раса"], 48) || undefined,
  };
}

const PEOPLE_KEYS = ["nearby", "people", "npcs", "characters", "persons", "люди", "персонажи", "в_кадре"];

function canonPatch(src: Record<string, unknown>): Record<string, unknown> {
  const next = { ...src };
  const take = (to: string, from: string[]) => {
    if (next[to] !== undefined) return;
    for (const key of from) {
      if (next[key] !== undefined) {
        next[to] = next[key];
        return;
      }
    }
  };
  take("inventory_add", ["добавить", "inventoryAdd", "add_items", "items_add"]);
  take("inventory_remove", ["убрать", "inventoryRemove", "remove_items", "items_remove"]);
  take("hero_conditions", ["состояния", "conditions", "heroConditions"]);
  take("companion_updates", ["спутники", "companions", "companionUpdates"]);
  take("location", ["место", "place"]);
  return next;
}

function peopleArray(src: Record<string, unknown>): unknown[] | undefined {
  for (const key of PEOPLE_KEYS) {
    if (!(key in src)) continue;
    const value = src[key];
    if (Array.isArray(value)) return value;
    if (typeof value === "string" && value.trim()) return [value];
    if (value && typeof value === "object") return [value];
  }
  return undefined;
}

export function samePlace(a: string, b: string): boolean {
  const left = norm(a);
  const right = norm(b);
  if (!left || !right) return false;
  if (left === right) return true;
  const [shorter, longer] = left.length <= right.length ? [left, right] : [right, left];
  return shorter.length >= 8 && longer.includes(shorter);
}

export function applyMemory(
  nearby: Npc[],
  memories: Memory[],
  place: string,
  companions: { id: string; name: string }[],
): Npc[] {
  const here = memories.filter((item) => samePlace(item.place, place));
  const next = nearby.map((npc) => {
    const memory = here.find((item) => item.id === npc.id || norm(item.name) === norm(npc.name));
    if (!memory) return npc;
    return {
      ...npc,
      id: memory.id,
      name: memory.name,
      age: memory.age || npc.age,
      appearance: npc.appearance || memory.appearance,
      clothing: npc.clothing || memory.clothing,
      race: npc.race || memory.race,
      status: npc.status || memory.status,
      goal: npc.goal || memory.goal,
    };
  });
  for (const memory of here) {
    if (next.some((npc) => npc.id === memory.id || norm(npc.name) === norm(memory.name))) continue;
    if (companions.some((companion) => companion.id === memory.id || norm(companion.name) === norm(memory.name))) continue;
    if (next.length >= 12) break;
    next.push({
      id: memory.id,
      name: memory.name,
      age: memory.age,
      appearance: memory.appearance,
      clothing: memory.clothing,
      race: memory.race,
      status: memory.status,
      goal: memory.goal,
    });
  }
  return next;
}

function field(row: Record<string, unknown>, keys: string[], max: number): string {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "number" && Number.isFinite(value)) return String(Math.round(value)).slice(0, max);
    if (typeof value === "string" && value.trim()) return value.trim().slice(0, max);
  }
  return "";
}

function isInParty(npc: { id: string; name: string }, companions: Companion[]): boolean {
  const name = norm(npc.name);
  return companions.some((companion) => companion.id === npc.id || norm(companion.name) === name);
}

function findItem(items: Item[], name: string): Item | undefined {
  const needle = norm(name);
  const exact = items.find((item) => norm(item.name) === needle);
  if (exact) return exact;
  const fuzzy = items.filter((item) => {
    const have = norm(item.name);
    return have.includes(needle) || needle.includes(have);
  });
  return fuzzy.length === 1 ? fuzzy[0] : undefined;
}

function roster(list: { name: string }[]): string {
  return list.map((item) => item.name.trim()).join(" · ");
}

function clip(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, max);
}

function qtyOf(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(9999, Math.round(n)));
}

function slug(name: string): string {
  const next = name
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9а-яё-]/gi, "")
    .slice(0, 48);
  return next || uid();
}

function cloneItem(item: Item): Item {
  return { ...item };
}

function cloneCompanion(companion: Companion): Companion {
  return {
    ...companion,
    stats: { ...companion.stats },
    skills: companion.skills.map((skill) => ({ ...skill })),
    inventory: companion.inventory.map(cloneItem),
  };
}
