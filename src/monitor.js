import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { ARTIFACTS_DIR, CITY, STREET, HOUSE, SHUTDOWNS_PAGE } from "./constants.js";

import { getCurrentTime } from "./helpers.js";
import { handleInfo } from "./pipeline.js";

async function ensureArtifactsDir() {
  await fs.mkdir(ARTIFACTS_DIR, { recursive: true });
}

async function writeArtifact(name, content) {
  await ensureArtifactsDir();
  const filePath = path.join(ARTIFACTS_DIR, name);
  await fs.writeFile(filePath, content);
  return filePath;
}

// Робота зі сторінкою окремо від запуску браузера: у тестах сюди передається
// page з перехопленими запитами (page.route), без звернень до ДТЕК.
// Таймаути винесені в параметри, щоб тести не чекали їх цілком.
export async function fetchShutdowns(
  page,
  { navigationTimeout = 30000, settleMs = 2000, selectorTimeout = 15000 } = {}
) {
  await page.goto(SHUTDOWNS_PAGE, { waitUntil: "networkidle", timeout: navigationTimeout });

  // Дочекаємось стабілізації сторінки
  await page.waitForTimeout(settleMs);

  const csrfTokenTag = await page.waitForSelector('meta[name="csrf-token"]', {
    state: "attached",
    timeout: selectorTimeout,
  });

  const csrfToken = await csrfTokenTag.getAttribute("content");
  console.log("DEBUG csrfToken length:", (csrfToken || "").length);

  const result = await page.evaluate(
    async ({ CITY, STREET, csrfToken }) => {
      const formData = new URLSearchParams();

      formData.append("method", "getHomeNum");

      formData.append("data[0][name]", "city");
      formData.append("data[0][value]", CITY);

      formData.append("data[1][name]", "street");
      formData.append("data[1][value]", STREET);

      formData.append("data[2][name]", "updateFact");
      formData.append("data[2][value]", new Date().toLocaleString("uk-UA"));

      const url = new URL("/ua/ajax", window.location.origin).toString();

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "x-requested-with": "XMLHttpRequest",
          "x-csrf-token": csrfToken,
        },
        body: formData,
      });

      let text = "";
      try {
        text = await response.text();
      } catch {}

      let payload = null;
      try {
        payload = JSON.parse(text);
      } catch {
        payload = { _nonJson: true, text: text?.slice?.(0, 2000) || "" };
      }

      return {
        status: response.status,
        ok: response.ok,
        sent: {
          city: CITY,
          street: STREET,
        },
        payload,
      };
    },
    { CITY, STREET, csrfToken }
  );

  console.log("DEBUG response status:", result.status, "ok:", result.ok);
  console.log("DEBUG sent:", JSON.stringify(result.sent));
  console.log("DEBUG payload keys:", Object.keys(result.payload || {}));
  console.log("DEBUG payload:", JSON.stringify(result.payload).slice(0, 4000));

  await writeArtifact("last_payload.json", JSON.stringify(result, null, 2));

  // Додаємо timestamp поточного оновлення, якщо його немає у відповіді API
  if (result.payload && !result.payload.updateTimestamp) {
    result.payload.updateTimestamp = getCurrentTime();
  }

  // Якщо сервер усе одно повернув Error — робимо скрин, щоб зрозуміти, що на сторінці
  if (result?.payload?.result === false) {
    await ensureArtifactsDir();
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, "page.png"), fullPage: true });
    console.log("🧩 Saved artifacts: page.html, last_payload.json, page.png");
  }

  console.log("✅ Getting info finished.");
  return result.payload;
}

// launchBrowser підмінюється в тестах, щоб перевірити запис last_error.txt
// без справжнього браузера
export async function getInfo({ launchBrowser = () => chromium.launch({ headless: true }) } = {}) {
  console.log("🌀 Getting info...");
  console.log("DEBUG SHUTDOWNS_PAGE:", SHUTDOWNS_PAGE);
  console.log("DEBUG CITY/STREET/HOUSE:", CITY, STREET, HOUSE);

  const browser = await launchBrowser();
  const page = await browser.newPage();

  try {
    return await fetchShutdowns(page);
  } catch (error) {
    // фіксуємо помилку в артефакт
    await writeArtifact("last_error.txt", String(error?.stack || error?.message || error));
    throw Error(`❌ Getting info failed: ${error.message}`);
  } finally {
    await browser.close();
  }
}

export async function run() {
  const info = await getInfo();
  await handleInfo(info);
}

// Запускаємо лише при прямому виклику, щоб модуль можна було імпортувати в тестах
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((error) => console.error(error.message));
}
