import { createRoot } from "react-dom/client";
import type { ICellEditorComp } from "ag-grid-community";
import DateCellEditor from "./DateCellEditor";

/**
 * 送达日期单元格编辑器（AG Grid ICellEditorComp 适配）。
 * 使用 Portal 渲染日期选择弹框到 body。
 */
export default class DateCellEditorComp implements ICellEditorComp<string> {
  private value: string = "";
  private div!: HTMLDivElement;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private root: any = null;

  getGui(): HTMLElement {
    return this.div;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  init(params: any) {
    this.value = params.value ?? "";

    this.div = document.createElement("div");
    this.div.style.cssText = "padding: 0; background: transparent;";

    const wrapper = document.createElement("div");
    this.div.appendChild(wrapper);

    const cellEl: HTMLElement | undefined = params.eGridCell;
    const cellRect = cellEl?.getBoundingClientRect() ?? {
      bottom: 0,
      left: 0,
    };
    const pos = { top: cellRect.bottom + 2, left: cellRect.left };

    this.div.addEventListener("mousedown", (e) => e.stopPropagation());

    this.root = createRoot(wrapper);
    this.root.render(
      <DateCellEditor
        initial={this.value}
        pos={pos}
        onClose={(v: string | null) => {
          this.value = v ?? "";
          params.stopEditing();
        }}
      />,
    );
  }

  getValue(): string {
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
}
