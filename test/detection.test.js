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
  it("розпізнає помилкову відповідь ДТЕК", () => {
    assert.equal(isDataUnavailable({ result: false, text: "Error" }), true)
  })

  it("розпізнає відповідь без data", () => {
    assert.equal(isDataUnavailable({ result: true }), true)
  })

  it("розпізнає порожню відповідь", () => {
    assert.equal(isDataUnavailable(null), true)
    assert.equal(isDataUnavailable(undefined), true)
  })

  it("пропускає нормальну відповідь", () => {
    assert.equal(isDataUnavailable(payload({ houses: { [HOUSE]: houseEntry() } })), false)
  })
})

describe("hasUsableData", () => {
  it("вимагає наявності нашого будинку у відповіді", () => {
    const info = payload({ houses: { 9: houseEntry() } })
    assert.equal(hasUsableData(info, HOUSE), false)
  })

  it("вимагає налаштованого номера будинку", () => {
    const info = payload({ houses: { [HOUSE]: houseEntry() } })
    assert.equal(hasUsableData(info, ""), false)
    assert.equal(hasUsableData(info, undefined), false)
  })

  it("приймає відповідь з нашим будинком", () => {
    const info = payload({ houses: { [HOUSE]: houseEntry() } })
    assert.equal(hasUsableData(info, HOUSE), true)
  })
})

describe("checkIsOutage", () => {
  it("не вважає помилку ДТЕК відключенням", () => {
    assert.equal(checkIsOutage({ result: false, text: "Error" }, HOUSE), false)
  })

  it("повертає false якщо нашого будинку немає в даних", () => {
    const info = payload({ houses: { 9: houseEntry({ sub_type: "Екстренні", start_date: "10:00" }) } })
    assert.equal(checkIsOutage(info, HOUSE), false)
  })

  it("повертає false коли причина порожня", () => {
    const info = payload({
      houses: { [HOUSE]: houseEntry({ start_date: "10:00", end_date: "14:00" }) },
    })
    assert.equal(checkIsOutage(info, HOUSE), false)
  })

  it("повертає false коли причина з одних пробілів", () => {
    const info = payload({
      houses: { [HOUSE]: houseEntry({ sub_type: "   ", start_date: "10:00" }) },
    })
    assert.equal(checkIsOutage(info, HOUSE), false)
  })

  it("повертає false коли причина є, а дат немає", () => {
    const info = payload({
      houses: { [HOUSE]: houseEntry({ sub_type: "Екстренні відключення" }) },
    })
    assert.equal(checkIsOutage(info, HOUSE), false)
  })

  it("знаходить відключення за причиною і датою початку", () => {
    const info = payload({
      houses: { [HOUSE]: houseEntry({ sub_type: "Екстренні відключення", start_date: "10:00" }) },
    })
    assert.equal(checkIsOutage(info, HOUSE), true)
  })

  it("знаходить відключення коли відома лише дата закінчення", () => {
    const info = payload({
      houses: { [HOUSE]: houseEntry({ sub_type: "Екстренні відключення", end_date: "14:00" }) },
    })
    assert.equal(checkIsOutage(info, HOUSE), true)
  })

  it("завжди повертає boolean, а не рядок з даних", () => {
    const info = payload({
      houses: { [HOUSE]: houseEntry({ sub_type: "Екстренні", start_date: "10:00" }) },
    })
    assert.equal(typeof checkIsOutage(info, HOUSE), "boolean")
    assert.equal(typeof checkIsOutage(payload({ houses: {} }), HOUSE), "boolean")
  })
})

describe("checkIsScheduled", () => {
  it("не вважає плановим аварійне відключення за type=2", () => {
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

  it("не вважає плановим відключення з 'екстренні' у причині", () => {
    const info = payload({
      houses: {
        [HOUSE]: houseEntry({ sub_type: "Екстренні відключення", start_date: "10:00" }),
      },
    })
    assert.equal(checkIsScheduled(info, HOUSE), false)
  })

  it("вважає плановим відключення з датами і неаварійним типом", () => {
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

  it("повертає false коли дат немає", () => {
    const info = payload({
      houses: { [HOUSE]: houseEntry({ sub_type: "Відключення за графіком" }) },
    })
    assert.equal(checkIsScheduled(info, HOUSE), false)
  })

  // Раніше була гілка, яка шукала "екстренні"/"графік" по JSON усієї відповіді —
  // тобто по всіх ~100 будинках вулиці. Рішення має залежати лише від свого будинку.
  it("ігнорує аварію в сусіднього будинку", () => {
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

  it("ігнорує графік у сусіднього будинку", () => {
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
  it("повертає null коли даних по будинку немає", () => {
    assert.equal(extractOutageInfo(payload({ houses: {} }), HOUSE), null)
    assert.equal(extractOutageInfo({ result: false }, HOUSE), null)
  })

  it("забирає лише поля, потрібні для порівняння відключень", () => {
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

  it("підставляє порожні рядки замість відсутніх полів", () => {
    const info = payload({ houses: { [HOUSE]: {} } })

    assert.deepEqual(extractOutageInfo(info, HOUSE), {
      start_date: "",
      end_date: "",
      sub_type: "",
    })
  })
})
