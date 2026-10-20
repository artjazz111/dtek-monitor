import { after, before, describe, it } from "node:test"
import assert from "node:assert/strict"

import { houseEntry, payload, silenceLogs } from "./factories.js"

process.env.CITY = "Київ"
process.env.STREET = "вул. Тестова"
process.env.HOUSE = "7"

const HOUSE = process.env.HOUSE

const { escapeHtml } = await import("../src/helpers.js")
const { generateMessage } = await import("../src/message.js")

let restoreLogs

before(() => {
  restoreLogs = silenceLogs()
})

after(() => restoreLogs())

const outage = (overrides) => payload({ houses: { [HOUSE]: houseEntry(overrides) } })

describe("escapeHtml", () => {
  it("экранирует символы, ломающие разбор HTML в Telegram", () => {
    assert.equal(escapeHtml("ТП-5 & ТП-7"), "ТП-5 &amp; ТП-7")
    assert.equal(escapeHtml("<b>"), "&lt;b&gt;")
  })

  it("экранирует все вхождения, а не только первое", () => {
    assert.equal(escapeHtml("a & b & c"), "a &amp; b &amp; c")
  })

  it("сначала заменяет амперсанд, чтобы не портить уже готовые сущности", () => {
    assert.equal(escapeHtml("<&>"), "&lt;&amp;&gt;")
  })

  it("не трогает обычный текст", () => {
    assert.equal(escapeHtml("Екстренні відключення"), "Екстренні відключення")
  })
})

describe("generateMessage: содержимое", () => {
  it("собирает адрес, причину, очереди и время", () => {
    const message = generateMessage(
      outage({
        sub_type: "Екстренні відключення",
        start_date: "10:00 20.10.2026",
        end_date: "14:00 20.10.2026",
        sub_type_reason: ["GPV26.1", "GPV29.1"],
      }),
      HOUSE
    )

    assert.match(message, /📍 <code>Київ, вул\. Тестова, 7<\/code>/)
    assert.match(message, /Причина:<\/b> Екстренні відключення/)
    assert.match(message, /<i>Група 26\.1, Група 29\.1<\/i>/)
    assert.match(message, /Час початку:<\/b> 10:00 20\.10\.2026/)
    assert.match(message, /до 14:00 20\.10\.2026/)
    assert.match(message, /Дата оновлення:<\/b> 12:00 20\.10\.2026/)
    assert.match(message, /Час запиту:<\/b> \d{2}:\d{2} \d{2}\.\d{2}\.\d{4}/)
  })

  it("пропускает блоки, которых нет в данных", () => {
    const message = generateMessage(outage({ sub_type: "Екстренні відключення" }), HOUSE)

    assert.match(message, /Причина:/)
    assert.doesNotMatch(message, /Час початку/)
    assert.doesNotMatch(message, /час відновлення/)
    assert.doesNotMatch(message, /<i>/)
  })

  it("не падает когда данных по дому нет", () => {
    const message = generateMessage(payload({ houses: {} }), HOUSE)

    assert.match(message, /Зафіксовано відключення/)
    assert.match(message, /Київ, вул\. Тестова, 7/)
  })

  it("не падает на пустом ответе", () => {
    assert.match(generateMessage(null, HOUSE), /Зафіксовано відключення/)
    assert.match(generateMessage(undefined, HOUSE), /Зафіксовано відключення/)
  })

  it("обходится без времени обновления", () => {
    const info = outage({ sub_type: "Екстренні відключення" })
    delete info.updateTimestamp

    assert.doesNotMatch(generateMessage(info, HOUSE), /Дата оновлення/)
  })

  it("игнорирует sub_type_reason неожидаемого вида", () => {
    const message = generateMessage(
      outage({ sub_type: "Екстренні відключення", sub_type_reason: "GPV26.1" }),
      HOUSE
    )

    assert.doesNotMatch(message, /<i>/)
  })
})

describe("generateMessage: экранирование", () => {
  // Иначе Telegram отвечает 400 can't parse entities и сообщение не доходит
  it("экранирует причину из ответа ДТЕК", () => {
    const message = generateMessage(
      outage({ sub_type: "Ремонт ТП-5 & ТП-7", start_date: "10:00" }),
      HOUSE
    )

    assert.match(message, /Ремонт ТП-5 &amp; ТП-7/)
    assert.doesNotMatch(message, /ТП-5 & ТП-7/)
  })

  it("экранирует даты из ответа ДТЕК", () => {
    const message = generateMessage(
      outage({ sub_type: "Авария", start_date: "10:00 <br>", end_date: "14:00 & пізніше" }),
      HOUSE
    )

    assert.match(message, /10:00 &lt;br&gt;/)
    assert.match(message, /14:00 &amp; пізніше/)
  })

  it("экранирует описание очередей", () => {
    const message = generateMessage(
      outage({ sub_type: "Авария", sub_type_reason: ["GPV26.1 & GPV29.1"] }),
      HOUSE
    )

    assert.match(message, /Група 26\.1 &amp; Група 29\.1/)
  })

  it("экранирует время обновления", () => {
    const info = outage({ sub_type: "Авария" })
    info.updateTimestamp = "12:00 <script>"

    assert.match(generateMessage(info, HOUSE), /12:00 &lt;script&gt;/)
  })

  it("оставляет собственную разметку сообщения нетронутой", () => {
    const message = generateMessage(outage({ sub_type: "Авария", start_date: "10:00" }), HOUSE)

    assert.match(message, /^⚡️ <b>Зафіксовано відключення:<\/b>/)
    assert.match(message, /<code>/)
  })
})
