import path from "node:path"

export const { TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, CITY, STREET, HOUSE, HA_WEBHOOK_URL, GROUP } =
  process.env

export const SHUTDOWNS_PAGE = "https://www.dtek-kem.com.ua/ua/shutdowns"

// Папку можно переопределить, чтобы тесты не писали в реальные артефакты репозитория
export const ARTIFACTS_DIR = process.env.ARTIFACTS_DIR || "artifacts"

export const LAST_MESSAGE_FILE = path.resolve(ARTIFACTS_DIR, `last-message.json`)
