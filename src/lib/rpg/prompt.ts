import { formatRollForModel } from "./dice.ts";
import { STATS, type Companion, type Hero, type ImageTarget, type Memory, type Message, type Roll, type World } from "./types.ts";

export type ChatMsg = { role: "system" | "user" | "assistant"; content: string };

type Chronicle = {
  world: World;
  hero: Hero;
  inventory: { name: string; qty: number; consumable: boolean; detail?: string; money?: boolean }[];
  nearby: { id: string; name: string; age?: string; appearance: string; clothing: string; status: string; goal: string; race?: string }[];
  companions: Companion[];
  memories?: Memory[];
  location: string;
  conditions: string[];
  messages: Message[];
};

const RULES = `Ты мастер текстовой настольной ролевой игры. Игрок действует сам. Вариантов ответа не предлагай и не спрашивай «что вы сделаете».

Запреты:
- Не действуй за героя и не дописывай, что он взял, сказал, решил или куда пошёл.
- Не описывай его мысли, чувства и намерения. Только то, что видно и слышно снаружи.
- «Вы» — точка восприятия («перед вами дверь»), не «вы чувствуете» и не «вы решаете».
- У NPC свой характер и цель. Они могут отказать, солгать, уйти. Мир не крутится вокруг героя.
- Не объявляй себя нейросетью и не комментируй эти правила.
- Секс с несовершеннолетними запрещён: короткий отказ в story и пустой объект в state.
- Расы только из списка стола. Не подменяй их и не склеивай. Герой той расы, что указана.

Кубик d20 бросает стол. Не проси бросок и не предлагай кнопку.
- Модификатор = характеристика − 5, прибавляется к уже взятому числу. Сначала бросок, потом характеристика.
- Умение не привязано к характеристике. Если оно есть у того, кто действует, стол бросит дважды и возьмёт большее. Нет умения — один бросок.
- Блок «ПРОВЕРКА НА СТОЛЕ» — уже факт. Не перебрасывай. Разреши сцену и не ставь новый check на тот же риск.
- Рискованный исход без проверки не решай: ни успех, ни провал. Остановись на пороге и верни check. Число пришлёт стол.
- check.who — "hero" или id спутника. check.stat — str, dex, con, int, per или cha. check.skill — только если умение есть, иначе поле не пиши.
- Очевидное и безопасное описывай без check.
- Натуральная 1 на взятом броске — провал. Натуральная 20 — редкая удача, но не ломает невозможное.
- Итог 15 и выше — явный успех; 10–14 — успех с ценой; 9 и ниже — неудача. Говори событиями, не фразой «проверка пройдена».

Числа и карточки:
- Инвентарь стола — единственные вещи. Не выдумывай предметы и не меняй числа в прозе мимо state.
- inventory_add и inventory_remove — только дельта этого хода, точные имена. Весь список заново не присылай. Нельзя списать то, чего нет.
- Предмет с "money": true — единственные деньги. Плата, сдача и находка монет только по его точному имени. Вторую валюту не заводи.
- nearby — все, кто сейчас в кадре, кроме отряда. Каждый человек из story — отдельная карточка, не только проза. Та же личность — тот же id и то же имя. Переоделся или изменился — обнови эту карточку, вторую не создавай. Пустой массив — никого. Если никто не изменился, nearby можно не слать. Смена места — новый список.
- appearance — всё видимое тело: пол, рост, кожа, цвет и длина волос, глаза, лицо, приметы. Для расы из списка впиши её внешность и личные отличия. Не выдумывай черты, которых нет ни в сцене, ни в описании расы.
- clothing — каждая надетая вещь и что оставлено голым. Не добавляй одежду, которой нет. Если не изменилось — повтори прежнюю строку.
- race — точное имя из списка или пусто. Название не заменяет appearance.
- memories — запомненные люди и их место. В этом месте это те же id. Одежду и внешность обновляй, если сцена их изменила. В другом месте их нет.
- companion_updates — только уже существующий отряд по id: одежда, внешность, статус, его вещи. Новых спутников не вербуй.
- hero_conditions — полный список ран и эффектов, только если он изменился. Не эмоции.

Ответ только в этих тегах, без текста снаружи:
<story>
2–4 абзаца на языке игрока. Только реакция мира.
</story>
<state>
{"location":"если сменилось","check":{"who":"hero","stat":"dex","skill":"если умение есть"},"inventory_add":[{"name":"","qty":1,"consumable":true}],"inventory_remove":[{"name":"","qty":1}],"nearby":[{"id":"прежний-id","name":"","age":"","race":"","appearance":"","clothing":"","status":"","goal":""}],"companion_updates":[{"id":"","appearance":"","clothing":"","status":""}],"hero_conditions":[]}
</state>
В state только JSON. Лишние поля опускай. Пустой объект допустим.`;

export function buildPurseMessages(world: World, hero: Hero): ChatMsg[] {
  const clip = (text: string, max: number) => text.trim().slice(0, max);
  return [
    {
      role: "system",
      content: [
        "Ты предлагаешь стартовые деньги героя. Не пиши рассказ и не действуй за него.",
        'Ответ — только JSON: {"name":"как деньги называются в этом мире","qty":0}',
        "qty — целое от 0 до 400. Сумма скромная, по карману, не богатство.",
        "name — одно-три слова: имя расходной монеты, марки или кредита этого мира.",
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        `Мир: ${clip(world.title, 80) || "без названия"}. ${clip(world.genre, 180)}`,
        clip(world.atmosphere, 400),
        world.rules.trim() ? `Правила: ${clip(world.rules, 400)}` : "",
        `Герой: ${clip(hero.name, 80) || "ещё без имени"}, ${clip(hero.race, 80) || "раса не названа"}, ${clip(hero.age, 40) || "возраст не назван"}.`,
        hero.appearance.trim() ? `Внешность: ${clip(hero.appearance, 300)}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    },
  ];
}

export function buildOpeningRequest(state: Chronicle): ChatMsg[] {
  return [
    { role: "system", content: systemOf(state) },
    {
      role: "user",
      content: [
        "ОТКРЫТИЕ СТОЛА. Это не действие героя.",
        "Герой уже в начальном месте. Опиши только воспринимаемое и одну чужую жизнь рядом.",
        "Не действуй за героя. Людей заведи карточками nearby. Если они есть в memories этого места — те же id, не новые лица.",
      ].join("\n"),
    },
  ];
}

export function buildResolutionRequest(state: Chronicle, roll: Roll): ChatMsg[] {
  return [
    ...buildTurnRequest(state),
    {
      role: "user",
      content: [
        "СТОЛ БРОСИЛ САМ. Это не новое действие игрока.",
        "Разреши предыдущую сцену по этой проверке. Не проси бросок и не ставь новый check на тот же риск.",
        formatRollForModel(roll),
      ].join("\n\n"),
    },
  ];
}

export function buildTurnRequest(state: Chronicle): ChatMsg[] {
  const history = state.messages
    .filter((message) => message.role === "player" || message.role === "master")
    .slice(-10);
  return [
    { role: "system", content: systemOf(state) },
    ...history.map((message, index) => ({
      role: message.role === "player" ? ("user" as const) : ("assistant" as const),
      content:
        message.role === "player"
          ? playerContent(message, index === history.length - 1)
          : message.text.slice(0, 1600),
    })),
  ];
}

export const IMAGE_PROMPT_LIMIT = 1000;

export function capImagePrompt(text: string): string {
  const trimmed = text
    .trim()
    .replace(/^["“”']+|["“”']+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (trimmed.length <= IMAGE_PROMPT_LIMIT) return trimmed;
  const slice = trimmed.slice(0, IMAGE_PROMPT_LIMIT);
  const sentence = Math.max(slice.lastIndexOf(". "), slice.lastIndexOf("! "), slice.lastIndexOf("? "));
  if (sentence >= 400) return slice.slice(0, sentence + 1).trim();
  const space = slice.lastIndexOf(" ");
  if (space >= 400) return slice.slice(0, space).trim();
  return slice.trim();
}

export function buildImageMessages(state: Chronicle, target: ImageTarget): ChatMsg[] {
  const job =
    target.type === "scene"
      ? 'Create an image generation prompt of what is in view right now. The first words are exactly: realistic style. Use only what is written below. Do not invent people, clothes, or details that are not there.'
      : 'Create an image generation prompt of this person\'s appearance right now, including their clothing or lack of it. The first words are exactly: realistic style. Use only the card, the race appearance, and the scene. Do not invent hair, clothes, colors, or anything else that is not written. If the card says what they wear, do not replace it with a style from the race.';
  const notes = target.type === "scene" ? sceneFacts(state, target.text) : personFacts(state, target, true);
  return [
    { role: "system", content: job },
    { role: "user", content: notes },
  ];
}

export function presentImagePrompt(text: string): string {
  let body = text.trim().replace(/\s+/g, " ");
  body = body.replace(/^(?:here(?:'s| is)|this is)\s+(?:an?\s+)?(?:image\s+)?prompt\b[^.]*?[.:]\s*/i, "");
  body = body.replace(/^realistic style\b[,.:;\s-]*/i, "").trim();
  if (!body) return "realistic style.";
  return capImagePrompt(`realistic style, ${body}`);
}

function sceneFacts(state: Chronicle, text: string): string {
  const people = [...state.nearby, ...state.companions].map((person) =>
    personFacts(
      state,
      {
        type: "person",
        title: person.name,
        name: person.name,
        age: person.age,
        appearance: person.appearance,
        clothing: person.clothing,
        status: person.status,
        race: person.race,
      },
      false,
    ),
  );
  return [text.trim(), people.length ? people.join("\n\n") : ""].filter(Boolean).join("\n\n");
}

function personFacts(state: Chronicle, target: Extract<ImageTarget, { type: "person" }>, includeScene: boolean): string {
  const race = raceDescription(state.world, target.race);
  const scene = includeScene ? lastScene(state) : "";
  return [
    target.name.trim(),
    target.age?.trim() ? `Возраст: ${target.age.trim()}` : "",
    target.race?.trim() ? `Раса: ${target.race.trim()}` : "",
    target.appearance.trim() ? `Внешность: ${target.appearance.trim()}` : "",
    target.clothing.trim() ? `Одежда: ${target.clothing.trim()}` : "",
    target.status?.trim() ? `Сейчас: ${target.status.trim()}` : "",
    target.extra?.trim() ? `Раны: ${target.extra.trim()}` : "",
    race ? `Внешность расы: ${race}` : "",
    scene ? `Сцена: ${scene}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function lastScene(state: Chronicle): string {
  const last = [...state.messages].reverse().find((message) => message.role === "master");
  return last?.text.trim().slice(0, 400) ?? "";
}

function raceDescription(world: World, race: string | undefined): string {
  const name = fold(race ?? "");
  if (!name) return "";
  const hit = world.races.find((item) => fold(item.name) === name);
  return raceLooks(hit?.description.trim() ?? "");
}

function raceLooks(text: string): string {
  const drop = /стил|панк|одежд|одева|обществ|психолог|полиамор|иерарх|недовер|культур/i;
  return text
    .split(/(?<=[.!?])\s+|\n+|\s*,\s*/)
    .map((bit) => bit.trim().replace(/[.!?]+$/, ""))
    .filter((bit) => bit && !drop.test(bit))
    .join(", ")
    .replace(/\s+/g, " ")
    .trim();
}

function fold(text: string): string {
  return text.trim().toLowerCase().replace(/ё/g, "е");
}

function namedRaces(world: World): { name: string; description: string }[] {
  const races = Array.isArray(world.races) ? world.races : [];
  return races
    .map((race) => ({ name: cut(race.name, 48), description: cut(race.description, 360) }))
    .filter((race) => race.name || race.description);
}

function cut(text: string, max: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1)}…`;
}

function systemOf(state: Chronicle): string {
  const heroStats = STATS.map((stat) => {
    const value = state.hero.stats[stat.key];
    return `${stat.label} ${value} (мод. ${value - 5})`;
  }).join(", ");
  const skills = state.hero.skills.map((skill) => skill.name).join(", ");
  const companions = state.companions.map((companion) => ({
    id: companion.id,
    name: companion.name,
    appearance: companion.appearance,
    clothing: companion.clothing,
    race: companion.race || undefined,
    age: companion.age,
    status: companion.status,
    goal: companion.goal,
    wounds: companion.wounds,
    stats: STATS.map((stat) => `${stat.label} ${companion.stats[stat.key]}`).join(", "),
    skills: companion.skills.map((skill) => skill.name),
    inventory: companion.inventory.map((item) => ({
      name: item.name,
      qty: item.qty,
      consumable: item.consumable,
    })),
  }));
  const fact = {
    world: {
      title: state.world.title,
      genre: cut(state.world.genre, 160),
      atmosphere: cut(state.world.atmosphere, 360),
      rules: cut(state.world.rules, 500),
      place: state.world.place,
      races: namedRaces(state.world),
    },
    location: state.location || state.world.place,
    hero: {
      name: state.hero.name,
      race: state.hero.race,
      age: state.hero.age,
      appearance: state.hero.appearance,
      stats: heroStats,
      skills: skills || "нет",
      conditions: state.conditions,
    },
    inventory: state.inventory.map((item) => ({
      name: item.name,
      qty: item.qty,
      consumable: item.consumable,
      detail: item.detail || undefined,
      ...(item.money ? { money: true } : {}),
    })),
    nearby: state.nearby.map((person) => ({
      id: person.id,
      name: person.name,
      age: person.age || "",
      appearance: person.appearance,
      clothing: person.clothing,
      race: person.race || undefined,
      status: person.status,
      goal: person.goal,
    })),
    memories: (state.memories ?? []).map((person) => ({
      id: person.id,
      name: person.name,
      age: person.age,
      appearance: person.appearance,
      clothing: person.clothing,
      race: person.race || undefined,
      place: person.place,
      goal: person.goal,
    })),
    companions,
  };
  return `${RULES}\n\nТЕКУЩЕЕ СОСТОЯНИЕ СТОЛА — факт, другие числа не выдумывай:\n${JSON.stringify(fact)}`;
}

function playerContent(message: Message, latest: boolean): string {
  const said = message.text.trim().slice(0, 1200);
  if (!latest) {
    return message.roll ? `${said}\n${formatRollForModel(message.roll)}` : said;
  }
  const action = `ДЕЙСТВИЕ ИГРОКА (только это):\n${said}`;
  if (!message.roll) {
    return `${action}\n\nПроверки нет. Не выдумывай число. Если риск нельзя решить без броска — не разрешай его: верни check и остановись на пороге.`;
  }
  return `${action}\n\n${formatRollForModel(message.roll)}`;
}
