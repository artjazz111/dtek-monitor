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

  // Витягуємо детальну інформацію про відключення для конкретного будинку
  if (info?.data && house) {
    const houseData = info.data[house]
    console.log("DEBUG houseData for", house, ":", JSON.stringify(houseData))

    if (houseData) {
      // Причина відключення (тип)
      if (houseData.sub_type) {
        messageParts.push(`📋 <b>Причина:</b> ${escapeHtml(houseData.sub_type)}`)
      }

      // Додатковий опис причини
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

      // Час початку відключення
      if (houseData.start_date) {
        messageParts.push(`⏰ <b>Час початку:</b> ${escapeHtml(houseData.start_date)}`)
      }

      // Орієнтовний час відновлення
      if (houseData.end_date) {
        messageParts.push(`🔌 <b>Орієнтовний час відновлення:</b> до ${escapeHtml(houseData.end_date)}`)
      }

      messageParts.push("")
    }
  }

  // Дата оновлення інформації
  if (updateTimestamp) {
    messageParts.push(`🔄 <b>Дата оновлення:</b> ${escapeHtml(updateTimestamp)}`)
  }

  messageParts.push(`💬 <b>Час запиту:</b> ${getCurrentTime()}`)

  return messageParts.join("\n")
}
