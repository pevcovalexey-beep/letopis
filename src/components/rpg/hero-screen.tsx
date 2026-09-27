import { Settings } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { errorText, isAbortError, completeChat } from "@/lib/rpg/openrouter";
import { parsePurse } from "@/lib/rpg/parse";
import { buildPurseMessages } from "@/lib/rpg/prompt";
import { canStartHero, useRpg } from "@/lib/rpg/store";
import { masterReady, STAT_BUDGET } from "@/lib/rpg/types";
import { ItemEditor, SkillEditor, StatAllocator } from "./editors";
import { Button, FieldLabel } from "./ui";

export function HeroScreen({ onSettings }: { onSettings: () => void }) {
  const hero = useRpg((state) => state.hero);
  const races = useRpg((state) => state.world.races);
  const patchHero = useRpg((state) => state.patchHero);
  const setStat = useRpg((state) => state.setStat);
  const addSkill = useRpg((state) => state.addSkill);
  const removeSkill = useRpg((state) => state.removeSkill);
  const setPhase = useRpg((state) => state.setPhase);
  const beginPlay = useRpg((state) => state.beginPlay);
  const messages = useRpg((state) => state.messages);
  const place = useRpg((state) => state.world.place);
  const patchWorld = useRpg((state) => state.patchWorld);
  const inventory = useRpg((state) => state.inventory);
  const addInventoryItem = useRpg((state) => state.addInventoryItem);
  const setItemQty = useRpg((state) => state.setItemQty);
  const deleteItem = useRpg((state) => state.deleteItem);
  const setPurse = useRpg((state) => state.setPurse);
  const ready = canStartHero(hero);
  const namedRaces = (Array.isArray(races) ? races : []).filter((race) => race.name.trim());
  const gear = inventory.filter((item) => !item.money);
  const [purseTick, setPurseTick] = useState(0);

  function fillSample() {
    patchHero({
      name: "Ирис Вейн",
      race: namedRaces[0]?.name || "Человек",
      age: "31",
      appearance:
        "Худощавая, короткие тёмные волосы с сединой у виска, шрам через левую бровь, промасленный кожаный плащ, медный компас на шнурке.",
    });
    if (!hero.skills.some((skill) => skill.name === "Ориентирование")) addSkill("Ориентирование");
    if (!hero.skills.some((skill) => skill.name === "Торг")) addSkill("Торг");
    if (gear.length === 0) addInventoryItem({ name: "Медный компас", qty: 1, consumable: false });
    setPurse("Медяки", 14);
    setPurseTick((tick) => tick + 1);
    if (!place.trim()) patchWorld({ place: "Нижние доки города Серка, ночь, туман." });
  }

  return (
    <main className="setup-shell">
      <header className="setup-bar">
        <ol className="steps">
          <li>Мир</li>
          <li className="is-current">Герой</li>
          <li>Стол</li>
        </ol>
        <button type="button" className="btn btn-ghost icon-btn" onClick={onSettings} aria-label="Настройки">
          <Settings className="size-5" />
        </button>
      </header>

      <form
        id="hero-form"
        className="setup-scroll flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (ready || messages.length > 0) beginPlay();
        }}
      >
        <div className="setup-intro">
          <h1>Герой</h1>
          <p className="deck">
            Не больше {STAT_BUDGET} очков. Меньше можно — тогда герой слабее. На броске сначала кубик, потом модификатор: значение минус пять.
          </p>
        </div>

        <section className="card flex flex-col gap-4">
          <div className="flex items-center justify-between gap-3">
            <h2>Лист</h2>
            <Button variant="ghost" onClick={fillSample}>
              Пример
            </Button>
          </div>
          <Labeled id="hero-name" label="Имя" value={hero.name} onChange={(name) => patchHero({ name })} placeholder="Имя, которым представляются" />
          {namedRaces.length > 0 ? (
            <div>
              <p className="label">Раса из мира</p>
              <div className="skill-row">
                {namedRaces.map((race) => (
                  <button
                    key={race.id}
                    type="button"
                    className={`skill-chip ${hero.race.trim() === race.name.trim() ? "is-on" : ""}`}
                    onClick={() => patchHero({ race: race.name.trim() })}
                  >
                    {race.name}
                  </button>
                ))}
              </div>
              {namedRaces.find((race) => race.name.trim() === hero.race.trim())?.description ? (
                <p className="hint mt-2">{namedRaces.find((race) => race.name.trim() === hero.race.trim())?.description}</p>
              ) : null}
            </div>
          ) : null}
          <Labeled id="hero-race" label={namedRaces.length > 0 ? "Или своя раса" : "Раса"} value={hero.race} onChange={(race) => patchHero({ race })} placeholder="Как назвали себя" />
          <Labeled id="hero-age" label="Возраст" value={hero.age} onChange={(age) => patchHero({ age })} placeholder="27" />
          <div>
            <FieldLabel htmlFor="hero-look">Внешность</FieldLabel>
            <textarea
              id="hero-look"
              className="field"
              value={hero.appearance}
              maxLength={2000}
              placeholder="Лицо, одежда, приметы"
              onChange={(event) => patchHero({ appearance: event.target.value })}
            />
          </div>
        </section>

        <section className="card flex flex-col gap-3">
          <h2>Характеристики</h2>
          <StatAllocator stats={hero.stats} onChange={setStat} budget={STAT_BUDGET} />
        </section>

        <section className="card flex flex-col gap-3">
          <h2>Умения</h2>
          <p className="hint">
            Умение не связано с характеристикой. Если оно есть, кубик бросается дважды и берётся большее число. Модификатор считается уже после.
          </p>
          <SkillEditor skills={hero.skills} onAdd={addSkill} onRemove={removeSkill} />
        </section>

        <section className="card flex flex-col gap-3">
          <h2>Деньги</h2>
          <PurseField resetToken={purseTick} />
        </section>

        <section className="card flex flex-col gap-3">
          <h2>Вещи</h2>
          <p className="hint">Что при герое с самого начала, кроме денег. За столом этот список меняет только мастер.</p>
          <ItemEditor
            items={gear}
            onAdd={addInventoryItem}
            onQty={setItemQty}
            onDelete={deleteItem}
            emptyHint="Пусто. Запишите, что герой несёт с собой."
          />
        </section>

        <section className="card flex flex-col gap-3">
          <h2 id="start-place-title">С чего начинается действие</h2>
          <p className="hint">Место, время и погода. Герой уже здесь, когда стол открывается.</p>
          <textarea
            id="start-place"
            className="field"
            aria-labelledby="start-place-title"
            value={place}
            maxLength={240}
            placeholder="Нижние доки, ночь, туман"
            onChange={(event) => patchWorld({ place: event.target.value })}
          />
        </section>

        {!ready ? <p className="hint">Нужны имя и внешность. Очков не больше {STAT_BUDGET}, меньше тоже можно.</p> : null}
      </form>

      <footer className="setup-foot">
        <Button variant="ghost" onClick={() => setPhase("world")}>
          Мир
        </Button>
        <Button type="submit" form="hero-form" disabled={!ready && messages.length === 0}>
          {messages.length > 0 ? "За стол" : "Начать"}
        </Button>
      </footer>
    </main>
  );
}

function PurseField({ resetToken }: { resetToken: number }) {
  const settings = useRpg((state) => state.settings);
  const setPurse = useRpg((state) => state.setPurse);
  const purse = useRpg((state) => state.inventory.find((item) => item.money));
  const linked = masterReady(settings);
  const provider = settings.provider;
  const touched = useRef(false);
  const req = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const [name, setName] = useState(purse?.name ?? "");
  const [qty, setQty] = useState(purse ? String(purse.qty) : "");
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState("");

  const ask = useCallback((force: boolean) => {
    const snap = useRpg.getState();
    if (!masterReady(snap.settings)) {
      setNote("Подключите мастера — или впишите сумму сами.");
      return;
    }
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const id = ++req.current;
    const before = snap.inventory.find((item) => item.money)?.id ?? null;
    setAsking(true);
    setNote("");
    void (async () => {
      try {
        const raw = await completeChat({
          provider: snap.settings.provider,
          apiKey: snap.settings.apiKey.trim(),
          model: snap.settings.model.trim(),
          temperature: 0.4,
          maxTokens: 180,
          signal: ctrl.signal,
          messages: buildPurseMessages(snap.world, snap.hero),
        });
        if (id !== req.current) return;
        const parsed = parsePurse(raw);
        if (!parsed) {
          setNote("Мастер не назвал сумму. Впишите её сами.");
          return;
        }
        const live = useRpg.getState().inventory.find((item) => item.money);
        if (!force && (touched.current || (live && live.id !== before))) return;
        touched.current = false;
        setName(parsed.name);
        setQty(String(parsed.qty));
        useRpg.getState().setPurse(parsed.name, parsed.qty);
      } catch (error) {
        if (id !== req.current || isAbortError(error)) return;
        setNote(errorText(error));
      } finally {
        if (id === req.current) setAsking(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (!linked || touched.current || useRpg.getState().inventory.some((item) => item.money)) return;
    ask(false);
    return () => abortRef.current?.abort();
  }, [linked, ask]);

  useEffect(() => {
    if (resetToken === 0) return;
    const live = useRpg.getState().inventory.find((item) => item.money);
    if (!live) return;
    touched.current = true;
    setName(live.name);
    setQty(String(live.qty));
  }, [resetToken]);

  return (
    <div className="flex flex-col gap-3">
      <p className="hint">
        Отдельная строка листа, расходник. Мастер предлагает стартовую сумму — её можно изменить. За столом он сам списывает плату и прибавляет находки.
      </p>
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_8rem]">
        <div>
          <FieldLabel htmlFor="purse-name">Как называются</FieldLabel>
          <input
            id="purse-name"
            className="field"
            value={name}
            maxLength={40}
            placeholder="Медяки, кроны, марки"
            onChange={(event) => {
              const value = event.target.value.slice(0, 40);
              touched.current = true;
              setName(value);
              if (!value.trim()) return;
              const amount = Number(qty);
              setPurse(value, Number.isFinite(amount) ? amount : 0);
            }}
          />
        </div>
        <div>
          <FieldLabel htmlFor="purse-qty">Сколько при себе</FieldLabel>
          <input
            id="purse-qty"
            className="field"
            inputMode="numeric"
            value={qty}
            placeholder="0"
            onChange={(event) => {
              const clean = event.target.value.replace(/\D/g, "").slice(0, 4);
              touched.current = true;
              setQty(clean);
              if (clean === "") return;
              setPurse(name.trim() || "Деньги", Number(clean));
            }}
          />
        </div>
      </div>
      {asking ? (
        <p className="hint">
          {provider === "grok"
            ? "Мастер подбирает сумму. Grok иногда думает около минуты — число можно вписать и не ждать."
            : "Мастер подбирает сумму…"}
        </p>
      ) : null}
      {note ? <p className="banner">{note}</p> : null}
      <div>
        <Button variant="ghost" disabled={asking || !linked} onClick={() => ask(true)}>
          {asking ? "Подбираю…" : purse || name || qty ? "Предложить снова" : "Предложить сумму"}
        </Button>
      </div>
    </div>
  );
}

function Labeled({
  id,
  label,
  value,
  onChange,
  placeholder,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <div>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <input
        id={id}
        className="field"
        value={value}
        maxLength={80}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}
