import { after, before, beforeEach, describe, it } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { nowSec, silenceLogs } from "./factories.js"

// Переопределяем папку артефактов до импорта модулей, иначе тесты запишут
// в реальный artifacts/ репозитория
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
  it("возвращает null когда файла нет", () => {
    assert.equal(loadLastMessage(), null)
  })

  it("читает сохранённое сообщение", () => {
    const outage_info = { start_date: "10:00", end_date: "14:00", sub_type: "Екстренні" }
    saveLastMessage({ message_id: 42, date: nowSec(), outage_info })

    const loaded = loadLastMessage()
    assert.equal(loaded.message_id, 42)
    assert.deepEqual(loaded.outage_info, outage_info)
  })

  // Файл коммитится в репозиторий воркфлоу, так что обрезанный JSON реален.
  // Раньше JSON.parse бросал исключение и срывал весь запуск.
  it("не падает на битом файле и удаляет его", () => {
    fs.mkdirSync(path.dirname(LAST_MESSAGE_FILE), { recursive: true })
    fs.writeFileSync(LAST_MESSAGE_FILE, '{"message_id": 42, "date"')

    assert.equal(loadLastMessage(), null)
    assert.equal(fs.existsSync(LAST_MESSAGE_FILE), false)
  })

  it("не падает на пустом файле", () => {
    fs.mkdirSync(path.dirname(LAST_MESSAGE_FILE), { recursive: true })
    fs.writeFileSync(LAST_MESSAGE_FILE, "")

    assert.equal(loadLastMessage(), null)
  })

  it("выбрасывает сообщение за предыдущий день", () => {
    saveLastMessage({ message_id: 42, date: nowSec() - 2 * 24 * 60 * 60 })

    assert.equal(loadLastMessage(), null)
    assert.equal(fs.existsSync(LAST_MESSAGE_FILE), false)
  })

  it("оставляет сегодняшнее сообщение", () => {
    saveLastMessage({ message_id: 42, date: nowSec() })

    assert.equal(loadLastMessage().message_id, 42)
    assert.equal(fs.existsSync(LAST_MESSAGE_FILE), true)
  })

  it("оставляет сообщение без даты", () => {
    saveLastMessage({ message_id: 42 })

    assert.equal(loadLastMessage().message_id, 42)
  })
})

describe("saveLastMessage", () => {
  it("создаёт папку артефактов при необходимости", () => {
    fs.rmSync(artifactsDir, { recursive: true, force: true })
    saveLastMessage({ message_id: 1, date: nowSec() })

    assert.equal(fs.existsSync(LAST_MESSAGE_FILE), true)
  })

  it("хранит только нужные поля", () => {
    // chat/from приходят из ответа Telegram, но нам не нужны
    saveLastMessage({ message_id: 1, date: 123, chat: { id: 5 }, from: { id: 9 } })

    assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(LAST_MESSAGE_FILE, "utf8"))), [
      "message_id",
      "date",
    ])
  })
})

describe("deleteLastMessage", () => {
  it("не падает когда файла нет", () => {
    assert.doesNotThrow(() => deleteLastMessage())
  })

  it("удаляет сохранённое сообщение", () => {
    saveLastMessage({ message_id: 1, date: nowSec() })
    deleteLastMessage()

    assert.equal(fs.existsSync(LAST_MESSAGE_FILE), false)
  })
})

describe("getCurrentTime", () => {
  it("отдаёт киевское время в формате ЧЧ:ХХ ДД.ММ.РРРР", () => {
    assert.match(getCurrentTime(), /^\d{2}:\d{2} \d{2}\.\d{2}\.\d{4}$/)
  })
})
