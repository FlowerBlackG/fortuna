// SPDX-License-Identifier: MulanPSL-2.0
import { t, useLanguage, setLanguage } from "../i18n";
import { defaultFonts, fontRoles, savedFont, setFont, type FontRole } from "../exportFonts";
import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Form,
  Input,
  Popconfirm,
  Select,
  Space,
  Table,
  Tabs,
  Textarea,
} from "tdesign-react";
import type { PrimaryTableCol } from "tdesign-react";
import { DeleteIcon, EditIcon, RefreshIcon } from "tdesign-icons-react";
import { request, setToken } from "../api";
import { action, selectString, settingsObject, showError } from "../helpers";
import { useLoad } from "../useLoad";
import { useMetadata } from "../metadata";
import { customFields } from "../calculations";
import { EditorDialog, EditorField } from "../components/Editor";
import type { Account, AssetType, Currency, CustomField, Institution, Metadata } from "../types";

type Resource = "currencies" | "institutions" | "asset-types";
const resourceNames = {
  currencies: "currency",
  institutions: "institution",
  "asset-types": "asset type",
} as const;
type MetadataEntry = Currency | Institution | AssetType;
type MetadataRow = MetadataEntry & { id: string };
const idFor = (resource: Resource) =>
  resource === "currencies"
    ? "currency_id"
    : resource === "institutions"
      ? "institution_id"
      : "asset_type_id";
function entries(metadata: Metadata, resource: Resource): MetadataRow[] {
  const source =
    resource === "currencies"
      ? metadata.currencies
      : resource === "institutions"
        ? metadata.institutions
        : metadata.asset_types;
  return source.map((item) => ({
    ...item,
    id: String(item[idFor(resource) as keyof typeof item]),
  }));
}

function saveEntry(metadata: Metadata, entry: MetadataEntry): Metadata {
  if ("currency_id" in entry)
    return {
      ...metadata,
      currencies: [
        ...metadata.currencies.filter((item) => item.currency_id !== entry.currency_id),
        entry,
      ],
    };
  if ("institution_id" in entry)
    return {
      ...metadata,
      institutions: [
        ...metadata.institutions.filter((item) => item.institution_id !== entry.institution_id),
        entry,
      ],
    };
  return {
    ...metadata,
    asset_types: [
      ...metadata.asset_types.filter((item) => item.asset_type_id !== entry.asset_type_id),
      entry,
    ],
  };
}

function FieldEditor({
  fields,
  attempted,
  onChange,
  nextOrder,
}: {
  fields: CustomField[];
  attempted: boolean;
  onChange: (value: CustomField[]) => void;
  nextOrder: () => number;
}) {
  const ordered = [...fields].sort((a, b) => a.display_order - b.display_order);
  function update(order: number, value: Partial<CustomField>) {
    onChange(fields.map((field) => (field.data_order === order ? { ...field, ...value } : field)));
  }
  function move(index: number, delta: number) {
    const copy = [...ordered];
    [copy[index], copy[index + delta]] = [copy[index + delta], copy[index]];
    onChange(copy.map((field, display_order) => ({ ...field, display_order })));
  }
  return (
    <div>
      <h2>{t("Custom fields")}</h2>
      <p className="muted">{t("Removing a field deletes its values from existing records.")}</p>
      {ordered.map((field, index) => (
        <div className="field-row" key={field.data_order}>
          <div className="form-grid">
            <EditorField
              label={t("Field name")}
              warning={attempted && !field.field_name.trim() && t("Enter a field name")}
            >
              <Input
                value={field.field_name}
                onChange={(field_name) => update(field.data_order, { field_name })}
              />
            </EditorField>
            <EditorField label={t("Type")}>
              <Select
                value={field.type}
                options={["str", "int", "float", "date"].map((value) => ({
                  value,
                  label: {
                    str: t("Text"),
                    int: t("Integer"),
                    float: t("Decimal"),
                    date: t("Date"),
                  }[value],
                }))}
                onChange={(value) =>
                  update(field.data_order, { type: value as CustomField["type"] })
                }
              />
            </EditorField>
            <EditorField label={t("Prefix")}>
              <Input
                value={field.prefix}
                onChange={(prefix) => update(field.data_order, { prefix })}
              />
            </EditorField>
            <EditorField label={t("Postfix")}>
              <Input
                value={field.postfix}
                onChange={(postfix) => update(field.data_order, { postfix })}
              />
            </EditorField>
          </div>
          <Space align="center" breakLine>
            <Checkbox
              checked={field.nullable}
              onChange={(nullable) => update(field.data_order, { nullable })}
            >
              {t("Allow empty value")}
            </Checkbox>
            <Button
              shape="round"
              variant="outline"
              size="small"
              disabled={index === 0}
              onClick={() => move(index, -1)}
            >
              {t("Move up")}
            </Button>
            <Button
              shape="round"
              variant="outline"
              size="small"
              disabled={index === ordered.length - 1}
              onClick={() => move(index, 1)}
            >
              {t("Move down")}
            </Button>
            <Button
              shape="round"
              variant="text"
              theme="danger"
              size="small"
              icon={<DeleteIcon />}
              aria-label={t("Remove field")}
              title={t("Remove field")}
              onClick={() =>
                onChange(fields.filter((item) => item.data_order !== field.data_order))
              }
            />
          </Space>
        </div>
      ))}
      <Button
        shape="round"
        className="settings-section"
        variant="outline"
        onClick={() =>
          onChange([
            ...fields,
            {
              data_order: nextOrder(),
              display_order: ordered.length
                ? Math.max(...ordered.map((field) => field.display_order)) + 1
                : 0,
              type: "str",
              field_name: "",
              prefix: "",
              postfix: "",
              nullable: true,
            },
          ])
        }
      >
        {t("Add custom field")}
      </Button>
    </div>
  );
}

function MetadataEditor({
  resource,
  initial,
  close,
}: {
  resource: Resource;
  initial: MetadataRow | null;
  close: () => void;
}) {
  const { update } = useMetadata();
  const asset = initial && "custom_fields" in initial ? initial : null;
  const [name, setName] = useState(initial?.name || "");
  const [note, setNote] = useState(initial?.note || "");
  const [color, setColor] = useState(asset?.color || "65AE73");
  const [fields, setFields] = useState(() => customFields(asset?.custom_fields));
  const [highOrder, setHighOrder] = useState(
    Math.max(-1, ...fields.map((field) => field.data_order)),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [attempted, setAttempted] = useState(false);
  const invalidColor = resource === "asset-types" && !/^[0-9A-F]{6}$/.test(color);
  const submitting = useRef(false);
  async function save() {
    if (submitting.current) return;
    setError("");
    if (!name.trim() || invalidColor || fields.some((field) => !field.field_name.trim())) {
      setAttempted(true);
      return;
    }
    setSaving(true);
    submitting.current = true;
    try {
      const saved = await request<MetadataEntry>(
        initial ? "PATCH" : "POST",
        `/${resource}${initial ? `/${initial.id}` : ""}`,
        {
          name: name.trim(),
          note,
          ...(resource === "asset-types" ? { color, custom_fields: fields } : {}),
        },
      );
      update((metadata) => saveEntry(metadata, saved));
      close();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("Save failed"));
    } finally {
      setSaving(false);
      submitting.current = false;
    }
  }
  const malformed =
    asset &&
    (!Array.isArray(asset.custom_fields) ||
      customFields(asset.custom_fields).length !== asset.custom_fields.length);
  return (
    <EditorDialog
      title={t(`${initial ? "Edit" : "Add"} ${resourceNames[resource]}`)}
      saving={saving}
      onSave={() => void save()}
      onClose={close}
    >
      {error && <Alert theme="error" message={error} />}
      {malformed && (
        <Alert
          theme="warning"
          message={t(
            "Some field definitions are malformed. Saving replaces them with the fields shown below; review existing record values afterward.",
          )}
        />
      )}
      <Form labelAlign="top">
        <EditorField label={t("Name")} warning={attempted && !name.trim() && t("Enter a name")}>
          <Input autofocus value={name} onChange={setName} />
        </EditorField>
        <EditorField label={t("Note")}>
          <Textarea value={note} onChange={setNote} />
        </EditorField>
        {resource === "asset-types" && (
          <>
            <EditorField
              label={t("Color (six hex characters)")}
              warning={attempted && invalidColor && t("Use six hexadecimal characters")}
            >
              <Input
                value={color}
                onChange={(value) => setColor(value.toUpperCase())}
                maxlength={6}
                prefixIcon={<span style={{ color: `#${color}` }}>●</span>}
              />
            </EditorField>
            <FieldEditor
              fields={fields}
              attempted={attempted}
              onChange={setFields}
              nextOrder={() => {
                const next = highOrder + 1;
                setHighOrder(next);
                return next;
              }}
            />
          </>
        )}
      </Form>
    </EditorDialog>
  );
}

function MetadataSettings({ resource }: { resource: Resource }) {
  const { metadata, refresh, update, loading } = useMetadata();
  const [editing, setEditing] = useState<MetadataRow | null | undefined>();
  function open(id?: string) {
    setEditing(id ? entries(metadata, resource).find((entry) => entry.id === id) : null);
  }
  const columns: PrimaryTableCol<MetadataRow>[] = [
    {
      colKey: "name",
      title: t("Name"),
      cell: ({ row }) => (
        <Space>
          {"color" in row && (
            <span
              style={{ color: /^([0-9A-F]{6})$/.test(row.color) ? `#${row.color}` : "#6b7972" }}
            >
              ●
            </span>
          )}
          {row.name}
        </Space>
      ),
    },
    {
      colKey: "note",
      title: t("Note"),
      cell: ({ row }) => <span className="multiline">{row.note || "—"}</span>,
    },
    ...(resource === "asset-types"
      ? [
          {
            colKey: "fields",
            title: t("Custom fields"),
            cell: ({ row }: { row: MetadataRow }) =>
              "custom_fields" in row ? customFields(row.custom_fields).length : 0,
          },
        ]
      : []),
    {
      colKey: "actions",
      title: t("Actions"),
      width: 180,
      cell: ({ row }) => (
        <Space>
          <Button
            shape="round"
            variant="text"
            size="small"
            icon={<EditIcon />}
            aria-label={t("Edit")}
            title={t("Edit")}
            disabled={loading}
            onClick={() => open(row.id)}
          />
          <Popconfirm
            content={t("Delete this entry? Entries used by records cannot be deleted.")}
            onConfirm={() =>
              action(async () => {
                await request("DELETE", `/${resource}/${row.id}`);
                update((current) => {
                  const settings = { ...settingsObject(current.settings) };
                  if (resource === "currencies" && settings.default_currency === row.id)
                    delete settings.default_currency;
                  return {
                    ...current,
                    settings,
                    currencies: current.currencies.filter(
                      (item) => resource !== "currencies" || item.currency_id !== row.id,
                    ),
                    institutions: current.institutions.filter(
                      (item) => resource !== "institutions" || item.institution_id !== row.id,
                    ),
                    asset_types: current.asset_types.filter(
                      (item) => resource !== "asset-types" || item.asset_type_id !== row.id,
                    ),
                  };
                });
              })
            }
          >
            <Button
              shape="round"
              variant="text"
              theme="danger"
              size="small"
              icon={<DeleteIcon />}
              aria-label={t("Delete")}
              title={t("Delete")}
            />
          </Popconfirm>
        </Space>
      ),
    },
  ];
  return (
    <Card className="settings-section">
      <div className="toolbar">
        <Button shape="round" disabled={loading} onClick={() => open()}>
          {t(`Add ${resourceNames[resource]}`)}
        </Button>
        <Button
          shape="round"
          variant="outline"
          icon={<RefreshIcon />}
          aria-label={t("Refresh")}
          title={t("Refresh")}
          loading={loading}
          onClick={() => {
            void refresh().catch(() => {});
          }}
        />
      </div>
      <Table
        rowKey="id"
        data={entries(metadata, resource)}
        columns={columns}
        loading={loading}
        empty={t("No entries yet. Add your first one above.")}
        pagination={{ total: entries(metadata, resource).length, defaultPageSize: 20 }}
      />
      {editing !== undefined && (
        <MetadataEditor resource={resource} initial={editing} close={() => setEditing(undefined)} />
      )}
    </Card>
  );
}

function Preferences() {
  const language = useLanguage();
  const { metadata, update, loading } = useMetadata();
  const [saving, setSaving] = useState(false);
  const settings = settingsObject(metadata.settings);
  const defaultCurrency =
    typeof settings.default_currency === "string" ? settings.default_currency : "";
  const malformed =
    !metadata.settings ||
    typeof metadata.settings !== "object" ||
    Array.isArray(metadata.settings) ||
    (settings.default_currency !== undefined &&
      (typeof settings.default_currency !== "string" ||
        !metadata.currencies.some((item) => item.currency_id === settings.default_currency)));
  async function save(value: string) {
    if (saving) return;
    setSaving(true);
    try {
      const updated = { ...settingsObject(metadata.settings) };
      if (value) updated.default_currency = value;
      else delete updated.default_currency;
      const saved = await request<{ settings: unknown }>("PUT", "/settings", { settings: updated });
      update((current) => ({ ...current, settings: saved.settings }));
    } finally {
      setSaving(false);
    }
  }
  return (
    <Card title={t("Display preferences")} className="settings-section">
      {malformed && (
        <Alert
          theme="warning"
          message={t("Your saved settings are malformed or reference a deleted currency.")}
          operation={
            <Button shape="round" variant="text" onClick={() => action(() => save(""))}>
              {t("Repair settings")}
            </Button>
          }
        />
      )}
      <Form labelAlign="top">
        <EditorField label={t("Language")}>
          <Select
            value={language}
            options={[
              { value: "en-US", label: "English" },
              { value: "zh-CN", label: "简体中文" },
            ]}
            onChange={(value) => setLanguage(value === "zh-CN" ? "zh-CN" : "en-US")}
          />
        </EditorField>
        <Form.FormItem label={t("Default currency")}>
          <Select
            clearable
            disabled={loading || saving}
            value={defaultCurrency}
            options={metadata.currencies.map((currency) => ({
              value: currency.currency_id,
              label: currency.name,
            }))}
            onChange={(value) => action(() => save(selectString(value)))}
          />
        </Form.FormItem>
      </Form>
      <p className="muted">
        {t(
          "Decimal precision is adjustable on report and analysis pages and is saved only in this browser.",
        )}
      </p>
    </Card>
  );
}

function FontPreferences() {
  const [names, setNames] = useState(() =>
    Object.fromEntries(fontRoles.map((role) => [role, savedFont(role)])),
  );
  function change(role: FontRole, name: string) {
    setFont(role, name);
    setNames((previous) => ({ ...previous, [role]: name }));
  }
  return (
    <Card title={t("Excel export fonts")} className="settings-section">
      <Form labelAlign="top">
        <div className="form-grid">
          {fontRoles.map((role) => (
            <EditorField key={role} label={t(role)}>
              <Input
                clearable
                maxlength={31}
                value={names[role] ?? ""}
                placeholder={defaultFonts[role]}
                onChange={(value) => change(role, value)}
              />
            </EditorField>
          ))}
        </div>
      </Form>
      <p className="muted">
        {t(
          "Font names must be installed on the computer opening the workbook. Monospace fonts are used for amounts, dates and currency codes.",
        )}
      </p>
      <Button
        shape="round"
        variant="outline"
        onClick={() => {
          for (const role of fontRoles) setFont(role, "");
          setNames({});
        }}
      >
        {t("Restore defaults")}
      </Button>
    </Card>
  );
}

function AccountSettings() {
  const state = useLoad(() => request<Account>("GET", "/account"), []);
  const [editedUsername, setUsername] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const username = editedUsername ?? state.data?.username ?? "";
  async function save() {
    setSaving(true);
    try {
      const result = await request<{ account: Account; token?: string }>("PATCH", "/account", {
        username,
        password,
        ...(newPassword ? { new_password: newPassword } : {}),
      });
      if (result.token) setToken(result.token);
      setPassword("");
      setNewPassword("");
      state.setData(result.account);
    } finally {
      setSaving(false);
    }
  }
  return (
    <Card title={t("Account")} className="settings-section">
      {state.error && <Alert theme="error" message={state.error} />}
      <Form labelAlign="top" onSubmit={() => action(save)}>
        <Form.FormItem label={t("Username")}>
          <Input value={username} onChange={setUsername} />
        </Form.FormItem>
        <Form.FormItem label={t("Current password")}>
          <Input
            type="password"
            value={password}
            onChange={setPassword}
            autocomplete="current-password"
          />
        </Form.FormItem>
        <Form.FormItem label={t("New password (optional)")}>
          <Input
            type="password"
            value={newPassword}
            onChange={setNewPassword}
            autocomplete="new-password"
          />
        </Form.FormItem>
        <Space breakLine className="settings-section">
          <Button type="submit" loading={saving} shape="round">
            {t("Save account")}
          </Button>
          <Popconfirm
            content={t(
              "Permanently delete your account and all reports, records, and settings? Enter your current password above first.",
            )}
            confirmBtn={
              <Button
                shape="round"
                theme="danger"
                content={t("Delete")}
                size="small"
                onClick={() => {
                  void request("DELETE", "/account", { password })
                    .then(() => setToken(""))
                    .catch(showError);
                }}
              />
            }
            cancelBtn={<Button shape="round" size="small" content={t("Cancel")} theme="default" />}
          >
            <Button
              theme="danger"
              shape="round"
              content={t("Delete account")}
              aria-label={t("Delete account")}
              title={t("Delete account")}
            />
          </Popconfirm>
        </Space>
      </Form>
    </Card>
  );
}

export function SettingsPage() {
  const { refresh } = useMetadata();
  const [tab, setTab] = useState("currencies");
  useEffect(() => {
    if (tab !== "account") void refresh().catch(() => {});
  }, [refresh, tab]);
  return (
    <>
      <div className="page-heading">
        <h1>{t("Settings")}</h1>
      </div>
      <Tabs value={tab} onChange={(value) => setTab(String(value))}>
        <Tabs.TabPanel value="currencies" label={t("Currencies")}>
          {tab === "currencies" && <MetadataSettings resource="currencies" />}
        </Tabs.TabPanel>
        <Tabs.TabPanel value="institutions" label={t("Institutions")}>
          {tab === "institutions" && <MetadataSettings resource="institutions" />}
        </Tabs.TabPanel>
        <Tabs.TabPanel value="asset-types" label={t("Asset types")}>
          {tab === "asset-types" && <MetadataSettings resource="asset-types" />}
        </Tabs.TabPanel>
        <Tabs.TabPanel value="preferences" label={t("Preferences")}>
          {tab === "preferences" && (
            <>
              <Preferences />
              <FontPreferences />
            </>
          )}
        </Tabs.TabPanel>
        <Tabs.TabPanel value="account" label={t("Account")}>
          {tab === "account" && <AccountSettings />}
        </Tabs.TabPanel>
      </Tabs>
    </>
  );
}
