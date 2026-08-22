/* eslint-disable react-refresh/only-export-components -- AG Grid 单元格编辑器类适配器，非 React 组件，不参与 fast-refresh */
import { createPopupCellEditor } from "./popupCellEditor";
import RequesterSelect from "./RequesterSelect";

/**
 * 提出人下拉编辑器：单选成员，支持就地添加新成员。
 * 使用 Portal 渲染下拉面板到 body。
 */
export default createPopupCellEditor<string>({
  getInitial: (params) => params.value ?? "",
  render: ({ params, initial, pos, onChange, onClose }) => (
    <RequesterSelect
      initial={initial}
      members={params.members ?? []}
      onAddMember={params.onAddMember}
      pos={pos}
      onChange={onChange}
      onClose={onClose}
    />
  ),
});
