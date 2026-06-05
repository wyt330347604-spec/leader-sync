import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { ErrorCode } from '@leader-sync/shared-types';
import { BusinessException } from '../../common/exceptions/business.exception';
import type { CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { TaskRepository } from './task.repository';
import { canMutateTask, requesterFrom } from './task-permissions';

/**
 * 任务写操作归属守卫：对带 :task_uid 的写端点（更新/状态/进度/完成/延期/指派/重点/
 * 通知/协作人/Leader 管理）统一校验请求者是否有权改该任务。
 *
 * - 任务不存在 → 放行，交由 handler 返回 TASK_NOT_FOUND（不在守卫层泄漏存在性）。
 * - 无权 → 抛 1002 NO_PERMISSION (403)。
 * - 删除/恢复在 service 内自校验（含状态校验），不重复挂此守卫。
 */
@Injectable()
export class TaskWriteGuard implements CanActivate {
  constructor(private readonly taskRepository: TaskRepository) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const request = ctx.switchToHttp().getRequest();
    const taskUid: string | undefined = request.params?.task_uid;
    if (!taskUid) return true; // 非任务作用域路由

    const user = request.user as CurrentUserPayload | undefined;
    if (!user) {
      throw new BusinessException(ErrorCode.UNAUTHORIZED, 'Missing authentication', HttpStatus.UNAUTHORIZED);
    }

    const task = await this.taskRepository.findByUid(taskUid, { includeDeleted: true });
    if (!task) return true; // 让 handler 返回 404，不在守卫层判定存在性

    if (!canMutateTask(task, requesterFrom(user))) {
      throw new BusinessException(ErrorCode.UNAUTHORIZED, 'NO_PERMISSION: cannot modify this task', HttpStatus.FORBIDDEN);
    }
    return true;
  }
}
