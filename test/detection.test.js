import { after, before, describe, it } from "node:test"
import assert from "node:assert/strict"

import {
  checkIsOutage,
  checkIsScheduled,
  extractOutageInfo,
  hasUsableData,
  isDataUnavailable,
} from "../src/detection.js"

import { houseEntry, payload, silenceLogs } from "./factories.js"

const HOUSE = "7"

let restoreLogs

before(() => {
  restoreLogs = silenceLogs()
})

after(() => restoreLogs())

describe("isDataUnavailable", () => {
  it("распознаёт ошибочный ответ ДТЕК", () => {
    assert.equal(isDataUnavailable({ result: false, text: "Error" }), true)
  })

  it("распознаёт ответ без data", () => {
    assert.equal(isDataUnavailable({ result: true }), true)
  })

  it("распознаёт пустой ответ", () => {
    assert.equal(isDataUnavailable(null), true)
    assert.equal(isDataUnavailable(undefined), true)
  })

  it("пропускает нормальный ответ", () => {
    assert.equal(isDataUnavailable(payload({ houses: { [HOUSE]: houseEntry() } })), false)
  })
})

describe("hasUsableData", () => {
  it("требует наличия нашего дома в ответе", () => {
    const info = payload({ houses: { 9: houseEntry() } })
    assert.equal(hasUsableData(info, HOUSE), false)
  })

  it("требует настроенного номера дома", () => {
    const info = payload({ houses: { [HOUSE]: houseEntry() } })
    assert.equal(hasUsableData(info, ""), false)
    assert.equal(hasUsableData(info, undefined), false)
  })

  it("принимает ответ с нашим домом", () => {
    const info = payload({ houses: { [HOUSE]: houseEntry() } })
    assert.equal(hasUsableData(info, HOUSE), true)
  })
})

describe("checkIsOutage", () => {
  it("не считает ошибку ДТЕК отключением", () => {
    assert.equal(checkIsOutage({ result: false, text: "Error" }, HOUSE), false)
  })

  it("возвращает false если нашего дома нет в данных", () => {
    const info = payload({ houses: { 9: houseEntry({ sub_type: "Екстренні", start_date: "10:00" }) } })
    assert.equal(checkIsOutage(info, HOUSE), false)
  })

  it("возвращает false когда причина пустая", () => {
    const info = payload({
      houses: { [HOUSE]: houseEntry({ start_date: "10:00", end_date: "14:00" }) },
    })
    assert.equal(checkIsOutage(info, HOUSE), false)
  })

  it("возвращает false когда причина из одних пробелов", () => {
    const info = payload({
      houses: { [HOUSE]: houseEntry({ sub_type: "   ", start_date: "10:00" }) },
    })
    assert.equal(checkIsOutage(info, HOUSE), false)
  })

  it("возвращает false когда причина есть, а дат нет", () => {
    const info = payload({
      houses: { [HOUSE]: houseEntry({ sub_type: "Екстренні відключення" }) },
    })
    assert.equal(checkIsOutage(info, HOUSE), false)
  })

  it("находит отключение по причине и дате начала", () => {
    const info = payload({
      houses: { [HOUSE]: houseEntry({ sub_type: "Екстренні відключення", start_date: "10:00" }) },
    })
    assert.equal(checkIsOutage(info, HOUSE), true)
  })

  it("находит отключение когда известна только дата окончания", () => {
    const info = payload({
      houses: { [HOUSE]: houseEntry({ sub_type: "Екстренні відключення", end_date: "14:00" }) },
    })
    assert.equal(checkIsOutage(info, HOUSE), true)
  })

  it("всегда возвращает boolean, а не строку из данных", () => {
    const info = payload({
      houses: { [HOUSE]: houseEntry({ sub_type: "Екстренні", start_date: "10:00" }) },
    })
    assert.equal(typeof checkIsOutage(info, HOUSE), "boolean")
    assert.equal(typeof checkIsOutage(payload({ houses: {} }), HOUSE), "boolean")
  })
})

describe("checkIsScheduled", () => {
  it("не считает плановым аварийное отключение по type=2", () => {
    const info = payload({
      houses: {
        [HOUSE]: houseEntry({
          sub_type: "Відключення за графіком",
          type: "2",
          start_date: "10:00",
        }),
      },
    })
    assert.equal(checkIsScheduled(info, HOUSE), false)
  })

  it("не считает плановым отключение с 'екстренні' в причине", () => {
    const info = payload({
      houses: {
        [HOUSE]: houseEntry({ sub_type: "Екстренні відключення", start_date: "10:00" }),
      },
    })
    assert.equal(checkIsScheduled(info, HOUSE), false)
  })

  it("считает плановым отключение с датами и неаварийным типом", () => {
    const info = payload({
      houses: {
        [HOUSE]: houseEntry({
          sub_type: "Відключення за графіком",
          type: "1",
          start_date: "10:00",
          end_date: "14:00",
        }),
      },
    })
    assert.equal(checkIsScheduled(info, HOUSE), true)
  })

  it("возвращает false когда дат нет", () => {
    const info = payload({
      houses: { [HOUSE]: houseEntry({ sub_type: "Відключення за графіком" }) },
    })
    assert.equal(checkIsScheduled(info, HOUSE), false)
  })

  // Раньше была ветка, которая искала "екстренні"/"графік" по JSON всего ответа —
  // то есть по всем ~100 домам улицы. Решение должно зависеть только от своего дома.
  it("игнорирует аварию у соседнего дома", () => {
    const info = payload({
      houses: {
        [HOUSE]: houseEntry({
          sub_type: "Відключення за графіком",
          type: "1",
          start_date: "10:00",
        }),
        9: houseEntry({ sub_type: "Екстренні відключення", type: "2", start_date: "09:00" }),
      },
    })
    assert.equal(checkIsScheduled(info, HOUSE), true)
  })

  it("игнорирует график у соседнего дома", () => {
    const info = payload({
      houses: {
        [HOUSE]: houseEntry(),
        9: houseEntry({ sub_type: "Відключення за графіком", start_date: "09:00" }),
      },
    })
    assert.equal(checkIsScheduled(info, HOUSE), false)
  })
})

describe("extractOutageInfo", () => {
  it("возвращает null когда данных по дому нет", () => {
    assert.equal(extractOutageInfo(payload({ houses: {} }), HOUSE), null)
    assert.equal(extractOutageInfo({ result: false }, HOUSE), null)
  })

  it("забирает только поля, нужные для сравнения отключений", () => {
    const info = payload({
      houses: {
        [HOUSE]: houseEntry({
          sub_type: "Екстренні відключення",
          start_date: "10:00 20.10.2026",
          end_date: "14:00 20.10.2026",
          sub_type_reason: ["GPV26.1"],
        }),
      },
    })

    assert.deepEqual(extractOutageInfo(info, HOUSE), {
      start_date: "10:00 20.10.2026",
      end_date: "14:00 20.10.2026",
      sub_type: "Екстренні відключення",
    })
  })

  it("подставляет пустые строки вместо отсутствующих полей", () => {
    const info = payload({ houses: { [HOUSE]: {} } })

    assert.deepEqual(extractOutageInfo(info, HOUSE), {
      start_date: "",
      end_date: "",
      sub_type: "",
    })
  })
})
