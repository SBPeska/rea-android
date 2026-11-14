#!/usr/bin/env node
/**
 * Установка REA в Termux (Android, без root).
 *
 * Отличия от обычного npm install:
 *  1. node-pty собирается из исходников под bionic (Android libc),
 *     потому что готовые prebuilds линкуются на glibc и не загружаются.
 *  2. Ставятся инструменты из репозитория Termux, которых нет в npm.
 *  3. Проверяется, что PTY реально работает, а не просто «установился».
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { platform } from "node:os";

const run = (cmd, args, opts = {}) => {
  process.stdout.write(`\n▸ ${cmd} ${args.join(" ")}\n`);
  execFileSync(cmd, args, { stdio: "inherit", ...opts });
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

// ── Проверки окружения ──────────────────────────────────────────────
if (platform() !== "android") {
  process.stderr.write(
    "\n⚠ Этот скрипт для Android/Termux. На обычном Linux используйте `npm install`.\n" +
      "  Продолжаю через 3 секунды — остановите Ctrl+C, если это ошибка.\n",
  );
  execFileSync("sleep", ["3"], { stdio: "inherit" });
}

if (!process.env.PREFIX?.includes("com.termux")) {
  process.stderr.write(
    "\n⚠ Переменная PREFIX не похожа на Termux. Скрипт рассчитан на Termux с F-Droid.\n",
  );
}

// ── Компилятор для node-pty ─────────────────────────────────────────
const needTools = ["clang", "make", "python", "node", "npm"];
const missing = needTools.filter((t) => !has(t));
if (missing.length > 0) {
  process.stdout.write(`\n▸ Ставлю отсутствующие инструменты: ${missing.join(", ")}\n`);
  run("pkg", ["install", "-y", "clang", "make", "python", "nodejs"]);
}

// ── node-pty из исходников ──────────────────────────────────────────
process.stdout.write(
  "\n▸ Собираю node-pty под bionic (это займёт 2–5 минут на телефоне)\n",
);
try {
  run("npm", ["install", "--build-from-source", "node-pty"], {
    env: { ...process.env, npm_config_build_from_source: "true" },
  });
} catch {
  fail(
    "node-pty не собрался. Проверьте, что clang и python доступны: `pkg install clang python`",
  );
}

// ── Остальные зависимости ───────────────────────────────────────────
process.stdout.write("\n▸ Ставлю зависимости пакета\n");
run("npm", ["install", "--ignore-scripts=false"]);

// ── Проверка, что PTY реально грузится ──────────────────────────────
process.stdout.write("\n▸ Проверяю, что PTY загружается\n");
try {
  execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
      const { spawn } = await import("node-pty");
      const t = spawn("/bin/sh", ["-c", "echo ok"], {
        cwd: process.env.HOME || "/",
        env: { HOME: process.env.HOME || "/", TERM: "xterm-256color" },
        cols: 80, rows: 24, name: "xterm-256color",
      });
      await new Promise((r) => t.onExit(() => r()));
      console.log("PTY работает");
      `,
    ],
    { stdio: "inherit" },
  );
} catch (e) {
  process.stderr.write(
    "\n⚠ PTY не прошёл проверку. Возможные причины:\n" +
      "  · node-pty собран под другую версию Node (пересоберите: npm rebuild node-pty)\n" +
      "  · не хватает libutil — установите: pkg install libutil\n",
  );
  process.exitCode = 1;
}

// ── Инструменты Termux, которых нет в npm ───────────────────────────
process.stdout.write("\n▸ Ставлю системные инструменты (можно пропустить Ctrl+C)\n");
const pkgTools = ["jadx", "apktool", "binwalk", "git", "binutils"];
try {
  run("pkg", ["install", "-y", ...pkgTools]);
} catch {
  process.stderr.write("⚠ Часть инструментов не установилась — REA будет работать без них.\n");
}

process.stdout.write(
  "\n✓ Готово.\n" +
    "  Запуск:      npx rea-agents setup\n" +
    "  Проверка:    npm run termux:check\n" +
    "  Документация: README.md, раздел «Android / Termux»\n\n",
);
