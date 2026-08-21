import { createRoot } from "react-dom/client";
import type { ICellEditorComp } from "ag-grid-community";
import MultiSelectEditor from "./MultiSelectEditor";

/**
 * AG Grid 自定义单元格编辑器：成员多选下拉。
 * 值类型为 string[]，点击勾选成员，已选显示为标签。
 */
export default class MultiSelectCellEditor implements ICellEditorComp<
  string[]
> {
  private value: string[] = [];
  private div!: HTMLDivElement;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private root: any = null;

  getGui(): HTMLElement {
    return this.div;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  init(params: any) {
    this.value = Array.isArray(params.value) ? [...params.value] : [];
    const members: string[] = params.members ?? [];
    const onAddMember: ((name: string) => void) | undefined =
      params.onAddMember;

    this.div = document.createElement("div");
    this.div.style.cssText = "padding: 0; background: transparent;";

    const wrapper = document.createElement("div");
    this.div.appendChild(wrapper);

    // 阻止 AG Grid 捕获点击事件导致编辑器关闭
    this.div.addEventListener("mousedown", (e) => e.stopPropagation());

    // 同步创建 React root
    this.root = createRoot(wrapper);
    this.root.render(
      <MultiSelectEditor
        initial={this.value}
        members={members}
        onAddMember={onAddMember}
        onChange={(v: string[]) => {
          this.value = v;
        }}
      />,
    );
  }

  getValue(): string[] {
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
