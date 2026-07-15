import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { AuthGuard } from '../../common/guards/auth.guard';
import { CurrentUser, type CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { QuarterService, type Requestor } from './quarter.service';
import { QuarterResultService } from './quarter-result.service';
import { OpenCycleDto } from './dto/open-cycle.dto';
import { SubmitSheetDto } from './dto/submit-sheet.dto';
import { AssignPeerDto } from './dto/assign-peer.dto';
import { MgmtRequiredDto } from './dto/mgmt-required.dto';
import { SetGoalDto, UpdateGoalDto, ProposeGoalDto, ConfirmGoalDto } from './dto/goal.dto';
import { ComputeResultDto, ReviseResultDto } from './dto/result.dto';
import { CreateAppealDto, HandleAppealDto } from './dto/appeal.dto';
import { HalfYearComputeDto } from './dto/half-year.dto';

function requestor(user: CurrentUserPayload): Requestor {
  return { userId: user.user_id, role: user.role, openId: user.open_id };
}

@Controller('api/v1/quarter')
@UseGuards(AuthGuard)
export class QuarterController {
  constructor(
    private readonly service: QuarterService,
    private readonly resultService: QuarterResultService,
  ) {}

  // ── 周期 ────────────────────────────────────────────────────────────────
  @Post('cycles')
  openCycle(@CurrentUser() user: CurrentUserPayload, @Body() dto: OpenCycleDto) {
    return this.service.openCycle(dto.quarter, requestor(user));
  }

  @Get('cycles')
  listCycles(@CurrentUser() user: CurrentUserPayload) {
    return this.service.listCycles(requestor(user));
  }

  @Get('cycles/:cycle_uid')
  getCycle(@CurrentUser() user: CurrentUserPayload, @Param('cycle_uid') cycleUid: string) {
    return this.service.getCycle(cycleUid, requestor(user));
  }

  // 召集评分会：scoring → panel + panel_at，给管理层发召集卡（admin/boss/hr）。
  @Post('cycles/:cycle_uid/convene-panel')
  convenePanel(@CurrentUser() user: CurrentUserPayload, @Param('cycle_uid') cycleUid: string) {
    return this.service.convenePanel(cycleUid, requestor(user));
  }

  // ── 我的待办 ─────────────────────────────────────────────────────────────
  @Get('my-tasks')
  myTasks(@CurrentUser() user: CurrentUserPayload) {
    return this.service.myTasks(requestor(user));
  }

  // ── 打分表 ───────────────────────────────────────────────────────────────
  @Get('sheets/:sheet_uid')
  getSheet(@CurrentUser() user: CurrentUserPayload, @Param('sheet_uid') sheetUid: string) {
    return this.service.getSheet(sheetUid, requestor(user));
  }

  @Patch('sheets/:sheet_uid')
  submitSheet(
    @CurrentUser() user: CurrentUserPayload,
    @Param('sheet_uid') sheetUid: string,
    @Body() dto: SubmitSheetDto,
  ) {
    return this.service.submitSheet(sheetUid, requestor(user), dto);
  }

  // ── 任务动作 ─────────────────────────────────────────────────────────────
  @Put('tasks/:task_uid/peer')
  assignPeer(
    @CurrentUser() user: CurrentUserPayload,
    @Param('task_uid') taskUid: string,
    @Body() dto: AssignPeerDto,
  ) {
    return this.service.assignPeer(taskUid, requestor(user), dto);
  }

  @Patch('tasks/:task_uid/mgmt-required')
  setMgmtRequired(
    @CurrentUser() user: CurrentUserPayload,
    @Param('task_uid') taskUid: string,
    @Body() dto: MgmtRequiredDto,
  ) {
    return this.service.setMgmtRequired(taskUid, requestor(user), dto);
  }

  // ── 半年目标 ─────────────────────────────────────────────────────────────
  @Post('goals')
  setGoal(@CurrentUser() user: CurrentUserPayload, @Body() dto: SetGoalDto) {
    return this.service.setGoal(requestor(user), dto);
  }

  @Put('goals/:goal_uid')
  updateGoal(
    @CurrentUser() user: CurrentUserPayload,
    @Param('goal_uid') goalUid: string,
    @Body() dto: UpdateGoalDto,
  ) {
    return this.service.updateGoal(goalUid, requestor(user), dto);
  }

  @Get('goals')
  getGoals(
    @CurrentUser() user: CurrentUserPayload,
    @Query('ratee_user_id') rateeUserId: string,
    @Query('half') half?: string,
  ) {
    return this.service.getGoals(rateeUserId, half, requestor(user));
  }

  // 员工发起调整建议（写 pending 提案，不直接改正式内容）
  @Post('goals/:goal_uid/propose')
  proposeGoal(
    @CurrentUser() user: CurrentUserPayload,
    @Param('goal_uid') goalUid: string,
    @Body() dto: ProposeGoalDto,
  ) {
    return this.service.proposeGoalChange(goalUid, requestor(user), dto);
  }

  // 直属确认提案：accept 应用为正式内容并写 revision；否则关提案并留痕
  @Patch('goals/:goal_uid/confirm')
  confirmGoal(
    @CurrentUser() user: CurrentUserPayload,
    @Param('goal_uid') goalUid: string,
    @Body() dto: ConfirmGoalDto,
  ) {
    return this.service.confirmGoalProposal(goalUid, requestor(user), dto);
  }

  @Get('goals/:goal_uid/revisions')
  getGoalRevisions(@CurrentUser() user: CurrentUserPayload, @Param('goal_uid') goalUid: string) {
    return this.service.getGoalRevisions(goalUid, requestor(user));
  }

  // ── 合成结果 ─────────────────────────────────────────────────────────────
  @Post('tasks/:task_uid/result/compute')
  computeResult(
    @CurrentUser() user: CurrentUserPayload,
    @Param('task_uid') taskUid: string,
    @Body() dto: ComputeResultDto,
  ) {
    return this.resultService.computeResult(taskUid, requestor(user), dto);
  }

  @Post('cycles/:cycle_uid/results/compute')
  batchCompute(@CurrentUser() user: CurrentUserPayload, @Param('cycle_uid') cycleUid: string) {
    return this.resultService.batchCompute(cycleUid, requestor(user));
  }

  // ── 评分会看板 ────────────────────────────────────────────────────────────
  @Get('cycles/:cycle_uid/panel')
  getPanel(@CurrentUser() user: CurrentUserPayload, @Param('cycle_uid') cycleUid: string) {
    return this.resultService.getPanel(cycleUid, requestor(user));
  }

  // ── 半年合成（A）─────────────────────────────────────────────────────────
  @Post('half-year/compute')
  computeHalfYear(@CurrentUser() user: CurrentUserPayload, @Body() dto: HalfYearComputeDto) {
    return this.resultService.computeHalfYear(dto.half, requestor(user));
  }

  @Get('half-year')
  getHalfYear(
    @CurrentUser() user: CurrentUserPayload,
    @Query('half') half: string,
    @Query('ratee_user_id') rateeUserId?: string,
  ) {
    return this.resultService.getHalfYear(half, rateeUserId, requestor(user));
  }

  // ── 定级定岗联动（B）─────────────────────────────────────────────────────
  @Get('promotion-eligibility')
  getPromotionEligibility(
    @CurrentUser() user: CurrentUserPayload,
    @Query('ratee_user_id') rateeUserId: string,
  ) {
    return this.resultService.getPromotionEligibility(rateeUserId, requestor(user));
  }

  @Post('cycles/:cycle_uid/backfill-grade-snapshot')
  backfillGradeSnapshot(@CurrentUser() user: CurrentUserPayload, @Param('cycle_uid') cycleUid: string) {
    return this.resultService.backfillGradeSnapshot(cycleUid, requestor(user));
  }

  // ── CSV 导出（C）─────────────────────────────────────────────────────────
  // 用 @Res() 直写响应，绕过 ResponseInterceptor 的 JSON 信封。
  @Get('cycles/:cycle_uid/export.csv')
  async exportCsv(
    @CurrentUser() user: CurrentUserPayload,
    @Param('cycle_uid') cycleUid: string,
    @Res() res: Response,
  ) {
    const { filename, csv } = await this.resultService.exportCycleCsv(cycleUid, requestor(user));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  }

  // 月度综合系数 CSV（给薪酬）：admin/hr/pmo/boss。@Res 直写绕信封。
  @Get('monthly/export.csv')
  async exportMonthlyCsv(
    @CurrentUser() user: CurrentUserPayload,
    @Query('month') month: string,
    @Res() res: Response,
  ) {
    const { filename, csv } = await this.resultService.exportMonthlyCsv(month, requestor(user));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  }

  // ── 改分 / 公示 ───────────────────────────────────────────────────────────
  @Patch('results/:result_uid')
  reviseResult(
    @CurrentUser() user: CurrentUserPayload,
    @Param('result_uid') resultUid: string,
    @Body() dto: ReviseResultDto,
  ) {
    return this.resultService.reviseResult(resultUid, requestor(user), dto);
  }

  @Post('cycles/:cycle_uid/publish')
  publishCycle(@CurrentUser() user: CurrentUserPayload, @Param('cycle_uid') cycleUid: string) {
    return this.resultService.publishCycle(cycleUid, requestor(user));
  }

  // ── 被评人视角 ────────────────────────────────────────────────────────────
  @Get('my-result')
  myResult(@CurrentUser() user: CurrentUserPayload, @Query('cycle') cycleUid: string) {
    return this.resultService.myResult(cycleUid, requestor(user));
  }

  @Get('results/:result_uid')
  getResult(@CurrentUser() user: CurrentUserPayload, @Param('result_uid') resultUid: string) {
    return this.resultService.getResult(resultUid, requestor(user));
  }

  // ── 申诉 ─────────────────────────────────────────────────────────────────
  @Post('results/:result_uid/appeal')
  createAppeal(
    @CurrentUser() user: CurrentUserPayload,
    @Param('result_uid') resultUid: string,
    @Body() dto: CreateAppealDto,
  ) {
    return this.resultService.createAppeal(resultUid, requestor(user), dto);
  }

  @Patch('appeals/:appeal_uid')
  handleAppeal(
    @CurrentUser() user: CurrentUserPayload,
    @Param('appeal_uid') appealUid: string,
    @Body() dto: HandleAppealDto,
  ) {
    return this.resultService.handleAppeal(appealUid, requestor(user), dto);
  }

  @Get('appeals')
  listAppeals(@CurrentUser() user: CurrentUserPayload, @Query('cycle') cycleUid: string) {
    return this.resultService.listAppeals(cycleUid, requestor(user));
  }
}
