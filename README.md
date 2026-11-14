# REA for Android / Termux

Нативный форк [morluto/rea](https://github.com/morluto/rea) для работы на Android без root.
Ставится в [Termux](https://f-droid.org/packages/com.termux/), запускается с телефона,
не требует proot, эмуляции x86 и виртуальной машины.

```
pkg install git nodejs-lts -y
git clone https://github.com/Zibin2004/rea-android
cd rea-android
npm run termux:install
npm run termux:check
npx rea-agents setup
```

---

## Зачем форк, если upstream умеет Termux

Upstream действительно тестирует Termux: есть скрипты `build:termux`, `typescript-termux`
и CI на эмуляторе Android 11. Но одна вещь там не работает.

**PTY.** Захват процессов построен на `@lydell/node-pty` — форке с готовыми бинарниками.
Он поставляет `pty.node` под `linux-arm64`, слинкованный с glibc:

```
ld-linux-aarch64.so.1 · libc.so.6 · libutil.so.1 · GLIBC_2.17, 2.28
```

Android использует **bionic**, а не glibc. Бинарник не загружается. Upstream это
переживает: `probeProcessCaptureCapability` возвращает `available: false` и пишет
внятную причину. То есть REA запускается, но **захват процессов не работает** —
молча, с деградацией.

Этот форк закрывает ровно эту дыру: `node-pty` собирается **из исходников под bionic**
прямо на телефоне. PTY работает, захват процессов тоже.

## Что изменено относительно upstream

| Файл | Изменение |
| --- | --- |
| `package.json` | `@lydell/node-pty` → `node-pty@^1.1.0` (сборка из исходников) |
| `package.json` | `engines.node` ослаблен до `>=22.18.0` — Termux ставит 26.x |
| `src/process/capture/*.ts` | импорты `@lydell/node-pty` → `node-pty` (6 файлов) |
| `scripts/termux-install.mjs` | установщик: компилирует node-pty, ставит системные пакеты, проверяет PTY |
| `scripts/termux-check.mjs` | диагностика: что работает, что нет и почему |
| `README.md` | этот файл |

Всё остальное — код upstream без изменений. API `node-pty` совместим с `@lydell/node-pty`,
тип `IPty` тот же, поэтому правки в бизнес-логике не потребовались.

## Требования

- Android 7+, **arm64** (проверить: `uname -m` → `aarch64`)
- Termux **с F-Droid**, не из Play Store
- 2 ГБ свободного места (сборка node-pty + зависимости)
- Node 22.18+

## Установка

```bash
# 1. Termux с F-Droid, затем:
pkg update -y && pkg upgrade -y
pkg install git nodejs-lts clang make python -y

# 2. Клонируем
git clone https://github.com/Zibin2004/rea-android
cd rea-android

# 3. Ставим: соберёт node-pty под bionic (~2-5 минут)
npm run termux:install

# 4. Проверяем окружение
npm run termux:check

# 5. Мастер настройки
npx rea-agents setup
```

## Диагностика

`npm run termux:check` показывает по пунктам:

```
Платформа
  platform: android  arch: arm64
  node:     26.13.1
  ✓ Android обнаружен — режим Termux
  ✓ arm64 — поддерживаемая архитектура

Библиотека C
  ✓ Termux (bionic) — node-pty должен быть собран из исходников
  ✓ libtermux-exec найден (нужен для Chromium)

PTY (захват процессов)
  ✓ node-pty загружается и работает

Системные инструменты
  ✓ git — обязателен
  ✓ jadx — анализ APK
  ⚠ tshark отсутствует — pcap недоступен
```

Если PTY не работает — скрипт скажет почему: несовпадение версии Node,
сборка под glibc, отсутствие libutil. Без догадок.

## Что работает на Android

**Полностью, без внешних зависимостей** (встроенный статический анализ):

| Формат | Что извлекается |
| --- | --- |
| ELF / PE / Mach-O | секции, сегменты, символы, хардening (PIE, NX, RELRO, CFG) |
| Go-бинарники | версия компилятора, модули, build settings |
| Rust | cargo-auditable crate, версии, зависимости |
| IL2CPP (Unity) | global-metadata.dat, типы, методы, индексы |
| Godot PCK | инвентарь архива, извлечение, заголовки |
| WASM | валидация, секции, WAT |
| .NET | метаданные, CIL, зависимости |
| Erlang BEAM | чанки, атомы, экспорты |
| Подписи APK | v1/v2/v3/v3.1, отпечатки, key rotation |
| Flutter APK | хэш снапшота, дайджесты по ABI |
| GGUF / safetensors | метаданные моделей, тензоры |
| PE-сертификаты | Authenticode, PKCS#7, X.509 |
| PE-импорты | DLL, ординалы, IAT RVA |
| Windows .lnk | цель, аргументы, ExtraData |
| IPS-крэши | потоки, регистры, классы |
| Модули ядра Linux | modinfo, CRCs, подпись |

**Через пакеты Termux** (нужно `pkg install`):

| Инструмент | Пакет | Для чего |
| --- | --- | --- |
| `jadx` | `jadx` | декомпиляция APK |
| `apktool` | `apktool` | ресурсы APK |
| `binwalk` | `binwalk` | прошивки |
| `objdump`, `readelf` | `binutils` | дизассемблер, ELF |

**Не работает** — инструменты собраны под x64 Linux:

`tshark` (pcap), `mitmdump`, `pwntools`, `sigrok-cli`, полный `adb`-анализ
с jadx на x64, EVM-байткод, JEB. Для этих сценариев нужна x64-машина.

## Браузерные сценарии

Работают через Termux-сборку Chromium. Код upstream уже учитывает две
особенности Android:

- `LD_PRELOAD=libtermux-exec.so` — Android запрещает `execve` бинарников
  из app-директории Termux, интерсептор это обходит
- `--single-process` — Chromium не может создать renderer-процесс через
  границу исполняемых файлов Android

Ограничение: песочница Chromium на Android отключена
(`chromiumSandboxEnabled` возвращает `false` для `platform === "android"`).

## Обновление из upstream

```bash
git remote add upstream https://github.com/morluto/rea
git fetch upstream
git merge upstream/main
```

Конфликты будут в `package.json` (зависимость, engines) и в шести файлах
`src/process/capture/`. Разрешаются в пользу форка: `node-pty` вместо
`@lydell/node-pty`.

После обновления — пересобрать нативную часть:

```bash
npm run termux:install
```

## Безопасность

REA анализирует потенциально враждебные файлы. На телефоне это означает:
разбираемый бинарник и REA работают под одним UID.

Рекомендация upstream остаётся в силе — не запускайте анализ неизвестных
бинарников на устройстве, где лежат ваши ключи и переписка. Для подозрительных
образцов используйте отдельное устройство или изолированную среду.

## Лицензия

MIT, как у upstream. Оригинал: © morluto и участники проекта.
Изменения форка распространяются на тех же условиях.

Форк не связан с авторами upstream. Вопросы по Android-сборке — в issues
этого репозитория; вопросы по самой REA — в [morluto/rea](https://github.com/morluto/rea).
