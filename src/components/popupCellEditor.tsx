/* eslint-disable @typescript-eslint/no-explicit-any */
import { createRoot, type Root } from "react-dom/client";
import type { ReactNode } from "react";
import type { ICellEditorComp } from "ag-grid-community";

/**
 * AG Grid 弹出式单元格编辑器通用适配器：把 Portal 弹层 React 组件包装成
 * ICellEditorComp。定位（单元格下方）、mousedown 阻断、onChange/onClose 注入
 * 与卸载时机由本类统一处理，各编辑器只需提供「取初值」与「渲染弹层」两件事。
 */
export function createPopupCellEditor<T>(opts: {
  getInitial: (params: any) => T;
  render: (ctx: {
    params: any;
    initial: T;
    pos: { top: number; left: number };
    onChange: (v: T) => void;
    onClose: (finalValue?: T) => void;
  }) => ReactNode;
}): new () => ICellEditorComp<T> {
  return class implements ICellEditorComp<T> {
    private value!: T;
    private div!: HTMLDivElement;
    private root: Root | null = null;
    private params: any;

    getGui(): HTMLElement {
      return this.div;
    }

    init(params: any) {
      this.params = params;
      this.value = opts.getInitial(params);

      this.div = document.createElement("div");
      this.div.style.cssText = "padding: 0; background: transparent;";

      const wrapper = document.createElement("div");
      this.div.appendChild(wrapper);

      const cellRect = params.eGridCell?.getBoundingClientRect() ?? {
        bottom: 0,
        left: 0,
      };
      const pos = { top: cellRect.bottom + 2, left: cellRect.left };

      this.div.addEventListener("mousedown", (e) => e.stopPropagation());

      this.root = createRoot(wrapper);
      this.root.render(
        opts.render({
          params,
          initial: this.value,
          pos,
          onChange: (v: T) => {
            this.value = v;
          },
          onClose: (finalValue?: T) => {
            if (finalValue !== undefined) this.value = finalValue;
            this.params.stopEditing();
          },
        }),
      );
    }

    getValue(): T {
      return this.value;
    }

    isPopup(): boolean {
      return true;
    }

    destroy() {
      if (this.root) {
        const root = this.root;
        this.root = null;
        queueMicrotask(() => root.unmount());
      }
    }
  };
}
