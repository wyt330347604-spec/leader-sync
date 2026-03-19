import { HttpException, HttpStatus } from '@nestjs/common';

export class BusinessException extends HttpException {
  public readonly businessCode: number;

  constructor(businessCode: number, message: string, httpStatus: HttpStatus = HttpStatus.BAD_REQUEST) {
    super(message, httpStatus);
    this.businessCode = businessCode;
  }
}
