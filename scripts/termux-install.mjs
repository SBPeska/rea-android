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
process.stdout.write("\n[1/5] Проверка окружения\n");
if (platform() !== "android") {
  process.stderr.write("  ⚠ Не Android. Скрипт рассчитан на Termux.\n");
}
if (!process.env.PREFIX?.includes("com.termux")) {
  process.stderr.write("  ⚠ PREFIX не похож на Termux.\n");
}
process.stdout.write(`  node: ${process.versions.node}  arch: ${process.arch}\n`);

// ── 2. Инструменты сборки ───────────────────────────────────────────
process.stdout.write("\n[2/5] Инструменты сборки\n");
const need = ["clang", "make", "python"];
const missing = need.filter((t) => !has(t));
if (missing.length > 0) {
  process.stdout.write(`  ставлю: ${missing.join(", ")}\n`);
  run("pkg", ["install", "-y", "clang", "make", "python", "libutil"]);
} else {
  process.stdout.write("  clang, make, python — на месте\n");
}

// ── 3. Зависимости проекта ──────────────────────────────────────────
process.stdout.write("\n[3/5] Зависимости проекта (npm ci)\n");
if (!existsSync("node_modules") || !existsSync("node_modules/node-pty")) {
  run("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund"]);
} else {
  process.stdout.write("  уже установлены\n");
}

// ── 4. Патч binding.gyp и сборка node-pty ───────────────────────────
process.stdout.write("\n[4/5] Сборка node-pty под bionic\n");
const ptyDir = join(process.cwd(), "node_modules", "node-pty");
const gypPath = join(ptyDir, "binding.gyp");

if (!existsSync(gypPath)) {
  fail("node_modules/node-pty/binding.gyp не найден. Запустите npm install.");
}

let gyp = readFileSync(gypPath, "utf8");

// Подставляем android_ndk_path, если его ещё нет
if (!gyp.includes("android_ndk_path%")) {
  const variablesBlock = `{
  'variables': {
    # Termux: NDK не нужен, собираем против bionic из состава ОС.
    # Значение должно быть непустым, иначе gyp падает на common.gypi.
    'android_ndk_path%': '/nonexistent-android-ndk',
  },
`;
  // Заменяем первый '{' в начале файла на блок с variables
  gyp = gyp.replace(/^\s*\{/, variablesBlock);
  writeFileSync(gypPath, gyp, "utf8");
  process.stdout.write("  ✓ binding.gyp пропатчен (android_ndk_path)\n");
} else {
  process.stdout.write("  ✓ binding.gyp уже пропатчен\n");
}

process.stdout.write("  компилирую (2–5 минут на телефоне)…\n");
try {
  run("npx", ["node-gyp", "rebuild"], {
    cwd: ptyDir,
    env: { ...process.env, npm_config_build_from_source: "true" },
  });
  process.stdout.write("  ✓ node-pty собран\n");
} catch {
  fail(
    "node-pty не собрался.\n" +
      "  Проверьте: pkg install clang make python libutil\n" +
      "  Лог: node_modules/node-pty/build/Release/obj.target\n",
  );
}

// ── 5. Проверка, что PTY грузится ───────────────────────────────────
process.stdout.write("\n[5/5] Проверка PTY\n");
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

// ── Итог ────────────────────────────────────────────────────────────
process.stdout.write(
  "\n✓ Установка завершена.\n" +
    "  Дальше:  npx rea-agents setup\n" +
    "  Проверка: npm run termux:check\n\n",
);
