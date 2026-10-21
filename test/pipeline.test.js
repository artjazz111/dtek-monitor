import { after, before, beforeEach, describe, it } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { houseEntry, nowSec, payload, silenceLogs } from "./factories.js"

const HA_WEBHOOK_URL = "https://home-assistant.test/api/webhook/dtek"

const artifactsDir = fs.mkdtempSync(path.join(os.tmpdir(), "dtek-pipeline-"))
process.env.ARTIFACTS_DIR = artifactsDir
process.env.TELEGRAM_BOT_TOKEN = "test-token"
process.env.TELEGRAM_CHAT_ID = "test-chat"
process.env.CITY = "Київ"
process.env.STREET = "вул. Тестова"
process.env.HOUSE = "7"
process.env.HA_WEBHOOK_URL = HA_WEBHOOK_URL

const HOUSE = process.env.HOUSE

const { LAST_MESSAGE_FILE } = await import("../src/constants.js")
const { saveLastMessage } = await import("../src/helpers.js")
const { handleInfo } = await import("../src/pipeline.js")

let restoreLogs
const originalFetch = globalThis.fetch

function stubFetch() {
  const calls = []

  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), body: JSON.parse(options.body) })
    return {
      ok: true,
      status: 200,
      json: async () => ({ ok: true, result: { message_id: 500, date: nowSec() } }),
    }
  }

  return calls
}

const telegramCalls = (calls) => calls.filter((call) => call.url.includes("api.telegram.org"))
const haCalls = (calls) => calls.filter((call) => call.url === HA_WEBHOOK_URL)

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

describe("handleInfo при непридатних даних", () => {
  // Таймаут чи помилка ДТЕК посеред відключення не означає, що світло дали.
  // Якщо надіслати в HA "normal", автоматизації вирішать, що аварію знято.
  it("нічого не робить при помилковій відповіді ДТЕК", async () => {
    saveLastMessage({ message_id: 500, date: nowSec(), outage_info: { start_date: "10:00" } })
    const calls = stubFetch()

    await handleInfo({ result: false, text: "Error" })

    assert.equal(calls.length, 0)
    assert.equal(fs.existsSync(LAST_MESSAGE_FILE), true)
  })

  it("нічого не робить коли у відповіді немає data", async () => {
    saveLastMessage({ message_id: 500, date: nowSec(), outage_info: { start_date: "10:00" } })
    const calls = stubFetch()

    await handleInfo({ result: true })

    assert.equal(calls.length, 0)
    assert.equal(fs.existsSync(LAST_MESSAGE_FILE), true)
  })

  it("нічого не робить коли нашого будинку немає в даних", async () => {
    saveLastMessage({ message_id: 500, date: nowSec(), outage_info: { start_date: "10:00" } })
    const calls = stubFetch()

    await handleInfo(payload({ houses: { 9: houseEntry() } }))

    assert.equal(calls.length, 0)
    assert.equal(fs.existsSync(LAST_MESSAGE_FILE), true)
  })
})

describe("handleInfo без відключення", () => {
  it("повідомляє в HA 'normal' і скидає стан", async () => {
    saveLastMessage({ message_id: 500, date: nowSec(), outage_info: { start_date: "10:00" } })
    const calls = stubFetch()

    await handleInfo(payload({ houses: { [HOUSE]: houseEntry() } }))

    assert.equal(telegramCalls(calls).length, 0)
    assert.equal(haCalls(calls).length, 1)
    assert.equal(haCalls(calls)[0].body.state, "normal")
    assert.equal("outage" in haCalls(calls)[0].body, false)
    assert.equal(fs.existsSync(LAST_MESSAGE_FILE), false)
  })
})

describe("handleInfo при аварійному відключенні", () => {
  const info = payload({
    houses: {
      [HOUSE]: houseEntry({
        sub_type: "Екстренні відключення",
        type: "2",
        start_date: "10:00 20.10.2026",
        end_date: "14:00 20.10.2026",
        sub_type_reason: ["GPV26.1"],
      }),
    },
  })

  it("пише в Telegram і в HA", async () => {
    const calls = stubFetch()

    await handleInfo(info)

    assert.equal(telegramCalls(calls).length, 1)
    assert.ok(telegramCalls(calls)[0].url.endsWith("/sendMessage"))
    assert.equal(haCalls(calls).length, 1)
  })

  it("передає в HA стан і деталі відключення", async () => {
    const calls = stubFetch()

    await handleInfo(info)

    const body = haCalls(calls)[0].body
    assert.equal(body.state, "outage")
    assert.equal(body.city, "Київ")
    assert.equal(body.house, HOUSE)
    assert.deepEqual(body.outage, {
      start_date: "10:00 20.10.2026",
      end_date: "14:00 20.10.2026",
      reason: "Екстренні відключення",
    })
  })

  it("кладе в повідомлення адресу, причину і час", async () => {
    const calls = stubFetch()

    await handleInfo(info)

    const { text } = telegramCalls(calls)[0].body
    assert.match(text, /Київ, вул\. Тестова, 7/)
    assert.match(text, /Екстренні відключення/)
    assert.match(text, /10:00 20\.10\.2026/)
    assert.match(text, /14:00 20\.10\.2026/)
    // GPV26.1 має читатися як "Група 26.1"
    assert.match(text, /Група 26\.1/)
  })
})

describe("handleInfo коли Home Assistant недоступний", () => {
  const info = payload({ houses: { [HOUSE]: houseEntry() } })

  it("не зриває запуск коли вебхук відповідає помилкою", async () => {
    globalThis.fetch = async () => ({ ok: false, status: 500, json: async () => ({}) })

    await assert.doesNotReject(() => handleInfo(info))
  })

  it("не зриває запуск коли вебхук недосяжний", async () => {
    globalThis.fetch = async () => {
      throw new Error("ECONNREFUSED")
    }

    await assert.doesNotReject(() => handleInfo(info))
  })
})

describe("handleInfo при плановому відключенні", () => {
  it("не пише в Telegram, але повідомляє в HA 'normal'", async () => {
    const calls = stubFetch()

    await handleInfo(
      payload({
        houses: {
          [HOUSE]: houseEntry({
            sub_type: "Відключення за графіком",
            type: "1",
            start_date: "10:00 20.10.2026",
            end_date: "14:00 20.10.2026",
          }),
        },
      })
    )

    assert.equal(telegramCalls(calls).length, 0)
    assert.equal(haCalls(calls)[0].body.state, "normal")
  })
})
