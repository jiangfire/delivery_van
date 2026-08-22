/* eslint-disable react-refresh/only-export-components -- AG Grid 单元格编辑器类适配器，非 React 组件，不参与 fast-refresh */
import { createPopupCellEditor } from "./popupCellEditor";
import RarityEditor from "./RarityEditor";

/**
 * 稀有度下拉编辑器：显示大写英文缩写（N/R/SR/SSR/UR），返回小写存储值。
 * 使用 Portal 渲染下拉面板到 body。
 */
export default createPopupCellEditor<string>({
  getInitial: (params) => params.value ?? "n",
  render: ({ initial, pos, onChange, onClose }) => (
    <RarityEditor
      initial={initial}
      pos={pos}
      onChange={onChange}
      onClose={onClose}
    />
  ),
});
