// SPDX-License-Identifier: MulanPSL-2.0
export interface IResponse<T> {
  code: number;
  msg: string;
  data: T;
}
export interface Account {
  user_id: string;
  username: string;
  create_time: string;
  last_login_time: string;
}
export interface Currency {
  currency_id: string;
  user_id: string;
  name: string;
  note: string;
}
export interface Institution {
  institution_id: string;
  user_id: string;
  name: string;
  note: string;
}
export interface CustomField {
  data_order: number;
  display_order: number;
  type: "str" | "int" | "float" | "date";
  field_name: string;
  prefix: string;
  postfix: string;
  nullable: boolean;
}
export interface AssetType {
  asset_type_id: string;
  user_id: string;
  name: string;
  note: string;
  color: string;
  custom_fields: unknown;
}
export interface ExchangeRate {
  user_id: string;
  report_id: string;
  numerator_currency_id: string;
  denominator_currency_id: string;
  exchange_rate: number;
}
export interface Report {
  report_id: string;
  user_id: string;
  title: string;
  create_time: string;
  update_time: string;
  currency_totals?: CurrencyTotal[];
  exchange_rates: ExchangeRate[];
}
export interface CurrencyTotal {
  currency_id: string;
  nominal: number;
  effective: number;
}
export interface AssetRecord {
  record_id: string;
  user_id: string;
  report_id: string;
  currency_id: string;
  asset_type_id: string;
  institution_id: string;
  content: string;
  amount: number;
  effective_rate: number;
  asset_custom_fields_data: unknown;
}
export interface Metadata {
  currencies: Currency[];
  institutions: Institution[];
  asset_types: AssetType[];
  settings: unknown;
}
export interface UserSettings {
  default_currency?: string;
  [key: string]: unknown;
}
