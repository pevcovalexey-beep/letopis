import { useId, useState } from "react";
import { formatSigned, modifier, statSum } from "@/lib/rpg/dice";
import { STATS, type Item, type Skill, type StatKey, type Stats } from "@/lib/rpg/types";
import { Button, FieldLabel } from "./ui";

export function StatAllocator({
  stats,
  onChange,
  budget,
}: {
  stats: Stats;
  onChange: (key: StatKey, value: number) => void;
  budget?: number;
}) {
  const sum = statSum(stats);
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {STATS.map((stat) => {
          const value = stats[stat.key];
          const plusLocked = value >= 10 || (budget !== undefined && sum >= budget);
          return (
            <div className="stat-cell" key={stat.key}>
              <p className="text-sm text-muted">{stat.label}</p>
              <div className="stepper mt-2">
                <button
                  type="button"
                  aria-label={`Уменьшить: ${stat.label}`}
                  disabled={value <= 1}
                  onClick={() => onChange(stat.key, value - 1)}
                >
                  −
                </button>
                <strong>{value}</strong>
                <button
                  type="button"
                  aria-label={`Увеличить: ${stat.label}`}
                  disabled={plusLocked}
                  onClick={() => onChange(stat.key, value + 1)}
                >
                  +
                </button>
              </div>
              <p className="mt-1 text-center font-mono text-xs text-faint tabular-nums">
                мод. {formatSigned(modifier(value))}
              </p>
            </div>
          );
        })}
      </div>
      {budget !== undefined ? (
        <p className="hint">
          Сумма {sum}. Максимум {budget}, меньше можно. Модификатор = характеристика − 5.
        </p>
      ) : (
        <p className="hint">Модификатор = характеристика − 5. Шкала от 1 до 10.</p>
      )}
    </div>
  );
}

export function SkillEditor({
  skills,
  onAdd,
  onRemove,
}: {
  skills: Skill[];
  onAdd: (name: string) => void;
  onRemove: (id: string) => void;
}) {
  const [name, setName] = useState("");
  return (
    <div className="flex flex-col gap-2">
      {skills.length === 0 ? <p className="hint">Умений пока нет. Без умения бросок один.</p> : null}
      <ul className="skill-row">
        {skills.map((skill) => (
          <li key={skill.id}>
            <span className="skill-chip is-static">
              {skill.name}
              <button type="button" aria-label={`Убрать умение ${skill.name}`} onClick={() => onRemove(skill.id)}>
                ×
              </button>
            </span>
          </li>
        ))}
      </ul>
      <div className="send-row">
        <input
          className="field"
          value={name}
          maxLength={40}
          placeholder="Название умения"
          aria-label="Название умения"
          onChange={(event) => setName(event.target.value)}
        />
        <Button
          variant="ghost"
          onClick={() => {
            onAdd(name);
            setName("");
          }}
          disabled={!name.trim()}
        >
          Добавить
        </Button>
      </div>
    </div>
  );
}

export function ItemEditor({
  items,
  onAdd,
  onQty,
  onDelete,
  emptyHint = "Пусто. Вещи не появляются сами — только из сцены или ручной правки листа.",
}: {
  items: Item[];
  onAdd: (item: { name: string; qty: number; consumable: boolean }) => void;
  onQty: (id: string, qty: number) => void;
  onDelete: (id: string) => void;
  emptyHint?: string;
}) {
  const nameId = useId();
  const qtyId = useId();
  const [name, setName] = useState("");
  const [qty, setQty] = useState(1);
  const [consumable, setConsumable] = useState(false);

  return (
    <div className="flex flex-col gap-3">
      {items.length === 0 ? (
        <p className="hint">{emptyHint}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((item) => (
            <li className="stat-cell" key={item.id}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate">{item.name}</p>
                  <p className="text-xs text-faint">{item.consumable ? "Расходник" : "Вещь"}{item.detail ? ` · ${item.detail}` : ""}</p>
                </div>
                <button type="button" className="text-sm text-faint" onClick={() => onDelete(item.id)}>
                  Убрать
                </button>
              </div>
              <div className="stepper mt-2">
                <button type="button" aria-label={`Меньше: ${item.name}`} onClick={() => onQty(item.id, item.qty - 1)}>
                  −
                </button>
                <strong>{item.qty}</strong>
                <button type="button" aria-label={`Больше: ${item.name}`} onClick={() => onQty(item.id, item.qty + 1)}>
                  +
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_6rem]">
        <div>
          <FieldLabel htmlFor={nameId}>Новая запись</FieldLabel>
          <input
            id={nameId}
            className="field"
            value={name}
            maxLength={80}
            placeholder="Название"
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <div>
          <FieldLabel htmlFor={qtyId}>Число</FieldLabel>
          <input
            id={qtyId}
            className="field"
            type="number"
            min={1}
            max={9999}
            value={qty}
            onChange={(event) => setQty(Number(event.target.value))}
          />
        </div>
      </div>
      <label className="check">
        <input type="checkbox" checked={consumable} onChange={(event) => setConsumable(event.target.checked)} />
        Расходник — число строго уменьшается и растёт
      </label>
      <Button
        variant="ghost"
        disabled={!name.trim()}
        onClick={() => {
          onAdd({ name, qty: Number.isFinite(qty) ? qty : 1, consumable });
          setName("");
          setQty(1);
          setConsumable(false);
        }}
      >
        Вписать в лист
      </Button>
    </div>
  );
}
