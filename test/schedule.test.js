import { describe, it } from "node:test"
import assert from "node:assert/strict"

import { buildSchedule } from "../src/schedule.js"
import { fact, factRow, houseEntry, payload } from "./factories.js"

const HOUSE = "7"

// Київська полуніч 20.10.2026 — звичайна доба, UTC+3
const DAY = 1792443600
// Київська полуніч 25.10.2026 — перехід на зимовий час, доба з 25 годин
const DST_DAY = 1792875600

function info({ groups = ["GPV26.1"], rows, dayStart = DAY, today = dayStart, update } = {}) {
  return payload({
    houses: { [HOUSE]: houseEntry({ sub_type_reason: groups }) },
    fact: fact({ dayStart, groups: rows, today, update }),
  })
}

describe("buildSchedule без даних", () => {
  it("повертає null коли у відповіді немає fact", () => {
    assert.equal(
      buildSchedule(payload({ houses: { [HOUSE]: houseEntry() } }), HOUSE, new Date()),
      null
    )
  })

  it("повертає null коли нашого будинку немає", () => {
    assert.equal(buildSchedule(info(), "999", new Date()), null)
  })

  it("повертає null коли в будинку не вказані черги", () => {
    const withoutGroups = payload({
      houses: { [HOUSE]: houseEntry({ sub_type_reason: [] }) },
      fact: fact({ dayStart: DAY, groups: { "GPV26.1": factRow() } }),
    })

    assert.equal(buildSchedule(withoutGroups, HOUSE, new Date()), null)
  })
})

describe("buildSchedule: інтервали", () => {
  it("не знаходить відключень коли світло є весь день", () => {
    const schedule = buildSchedule(
      info({ rows: { "GPV26.1": factRow() } }),
      HOUSE,
      new Date(DAY * 1000)
    )

    assert.equal(schedule.today, "26.1: без відключень")
    assert.equal(schedule.next_outage, null)
    assert.equal(schedule.intervals, "")
  })

  it("склеює суміжні години в один інтервал", () => {
    // Години 8,9,10 — це 07:00–10:00 за київським часом
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

  it("розділяє несуміжні інтервали", () => {
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

  it("враховує півгодинні стани", () => {
    // "second" — світло є перші півгодини і немає другі, далі година без світла
    const schedule = buildSchedule(
      info({ rows: { "GPV26.1": factRow({ 7: "second", 8: "no" }) } }),
      HOUSE,
      new Date(DAY * 1000)
    )

    const intervals = schedule.days[0].groups["26.1"]
    assert.equal(intervals.length, 1)
    assert.equal(intervals[0].text, "06:30–08:00")
  })

  it("враховує 'first' — відключення в першій половині години", () => {
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

  it("розрізняє можливе відключення і підтверджене", () => {
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
    // У зведенні можливі відключення позначені знаком питання
    assert.equal(schedule.today, "26.1: 07:00–08:00, 11:00–12:00?")
  })
})

describe("buildSchedule: черги", () => {
  it("збирає всі черги будинку", () => {
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

  it("groupOverride залишає лише одну чергу", () => {
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

  it("groupOverride розуміє значення з префіксом GPV", () => {
    const schedule = buildSchedule(
      info({ groups: ["GPV26.1"], rows: { "GPV26.1": factRow({ 8: "no" }) } }),
      HOUSE,
      new Date(DAY * 1000),
      "GPV26.1"
    )

    assert.deepEqual(schedule.groups, ["26.1"])
  })

  it("ігнорує черги, яких немає в графіку", () => {
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

  it("бере найближче відключення попереду", () => {
    // 05:00 за Києвом — до обох відключень
    const now = new Date("2026-10-20T02:00:00.000Z")
    const schedule = buildSchedule(info({ rows }), HOUSE, now)

    assert.equal(schedule.next_outage.start, "2026-10-20T04:00:00.000Z")
    assert.equal(schedule.next_outage.group, "26.1")
    assert.equal(schedule.next_outage.active, false)
  })

  it("позначає active коли відключення вже триває", () => {
    // 08:00 за Києвом — усередині інтервалу 07:00–09:00
    const now = new Date("2026-10-20T05:00:00.000Z")
    const schedule = buildSchedule(info({ rows }), HOUSE, now)

    assert.equal(schedule.next_outage.start, "2026-10-20T04:00:00.000Z")
    assert.equal(schedule.next_outage.active, true)
  })

  it("пропускає відключення, які вже закінчились", () => {
    // 12:00 за Києвом — перше відключення минуло, лишилось вечірнє
    const now = new Date("2026-10-20T09:00:00.000Z")
    const schedule = buildSchedule(info({ rows }), HOUSE, now)

    assert.equal(schedule.next_outage.start, "2026-10-20T16:00:00.000Z")
    assert.equal(schedule.next_outage.active, false)
  })

  it("повертає null коли відключень на сьогодні більше немає", () => {
    const now = new Date("2026-10-20T20:00:00.000Z")
    const schedule = buildSchedule(info({ rows }), HOUSE, now)

    assert.equal(schedule.next_outage, null)
  })
})

describe("buildSchedule: рядок intervals для Home Assistant", () => {
  it("віддає лише майбутні відключення парами unix-часу", () => {
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

  it("зливає перетинні відключення різних черг", () => {
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

    // 07:00–08:00 і 08:00–09:00 — це один проміжок без світла
    assert.equal(
      schedule.intervals,
      `${Date.parse("2026-10-20T04:00:00Z") / 1000}-${Date.parse("2026-10-20T06:00:00Z") / 1000}`
    )
  })

  it("влазить в обмеження input_text у 255 символів", () => {
    // Через годину світло, через годину ні — максимум інтервалів за добу
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

describe("buildSchedule у день переходу на зимовий час", () => {
  // 25.10.2026 Київ переводить години 04:00 → 03:00, у добі 25 годин.
  // Колонки ДТЕК — це час за годинником на стіні, тому вечірні інтервали
  // мають рахуватись уже за UTC+2, а не за UTC+3.
  it("тримає вечірні інтервали за настінним часом", () => {
    const schedule = buildSchedule(
      info({ rows: { "GPV26.1": factRow({ 20: "no" }) }, dayStart: DST_DAY }),
      HOUSE,
      new Date(DST_DAY * 1000)
    )

    const intervals = schedule.days[0].groups["26.1"]
    assert.equal(intervals[0].text, "19:00–20:00")
    // 19:00 за Києвом 25.10.2026 — це 17:00 UTC (уже UTC+2)
    assert.equal(intervals[0].start, "2026-10-25T17:00:00.000Z")
    assert.equal(intervals[0].end, "2026-10-25T18:00:00.000Z")
  })

  it("тримає нічні інтервали за настінним часом", () => {
    const schedule = buildSchedule(
      info({ rows: { "GPV26.1": factRow({ 2: "no" }) }, dayStart: DST_DAY }),
      HOUSE,
      new Date(DST_DAY * 1000)
    )

    const intervals = schedule.days[0].groups["26.1"]
    assert.equal(intervals[0].text, "01:00–02:00")
    // 01:00 за Києвом 25.10.2026 — ще UTC+3, отже 22:00 UTC попередньої доби
    assert.equal(intervals[0].start, "2026-10-24T22:00:00.000Z")
  })
})

describe("buildSchedule: зведення по днях", () => {
  it("відділяє сьогодні від завтра", () => {
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

  it("передає час оновлення графіка", () => {
    const schedule = buildSchedule(
      info({ rows: { "GPV26.1": factRow() }, update: "20.10.2026 08:15" }),
      HOUSE,
      new Date(DAY * 1000)
    )

    assert.equal(schedule.updated, "20.10.2026 08:15")
  })
})
