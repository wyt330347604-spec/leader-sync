export interface ApiResponse<T = unknown> {
  code: number;
  message: string;
  trace_id: string;
  data: T;
}

export interface PaginatedData<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
}

export const ErrorCode = {
  INVALID_PARAMS: 1001,
  UNAUTHORIZED: 1002,
  TASK_NOT_FOUND: 1003,
  INVALID_STATUS_TRANSITION: 1004,
  SYNC_CONFLICT: 1005,
  EXTERNAL_SYSTEM_ERROR: 1006,
  MONTHLY_CLOSE_LOCKED: 1007,
  VERSION_CONFLICT: 1009,
  INCIDENT_NOT_FOUND: 1010,
  INCIDENT_ALREADY_CONFIRMED: 1011,
  INCIDENT_PERMISSION_DENIED: 1012,
  GRADE_NOT_FOUND: 1013,
  GRADE_PERMISSION_DENIED: 1014,
  GRADE_INVALID_FORMAT: 1015,
} as const;
