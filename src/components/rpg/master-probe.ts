import { useEffect } from "react";
import { probeConnection } from "@/lib/rpg/openrouter";
import { useRpg } from "@/lib/rpg/store";

export function useMasterProbe(enabled: boolean) {
  const provider = useRpg((state) => state.settings.provider);
  const apiKey = useRpg((state) => state.settings.apiKey);
  const model = useRpg((state) => state.settings.model);
  const setLink = useRpg((state) => state.setLink);

  useEffect(() => {
    if (!enabled) return;
    const selected = provider === "grok" ? "Grok" : "OpenRouter";
    setLink({ phase: "checking", text: `Выбран ${selected}. Проверяю подключение…` });
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void probeConnection({ provider, apiKey, model }).then((result) => {
        if (cancelled) return;
        setLink({ phase: result.ok ? "ok" : "bad", text: result.detail });
      });
    }, 400);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [enabled, provider, apiKey, model, setLink]);
}
