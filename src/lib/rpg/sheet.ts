import type { Npc, Stats } from "./types.ts";

export type DraftGear = { name: string; qty: number; consumable: boolean };

export type CompanionDraft = {
  stats: Stats;
  skills: string[];
  inventory: DraftGear[];
  wounds: string;
};

const STAT_KEYS = ["str", "dex", "con", "int", "per", "cha"] as const;

function blobOf(npc: Pick<Npc, "name" | "age" | "appearance" | "clothing" | "status" | "goal">): string {
  return [npc.name, npc.age, npc.appearance, npc.clothing, npc.status, npc.goal]
    .join(" ")
    .toLowerCase()
    .replace(/ё/g, "е");
}

function yearsOf(age: string): number | null {
  const match = age.match(/\d{1,3}/);
  if (!match) return null;
  const years = Number(match[0]);
  if (!Number.isFinite(years) || years > 130) return null;
  return years;
}

type Kind = "child" | "teen" | "adult" | "elder";

function kindOf(blob: string, years: number | null): Kind {
  const childWord = /девочк|мальчик|ребен|дитя|малыш|маленьк|дети|детск|пацан|девчон/.test(blob);
  const teenWord = /подрост|юнош|девушк/.test(blob);
  const elderWord = /старик|старух|древн|седин|седой|седые|почтенн/.test(blob);
  if (years !== null && years < 13) return "child";
  if (years !== null && years >= 60) return "elder";
  if (childWord && (years === null || years < 16)) return "child";
  if (elderWord && (years === null || years >= 50)) return "elder";
  if (years !== null && years < 18) return "teen";
  if (teenWord && (years === null || years < 22)) return "teen";
  return "adult";
}

function baseStats(kind: Kind): Stats {
  if (kind === "child") return { str: 2, dex: 6, con: 3, int: 4, per: 5, cha: 6 };
  if (kind === "teen") return { str: 4, dex: 6, con: 4, int: 5, per: 5, cha: 5 };
  if (kind === "elder") return { str: 3, dex: 3, con: 3, int: 6, per: 6, cha: 4 };
  return { str: 5, dex: 5, con: 5, int: 5, per: 5, cha: 5 };
}

function clampStat(value: number, lo = 1, hi = 10): number {
  return Math.max(lo, Math.min(hi, Math.round(value)));
}

function tunedStats(kind: Kind, blob: string): Stats {
  const stats = baseStats(kind);
  const scarred = /шрам|изурод|крив|гнилы\w*\s+зуб|беззуб|ожог|ряб/.test(blob);
  if (scarred) stats.cha -= 3;
  if (/красив|миловид|приятн/.test(blob)) stats.cha += 2;
  if (/здоров|широкоплеч|силач|мышц|крепк|огромн|могуч/.test(blob)) {
    stats.str += 3;
    stats.con += 1;
  }
  if (/худ|тощ|хил|хрупк|изможд/.test(blob)) {
    stats.str -= 2;
    stats.con -= 2;
  }
  if (/хром|калек|костыл/.test(blob)) {
    stats.dex -= 2;
    stats.str -= 1;
  }
  if (/слеп|незряч/.test(blob)) stats.per = 1;
  if (kind !== "child" && /страж|охран|солдат|воин|наемн|дружин/.test(blob)) {
    stats.str += 1;
    stats.con += 1;
  }
  if (/торгов|купц|лавоч|менял/.test(blob)) {
    stats.cha += 1;
    stats.int += 1;
  }
  for (const key of STAT_KEYS) stats[key] = clampStat(stats[key]);
  if (kind === "child") {
    stats.str = Math.min(stats.str, 4);
    stats.con = Math.min(stats.con, 5);
  }
  if (kind === "elder") {
    stats.str = Math.min(stats.str, 5);
    stats.dex = Math.min(stats.dex, 5);
    stats.con = Math.min(stats.con, 5);
  }
  if (scarred) stats.cha = Math.min(stats.cha, kind === "elder" ? 3 : 4);
  return stats;
}

function gearOf(kind: Kind, blob: string): { skills: string[]; inventory: DraftGear[] } {
  const skills: string[] = [];
  const inventory: DraftGear[] = [];
  const addSkill = (name: string) => {
    if (!skills.includes(name)) skills.push(name);
  };
  const addItem = (name: string, qty: number, consumable: boolean) => {
    if (inventory.some((item) => item.name === name)) return;
    inventory.push({ name, qty, consumable });
  };

  if (kind === "child") {
    addItem("Гладкий камешек", 1, false);
    if (/лент|бант|кукл/.test(blob)) addItem("Выцветшая лента", 1, false);
    return { skills, inventory };
  }

  if (/страж|охран|солдат|воин|наемн|дружин/.test(blob)) {
    addSkill("Стража");
    addItem("Дубинка", 1, false);
  } else if (/торгов|купц|лавоч|менял/.test(blob)) {
    addSkill("Торг");
    addItem("Мелочь", 12, true);
  } else if (/официант|подаваль|трактир|бармен/.test(blob)) {
    addItem("Тряпица", 1, false);
  } else if (/писц|учен|книг|жрец/.test(blob)) {
    addSkill("Грамота");
    addItem("Потёртая книжка", 1, false);
  } else if (kind === "elder") {
    addItem("Трость", 1, false);
  } else {
    addItem("Мелочь", 4, true);
  }

  if (kind === "elder" && !inventory.some((item) => item.name === "Трость" || item.name === "Дубинка")) {
    addItem("Трость", 1, false);
  }
  if (/кошель|монет|мелоч/.test(blob)) addItem("Мелочь", 6, true);
  return { skills: skills.slice(0, 3), inventory: inventory.slice(0, 4) };
}

function woundsOf(blob: string): string {
  const lines: string[] = [];
  if (/шрам/.test(blob)) lines.push("Старые шрамы.");
  if (/ожог/.test(blob)) lines.push("Следы ожога.");
  if (/хром|калек|костыл/.test(blob)) lines.push("Хромает.");
  if (/слеп|незряч/.test(blob)) lines.push("Не видит.");
  if (/беззуб|гнилы\w*\s+зуб/.test(blob)) lines.push("Плохие зубы.");
  return lines.join(" ");
}

export function draftCompanion(
  npc: Pick<Npc, "name" | "age" | "appearance" | "clothing" | "status" | "goal">,
): CompanionDraft {
  const blob = blobOf(npc);
  const kind = kindOf(blob, yearsOf(npc.age));
  const packed = gearOf(kind, blob);
  return {
    stats: tunedStats(kind, blob),
    skills: packed.skills,
    inventory: packed.inventory,
    wounds: woundsOf(blob),
  };
}
