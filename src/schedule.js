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

function formatMinutes(m) {
  const hh = String(Math.floor(m / 60)).padStart(2, "0");
  const mm = String(m % 60).padStart(2, "0");
  return `${hh}:${mm}`;
}

const offsetFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: "Europe/Kyiv",
  timeZoneName: "longOffset",
});

// Зсув Києва від UTC у секундах на момент sec (+10800 влітку, +7200 взимку)
function kyivOffset(sec) {
  const name = offsetFormat
    .formatToParts(new Date(sec * 1000))
    .find((p) => p.type === "timeZoneName").value; // "GMT+03:00"
  const [, sign, hh, mm] = name.match(/GMT([+-])(\d{2}):(\d{2})/) || [null, "+", "00", "00"];
  return (sign === "-" ? -1 : 1) * (Number(hh) * 3600 + Number(mm) * 60);
}

// Київський настінний час (хвилини від півночі) → unix-секунди.
// Колонки ДТЕК — це години за годинником, тож у дні переходу на літній/зимовий
// час доба має 23/25 год, і просте dayStart + хвилини зсунуло б усе на годину.
function wallToEpoch(dayStart, minutes) {
  const guess = dayStart + minutes * 60;
  return guess + kyivOffset(dayStart) - kyivOffset(guess);
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
    const startMin = (startSlot * SLOT_SEC) / 60;
    const endMin = (endSlot * SLOT_SEC) / 60;
    return {
      type,
      start: new Date(wallToEpoch(dayStart, startMin) * 1000).toISOString(),
      end: new Date(wallToEpoch(dayStart, endMin) * 1000).toISOString(),
      text: `${formatMinutes(startMin)}–${formatMinutes(endMin)}`,
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

// Інтервали "без світла" (усі черги разом, суміжні злиті), що ще не скінчились:
// "start-end,start-end" у unix-секундах. Влазить у input_text HA (255 символів).
function offIntervalsString(days, now) {
  const nowSec = Math.floor(now.getTime() / 1000);
  const spans = days
    .flatMap((d) => Object.values(d.groups).flat())
    .filter((i) => i.type === "off")
    .map((i) => [Date.parse(i.start) / 1000, Date.parse(i.end) / 1000])
    .filter(([, end]) => end > nowSec)
    .sort((a, b) => a[0] - b[0]);

  const merged = [];
  for (const [start, end] of spans) {
    const last = merged.at(-1);
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }

  let out = "";
  for (const [start, end] of merged) {
    const part = `${out ? "," : ""}${start}-${end}`;
    if (out.length + part.length > 255) break;
    out += part;
  }
  return out;
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
    intervals: offIntervalsString(days, now),
    updated: info.fact.update || "",
    today: today?.summary || "",
    tomorrow: tomorrow ? `${tomorrow.date} — ${tomorrow.summary}` : "",
    next_outage: next
      ? { start: next.start, end: next.end, group: next.group, active: next.start <= nowIso }
      : null,
    days: days.map(({ date, groups }) => ({ date, groups })),
  };
}
