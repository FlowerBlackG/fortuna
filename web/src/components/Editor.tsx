// SPDX-License-Identifier: MulanPSL-2.0
import { t } from "../i18n";
import { useRef, type ReactNode } from "react";
import { Dialog, Form, Select, type SelectProps } from "tdesign-react";

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

export function FocusSelect(props: Pick<SelectProps, "value" | "options" | "onChange">) {
  return (
    <div
      onMouseDownCapture={(event) => {
        // Keep focus on the input until the option's click closes the popup.
        if (event.target instanceof Element && event.target.closest(".t-select-option"))
          event.preventDefault();
      }}
    >
      <Select {...props} filterable popupProps={{ trigger: "focus" }} />
    </div>
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
  const composing = useRef(false);
  return (
    <div
      onCompositionStartCapture={() => {
        composing.current = true;
      }}
      onCompositionEndCapture={() => {
        composing.current = false;
      }}
      onKeyDownCapture={(event) => {
        if (event.key !== "Escape" && event.key !== "Enter") return;
        if (composing.current || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) {
          event.stopPropagation();
        } else if (
          event.key === "Escape" &&
          event.target instanceof Element &&
          event.target.closest(".t-popup-open, .t-popup")
        ) {
          // The popup can close before the dialog's bubbling Escape handler runs.
          event.preventDefault();
        }
      }}
    >
      <Dialog
        visible
        className="editor-dialog"
        placement="center"
        width={720}
        header={title}
        confirmBtn={{ shape: "round", content: saveLabel, loading: saving }}
        cancelBtn={{ shape: "round", content: t("Cancel") }}
        confirmOnEnter
        closeOnEscKeydown={false}
        closeOnOverlayClick={false}
        onEscKeydown={({ e }) => {
          if (!saving && !e.repeat && !e.defaultPrevented) onClose();
        }}
        onConfirm={({ e }) => {
          if ("key" in e) {
            if (
              e.shiftKey ||
              e.repeat ||
              e.defaultPrevented ||
              (e.target instanceof Element &&
                e.target.closest("button, [role=option], .t-select, .t-popup-open, .t-popup"))
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
    </div>
  );
}
