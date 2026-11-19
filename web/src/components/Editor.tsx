// SPDX-License-Identifier: MulanPSL-2.0
import type { ReactNode } from "react";
import { Dialog, Form } from "tdesign-react";

export function EditorField({
  children,
  ...props
}: {
  label: string;
  children: ReactNode;
  help?: string;
  className?: string;
}) {
  // FormItem otherwise replaces its direct input's controlled value with its own form state.
  return (
    <Form.FormItem {...props}>
      <>{children}</>
    </Form.FormItem>
  );
}

export function EditorDialog({
  title,
  saveLabel = "Save",
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
      width={720}
      header={title}
      confirmBtn={{ content: saveLabel, loading: saving }}
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
