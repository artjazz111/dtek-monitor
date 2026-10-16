import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";

import {
  TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_ID,
  CITY,
  STREET,
  HOUSE,
  SHUTDOWNS_PAGE,
  HA_WEBHOOK_URL,
  GROUP,
} from "./constants.js";

import { buildSchedule } from "./schedule.js";

import {
  capitalize,
  deleteLastMessage,
  getCurrentTime,
  loadLastMessage,
  saveLastMessage,
} from "./helpers.js";

const ART_DIR = "artifacts";

async function ensureArtifactsDir() {
  await fs.mkdir(ART_DIR, { recursive: true });
}

async function writeArtifact(name, content) {
  await ensureArtifactsDir();
  const filePath = path.join(ART_DIR, name);
  await fs.writeFile(filePath, content);
  return filePath;
}

async function getInfo() {
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
      await page.screenshot({ path: path.join(ART_DIR, "page.png"), fullPage: true });
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

function checkIsOutage(info) {
  console.log("🌀 Checking power outage...");

  // Сейчас у тебя часто приходит {result:false,text:"Error"} — это не outage, это ошибка данных.
  if (!info || info.result === false) {
    console.log("⚠️ DTEK returned error payload (result:false).");
    return false;
  }

  if (!info?.data) {
    console.log("⚠️ No data from DTEK (address not found / format changed / temporary issue).");
    return false;
  }

  // Проверяем есть ли реальное отключение для нашего дома
  if (!HOUSE || !info.data[HOUSE]) {
    console.log("⚠️ No data for specified house.");
    return false;
  }

  const houseData = info.data[HOUSE];

  // Реальное отключение = когда sub_type не пустой И есть хотя бы одна дата
  const hasOutage =
    houseData.sub_type &&
    houseData.sub_type.trim() !== "" &&
    (houseData.start_date || houseData.end_date);

  hasOutage ? console.log("🚨 Power outage detected!") : console.log("⚡️ No power outage!");
  return hasOutage;
}

function checkIsScheduled(info) {
  console.log("🌀 Checking whether power outage scheduled...");

  if (!info || info.result === false) return false;
  if (!info?.data) return false;

  // Проверяем конкретный дом
  if (HOUSE && info.data[HOUSE]) {
    const houseData = info.data[HOUSE];

    // type === "2" означает экстренное отключение (НЕ по графику)
    if (houseData.type === "2") {
      console.log("⚠️ Emergency power outage (not scheduled)!");
      return false;
    }

    // Проверяем наличие "Екстренні відключення" в sub_type
    if (houseData.sub_type && houseData.sub_type.toLowerCase().includes("екстренні")) {
      console.log("⚠️ Emergency power outage (not scheduled)!");
      return false;
    }

    // Если есть start_date/end_date но не экстренное - это плановое
    if (houseData.start_date || houseData.end_date) {
      console.log("🗓️ Scheduled power outage!");
      return true;
    }
  }

  // Для всех домов проверяем общую логику (fallback)
  const asText = JSON.stringify(info.data).toLowerCase();

  // Если есть экстренные отключения - это НЕ запланировано
  if (asText.includes("екстренні")) {
    console.log("⚠️ Emergency power outage detected (not scheduled)!");
    return false;
  }

  // Если упоминается график - вероятно плановое
  const isScheduled = asText.includes("графік");
  isScheduled ? console.log("🗓️ Scheduled power outage!") : console.log("⚠️ Power outage not scheduled!");
  return isScheduled;
}

function generateMessage(info) {
  console.log("🌀 Generating message...");

  const updateTimestamp = info?.updateTimestamp || "";
  const messageParts = [
    "⚡️ <b>Зафіксовано відключення:</b>",
    "",
    `📍 <code>${CITY}, ${STREET}, ${HOUSE}</code>`,
    "",
  ];

  // Извлекаем детальную информацию об отключении для конкретного дома
  if (info?.data && HOUSE) {
    const houseData = info.data[HOUSE];
    console.log("DEBUG houseData for", HOUSE, ":", JSON.stringify(houseData));

    if (houseData) {
      // Причина отключения (тип)
      if (houseData.sub_type) {
        messageParts.push(`📋 <b>Причина:</b> ${houseData.sub_type}`);
      }

      // Дополнительное описание причины
      if (houseData.sub_type_reason && Array.isArray(houseData.sub_type_reason) && houseData.sub_type_reason.length > 0) {
        const reasons = houseData.sub_type_reason
          .map(r => r.replace(/GPV/g, 'Група '))
          .join(", ");
        messageParts.push(`   <i>${reasons}</i>`);
      }

      // Время начала отключения
      if (houseData.start_date) {
        messageParts.push(`⏰ <b>Час початку:</b> ${houseData.start_date}`);
      }

      // Ориентировочное время восстановления
      if (houseData.end_date) {
        messageParts.push(`🔌 <b>Орієнтовний час відновлення:</b> до ${houseData.end_date}`);
      }

      messageParts.push("");
    }
  }

  // Дата обновления информации
  if (updateTimestamp) {
    messageParts.push(`🔄 <b>Дата оновлення:</b> ${updateTimestamp}`);
  }

  messageParts.push(`💬 <b>Час запиту:</b> ${getCurrentTime()}`);

  return messageParts.join("\n");
}

async function sendNotification(message, outageInfo) {
  // Telegram необов'язковий: повідомлення може слати Home Assistant з вебхука
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.log("ℹ️ Telegram not configured, skipping notification");
    return;
  }

  console.log("🌀 Sending notification...");

  const lastMessage = loadLastMessage() || {};
  const lastOutageInfo = lastMessage.outage_info || {};

  // Определяем тип уведомления
  let isNewOutage = false;
  let endDateChanged = false;

  if (lastMessage.message_id && outageInfo) {
    // Проверяем: это новое отключение или продолжение текущего
    if (lastOutageInfo.start_date !== outageInfo.start_date) {
      console.log("🆕 Detected new outage (different start_date)");
      isNewOutage = true;
      deleteLastMessage(); // Удаляем старую информацию, создадим новое сообщение
    } else if (lastOutageInfo.end_date !== outageInfo.end_date && outageInfo.end_date) {
      console.log("⏰ End time changed:", lastOutageInfo.end_date, "→", outageInfo.end_date);
      endDateChanged = true;
    }
  }

  const endpoint = (lastMessage.message_id && !isNewOutage) ? "editMessageText" : "sendMessage";

  try {
    const response = await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/${endpoint}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: TELEGRAM_CHAT_ID,
          text: message,
          parse_mode: "HTML",
          message_id: lastMessage.message_id ?? undefined,
        }),
      }
    );

    const data = await response.json();
    if (!data.ok) throw Error(data.description || "Telegram API error");

    saveLastMessage({
      ...data.result,
      outage_info: outageInfo, // Сохраняем информацию об отключении
    });
    console.log("🟢 Notification sent.");

    // Если изменилось время восстановления - отправляем дополнительное уведомление
    if (endDateChanged && outageInfo.end_date) {
      console.log("📤 Sending additional notification about end time change...");
      await sendTimeChangeNotification(outageInfo.end_date);
    }
  } catch (error) {
    console.log("🔴 Notification not sent.", error.message);
    deleteLastMessage();
  }
}

async function sendTimeChangeNotification(newEndDate) {
  try {
    const changeMessage = `⏰ <b>Змінено орієнтовний час відновлення:</b> до ${newEndDate}`;

    const response = await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: TELEGRAM_CHAT_ID,
          text: changeMessage,
          parse_mode: "HTML",
        }),
      }
    );

    const data = await response.json();
    if (!data.ok) throw Error(data.description || "Telegram API error");

    console.log("🟢 Time change notification sent.");
  } catch (error) {
    console.log("🔴 Time change notification not sent.", error.message);
  }
}

async function sendToHomeAssistant(outageInfo, isActive, info) {
  if (!HA_WEBHOOK_URL) {
    console.log("ℹ️ HA_WEBHOOK_URL not configured, skipping Home Assistant notification");
    return;
  }

  try {
    console.log("🏠 Sending data to Home Assistant...");

    const payload = {
      state: isActive ? "outage" : "normal",
      city: CITY,
      street: STREET,
      house: HOUSE,
      timestamp: new Date().toISOString(),
      ...(outageInfo && {
        outage: {
          start_date: outageInfo.start_date,
          end_date: outageInfo.end_date,
          reason: outageInfo.sub_type,
        }
      }),
      schedule: buildSchedule(info, HOUSE, new Date(), GROUP),
    };

    const response = await fetch(HA_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (response.ok) {
      console.log("🟢 Data sent to Home Assistant.");
    } else {
      console.log("🔴 Failed to send to Home Assistant:", response.status);
    }
  } catch (error) {
    console.log("🔴 Error sending to Home Assistant:", error.message);
  }
}

async function run() {
  // Тест можно включать/выключать по желанию
  // await sendNotification("✅ TEST: runner + telegram работают");

  const info = await getInfo();
  const isOutage = checkIsOutage(info);
  const isScheduled = checkIsScheduled(info);

  if (isOutage && !isScheduled) {
    const message = generateMessage(info);

    // Извлекаем информацию об отключении для сохранения
    let outageInfo = null;
    if (info?.data && HOUSE && info.data[HOUSE]) {
      const houseData = info.data[HOUSE];
      outageInfo = {
        start_date: houseData.start_date || "",
        end_date: houseData.end_date || "",
        sub_type: houseData.sub_type || "",
      };
    }

    await sendNotification(message, outageInfo);

    // Отправляем данные в Home Assistant
    await sendToHomeAssistant(outageInfo, true, info);
  } else {
    console.log("ℹ️ No notification needed.");
    // Удаляем информацию о последнем сообщении когда отключения нет
    deleteLastMessage();

    // Уведомляем Home Assistant что отключения нет
    await sendToHomeAssistant(null, false, info);
  }
}

run().catch((error) => console.error(error.message));
