import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat.js';

dayjs.extend(customParseFormat);

const DATE_FORMAT = 'YYYY-MM-DD';
const RANGE_DELIMITER = ':';

export interface DateRange {
  start: number;
  end: number;
}

function parseDate(value: string, raw: string) {
  // Strict parsing rejects both malformed strings and impossible dates (e.g. 2026-02-30).
  const date = dayjs(value, DATE_FORMAT, true);
  if (!date.isValid()) {
    throw new Error(`Invalid date "${value}" in date range "${raw}" - expected ${DATE_FORMAT}.`);
  }
  return date;
}

// Parses "YYYY-MM-DD:YYYY-MM-DD" into an inclusive range spanning the start
// day's first millisecond through the end day's last, in local time.
export function parseDateRange(raw: string): DateRange {
  const parts = raw.split(RANGE_DELIMITER);
  if (parts.length !== 2) {
    throw new Error(`Invalid date range "${raw}" - expected ${DATE_FORMAT}${RANGE_DELIMITER}${DATE_FORMAT}.`);
  }

  const start = parseDate(parts[0], raw);
  const end = parseDate(parts[1], raw);
  if (start.isAfter(end)) {
    throw new Error(`Invalid date range "${raw}" - start is after end.`);
  }

  return {
    start: start.startOf('day').valueOf(),
    end: end.endOf('day').valueOf(),
  };
}

// An unknown date (missing or 0) never falls in a range.
export function isInDateRanges(date: number | null, ranges: DateRange[]): boolean {
  if (!date) {
    return false;
  }
  return ranges.some(range => date >= range.start && date <= range.end);
}
