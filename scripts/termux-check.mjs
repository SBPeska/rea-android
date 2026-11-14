#!/usr/bin/env node
/**
 * Диагностика REA на Android/Termux.
 * Показывает, что работает, что нет и почему — без догадок.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { platform, arch, release } from "node:os";

const ok = (m) => process.stdout.write(`  ✓ ${m}\n`);
const no = (m) => process.stdout.write(`  ✖ ${m}\n`);
const warn = (m) => process.stdout.write(`  ⚠ ${m}\n`);

const has = (cmd) => {
  try {
    execFileSync("sh", ["-c", `command -v ${cmd}`], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
};

process.stdout.write("\nREA · диагностика окружения\n");
process.stdout.write("──────────────────────────\n\n");

// ── Платформа ───────────────────────────────────────────────────────
process.stdout.write("Платформа\n");
process.stdout.write(`  platform: ${platform()}  arch: ${arch()}\n`);
process.stdout.write(`  node:     ${process.versions.node}\n`);
if (platform() === "android") ok("Android обнаружен — режим Termux");
else warn(`Не Android (${platform()}). Скрипт рассчитан на Termux.`);
if (arch() === "arm64") ok("arm64 — поддерживаемая архитектура");
else warn(`arch ${arch()}: ожидается arm64`);

// ── libc ────────────────────────────────────────────────────────────
process.stdout.write("\nБиблиотека C\n");
const isTermux = Boolean(process.env.PREFIX?.includes("com.termux"));
if (isTermux) {
  ok("Termux (bionic) — node-pty должен быть собран из исходников");
  if (existsSync(`${process.env.PREFIX}/lib/libtermux-exec.so`))
    ok("libtermux-exec найден (нужен для Chromium)");
  else warn("libtermux-exec отсутствует — браузерные сценарии не запустятся");
} else {
  warn("Не похоже на Termux");
}

// ── node-pty ────────────────────────────────────────────────────────
process.stdout.write("\nPTY (захват процессов)\n");
try {
  const out = execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
      const { spawn } = await import("node-pty");
      const t = spawn("/bin/sh", ["-c", "exit 0"], {
        cwd: process.env.HOME || "/",
        env: { HOME: process.env.HOME || "/", TERM: "xterm-256color" },
        cols: 80, rows: 24, name: "xterm-256color",
      });
      await new Promise((r) => t.onExit(() => r()));
      process.stdout.write("ok");
      `,
    ],
    { encoding: "utf8" },
  );
  if (out.includes("ok")) ok("node-pty загружается и работает");
  else warn(`node-pty ответил неожиданно: ${out.slice(0, 80)}`);
} catch (e) {
  no("node-pty не работает");
  const msg = String(e.stderr || e.message || "");
  // Разбираем причину по тексту ошибки и даём конкретную команду.
  if (/NODE_MODULE_VERSION|different Node|compiled against/i.test(msg))
    process.stdout.write(
      "     → модуль собран под другую версию Node\n" +
        "       пересоберите: npm run termux:install\n",
    );
  else if (/GLIBC|version `GLIBC/i.test(msg))
    process.stdout.write(
      "     → собран под glibc, а Android использует bionic\n" +
        "       нужна сборка из исходников: npm run termux:install\n",
    );
  else if (/Failed to load native module|Cannot find module.*pty\.node/i.test(msg))
    process.stdout.write(
      "     → pty.node не собран\n" +
        "       запустите: npm run termux:install\n" +
        "       если падает на gyp — пришлите вывод шага [4/5]\n",
    );
  else if (/cannot open shared object/i.test(msg))
    process.stdout.write("     → не хватает системной библиотеки: pkg install libutil\n");
  else if (/EACCES|Permission denied/i.test(msg))
    process.stdout.write("     → нет прав на исполнение: chmod +x node_modules/node-pty/build/Release/pty.node\n");
  else process.stdout.write(`     → ${msg.split("\n")[0].slice(0, 140)}\n`);
}

// ── Системные инструменты ───────────────────────────────────────────
process.stdout.write("\nСистемные инструменты\n");
const tools = {
  git: "обязателен",
  jadx: "анализ APK",
  apktool: "ресурсы APK",
  binwalk: "прошивки",
  objdump: "дизассемблер (binutils)",
  readelf: "ELF-заголовки (binutils)",
  tshark: "pcap (тяжёлый, часто отсутствует)",
  adb: "android-устройства",
};
for (const [t, why] of Object.entries(tools)) {
  if (has(t)) ok(`${t} — ${why}`);
  else warn(`${t} отсутствует — ${why} недоступен`);
}

// ── Итог ────────────────────────────────────────────────────────────
process.stdout.write("\n──────────────────────────\n");
process.stdout.write(
  "Статический анализ бинарников, APK, IL2CPP, Godot, WASM, .NET — работает.\n" +
    "Захват процессов и браузер — зависит от PTY и libtermux-exec выше.\n" +
    "Динамика через внешние x64-утилиты (tshark, pwntools) — недоступна на arm64.\n\n",
);
