import { useState } from "react";
import { Settings } from "lucide-react";
import { useRpg } from "@/lib/rpg/store";
import { uid, worldReady, type World } from "@/lib/rpg/types";
import { ProviderPick } from "./provider-pick";
import { Button, FieldLabel } from "./ui";

const SAMPLE: World = {
  title: "Соль и пепел",
  genre: "Тёмное фэнтези на краю империи",
  atmosphere:
    "Сырой приморский город. Магия — ремесло контрабандистов, храмы на ночь закрыты, туман пахнет смолой.",
  rules: "Смерть возможна. Деньги имеют значение. Магия требует платы и оставляет след. Власти не всеведущи.",
  races: [
    {
      id: "sample-human",
      name: "Люди",
      description: "Большинство города. Обычная речь, разный цвет кожи, врождённой магии нет.",
    },
    {
      id: "sample-salt",
      name: "Соляные",
      description: "Серокожие ныряльщики с жабрами. Живут в нижних доках и держатся дольше человека под водой.",
    },
  ],
  place: "Нижние доки города Серка, ночь, туман.",
};

export function WorldScreen({ onSettings }: { onSettings: () => void }) {
  const world = useRpg((state) => state.world);
  const patchWorld = useRpg((state) => state.patchWorld);
  const setPhase = useRpg((state) => state.setPhase);
  const messages = useRpg((state) => state.messages);
  const [error, setError] = useState("");

  function save() {
    if (!worldReady(world)) {
      setError("Нужны хотя бы жанр, атмосфера или правила.");
      return;
    }
    setError("");
    setPhase("hero");
  }

  return (
    <main className="setup-shell">
      <header className="setup-bar">
        <ol className="steps">
          <li className="is-current">Мир</li>
          <li>Герой</li>
          <li>Стол</li>
        </ol>
        <button type="button" className="btn btn-ghost icon-btn" onClick={onSettings} aria-label="Настройки">
          <Settings className="size-5" />
        </button>
      </header>

      <div className="setup-scroll">
        <div className="setup-intro">
          <h1>Летопись</h1>
          <p className="deck">Мастер отвечает только на то, что вы написали. Готовых реплик нет.</p>
        </div>

        <section className="card flex flex-col gap-3">
          <h2>Подключение</h2>
          <ProviderPick />
          <p className="hint">
            Grok отвечает сразу, ключ не нужен. OpenRouter — если хотите свою модель и свой счёт.
          </p>
        </section>

        <form
          id="world-form"
          className="card flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
        >
          <div className="flex items-center justify-between gap-3">
            <h2>Мир</h2>
            <Button
              variant="ghost"
              onClick={() => {
                patchWorld({
                  ...SAMPLE,
                  races: SAMPLE.races.map((race) => ({ ...race, id: uid() })),
                });
                setError("");
              }}
            >
              Пример
            </Button>
          </div>
          <Field name="title" label="Название" value={world.title} onChange={(title) => patchWorld({ title })} placeholder="Можно оставить пустым" />
          <Field name="genre" label="Жанр" value={world.genre} onChange={(genre) => patchWorld({ genre })} placeholder="Низкое фэнтези, космос, город" />
          <RaceList />
          <Area name="atmosphere" label="Атмосфера" value={world.atmosphere} onChange={(atmosphere) => patchWorld({ atmosphere })} placeholder="Свет, грязь, тон речи" />
          <Area name="rules" label="Правила мира" value={world.rules} onChange={(rules) => patchWorld({ rules })} placeholder="Что здесь возможно, а что нет" />
          {error ? <p className="banner">{error}</p> : null}
          {messages.length > 0 ? (
            <Button variant="ghost" onClick={() => setPhase("play")}>
              За стол, не начиная заново
            </Button>
          ) : null}
        </form>
      </div>

      <footer className="setup-foot">
        <Button type="submit" form="world-form">
          Дальше — герой
        </Button>
      </footer>
    </main>
  );
}

function RaceList() {
  const races = useRpg((state) => state.world.races);
  const addRace = useRpg((state) => state.addRace);
  const patchRace = useRpg((state) => state.patchRace);
  const removeRace = useRpg((state) => state.removeRace);
  const list = Array.isArray(races) ? races : [];

  return (
    <div className="flex flex-col gap-2">
      <div>
        <p className="label">Расы</p>
        <p className="hint">Каждая раса отдельно: имя и чем она отличается от остальных.</p>
      </div>
      {list.length === 0 ? <p className="hint">Пока ни одной. Можно играть и без списка.</p> : null}
      {list.map((race, index) => (
        <div className="race-card" key={race.id}>
          <div className="flex items-center gap-2">
            <input
              className="field"
              aria-label={`Название расы ${index + 1}`}
              value={race.name}
              maxLength={48}
              placeholder="Название расы"
              onChange={(event) => patchRace(race.id, { name: event.target.value })}
            />
            <button
              type="button"
              className="btn btn-ghost icon-btn"
              aria-label={`Убрать расу ${race.name || index + 1}`}
              onClick={() => removeRace(race.id)}
            >
              ×
            </button>
          </div>
          <textarea
            className="field"
            aria-label={`Описание расы ${race.name || index + 1}`}
            value={race.description}
            maxLength={800}
            placeholder="Как выглядят, где живут, что умеют и чего не умеют"
            onChange={(event) => patchRace(race.id, { description: event.target.value })}
          />
        </div>
      ))}
      <Button variant="ghost" onClick={addRace} disabled={list.length >= 16}>
        Добавить расу
      </Button>
    </div>
  );
}

function Field({
  name,
  label,
  value,
  onChange,
  placeholder,
}: {
  name: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <div>
      <FieldLabel htmlFor={name}>{label}</FieldLabel>
      <input
        id={name}
        className="field"
        value={value}
        maxLength={180}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

function Area({
  name,
  label,
  value,
  onChange,
  placeholder,
}: {
  name: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <div>
      <FieldLabel htmlFor={name}>{label}</FieldLabel>
      <textarea
        id={name}
        className="field"
        value={value}
        maxLength={4000}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}
