// Masa dalam zon Asia/Kuala_Lumpur (UTC+8, tiada DST).
const MY_OFFSET_MS = 8 * 60 * 60 * 1000;

function pad(n) {
  return String(n).padStart(2, '0');
}

// "YYYY-MM-DDTHH:mm:ss+08:00"
export function isoMY(nowMs = Date.now()) {
  const d = new Date(nowMs + MY_OFFSET_MS);
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}+08:00`
  );
}

// "YYYY-MM-DD" hari ini di Malaysia
export function todayMY(nowMs = Date.now()) {
  return isoMY(nowMs).slice(0, 10);
}
