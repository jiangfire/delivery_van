import { createRoot } from "react-dom/client";
import type { ICellEditorComp } from "ag-grid-community";
import RequesterSelect from "./RequesterSelect";

/**
 * 提出人下拉编辑器：单选成员。
 * 使用 Portal 渲染下拉面板到 body。
 */
export default class RequesterCellEditor implements ICellEditorComp<string> {
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
    const members: string[] = params.members ?? [];
    const onAddMember: ((name: string) => void) | undefined =
      params.onAddMember;

    this.div = document.createElement("div");
    this.div.style.cssText = "padding: 0; background: transparent;";

    const wrapper = document.createElement("div");
    this.div.appendChild(wrapper);

    const cellRect = this.div.parentElement?.getBoundingClientRect() ?? {
      bottom: 0,
      left: 0,
    };
    const pos = { top: cellRect.bottom + 2, left: cellRect.left };

    this.div.addEventListener("mousedown", (e) => e.stopPropagation());

    this.root = createRoot(wrapper);
    this.root.render(
      <RequesterSelect
        initial={this.value}
        members={members}
        onAddMember={onAddMember}
        pos={pos}
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
