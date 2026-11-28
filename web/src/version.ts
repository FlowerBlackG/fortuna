// SPDX-License-Identifier: MulanPSL-2.0

export interface BuildInfo {
  tag: string;
  code?: number;
  buildTime?: string;
}

export interface ServerInfo extends BuildInfo {
  environment?: "development" | "staging" | "production";
}

export default class Version {
  static code = 2;
  static tag = "1.0.1";

  /** in iso8601 format */
  static buildTime = "2026-11-28T13:43:01+08:00";

  private constructor() {}
}
