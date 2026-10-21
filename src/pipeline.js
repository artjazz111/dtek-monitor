import {
  checkIsOutage,
  checkIsScheduled,
  extractOutageInfo,
  hasUsableData,
} from "./detection.js"

import { deleteLastMessage } from "./helpers.js"
import { generateMessage } from "./message.js"
import { sendNotification, sendToHomeAssistant } from "./notifications.js"

// Вирішує, що робити з відповіддю ДТЕК. Винесено з monitor.js, щоб логіку можна
// було перевіряти без запуску браузера.
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

    // Надсилаємо дані в Home Assistant
    await sendToHomeAssistant(outageInfo, true, info)
  } else {
    console.log("ℹ️ No notification needed.")
    // Видаляємо дані про останнє повідомлення, коли відключення немає
    deleteLastMessage()

    // Повідомляємо Home Assistant, що відключення немає
    await sendToHomeAssistant(null, false, info)
  }
}
