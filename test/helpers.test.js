import { after, before, beforeEach, describe, it } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { nowSec, silenceLogs } from "./factories.js"

// Перевизначаємо папку артефактів до імпорту модулів, інакше тести запишуть
// у справжній artifacts/ репозиторію
const artifactsDir = fs.mkdtempSync(path.join(os.tmpdir(), "dtek-helpers-"))
process.env.ARTIFACTS_DIR = artifactsDir

const { LAST_MESSAGE_FILE } = await import("../src/constants.js")
const { deleteLastMessage, getCurrentTime, loadLastMessage, saveLastMessage } = await import(
  "../src/helpers.js"
)

let restoreLogs

before(() => {
  restoreLogs = silenceLogs()
})

after(() => {
  restoreLogs()
  fs.rmSync(artifactsDir, { recursive: true, force: true })
})

beforeEach(() => {
  fs.rmSync(LAST_MESSAGE_FILE, { force: true })
})

describe("loadLastMessage", () => {
  it("повертає null коли файлу немає", () => {
    assert.equal(loadLastMessage(), null)
  })

  it("читає збережене повідомлення", () => {
    const outage_info = { start_date: "10:00", end_date: "14:00", sub_type: "Екстренні" }
    saveLastMessage({ message_id: 42, date: nowSec(), outage_info })

    const loaded = loadLastMessage()
    assert.equal(loaded.message_id, 42)
    assert.deepEqual(loaded.outage_info, outage_info)
  })

  // Файл комітиться в репозиторій воркфлоу, тож обрізаний JSON цілком реальний.
  // Раніше JSON.parse кидав виняток і зривав увесь запуск.
  it("не падає на битому файлі і видаляє його", () => {
    fs.mkdirSync(path.dirname(LAST_MESSAGE_FILE), { recursive: true })
    fs.writeFileSync(LAST_MESSAGE_FILE, '{"message_id": 42, "date"')

    assert.equal(loadLastMessage(), null)
    assert.equal(fs.existsSync(LAST_MESSAGE_FILE), false)
  })

  it("не падає на порожньому файлі", () => {
    fs.mkdirSync(path.dirname(LAST_MESSAGE_FILE), { recursive: true })
    fs.writeFileSync(LAST_MESSAGE_FILE, "")

    assert.equal(loadLastMessage(), null)
  })

  it("викидає повідомлення за попередній день", () => {
    saveLastMessage({ message_id: 42, date: nowSec() - 2 * 24 * 60 * 60 })

    assert.equal(loadLastMessage(), null)
    assert.equal(fs.existsSync(LAST_MESSAGE_FILE), false)
  })

  it("залишає сьогоднішнє повідомлення", () => {
    saveLastMessage({ message_id: 42, date: nowSec() })

    assert.equal(loadLastMessage().message_id, 42)
    assert.equal(fs.existsSync(LAST_MESSAGE_FILE), true)
  })

  it("залишає повідомлення без дати", () => {
    saveLastMessage({ message_id: 42 })

    assert.equal(loadLastMessage().message_id, 42)
  })
})

describe("saveLastMessage", () => {
  it("створює папку артефактів за потреби", () => {
    fs.rmSync(artifactsDir, { recursive: true, force: true })
    saveLastMessage({ message_id: 1, date: nowSec() })

    assert.equal(fs.existsSync(LAST_MESSAGE_FILE), true)
  })

  it("зберігає лише потрібні поля", () => {
    // chat/from приходять з відповіді Telegram, але нам не потрібні
    saveLastMessage({ message_id: 1, date: 123, chat: { id: 5 }, from: { id: 9 } })

    assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(LAST_MESSAGE_FILE, "utf8"))), [
      "message_id",
      "date",
    ])
  })
})

describe("deleteLastMessage", () => {
  it("не падає коли файлу немає", () => {
    assert.doesNotThrow(() => deleteLastMessage())
  })

  it("видаляє збережене повідомлення", () => {
    saveLastMessage({ message_id: 1, date: nowSec() })
    deleteLastMessage()

    assert.equal(fs.existsSync(LAST_MESSAGE_FILE), false)
  })
})

describe("getCurrentTime", () => {
  it("віддає київський час у форматі ГГ:ХХ ДД.ММ.РРРР", () => {
    assert.match(getCurrentTime(), /^\d{2}:\d{2} \d{2}\.\d{2}\.\d{4}$/)
  })
})
