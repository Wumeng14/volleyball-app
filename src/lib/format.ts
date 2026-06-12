const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

export function formatDate(dateStr: string) {
  const d = new Date(`${dateStr}T00:00:00`);
  return `${d.getMonth() + 1}/${d.getDate()}(${WEEKDAYS[d.getDay()]})`;
}

export function formatTime(t: string) {
  return t.slice(0, 5); // "19:00:00" -> "19:00"
}

export function formatNTD(n: number) {
  return `$${n.toLocaleString("zh-TW")}`;
}

/** 場次是否已過(以結束日期粗略判斷,僅供列表折疊用) */
export function isPastSession(dateStr: string) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return new Date(`${dateStr}T00:00:00`) < today;
}
