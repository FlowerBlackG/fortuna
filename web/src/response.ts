// SPDX-License-Identifier: MulanPSL-2.0
export interface IResponse<T> {
  code: number;
  msg: string;
  data: T;
}
