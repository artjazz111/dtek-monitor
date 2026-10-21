// Обробка збоїв у getInfo. Браузер підмінено заглушкою, тож тест швидкий
// і не вимагає playwright.
import { after, before, beforeEach, describe, it } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { silenceLogs } from "./factories.js"

const artifactsDir = fs.mkdtempSync(path.join(os.tmpdir(), "dtek-getinfo-errors-"))
process.env.ARTIFACTS_DIR = artifactsDir

const { getInfo } = await import("../src/monitor.js")

let restoreLogs

before(() => {
  restoreLogs = silenceLogs()
})

after(() => {
  restoreLogs()
  fs.rmSync(artifactsDir, { recursive: true, force: true })
})

beforeEach(() => {
  fs.rmSync(artifactsDir, { recursive: true, force: true })
})

// Мінімальна заглушка браузера: сторінка падає на переході
function brokenBrowser(message = "page.goto: Timeout 30000ms exceeded.") {
  const state = { closed: false }

  const launchBrowser = async () => ({
    newPage: async () => ({
      goto: async () => {
        throw new Error(message)
      },
    }),
    close: async () => {
      state.closed = true
    },
  })

  return { launchBrowser, state }
}

const errorFile = path.join(artifactsDir, "last_error.txt")

describe("getInfo при збої сторінки", () => {
  it("кидає помилку зі зрозумілим текстом", async () => {
    const { launchBrowser } = brokenBrowser()

    await assert.rejects(() => getInfo({ launchBrowser }), /Getting info failed/)
  })

  it("записує причину в last_error.txt", async () => {
    const { launchBrowser } = brokenBrowser("page.goto: Timeout 30000ms exceeded.")

    await assert.rejects(() => getInfo({ launchBrowser }))

    assert.match(fs.readFileSync(errorFile, "utf8"), /Timeout 30000ms exceeded/)
  })

  it("створює папку артефактів якщо її немає", async () => {
    const { launchBrowser } = brokenBrowser()
    assert.equal(fs.existsSync(artifactsDir), false)

    await assert.rejects(() => getInfo({ launchBrowser }))

    assert.equal(fs.existsSync(errorFile), true)
  })

  // Інакше процес у GitHub Actions залишився б висіти з відкритим Chromium
  it("закриває браузер незважаючи на помилку", async () => {
    const { launchBrowser, state } = brokenBrowser()

    await assert.rejects(() => getInfo({ launchBrowser }))

    assert.equal(state.closed, true)
  })

  it("закриває браузер при успішному запуску", async () => {
    const state = { closed: false }
    const launchBrowser = async () => ({
      newPage: async () => ({
        goto: async () => {},
        waitForTimeout: async () => {},
        waitForSelector: async () => ({ getAttribute: async () => "token" }),
        evaluate: async () => ({
          status: 200,
          ok: true,
          sent: {},
          payload: { result: true, data: {} },
        }),
      }),
      close: async () => {
        state.closed = true
      },
    })

    const info = await getInfo({ launchBrowser })

    assert.equal(info.result, true)
    assert.equal(state.closed, true)
  })
})
