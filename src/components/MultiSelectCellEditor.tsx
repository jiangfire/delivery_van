import { createRoot } from "react-dom/client";
import type { ICellEditorComp } from "ag-grid-community";
import MultiSelectEditor from "./MultiSelectEditor";

/**
 * AG Grid 自定义单元格编辑器：成员多选下拉。
 * 使用 Portal 渲染下拉面板到 body，逃出 backdrop-filter 层叠上下文。
 */
export default class MultiSelectCellEditor implements ICellEditorComp<
  string[]
> {
  private value: string[] = [];
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
    this.value = Array.isArray(params.value) ? [...params.value] : [];
    const members: string[] = params.members ?? [];
    const onAddMember: ((name: string) => void) | undefined =
      params.onAddMember;

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

    const handleClose = () => {
      // 先同步值到 AG Grid，再停止编辑
      this.params.stopEditing();
    };

    this.root = createRoot(wrapper);
    this.root.render(
      <MultiSelectEditor
        initial={this.value}
        members={members}
        onAddMember={onAddMember}
        pos={pos}
        onChange={(v: string[]) => {
          this.value = v;
        }}
        onClose={handleClose}
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
