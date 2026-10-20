import fs from "node:fs"
import path from "node:path"

import { LAST_MESSAGE_FILE } from "./constants.js"

// Telegram с parse_mode=HTML требует экранировать <, > и &. Без этого ответ
// ДТЕК с амперсандом в названии ломает разбор, и сообщение не доходит вообще.
export function escapeHtml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
}

export function loadLastMessage() {
  if (!fs.existsSync(LAST_MESSAGE_FILE)) return null

  let lastMessage

  try {
    lastMessage = JSON.parse(fs.readFileSync(LAST_MESSAGE_FILE, "utf8").trim())
  } catch {
    // Битый файл всё равно бесполезен — удаляем, чтобы запуск не падал целиком
    console.log("⚠️ Last message file is corrupted, removing it.")
    deleteLastMessage()
    return null
  }

  if (lastMessage?.date) {
    const messageDay = new Date(lastMessage.date * 1000).toLocaleDateString(
      "en-CA",
      { timeZone: "Europe/Kyiv" }
    )
    const today = new Date().toLocaleDateString("en-CA", {
      timeZone: "Europe/Kyiv",
    })

    if (messageDay < today) {
      deleteLastMessage()
      return null
    }
  }

  return lastMessage
}

export function saveLastMessage({ date, message_id, outage_info } = {}) {
  fs.mkdirSync(path.dirname(LAST_MESSAGE_FILE), { recursive: true })
  fs.writeFileSync(
    LAST_MESSAGE_FILE,
    JSON.stringify({
      message_id,
      date,
      outage_info, // Сохраняем информацию об отключении (start_date, end_date, sub_type)
    })
  )
}

export function deleteLastMessage() {
  if (fs.existsSync(LAST_MESSAGE_FILE)) {
    fs.unlinkSync(LAST_MESSAGE_FILE)
  }
}

export function getCurrentTime() {
  const now = new Date()

  const date = now.toLocaleDateString("uk-UA", {
    timeZone: "Europe/Kyiv",
  })

  const time = now.toLocaleTimeString("uk-UA", {
    timeZone: "Europe/Kyiv",
    hour: "2-digit",
    minute: "2-digit",
  })

  return `${time} ${date}`
}
