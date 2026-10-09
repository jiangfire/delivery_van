/* eslint-disable react-refresh/only-export-components -- AG Grid 单元格编辑器类适配器，非 React 组件，不参与 fast-refresh */
import { createPopupCellEditor } from "./popupCellEditor";
import MultiSelectEditor, { type OwnerDraft } from "./MultiSelectEditor";

/**
 * AG Grid 自定义单元格编辑器：成员多选 + 每人各自的点数 + 逐人完成日期（v2.6）。
 * 使用 Portal 渲染下拉面板到 body，逃出 backdrop-filter 层叠上下文。
 */
export default createPopupCellEditor<OwnerDraft[]>({
  getInitial: (params) =>
    Array.isArray(params.value) ? [...params.value] : [],
  render: ({ params, initial, pos, onChange, onClose }) => (
    <MultiSelectEditor
      initial={initial}
      members={params.members ?? []}
      loadByMember={params.loadByMember}
      onAddMember={params.onAddMember}
      pos={pos}
      onChange={onChange}
      onClose={onClose}
    />
  ),
});
