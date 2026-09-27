import { STAT_BUDGET, STATS, statLabel, type CheckAsk, type Roll, type Skill, type StatKey, type Stats } from "./types.ts";

export function clampStat(value: number): number {
  if (!Number.isFinite(value)) return 5;
  return Math.max(1, Math.min(10, Math.round(value)));
}

export function modifier(stat: number): number {
  return stat - 5;
}

export function formatSigned(n: number): string {
  if (n > 0) return `+${n}`;
  return String(n);
}

export function statSum(stats: Stats): number {
  return STATS.reduce((sum, stat) => sum + (stats[stat.key] ?? 0), 0);
}

export function heroReady(name: string, appearance: string, stats: Stats): boolean {
  const sum = statSum(stats);
  return name.trim().length > 0 && appearance.trim().length > 0 && sum >= STATS.length && sum <= STAT_BUDGET;
}

export function formulaLine(label: string, value: number): string {
  return `${label} ${value} − 5 = ${formatSigned(modifier(value))}`;
}

function sameName(a: string, b: string): boolean {
  return a.trim().toLowerCase().replace(/ё/g, "е") === b.trim().toLowerCase().replace(/ё/g, "е");
}

export function castCheck(
  check: CheckAsk,
  hero: { name: string; stats: Stats; skills: Skill[] },
  companions: { id: string; name: string; stats: Stats; skills: Skill[] }[],
): Roll {
  const who = check.who.trim();
  const companion = companions.find(
    (item) => item.id === who || sameName(item.name, who),
  );
  const actor =
    !who || who === "hero" || sameName(hero.name, who) || !companion
      ? { id: "hero", name: hero.name || "Герой", stats: hero.stats, skills: hero.skills }
      : companion;
  const named = check.skill?.trim();
  const owned = named ? actor.skills.find((skill) => sameName(skill.name, named)) : undefined;
  return rollD20({
    actorId: actor.id,
    actorName: actor.name,
    stat: check.stat,
    statValue: actor.stats[check.stat],
    skill: owned?.name,
    advantage: Boolean(owned),
  });
}

function face(): number {
  return 1 + Math.floor(Math.random() * 20);
}

export function rollD20(input: {
  actorId: string;
  actorName: string;
  stat: StatKey;
  statValue: number;
  skill?: string;
  advantage?: boolean;
}): Roll {
  const first = face();
  const second = input.advantage ? face() : undefined;
  const faces = second === undefined ? [first] : [first, second];
  const natural = second === undefined ? first : Math.max(first, second);
  const mod = modifier(input.statValue);
  const skill = input.skill?.trim();
  return {
    actorId: input.actorId,
    actorName: input.actorName,
    stat: input.stat,
    statLabel: statLabel(input.stat),
    statValue: input.statValue,
    modifier: mod,
    natural,
    faces,
    advantage: Boolean(input.advantage),
    total: natural + mod,
    skill: skill ? skill : undefined,
  };
}

export function rollTone(roll: Roll): "ok" | "bad" | "mid" {
  if (roll.natural === 1) return "bad";
  if (roll.natural === 20) return "ok";
  if (roll.total >= 15) return "ok";
  if (roll.total <= 9) return "bad";
  return "mid";
}

export function rollFaces(roll: Roll): number[] {
  return roll.faces && roll.faces.length > 0 ? roll.faces : [roll.natural];
}

export function dicePhrase(roll: Roll): string {
  const faces = rollFaces(roll);
  if (roll.advantage && faces.length >= 2) {
    return `броски ${faces[0]} и ${faces[1]}, взято ${roll.natural}`;
  }
  return `d20 ${roll.natural}`;
}

export function rollSummary(roll: Roll): string {
  const skill = roll.skill ? `${roll.skill} · ` : "";
  const crit = roll.natural === 1 ? " · натуральная 1" : roll.natural === 20 ? " · натуральная 20" : "";
  return `${roll.actorName} · ${skill}${roll.statLabel} ${roll.statValue} · ${dicePhrase(roll)} · мод. ${formatSigned(roll.modifier)} · итог ${roll.total}${crit}`;
}

export function formatRollForModel(roll: Roll): string {
  const faces = rollFaces(roll);
  const skill = roll.skill
    ? roll.advantage
      ? `Умение: ${roll.skill}. Оно есть, поэтому d20 брошен дважды, взято большее. К характеристике умение не привязано.`
      : `Проверка названа «${roll.skill}», преимущества не было.`
    : "Умение не заявлено — один бросок.";
  const thrown =
    roll.advantage && faces.length >= 2
      ? `Броски: ${faces[0]} и ${faces[1]}. Взято большее: ${roll.natural}.`
      : `Бросок: ${roll.natural}.`;
  const natural =
    roll.natural === 1
      ? "На взятом броске натуральная 1 — провал, даже если итог выглядит терпимым."
      : roll.natural === 20
        ? "На взятом броске натуральная 20 — редкая удача. Не ломает невозможное, но даёт сильный перевес."
        : `Взятое значение: ${roll.natural}.`;
  return [
    "ПРОВЕРКА НА СТОЛЕ (уже брошена, число не подменяй и не перебрасывай):",
    `Кто: ${roll.actorName}`,
    skill,
    `Характеристика выбрана отдельно: ${roll.statLabel} ${roll.statValue}`,
    `Модификатор считается после броска: ${roll.statValue} − 5 = ${formatSigned(roll.modifier)}`,
    thrown,
    `Итог = ${roll.natural} + (${formatSigned(roll.modifier)}) = ${roll.total}`,
    natural,
  ]
    .filter(Boolean)
    .join("\n");
}
