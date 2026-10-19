import { http } from './http';

export const exchangeApi = {
  exportExcel: (input: Record<string, unknown>) => http.download('/export', input),
  printTimetable: (input: Record<string, unknown>) => http.download('/print', input),
};
