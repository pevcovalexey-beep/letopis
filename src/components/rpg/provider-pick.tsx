import { useRpg } from "@/lib/rpg/store";
import type { Provider } from "@/lib/rpg/types";
import { cn } from "./ui";

const OPTIONS: { id: Provider; title: string; note: string }[] = [
  { id: "openrouter", title: "OpenRouter", note: "Свой ключ" },
  { id: "grok", title: "Grok", note: "Без ключа" },
];

export function ProviderPick() {
  const provider = useRpg((state) => state.settings.provider);
  const link = useRpg((state) => state.link);
  const patchSettings = useRpg((state) => state.patchSettings);

  return (
    <div className="flex flex-col gap-3">
      <div className="provider-switch" role="group" aria-label="Подключение мастера">
        {OPTIONS.map((option) => (
          <button
            key={option.id}
            type="button"
            className={cn("provider-btn", provider === option.id && "is-on")}
            aria-pressed={provider === option.id}
            onClick={() => patchSettings({ provider: option.id })}
          >
            <strong>{option.title}</strong>
            <span>{option.note}</span>
          </button>
        ))}
      </div>
      {link.text ? (
        <p className={cn("status-line", link.phase === "ok" && "is-ok", link.phase === "bad" && "is-bad")} role="status">
          {link.text}
        </p>
      ) : null}
    </div>
  );
}
