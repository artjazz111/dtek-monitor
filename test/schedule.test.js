import { describe, it } from "node:test"
import assert from "node:assert/strict"

import { buildSchedule } from "../src/schedule.js"
import { fact, factRow, houseEntry, payload } from "./factories.js"

const HOUSE = "7"

// Киевская полночь 20.10.2026 — обычные сутки, UTC+3
const DAY = 1792443600
// Киевская полночь 25.10.2026 — переход на зимнее время, сутки из 25 часов
const DST_DAY = 1792875600

function info({ groups = ["GPV26.1"], rows, dayStart = DAY, today = dayStart, update } = {}) {
  return payload({
    houses: { [HOUSE]: houseEntry({ sub_type_reason: groups }) },
    fact: fact({ dayStart, groups: rows, today, update }),
  })
}

describe("buildSchedule без данных", () => {
  it("возвращает null когда в ответе нет fact", () => {
    assert.equal(
      buildSchedule(payload({ houses: { [HOUSE]: houseEntry() } }), HOUSE, new Date()),
      null
    )
  })

  it("возвращает null когда нашего дома нет", () => {
    assert.equal(buildSchedule(info(), "999", new Date()), null)
  })

  it("возвращает null когда у дома не указаны очереди", () => {
    const withoutGroups = payload({
      houses: { [HOUSE]: houseEntry({ sub_type_reason: [] }) },
      fact: fact({ dayStart: DAY, groups: { "GPV26.1": factRow() } }),
    })

    assert.equal(buildSchedule(withoutGroups, HOUSE, new Date()), null)
  })
})

describe("buildSchedule: интервалы", () => {
  it("не находит отключений когда свет есть весь день", () => {
    const schedule = buildSchedule(
      info({ rows: { "GPV26.1": factRow() } }),
      HOUSE,
      new Date(DAY * 1000)
    )

    assert.equal(schedule.today, "26.1: без відключень")
    assert.equal(schedule.next_outage, null)
    assert.equal(schedule.intervals, "")
  })

  it("склеивает подряд идущие часы в один интервал", () => {
    // Часы 8,9,10 — это 07:00–10:00 по киевскому времени
    const schedule = buildSchedule(
      info({ rows: { "GPV26.1": factRow({ 8: "no", 9: "no", 10: "no" }) } }),
      HOUSE,
      new Date(DAY * 1000)
    )

    const intervals = schedule.days[0].groups["26.1"]
    assert.equal(intervals.length, 1)
    assert.equal(intervals[0].text, "07:00–10:00")
    assert.equal(intervals[0].start, "2026-10-20T04:00:00.000Z")
    assert.equal(intervals[0].end, "2026-10-20T07:00:00.000Z")
  })

  it("разделяет несмежные интервалы", () => {
    const schedule = buildSchedule(
      info({ rows: { "GPV26.1": factRow({ 8: "no", 14: "no", 15: "no" }) } }),
      HOUSE,
      new Date(DAY * 1000)
    )

    assert.deepEqual(
      schedule.days[0].groups["26.1"].map((i) => i.text),
      ["07:00–08:00", "13:00–15:00"]
    )
  })

  it("учитывает получасовые состояния", () => {
    // "second" — свет есть первые полчаса и нет вторые, дальше час без света
    const schedule = buildSchedule(
      info({ rows: { "GPV26.1": factRow({ 7: "second", 8: "no" }) } }),
      HOUSE,
      new Date(DAY * 1000)
    )

    const intervals = schedule.days[0].groups["26.1"]
    assert.equal(intervals.length, 1)
    assert.equal(intervals[0].text, "06:30–08:00")
  })

  it("учитывает 'first' — отключение в первой половине часа", () => {
    const schedule = buildSchedule(
      info({ rows: { "GPV26.1": factRow({ 9: "first" }) } }),
      HOUSE,
      new Date(DAY * 1000)
    )

    assert.deepEqual(
      schedule.days[0].groups["26.1"].map((i) => i.text),
      ["08:00–08:30"]
    )
  })

  it("различает возможное отключение и подтверждённое", () => {
    const schedule = buildSchedule(
      info({ rows: { "GPV26.1": factRow({ 8: "no", 12: "maybe" }) } }),
      HOUSE,
      new Date(DAY * 1000)
    )

    const intervals = schedule.days[0].groups["26.1"]
    assert.deepEqual(
      intervals.map((i) => [i.type, i.text]),
      [
        ["off", "07:00–08:00"],
        ["maybe", "11:00–12:00"],
      ]
    )
    // В сводке возможные отключения помечены знаком вопроса
    assert.equal(schedule.today, "26.1: 07:00–08:00, 11:00–12:00?")
  })
})

describe("buildSchedule: очереди", () => {
  it("собирает все очереди дома", () => {
    const schedule = buildSchedule(
      info({
        groups: ["GPV26.1", "GPV29.1"],
        rows: {
          "GPV26.1": factRow({ 8: "no" }),
          "GPV29.1": factRow({ 20: "no" }),
        },
      }),
      HOUSE,
      new Date(DAY * 1000)
    )

    assert.deepEqual(schedule.groups, ["26.1", "29.1"])
    assert.equal(schedule.today, "26.1: 07:00–08:00; 29.1: 19:00–20:00")
  })

  it("groupOverride оставляет только одну очередь", () => {
    const schedule = buildSchedule(
      info({
        groups: ["GPV26.1", "GPV29.1"],
        rows: {
          "GPV26.1": factRow({ 8: "no" }),
          "GPV29.1": factRow({ 20: "no" }),
        },
      }),
      HOUSE,
      new Date(DAY * 1000),
      "29.1"
    )

    assert.deepEqual(schedule.groups, ["29.1"])
    assert.equal(schedule.today, "29.1: 19:00–20:00")
  })

  it("groupOverride понимает значение с префиксом GPV", () => {
    const schedule = buildSchedule(
      info({ groups: ["GPV26.1"], rows: { "GPV26.1": factRow({ 8: "no" }) } }),
      HOUSE,
      new Date(DAY * 1000),
      "GPV26.1"
    )

    assert.deepEqual(schedule.groups, ["26.1"])
  })

  it("игнорирует очереди, которых нет в графике", () => {
    const schedule = buildSchedule(
      info({ groups: ["GPV26.1", "GPV99.9"], rows: { "GPV26.1": factRow({ 8: "no" }) } }),
      HOUSE,
      new Date(DAY * 1000)
    )

    assert.deepEqual(Object.keys(schedule.days[0].groups), ["26.1"])
  })
})

describe("buildSchedule: next_outage", () => {
  const rows = { "GPV26.1": factRow({ 8: "no", 9: "no", 20: "no" }) }

  it("берёт ближайшее отключение впереди", () => {
    // 05:00 по Киеву — до обоих отключений
    const now = new Date("2026-10-20T02:00:00.000Z")
    const schedule = buildSchedule(info({ rows }), HOUSE, now)

    assert.equal(schedule.next_outage.start, "2026-10-20T04:00:00.000Z")
    assert.equal(schedule.next_outage.group, "26.1")
    assert.equal(schedule.next_outage.active, false)
  })

  it("помечает active когда отключение уже идёт", () => {
    // 08:00 по Киеву — внутри интервала 07:00–09:00
    const now = new Date("2026-10-20T05:00:00.000Z")
    const schedule = buildSchedule(info({ rows }), HOUSE, now)

    assert.equal(schedule.next_outage.start, "2026-10-20T04:00:00.000Z")
    assert.equal(schedule.next_outage.active, true)
  })

  it("пропускает отключения, которые уже закончились", () => {
    // 12:00 по Киеву — первое отключение прошло, осталось вечернее
    const now = new Date("2026-10-20T09:00:00.000Z")
    const schedule = buildSchedule(info({ rows }), HOUSE, now)

    assert.equal(schedule.next_outage.start, "2026-10-20T16:00:00.000Z")
    assert.equal(schedule.next_outage.active, false)
  })

  it("возвращает null когда отключений на сегодня больше нет", () => {
    const now = new Date("2026-10-20T20:00:00.000Z")
    const schedule = buildSchedule(info({ rows }), HOUSE, now)

    assert.equal(schedule.next_outage, null)
  })
})

describe("buildSchedule: строка intervals для Home Assistant", () => {
  it("отдаёт только будущие отключения парами unix-времени", () => {
    const now = new Date("2026-10-20T02:00:00.000Z")
    const schedule = buildSchedule(
      info({ rows: { "GPV26.1": factRow({ 8: "no", 20: "no" }) } }),
      HOUSE,
      now
    )

    assert.equal(
      schedule.intervals,
      `${Date.parse("2026-10-20T04:00:00Z") / 1000}-${Date.parse("2026-10-20T05:00:00Z") / 1000},` +
        `${Date.parse("2026-10-20T16:00:00Z") / 1000}-${Date.parse("2026-10-20T17:00:00Z") / 1000}`
    )
  })

  it("сливает пересекающиеся отключения разных очередей", () => {
    const now = new Date("2026-10-20T02:00:00.000Z")
    const schedule = buildSchedule(
      info({
        groups: ["GPV26.1", "GPV29.1"],
        rows: {
          "GPV26.1": factRow({ 8: "no" }),
          "GPV29.1": factRow({ 9: "no" }),
        },
      }),
      HOUSE,
      now
    )

    // 07:00–08:00 и 08:00–09:00 — это один промежуток без света
    assert.equal(
      schedule.intervals,
      `${Date.parse("2026-10-20T04:00:00Z") / 1000}-${Date.parse("2026-10-20T06:00:00Z") / 1000}`
    )
  })

  it("влезает в ограничение input_text в 255 символов", () => {
    // Через час свет, через час нет — максимум интервалов за сутки
    const hours = {}
    for (let hour = 1; hour <= 24; hour += 2) hours[hour] = "no"

    const schedule = buildSchedule(
      info({ rows: { "GPV26.1": factRow(hours) } }),
      HOUSE,
      new Date(DAY * 1000)
    )

    assert.ok(schedule.intervals.length <= 255, `длина ${schedule.intervals.length}`)
    assert.match(schedule.intervals, /^\d+-\d+(,\d+-\d+)*$/)
  })
})

describe("buildSchedule в день перехода на зимнее время", () => {
  // 25.10.2026 Киев переводит часы 04:00 → 03:00, в сутках 25 часов.
  // Колонки ДТЕК — это время по часам на стене, поэтому вечерние интервалы
  // должны считаться уже по UTC+2, а не по UTC+3.
  it("держит вечерние интервалы по настенному времени", () => {
    const schedule = buildSchedule(
      info({ rows: { "GPV26.1": factRow({ 20: "no" }) }, dayStart: DST_DAY }),
      HOUSE,
      new Date(DST_DAY * 1000)
    )

    const intervals = schedule.days[0].groups["26.1"]
    assert.equal(intervals[0].text, "19:00–20:00")
    // 19:00 по Киеву 25.10.2026 — это 17:00 UTC (уже UTC+2)
    assert.equal(intervals[0].start, "2026-10-25T17:00:00.000Z")
    assert.equal(intervals[0].end, "2026-10-25T18:00:00.000Z")
  })

  it("держит ночные интервалы по настенному времени", () => {
    const schedule = buildSchedule(
      info({ rows: { "GPV26.1": factRow({ 2: "no" }) }, dayStart: DST_DAY }),
      HOUSE,
      new Date(DST_DAY * 1000)
    )

    const intervals = schedule.days[0].groups["26.1"]
    assert.equal(intervals[0].text, "01:00–02:00")
    // 01:00 по Киеву 25.10.2026 — ещё UTC+3, значит 22:00 UTC предыдущих суток
    assert.equal(intervals[0].start, "2026-10-24T22:00:00.000Z")
  })
})

describe("buildSchedule: сводка по дням", () => {
  it("отделяет сегодня от завтра", () => {
    const tomorrow = DAY + 24 * 60 * 60
    const withTwoDays = payload({
      houses: { [HOUSE]: houseEntry({ sub_type_reason: ["GPV26.1"] }) },
      fact: {
        today: String(DAY),
        update: "19.10.2026 20:20",
        data: {
          [DAY]: { "GPV26.1": factRow({ 8: "no" }) },
          [tomorrow]: { "GPV26.1": factRow({ 20: "no" }) },
        },
      },
    })

    const schedule = buildSchedule(withTwoDays, HOUSE, new Date(DAY * 1000))

    assert.equal(schedule.today, "26.1: 07:00–08:00")
    assert.equal(schedule.tomorrow, "21.10.2026 — 26.1: 19:00–20:00")
    assert.equal(schedule.days.length, 2)
  })

  it("пробрасывает время обновления графика", () => {
    const schedule = buildSchedule(
      info({ rows: { "GPV26.1": factRow() }, update: "20.10.2026 08:15" }),
      HOUSE,
      new Date(DAY * 1000)
    )

    assert.equal(schedule.updated, "20.10.2026 08:15")
  })
})
