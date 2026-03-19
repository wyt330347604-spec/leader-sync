import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';
import { BusinessException } from '../exceptions/business.exception';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const request = ctx.getRequest();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 5000;
    let message = 'Internal server error';

    if (exception instanceof BusinessException) {
      status = exception.getStatus();
      code = exception.businessCode;
      message = exception.message;
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();
      code = status;
      message = typeof res === 'string' ? res : (res as any).message || exception.message;
      if (Array.isArray(message)) message = message.join('; ');
    }

    response.status(status).json({
      code,
      message,
      trace_id: request.traceId || '',
      data: null,
    });
  }
}
