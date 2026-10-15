export const SMALL_KEY = 'slowbuy.small.v1';
export const MAX_SMALL = 300;

const MAX_TIME = 8.64e15;
const statuses = new Set(['planned', 'bought', 'released']);
const isTimestamp = value => Number.isFinite(value) && value > 0 && value <= MAX_TIME;

// Stored amounts must already have cent precision; allow only floating-point noise.
function priceCents(value) {
  if (!Number.isFinite(value) || value < 0.01 || value > 1e8) return null;
  const scaled = value * 100;
  const cents = Math.round(scaled);
  const tolerance = Number.EPSILON * Math.max(1, Math.abs(scaled)) * 4;
  return Math.abs(scaled - cents) <= tolerance ? cents : null;
}

export function readSmall(raw) {
  if (raw === null) return {items: [], malformed: false};
  try {
    const data = JSON.parse(raw);
    if (!data || data.version !== 1 || !Array.isArray(data.items)) {
      return {items: [], malformed: true};
    }
    const items = [];
    const ids = new Set();
    let malformed = false;
    for (const entry of data.items) {
      const id = typeof entry?.id === 'string' ? entry.id.trim() : '';
      const name = typeof entry?.name === 'string' ? entry.name.trim().slice(0, 60) : '';
      const cents = priceCents(entry?.price);
      if (!entry || !id || id.length > 100 || !name || cents === null ||
          !statuses.has(entry.status) || !isTimestamp(entry.createdAt) || ids.has(id)) {
        malformed = true;
        continue;
      }
      if (items.length === MAX_SMALL) {
        malformed = true;
        continue;
      }
      const item = {id, name, price: cents / 100, status: entry.status, createdAt: entry.createdAt};
      for (const field of ['decidedAt', 'reviewAt']) {
        if (Object.prototype.hasOwnProperty.call(entry, field)) {
          if (isTimestamp(entry[field])) item[field] = entry[field];
          else malformed = true;
        }
      }
      ids.add(id);
      items.push(item);
    }
    return {items, malformed};
  } catch {
    return {items: [], malformed: true};
  }
}

export function dailyKey(timestamp) {
  if (!Number.isFinite(timestamp) || Math.abs(timestamp) > MAX_TIME) return '';
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function nextMorning(now = Date.now()) {
  if (!Number.isFinite(now) || Math.abs(now) > MAX_TIME) throw new RangeError('Invalid timestamp');
  const morning = new Date(now);
  morning.setHours(9, 0, 0, 0);
  if (morning.getTime() <= now) morning.setDate(morning.getDate() + 1);
  const result = morning.getTime();
  if (!Number.isFinite(result)) throw new RangeError('Next morning is outside the supported date range');
  return result;
}

export function summarizeSmall(items, now = Date.now()) {
  const today = dailyKey(now);
  const result = {todayPlanned: 0, todayBought: 0, monthBought: 0, todayCount: 0};
  if (!today || !Array.isArray(items)) return result;
  const month = today.slice(0, 7);
  let plannedCents = 0, boughtCents = 0, monthCents = 0;
  for (const item of items) {
    const cents = priceCents(item?.price);
    if (cents === null || !isTimestamp(item?.createdAt)) continue;
    if (item.status === 'planned' && dailyKey(item.createdAt) === today) {
      plannedCents += cents;
      result.todayCount += 1;
    } else if (item.status === 'bought') {
      const purchaseTime = isTimestamp(item.decidedAt) ? item.decidedAt : item.createdAt;
      const purchaseDay = dailyKey(purchaseTime);
      if (purchaseDay === today) {
        boughtCents += cents;
        result.todayCount += 1;
      }
      if (purchaseDay.slice(0, 7) === month) monthCents += cents;
    }
  }
  result.todayPlanned = plannedCents / 100;
  result.todayBought = boughtCents / 100;
  result.monthBought = monthCents / 100;
  return result;
}
