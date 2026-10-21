// Фабрики тестовых данных в формате ответа ДТЕК (/ua/ajax, method=getHomeNum)

export function houseEntry(overrides = {}) {
  return {
    sub_type: "",
    start_date: "",
    end_date: "",
    type: "",
    sub_type_reason: [],
    voluntarily: null,
    cek: null,
    ...overrides,
  }
}

export function payload({ houses = {}, ...rest } = {}) {
  return {
    result: true,
    data: houses,
    updateTimestamp: "12:00 20.10.2026",
    ...rest,
  }
}

// Строка часов 1..24 для одной очереди. Час h — это промежуток (h-1):00–h:00
// по Киеву, по умолчанию свет есть.
export function factRow(hours = {}) {
  const row = {}

  for (let hour = 1; hour <= 24; hour++) {
    row[String(hour)] = hours[hour] || "yes"
  }

  return row
}

export function fact({ dayStart, groups, today = dayStart, update = "19.10.2026 20:20" }) {
  return {
    data: { [dayStart]: groups },
    today: String(today),
    update,
  }
}

export function silenceLogs() {
  const original = console.log
  console.log = () => {}
  return () => {
    console.log = original
  }
}

export function nowSec() {
  return Math.floor(Date.now() / 1000)
}
