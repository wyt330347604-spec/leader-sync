import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../../common/guards/auth.guard';
import { CurrentUser, type CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { MonthlyScoreService } from './monthly-score.service';
import { UpdateScoreDto } from './dto/update-score.dto';
import { ChallengeScoreDto } from './dto/challenge-score.dto';

@Controller('api/v1/scores')
@UseGuards(AuthGuard)
export class MonthlyScoreController {
  constructor(private readonly scoreService: MonthlyScoreService) {}

  // ── GET /scores?month=YYYY-MM ──────────────────────────────────────────────
  @Get()
  listScores(
    @CurrentUser() user: CurrentUserPayload,
    @Query('month') month?: string,
    @Query('page') page?: string,
    @Query('page_size') pageSize?: string,
  ) {
    return this.scoreService.listScores(
      user.user_id,
      user.role,
      { month },
      page ? parseInt(page, 10) : 1,
      pageSize ? parseInt(pageSize, 10) : 20,
    );
  }

  // ── GET /scores/:score_uid ─────────────────────────────────────────────────
  @Get(':score_uid')
  getScore(
    @CurrentUser() user: CurrentUserPayload,
    @Param('score_uid') scoreUid: string,
  ) {
    return this.scoreService.getScore(scoreUid, user.user_id, user.role);
  }

  // ── PATCH /scores/:score_uid/score ─────────────────────────────────────────
  @Patch(':score_uid/score')
  submitScore(
    @CurrentUser() user: CurrentUserPayload,
    @Param('score_uid') scoreUid: string,
    @Body() dto: UpdateScoreDto,
  ) {
    return this.scoreService.submitScore(scoreUid, user.user_id, dto);
  }

  // ── POST /scores/:score_uid/challenge ──────────────────────────────────────
  @Post(':score_uid/challenge')
  challengeScore(
    @CurrentUser() user: CurrentUserPayload,
    @Param('score_uid') scoreUid: string,
    @Body() dto: ChallengeScoreDto,
  ) {
    return this.scoreService.challengeScore(scoreUid, user.user_id, dto);
  }

  // ── POST /scores/:score_uid/resolve ───────────────────────────────────────
  @Post(':score_uid/resolve')
  resolveChallenge(
    @CurrentUser() user: CurrentUserPayload,
    @Param('score_uid') scoreUid: string,
    @Body() dto: UpdateScoreDto,
  ) {
    return this.scoreService.resolveChallenge(scoreUid, user.user_id, dto);
  }

  // ── POST /scores/:score_uid/lock ───────────────────────────────────────────
  @Post(':score_uid/lock')
  lockScore(
    @CurrentUser() user: CurrentUserPayload,
    @Param('score_uid') scoreUid: string,
  ) {
    return this.scoreService.lockScore(scoreUid, user.user_id, user.role);
  }

  // ── GET /scores/:score_uid/context ─────────────────────────────────────────
  @Get(':score_uid/context')
  getContext(
    @CurrentUser() user: CurrentUserPayload,
    @Param('score_uid') scoreUid: string,
  ) {
    return this.scoreService.getContext(scoreUid, user.user_id, user.role);
  }
}
