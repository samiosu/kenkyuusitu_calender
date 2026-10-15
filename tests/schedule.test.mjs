import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  normalizeSchedule, getWeekDays, shiftDate, getTodayInJapan,
  layoutDayEvents, findConflicts, createCalendar, SCHEDULE_LIMITS, filterScheduleEvents,
} from '../src/schedule.mjs';

const session = (changes = {}) => ({ id: 'visit-1', date: '2026-10-15', start: '10:00', end: '11:00', ...changes });
const document = () => ({
  version: 1, title: '見学カレンダー', updatedAt: '2026-10-15',
  labs: [{ id: 'sample-a', name: 'サンプルA研究室', category: '情報', sessions: [session()] }],
});
const eventsFrom = (sessions) => {
  const input = document();
  input.labs[0].sessions = sessions;
  return normalizeSchedule(input).events;
};

test('normalization is deterministic, nonmutating, and globally identifies sessions', () => {
  const input = document();
  input.labs.push({ id: 'sample-b', name: 'サンプルB研究室', category: '数理', sessions: [session()] });
  const before = structuredClone(input);
  const result = normalizeSchedule(input);
  assert.deepEqual(input, before);
  assert.deepEqual(result.events.map(({ id }) => id), ['sample-a:visit-1', 'sample-b:visit-1']);
  assert.equal(result.events[0].startMinutes, 600);
  assert.equal(result.events[0].endMinutes, 660);
  assert.equal(result.events[0].description, '');
  assert.equal(result.events[0].url, '');
  assert.equal(result.events[0].reservationRequired, false);
  assert.equal(result.labs[0].sessions[0].id, 'visit-1');
  assert.equal(normalizeSchedule({ ...input, labs: [] }).events.length, 0);
});

test('normalization rejects the whole import when a later session is invalid', () => {
  const input = document();
  input.labs[0].sessions.push(session({ id: 'bad', end: '09:00' }));
  assert.throws(() => normalizeSchedule(input), /labs\[0\]\.sessions\[1\]\.end.*終了時刻/);
  assert.equal(input.labs[0].sessions.length, 2);
});

test('invalid document shapes and unsupported versions produce useful errors', () => {
  for (const input of [null, [], '', 1]) assert.throws(() => normalizeSchedule(input), /オブジェクト/);
  assert.throws(() => normalizeSchedule({ ...document(), version: 2 }), /version.*1/);
  assert.throws(() => normalizeSchedule({ ...document(), labs: {} }), /labs.*配列/);
  assert.throws(() => normalizeSchedule({ ...document(), title: '' }), /title.*空/);
  assert.throws(() => normalizeSchedule({ ...document(), title: 'a'.repeat(121) }), /title.*120/);
  assert.throws(() => normalizeSchedule({ ...document(), title: 'x\u0000' }), /制御文字/);
  const input = document();
  input.labs[0].sessions = null;
  assert.throws(() => normalizeSchedule(input), /sessions.*配列/);
});

test('IDs cannot collide or carry markup and unsafe prototype keys', () => {
  for (const id of ['', 'bad:id', 'bad id', '<script>', 'a'.repeat(65), 1]) {
    const input = document();
    input.labs[0].id = id;
    assert.throws(() => normalizeSchedule(input), /ID/);
  }
  const duplicateLab = document();
  duplicateLab.labs.push(structuredClone(duplicateLab.labs[0]));
  assert.throws(() => normalizeSchedule(duplicateLab), /研究室ID.*重複/);
  const duplicateSession = document();
  duplicateSession.labs[0].sessions.push(session());
  assert.throws(() => normalizeSchedule(duplicateSession), /見学日程ID.*重複/);
  const prototypeData = JSON.parse(JSON.stringify(document()).replace('"id":"sample-a"', '"__proto__":{"polluted":true},"id":"sample-a"'));
  assert.equal(normalizeSchedule(prototypeData).labs[0].polluted, undefined);
  assert.equal({}.polluted, undefined);
});

test('dates are actual calendar dates and times use a strict same-day 24-hour range', () => {
  for (const date of ['2026-02-29', '2026-04-31', '2026-13-01', '2026-00-01', '2026-10-00', '2026-1-01', '0000-01-01', 'tomorrow']) {
    assert.throws(() => eventsFrom([session({ date })]), /date.*日付/);
  }
  assert.equal(eventsFrom([session({ date: '2024-02-29' })])[0].date, '2024-02-29');
  for (const start of ['9:00', '24:00', '12:60', '-1:00', '12:00:00', 1200]) {
    assert.throws(() => eventsFrom([session({ start })]), /start.*時刻/);
  }
  for (const end of ['10:00', '09:59']) assert.throws(() => eventsFrom([session({ end })]), /終了時刻/);
  assert.equal(eventsFrom([session({ start: '00:00', end: '23:59' })])[0].endMinutes, 1439);
});

test('updatedAt accepts ISO dates and timestamps, rejecting rollovers and invalid offsets', () => {
  for (const updatedAt of ['2026-10-15', '2026-10-15T12:30:00Z', '2026-10-15T12:30:00.123+09:00', '2026-10-15T12:30:00-14:00']) {
    assert.equal(normalizeSchedule({ ...document(), updatedAt }).updatedAt, updatedAt);
  }
  for (const updatedAt of ['2026-02-30', '2026-02-30T00:00:00Z', '2026-10-15T24:00:00Z', '2026-10-15T12:00:00', '2026-10-15T12:00:00+15:00', '2026-10-15T12:00:00+14:01', '2026-10-15T12:00:00+09:60', null]) {
    assert.throws(() => normalizeSchedule({ ...document(), updatedAt }), /updatedAt/);
  }
});

test('an empty end preserves uncertainty and reserves exactly one hour for layout', () => {
  const input = document();
  input.labs[0].sessions[0].end = '';
  const before = structuredClone(input);
  const normalized = normalizeSchedule(input);
  const event = normalized.events[0];
  assert.equal(event.end, '');
  assert.equal(event.endUnknown, true);
  assert.equal(event.endMinutes - event.startMinutes, 60);
  assert.equal(normalized.labs[0].sessions[0].end, '');
  assert.deepEqual(input, before);
  assert.equal(eventsFrom([session()])[0].endUnknown, false);
  for (const end of [undefined, null, ' ', 'unknown', '24:00']) {
    assert.throws(() => eventsFrom([session({ end })]), /end.*時刻/);
  }
  const events = eventsFrom([
    session({ id: 'unknown', end: '' }),
    session({ id: 'during', start: '10:30', end: '10:45' }),
    session({ id: 'after', start: '11:00', end: '12:00' }),
  ]);
  assert.deepEqual(findConflicts(events), [['sample-a:unknown', 'sample-a:during']]);
  assert.deepEqual(layoutDayEvents(events).map(({ columnCount }) => columnCount), [2, 2, 1]);
});

test('an unknown end keeps its full one-hour slot and detects overlap across midnight', () => {
  const events = eventsFrom([
    session({ id: 'late', date: '2026-12-31', start: '23:30', end: '' }),
    session({ id: 'early', date: '2027-01-01', start: '00:15', end: '00:30' }),
    session({ id: 'after', date: '2027-01-01', start: '00:30', end: '01:00' }),
  ]);
  assert.equal(events[0].endMinutes, 1470);
  assert.deepEqual(findConflicts(events), [['sample-a:late', 'sample-a:early']]);
  const latest = eventsFrom([session({ start: '23:59', end: '' })])[0];
  assert.equal(latest.endMinutes - latest.startMinutes, 60);
});

test('ICS exports an unknown end as an explicitly labelled one-hour placeholder', () => {
  const calendar = createCalendar(eventsFrom([session({ start: '23:30', end: '' })]));
  const unfolded = calendar.replaceAll('\r\n ', '');
  assert.match(unfolded, /DTSTART;TZID=Asia\/Tokyo:20261015T233000\r\nDURATION:PT1H/);
  assert.doesNotMatch(unfolded, /DTEND/);
  assert.match(unfolded, /SUMMARY:サンプルA研究室（終了未定）/);
  assert.match(unfolded, /終了時刻は未定です。.*1時間の仮枠/);
  for (const line of calendar.split('\r\n')) assert.ok(Buffer.byteLength(line, 'utf8') <= 75);
});

test('imported sessions stay inside the supported calendar range while date helpers remain generic', () => {
  for (const date of ['0001-01-01', '0099-12-31', '1899-12-31', '2101-01-01', '9999-12-31']) {
    assert.throws(() => eventsFrom([session({ date })]), /date.*1900-01-01〜2100-12-31/);
  }
  for (const date of ['1900-01-01', '2100-12-31']) {
    assert.equal(eventsFrom([session({ date })])[0].date, date);
  }
  assert.equal(shiftDate('0099-12-31', 1), '0100-01-01');
  assert.equal(getWeekDays('0001-01-01')[0], '0001-01-01');
});

test('optional fields are typed and HTTPS links cannot introduce executable schemes or credentials', () => {
  for (const url of ['javascript:alert(1)', 'data:text/html,hello', 'http://example.com', '//example.com', 'https://user:pass@example.com', 'https://example.com\nattack', 'https:\\example.com', 'https://example.com\\path']) {
    const input = document();
    input.labs[0].url = url;
    assert.throws(() => normalizeSchedule(input), /url.*URL/);
  }
  const input = document();
  input.labs[0].url = 'https://example.com/visits?q=a%20b';
  assert.equal(normalizeSchedule(input).events[0].url, input.labs[0].url);
  for (const reservationRequired of [null, 'false', 0, {}]) {
    assert.throws(() => eventsFrom([session({ reservationRequired })]), /reservationRequired/);
  }
  assert.throws(() => eventsFrom([session({ note: 'a'.repeat(2001) })]), /note.*2000/);
  assert.throws(() => eventsFrom([session({ location: 'a'.repeat(201) })]), /location.*200/);
});

test('array size caps bound work for imported documents', () => {
  const input = document();
  input.labs = Array.from({ length: SCHEDULE_LIMITS.labs + 1 }, (_, i) => ({ ...input.labs[0], id: `lab-${i}` }));
  assert.throws(() => normalizeSchedule(input), /研究室は100件/);
  const tooMany = document();
  tooMany.labs[0].sessions = Array.from({ length: SCHEDULE_LIMITS.sessions + 1 }, (_, i) => session({ id: `visit-${i}` }));
  assert.throws(() => normalizeSchedule(tooMany), /合計2000件/);
});

test('week and date arithmetic are Monday-first and stable over month/year/leap boundaries', () => {
  assert.deepEqual(getWeekDays('2026-10-18'), ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18']);
  assert.equal(getWeekDays('2026-10-12')[0], '2026-10-12');
  assert.equal(shiftDate('2026-12-31', 1), '2027-01-01');
  assert.equal(shiftDate('2024-03-01', -1), '2024-02-29');
  assert.throws(() => shiftDate('2026-02-30', 1), /日付/);
  assert.throws(() => shiftDate('2026-10-15', 1.2), /整数/);
  assert.throws(() => shiftDate('2026-10-15', Number.MAX_SAFE_INTEGER), /範囲/);
  assert.match(getTodayInJapan(), /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(getTodayInJapan(), new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date()));
});

test('overlap columns handle chained and nested intervals, reuse free columns, and separate dates', () => {
  const events = eventsFrom([
    session({ id: 'a', start: '09:00', end: '10:00' }),
    session({ id: 'b', start: '09:30', end: '11:00' }),
    session({ id: 'c', start: '10:00', end: '10:30' }),
    session({ id: 'd', start: '10:15', end: '10:45' }),
    session({ id: 'e', start: '11:00', end: '12:00' }),
    session({ id: 'f', date: '2026-10-16', start: '09:00', end: '10:00' }),
  ]);
  const original = structuredClone(events);
  const positioned = layoutDayEvents(events.toReversed());
  assert.deepEqual(positioned.map(({ column, columnCount }) => [column, columnCount]), [[0, 3], [1, 3], [0, 3], [2, 3], [0, 1], [0, 1]]);
  for (const [idA, idB] of findConflicts(events)) {
    assert.notEqual(positioned.find(({ id }) => id === idA).column, positioned.find(({ id }) => id === idB).column);
  }
  assert.deepEqual(events, original);
  assert.deepEqual(layoutDayEvents([]), []);
});

test('conflicts use half-open intervals and catch separate sessions of the same lab', () => {
  const events = eventsFrom([
    session({ id: 'a' }), session({ id: 'b', start: '10:30', end: '11:30' }),
    session({ id: 'c', start: '11:00', end: '12:00' }),
    session({ id: 'd', date: '2026-10-16' }),
  ]);
  assert.deepEqual(findConflicts(events), [['sample-a:a', 'sample-a:b'], ['sample-a:b', 'sample-a:c']]);
  assert.deepEqual(findConflicts([]), []);
});

test('ICS includes timezone and correct local times, escaping and UTF-8 line folding', () => {
  const input = document();
  input.labs[0].name = 'サンプルA研究室'.repeat(10);
  input.labs[0].description = '説明,カンマ;区切り\\文字\r\n改行\n絵文字🧪'.repeat(5);
  input.labs[0].url = 'https://example.com/visits';
  input.labs[0].sessions[0].location = '架空棟;1,2';
  input.labs[0].sessions[0].note = '持ち物\n筆記用具';
  input.labs[0].sessions[0].reservationRequired = true;
  const ics = createCalendar(normalizeSchedule(input).events);
  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\n'));
  assert.ok(ics.endsWith('END:VCALENDAR\r\n'));
  assert.equal(ics.replaceAll('\r\n', '').includes('\n'), false);
  for (const line of ics.split('\r\n')) assert.ok(Buffer.byteLength(line, 'utf8') <= 75, `oversized ICS line: ${line}`);
  const unfolded = ics.replaceAll('\r\n ', '');
  assert.match(unfolded, /BEGIN:VTIMEZONE\r\nTZID:Asia\/Tokyo/);
  assert.match(unfolded, /DTSTART;TZID=Asia\/Tokyo:20261015T100000/);
  assert.match(unfolded, /DTEND;TZID=Asia\/Tokyo:20261015T110000/);
  assert.match(unfolded, /UID:sample-a:visit-1@lab-visit-planner.local/);
  assert.match(unfolded, /DTSTAMP:\d{8}T\d{6}Z/);
  assert.ok(unfolded.includes('説明\\,カンマ\\;区切り\\\\文字\\n改行\\n絵文字🧪'));
  assert.ok(unfolded.includes('LOCATION:架空棟\\;1\\,2'));
  assert.ok(unfolded.includes('URL:https://example.com/visits'));
  assert.ok(unfolded.includes('\\n\\n要予約'));
  assert.equal((createCalendar([]).match(/BEGIN:VEVENT/g) ?? []).length, 0);
});

test('hiding a lab removes all its visits by ID and preserves another lab with the same name', () => {
  const input = document();
  input.labs[0].sessions.push(session({ id: 'visit-2', date: '2026-10-16', end: '' }));
  input.labs.push({ ...structuredClone(input.labs[0]), id: 'sample-b' });
  const events = normalizeSchedule(input).events;
  const hiddenLabs = new Set(['sample-a']);
  const visible = filterScheduleEvents(events, { hiddenLabs });
  assert.deepEqual(visible.map(({ id }) => id), ['sample-b:visit-1', 'sample-b:visit-2']);
  assert.equal(events.length, 4);
  assert.deepEqual([...hiddenLabs], ['sample-a']);
});

test('lab visibility combines with category, search and saved-plan filters', () => {
  const input = document();
  input.labs[0].sessions[0].location = '北棟';
  input.labs.push({ id: 'sample-b', name: 'サンプルB研究室', category: '情報', sessions: [session({ location: '北棟' })] });
  input.labs.push({ id: 'sample-c', name: 'サンプルC研究室', category: '数理', sessions: [session({ location: '北棟' })] });
  const events = normalizeSchedule(input).events;
  const planned = new Set(events.map(({ id }) => id));
  const options = { categories: new Set(['情報']), hiddenLabs: new Set(['sample-a']), query: ' 北棟 ', planned, planOnly: true };
  assert.deepEqual(filterScheduleEvents(events, options).map(({ id }) => id), ['sample-b:visit-1']);
  assert.deepEqual(filterScheduleEvents(events, { ...options, query: '別の棟' }), []);
  assert.deepEqual(filterScheduleEvents(events, { ...options, planned: new Set(['sample-a:visit-1']) }), []);
  assert.equal(planned.size, 3);
});

test('all labs can be hidden and restored without changing the source or saved candidates', () => {
  const events = eventsFrom([session(), session({ id: 'visit-2', date: '2026-10-16' })]);
  const before = structuredClone(events);
  const planned = new Set(['sample-a:visit-1']);
  assert.deepEqual(filterScheduleEvents(events, { hiddenLabs: new Set(['sample-a']), planned }), []);
  assert.deepEqual(filterScheduleEvents(events, { hiddenLabs: new Set(), planned }), events);
  assert.deepEqual(filterScheduleEvents(events, { categories: new Set() }), []);
  assert.deepEqual(events, before);
  assert.deepEqual([...planned], ['sample-a:visit-1']);
});

test('sample data is valid, fictional and contains two weeks of sessions', async () => {
  const sample = JSON.parse(await readFile(new URL('../examples/schedule.sample.json', import.meta.url), 'utf8'));
  const normalized = normalizeSchedule(sample);
  assert.ok(normalized.events.length >= 20);
  assert.ok(normalized.labs.every(({ name }) => name.startsWith('サンプル')));
  assert.ok(normalized.events.every(({ date }) => date >= '2026-10-12' && date <= '2026-10-23'));
  assert.ok(findConflicts(normalized.events).length > 0);
});
