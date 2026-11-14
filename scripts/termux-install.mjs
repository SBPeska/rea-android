#!/usr/bin/env node
/**
 * Установка REA в Termux (Android, без root).
 *
 * Ключевой момент: node-pty собирается из исходников под bionic.
 * Готовые prebuilds (@lydell/node-pty) слинкованы с glibc и не загружаются.
 *
 * При сборке под Android Node headers требуют переменную android_ndk_path,
 * которой в Termux нет — gyp падает до компиляции. Скрипт подставляет
 * значение в binding.gyp перед сборкой.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { platform } from "node:os";
import { join } from "node:path";

const run = (cmd, args, opts = {}) => {
  process.stdout.write(`\n▸ ${cmd} ${args.join(" ")}\n`);
  return execFileSync(cmd, args, { stdio: "inherit", ...opts });
};

const has = (cmd) => {
  try {
    execFileSync("sh", ["-c", `command -v ${cmd}`], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
};

const fail = (msg) => {
  process.stderr.write(`\n✖ ${msg}\n`);
  process.exit(1);
};

// ── 1. Окружение ────────────────────────────────────────────────────
process.stdout.write("\n[1/6] Проверка окружения\n");
if (platform() !== "android") {
  process.stderr.write("  ⚠ Не Android. Скрипт рассчитан на Termux.\n");
}
if (!process.env.PREFIX?.includes("com.termux")) {
  process.stderr.write("  ⚠ PREFIX не похож на Termux.\n");
}
process.stdout.write(`  node: ${process.versions.node}  arch: ${process.arch}\n`);

// ── 2. Инструменты сборки ───────────────────────────────────────────
process.stdout.write("\n[2/6] Инструменты сборки\n");
const need = ["clang", "make", "python"];
const missing = need.filter((t) => !has(t));
const inTermux = Boolean(process.env.PREFIX?.includes("com.termux"));

if (missing.length === 0) {
  process.stdout.write("  clang, make, python — на месте\n");
} else if (inTermux && has("pkg")) {
  process.stdout.write(`  ставлю через pkg: ${missing.join(", ")}\n`);
  run("pkg", ["install", "-y", "clang", "make", "python", "libutil"]);
} else {
  // Не Termux и не хватает инструментов — подсказываем, но не падаем:
  // на CI/GitHub Actions компилятор обычно уже есть.
  process.stderr.write(
    `  ⚠ нет: ${missing.join(", ")}\n` +
      "    в Termux: pkg install clang make python libutil\n" +
      "    в Debian/Ubuntu: apt install build-essential python3\n",
  );
}

// ── 3. Зависимости проекта ──────────────────────────────────────────
process.stdout.write("\n[3/6] Зависимости проекта (npm ci)\n");
if (!existsSync("node_modules") || !existsSync("node_modules/node-pty")) {
  run("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund"]);
} else {
  process.stdout.write("  уже установлены\n");
}

// ── 4. Патч binding.gyp и сборка node-pty ───────────────────────────
process.stdout.write("\n[4/6] Сборка node-pty под bionic\n");
const ptyDir = join(process.cwd(), "node_modules", "node-pty");
const gypPath = join(ptyDir, "binding.gyp");

if (!existsSync(gypPath)) {
  fail("node_modules/node-pty/binding.gyp не найден. Запустите npm install.");
}

// ── Патч common.gypi в кэше node-gyp ────────────────────────────────
// Переменная android_ndk_path читается из common.gypi в заголовках Node.
// Флаг -D до неё не доходит: node-gyp передаёт его в configure, но
// переменная раскрывается раньше, при загрузке зависимостей binding.gyp.
// Правильное место — сам файл заголовков.
const NDK_PLACEHOLDER = "/nonexistent-android-ndk";

/**
 * Путь к node-gyp, встроенному в npm.
 * npx node-gyp скачивает пакет заново и ждёт «Ok to proceed?» —
 * это ломает неинтерактивную установку.
 */
const resolveNodeGyp = () => {
  const local = join(process.cwd(), "node_modules", ".bin", "node-gyp");
  if (existsSync(local)) return { cmd: local, args: [] };

  try {
    const npmRoot = execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim();
    const bundled = join(npmRoot, "npm", "node_modules", "node-gyp", "bin", "node-gyp.js");
    if (existsSync(bundled)) return { cmd: process.execPath, args: [bundled] };
  } catch {
    /* npm root недоступен */
  }

  return { cmd: "node-gyp", args: [] };
};

const gypRunner = resolveNodeGyp();

const findCommonGypi = () => {
  const cacheRoot = join(process.env.HOME || "/root", ".cache", "node-gyp");
  if (!existsSync(cacheRoot)) return null;
  // Каталог кэша называется по версии Node: 24.17.0
  const version = process.versions.node;
  const direct = join(cacheRoot, version, "include", "node", "common.gypi");
  if (existsSync(direct)) return direct;
  // На всякий случай — ищем любой common.gypi
  try {
    const found = execFileSync("sh", ["-c", `find "${cacheRoot}" -name common.gypi 2>/dev/null | head -1`], {
      encoding: "utf8",
    }).trim();
    return found || null;
  } catch {
    return null;
  }
};

process.stdout.write("  патчу заголовки Node (common.gypi)…\n");
const commonGypi = findCommonGypi();
// Оригинал снимаем ДО патча — иначе откат вернёт пропатченную версию.
let commonBackup = null;
if (commonGypi && existsSync(commonGypi)) {
  commonBackup = readFileSync(commonGypi, "utf8");
}
if (!commonGypi) {
  process.stderr.write(
    "  ⚠ common.gypi не найден в кэше node-gyp.\n" +
      "    Сначала запустите configure один раз, чтобы заголовки скачались:\n" +
      "    cd node_modules/node-pty && npx node-gyp configure\n",
  );
} else {
  let cg = readFileSync(commonGypi, "utf8");
  if (cg.includes("android_ndk_path%")) {
    process.stdout.write(`  ✓ уже пропатчен: ${commonGypi}\n`);
  } else {
    const anchor = "  'variables': {";
    if (!cg.includes(anchor)) {
      process.stderr.write(`  ⚠ нестандартный common.gypi, пропускаю: ${commonGypi}\n`);
    } else {
      cg = cg.replace(
        anchor,
        `${anchor}\n    # Termux: NDK не нужен, собираем против bionic из состава ОС.\n    'android_ndk_path%': '${NDK_PLACEHOLDER}',`,
      );
      writeFileSync(commonGypi, cg, "utf8");
      process.stdout.write(`  ✓ пропатчен: ${commonGypi}\n`);
    }
  }
}

process.stdout.write("  компилирую (2–5 минут на телефоне)…\n");

try {
  run(gypRunner.cmd, [...gypRunner.args, "configure"], { cwd: ptyDir });
  run(gypRunner.cmd, [...gypRunner.args, "build"], { cwd: ptyDir });
  process.stdout.write("  ✓ node-pty собран\n");
} catch (err) {
  // Показываем реальную причину, а не общую фразу.
  const detail =
    err?.stderr?.toString?.()?.trim() ||
    err?.stdout?.toString?.()?.trim() ||
    err?.message ||
    "причина неизвестна";
  process.stderr.write(`\n  причина: ${String(detail).split("\n").slice(-6).join("\n  ")}\n`);
  fail(
    "node-pty не собрался.\n" +
      `  команда: ${gypRunner.cmd} ${gypRunner.args.join(" ")}\n` +
      "  Проверьте: pkg install clang make python libutil\n" +
      "  Полный лог: node_modules/node-pty/build/Release/obj.target\n",
  );
} finally {
  // Возвращаем common.gypi в исходное состояние: патч был нужен
  // только для этой сборки.
  if (commonBackup !== null && commonGypi) {
    try {
      writeFileSync(commonGypi, commonBackup, "utf8");
      process.stdout.write("  заголовки Node восстановлены\n");
    } catch {
      process.stderr.write("  ⚠ не удалось откатить common.gypi\n");
    }
  }
}

// ── 5. Проверка, что PTY грузится ───────────────────────────────────
process.stdout.write("\n[5/6] Проверка PTY\n");
try {
  const out = execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
      const { spawn } = await import("node-pty");
      const t = spawn("/bin/sh", ["-c", "echo PTY_OK"], {
        cwd: process.env.HOME || "/",
        env: { HOME: process.env.HOME || "/", TERM: "xterm-256color" },
        cols: 80, rows: 24, name: "xterm-256color",
      });
      let buf = "";
      t.onData((d) => (buf += d));
      await new Promise((r) => t.onExit(() => r()));
      process.stdout.write(buf.includes("PTY_OK") ? "ok" : "no");
      `,
    ],
    { encoding: "utf8" },
  );
  if (out.includes("ok")) {
    process.stdout.write("  ✓ PTY работает — захват процессов доступен\n");
  } else {
    process.stderr.write("  ⚠ PTY загрузился, но не выполнил команду\n");
    process.exitCode = 1;
  }
} catch (e) {
  process.stderr.write("  ✖ PTY не работает\n");
  const msg = String(e.stderr || e.message || "");
  if (/NODE_MODULE_VERSION|different Node/i.test(msg))
    process.stderr.write("     → пересоберите: npm rebuild node-pty\n");
  else if (/cannot open shared object/i.test(msg))
    process.stderr.write("     → pkg install libutil\n");
  else process.stderr.write(`     → ${msg.split("\n")[0].slice(0, 140)}\n`);
  process.exitCode = 1;
}

// ── Сборка dist ─────────────────────────────────────────────────────
// Без dist команда `rea` падает с «compiled runtime is missing».
// На телефоне используем build:termux — он берёт typescript-termux
// и не тянет turbo, который на Android работает нестабильно.
process.stdout.write("\n[6/6] Сборка runtime (dist)\n");
const distPath = join(process.cwd(), "dist");
if (existsSync(distPath) && existsSync(join(distPath, "index.js"))) {
  process.stdout.write("  dist уже собран\n");
} else {
  process.stdout.write(
    "  компилирую TypeScript (10–25 минут на телефоне, это нормально)…\n",
  );
  try {
    run("npm", ["run", "compile:termux"]);
    process.stdout.write("  ✓ dist собран\n");
  } catch {
    fail(
      "Сборка dist не прошла.\n" +
        "  Попробуйте вручную:\n" +
        "    npm run compile:termux\n" +
        "  Если не хватает памяти — закройте приложения и повторите.\n",
    );
  }
}

// ── Итог ────────────────────────────────────────────────────────────
process.stdout.write(
  "\n✓ Установка завершена.\n" +
    "  Запуск:   npx rea-agents setup\n" +
    "  Проверка: npm run termux:check\n\n",
);
