import { HOUSE } from "./constants.js"

// Ответ без data или с result:false — это сбой на стороне ДТЕК, а не отсутствие
// отключения. Отличать их обязательно: иначе таймаут посреди отключения выглядит
// как "свет есть" и сбрасывает сохранённое состояние.
export function isDataUnavailable(info) {
  return !info || info.result === false || !info.data
}

// Данные пригодны к обработке только если в ответе есть наш дом. Иначе ничего не
// трогаем: ложное "normal" в Home Assistant выглядит как снятая авария.
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

  // Реальное отключение = когда sub_type не пустой И есть хотя бы одна дата
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

  // Смотрим только на свой дом: данные соседних домов к нашему отключению отношения не имеют
  if (!house || !info.data[house]) return false

  const houseData = info.data[house]

  // type === "2" означает экстренное отключение (НЕ по графику)
  if (houseData.type === "2") {
    console.log("⚠️ Emergency power outage (not scheduled)!")
    return false
  }

  if (houseData.sub_type && houseData.sub_type.toLowerCase().includes("екстренні")) {
    console.log("⚠️ Emergency power outage (not scheduled)!")
    return false
  }

  // Есть start_date/end_date и отключение не экстренное — значит плановое
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
