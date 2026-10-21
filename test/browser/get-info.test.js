// Тести скрейпінгу. Браузер справжній, але запити до ДТЕК перехоплені
// через page.route, тож мережа не потрібна.
import { after, afterEach, before, beforeEach, describe, it } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { chromium } from "playwright"

import { factRow, houseEntry, payload, silenceLogs } from "../factories.js"

const artifactsDir = fs.mkdtempSync(path.join(os.tmpdir(), "dtek-getinfo-"))
process.env.ARTIFACTS_DIR = artifactsDir
process.env.CITY = "Київ"
process.env.STREET = "вул. Тестова"
process.env.HOUSE = "7"

const { SHUTDOWNS_PAGE } = await import("../../src/constants.js")
const { fetchShutdowns } = await import("../../src/monitor.js")

const AJAX_URL = new URL("/ua/ajax", SHUTDOWNS_PAGE).toString()

const pageHtml = (csrfToken = "test-csrf-token") =>
  `<!doctype html><html><head><meta name="csrf-token" content="${csrfToken}"></head><body>ДТЕК</body></html>`

let browser
let restoreLogs

before(async () => {
  restoreLogs = silenceLogs()
  browser = await chromium.launch({ headless: true })
})

after(async () => {
  await browser?.close()
  restoreLogs()
  fs.rmSync(artifactsDir, { recursive: true, force: true })
})

let page

beforeEach(async () => {
  page = await browser.newPage()
  fs.rmSync(artifactsDir, { recursive: true, force: true })
})

afterEach(async () => {
  await page?.close()
})

// Віддає сторінку з csrf-токеном і підміняє відповідь /ua/ajax.
// Повертає масив перехоплених POST-запитів.
async function routeDtek({ html = pageHtml(), ajax } = {}) {
  const requests = []

  await page.route(SHUTDOWNS_PAGE, (route) =>
    route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: html })
  )

  await page.route(AJAX_URL, (route) => {
    const request = route.request()

    requests.push({
      method: request.method(),
      headers: request.headers(),
      body: new URLSearchParams(request.postData() || ""),
    })

    return route.fulfill(
      ajax ?? {
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(payload({ houses: { 7: houseEntry() } })),
      }
    )
  })

  return requests
}

const artifact = (name) => path.join(artifactsDir, name)

// Чекати продакшн-таймаути в тестах нема сенсу
const FAST = { navigationTimeout: 5000, settleMs: 0, selectorTimeout: 500 }

describe("fetchShutdowns: запит до ДТЕК", () => {
  it("віддає payload з відповіді", async () => {
    await routeDtek({
      ajax: {
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          payload({
            houses: { 7: houseEntry({ sub_type: "Екстренні відключення", start_date: "10:00" }) },
          })
        ),
      },
    })

    const info = await fetchShutdowns(page, FAST)

    assert.equal(info.result, true)
    assert.equal(info.data["7"].sub_type, "Екстренні відключення")
  })

  it("бере csrf-токен зі сторінки і кладе в заголовок", async () => {
    const requests = await routeDtek({ html: pageHtml("csrf-from-page") })

    await fetchShutdowns(page, FAST)

    assert.equal(requests.length, 1)
    assert.equal(requests[0].headers["x-csrf-token"], "csrf-from-page")
    assert.equal(requests[0].headers["x-requested-with"], "XMLHttpRequest")
  })

  it("надсилає адресу у форматі, якого чекає ДТЕК", async () => {
    const requests = await routeDtek()

    await fetchShutdowns(page, FAST)

    const { method, body } = requests[0]
    assert.equal(method, "POST")
    assert.equal(body.get("method"), "getHomeNum")
    assert.equal(body.get("data[0][name]"), "city")
    assert.equal(body.get("data[0][value]"), "Київ")
    assert.equal(body.get("data[1][name]"), "street")
    assert.equal(body.get("data[1][value]"), "вул. Тестова")
    assert.equal(body.get("data[2][name]"), "updateFact")
    assert.ok(body.get("data[2][value]"))
  })

  it("зберігає графік fact, якщо він є у відповіді", async () => {
    await routeDtek({
      ajax: {
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          payload({
            houses: { 7: houseEntry({ sub_type_reason: ["GPV26.1"] }) },
            fact: {
              today: "1792443600",
              update: "19.10.2026 20:20",
              data: { 1792443600: { "GPV26.1": factRow({ 8: "no" }) } },
            },
          })
        ),
      },
    })

    const info = await fetchShutdowns(page, FAST)

    assert.equal(info.fact.today, "1792443600")
    assert.equal(info.fact.data["1792443600"]["GPV26.1"]["8"], "no")
  })
})

describe("fetchShutdowns: timestamp оновлення", () => {
  it("підставляє свій час коли ДТЕК його не надіслав", async () => {
    await routeDtek({
      ajax: {
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ result: true, data: { 7: houseEntry() } }),
      },
    })

    const info = await fetchShutdowns(page, FAST)

    assert.match(info.updateTimestamp, /^\d{2}:\d{2} \d{2}\.\d{2}\.\d{4}$/)
  })

  it("не перебиває timestamp, надісланий ДТЕК", async () => {
    await routeDtek({
      ajax: {
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          result: true,
          data: { 7: houseEntry() },
          updateTimestamp: "08:15 20.10.2026",
        }),
      },
    })

    const info = await fetchShutdowns(page, FAST)

    assert.equal(info.updateTimestamp, "08:15 20.10.2026")
  })
})

describe("fetchShutdowns: погані відповіді", () => {
  // ДТЕК періодично віддає HTML-заглушку замість JSON
  it("не падає коли замість JSON прийшов HTML", async () => {
    await routeDtek({
      ajax: { status: 200, contentType: "text/html", body: "<html>502 Bad Gateway</html>" },
    })

    const info = await fetchShutdowns(page, FAST)

    assert.equal(info._nonJson, true)
    assert.match(info.text, /502 Bad Gateway/)
  })

  it("обрізає надто довгу не-JSON відповідь", async () => {
    await routeDtek({
      ajax: { status: 200, contentType: "text/html", body: "x".repeat(5000) },
    })

    const info = await fetchShutdowns(page, FAST)

    assert.equal(info.text.length, 2000)
  })

  it("повертає помилковий payload як є", async () => {
    await routeDtek({
      ajax: {
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ result: false, text: "Error" }),
      },
    })

    const info = await fetchShutdowns(page, FAST)

    assert.equal(info.result, false)
  })

  it("переживає відповідь з HTTP-помилкою", async () => {
    await routeDtek({
      ajax: {
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ result: false }),
      },
    })

    const info = await fetchShutdowns(page, FAST)

    assert.equal(info.result, false)
  })
})

describe("fetchShutdowns: артефакти", () => {
  it("пише відповідь у last_payload.json разом з надісланою адресою", async () => {
    await routeDtek()

    await fetchShutdowns(page, FAST)

    const saved = JSON.parse(fs.readFileSync(artifact("last_payload.json"), "utf8"))
    assert.equal(saved.status, 200)
    assert.equal(saved.ok, true)
    assert.deepEqual(saved.sent, { city: "Київ", street: "вул. Тестова" })
    assert.equal(saved.payload.result, true)
  })

  it("робить скриншот коли ДТЕК повернув result:false", async () => {
    await routeDtek({
      ajax: {
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ result: false, text: "Error" }),
      },
    })

    await fetchShutdowns(page, FAST)

    assert.equal(fs.existsSync(artifact("page.png")), true)
  })

  it("не робить скриншот коли відповідь нормальна", async () => {
    await routeDtek()

    await fetchShutdowns(page, FAST)

    assert.equal(fs.existsSync(artifact("page.png")), false)
  })
})

describe("fetchShutdowns: збої сторінки", () => {
  it("кидає помилку коли сторінка недоступна", async () => {
    await page.route(SHUTDOWNS_PAGE, (route) => route.abort("connectionrefused"))

    await assert.rejects(() => fetchShutdowns(page, FAST))
  })

  it("кидає помилку коли на сторінці немає csrf-токена", async () => {
    await page.route(SHUTDOWNS_PAGE, (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/html; charset=utf-8",
        body: "<!doctype html><html><body>Сайт на обслуговуванні</body></html>",
      })
    )

    await assert.rejects(() => fetchShutdowns(page, FAST))
  })
})
