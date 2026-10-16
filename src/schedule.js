// Погодинний графік черг будинку з відповіді ДТЕК (info.fact).
// Година h (1..24) у fact означає проміжок (h-1):00–h:00 за Києвом.
// Ключ дня у fact.data — unix-час початку доби за Києвом.

const SLOT_SEC = 30 * 60;

const SLOT_STATES = {
  yes: ["on", "on"],
  no: ["off", "off"],
  first: ["off", "on"],
  second: ["on", "off"],
  maybe: ["maybe", "maybe"],
  mfirst: ["maybe", "on"],
  msecond: ["on", "maybe"],
};

function formatTime(sec, dayStart) {
  const m = Math.round((sec - dayStart) / 60);
  const hh = String(Math.floor(m / 60)).padStart(2, "0");
  const mm = String(m % 60).padStart(2, "0");
  return `${hh}:${mm}`;
}

function formatDate(dayStart) {
  return new Date(dayStart * 1000).toLocaleDateString("uk-UA", {
    timeZone: "Europe/Kyiv",
  });
}

// Інтервали підряд однакового стану для однієї черги за один день
function groupIntervals(row, dayStart) {
  const slots = [];
  for (let h = 1; h <= 24; h++) {
    slots.push(...(SLOT_STATES[row[String(h)]] || ["on", "on"]));
  }

  const intervals = [];
  for (let i = 0; i < slots.length; i++) {
    if (slots[i] === "on") continue;
    const last = intervals.at(-1);
    if (last && last.type === slots[i] && last.endSlot === i) {
      last.endSlot = i + 1;
    } else {
      intervals.push({ type: slots[i], startSlot: i, endSlot: i + 1 });
    }
  }

  return intervals.map(({ type, startSlot, endSlot }) => {
    const start = dayStart + startSlot * SLOT_SEC;
    const end = dayStart + endSlot * SLOT_SEC;
    return {
      type,
      start: new Date(start * 1000).toISOString(),
      end: new Date(end * 1000).toISOString(),
      text: `${formatTime(start, dayStart)}–${formatTime(end, dayStart)}`,
    };
  });
}

function summarize(groups) {
  const parts = Object.entries(groups).map(([group, intervals]) => {
    const off = intervals.filter((i) => i.type === "off").map((i) => i.text);
    const maybe = intervals.filter((i) => i.type === "maybe").map((i) => `${i.text}?`);
    const all = [...off, ...maybe];
    return `${group}: ${all.length ? all.join(", ") : "без відключень"}`;
  });
  return parts.join("; ");
}

// groupOverride (напр. "35.1") — якщо будинок у кількох чергах, а фактично діє одна
export function buildSchedule(info, house, now = new Date(), groupOverride = "") {
  const houseData = info?.data?.[house];
  const factDays = info?.fact?.data;
  if (!houseData || !factDays) return null;

  const groupIds = groupOverride
    ? [`GPV${groupOverride.replace(/^GPV/, "")}`]
    : (houseData.sub_type_reason || []).filter((g) => g.startsWith("GPV"));
  if (!groupIds.length) return null;

  const days = Object.keys(factDays)
    .map(Number)
    .sort((a, b) => a - b)
    .map((dayStart) => {
      const groups = {};
      for (const id of groupIds) {
        const row = factDays[dayStart]?.[id];
        if (row) groups[id.replace("GPV", "")] = groupIntervals(row, dayStart);
      }
      return { date: formatDate(dayStart), dayStart, groups, summary: summarize(groups) };
    });

  const todayStart = Number(info.fact.today);
  const today = days.find((d) => d.dayStart === todayStart);
  const tomorrow = days.find((d) => d.dayStart > todayStart);

  const nowIso = now.toISOString();
  const next = days
    .flatMap((d) =>
      Object.entries(d.groups).flatMap(([group, intervals]) =>
        intervals.filter((i) => i.type === "off").map((i) => ({ ...i, group }))
      )
    )
    .filter((i) => i.end > nowIso)
    .sort((a, b) => a.start.localeCompare(b.start))[0];

  return {
    groups: groupIds.map((g) => g.replace("GPV", "")),
    updated: info.fact.update || "",
    today: today?.summary || "",
    tomorrow: tomorrow ? `${tomorrow.date} — ${tomorrow.summary}` : "",
    next_outage: next
      ? { start: next.start, end: next.end, group: next.group, active: next.start <= nowIso }
      : null,
    days: days.map(({ date, groups }) => ({ date, groups })),
  };
}
