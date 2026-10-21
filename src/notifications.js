import {
  TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_ID,
  CITY,
  STREET,
  HOUSE,
  HA_WEBHOOK_URL,
  GROUP,
} from "./constants.js"

import { deleteLastMessage, escapeHtml, loadLastMessage, saveLastMessage } from "./helpers.js"
import { buildSchedule } from "./schedule.js"

// Ці помилки означають, що редагувати вже нічого — лише тут є сенс
// скидати збережений стан
const STALE_MESSAGE_ERRORS = [
  "message to edit not found",
  "message to be edited not found",
  "message can't be edited",
  "message_id_invalid",
]

// Текст збігся з уже надісланим — для нас це не помилка
const NOT_MODIFIED_ERROR = "message is not modified"

export async function sendNotification(message, outageInfo) {
  // Telegram необов'язковий: повідомлення може слати Home Assistant з вебхука
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.log("ℹ️ Telegram not configured, skipping notification")
    return
  }

  console.log("🌀 Sending notification...")

  const lastMessage = loadLastMessage() || {}
  const lastOutageInfo = lastMessage.outage_info || {}

  // Визначаємо тип повідомлення
  let isNewOutage = false
  let endDateChanged = false

  if (lastMessage.message_id && outageInfo) {
    // Перевіряємо: це нове відключення чи продовження поточного
    if (lastOutageInfo.start_date !== outageInfo.start_date) {
      console.log("🆕 Detected new outage (different start_date)")
      isNewOutage = true
      deleteLastMessage() // Видаляємо старі дані, створимо нове повідомлення
    } else if (lastOutageInfo.end_date !== outageInfo.end_date && outageInfo.end_date) {
      console.log("⏰ End time changed:", lastOutageInfo.end_date, "→", outageInfo.end_date)
      endDateChanged = true
    }
  }

  const isEdit = Boolean(lastMessage.message_id) && !isNewOutage
  const endpoint = isEdit ? "editMessageText" : "sendMessage"

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
          // message_id потрібен лише при редагуванні
          message_id: isEdit ? lastMessage.message_id : undefined,
        }),
      }
    )

    const data = await response.json()
    if (!data.ok) throw Error(data.description || "Telegram API error")

    saveLastMessage({
      ...data.result,
      outage_info: outageInfo, // Зберігаємо інформацію про відключення
    })
    console.log("🟢 Notification sent.")

    // Якщо змінився час відновлення — надсилаємо додаткове повідомлення
    if (endDateChanged && outageInfo.end_date) {
      console.log("📤 Sending additional notification about end time change...")
      await sendTimeChangeNotification(outageInfo.end_date)
    }
  } catch (error) {
    const description = String(error?.message || "").toLowerCase()

    if (description.includes(NOT_MODIFIED_ERROR)) {
      console.log("🟡 Message content unchanged, nothing to update.")
      return
    }

    console.log("🔴 Notification not sent.", error.message)

    // Скидаємо стан лише якщо повідомлення в чаті більше немає. При тимчасовій
    // помилці Telegram стан треба зберегти, інакше наступний запуск надішле дубль
    if (STALE_MESSAGE_ERRORS.some((text) => description.includes(text))) {
      console.log("🧹 Saved message is gone, resetting state.")
      deleteLastMessage()
    }
  }
}

export async function sendTimeChangeNotification(newEndDate) {
  try {
    const changeMessage = `⏰ <b>Змінено орієнтовний час відновлення:</b> до ${escapeHtml(newEndDate)}`

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
    )

    const data = await response.json()
    if (!data.ok) throw Error(data.description || "Telegram API error")

    console.log("🟢 Time change notification sent.")
  } catch (error) {
    console.log("🔴 Time change notification not sent.", error.message)
  }
}

export async function sendToHomeAssistant(outageInfo, isActive, info) {
  if (!HA_WEBHOOK_URL) {
    console.log("ℹ️ HA_WEBHOOK_URL not configured, skipping Home Assistant notification")
    return
  }

  try {
    console.log("🏠 Sending data to Home Assistant...")

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
        },
      }),
      schedule: buildSchedule(info, HOUSE, new Date(), GROUP),
    }

    const response = await fetch(HA_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })

    if (response.ok) {
      console.log("🟢 Data sent to Home Assistant.")
    } else {
      console.log("🔴 Failed to send to Home Assistant:", response.status)
    }
  } catch (error) {
    console.log("🔴 Error sending to Home Assistant:", error.message)
  }
}
