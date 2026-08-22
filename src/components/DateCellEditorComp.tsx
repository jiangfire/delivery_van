/* eslint-disable react-refresh/only-export-components -- AG Grid 单元格编辑器类适配器，非 React 组件，不参与 fast-refresh */
import { createPopupCellEditor } from "./popupCellEditor";
import DateCellEditor from "./DateCellEditor";

/**
 * 送达日期单元格编辑器（AG Grid ICellEditorComp 适配）。
 * 使用 Portal 渲染日期选择弹框到 body。
 */
export default createPopupCellEditor<string>({
  getInitial: (params) => params.value ?? "",
  render: ({ initial, pos, onClose }) => (
    <DateCellEditor
      initial={initial}
      pos={pos}
      onClose={(v) => onClose(v ?? "")}
    />
  ),
});
