import { createRoot } from "react-dom/client";
import type { ICellEditorComp } from "ag-grid-community";
import RarityEditor from "./RarityEditor";

/**
 * 稀有度下拉编辑器：显示中文标签，返回英文值。
 */
export default class RarityCellEditor implements ICellEditorComp<string> {
  private value: string = "";
  private div!: HTMLDivElement;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private root: any = null;

  getGui(): HTMLElement {
    return this.div;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  init(params: any) {
    this.value = params.value ?? "common";

    this.div = document.createElement("div");
    this.div.style.cssText = "padding: 0; background: transparent;";

    const wrapper = document.createElement("div");
    this.div.appendChild(wrapper);

    this.div.addEventListener("mousedown", (e) => e.stopPropagation());

    this.root = createRoot(wrapper);
    this.root.render(
      <RarityEditor
        initial={this.value}
        onChange={(v: string) => {
          this.value = v;
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
