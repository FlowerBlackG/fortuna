// SPDX-License-Identifier: MulanPSL-2.0
import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Dialog,
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
import { DeleteIcon, RefreshIcon } from "tdesign-icons-react";
import { request, setToken } from "../api";
import { action, selectString, settingsObject, showError } from "../helpers";
import { useLoad } from "../useLoad";
import { useMetadata } from "../metadata";
import { customFields } from "../calculations";
import type { Account, AssetType, Currency, CustomField, Institution, Metadata } from "../types";

type Resource = "currencies" | "institutions" | "asset-types";
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
  onChange,
  nextOrder,
}: {
  fields: CustomField[];
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
      <h2>Custom fields</h2>
      <p className="muted">
        Display order can change freely. Removing a field also removes its values from existing
        records when you save.
      </p>
      {ordered.map((field, index) => (
        <div className="field-row" key={field.data_order}>
          <div className="form-grid">
            <Form.FormItem label="Field name">
              <Input
                value={field.field_name}
                onChange={(field_name) => update(field.data_order, { field_name })}
              />
            </Form.FormItem>
            <Form.FormItem label="Type">
              <Select
                value={field.type}
                options={["str", "int", "float", "date"].map((value) => ({
                  value,
                  label: { str: "Text", int: "Integer", float: "Decimal", date: "Date" }[value],
                }))}
                onChange={(value) =>
                  update(field.data_order, { type: value as CustomField["type"] })
                }
              />
            </Form.FormItem>
            <Form.FormItem label="Prefix">
              <Input
                value={field.prefix}
                onChange={(prefix) => update(field.data_order, { prefix })}
              />
            </Form.FormItem>
            <Form.FormItem label="Postfix">
              <Input
                value={field.postfix}
                onChange={(postfix) => update(field.data_order, { postfix })}
              />
            </Form.FormItem>
          </div>
          <Space align="center" breakLine>
            <Checkbox
              checked={field.nullable}
              onChange={(nullable) => update(field.data_order, { nullable })}
            >
              Allow empty value
            </Checkbox>
            <Button
              variant="outline"
              size="small"
              disabled={index === 0}
              onClick={() => move(index, -1)}
            >
              Move up
            </Button>
            <Button
              variant="outline"
              size="small"
              disabled={index === ordered.length - 1}
              onClick={() => move(index, 1)}
            >
              Move down
            </Button>
            <Button
              variant="text"
              theme="danger"
              size="small"
              icon={<DeleteIcon />}
              aria-label="Remove field"
              title="Remove field"
              onClick={() =>
                onChange(fields.filter((item) => item.data_order !== field.data_order))
              }
            />
          </Space>
        </div>
      ))}
      <Button
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
        Add custom field
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
  const submitting = useRef(false);
  async function save() {
    if (submitting.current) return;
    if (!name.trim()) {
      setError("Enter a name");
      return;
    }
    if (
      resource === "asset-types" &&
      (!/^[0-9A-F]{6}$/.test(color) || fields.some((field) => !field.field_name.trim()))
    ) {
      setError("Use a six-character hexadecimal color and give every field a name");
      return;
    }
    setSaving(true);
    submitting.current = true;
    setError("");
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
      setError(reason instanceof Error ? reason.message : "Save failed");
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
    <Dialog
      visible
      header={`${initial ? "Edit" : "Add"} ${resource === "asset-types" ? "asset type" : resource === "currencies" ? "currency" : "institution"}`}
      width={720}
      confirmBtn={{ content: "Save", loading: saving }}
      onConfirm={() => void save()}
      onClose={close}
      closeOnOverlayClick={false}
    >
      {error && <Alert theme="error" message={error} />}
      {malformed && (
        <Alert
          theme="warning"
          message="Some field definitions are malformed. Saving replaces them with the fields shown below; review existing record values afterward."
        />
      )}
      <Form labelAlign="top">
        <Form.FormItem label="Name">
          <Input value={name} onChange={setName} />
        </Form.FormItem>
        <Form.FormItem label="Note">
          <Textarea value={note} onChange={setNote} />
        </Form.FormItem>
        {resource === "asset-types" && (
          <>
            <Form.FormItem label="Color (six hex characters)">
              <Input
                value={color}
                onChange={(value) => setColor(value.toUpperCase())}
                maxlength={6}
                prefixIcon={<span style={{ color: `#${color}` }}>●</span>}
              />
            </Form.FormItem>
            <FieldEditor
              fields={fields}
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
    </Dialog>
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
      title: "Name",
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
      title: "Note",
      cell: ({ row }) => <span className="multiline">{row.note || "—"}</span>,
    },
    ...(resource === "asset-types"
      ? [
          {
            colKey: "fields",
            title: "Custom fields",
            cell: ({ row }: { row: MetadataRow }) =>
              "custom_fields" in row ? customFields(row.custom_fields).length : 0,
          },
        ]
      : []),
    {
      colKey: "actions",
      title: "Actions",
      width: 180,
      cell: ({ row }) => (
        <Space>
          <Button variant="text" size="small" disabled={loading} onClick={() => open(row.id)}>
            Edit
          </Button>
          <Popconfirm
            content="Delete this entry? Entries used by records cannot be deleted."
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
              variant="text"
              theme="danger"
              size="small"
              icon={<DeleteIcon />}
              aria-label="Delete"
              title="Delete"
            />
          </Popconfirm>
        </Space>
      ),
    },
  ];
  return (
    <Card className="settings-section">
      <div className="toolbar">
        <Button disabled={loading} onClick={() => open()}>
          Add{" "}
          {resource === "asset-types"
            ? "asset type"
            : resource === "currencies"
              ? "currency"
              : "institution"}
        </Button>
        <Button
          variant="outline"
          icon={<RefreshIcon />}
          aria-label="Refresh"
          title="Refresh"
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
        empty="No entries yet. Add your first one above."
        pagination={{ total: entries(metadata, resource).length, defaultPageSize: 20 }}
      />
      {editing !== undefined && (
        <MetadataEditor resource={resource} initial={editing} close={() => setEditing(undefined)} />
      )}
    </Card>
  );
}

function Preferences() {
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
    <Card title="Display preferences" className="settings-section">
      {malformed && (
        <Alert
          theme="warning"
          message="Your saved settings are malformed or reference a deleted currency."
          operation={
            <Button variant="text" onClick={() => action(() => save(""))}>
              Repair settings
            </Button>
          }
        />
      )}
      <Form labelAlign="top">
        <Form.FormItem label="Default currency">
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
        Decimal precision is adjustable on report and analysis pages and is saved only in this
        browser.
      </p>
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
    <Card title="Account" className="settings-section">
      {state.error && <Alert theme="error" message={state.error} />}
      <Form labelAlign="top" onSubmit={() => action(save)}>
        <Form.FormItem label="Username">
          <Input value={username} onChange={setUsername} />
        </Form.FormItem>
        <Form.FormItem label="Current password">
          <Input
            type="password"
            value={password}
            onChange={setPassword}
            autocomplete="current-password"
          />
        </Form.FormItem>
        <Form.FormItem label="New password (optional)">
          <Input
            type="password"
            value={newPassword}
            onChange={setNewPassword}
            autocomplete="new-password"
          />
        </Form.FormItem>
        <Space breakLine>
          <Button type="submit" loading={saving}>
            Save account
          </Button>
          <Popconfirm
            content="Permanently delete your account and all reports, records, and settings? Enter your current password above first."
            onConfirm={() => {
              void request("DELETE", "/account", { password })
                .then(() => setToken(""))
                .catch(showError);
            }}
          >
            <Button
              theme="danger"
              variant="outline"
              icon={<DeleteIcon />}
              aria-label="Delete account"
              title="Delete account"
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
        <div>
          <h1>Settings</h1>
          <p className="muted">
            Define currencies, institutions, and the asset types that fit your life.
          </p>
        </div>
      </div>
      <Tabs value={tab} onChange={(value) => setTab(String(value))}>
        <Tabs.TabPanel value="currencies" label="Currencies">
          {tab === "currencies" && <MetadataSettings resource="currencies" />}
        </Tabs.TabPanel>
        <Tabs.TabPanel value="institutions" label="Institutions">
          {tab === "institutions" && <MetadataSettings resource="institutions" />}
        </Tabs.TabPanel>
        <Tabs.TabPanel value="asset-types" label="Asset types">
          {tab === "asset-types" && <MetadataSettings resource="asset-types" />}
        </Tabs.TabPanel>
        <Tabs.TabPanel value="preferences" label="Preferences">
          {tab === "preferences" && <Preferences />}
        </Tabs.TabPanel>
        <Tabs.TabPanel value="account" label="Account">
          {tab === "account" && <AccountSettings />}
        </Tabs.TabPanel>
      </Tabs>
    </>
  );
}
