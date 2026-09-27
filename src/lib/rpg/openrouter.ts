import type { ChatMsg } from "./prompt.ts";
import { askGrok, probeGrok } from "./grok.ts";
import type { Provider } from "./types.ts";

export type ProbeResult = { ok: boolean; detail: string };

export async function probeConnection(settings: {
  provider: Provider;
  apiKey: string;
  model: string;
}): Promise<ProbeResult> {
  if (settings.provider === "grok") {
    try {
      const result = await probeGrok({ data: {} });
      if (result.ok) return { ok: true, detail: "Grok подключён. Дальше отвечает он." };
      return { ok: false, detail: result.error };
    } catch {
      return { ok: false, detail: "Не удалось подключиться к Grok." };
    }
  }
  const key = settings.apiKey.trim();
  const model = settings.model.trim();
  if (!key) return { ok: false, detail: "Выбран OpenRouter, но ключ ещё не вписан." };
  if (!model) return { ok: false, detail: "Выбран OpenRouter, но модель не указана." };
  try {
    const response = await fetch("https://openrouter.ai/api/v1/key", {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (response.status === 401 || response.status === 403) {
      await response.arrayBuffer().catch(() => undefined);
      return { ok: false, detail: "Выбран OpenRouter, но ключ не принят. Проверьте его." };
    }
    if (!response.ok) {
      await response.arrayBuffer().catch(() => undefined);
      return { ok: false, detail: `Не удалось подключиться к OpenRouter (${response.status}).` };
    }
    await response.arrayBuffer().catch(() => undefined);
    return {
      ok: true,
      detail: `OpenRouter подключён, модель ${model}. Следующий ход пойдёт через него.`,
    };
  } catch {
    return { ok: false, detail: "Не удалось подключиться к OpenRouter. Проверьте сеть." };
  }
}

export function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}

export function errorText(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "Не удалось получить ответ мастера.";
}

function aborted(): Error {
  const error = new DOMException("Aborted", "AbortError");
  return error;
}

export async function completeChat(options: {
  provider: Provider;
  apiKey: string;
  model: string;
  messages: ChatMsg[];
  temperature: number;
  maxTokens: number;
  signal?: AbortSignal;
}): Promise<string> {
  if (options.signal?.aborted) throw aborted();
  if (options.provider === "grok") return completeGrok(options);
  return completeOpenRouter(options);
}

async function completeGrok(options: {
  messages: ChatMsg[];
  temperature: number;
  maxTokens: number;
  signal?: AbortSignal;
}): Promise<string> {
  const result = await askGrok({
    data: {
      messages: options.messages,
      temperature: options.temperature,
      maxTokens: options.maxTokens,
    },
  });
  if (options.signal?.aborted) throw aborted();
  if (!result.ok) throw new Error(result.error);
  return result.text;
}

async function completeOpenRouter(options: {
  apiKey: string;
  model: string;
  messages: ChatMsg[];
  temperature: number;
  maxTokens: number;
  signal?: AbortSignal;
}): Promise<string> {
  const payload: Record<string, unknown> = {
    model: options.model,
    temperature: options.temperature,
    max_tokens: options.maxTokens,
    messages: options.messages,
  };
  const response = await postOpenRouter(options, payload);

  const body = await response.text();
  if (!response.ok) throw new Error(explainStatus(response.status, body));

  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch {
    throw new Error("OpenRouter вернул не JSON.");
  }
  const text = readContent(data);
  if (!text) throw new Error("Модель вернула пустой ответ.");
  return text;
}

async function postOpenRouter(
  options: { apiKey: string; signal?: AbortSignal },
  payload: Record<string, unknown>,
): Promise<Response> {
  try {
    return await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      signal: options.signal,
      headers: {
        Authorization: `Bearer ${options.apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": typeof window !== "undefined" ? window.location.origin : "https://letopis.app",
        "X-Title": "Letopis",
      },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw new Error("Нет соединения с OpenRouter. Запрос идёт из браузера напрямую — проверьте сеть.");
  }
}

function explainStatus(status: number, body: string): string {
  const detail = readError(body);
  if (status === 401) return "OpenRouter отклонил ключ. Проверьте его в настройках.";
  if (status === 402) return "На ключе OpenRouter не хватает кредита.";
  if (status === 404) return detail || "Модель не найдена. Проверьте id в настройках.";
  if (status === 429) return "OpenRouter просит подождать: слишком много запросов.";
  return detail || `Ошибка OpenRouter (${status}).`;
}

function readError(body: string): string {
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string }; message?: string };
    return parsed.error?.message || parsed.message || "";
  } catch {
    return body.trim().slice(0, 280);
  }
}

function readContent(data: unknown): string {
  if (!data || typeof data !== "object") return "";
  const choices = (data as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || !choices[0] || typeof choices[0] !== "object") return "";
  const message = (choices[0] as { message?: unknown }).message;
  if (!message || typeof message !== "object") return "";
  const row = message as { content?: unknown; reasoning?: unknown; reasoning_content?: unknown };
  const content = visibleText(row.content);
  if (content) return content;
  const reasoning = typeof row.reasoning_content === "string" ? row.reasoning_content : row.reasoning;
  return visibleText(reasoning);
}

function visibleText(content: unknown): string {
  const raw = Array.isArray(content)
    ? content
        .map((part) => {
          if (typeof part === "string") return part;
          if (!part || typeof part !== "object") return "";
          const row = part as { type?: unknown; text?: unknown };
          if (row.type === "reasoning" || row.type === "thinking") return "";
          return typeof row.text === "string" ? row.text : "";
        })
        .join("\n")
    : typeof content === "string"
      ? content
      : "";
  return raw.replace(/<think>[\s\S]*?<\/think>/gi, " ").replace(/<\/?think>/gi, " ").trim();
}
