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

// android_ndk_path живёт в common.gypi из заголовков Node, а не в binding.gyp.
// Патчить файл в кэше node-gyp — плохая идея: он перекачивается при смене версии.
// Правильный путь — передать переменную флагом -D на этапе configure.
const NDK_PLACEHOLDER = "/nonexistent-android-ndk";

/**
 * Путь к node-gyp, встроенному в npm.
 * npx node-gyp скачивает пакет заново и ждёт подтверждения «Ok to proceed?» —
 * это ломает неинтерактивную установку. Берём тот, что уже есть.
 */
const resolveNodeGyp = () => {
  // 1. Локальный в проекте (если поставлен как зависимость)
  const local = join(process.cwd(), "node_modules", ".bin", "node-gyp");
  if (existsSync(local)) return { cmd: local, args: [] };

  // 2. Встроенный в npm: <npm-root>/node_modules/node-gyp/bin/node-gyp.js
  try {
    const npmRoot = execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim();
    const bundled = join(npmRoot, "npm", "node_modules", "node-gyp", "bin", "node-gyp.js");
    if (existsSync(bundled)) return { cmd: process.execPath, args: [bundled] };
  } catch {
    /* npm root недоступен — упадём ниже */
  }

  // 3. Последняя попытка: node-gyp из PATH
  return { cmd: "node-gyp", args: [] };
};

const gypRunner = resolveNodeGyp();

process.stdout.write("  компилирую (2–5 минут на телефоне)…\n");
try {
  // configure отдельно — именно здесь разрешаются переменные gyp
  run(gypRunner.cmd, [...gypRunner.args, "configure", `-Dandroid_ndk_path=${NDK_PLACEHOLDER}`], {
    cwd: ptyDir,
  });
  run(gypRunner.cmd, [...gypRunner.args, "build"], { cwd: ptyDir });
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
