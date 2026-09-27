import { useCallback, useEffect, useRef, useState } from "react";
import { Backpack, Eye, ScrollText, Settings, User, Users, Volume2, VolumeX } from "lucide-react";
import { errorText, isAbortError, completeChat } from "@/lib/rpg/openrouter";
import { buildImageMessages, buildOpeningRequest, buildResolutionRequest, buildTurnRequest, capImagePrompt, IMAGE_PROMPT_LIMIT, presentImagePrompt } from "@/lib/rpg/prompt";
import { castCheck, dicePhrase, formatSigned } from "@/lib/rpg/dice";
import { useRpg } from "@/lib/rpg/store";
import { masterReady, type ImageTarget, type Message, type Roll, type Settings as TableSettings } from "@/lib/rpg/types";
import { HeroPanel, InventoryPanel, NearbyPanel, PartyPanel } from "./panels";
import { Button, cn } from "./ui";

type MobilePane = "tale" | "hero" | "bag" | "near" | "party";
type SideTab = Exclude<MobilePane, "tale">;

const DOCK: { id: MobilePane; label: string; icon: typeof User }[] = [
  { id: "tale", label: "Стол", icon: ScrollText },
  { id: "hero", label: "Герой", icon: User },
  { id: "bag", label: "Вещи", icon: Backpack },
  { id: "near", label: "Люди", icon: Eye },
  { id: "party", label: "Отряд", icon: Users },
];

const SIDES: { id: SideTab; label: string }[] = [
  { id: "hero", label: "Герой" },
  { id: "bag", label: "Вещи" },
  { id: "near", label: "Люди" },
  { id: "party", label: "Отряд" },
];

const CHECK_HOPS = 2;

type PromptUi = { title: string; loading: boolean; text: string; error: string };

export function PlayScreen({ onSettings }: { onSettings: () => void }) {
  const world = useRpg((state) => state.world);
  const location = useRpg((state) => state.location);
  const messages = useRpg((state) => state.messages);
  const busy = useRpg((state) => state.busy);
  const banner = useRpg((state) => state.banner);
  const apiKey = useRpg((state) => state.settings.apiKey);
  const model = useRpg((state) => state.settings.model);
  const provider = useRpg((state) => state.settings.provider);
  const link = useRpg((state) => state.link);
  const chronicle = useRpg((state) => state.chronicle);
  const ready = masterReady({ provider, apiKey, model });
  const messageCount = messages.length;
  const [draft, setDraft] = useState("");
  const [mobilePane, setMobilePane] = useState<MobilePane>("tale");
  const [sideTab, setSideTab] = useState<SideTab>("hero");
  const [phaseNote, setPhaseNote] = useState<"think" | "roll">("think");
  const [promptUi, setPromptUi] = useState<PromptUi | null>(null);
  const [copied, setCopied] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const reqRef = useRef(0);
  const lockRef = useRef(false);
  const draftRef = useRef(draft);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const narration = useNarration();
  draftRef.current = draft;

  const launch = useCallback((announce = true) => {
    const snap = useRpg.getState();
    if (snap.messages.length > 0 || snap.busy || lockRef.current) return;
    if (!masterReady(snap.settings)) {
      if (announce) snap.setBanner(needMaster(snap.settings));
      return;
    }
    lockRef.current = true;
    const id = ++reqRef.current;
    const ctrl = new AbortController();
    abortRef.current?.abort();
    abortRef.current = ctrl;
    setPhaseNote("think");
    useRpg.setState({ busy: true, banner: null });
    void (async () => {
      try {
        const live = useRpg.getState();
        const raw = await completeChat({
          ...chatOptions(live.settings),
          temperature: 0.9,
          maxTokens: 1400,
          signal: ctrl.signal,
          messages: buildOpeningRequest(live),
        });
        if (id !== reqRef.current) return;
        await followChecks(raw, ctrl.signal, CHECK_HOPS, () => setPhaseNote("roll"));
        if (id !== reqRef.current) return;
        lockRef.current = false;
        useRpg.setState({ busy: false });
      } catch (error) {
        if (id !== reqRef.current) return;
        lockRef.current = false;
        useRpg.setState({ busy: false });
        useRpg.getState().setBanner(isAbortError(error) ? "Открытие остановлено." : errorText(error));
      }
    })();
  }, []);

  useEffect(() => {
    launch(false);
    return () => {
      reqRef.current += 1;
      lockRef.current = false;
      abortRef.current?.abort();
      const live = useRpg.getState();
      if (live.busy && live.messages.length === 0) useRpg.setState({ busy: false });
    };
  }, [launch, chronicle]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messageCount, busy]);

  function scenePrompt() {
    const live = useRpg.getState();
    const last = [...live.messages].reverse().find((message) => message.role === "master");
    if (!last) return;
    void requestImage({ type: "scene", title: "Сцена", text: last.text });
  }

  function stop() {
    abortRef.current?.abort();
  }

  function send() {
    const text = draftRef.current.trim();
    const snap = useRpg.getState();
    if (!text || snap.busy || lockRef.current) return;
    if (!masterReady(snap.settings)) {
      snap.setBanner(needMaster(snap.settings));
      onSettings();
      return;
    }
    const id = ++reqRef.current;
    const ctrl = new AbortController();
    abortRef.current?.abort();
    abortRef.current = ctrl;
    lockRef.current = true;
    setPhaseNote("think");
    const player = snap.pushPlayer(text);
    setDraft("");
    if (inputRef.current) inputRef.current.style.height = "";
    void (async () => {
      let committed = false;
      try {
        const live = useRpg.getState();
        const raw = await completeChat({
          ...chatOptions(live.settings),
          temperature: 0.9,
          maxTokens: 1400,
          signal: ctrl.signal,
          messages: buildTurnRequest(live),
        });
        if (id !== reqRef.current) return;
        committed = true;
        await followChecks(raw, ctrl.signal, CHECK_HOPS, () => setPhaseNote("roll"));
        if (id !== reqRef.current) return;
        lockRef.current = false;
        useRpg.setState({ busy: false });
      } catch (error) {
        if (id !== reqRef.current) return;
        lockRef.current = false;
        if (!committed) {
          useRpg.getState().rollbackPlayer(player.id, null);
          setDraft(text);
        } else {
          useRpg.setState({ busy: false });
        }
        useRpg.getState().setBanner(
          isAbortError(error)
            ? committed
              ? "Проверка остановлена. Уже сказанное остаётся в летописи."
              : "Ход остановлен. Текст возвращён в строку."
            : errorText(error),
        );
      }
    })();
  }

  async function requestImage(target: ImageTarget) {
    const snap = useRpg.getState();
    if (!masterReady(snap.settings)) {
      snap.setBanner(needMaster(snap.settings));
      onSettings();
      return;
    }
    const title = target.type === "scene" ? "Промпт сцены" : `Промпт: ${target.title}`;
    setCopied(false);
    setPromptUi({ title, loading: true, text: "", error: "" });
    try {
      const text = presentImagePrompt(await askImagePrompt(snap.settings, buildImageMessages(snap, target)));
      setPromptUi({ title, loading: false, text, error: "" });
    } catch (error) {
      if (isAbortError(error)) {
        setPromptUi(null);
        return;
      }
      setPromptUi({ title, loading: false, text: "", error: errorText(error) });
    }
  }

  const latestMaster = [...messages].reverse().find((message) => message.role === "master");
  const masterName = provider === "grok" ? "Grok" : "OpenRouter";
  const subtitle = [world.title || "Партия", location || world.place || "Место не названо", masterName]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="table-shell">
      <header className="topbar">
        <div className="min-w-0 flex-1">
          <p className="font-serif text-lg leading-none">Летопись</p>
          <p className="truncate text-sm text-muted">{subtitle}</p>
          {link.text ? (
            <p className={cn("text-sm leading-snug", link.phase === "ok" && "text-ok", link.phase === "bad" && "text-danger")}>
              {link.text}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          className="btn btn-ghost icon-btn"
          disabled={!latestMaster}
          aria-pressed={Boolean(narration.activeId)}
          aria-label={narration.activeId ? "Остановить озвучку" : "Озвучить текст"}
          onClick={() => {
            if (narration.activeId) narration.stop();
            else if (latestMaster) narration.speak(latestMaster.id, latestMaster.text);
          }}
        >
          {narration.activeId ? <VolumeX className="size-5" /> : <Volume2 className="size-5" />}
        </button>
        <button type="button" className="btn btn-ghost icon-btn" onClick={onSettings} aria-label="Настройки">
          <Settings className="size-5" />
        </button>
      </header>

      <div className="table-body">
        <section className={cn("tale flex-col", mobilePane === "tale" ? "flex" : "hidden lg:flex")}>
          <div className="tale-scroll">
            <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
              {messages.length === 0 ? (
                <EmptyTale busy={busy} ready={ready} provider={provider} onOpen={() => launch()} onSettings={onSettings} />
              ) : null}
              {messages.map((message) => (
                <ChatEntry
                  key={message.id}
                  message={message}
                  speaking={narration.activeId === message.id}
                  onSpeak={() => narration.speak(message.id, message.text)}
                  onImage={requestImage}
                />
              ))}
              {busy ? (
                <p className="hint">
                  {phaseNote === "roll"
                    ? "Стол бросил кубик. Мастер разбирает исход."
                    : provider === "grok"
                      ? "Grok думает. Ответ без ключа, иногда около минуты."
                      : "Мастер ведёт сцену…"}
                </p>
              ) : null}
              {banner ? <p className="banner">{banner}</p> : null}
              <div ref={endRef} />
            </div>
          </div>
          <form
            className="composer-bar"
            onSubmit={(event) => {
              event.preventDefault();
              send();
            }}
          >
            <Button type="button" variant="ghost" disabled={!latestMaster} onClick={scenePrompt}>
              Промпт сцены
            </Button>
            <div className="send-row">
              <label className="sr-only" htmlFor="action-input">
                Действие
              </label>
              <textarea
                ref={inputRef}
                id="action-input"
                className="field field-line"
                rows={1}
                maxLength={4000}
                value={draft}
                placeholder="Что вы делаете?"
                onChange={(event) => {
                  setDraft(event.target.value);
                  const el = event.target;
                  el.style.height = "auto";
                  el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    send();
                  }
                }}
              />
              {busy ? (
                <Button variant="ghost" onClick={stop}>
                  Стоп
                </Button>
              ) : (
                <Button type="submit" disabled={!draft.trim()} aria-label="Отправить">
                  Ход
                </Button>
              )}
            </div>
          </form>
        </section>

        <aside className={cn("sheets flex-col", mobilePane === "tale" ? "hidden lg:flex" : "flex")}>
          <div className="side-tabs sticky top-0 z-10 hidden bg-bg-elevated lg:flex" role="tablist" aria-label="Листы стола">
            {SIDES.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={sideTab === tab.id}
                className={cn("side-tab", sideTab === tab.id && "is-active")}
                onClick={() => setSideTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <div className={cn("min-h-0 flex-1 overflow-y-auto", mobilePane !== "hero" && "max-lg:hidden", sideTab !== "hero" && "lg:hidden")}>
            <HeroPanel onImage={requestImage} />
          </div>
          <div className={cn("min-h-0 flex-1 overflow-y-auto", mobilePane !== "bag" && "max-lg:hidden", sideTab !== "bag" && "lg:hidden")}>
            <InventoryPanel />
          </div>
          <div className={cn("min-h-0 flex-1 overflow-y-auto", mobilePane !== "near" && "max-lg:hidden", sideTab !== "near" && "lg:hidden")}>
            <NearbyPanel onImage={requestImage} />
          </div>
          <div className={cn("min-h-0 flex-1 overflow-y-auto", mobilePane !== "party" && "max-lg:hidden", sideTab !== "party" && "lg:hidden")}>
            <PartyPanel onImage={requestImage} />
          </div>
        </aside>
      </div>

      <nav className="dock lg:hidden" aria-label="Разделы стола">
        {DOCK.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              type="button"
              className={cn("dock-btn", mobilePane === tab.id && "is-active")}
              aria-current={mobilePane === tab.id ? "page" : undefined}
              onClick={() => setMobilePane(tab.id)}
            >
              <Icon className="size-5" aria-hidden="true" />
              {tab.label}
            </button>
          );
        })}
      </nav>

      {promptUi ? (
        <PromptDialog
          state={promptUi}
          copied={copied}
          onCopy={async (text) => {
            try {
              await navigator.clipboard.writeText(text);
              setCopied(true);
            } catch {
              setCopied(false);
            }
          }}
          onClose={() => setPromptUi(null)}
        />
      ) : null}
    </div>
  );
}

function chatOptions(settings: TableSettings) {
  return {
    provider: settings.provider,
    apiKey: settings.apiKey.trim(),
    model: settings.model.trim(),
  };
}

async function askImagePrompt(settings: TableSettings, messages: ReturnType<typeof buildImageMessages>) {
  return completeChat({
    ...chatOptions(settings),
    temperature: 0.8,
    maxTokens: 400,
    messages,
  });
}

function needMaster(settings: TableSettings): string {
  if (settings.provider === "grok") return "Grok сейчас недоступен.";
  return "Для OpenRouter нужны ключ и модель.";
}

function EmptyTale({
  busy,
  ready,
  provider,
  onOpen,
  onSettings,
}: {
  busy: boolean;
  ready: boolean;
  provider: TableSettings["provider"];
  onOpen: () => void;
  onSettings: () => void;
}) {
  return (
    <div className="card flex flex-col gap-3">
      <h2>Стол накрыт</h2>
      {ready ? (
        <p className="hint">
          {busy ? "Мастер открывает первую сцену." : provider === "grok" ? "Мастер — Grok, ключ не нужен." : "Мастер — OpenRouter."}
        </p>
      ) : (
        <p className="hint">Для OpenRouter нужен ключ. Или переключитесь на Grok — он без ключа.</p>
      )}
      {ready && !busy ? <Button onClick={onOpen}>Открыть сцену</Button> : null}
      {!ready ? (
        <Button variant="ghost" onClick={onSettings}>
          Подключение
        </Button>
      ) : null}
    </div>
  );
}

function ChatEntry({
  message,
  speaking,
  onSpeak,
  onImage,
}: {
  message: Message;
  speaking: boolean;
  onSpeak: () => void;
  onImage: (target: ImageTarget) => void;
}) {
  if (message.role === "table") {
    return message.roll ? <RollLine roll={message.roll} /> : <p className="table-note">{message.text}</p>;
  }
  const master = message.role === "master";
  return (
    <article className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <p className="kicker">{master ? "Мастер" : "Вы"}</p>
        {master ? (
          <div className="flex gap-2">
            <Button variant="ghost" aria-pressed={speaking} onClick={onSpeak}>
              {speaking ? "Стоп" : "Слушать"}
            </Button>
            <Button
              variant="ghost"
              onClick={() => onImage({ type: "scene", title: "Сцена", text: message.text })}
            >
              Промпт
            </Button>
          </div>
        ) : null}
      </div>
      {master ? <Story text={message.text} /> : <p className="player-text">{message.text}</p>}
      {message.roll ? <RollLine roll={message.roll} /> : null}
      {message.ledger && message.ledger.length > 0 ? (
        <ul className="ledger list-none p-0">
          {message.ledger.map((line, index) => (
            <li key={`${index}-${line}`}>{line}</li>
          ))}
        </ul>
      ) : null}
    </article>
  );
}

function Story({ text }: { text: string }) {
  const parts = text
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);
  return (
    <div className="story">
      {parts.map((part, index) => (
        <p key={`${index}-${part.slice(0, 24)}`}>{part}</p>
      ))}
    </div>
  );
}

function RollLine({ roll }: { roll: Roll }) {
  return (
    <p className="roll-card">
      <span>
        {roll.actorName}
        {roll.skill ? ` · ${roll.skill}` : ""} · {roll.statLabel}
      </span>
      <strong>{roll.total}</strong>
      <span className="roll-card-meta">
        {dicePhrase(roll)} · мод. {formatSigned(roll.modifier)}
        {roll.natural === 1 ? " · натуральная 1" : roll.natural === 20 ? " · натуральная 20" : ""}
      </span>
    </p>
  );
}

function PromptDialog({
  state,
  copied,
  onCopy,
  onClose,
}: {
  state: PromptUi;
  copied: boolean;
  onCopy: (text: string) => Promise<void>;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState(state.text);
  useEffect(() => {
    setDraft(capImagePrompt(state.text));
  }, [state.text]);
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

  return (
    <dialog ref={ref} className="modal" aria-labelledby="prompt-title">
      <div className="modal-body">
        <div className="flex items-start justify-between gap-3">
          <h2 id="prompt-title" className="text-3xl">
            {state.title}
          </h2>
          <Button variant="ghost" className="icon-btn" onClick={onClose} aria-label="Закрыть">
            ×
          </Button>
        </div>
        <p className="hint">
          Английский промпт для картинки, не длиннее {IMAGE_PROMPT_LIMIT} символов. На ход за столом не влияет.
        </p>
        {state.loading ? <p className="hint">Собираю промпт…</p> : null}
        {state.error ? <p className="banner">{state.error}</p> : null}
        {state.text ? (
          <>
            <textarea
              className="field min-h-40"
              maxLength={IMAGE_PROMPT_LIMIT}
              value={draft}
              aria-label="Текст промпта"
              onChange={(event) => setDraft(event.target.value.slice(0, IMAGE_PROMPT_LIMIT))}
            />
            <p className="hint">
              {draft.length} / {IMAGE_PROMPT_LIMIT}
            </p>
          </>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" disabled={!draft.trim()} onClick={() => void onCopy(draft)}>
            {copied ? "Скопировано" : "Копировать"}
          </Button>
          <Button onClick={onClose}>Закрыть</Button>
        </div>
      </div>
    </dialog>
  );
}

async function followChecks(raw: string, signal: AbortSignal, hops: number, onRoll: () => void): Promise<void> {
  const check = useRpg.getState().commitMasterReply(raw);
  if (!check || hops <= 0 || signal.aborted) return;
  const state = useRpg.getState();
  const roll = castCheck(check, state.hero, state.companions);
  state.pushTableRoll(roll);
  onRoll();
  useRpg.setState({ busy: true, banner: null });
  const next = await completeChat({
    ...chatOptions(useRpg.getState().settings),
    temperature: 0.9,
    maxTokens: 1400,
    signal,
    messages: buildResolutionRequest(useRpg.getState(), roll),
  });
  if (signal.aborted) return;
  await followChecks(next, signal, hops - 1, onRoll);
}

function useNarration() {
  const [activeId, setActiveId] = useState<string | null>(null);
  const tokenRef = useRef(0);

  const stop = useCallback(() => {
    tokenRef.current += 1;
    if (typeof window !== "undefined" && window.speechSynthesis) window.speechSynthesis.cancel();
    setActiveId(null);
  }, []);

  const speak = useCallback(
    (id: string, text: string) => {
      if (typeof window === "undefined" || !window.speechSynthesis) {
        useRpg.getState().setBanner("На этом устройстве нет голоса для озвучки.");
        return;
      }
      if (activeId === id) {
        stop();
        return;
      }
      const synth = window.speechSynthesis;
      const token = ++tokenRef.current;
      synth.cancel();
      const parts = speechParts(text);
      if (parts.length === 0) return;
      setActiveId(id);
      let started = false;
      const run = () => {
        if (started || token !== tokenRef.current) return;
        started = true;
        const voice = russianVoice(synth);
        let index = 0;
        const step = () => {
          if (token !== tokenRef.current) return;
          if (index >= parts.length) {
            setActiveId((current) => (current === id ? null : current));
            return;
          }
          const utter = new SpeechSynthesisUtterance(parts[index]);
          index += 1;
          utter.lang = "ru-RU";
          utter.rate = 1;
          if (voice) utter.voice = voice;
          utter.onend = step;
          utter.onerror = () => {
            if (token !== tokenRef.current) return;
            setActiveId((current) => (current === id ? null : current));
          };
          synth.speak(utter);
        };
        step();
      };
      if (synth.getVoices().length === 0) {
        const onVoices = () => {
          synth.removeEventListener("voiceschanged", onVoices);
          run();
        };
        synth.addEventListener("voiceschanged", onVoices);
        window.setTimeout(() => {
          synth.removeEventListener("voiceschanged", onVoices);
          run();
        }, 400);
      } else {
        window.setTimeout(run, 60);
      }
    },
    [activeId, stop],
  );

  useEffect(() => {
    return () => {
      tokenRef.current += 1;
      if (typeof window !== "undefined" && window.speechSynthesis) window.speechSynthesis.cancel();
    };
  }, []);

  return { activeId, speak, stop };
}

function speechParts(text: string): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return [];
  const sentences = clean.split(/(?<=[.!?…])\s+/);
  const parts: string[] = [];
  let buf = "";
  for (const sentence of sentences) {
    const next = buf ? `${buf} ${sentence}` : sentence;
    if (next.length > 220 && buf) {
      parts.push(buf);
      buf = sentence;
    } else {
      buf = next;
    }
  }
  if (buf) parts.push(buf);
  return parts;
}

function russianVoice(synth: SpeechSynthesis): SpeechSynthesisVoice | null {
  const voices = synth.getVoices();
  return (
    voices.find((voice) => voice.lang.toLowerCase() === "ru-ru") ??
    voices.find((voice) => voice.lang.toLowerCase().startsWith("ru")) ??
    null
  );
}
