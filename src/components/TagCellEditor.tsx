import type { ICellEditorComp } from "ag-grid-community";
import TagEditorInner from "./TagEditorInner";

/**
 * AG Grid 自定义单元格编辑器：标签输入（多人负责）。
 * 值类型为 string[]，显示为可增删的标签列表。
 */
export default class TagCellEditor implements ICellEditorComp<string[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private params!: any;
  private value: string[] = [];
  private div!: HTMLDivElement;

  getGui(): HTMLElement {
    return this.div;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  init(params: any) {
    this.params = params;
    this.value = Array.isArray(params.value) ? [...params.value] : [];

    this.div = document.createElement("div");
    this.div.className = "tag-cell-editor";
    this.div.style.cssText =
      "display:flex;flex-wrap:wrap;gap:4px;padding:4px;min-width:180px;background:var(--background);border:1px solid var(--primary);border-radius:4px;";

    const root = document.createElement("div");
    root.style.cssText = "display:flex;flex-wrap:wrap;gap:4px;width:100%;";
    this.div.appendChild(root);

    // 动态导入 React 并渲染（AG Grid 要求 getGui 返回原生 DOM）
    import("react-dom/client").then(({ createRoot }) => {
      const r = createRoot(root);
      r.render(
        <TagEditorInner
          initial={this.value}
          onChange={(v) => {
            this.value = v;
          }}
          members={this.params.members ?? []}
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
}
