/**
 * Определение формы конфига OpenCode (V1 или V2).
 *
 * Зачем нужно. У OpenCode две несовместимые раскладки MCP-серверов:
 *   V1:  { "mcp": { "<имя>": { ... } } }
 *   V2:  { "mcp": { "servers": { "<имя>": { ... } } } }
 *
 * Парсер определяет форму по содержимому файла. Но пустой конфиг не даёт
 * никаких признаков, и тогда выбор падает на V1 — сервер записывается
 * туда, откуда V2-клиент его не читает. Пользователь видит пустую панель
 * MCP и не понимает, почему установка «прошла успешно».
 *
 * Здесь форма определяется по самой установленной версии, а не по догадке.
 * Если версию узнать не удалось — возвращается undefined, и парсер
 * откатывается к структурному определению (поведение upstream).
 */
import { execFileSync } from "node:child_process";

import type { OpenCodeDialect } from "./ClientConfigurationDocument.js";

/** Первая major-версия, где MCP-серверы переехали под `mcp.servers`. */
const V2_MAJOR = 2;

/**
 * Разбирает вывод `opencode --version`.
 * Принимает как «2.1.3», так и «opencode 2.1.3» и префикс `v`.
 */
export const dialectFromVersion = (
  output: string,
): OpenCodeDialect | undefined => {
  const match = /\d+\.\d+(?:\.\d+)?/u.exec(output);
  if (match === null) return undefined;
  const major = Number.parseInt(match[0].split(".")[0] ?? "", 10);
  if (Number.isNaN(major)) return undefined;
  return major >= V2_MAJOR ? "v2" : "v1";
};

/**
 * Определяет форму конфига по установленному клиенту.
 * Возвращает undefined, если бинарник недоступен или версия не разобрана —
 * вызывающая сторона тогда использует структурное определение.
 */
export const detectOpenCodeDialect = (
  command = "opencode",
): OpenCodeDialect | undefined => {
  try {
    const out = execFileSync(command, ["--version"], {
      encoding: "utf8",
      timeout: 5_000,
      stdio: ["ignore", "pipe", "ignore"],
    });
    return dialectFromVersion(out);
  } catch {
    return undefined;
  }
};
