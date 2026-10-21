import { HOUSE } from "./constants.js"

// Відповідь без data або з result:false — це збій на боці ДТЕК, а не відсутність
// відключення. Відрізняти їх обов'язково: інакше таймаут посеред відключення
// виглядає як "світло є" і скидає збережений стан.
export function isDataUnavailable(info) {
  return !info || info.result === false || !info.data
}

// Дані придатні до обробки лише якщо у відповіді є наш будинок. Інакше нічого не
// чіпаємо: хибне "normal" у Home Assistant виглядає як знята аварія.
export function hasUsableData(info, house = HOUSE) {
  return !isDataUnavailable(info) && Boolean(house) && Boolean(info.data[house])
}

export function checkIsOutage(info, house = HOUSE) {
  console.log("🌀 Checking power outage...")

  if (isDataUnavailable(info)) {
    console.log("⚠️ No data from DTEK (error payload / address not found / format changed).")
    return false
  }

  if (!house || !info.data[house]) {
    console.log("⚠️ No data for specified house.")
    return false
  }

  const houseData = info.data[house]

  // Справжнє відключення = коли sub_type не порожній І є хоча б одна дата
  const hasOutage = Boolean(
    houseData.sub_type &&
      houseData.sub_type.trim() !== "" &&
      (houseData.start_date || houseData.end_date)
  )

  hasOutage ? console.log("🚨 Power outage detected!") : console.log("⚡️ No power outage!")
  return hasOutage
}

export function checkIsScheduled(info, house = HOUSE) {
  console.log("🌀 Checking whether power outage scheduled...")

  if (isDataUnavailable(info)) return false

  // Дивимось лише на свій будинок: дані сусідніх будинків нашого відключення не стосуються
  if (!house || !info.data[house]) return false

  const houseData = info.data[house]

  // type === "2" означає екстрене відключення (НЕ за графіком)
  if (houseData.type === "2") {
    console.log("⚠️ Emergency power outage (not scheduled)!")
    return false
  }

  if (houseData.sub_type && houseData.sub_type.toLowerCase().includes("екстренні")) {
    console.log("⚠️ Emergency power outage (not scheduled)!")
    return false
  }

  // Є start_date/end_date і відключення не екстрене — отже планове
  if (houseData.start_date || houseData.end_date) {
    console.log("🗓️ Scheduled power outage!")
    return true
  }

  console.log("⚠️ Power outage not scheduled!")
  return false
}

export function extractOutageInfo(info, house = HOUSE) {
  if (isDataUnavailable(info) || !house || !info.data[house]) return null

  const houseData = info.data[house]

  return {
    start_date: houseData.start_date || "",
    end_date: houseData.end_date || "",
    sub_type: houseData.sub_type || "",
  }
}
