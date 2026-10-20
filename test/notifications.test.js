import { after, before, beforeEach, describe, it } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { nowSec, silenceLogs } from "./factories.js"

const artifactsDir = fs.mkdtempSync(path.join(os.tmpdir(), "dtek-notifications-"))
process.env.ARTIFACTS_DIR = artifactsDir
process.env.TELEGRAM_BOT_TOKEN = "test-token"
process.env.TELEGRAM_CHAT_ID = "test-chat"

const { LAST_MESSAGE_FILE } = await import("../src/constants.js")
const { saveLastMessage } = await import("../src/helpers.js")
const { sendNotification } = await import("../src/notifications.js")

const OUTAGE = { start_date: "10:00 20.10.2026", end_date: "14:00 20.10.2026", sub_type: "Екстренні" }

let restoreLogs
const originalFetch = globalThis.fetch

// Подменяем fetch: отдаём заготовленные ответы Telegram и собираем запросы
function stubFetch(responses = []) {
  const queue = [...responses]
  const calls = []

  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), body: JSON.parse(options.body) })

    const response = queue.length
      ? queue.shift()
      : { ok: true, result: { message_id: 1, date: nowSec() } }

    return { ok: true, status: 200, json: async () => response }
  }

  return calls
}

function savedState() {
  if (!fs.existsSync(LAST_MESSAGE_FILE)) return null
  return JSON.parse(fs.readFileSync(LAST_MESSAGE_FILE, "utf8"))
}

before(() => {
  restoreLogs = silenceLogs()
})

after(() => {
  restoreLogs()
  globalThis.fetch = originalFetch
  fs.rmSync(artifactsDir, { recursive: true, force: true })
})

beforeEach(() => {
  fs.rmSync(LAST_MESSAGE_FILE, { force: true })
})

describe("sendNotification", () => {
  it("отправляет новое сообщение когда состояния нет", async () => {
    const calls = stubFetch([{ ok: true, result: { message_id: 500, date: nowSec() } }])

    await sendNotification("текст", OUTAGE)

    assert.equal(calls.length, 1)
    assert.ok(calls[0].url.endsWith("/sendMessage"))
    assert.equal(calls[0].body.text, "текст")
    assert.equal(calls[0].body.parse_mode, "HTML")
    // message_id в sendMessage означал бы ответ на чужое сообщение
    assert.equal("message_id" in calls[0].body, false)

    assert.equal(savedState().message_id, 500)
    assert.deepEqual(savedState().outage_info, OUTAGE)
  })

  it("редактирует сообщение пока отключение то же", async () => {
    saveLastMessage({ message_id: 500, date: nowSec(), outage_info: OUTAGE })
    const calls = stubFetch([{ ok: true, result: { message_id: 500, date: nowSec() } }])

    await sendNotification("текст", OUTAGE)

    assert.ok(calls[0].url.endsWith("/editMessageText"))
    assert.equal(calls[0].body.message_id, 500)
  })

  it("отправляет новое сообщение когда изменилось время начала", async () => {
    saveLastMessage({
      message_id: 500,
      date: nowSec(),
      outage_info: { ...OUTAGE, start_date: "08:00 20.10.2026" },
    })
    const calls = stubFetch([{ ok: true, result: { message_id: 600, date: nowSec() } }])

    await sendNotification("текст", OUTAGE)

    assert.ok(calls[0].url.endsWith("/sendMessage"))
    assert.equal("message_id" in calls[0].body, false)
    assert.equal(savedState().message_id, 600)
  })

  it("досылает отдельное сообщение когда сдвинулось время восстановления", async () => {
    saveLastMessage({
      message_id: 500,
      date: nowSec(),
      outage_info: { ...OUTAGE, end_date: "12:00 20.10.2026" },
    })
    const calls = stubFetch([
      { ok: true, result: { message_id: 500, date: nowSec() } },
      { ok: true, result: { message_id: 501, date: nowSec() } },
    ])

    await sendNotification("текст", OUTAGE)

    assert.equal(calls.length, 2)
    assert.ok(calls[0].url.endsWith("/editMessageText"))
    assert.ok(calls[1].url.endsWith("/sendMessage"))
    assert.match(calls[1].body.text, /Змінено орієнтовний час відновлення/)
    assert.match(calls[1].body.text, /14:00 20\.10\.2026/)
  })

  it("не досылает сообщение когда время восстановления не менялось", async () => {
    saveLastMessage({ message_id: 500, date: nowSec(), outage_info: OUTAGE })
    const calls = stubFetch([{ ok: true, result: { message_id: 500, date: nowSec() } }])

    await sendNotification("текст", OUTAGE)

    assert.equal(calls.length, 1)
  })

  // Раньше любая ошибка Telegram стирала состояние, и следующий запуск присылал
  // не правку, а второе сообщение про то же отключение.
  it("сохраняет состояние при временной ошибке Telegram", async () => {
    saveLastMessage({ message_id: 500, date: nowSec(), outage_info: OUTAGE })
    stubFetch([{ ok: false, description: "Too Many Requests: retry after 5" }])

    await sendNotification("текст", OUTAGE)

    assert.equal(savedState().message_id, 500)
  })

  it("сохраняет состояние когда fetch бросает исключение", async () => {
    saveLastMessage({ message_id: 500, date: nowSec(), outage_info: OUTAGE })
    globalThis.fetch = async () => {
      throw new Error("fetch failed")
    }

    await sendNotification("текст", OUTAGE)

    assert.equal(savedState().message_id, 500)
  })

  it("сбрасывает состояние когда сообщения в чате больше нет", async () => {
    saveLastMessage({ message_id: 500, date: nowSec(), outage_info: OUTAGE })
    stubFetch([{ ok: false, description: "Bad Request: message to edit not found" }])

    await sendNotification("текст", OUTAGE)

    assert.equal(savedState(), null)
  })

  it("считает 'message is not modified' нормой и сохраняет состояние", async () => {
    saveLastMessage({ message_id: 500, date: nowSec(), outage_info: OUTAGE })
    stubFetch([
      {
        ok: false,
        description:
          "Bad Request: message is not modified: specified new message content and reply markup are exactly the same",
      },
    ])

    await sendNotification("текст", OUTAGE)

    assert.equal(savedState().message_id, 500)
  })
})
