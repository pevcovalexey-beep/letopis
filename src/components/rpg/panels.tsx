import { useEffect } from "react";
import { formatSigned, modifier } from "@/lib/rpg/dice";
import { norm } from "@/lib/rpg/patch";
import { useRpg } from "@/lib/rpg/store";
import { STATS, type Companion, type ImageTarget } from "@/lib/rpg/types";
import { Button } from "./ui";

export function HeroPanel({ onImage }: { onImage: (target: ImageTarget) => void }) {
  const hero = useRpg((state) => state.hero);
  const conditions = useRpg((state) => state.conditions);

  return (
    <div className="flex flex-col gap-5 p-4">
      <header className="flex items-start justify-between gap-3">
        <div>
          <p className="kicker">Герой</p>
          <h2 className="mt-1 text-3xl">{hero.name || "Без имени"}</h2>
          <p className="hint mt-1">
            {[hero.race, hero.age ? `${hero.age}` : ""].filter(Boolean).join(" · ") || "Раса и возраст не указаны"}
          </p>
        </div>
        <Button
          variant="ghost"
          onClick={() =>
            onImage({
              type: "person",
              title: hero.name || "Герой",
              name: hero.name || "Герой",
              age: hero.age,
              appearance: hero.appearance,
              clothing: "",
              status: conditions.join(", "),
              race: hero.race,
            })
          }
        >
          Промпт
        </Button>
      </header>
      <p className="story text-base">{hero.appearance || "Внешность не записана."}</p>
      <div className="grid grid-cols-2 gap-2">
        {STATS.map((stat) => (
          <div className="stat-cell" key={stat.key}>
            <p className="text-sm text-muted">{stat.label}</p>
            <p className="font-serif text-2xl tabular-nums">{hero.stats[stat.key]}</p>
            <p className="font-mono text-xs text-faint tabular-nums">мод. {formatSigned(modifier(hero.stats[stat.key]))}</p>
          </div>
        ))}
      </div>
      <p className="hint">Лист героя за столом только для чтения. Меняется он при создании и ходами мастера.</p>
      <section>
        <h3 className="mb-2 text-lg">Состояния</h3>
        {conditions.length === 0 ? <p className="hint">Нет ран и эффектов.</p> : null}
        <ul className="flex flex-col gap-2">
          {conditions.map((item) => (
            <li className="chip" key={item}>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </section>
      {hero.skills.length > 0 ? (
        <p className="hint">
          Умения дают два броска, берётся большее: {hero.skills.map((skill) => skill.name).join(", ")}.
        </p>
      ) : null}
    </div>
  );
}

export function InventoryPanel() {
  const items = useRpg((state) => state.inventory);
  return (
    <div className="flex flex-col gap-4 p-4">
      <div>
        <p className="kicker">Лист</p>
        <h2 className="mt-1 text-3xl">Вещи</h2>
        <p className="hint mt-2">Только просмотр. Стартовый набор задаётся при создании героя, а в игре числа меняет мастер.</p>
      </div>
      {items.length === 0 ? <p className="hint">При герое ничего нет.</p> : null}
      <ul className="flex flex-col gap-2">
        {items.map((item) => (
          <li className="stat-cell" key={item.id}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate">{item.name}</p>
                <p className="text-xs text-faint">
                  {item.money ? "Деньги · расходник" : item.consumable ? "Расходник" : "Вещь"}
                  {item.detail ? ` · ${item.detail}` : ""}
                </p>
              </div>
              <strong className="font-serif text-2xl tabular-nums">{item.qty}</strong>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function NearbyPanel({ onImage }: { onImage: (target: ImageTarget) => void }) {
  const nearby = useRpg((state) => state.nearby);
  const memories = useRpg((state) => state.memories) ?? [];
  const location = useRpg((state) => state.location);
  const place = useRpg((state) => state.world.place);
  const promoteNearby = useRpg((state) => state.promoteNearby);
  const dismissNearby = useRpg((state) => state.dismissNearby);
  const rememberPerson = useRpg((state) => state.rememberPerson);
  const forgetPerson = useRpg((state) => state.forgetPerson);
  const here = (location || place).trim();
  const remembered = (id: string, name: string) =>
    memories.some((item) => item.id === id || norm(item.name) === norm(name));
  const elsewhere = memories.filter((item) => !nearby.some((npc) => npc.id === item.id || norm(npc.name) === norm(item.name)));
  return (
    <div className="flex flex-col gap-4 p-4">
      <div>
        <p className="kicker">Поле зрения</p>
        <h2 className="mt-1 text-3xl">Люди</h2>
        <p className="hint mt-2">
          Все, кто сейчас виден{here ? ` в «${here}»` : ""}. Запомните человека — в этом месте потом будет он же.
        </p>
      </div>
      {nearby.length === 0 ? <p className="hint">Сейчас в поле зрения никого нет.</p> : null}
      {nearby.map((npc) => {
        const pinned = remembered(npc.id, npc.name);
        return (
          <article className="person-card card flex flex-col gap-2" key={npc.id}>
            <h3 className="text-2xl">{npc.name}</h3>
            <p className="text-sm text-muted">{npc.status || "Занят своим."}</p>
            <p className="text-sm">
              <span className="text-muted">Возраст. </span>
              {npc.age || "не назван"}
            </p>
            {npc.race ? (
              <p className="text-sm">
                <span className="text-muted">Раса. </span>
                {npc.race}
              </p>
            ) : null}
            <p className="text-sm">
              <span className="text-muted">Внешность. </span>
              {npc.appearance || "не описана"}
            </p>
            {npc.clothing ? <p className="hint">Одежда: {npc.clothing}</p> : null}
            {npc.goal ? <p className="hint">Цель: {npc.goal}</p> : null}
            {pinned ? <p className="hint">Запомнен в этом месте.</p> : null}
            <div className="flex flex-wrap gap-2 pt-1">
              <Button onClick={() => promoteNearby(npc.id)}>В отряд</Button>
              {pinned ? (
                <Button variant="ghost" onClick={() => forgetPerson(npc.id)}>
                  Забыть
                </Button>
              ) : (
                <Button variant="ghost" onClick={() => rememberPerson(npc.id)}>
                  Запомнить
                </Button>
              )}
              <Button
                variant="ghost"
                onClick={() =>
                  onImage({
                    type: "person",
                    title: npc.name,
                    name: npc.name,
                    age: npc.age,
                    appearance: npc.appearance,
                    clothing: npc.clothing,
                    status: npc.status,
                    race: npc.race,
                  })
                }
              >
                Промпт
              </Button>
              {pinned ? null : (
                <Button variant="ghost" onClick={() => dismissNearby(npc.id)}>
                  Убрать
                </Button>
              )}
            </div>
          </article>
        );
      })}
      {elsewhere.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h3 className="text-lg">Память</h3>
          <p className="hint">Эти люди ждут в своих местах. Когда сцена вернётся туда, они появятся теми же.</p>
          {elsewhere.map((person) => (
            <article className="person-card card flex flex-col gap-2" key={person.id}>
              <h3 className="text-2xl">{person.name}</h3>
              <p className="hint">{person.place}</p>
              <p className="text-sm">
                <span className="text-muted">Возраст. </span>
                {person.age || "не назван"}
              </p>
              {person.race ? (
                <p className="text-sm">
                  <span className="text-muted">Раса. </span>
                  {person.race}
                </p>
              ) : null}
              <p className="text-sm">
                <span className="text-muted">Внешность. </span>
                {person.appearance || "не описана"}
              </p>
              {person.clothing ? <p className="hint">Одежда: {person.clothing}</p> : null}
              <div>
                <Button variant="ghost" onClick={() => forgetPerson(person.id)}>
                  Забыть
                </Button>
              </div>
            </article>
          ))}
        </section>
      ) : null}
    </div>
  );
}

export function PartyPanel({ onImage }: { onImage: (target: ImageTarget) => void }) {
  const companions = useRpg((state) => state.companions);
  const sealPristineCompanions = useRpg((state) => state.sealPristineCompanions);
  const pristine = companions.some((companion) => companion.pristine);
  useEffect(() => {
    if (pristine) sealPristineCompanions();
  }, [pristine, sealPristineCompanions]);
  return (
    <div className="flex flex-col gap-4 p-4">
      <div>
        <p className="kicker">Параллельно с героем</p>
        <h2 className="mt-1 text-3xl">Отряд</h2>
        <p className="hint mt-2">
          Лист собирается сам: по возрасту, виду и роли. Маленький ребёнок не станет силачом, шрамы не дают высокой харизмы.
        </p>
      </div>
      {companions.length === 0 ? <p className="hint">В отряде никого. Переведите человека из «Люди».</p> : null}
      {companions.map((companion) => (
        <CompanionCard key={companion.id} companion={companion} onImage={onImage} />
      ))}
    </div>
  );
}

function CompanionCard({
  companion,
  onImage,
}: {
  companion: Companion;
  onImage: (target: ImageTarget) => void;
}) {
  const releaseCompanion = useRpg((state) => state.releaseCompanion);
  return (
    <article className="person-card card flex flex-col gap-3">
      <h3 className="text-2xl">{companion.name}</h3>
      <p className="text-sm text-muted">{companion.status || "Идёт рядом."}</p>
      <p className="text-sm">
        <span className="text-muted">Возраст. </span>
        {companion.age || "не назван"}
      </p>
      {companion.race ? (
        <p className="text-sm">
          <span className="text-muted">Раса. </span>
          {companion.race}
        </p>
      ) : null}
      <p className="text-sm">
        <span className="text-muted">Внешность. </span>
        {companion.appearance || "не описана"}
      </p>
      {companion.clothing ? <p className="hint">Одежда: {companion.clothing}</p> : null}
      {companion.goal ? <p className="hint">Цель: {companion.goal}</p> : null}
      {companion.wounds ? <p className="hint">Раны: {companion.wounds}</p> : null}
      <div className="grid grid-cols-2 gap-2">
        {STATS.map((stat) => (
          <div className="stat-cell" key={stat.key}>
            <p className="text-sm text-muted">{stat.label}</p>
            <p className="font-serif text-2xl tabular-nums">{companion.stats[stat.key]}</p>
            <p className="font-mono text-xs text-faint tabular-nums">мод. {formatSigned(modifier(companion.stats[stat.key]))}</p>
          </div>
        ))}
      </div>
      {companion.skills.length > 0 ? (
        <p className="hint">Умения: {companion.skills.map((skill) => skill.name).join(", ")}.</p>
      ) : (
        <p className="hint">Отдельных умений нет.</p>
      )}
      {companion.inventory.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {companion.inventory.map((item) => (
            <li className="stat-cell" key={item.id}>
              <div className="flex items-start justify-between gap-3">
                <p className="min-w-0 truncate">{item.name}</p>
                <strong className="font-serif text-2xl tabular-nums">{item.qty}</strong>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="hint">При себе ничего нет.</p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="ghost"
          onClick={() =>
            onImage({
              type: "person",
              title: companion.name,
              name: companion.name,
              age: companion.age,
              appearance: companion.appearance,
              clothing: companion.clothing,
              status: companion.status,
              race: companion.race,
              extra: companion.wounds,
            })
          }
        >
          Промпт
        </Button>
        <Button variant="ghost" onClick={() => releaseCompanion(companion.id)}>
          Из отряда
        </Button>
      </div>
    </article>
  );
}
