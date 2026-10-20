// Обработка сбоев в getInfo. Браузер подменён заглушкой, так что тест быстрый
// и не требует playwright.
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

// Минимальная заглушка браузера: страница падает на переходе
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

describe("getInfo при сбое страницы", () => {
  it("бросает ошибку с понятным текстом", async () => {
    const { launchBrowser } = brokenBrowser()

    await assert.rejects(() => getInfo({ launchBrowser }), /Getting info failed/)
  })

  it("записывает причину в last_error.txt", async () => {
    const { launchBrowser } = brokenBrowser("page.goto: Timeout 30000ms exceeded.")

    await assert.rejects(() => getInfo({ launchBrowser }))

    assert.match(fs.readFileSync(errorFile, "utf8"), /Timeout 30000ms exceeded/)
  })

  it("создаёт папку артефактов если её нет", async () => {
    const { launchBrowser } = brokenBrowser()
    assert.equal(fs.existsSync(artifactsDir), false)

    await assert.rejects(() => getInfo({ launchBrowser }))

    assert.equal(fs.existsSync(errorFile), true)
  })

  // Иначе процесс в GitHub Actions остался бы висеть с открытым Chromium
  it("закрывает браузер несмотря на ошибку", async () => {
    const { launchBrowser, state } = brokenBrowser()

    await assert.rejects(() => getInfo({ launchBrowser }))

    assert.equal(state.closed, true)
  })

  it("закрывает браузер при успешном запуске", async () => {
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
