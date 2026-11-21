// SPDX-License-Identifier: MulanPSL-2.0
import { t } from "../i18n";
import type { ReactNode } from "react";
import { Dialog, Form } from "tdesign-react";

export function EditorField({
  children,
  warning,
  help,
  ...props
}: {
  label: string;
  children: ReactNode;
  help?: string;
  warning?: string | false;
  className?: string;
}) {
  // FormItem otherwise replaces its direct input's controlled value with its own form state.
  return (
    <Form.FormItem
      {...props}
      status={warning ? "warning" : undefined}
      tips={warning || undefined}
      help={warning ? undefined : help}
    >
      <>{children}</>
    </Form.FormItem>
  );
}

export function EditorDialog({
  title,
  saveLabel = t("Save"),
  saving = false,
  onSave,
  onClose,
  children,
}: {
  title: string;
  saveLabel?: string;
  saving?: boolean;
  onSave: () => void;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <Dialog
      visible
      className="editor-dialog"
      placement="center"
      width={720}
      header={title}
      confirmBtn={{ shape: "round", content: saveLabel, loading: saving }}
      confirmOnEnter
      closeOnEscKeydown
      closeOnOverlayClick={false}
      onConfirm={({ e }) => {
        if ("key" in e) {
          if (
            e.shiftKey ||
            e.nativeEvent.isComposing ||
            e.defaultPrevented ||
            (e.target instanceof Element && e.target.closest("button, [role=option]"))
          )
            return;
          e.preventDefault();
        }
        if (!saving) onSave();
      }}
      onClose={() => {
        if (!saving) onClose();
      }}
    >
      {children}
    </Dialog>
  );
}
