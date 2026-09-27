import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { heroReady, rollSummary, statSum } from "./dice.ts";
import { migrateSave } from "./migrate.ts";
import { applyMasterPatch, applyMemory, norm, samePlace, sheetToCompanion } from "./patch.ts";
import { parseMasterReply } from "./parse.ts";
import { draftCompanion } from "./sheet.ts";
import {
  defaultSettings,
  emptyHero,
  emptyWorld,
  pushMessage,
  STAT_BUDGET,
  uid,
  type CheckAsk,
  type Companion,
  type Hero,
  type Item,
  type Memory,
  type Message,
  type Npc,
  type Phase,
  type Race,
  type Roll,
  type Settings,
  type SheetFill,
  type Skill,
  type StatKey,
  type World,
} from "./types.ts";

export type RestartMode = "all" | "hero" | "tale";

export type LinkNote = {
  phase: "idle" | "checking" | "ok" | "bad";
  text: string;
};

type RpgState = {
  phase: Phase;
  settings: Settings;
  world: World;
  hero: Hero;
  inventory: Item[];
  kit: Item[];
  hasKit: boolean;
  chronicle: number;
  link: LinkNote;
  nearby: Npc[];
  memories: Memory[];
  companions: Companion[];
  messages: Message[];
  location: string;
  conditions: string[];
  pendingRoll: Roll | null;
  busy: boolean;
  banner: string | null;
  patchSettings: (patch: Partial<Settings>) => void;
  patchWorld: (patch: Partial<World>) => void;
  addRace: () => void;
  patchRace: (id: string, patch: Partial<Pick<Race, "name" | "description">>) => void;
  removeRace: (id: string) => void;
  patchHero: (patch: Partial<Hero>) => void;
  setStat: (key: StatKey, value: number) => void;
  addSkill: (name: string) => void;
  removeSkill: (id: string) => void;
  setPhase: (phase: Phase) => void;
  beginPlay: () => void;
  setPendingRoll: (roll: Roll | null) => void;
  setBanner: (banner: string | null) => void;
  setLink: (link: LinkNote) => void;
  setBusy: (busy: boolean) => void;
  pushPlayer: (text: string) => Message;
  rollbackPlayer: (id: string, roll: Roll | null) => void;
  commitMasterReply: (raw: string) => CheckAsk | null;
  pushTableRoll: (roll: Roll) => void;
  addTableNote: (text: string) => void;
  addInventoryItem: (item: { name: string; qty: number; consumable: boolean }) => void;
  setPurse: (name: string, qty: number) => void;
  setItemQty: (id: string, qty: number) => void;
  deleteItem: (id: string) => void;
  setConditions: (conditions: string[]) => void;
  dismissNearby: (id: string) => void;
  rememberPerson: (id: string) => void;
  forgetPerson: (id: string) => void;
  promoteNearby: (id: string) => void;
  releaseCompanion: (id: string) => void;
  patchCompanion: (id: string, patch: Partial<Companion>) => void;
  setCompanionStat: (id: string, key: StatKey, value: number) => void;
  addCompanionSkill: (id: string, name: string) => void;
  removeCompanionSkill: (id: string, skillId: string) => void;
  addCompanionItem: (id: string, item: { name: string; qty: number; consumable: boolean }) => void;
  setCompanionItemQty: (id: string, itemId: string, qty: number) => void;
  deleteCompanionItem: (id: string, itemId: string) => void;
  applyCompanionSheet: (id: string, fill: SheetFill) => boolean;
  sealPristineCompanions: () => void;
  restart: (mode: RestartMode) => void;
};

const memory = new Map<string, string>();

const safeStorage = {
  getItem: (name: string) => {
    if (typeof window === "undefined") return memory.get(name) ?? null;
    return window.localStorage.getItem(name);
  },
  setItem: (name: string, value: string) => {
    if (typeof window === "undefined") {
      memory.set(name, value);
      return;
    }
    try {
      window.localStorage.setItem(name, value);
    } catch {
      /* quota */
    }
  },
  removeItem: (name: string) => {
    if (typeof window === "undefined") memory.delete(name);
    else window.localStorage.removeItem(name);
  },
};

function touchCompanion(companions: Companion[], id: string, recipe: (companion: Companion) => Companion) {
  return companions.map((companion) => (companion.id === id ? recipe(companion) : companion));
}

export const useRpg = create<RpgState>()(
  persist(
    (set, get) => ({
      phase: "world",
      settings: defaultSettings(),
      world: emptyWorld(),
      hero: emptyHero(),
      inventory: [],
      kit: [],
      hasKit: false,
      chronicle: 0,
      link: { phase: "idle", text: "" },
      nearby: [],
      memories: [],
      companions: [],
      messages: [],
      location: "",
      conditions: [],
      pendingRoll: null,
      busy: false,
      banner: null,
      patchSettings: (patch) => set((state) => ({ settings: { ...state.settings, ...patch } })),
      patchWorld: (patch) => set((state) => ({ world: { ...state.world, ...patch, races: patch.races ?? state.world.races } })),
      addRace: () =>
        set((state) => {
          const races = Array.isArray(state.world.races) ? state.world.races : [];
          if (races.length >= 16) return state;
          const race: Race = { id: uid(), name: "", description: "" };
          return { world: { ...state.world, races: [...races, race] } };
        }),
      patchRace: (id, patch) =>
        set((state) => ({
          world: {
            ...state.world,
            races: (Array.isArray(state.world.races) ? state.world.races : []).map((race) =>
              race.id === id
                ? {
                    ...race,
                    name: patch.name !== undefined ? patch.name.slice(0, 48) : race.name,
                    description: patch.description !== undefined ? patch.description.slice(0, 800) : race.description,
                  }
                : race,
            ),
          },
        })),
      removeRace: (id) =>
        set((state) => ({
          world: {
            ...state.world,
            races: (Array.isArray(state.world.races) ? state.world.races : []).filter((race) => race.id !== id),
          },
        })),
      patchHero: (patch) => set((state) => ({ hero: { ...state.hero, ...patch } })),
      setStat: (key, value) =>
        set((state) => {
          const nextValue = clamp(value);
          const stats = { ...state.hero.stats, [key]: nextValue };
          if (statSum(stats) > STAT_BUDGET) return state;
          return { hero: { ...state.hero, stats } };
        }),
      addSkill: (name) =>
        set((state) => {
          const trimmed = name.trim().slice(0, 40);
          if (!trimmed) return state;
          if (state.hero.skills.some((skill) => norm(skill.name) === norm(trimmed))) return state;
          const skill: Skill = { id: uid(), name: trimmed };
          return { hero: { ...state.hero, skills: [...state.hero.skills, skill] } };
        }),
      removeSkill: (id) =>
        set((state) => ({
          hero: { ...state.hero, skills: state.hero.skills.filter((skill) => skill.id !== id) },
        })),
      setPhase: (phase) => set({ phase }),
      beginPlay: () =>
        set((state) => {
          const takeKit = state.messages.length === 0 && !state.hasKit;
          return {
            phase: "play",
            location: state.location || state.world.place.trim(),
            hasKit: state.hasKit || takeKit,
            kit: takeKit ? copyItems(state.inventory) : state.kit,
          };
        }),
      setPendingRoll: (pendingRoll) => set({ pendingRoll }),
      setBanner: (banner) => set({ banner }),
      setLink: (link) => set({ link }),
      setBusy: (busy) => set({ busy }),
      pushPlayer: (text) => {
        const state = get();
        const message: Message = {
          id: uid(),
          role: "player",
          text,
          at: Date.now(),
        };
        set({
          messages: pushMessage(state.messages, message),
          pendingRoll: null,
          busy: true,
          banner: null,
        });
        return message;
      },
      rollbackPlayer: (id, roll) =>
        set((state) => ({
          messages: state.messages.filter((message) => message.id !== id),
          pendingRoll: roll,
          busy: false,
        })),
      commitMasterReply: (raw) => {
        const state = get();
        const parsed = parseMasterReply(raw);
        const applied = applyMasterPatch(
          {
            inventory: state.inventory,
            nearby: state.nearby,
            companions: state.companions,
            location: state.location,
            conditions: state.conditions,
          },
          parsed.patch,
        );
        const nextPlace = (applied.next.location || state.world.place).trim();
        const nearby = applyMemory(applied.next.nearby, state.memories ?? [], nextPlace, state.companions);
        const memories = (state.memories ?? []).map((memory) => {
          if (!samePlace(memory.place, nextPlace)) return memory;
          const live = nearby.find((npc) => npc.id === memory.id || norm(npc.name) === norm(memory.name));
          if (!live) return memory;
          return {
            ...memory,
            age: memory.age || live.age,
            appearance: live.appearance || memory.appearance,
            clothing: live.clothing || memory.clothing,
            race: live.race || memory.race,
            status: live.status || memory.status,
            goal: live.goal || memory.goal,
          };
        });
        const brought = nearby.filter(
          (npc) =>
            !state.nearby.some((item) => item.id === npc.id || norm(item.name) === norm(npc.name)) &&
            !applied.next.nearby.some((item) => item.id === npc.id || norm(item.name) === norm(npc.name)),
        );
        const ledger = [...(parsed.warn ? [parsed.warn] : []), ...applied.ledger];
        if (brought.length) ledger.push(`Снова здесь: ${brought.map((npc) => npc.name).join(", ")}`);
        const message: Message = {
          id: uid(),
          role: "master",
          text: parsed.story,
          at: Date.now(),
          ledger: ledger.length ? ledger : undefined,
        };
        set({
          ...applied.next,
          nearby,
          memories,
          messages: pushMessage(state.messages, message),
          busy: false,
          banner: null,
        });
        return parsed.check;
      },
      pushTableRoll: (roll) =>
        set((state) => ({
          messages: pushMessage(state.messages, {
            id: uid(),
            role: "table",
            text: rollSummary(roll),
            at: Date.now(),
            roll,
          }),
        })),
      addTableNote: (text) =>
        set((state) => ({
          messages: pushMessage(state.messages, {
            id: uid(),
            role: "table",
            text,
            at: Date.now(),
          }),
        })),
      addInventoryItem: (item) =>
        set((state) => {
          const name = item.name.trim().slice(0, 80);
          if (!name) return state;
          const qty = Math.max(1, Math.min(9999, Math.round(item.qty) || 1));
          const existing = state.inventory.find((row) => norm(row.name) === norm(name));
          if (existing) {
            return {
              inventory: state.inventory.map((row) =>
                row.id === existing.id
                  ? { ...row, qty: Math.min(9999, row.qty + qty), consumable: row.consumable || item.consumable }
                  : row,
              ),
            };
          }
          return {
            inventory: [
              ...state.inventory,
              { id: uid(), name, qty, consumable: item.consumable, detail: undefined },
            ],
          };
        }),
      setPurse: (name, qty) =>
        set((state) => {
          const label = name.trim().slice(0, 40) || "Деньги";
          const amount = Math.max(0, Math.min(9999, Math.round(Number(qty)) || 0));
          const current = state.inventory.find((item) => item.money);
          const rest = state.inventory.filter((item) => !item.money && norm(item.name) !== norm(label));
          const purse: Item = current
            ? { ...current, name: label, qty: amount, consumable: true, money: true }
            : { id: uid(), name: label, qty: amount, consumable: true, money: true };
          return { inventory: [...rest, purse] };
        }),
      setItemQty: (id, qty) =>
        set((state) => ({
          inventory:
            qty <= 0
              ? state.inventory.filter((item) => item.id !== id)
              : state.inventory.map((item) =>
                  item.id === id ? { ...item, qty: Math.min(9999, Math.round(qty)) } : item,
                ),
        })),
      deleteItem: (id) => set((state) => ({ inventory: state.inventory.filter((item) => item.id !== id) })),
      setConditions: (conditions) => set({ conditions: conditions.slice(0, 12) }),
      dismissNearby: (id) => set((state) => ({ nearby: state.nearby.filter((npc) => npc.id !== id) })),
      rememberPerson: (id) => {
        const state = get();
        const npc = state.nearby.find((item) => item.id === id);
        if (!npc || !npc.name.trim()) return;
        const place = (state.location || state.world.place || "Это место").trim().slice(0, 120);
        const memory: Memory = { ...npc, place };
        const known = state.memories ?? [];
        const exists = known.some((item) => item.id === npc.id || norm(item.name) === norm(npc.name));
        const memories = exists
          ? known.map((item) => (item.id === npc.id || norm(item.name) === norm(npc.name) ? memory : item))
          : [...known, memory].slice(0, 40);
        set({
          memories,
          messages: pushMessage(state.messages, {
            id: uid(),
            role: "table",
            text: `«${npc.name}» запомнили в месте «${place}». Когда вернётесь сюда, это будет тот же человек.`,
            at: Date.now(),
          }),
        });
      },
      forgetPerson: (id) =>
        set((state) => {
          const known = state.memories ?? [];
          const named = [...state.nearby, ...known].find((person) => person.id === id);
          const name = named ? norm(named.name) : "";
          return {
            memories: known.filter((item) => item.id !== id && (!name || norm(item.name) !== name)),
          };
        }),
      promoteNearby: (id) =>
        set((state) => {
          const npc = state.nearby.find((item) => item.id === id);
          if (!npc) return state;
          const exists = state.companions.some((companion) => companion.id === id);
          const drafted = companionFromNpc(npc);
          return {
            nearby: state.nearby.filter((item) => item.id !== id),
            companions: exists ? state.companions : [...state.companions, drafted],
            messages: pushMessage(state.messages, {
              id: uid(),
              role: "table",
              text: exists
                ? `«${npc.name}» уже в отряде.`
                : `«${npc.name}» в отряде. Лист собран сам: сила ${drafted.stats.str}, харизма ${drafted.stats.cha}.`,
              at: Date.now(),
            }),
          };
        }),
      releaseCompanion: (id) =>
        set((state) => {
          const companion = state.companions.find((item) => item.id === id);
          if (!companion) return state;
          return {
            companions: state.companions.filter((item) => item.id !== id),
            nearby: [
              ...state.nearby.filter((npc) => npc.id !== id && norm(npc.name) !== norm(companion.name)),
              {
                id: companion.id,
                name: companion.name,
                age: companion.age || "",
                appearance: companion.appearance,
                clothing: companion.clothing,
                race: companion.race,
                status: "Больше не в отряде.",
                goal: companion.goal,
              },
            ],
            messages: pushMessage(state.messages, {
              id: uid(),
              role: "table",
              text: `«${companion.name}» покинул отряд и снова рядом.`,
              at: Date.now(),
            }),
          };
        }),
      patchCompanion: (id, patch) =>
        set((state) => ({
          companions: touchCompanion(state.companions, id, (companion) => ({
            ...companion,
            ...patch,
            stats: patch.stats ?? companion.stats,
            skills: patch.skills ?? companion.skills,
            inventory: patch.inventory ?? companion.inventory,
            pristine: false,
          })),
        })),
      setCompanionStat: (id, key, value) =>
        set((state) => ({
          companions: touchCompanion(state.companions, id, (companion) => ({
            ...companion,
            pristine: false,
            stats: { ...companion.stats, [key]: clamp(value) },
          })),
        })),
      addCompanionSkill: (id, name) =>
        set((state) => ({
          companions: touchCompanion(state.companions, id, (companion) => {
            const trimmed = name.trim().slice(0, 40);
            if (!trimmed || companion.skills.some((skill) => norm(skill.name) === norm(trimmed))) {
              return companion;
            }
            return {
              ...companion,
              pristine: false,
              skills: [...companion.skills, { id: uid(), name: trimmed }],
            };
          }),
        })),
      removeCompanionSkill: (id, skillId) =>
        set((state) => ({
          companions: touchCompanion(state.companions, id, (companion) => ({
            ...companion,
            pristine: false,
            skills: companion.skills.filter((skill) => skill.id !== skillId),
          })),
        })),
      addCompanionItem: (id, item) =>
        set((state) => ({
          companions: touchCompanion(state.companions, id, (companion) => {
            const name = item.name.trim().slice(0, 80);
            if (!name) return companion;
            const qty = Math.max(1, Math.min(9999, Math.round(item.qty) || 1));
            const existing = companion.inventory.find((row) => norm(row.name) === norm(name));
            const inventory = existing
              ? companion.inventory.map((row) =>
                  row.id === existing.id
                    ? { ...row, qty: Math.min(9999, row.qty + qty), consumable: row.consumable || item.consumable }
                    : row,
                )
              : [...companion.inventory, { id: uid(), name, qty, consumable: item.consumable }];
            return { ...companion, pristine: false, inventory };
          }),
        })),
      setCompanionItemQty: (id, itemId, qty) =>
        set((state) => ({
          companions: touchCompanion(state.companions, id, (companion) => ({
            ...companion,
            pristine: false,
            inventory:
              qty <= 0
                ? companion.inventory.filter((item) => item.id !== itemId)
                : companion.inventory.map((item) =>
                    item.id === itemId ? { ...item, qty: Math.min(9999, Math.round(qty)) } : item,
                  ),
          })),
        })),
      deleteCompanionItem: (id, itemId) =>
        set((state) => ({
          companions: touchCompanion(state.companions, id, (companion) => ({
            ...companion,
            pristine: false,
            inventory: companion.inventory.filter((item) => item.id !== itemId),
          })),
        })),
      applyCompanionSheet: (id, fill) => {
        const companion = get().companions.find((item) => item.id === id);
        if (!companion || !companion.pristine) return false;
        set((state) => ({
          companions: touchCompanion(state.companions, id, (current) =>
            current.pristine ? sheetToCompanion(current, fill) : current,
          ),
          messages: pushMessage(state.messages, {
            id: uid(),
            role: "table",
            text: `Лист «${companion.name}» заполнен по сцене. Проверьте цифры — редких вещей без повода в тексте быть не должно.`,
            at: Date.now(),
          }),
        }));
        return true;
      },
      sealPristineCompanions: () =>
        set((state) => {
          if (!state.companions.some((companion) => companion.pristine)) return state;
          return {
            companions: state.companions.map((companion) =>
              companion.pristine ? companionFromNpc(companion) : companion,
            ),
          };
        }),
      restart: (mode) =>
        set((state) => {
          const chronicle = state.chronicle + 1;
          if (mode === "all") {
            return {
              ...wiped(),
              chronicle,
              phase: "world",
              world: emptyWorld(),
              hero: emptyHero(),
              inventory: [],
              kit: [],
              hasKit: false,
              location: "",
            };
          }
          if (mode === "hero") {
            return {
              ...wiped(),
              chronicle,
              phase: "hero",
              hero: emptyHero(),
              inventory: [],
              kit: [],
              hasKit: false,
              location: "",
            };
          }
          return {
            ...wiped(),
            chronicle,
            phase: "play",
            inventory: state.hasKit ? copyItems(state.kit) : copyItems(state.inventory),
            location: state.world.place.trim(),
          };
        }),
    }),
    {
      name: "letopis-table-v1",
      version: 2,
      skipHydration: true,
      storage: createJSONStorage(() => safeStorage),
      migrate: (persisted) => migrateSave(persisted) as RpgState,
      partialize: (state) => ({
        phase: state.phase,
        settings: state.settings,
        world: state.world,
        hero: state.hero,
        inventory: state.inventory,
        kit: state.kit,
        hasKit: state.hasKit,
        nearby: state.nearby,
        memories: state.memories,
        companions: state.companions,
        messages: state.messages,
        location: state.location,
        conditions: state.conditions,
        pendingRoll: state.pendingRoll,
      }),
    },
  ),
);

function clamp(value: number): number {
  if (!Number.isFinite(value)) return 5;
  return Math.max(1, Math.min(10, Math.round(value)));
}

function copyItems(items: Item[]): Item[] {
  return items.map((item) => ({ ...item }));
}

function wiped() {
  return {
    messages: [] as Message[],
    nearby: [] as Npc[],
    memories: [] as Memory[],
    companions: [] as Companion[],
    conditions: [] as string[],
    pendingRoll: null as Roll | null,
    busy: false,
    banner: null as string | null,
  };
}

function companionFromNpc(npc: Npc): Companion {
  const draft = draftCompanion(npc);
  return {
    ...npc,
    age: npc.age || "",
    stats: draft.stats,
    skills: draft.skills.map((name) => ({ id: uid(), name })),
    inventory: draft.inventory.map((item) => ({
      id: uid(),
      name: item.name,
      qty: item.qty,
      consumable: item.consumable,
    })),
    wounds: draft.wounds,
    pristine: false,
  };
}

export function canStartHero(hero: Hero): boolean {
  return heroReady(hero.name, hero.appearance, hero.stats);
}
