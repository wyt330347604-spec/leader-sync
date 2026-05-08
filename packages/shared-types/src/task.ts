import type { TaskType, Priority, AssignmentType, TaskStatus } from './enums';

export interface CreateTaskDto {
  title: string;
  detail?: string;
  task_type?: TaskType;
  priority: Priority;
  assignee_user_id: string;
  due_at: string;
  start_at?: string;
  assignment_type?: AssignmentType;
  boss_attention_flag?: boolean;
  project_uid?: string;
  collaborators?: { user_id: string; user_name: string }[];
}

export interface UpdateTaskDto {
  version: number;
  title?: string;
  detail?: string;
  status?: TaskStatus;
  priority?: Priority;
  progress_percent?: number;
  latest_progress?: string;
  due_at?: string;
  completed_at?: string;
  stall_reason?: string;
  delay_reason?: string;
  project_uid?: string;
}

export interface AssignTaskDto {
  assignee_user_id: string;
  assignment_type: AssignmentType;
  reason?: string;
}

export interface CompleteTaskDto {
  latest_progress?: string;
  completed_at?: string;
}

export interface DelayTaskDto {
  new_due_at: string;
  delay_reason?: string;
}

export interface TaskListQuery {
  status?: TaskStatus;
  bucket?: string;
  priority?: Priority;
  role?: 'all' | 'assignee' | 'collaborator';
  page?: number;
  page_size?: number;
}
