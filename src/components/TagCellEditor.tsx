import type { ICellEditorComp } from "ag-grid-community";
import TagEditorPopup from "./TagEditorPopup";

/**
 * AG Grid 自定义单元格编辑器：标签输入（多人负责）。
 * 值类型为 string[]，支持搜索成员、回车添加、点击添加、退格删除。
 */
export default class TagCellEditor implements ICellEditorComp<string[]> {
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

    this.div = document.createElement("div");
    this.div.style.cssText = `
      padding: 10px;
      min-width: 220px;
      background: rgba(255, 255, 255, 0.85);
      backdrop-filter: blur(20px) saturate(180%);
      -webkit-backdrop-filter: blur(20px) saturate(180%);
      border: 1px solid rgba(255, 255, 255, 0.5);
      border-radius: 16px;
      box-shadow:
        0 8px 32px rgba(0, 0, 0, 0.08),
        0 2px 8px rgba(0, 0, 0, 0.04),
        inset 0 1px 0 rgba(255, 255, 255, 0.5);
    `;

    const wrapper = document.createElement("div");
    this.div.appendChild(wrapper);

    // 阻止 AG Grid 捕获点击事件导致编辑器关闭
    this.div.addEventListener("mousedown", (e) => e.stopPropagation());

    import("react-dom/client").then(({ createRoot }) => {
      this.root = createRoot(wrapper);
      this.root.render(
        <TagEditorPopup
          initial={this.value}
          members={members}
          onChange={(v: string[]) => {
            this.value = v;
          }}
        />,
      );
    });
  }

  getValue(): string[] {
    return this.value;
  }

  isPopup(): boolean {
    return true;
  }

  destroy() {
    this.root?.unmount();
    this.root = null;
  }
}
