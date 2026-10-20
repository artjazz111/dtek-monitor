import { CITY, STREET, HOUSE } from "./constants.js"
import { escapeHtml, getCurrentTime } from "./helpers.js"

export function generateMessage(info, house = HOUSE) {
  console.log("🌀 Generating message...")

  const updateTimestamp = info?.updateTimestamp || ""
  const messageParts = [
    "⚡️ <b>Зафіксовано відключення:</b>",
    "",
    `📍 <code>${escapeHtml(CITY)}, ${escapeHtml(STREET)}, ${escapeHtml(house)}</code>`,
    "",
  ]

  // Извлекаем детальную информацию об отключении для конкретного дома
  if (info?.data && house) {
    const houseData = info.data[house]
    console.log("DEBUG houseData for", house, ":", JSON.stringify(houseData))

    if (houseData) {
      // Причина отключения (тип)
      if (houseData.sub_type) {
        messageParts.push(`📋 <b>Причина:</b> ${escapeHtml(houseData.sub_type)}`)
      }

      // Дополнительное описание причины
      if (
        houseData.sub_type_reason &&
        Array.isArray(houseData.sub_type_reason) &&
        houseData.sub_type_reason.length > 0
      ) {
        const reasons = houseData.sub_type_reason
          .map((r) => escapeHtml(r).replace(/GPV/g, "Група "))
          .join(", ")
        messageParts.push(`   <i>${reasons}</i>`)
      }

      // Время начала отключения
      if (houseData.start_date) {
        messageParts.push(`⏰ <b>Час початку:</b> ${escapeHtml(houseData.start_date)}`)
      }

      // Ориентировочное время восстановления
      if (houseData.end_date) {
        messageParts.push(`🔌 <b>Орієнтовний час відновлення:</b> до ${escapeHtml(houseData.end_date)}`)
      }

      messageParts.push("")
    }
  }

  // Дата обновления информации
  if (updateTimestamp) {
    messageParts.push(`🔄 <b>Дата оновлення:</b> ${escapeHtml(updateTimestamp)}`)
  }

  messageParts.push(`💬 <b>Час запиту:</b> ${getCurrentTime()}`)

  return messageParts.join("\n")
}
