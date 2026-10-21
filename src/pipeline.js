import {
  checkIsOutage,
  checkIsScheduled,
  extractOutageInfo,
  hasUsableData,
} from "./detection.js"

import { deleteLastMessage } from "./helpers.js"
import { generateMessage } from "./message.js"
import { sendNotification, sendToHomeAssistant } from "./notifications.js"

// Решает, что делать с ответом ДТЕК. Вынесено из monitor.js, чтобы логику можно
// было проверять без запуска браузера.
export async function handleInfo(info) {
  // Збій сайту або немає даних по будинку — не шлемо в HA "normal",
  // інакше HA вирішить, що ДТЕК зняв аварію, а наступний запуск дасть "нову"
  if (!hasUsableData(info)) {
    console.log("⚠️ No valid DTEK data, skipping Home Assistant update")
    return
  }

  const isOutage = checkIsOutage(info)
  const isScheduled = checkIsScheduled(info)

  if (isOutage && !isScheduled) {
    const message = generateMessage(info)
    const outageInfo = extractOutageInfo(info)

    await sendNotification(message, outageInfo)

    // Отправляем данные в Home Assistant
    await sendToHomeAssistant(outageInfo, true, info)
  } else {
    console.log("ℹ️ No notification needed.")
    // Удаляем информацию о последнем сообщении когда отключения нет
    deleteLastMessage()

    // Уведомляем Home Assistant что отключения нет
    await sendToHomeAssistant(null, false, info)
  }
}
