import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable, map } from 'rxjs';

@Injectable()
export class ResponseInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const req = context.switchToHttp().getRequest();
    return next.handle().pipe(
      map((data) => ({
        code: 0,
        message: 'ok',
        trace_id: req.traceId || '',
        data: data ?? null,
      })),
    );
  }
}
