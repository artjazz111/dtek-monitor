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

export async function getInfo() {
  console.log("🌀 Getting info...");
  console.log("DEBUG SHUTDOWNS_PAGE:", SHUTDOWNS_PAGE);
  console.log("DEBUG CITY/STREET/HOUSE:", CITY, STREET, HOUSE);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    await page.goto(SHUTDOWNS_PAGE, { waitUntil: "networkidle", timeout: 30000 });

    // Дождемся стабилизации страницы
    await page.waitForTimeout(2000);

    const csrfTokenTag = await page.waitForSelector('meta[name="csrf-token"]', {
      state: "attached",
      timeout: 15000,
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

    // Добавляем timestamp текущего обновления если его нет в ответе API
    if (result.payload && !result.payload.updateTimestamp) {
      result.payload.updateTimestamp = getCurrentTime();
    }

    // Если сервер всё равно вернул Error — делаем скрин для понимания, что на странице
    if (result?.payload?.result === false) {
      await ensureArtifactsDir();
      await page.screenshot({ path: path.join(ARTIFACTS_DIR, "page.png"), fullPage: true });
      console.log("🧩 Saved artifacts: page.html, last_payload.json, page.png");
    }

    console.log("✅ Getting info finished.");
    return result.payload;
  } catch (error) {
    // фиксируем ошибку в артефакт
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

// Запускаем только при прямом вызове, чтобы модуль можно было импортировать в тестах
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((error) => console.error(error.message));
}
