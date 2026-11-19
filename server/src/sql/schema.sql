-- SPDX-License-Identifier: MulanPSL-2.0
CREATE TABLE IF NOT EXISTS user_account (
    user_id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE,
    create_time TEXT NOT NULL, last_login_time TEXT NOT NULL, user_password TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS user_settings (
    user_id TEXT PRIMARY KEY REFERENCES user_account(user_id) ON DELETE CASCADE,
    settings TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS currency (
    currency_id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES user_account(user_id) ON DELETE CASCADE,
    name TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', UNIQUE(user_id, currency_id)
);
CREATE TABLE IF NOT EXISTS currency_exchange_rate (
    user_id TEXT NOT NULL REFERENCES user_account(user_id) ON DELETE CASCADE,
    report_id TEXT NOT NULL,
    numerator_currency_id TEXT NOT NULL, denominator_currency_id TEXT NOT NULL,
    exchange_rate REAL NOT NULL,
    PRIMARY KEY(user_id, report_id, numerator_currency_id, denominator_currency_id),
    FOREIGN KEY(user_id, report_id) REFERENCES report(user_id, report_id) ON DELETE CASCADE,
    FOREIGN KEY(user_id, numerator_currency_id) REFERENCES currency(user_id, currency_id) ON DELETE CASCADE,
    FOREIGN KEY(user_id, denominator_currency_id) REFERENCES currency(user_id, currency_id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS institution (
    institution_id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES user_account(user_id) ON DELETE CASCADE,
    name TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', UNIQUE(user_id, institution_id)
);
CREATE TABLE IF NOT EXISTS asset_type (
    asset_type_id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES user_account(user_id) ON DELETE CASCADE,
    name TEXT NOT NULL, color TEXT NOT NULL DEFAULT '65AE73', note TEXT NOT NULL DEFAULT '',
    custom_fields TEXT NOT NULL DEFAULT '[]', UNIQUE(user_id, asset_type_id)
);
CREATE TABLE IF NOT EXISTS report (
    report_id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES user_account(user_id) ON DELETE CASCADE,
    title TEXT NOT NULL DEFAULT '', create_time TEXT NOT NULL, update_time TEXT NOT NULL, report_time TEXT NOT NULL,
    UNIQUE(user_id, report_id)
);
CREATE TABLE IF NOT EXISTS report_record (
    record_id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES user_account(user_id) ON DELETE CASCADE,
    report_id TEXT NOT NULL, currency_id TEXT NOT NULL, asset_type_id TEXT NOT NULL,
    institution_id TEXT NOT NULL, content TEXT NOT NULL DEFAULT '', amount REAL NOT NULL,
    effective_rate REAL NOT NULL DEFAULT 1, asset_custom_fields_data TEXT NOT NULL DEFAULT '[]',
    FOREIGN KEY(user_id, report_id) REFERENCES report(user_id, report_id) ON DELETE CASCADE,
    FOREIGN KEY(user_id, currency_id) REFERENCES currency(user_id, currency_id),
    FOREIGN KEY(user_id, asset_type_id) REFERENCES asset_type(user_id, asset_type_id),
    FOREIGN KEY(user_id, institution_id) REFERENCES institution(user_id, institution_id)
);
CREATE INDEX IF NOT EXISTS record_report ON report_record(user_id, report_id);
CREATE INDEX IF NOT EXISTS record_currency ON report_record(user_id, currency_id);
CREATE INDEX IF NOT EXISTS record_institution ON report_record(user_id, institution_id);
CREATE INDEX IF NOT EXISTS record_asset_type ON report_record(user_id, asset_type_id);
CREATE TABLE IF NOT EXISTS system_info (
    fortuna_server_version_tag TEXT NOT NULL, fortuna_server_version_code INTEGER NOT NULL
);
