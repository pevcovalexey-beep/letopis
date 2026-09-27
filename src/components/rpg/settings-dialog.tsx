import { useEffect, useRef, useState } from "react";
import { canStartHero, useRpg, type RestartMode } from "@/lib/rpg/store";
import { MODELS, worldReady } from "@/lib/rpg/types";
import { ProviderPick } from "./provider-pick";
import { Button, FieldLabel } from "./ui";

const RESTARTS: { id: RestartMode; title: string; note: string }[] = [
  {
    id: "all",
    title: "Всё с начала",
    note: "Мир, герой и летопись сотрутся. Подключение останется.",
  },
  {
    id: "hero",
    title: "Этот мир, новый герой",
    note: "Мир останется. Герой и летопись начнутся заново.",
  },
  {
    id: "tale",
    title: "Этот мир и этот герой",
    note: "Летопись заново. Лист героя останется, вещи вернутся к тем, что были в начале.",
  },
];

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const settings = useRpg((state) => state.settings);
  const patchSettings = useRpg((state) => state.patchSettings);
  const worldOk = useRpg((state) => worldReady(state.world));
  const heroOk = useRpg((state) => canStartHero(state.hero));
  const restart = useRpg((state) => state.restart);
  const [showKey, setShowKey] = useState(false);
  const [armed, setArmed] = useState<RestartMode | null>(null);
  const openRouter = settings.provider === "openrouter";
  const armedChoice = RESTARTS.find((choice) => choice.id === armed);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog || dialog.open) return;
    dialog.showModal();
    const onCancel = (event: Event) => {
      event.preventDefault();
      onClose();
    };
    dialog.addEventListener("cancel", onCancel);
    return () => dialog.removeEventListener("cancel", onCancel);
  }, [onClose]);

  function blocked(mode: RestartMode): string {
    if (mode === "hero" && !worldOk) return "Сначала нужен мир.";
    if (mode === "tale" && !worldOk) return "Сначала нужен мир.";
    if (mode === "tale" && !heroOk) return "Сначала нужен готовый герой.";
    return "";
  }

  return (
    <dialog ref={ref} className="modal" aria-labelledby="settings-title">
      <form
        className="modal-body"
        onSubmit={(event) => {
          event.preventDefault();
          onClose();
        }}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="kicker">Мастер</p>
            <h2 id="settings-title" className="mt-1">
              Подключение
            </h2>
          </div>
          <Button variant="ghost" className="icon-btn" onClick={onClose} aria-label="Закрыть">
            ×
          </Button>
        </div>
        <ProviderPick />
        {openRouter ? (
          <>
            <p className="hint">
              Ключ хранится только в этом браузере и уходит напрямую в OpenRouter. Счёт идёт по тарифам выбранной модели.
            </p>
            <div>
              <FieldLabel htmlFor="api-key">Ключ API</FieldLabel>
              <div className="flex gap-2">
                <input
                  id="api-key"
                  className="field"
                  type={showKey ? "text" : "password"}
                  autoComplete="off"
                  spellCheck={false}
                  value={settings.apiKey}
                  placeholder="sk-or-..."
                  onChange={(event) => patchSettings({ apiKey: event.target.value })}
                />
                <Button variant="ghost" onClick={() => setShowKey((value) => !value)}>
                  {showKey ? "Скрыть" : "Показать"}
                </Button>
              </div>
            </div>
            <div>
              <FieldLabel htmlFor="model-id">Модель</FieldLabel>
              <input
                id="model-id"
                className="field"
                list="openrouter-models"
                spellCheck={false}
                autoComplete="off"
                value={settings.model}
                placeholder="id модели"
                onChange={(event) => patchSettings({ model: event.target.value.trimStart() })}
              />
              <datalist id="openrouter-models">
                {MODELS.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.label}
                  </option>
                ))}
              </datalist>
              <p className="hint mt-2">
                Любой id с{" "}
                <a className="link" href="https://openrouter.ai/models" target="_blank" rel="noreferrer">
                  openrouter.ai/models
                </a>
                . Ключ создаётся на{" "}
                <a className="link" href="https://openrouter.ai/keys" target="_blank" rel="noreferrer">
                  openrouter.ai/keys
                </a>
                .
              </p>
            </div>
          </>
        ) : (
          <p className="hint">Grok отвечает без ключа. Переключаться можно в любой момент, уже написанное за столом не сотрётся.</p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button type="submit">Готово</Button>
        </div>
        <div className="flex flex-col gap-3 border-t border-border pt-4">
          <div>
            <p className="kicker">Заново</p>
            <h3 className="mt-1 text-lg">Начать историю сначала</h3>
          </div>
          {armed && armedChoice ? (
            <div className="flex flex-col gap-3">
              <p className="hint">{armedChoice.note} Это нельзя отменить.</p>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="danger"
                  onClick={() => {
                    restart(armed);
                    onClose();
                  }}
                >
                  Начать заново
                </Button>
                <Button variant="ghost" onClick={() => setArmed(null)}>
                  Отмена
                </Button>
              </div>
            </div>
          ) : (
            RESTARTS.map((choice) => {
              const why = blocked(choice.id);
              return (
                <div key={choice.id} className="flex flex-col gap-1">
                  <Button variant="ghost" disabled={Boolean(why)} onClick={() => setArmed(choice.id)}>
                    {choice.title}
                  </Button>
                  <p className="hint">{why || choice.note}</p>
                </div>
              );
            })
          )}
        </div>
      </form>
    </dialog>
  );
}
