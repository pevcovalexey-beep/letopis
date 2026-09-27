import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { castCheck, heroReady, modifier, rollD20 } from "./dice.ts";
import { migrateSave } from "./migrate.ts";
import { applyMasterPatch, applyMemory } from "./patch.ts";
import { parseMasterReply, parsePurse, parseSheet, readCheck } from "./parse.ts";
import { buildImageMessages, buildPurseMessages, capImagePrompt, IMAGE_PROMPT_LIMIT, presentImagePrompt } from "./prompt.ts";
import { draftCompanion } from "./sheet.ts";
import { defaultStats, emptyHero, emptyWorld, type Companion, type TableSnapshot } from "./types.ts";

function snap(partial: Partial<TableSnapshot> = {}): TableSnapshot {
  return {
    inventory: [],
    nearby: [],
    companions: [],
    location: "",
    conditions: [],
    ...partial,
  };
}

describe("dice", () => {
  it("uses stat minus 5", () => {
    assert.equal(modifier(8), 3);
    assert.equal(modifier(5), 0);
    assert.equal(modifier(1), -4);
  });

  it("keeps the formula on every face", () => {
    for (let i = 0; i < 40; i += 1) {
      const roll = rollD20({
        actorId: "hero",
        actorName: "Ирис",
        stat: "dex",
        statValue: 8,
        skill: "взлом",
      });
      assert.ok(roll.natural >= 1 && roll.natural <= 20);
      assert.equal(roll.faces.length, 1);
      assert.equal(roll.advantage, false);
      assert.equal(roll.modifier, 3);
      assert.equal(roll.total, roll.natural + 3);
    }
  });

  it("keeps the higher face when a skill is used, then adds the modifier", () => {
    for (let i = 0; i < 40; i += 1) {
      const roll = rollD20({
        actorId: "hero",
        actorName: "Ирис",
        stat: "per",
        statValue: 7,
        skill: "Ориентирование",
        advantage: true,
      });
      assert.equal(roll.faces.length, 2);
      assert.equal(roll.advantage, true);
      assert.equal(roll.natural, Math.max(roll.faces[0] ?? 0, roll.faces[1] ?? 0));
      assert.equal(roll.modifier, 2);
      assert.equal(roll.total, roll.natural + roll.modifier);
    }
  });

  it("rolls twice only when the actor owns the named skill", () => {
    const hero = { name: "Ирис", stats: defaultStats(), skills: [{ id: "1", name: "Торг" }] };
    const skilled = castCheck({ who: "hero", stat: "cha", skill: "Торг" }, hero, []);
    assert.equal(skilled.advantage, true);
    assert.equal(skilled.faces.length, 2);
    assert.equal(skilled.natural, Math.max(...skilled.faces));
    const plain = castCheck({ who: "hero", stat: "dex", skill: "Взлом" }, hero, []);
    assert.equal(plain.advantage, false);
    assert.equal(plain.faces.length, 1);
    assert.equal(plain.skill, undefined);
  });

  it("allows any stat total from 6 through 35", () => {
    assert.equal(heroReady("Ирис", "плащ", defaultStats()), true);
    assert.equal(heroReady("Ирис", "плащ", { str: 1, dex: 1, con: 1, int: 1, per: 1, cha: 1 }), true);
    assert.equal(heroReady("Ирис", "плащ", { str: 10, dex: 5, con: 5, int: 5, per: 5, cha: 5 }), true);
    assert.equal(heroReady("Ирис", "плащ", { str: 10, dex: 10, con: 5, int: 5, per: 5, cha: 5 }), false);
    assert.equal(heroReady("", "плащ", defaultStats()), false);
  });
});

describe("migrateSave", () => {
  it("splits a legacy race paragraph and drops skill stats", () => {
    const next = migrateSave({
      settings: { apiKey: "sk-or-test", model: "demo" },
      world: { races: "Люди и соляные." },
      hero: { skills: [{ id: "s1", name: "Торг", stat: "cha" }] },
      companions: [{ skills: [{ name: "След", stat: "per" }] }],
      pendingRoll: { natural: 12 },
    }) as {
      settings: { provider: string };
      world: { races: { name: string; description: string }[] };
      hero: { skills: { name: string; stat?: string }[] };
      companions: { skills: { stat?: string }[] }[];
      pendingRoll: { faces: number[]; advantage: boolean };
    };
    assert.equal(next.settings.provider, "openrouter");
    assert.equal(next.world.races[0]?.description, "Люди и соляные.");
    assert.equal(next.hero.skills[0]?.name, "Торг");
    assert.equal(next.hero.skills[0]?.stat, undefined);
    assert.equal(next.companions[0]?.skills[0]?.stat, undefined);
    assert.deepEqual(next.pendingRoll.faces, [12]);
    assert.equal(next.pendingRoll.advantage, false);
  });
});

describe("parseSheet", () => {
  it("keeps skill names without a bound stat", () => {
    const fill = parseSheet('{"skills":["Взлом",{"name":"Торг","stat":"cha"}]}');
    assert.deepEqual(fill?.skills, [{ name: "Взлом" }, { name: "Торг" }]);
  });
});

describe("parseMasterReply", () => {
  it("splits story and state", () => {
    const parsed = parseMasterReply(`<story>Туман.</story>\n<state>{"location":"Доки"}</state>`);
    assert.equal(parsed.story, "Туман.");
    assert.deepEqual(parsed.patch, { location: "Доки" });
  });

  it("keeps the story when state is broken", () => {
    const parsed = parseMasterReply("<story>Туман.</story><state>{</state>");
    assert.equal(parsed.story, "Туман.");
    assert.equal(parsed.patch, null);
    assert.ok(parsed.warn);
  });

  it("reads a check the table will roll itself", () => {
    const parsed = parseMasterReply(
      `<story>Замок щёлкает.</story><state>{"check":{"who":"hero","stat":"dex","skill":"Взлом"}}</state>`,
    );
    assert.deepEqual(parsed.check, { who: "hero", stat: "dex", skill: "Взлом" });
    assert.equal(readCheck({ check: { stat: "luck" } }), null);
    assert.deepEqual(readCheck({ check: { stat: "str" } }), { who: "hero", stat: "str", skill: undefined });
  });

  it("salvages a trailing state object", () => {
    const parsed = parseMasterReply('На пирсе тихо.\n{"location":"Пирс"}');
    assert.match(parsed.story, /пирсе/);
    assert.deepEqual(parsed.patch, { location: "Пирс" });
  });

  it("accepts the formats other models actually send", () => {
    const fenced = parseMasterReply("<story>Туман.</story>\n<state>\n```json\n{\"location\":\"Доки\",}\n```\n</state>");
    assert.equal(fenced.story, "Туман.");
    assert.deepEqual(fenced.patch, { location: "Доки" });

    const unclosed = parseMasterReply("<think>план</think><story>Дождь.\n<state>{\"check\":{\"stat\":\"ловкость\"}}</state>");
    assert.equal(unclosed.story, "Дождь.");
    assert.deepEqual(unclosed.check, { who: "hero", stat: "dex", skill: undefined });

    const quoted = parseMasterReply("<story>Тихо.</story><state>{\"hero_conditions\":[“мокрый”],}</state>");
    assert.deepEqual(quoted.patch, { hero_conditions: ["мокрый"] });
  });
});

describe("applyMasterPatch", () => {
  it("stacks, spends, and refuses missing items", () => {
    const added = applyMasterPatch(snap(), {
      inventory_add: [{ name: "Стрелы", qty: 10, consumable: true }],
    });
    assert.equal(added.next.inventory[0]?.qty, 10);
    const more = applyMasterPatch(added.next, {
      inventory_add: [{ name: "стрелы", qty: 2, consumable: true }],
    });
    assert.equal(more.next.inventory.length, 1);
    assert.equal(more.next.inventory[0]?.qty, 12);
    const spent = applyMasterPatch(more.next, { inventory_remove: [{ name: "Стрелы", qty: 3 }] });
    assert.equal(spent.next.inventory[0]?.qty, 9);
    const emptied = applyMasterPatch(spent.next, { inventory_remove: [{ name: "Стрелы", qty: 100 }] });
    assert.equal(emptied.next.inventory.length, 0);
    assert.match(emptied.ledger.join(" "), /Больше не было/);
    const missing = applyMasterPatch(emptied.next, { inventory_remove: [{ name: "Корона", qty: 1 }] });
    assert.equal(missing.next.inventory.length, 0);
    assert.match(missing.ledger.join(" "), /отклонено/);
    const aliased = applyMasterPatch(snap(), {
      добавить: [{ name: "Свеча", qty: 1, consumable: true }],
    });
    assert.equal(aliased.next.inventory[0]?.name, "Свеча");
  });

  it("does not mutate the previous inventory", () => {
    const inventory = [{ id: "1", name: "Монета", qty: 5, consumable: true }];
    applyMasterPatch(snap({ inventory }), { inventory_remove: [{ name: "Монета", qty: 1 }] });
    assert.equal(inventory[0]?.qty, 5);
  });

  it("drops party members from the nearby list", () => {
    const companion: Companion = {
      id: "anya",
      name: "Аня",
      appearance: "",
      clothing: "",
      status: "",
      goal: "",
      age: "",
      stats: defaultStats(),
      skills: [],
      inventory: [],
      wounds: "",
      pristine: true,
    };
    const applied = applyMasterPatch(snap({ companions: [companion] }), {
      nearby: [
        { id: "anya", name: "Аня", appearance: "", clothing: "", status: "молчит", goal: "" },
        { id: "guard", name: "Страж", appearance: "высокий", clothing: "кольчуга", status: "стоит", goal: "смена" },
      ],
    });
    assert.deepEqual(
      applied.next.nearby.map((npc) => npc.name),
      ["Страж"],
    );
  });

  it("spends a companion item without touching the hero pack", () => {
    const companion: Companion = {
      id: "anya",
      name: "Аня",
      appearance: "",
      clothing: "",
      status: "",
      goal: "",
      age: "",
      stats: defaultStats(),
      skills: [],
      inventory: [{ id: "a", name: "Факел", qty: 2, consumable: true }],
      wounds: "",
      pristine: false,
    };
    const applied = applyMasterPatch(
      snap({
        companions: [companion],
        inventory: [{ id: "h", name: "Факел", qty: 1, consumable: true }],
      }),
      { companion_updates: [{ id: "anya", inventory_remove: [{ name: "Факел", qty: 1 }] }] },
    );
    assert.equal(applied.next.inventory[0]?.qty, 1);
    assert.equal(applied.next.companions[0]?.inventory[0]?.qty, 1);
  });

  it("reads people under a russian key with age and looks", () => {
    const applied = applyMasterPatch(snap(), {
      люди: [{ имя: "Марта", возраст: 22, внешность: "рыжая чёлка", одежда: "фартук", статус: "несёт поднос", цель: "дотянуть смену" }],
    });
    const marta = applied.next.nearby[0];
    assert.equal(marta?.name, "Марта");
    assert.equal(marta?.age, "22");
    assert.equal(marta?.appearance, "рыжая чёлка");
    assert.equal(marta?.clothing, "фартук");
  });

  it("clears the crowd when the place changes and nobody new is listed", () => {
    const applied = applyMasterPatch(
      snap({
        location: "Таверна «Якорь»",
        nearby: [{ id: "m", name: "Марта", age: "22", appearance: "рыжая", clothing: "", status: "", goal: "" }],
      }),
      { location: "Ночная улица за рынком" },
    );
    assert.equal(applied.next.location, "Ночная улица за рынком");
    assert.equal(applied.next.nearby.length, 0);
  });

  it("brings a remembered person back to their place and keeps the face", () => {
    const memory = {
      id: "m",
      name: "Марта",
      age: "22",
      appearance: "рыжая чёлка",
      clothing: "фартук",
      status: "несёт поднос",
      goal: "смена",
      place: "Таверна «Якорь»",
    };
    const back = applyMemory([], [memory], "Таверна «Якорь», вечер", []);
    assert.equal(back[0]?.name, "Марта");
    assert.equal(back[0]?.appearance, "рыжая чёлка");
    const locked = applyMemory(
      [{ id: "other", name: "Марта", age: "40", appearance: "другая женщина", clothing: "плащ", status: "молчит", goal: "" }],
      [memory],
      "Таверна «Якорь»",
      [],
    );
    assert.equal(locked.length, 1);
    assert.equal(locked[0]?.id, "m");
    assert.equal(locked[0]?.age, "22");
    assert.equal(locked[0]?.appearance, "другая женщина");
    assert.equal(locked[0]?.clothing, "плащ");
    assert.equal(locked[0]?.status, "молчит");
    const away = applyMemory([], [memory], "Портовые доки", []);
    assert.equal(away.length, 0);
  });

  it("updates the same person when they change clothes", () => {
    const applied = applyMasterPatch(
      snap({
        nearby: [
          {
            id: "wait",
            name: "Официантка",
            age: "23",
            appearance: "миниатюрная, зелёные глаза",
            clothing: "фартук",
            status: "стоит",
            goal: "работа",
          },
        ],
      }),
      {
        nearby: [
          {
            id: "new-id",
            name: "Официантка",
            age: "23",
            appearance: "миниатюрная, зелёные глаза",
            clothing: "чулки, обувь",
            status: "разносит заказы",
            goal: "работа",
          },
        ],
      },
    );
    assert.equal(applied.next.nearby.length, 1);
    assert.equal(applied.next.nearby[0]?.id, "wait");
    assert.equal(applied.next.nearby[0]?.clothing, "чулки, обувь");
  });

  it("keeps a spent purse so the currency name stays", () => {
    const spent = applyMasterPatch(
      snap({ inventory: [{ id: "m", name: "Медяки", qty: 3, consumable: true, money: true }] }),
      { inventory_remove: [{ name: "медяки", qty: 10 }] },
    );
    assert.equal(spent.next.inventory.length, 1);
    assert.equal(spent.next.inventory[0]?.qty, 0);
    assert.equal(spent.next.inventory[0]?.money, true);
    const paid = applyMasterPatch(spent.next, { inventory_add: [{ name: "Медяки", qty: 5, consumable: true }] });
    assert.equal(paid.next.inventory.length, 1);
    assert.equal(paid.next.inventory[0]?.qty, 5);
    assert.equal(paid.next.inventory[0]?.money, true);
  });
});

function person(partial: { name: string; age?: string; appearance?: string; clothing?: string; status?: string; goal?: string }) {
  return {
    name: partial.name,
    age: partial.age ?? "",
    appearance: partial.appearance ?? "",
    clothing: partial.clothing ?? "",
    status: partial.status ?? "",
    goal: partial.goal ?? "",
  };
}

describe("draftCompanion", () => {
  it("keeps a little girl weak and unarmed", () => {
    const girl = draftCompanion(
      person({
        name: "Лиза",
        age: "8",
        appearance: "маленькая девочка, рыжая",
        status: "страж с ножом и дубинкой",
      }),
    );
    assert.ok(girl.stats.str <= 4);
    assert.ok(girl.stats.con <= 5);
    const bag = girl.inventory.map((item) => item.name.toLowerCase()).join(" ");
    assert.doesNotMatch(bag, /меч|дубин|нож/);
  });

  it("gives a scarred old man low charm and little strength", () => {
    const elder = draftCompanion(
      person({
        name: "Горн",
        age: "70",
        appearance: "шрамированный старик, кривой рот",
        clothing: "рваный плащ",
      }),
    );
    assert.ok(elder.stats.cha <= 3);
    assert.ok(elder.stats.str <= 5);
    assert.match(elder.wounds, /шрам/i);
    assert.ok(elder.inventory.some((item) => item.name === "Трость"));
  });

  it("reads old age from the word, not only from a number", () => {
    const elder = draftCompanion(person({ name: "Игнат", appearance: "старик со шрамом через щеку" }));
    assert.ok(elder.stats.cha <= 3);
    assert.ok(elder.stats.str <= 5);
  });

  it("makes a broad-shouldered guard actually strong", () => {
    const guard = draftCompanion(
      person({
        name: "Брен",
        age: "34",
        appearance: "широкоплечий стражник",
        clothing: "кольчуга",
        status: "сторожит ворота",
      }),
    );
    assert.ok(guard.stats.str >= 7);
    assert.ok(guard.skills.includes("Стража"));
    assert.ok(guard.inventory.some((item) => item.name === "Дубинка"));
    assert.ok(!guard.inventory.some((item) => /меч|нож/.test(item.name.toLowerCase())));
  });

  it("gives a waitress a cloth, not a weapon", () => {
    const marta = draftCompanion(
      person({
        name: "Марта",
        age: "22",
        appearance: "рыжая чёлка",
        clothing: "фартук",
        status: "официантка несёт поднос",
      }),
    );
    assert.ok(marta.inventory.some((item) => item.name === "Тряпица"));
    assert.ok(!marta.inventory.some((item) => /меч|дубин|нож/.test(item.name.toLowerCase())));
    assert.ok(marta.stats.str <= 6);
  });
});

describe("purse", () => {
  it("reads the master's suggested coins", () => {
    const purse = parsePurse('Стартовые деньги: {"name":"Медяки","qty":18}');
    assert.equal(purse?.name, "Медяки");
    assert.equal(purse?.qty, 18);
    assert.equal(parsePurse('{"qty":5}'), null);
    assert.equal(parsePurse('{"name":"Кроны","qty":99999}')?.qty, 9999);
  });

  it("asks for a modest consumable sum", () => {
    const messages = buildPurseMessages(
      { ...emptyWorld(), genre: "город", atmosphere: "туман" },
      { ...emptyHero(), name: "Ирис" },
    );
    assert.match(messages[0]?.content ?? "", /скромная/);
    assert.match(messages[0]?.content ?? "", /"qty"/);
  });
});

describe("image prompts", () => {
  it("asks for what is in view and nothing invented", () => {
    const messages = buildImageMessages(
      {
        world: { ...emptyWorld(), atmosphere: "туман над доками", genre: "город" },
        hero: emptyHero(),
        inventory: [],
        nearby: [],
        companions: [],
        location: "Доки",
        conditions: [],
        messages: [],
      },
      { type: "scene", title: "Сцена", text: "Ночной причал." },
    );
    assert.equal(messages.length, 2);
    assert.match(messages[0]?.content ?? "", /realistic style/);
    assert.match(messages[0]?.content ?? "", /Do not invent/);
    assert.match(messages[1]?.content ?? "", /Ночной причал/);
    assert.doesNotMatch(messages[1]?.content ?? "", /туман над доками/);
  });

  it("sends the card, the race appearance, and the scene, not a clothing style", () => {
    const messages = buildImageMessages(
      {
        world: {
          ...emptyWorld(),
          races: [
            {
              id: "k",
              name: "Криг",
              description: "Загорелая кожа, острые уши. Предпочитают панковский стиль одежды.",
            },
          ],
        },
        hero: emptyHero(),
        inventory: [],
        nearby: [],
        companions: [],
        location: "",
        conditions: [],
        messages: [{ id: "m", role: "master", text: "Она лежит на пляже.", at: 1 }],
      },
      {
        type: "person",
        title: "Ника",
        name: "Ника",
        age: "22",
        appearance: "криг загорает на пляже",
        clothing: "топлесс",
        status: "",
        race: "Криг",
      },
    );
    const system = messages[0]?.content ?? "";
    const notes = messages[1]?.content ?? "";
    assert.match(system, /realistic style/);
    assert.match(system, /Do not invent/);
    assert.match(system, /do not replace it with a style from the race/i);
    assert.match(notes, /Возраст: 22/);
    assert.match(notes, /топлесс/);
    assert.match(notes, /Внешность расы: Загорелая кожа, острые уши/);
    assert.match(notes, /Сцена: Она лежит на пляже/);
    assert.doesNotMatch(notes, /панк|стил/i);
  });

  it("starts the shown prompt with realistic style and drops the chatty opener", () => {
    const out = presentImagePrompt(
      "Here is a prompt describing the person's appearance based on the details provided: A petite woman with green eyes, stockings and shoes.",
    );
    assert.match(out, /^realistic style, /);
    assert.doesNotMatch(out, /here is a prompt/i);
    assert.match(out, /stockings and shoes/i);
  });

  it("never lets a prompt run past 1000 characters", () => {
    const long = `${"A real street at dusk. ".repeat(80)}`;
    const capped = capImagePrompt(`"${long}"`);
    assert.ok(capped.length <= IMAGE_PROMPT_LIMIT);
    assert.ok(capped.length > 400);
    assert.equal(capImagePrompt("  A wet cobblestone lane, photorealistic.  "), "A wet cobblestone lane, photorealistic.");
  });
});

