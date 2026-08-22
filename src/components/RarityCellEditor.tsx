import { createRoot } from "react-dom/client";
import type { ICellEditorComp } from "ag-grid-community";
import RarityEditor from "./RarityEditor";

/**
 * 稀有度下拉编辑器：显示大写英文缩写（N/R/SR/SSR/UR），返回小写存储值。
 * 使用 Portal 渲染下拉面板到 body。
 */
export default class RarityCellEditor implements ICellEditorComp<string> {
  private value: string = "";
  private div!: HTMLDivElement;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private root: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private params: any;

  getGui(): HTMLElement {
    return this.div;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  init(params: any) {
    this.params = params;
    this.value = params.value ?? "n";

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
      <RarityEditor
        initial={this.value}
        pos={pos}
        onChange={(v: string) => {
          this.value = v;
        }}
        onClose={(finalValue?: string) => {
          if (finalValue !== undefined) this.value = finalValue;
          this.params.stopEditing();
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
