/** Data rules shared by the calendar UI and its JSON import boundary. */
export const SCHEDULE_LIMITS = Object.freeze({ labs: 100, sessions: 2000 });

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const DATE = /^(?!0000)\d{4}-\d{2}-\d{2}$/;
const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

function fail(path, message) {
  throw new Error(`${path}: ${message}`);
}

function record(value, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(path, 'オブジェクトを指定してください。');
  }
  return value;
}

function text(value, path, max, optional = false) {
  if (optional && value === undefined) return '';
  if (typeof value !== 'string') fail(path, '文字列を指定してください。');
  const result = value.trim();
  if (!optional && result.length === 0) fail(path, '空の文字列は使用できません。');
  if (result.length > max) fail(path, `${max}文字以内で指定してください。`);
  if (CONTROL.test(result)) fail(path, '制御文字は使用できません。');
  return result;
}

function identifier(value, path) {
  if (typeof value !== 'string' || !ID.test(value)) {
    fail(path, 'IDは1〜64文字の半角英数字・ハイフン・アンダースコアで指定してください。');
  }
  return value;
}

function dateValue(value, path = '日付') {
  if (typeof value !== 'string' || !DATE.test(value)) {
    fail(path, '日付を YYYY-MM-DD 形式で指定してください。');
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    fail(path, '実在する日付を指定してください。');
  }
  return value;
}

function minutes(value, path) {
  if (typeof value !== 'string' || !TIME.test(value)) {
    fail(path, '時刻を00:00〜23:59の HH:mm 形式で指定してください。');
  }
  return Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
}

function updatedAtValue(value) {
  if (typeof value !== 'string') fail('updatedAt', 'ISO形式の日付を指定してください。');
  if (DATE.test(value)) return dateValue(value, 'updatedAt');
  const match = value.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|([+-])(\d{2}):(\d{2}))$/);
  if (!match) fail('updatedAt', 'ISO形式の日付、またはタイムゾーン付き日時を指定してください。');
  dateValue(match[1], 'updatedAt');
  const offsetHours = Number(match[7] ?? 0);
  const offsetMinutes = Number(match[8] ?? 0);
  if (Number(match[2]) > 23 || Number(match[3]) > 59 || Number(match[4]) > 59 ||
      offsetHours > 14 || offsetMinutes > 59 || (offsetHours === 14 && offsetMinutes !== 0) ||
      !Number.isFinite(Date.parse(value))) {
    fail('updatedAt', '実在するISO形式の日時を指定してください。');
  }
  return value;
}

function httpsUrl(value, path) {
  const result = text(value, path, 2048, true);
  if (!result) return '';
  let parsed;
  try { parsed = new URL(result); } catch { fail(path, '有効なHTTPS URLを指定してください。'); }
  if (!/^https:\/\//i.test(result) || parsed.protocol !== 'https:' || !parsed.hostname ||
      parsed.username || parsed.password || /[\s\\]/.test(result)) {
    fail(path, '認証情報を含まない https:// のURLを指定してください。');
  }
  return parsed.href;
}

/**
 * Validate an entire document before returning any data. IDs are ASCII tokens;
 * flattened event IDs are `${lab.id}:${session.id}`, unique across the document.
 * Missing optional text becomes '', and missing reservationRequired becomes false.
 */
export function normalizeSchedule(input) {
  record(input, 'データ');
  if (input.version !== 1) fail('version', '対応するバージョンは 1 です。');
  const title = text(input.title, 'title', 120);
  const updatedAt = updatedAtValue(input.updatedAt);
  if (!Array.isArray(input.labs)) fail('labs', '研究室の配列を指定してください。');
  if (input.labs.length > SCHEDULE_LIMITS.labs) fail('labs', `研究室は${SCHEDULE_LIMITS.labs}件以内にしてください。`);
  const labIds = new Set();
  const events = [];
  let sessionCount = 0;
  const labs = input.labs.map((rawLab, labIndex) => {
    const path = `labs[${labIndex}]`;
    record(rawLab, path);
    const id = identifier(rawLab.id, `${path}.id`);
    if (labIds.has(id)) fail(`${path}.id`, `研究室ID「${id}」が重複しています。`);
    labIds.add(id);
    const name = text(rawLab.name, `${path}.name`, 120);
    const category = text(rawLab.category, `${path}.category`, 60);
    const description = text(rawLab.description, `${path}.description`, 2000, true);
    const url = httpsUrl(rawLab.url, `${path}.url`);
    if (!Array.isArray(rawLab.sessions)) fail(`${path}.sessions`, '見学日程の配列を指定してください。');
    sessionCount += rawLab.sessions.length;
    if (sessionCount > SCHEDULE_LIMITS.sessions) fail(`${path}.sessions`, `見学日程は合計${SCHEDULE_LIMITS.sessions}件以内にしてください。`);
    const sessionIds = new Set();
    const sessions = rawLab.sessions.map((rawSession, sessionIndex) => {
      const sessionPath = `${path}.sessions[${sessionIndex}]`;
      record(rawSession, sessionPath);
      const sessionId = identifier(rawSession.id, `${sessionPath}.id`);
      if (sessionIds.has(sessionId)) fail(`${sessionPath}.id`, `見学日程ID「${sessionId}」が研究室内で重複しています。`);
      sessionIds.add(sessionId);
      const date = dateValue(rawSession.date, `${sessionPath}.date`);
      if (date < '1900-01-01' || date > '2100-12-31') {
        fail(`${sessionPath}.date`, '見学日程は1900-01-01〜2100-12-31の範囲で指定してください。');
      }
      const startMinutes = minutes(rawSession.start, `${sessionPath}.start`);
      const endMinutes = minutes(rawSession.end, `${sessionPath}.end`);
      if (endMinutes <= startMinutes) fail(`${sessionPath}.end`, '終了時刻は同日の開始時刻より後にしてください。');
      const location = text(rawSession.location, `${sessionPath}.location`, 200, true);
      const note = text(rawSession.note, `${sessionPath}.note`, 2000, true);
      if (rawSession.reservationRequired !== undefined && typeof rawSession.reservationRequired !== 'boolean') {
        fail(`${sessionPath}.reservationRequired`, 'true または false を指定してください。');
      }
      const reservationRequired = rawSession.reservationRequired ?? false;
      const session = { id: sessionId, date, start: rawSession.start, end: rawSession.end, location, note, reservationRequired };
      events.push({ ...session, id: `${id}:${sessionId}`, labId: id, labName: name, category, description, url, startMinutes, endMinutes });
      return session;
    });
    return { id, name, category, description, url, sessions };
  });
  return { version: 1, title, updatedAt, labs, events };
}

export function shiftDate(dateString, days) {
  dateValue(dateString);
  if (!Number.isInteger(days) || !Number.isSafeInteger(days)) fail('日数', '整数を指定してください。');
  const value = new Date(`${dateString}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  if (!Number.isFinite(value.getTime())) fail('日数', '計算結果が有効な日付の範囲を超えています。');
  const result = value.toISOString().slice(0, 10);
  return dateValue(result);
}

/** Monday through Sunday, independent of the browser's local time zone. */
export function getWeekDays(dateString) {
  dateValue(dateString);
  const day = new Date(`${dateString}T00:00:00.000Z`).getUTCDay();
  const monday = shiftDate(dateString, -((day + 6) % 7));
  return Array.from({ length: 7 }, (_, index) => shiftDate(monday, index));
}

export function getTodayInJapan() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const part = (type) => parts.find((item) => item.type === type).value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function orderedEvents(events) {
  return [...events].sort((a, b) => a.date.localeCompare(b.date) || a.startMinutes - b.startMinutes || a.endMinutes - b.endMinutes || a.id.localeCompare(b.id));
}

/** Half-open intervals: an event ending at 11:00 does not overlap one starting then. */
export function layoutDayEvents(events) {
  const result = [];
  let group = [];
  let groupDate = '';
  let groupEnd = -1;
  const flush = () => {
    const columns = [];
    const positioned = group.map((event) => {
      let column = columns.findIndex((end) => end <= event.startMinutes);
      if (column < 0) column = columns.length;
      columns[column] = event.endMinutes;
      return { ...event, column };
    });
    result.push(...positioned.map((event) => ({ ...event, columnCount: columns.length })));
    group = [];
  };
  for (const event of orderedEvents(events)) {
    if (group.length && (event.date !== groupDate || event.startMinutes >= groupEnd)) flush();
    if (!group.length) { groupDate = event.date; groupEnd = event.endMinutes; }
    group.push(event);
    groupEnd = Math.max(groupEnd, event.endMinutes);
  }
  flush();
  return result;
}

export function findConflicts(events) {
  const sorted = orderedEvents(events);
  const pairs = [];
  for (let i = 0; i < sorted.length; i += 1) {
    for (let j = i + 1; j < sorted.length; j += 1) {
      if (sorted[j].date !== sorted[i].date || sorted[j].startMinutes >= sorted[i].endMinutes) break;
      if (sorted[i].startMinutes < sorted[j].endMinutes) pairs.push([sorted[i].id, sorted[j].id]);
    }
  }
  return pairs;
}

function icalText(value) {
  return String(value ?? '').replace(/\\/g, '\\\\').replace(/\r\n|\r|\n/g, '\\n').replace(/;/g, '\\;').replace(/,/g, '\\,');
}

/** Fold on Unicode code-point boundaries; the continuation space counts as one octet. */
function foldLine(line) {
  const encoder = new TextEncoder();
  const lines = [];
  let current = '';
  let size = 0;
  for (const character of line) {
    const width = encoder.encode(character).length;
    if (size + width > 75) { lines.push(current); current = ' '; size = 1; }
    current += character;
    size += width;
  }
  lines.push(current);
  return lines.join('\r\n');
}

/** Export selected normalized events as a downloadable RFC 5545 calendar. */
export function createCalendar(events) {
  const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Lab Visit Planner//JA', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'X-WR-CALNAME:研究室見学', 'X-WR-TIMEZONE:Asia/Tokyo',
    'BEGIN:VTIMEZONE', 'TZID:Asia/Tokyo', 'BEGIN:STANDARD',
    'DTSTART:19700101T000000', 'TZOFFSETFROM:+0900', 'TZOFFSETTO:+0900', 'TZNAME:JST',
    'END:STANDARD', 'END:VTIMEZONE',
  ];
  for (const event of orderedEvents(events)) {
    const localDate = event.date.replaceAll('-', '');
    const description = [event.description, event.note, event.reservationRequired ? '要予約' : ''].filter(Boolean).join('\n\n');
    lines.push('BEGIN:VEVENT', `UID:${icalText(event.id)}@lab-visit-planner.local`, `DTSTAMP:${timestamp}`,
      `DTSTART;TZID=Asia/Tokyo:${localDate}T${event.start.replace(':', '')}00`,
      `DTEND;TZID=Asia/Tokyo:${localDate}T${event.end.replace(':', '')}00`,
      `SUMMARY:${icalText(event.labName)}`, `DESCRIPTION:${icalText(description)}`,
      `LOCATION:${icalText(event.location)}`);
    if (event.url) lines.push(`URL:${event.url}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return `${lines.map(foldLine).join('\r\n')}\r\n`;
}
