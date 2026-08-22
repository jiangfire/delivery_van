import { useMemo, useState } from "react";
import { AgGridReact } from "ag-grid-react";
import {
  AllCommunityModule,
  ModuleRegistry,
  themeQuartz,
  type ColDef,
  type ICellRendererParams,
  type CellValueChangedEvent,
} from "ag-grid-community";

type TaskColDef = ColDef<TaskRow> & { editField?: string };
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { nextVanCode } from "@contracts/vans";
import type { TaskWithOwners } from "../../api/queries/van";
import MultiSelectCellEditor from "@/components/MultiSelectCellEditor";
import RarityCellEditor from "@/components/RarityCellEditor";
import RequesterCellEditor from "@/components/RequesterCellEditor";
import DateCellEditorComp from "@/components/DateCellEditorComp";

ModuleRegistry.registerModules([AllCommunityModule]);

/* ── 稀有度配置：N/R/SR/SSR/UR，展示统一大写英文缩写 ── */
type Rarity = "n" | "r" | "sr" | "ssr" | "ur";
const RARITY_CLASS: Record<Rarity, string> = {
  n: "",
  r: "text-emerald-600",
  sr: "text-sky-600",
  ssr: "text-violet-600",
  ur: "rarity-ur-text",
};

type TaskRow = TaskWithOwners;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export default function BoardPage() {
  const [van, setVan] = useState<string | null>(null);
  const utils = trpc.useUtils();

  const vansQ = trpc.van.vans.list.useQuery();
  const vans = useMemo(() => vansQ.data ?? [], [vansQ.data]);
  const curVan = van !== null && vans.includes(van) ? van : (vans[0] ?? null);

  const tasksQ = trpc.van.tasks.byVan.useQuery(
    { van: curVan ?? "" },
    { enabled: curVan !== null },
  );
  const statsQ = trpc.van.stats.byVan.useQuery(
    { van: curVan ?? "" },
    { enabled: curVan !== null },
  );
  const membersQ = trpc.van.members.list.useQuery();

  const tasks = useMemo(() => tasksQ.data ?? [], [tasksQ.data]);
  const members = useMemo(() => membersQ.data ?? [], [membersQ.data]);
  const stats = statsQ.data;
  /** 当前班次是否已结转归档（存在 carried 任务）→ 整班只读 */
  const vanArchived = useMemo(
    () => tasks.some((t) => t.status === "carried"),
    [tasks],
  );
  /**
   * 操作禁用口径 = 归档 或 数据未到位。归档是单向的（结转过就不会变回），
   * 切班后无缓存数据的加载窗口里保守视为只读，避免按钮短暂可点；
   * 已访问过的班次有缓存（哪怕过期），归档判定依然正确。
   */
  const vanReadonly = vanArchived || tasksQ.isLoading;

  const vanIdx = curVan === null ? -1 : vans.indexOf(curVan);
  const refresh = () => utils.invalidate();
  const onError = (e: { message: string }) => toast.error(e.message);

  const failedQ = [tasksQ, statsQ, membersQ, vansQ].find((q) => q.isError);
  const refetchAll = () => {
    tasksQ.refetch();
    statsQ.refetch();
    membersQ.refetch();
    vansQ.refetch();
  };

  const addMemberM = trpc.van.members.add.useMutation({
    onSuccess: () => {
      toast.success("成员已添加");
      refresh();
    },
    onError,
  });

  /* ── mutations ── */
  const dispatchM = trpc.van.vans.dispatch.useMutation({
    onSuccess: (list) => {
      setVan(list[0] ?? null);
      toast.success(`新班车 ${list[0]} 已发出`);
      refresh();
    },
    onError,
  });

  const updateTaskM = trpc.van.tasks.update.useMutation({
    onSuccess: refresh,
    onError: (e) => {
      toast.error(e.message);
      utils.invalidate();
    },
  });

  const addTaskM = trpc.van.tasks.add.useMutation({
    onSuccess: refresh,
    onError,
  });

  const removeTaskM = trpc.van.tasks.remove.useMutation({
    onSuccess: refresh,
    onError,
  });

  const carryM = trpc.van.carry.run.useMutation({
    onSuccess: (r) => {
      toast.success(
        r.carried > 0
          ? `已把 ${r.carried} 个滞留件转上下一班车`
          : "本班次全部送达，没有滞留件",
      );
      refresh();
    },
    onError,
  });

  const { mutate: removeTask } = removeTaskM;
  const { mutate: addMember } = addMemberM;

  /* ── 列定义 ── */
  const memberNames = useMemo(() => members.map((m) => m.name), [members]);

  // columnDefs 引用必须稳定：AG Grid 收到新数组会重建列并销毁正在编辑的编辑器。
  // 成员列表按「内容」记忆（后台刷新不改内容时保持原引用），编辑参数延迟到编辑时求值。
  const memberNamesKey = memberNames.join("\n");
  const columnDefs = useMemo<TaskColDef[]>(
    () => [
      {
        field: "title",
        headerName: "标题",
        flex: 2,
        editable: !vanReadonly,
        editField: "title",
        cellRenderer: (p: ICellRendererParams<TaskRow>) => {
          const d = p.data;
          if (!d) return null;
          return <span className={RARITY_CLASS[d.rarity]}>{d.title}</span>;
        },
      },
      {
        colId: "_rarity",
        headerName: "稀有度",
        width: 80,
        editable: !vanReadonly,
        editField: "rarity",
        cellEditor: RarityCellEditor,
        valueGetter: (p) => p.data?.rarity ?? "",
        valueSetter: (p) => {
          if (p.data) {
            p.data.rarity = p.newValue as Rarity;
            return true;
          }
          return false;
        },
        cellRenderer: (p: ICellRendererParams<TaskRow>) => {
          const d = p.data;
          if (!d) return null;
          return (
            <span className={RARITY_CLASS[d.rarity]}>
              {d.rarity.toUpperCase()}
            </span>
          );
        },
      },
      // 提出人列
      {
        colId: "_requester",
        headerName: "提出人",
        width: 90,
        editable: !vanReadonly,
        editField: "requester",
        cellEditor: RequesterCellEditor,
        cellEditorParams: () => ({
          members: memberNames,
          onAddMember: (name: string) => addMember({ name }),
        }),
        valueGetter: (p) => p.data?.requester ?? "",
        valueSetter: (p) => {
          if (p.data) {
            p.data.requester = (p.newValue as string) || null;
            return true;
          }
          return false;
        },
        cellRenderer: (p: ICellRendererParams<TaskRow>) => {
          const d = p.data;
          if (!d?.requester) return null;
          return <span className="text-sm">{d.requester}</span>;
        },
      },
      {
        colId: "_owners",
        headerName: "负责人",
        width: 200,
        editable: !vanReadonly,
        editField: "owners",
        cellEditor: MultiSelectCellEditor,
        cellEditorParams: () => ({
          members: memberNames,
          onAddMember: (name: string) => addMember({ name }),
        }),
        cellRenderer: (p: ICellRendererParams<TaskRow>) => {
          const d = p.data;
          if (!d) return null;
          const owners: string[] = p.value ?? d.owners ?? [];
          if (owners.length === 0)
            return (
              <span className="text-xs text-muted-foreground/50">
                点击选择…
              </span>
            );
          return (
            <span className="flex h-full flex-wrap items-center content-center gap-1">
              {owners.map((o) => (
                <span
                  key={o}
                  className="inline-block rounded-lg px-2 py-0.5 text-xs font-medium"
                  style={{
                    background: "rgba(14, 165, 233, 0.1)",
                    color: "#0ea5e9",
                    border: "1px solid rgba(14, 165, 233, 0.15)",
                  }}
                >
                  {o}
                </span>
              ))}
            </span>
          );
        },
        valueGetter: (p) => p.data?.owners ?? [],
        valueSetter: (p) => {
          if (p.data) {
            p.data.owners = p.newValue as string[];
            return true;
          }
          return false;
        },
      },
      {
        colId: "_size",
        headerName: "档位",
        width: 86,
        editable: !vanReadonly,
        editField: "size",
        cellEditor: "agSelectCellEditor",
        cellEditorParams: { values: ["1", "3", "5"] },
        valueGetter: (p) => String(p.data?.size ?? ""),
        valueSetter: (p) => {
          if (p.data) {
            const v = p.newValue === "" ? null : Number(p.newValue);
            p.data.size = v as 1 | 3 | 5 | null;
            return true;
          }
          return false;
        },
        cellRenderer: (p: ICellRendererParams<TaskRow>) => {
          const d = p.data;
          if (!d || !d.size) return null;
          return (
            <span className={`size-badge size-${d.size}`}>{d.size} 天</span>
          );
        },
      },
      {
        colId: "_status",
        headerName: "状态",
        width: 100,
        editable: !vanReadonly,
        editField: "status",
        cellEditor: "agSelectCellEditor",
        cellEditorParams: { values: ["todo", "doing", "done"] },
        valueGetter: (p) => p.data?.status ?? "",
        valueSetter: (p) => {
          if (p.data) {
            p.data.status = p.newValue as typeof p.data.status;
            return true;
          }
          return false;
        },
        cellRenderer: (p: ICellRendererParams<TaskRow>) => {
          const d = p.data;
          if (!d || !d.status) return null;
          return (
            <span className={`status-badge status-${d.status}`}>
              {d.status === "carried" ? "🔁 结转" : d.status}
            </span>
          );
        },
      },
      {
        colId: "_doneAt",
        headerName: "送达日期",
        width: 130,
        editable: (p) => !vanReadonly && p.data?.status === "done",
        editField: "doneAt",
        cellEditor: DateCellEditorComp,
        valueGetter: (p) => p.data?.doneAt ?? "",
        valueSetter: (p) => {
          if (p.data) {
            const val = p.newValue;
            if (val === "" || val == null) {
              p.data.doneAt = null;
            } else if (val instanceof Date) {
              // 用本地日期组件，不用 toISOString()（那是 UTC 时间，会偏移）
              p.data.doneAt = `${val.getFullYear()}-${String(val.getMonth() + 1).padStart(2, "0")}-${String(val.getDate()).padStart(2, "0")}`;
            } else {
              p.data.doneAt = String(val) || null;
            }
            return true;
          }
          return false;
        },
        cellRenderer: (p: ICellRendererParams<TaskRow>) => {
          const d = p.data;
          if (!d) return null;
          if (!d.doneAt) {
            return d.status !== "done" ? (
              <span className="text-xs text-muted-foreground/40">
                完成后填写
              </span>
            ) : null;
          }
          return <span className="text-sm">📅 {d.doneAt}</span>;
        },
      },
      {
        colId: "_acceptance",
        headerName: "验收标准",
        flex: 1.4,
        editable: !vanReadonly,
        editField: "acceptance",
        valueGetter: (p) => p.data?.acceptance ?? "",
        valueSetter: (p) => {
          if (p.data) {
            p.data.acceptance = p.newValue as string | null;
            return true;
          }
          return false;
        },
      },
      {
        colId: "_note",
        headerName: "备注",
        flex: 1,
        editable: !vanReadonly,
        editField: "note",
        valueGetter: (p) => p.data?.note ?? "",
        valueSetter: (p) => {
          if (p.data) {
            p.data.note = p.newValue as string | null;
            return true;
          }
          return false;
        },
      },
      // 结转记录列
      {
        colId: "_carry",
        headerName: "结转记录",
        width: 120,
        editable: false,
        valueGetter: (p) => {
          const t = p.data;
          if (!t?.carriedFrom) return "";
          return `${t.carriedFrom} →`;
        },
        cellRenderer: (p: ICellRendererParams<TaskRow>) => {
          const d = p.data;
          if (!d || !d.carriedFrom) return null;
          return (
            <span className="flex h-full items-center gap-1 text-xs">
              <span className="carry-badge" title={`滞留自 ${d.carriedFrom}`}>
                📦 {d.carriedFrom}
              </span>
              {d.carryCount >= 2 && (
                <span
                  className="text-amber-500 font-bold"
                  title="连续滞留 ≥2 班，需复盘"
                >
                  ⚠️
                </span>
              )}
            </span>
          );
        },
      },
      // 操作列
      {
        headerName: "",
        width: 60,
        cellRenderer: (p: ICellRendererParams<TaskRow>) => {
          const d = p.data;
          if (!d) return null;
          return (
            <button
              className="btn btn-danger text-xs"
              disabled={vanReadonly}
              title={vanArchived ? "班次已结转归档，不可删除" : undefined}
              onClick={() => {
                if (window.confirm(`删除快件「${d.title}」？`)) {
                  removeTask({ id: d.id });
                }
              }}
            >
              删除
            </button>
          );
        },
      },
    ],
    [
      memberNamesKey,
      memberNames,
      removeTask,
      addMember,
      vanReadonly,
      vanArchived,
    ],
  );

  /* ── 单元格编辑回调 ── */
  const onCellValueChanged = (e: CellValueChangedEvent<TaskRow>) => {
    const task = e.data;
    if (!task) return;

    // 优先用 colId 映射，兜底用 editField
    const colId = e.column.getId();
    const colIdMap: Record<string, string> = {
      _rarity: "rarity",
      _requester: "requester",
      _owners: "owners",
      _size: "size",
      _status: "status",
      _doneAt: "doneAt",
      _acceptance: "acceptance",
      _note: "note",
      title: "title",
    };
    const key = colIdMap[colId] ?? (e.colDef as TaskColDef).editField;
    if (!key) return;
    let value: unknown = e.newValue;

    if (key === "size") {
      value = value === "" || value == null ? null : Number(value);
    }
    if (key === "doneAt") {
      if (value instanceof Date) {
        // 用本地日期组件，不用 toISOString()（那是 UTC 时间，会偏移）
        value = `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
      }
      if (value === "" || value == null) {
        value = null;
      } else if (!DATE_RE.test(String(value))) {
        toast.error("送达日期格式应为 YYYY-MM-DD");
        utils.invalidate();
        return;
      }
    }
    if (key === "acceptance" || key === "note" || key === "requester") {
      if (value === "" || value === undefined) value = null;
    }

    updateTaskM.mutate({ id: task.id, [key]: value } as Parameters<
      typeof updateTaskM.mutate
    >[0]);
  };

  return (
    <div className="aurora-bg">
      <div className="relative z-10 mx-auto max-w-[1400px] px-8 py-8">
        {/* ── 头部 ── */}
        <header className="glass-card mb-6 flex flex-wrap items-center justify-between gap-4 px-6 py-4">
          <div className="flex items-center gap-3">
            <span className="led led-blue" />
            <h1 className="text-lg font-bold tracking-wide">快递发车台</h1>
            {vansQ.data !== undefined && vans.length === 0 ? (
              <span className="text-sm text-muted-foreground">
                还没有班车，点右侧「发新车」
              </span>
            ) : (
              <div className="glass-sm flex items-center gap-1 px-2 py-1">
                <button
                  className="btn btn-ghost px-2 py-0.5 text-sm"
                  disabled={vanIdx < 0 || vanIdx >= vans.length - 1}
                  onClick={() => setVan(vans[vanIdx + 1])}
                >
                  ‹
                </button>
                <span className="px-1 font-mono text-sm font-bold">
                  {curVan ?? "——"}
                </span>
                <button
                  className="btn btn-ghost px-2 py-0.5 text-sm"
                  disabled={vanIdx <= 0}
                  onClick={() => setVan(vans[vanIdx - 1])}
                >
                  ›
                </button>
                {curVan !== null && (
                  <select
                    className="select-liquid ml-1 bg-transparent px-2 py-0.5 font-mono text-xs"
                    value={curVan}
                    onChange={(e) => setVan(e.target.value)}
                  >
                    {vans.map((v) => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))}
                  </select>
                )}
                {vanArchived && (
                  <span
                    className="carry-badge ml-2"
                    title="结转后整班归档只读，如需调整请在最新班次操作"
                  >
                    已结转 · 归档
                  </span>
                )}
              </div>
            )}
          </div>
          <button
            className="btn btn-primary px-4 py-2 text-sm"
            disabled={dispatchM.isPending}
            onClick={() => dispatchM.mutate({})}
          >
            发新车
          </button>
        </header>

        {failedQ && (
          <div className="glass-card mb-6 flex items-center justify-between gap-4 border-red-200/50 px-5 py-3 text-sm text-red-600">
            <span>数据加载失败：{failedQ.error.message}</span>
            <button
              className="btn btn-glass shrink-0 border-red-200 px-3 py-1 text-red-600 hover:bg-red-50"
              onClick={refetchAll}
            >
              重试
            </button>
          </div>
        )}

        {/* ── 统计条 ── */}
        <div className="glass-card mb-6 flex flex-wrap items-center gap-8 px-6 py-5">
          <Stat
            label="未送达 / 共"
            value={stats ? `${stats.remaining} / ${stats.total} 件` : "–"}
          />
          <Stat
            label="送达率"
            value={
              stats?.completionRate == null
                ? "–"
                : `${Math.round(stats.completionRate * 100)}%`
            }
          />
          <Stat
            label="滞留率"
            value={
              stats?.carryRate == null
                ? "–"
                : `${Math.round(stats.carryRate * 100)}%`
            }
          />
          <Stat
            label="强制复盘"
            value={stats ? `${stats.reviewNeeded} 个` : "–"}
            tone={stats && stats.reviewNeeded > 0 ? "warn" : undefined}
          />
          {/* 稀有度构成 */}
          <div>
            <div className="label-caps">稀有度构成</div>
            <div className="text-base font-bold">
              {stats && stats.rarity.length > 0
                ? stats.rarity.map((r, i) => (
                    <span
                      key={r.rarity}
                      className={RARITY_CLASS[r.rarity as Rarity] ?? ""}
                    >
                      {i > 0 && (
                        <span className="text-muted-foreground"> · </span>
                      )}
                      {(r.rarity as Rarity).toUpperCase()} {r.done}/{r.total}
                    </span>
                  ))
                : "–"}
            </div>
          </div>
          {/* 快捷操作 */}
          <div className="ml-auto flex items-center gap-2">
            <button
              className="btn btn-glass px-4 py-2 text-sm"
              disabled={curVan === null || vanReadonly || addTaskM.isPending}
              title={
                vanArchived
                  ? "班次已结转归档，不可新增快件"
                  : "在本班次末尾新增一行快件"
              }
              onClick={() => {
                if (!curVan) return;
                addTaskM.mutate(
                  { van: curVan, title: "新快件" },
                  {
                    onSuccess: () => {
                      toast.success("已添加，点击标题可编辑");
                    },
                  },
                );
              }}
            >
              + 快件
            </button>
            <button
              className="btn btn-glass px-4 py-2 text-sm"
              disabled={curVan === null || vanReadonly}
              title={vanArchived ? "本班次已结转过，请勿重复操作" : undefined}
              onClick={() => {
                if (curVan === null) return;
                const toVan = nextVanCode(curVan);
                if (window.confirm(`把 ${curVan} 的滞留件转到下一班车？`)) {
                  carryM.mutate({ fromVan: curVan, toVan });
                }
              }}
            >
              滞留件转下一班
            </button>
          </div>
        </div>

        {/* ── 快件表格 ── */}
        <div className="glass-card mb-6 p-2" style={{ isolation: "isolate" }}>
          <div style={{ height: 520 }}>
            <AgGridReact<TaskRow>
              theme={themeQuartz}
              rowData={tasks}
              columnDefs={columnDefs}
              defaultColDef={{ sortable: true, resizable: true }}
              loading={tasksQ.isLoading}
              onCellValueChanged={onCellValueChanged}
              getRowClass={(p) => {
                if (p.data && p.data.carryCount >= 2) return "bg-amber-50/60";
                return "";
              }}
              getRowId={(p) => `task-${p.data.id}`}
              localeText={{
                noRowsToShow: "还没有快件，点上方「+ 快件」添加",
              }}
            />
          </div>
        </div>

        {/* ── 成员运力统计 ── */}
        {stats && stats.members.length > 0 && (
          <section className="glass-card p-5">
            <h2 className="mb-4 text-sm font-bold">
              成员运力{" "}
              <span className="text-xs font-normal text-muted-foreground">
                （按标签自动统计）
              </span>
            </h2>
            <ul className="space-y-3">
              {stats.members.map((m) => {
                const overloaded = m.assigned > m.capacity;
                return (
                  <li
                    key={m.name}
                    className="glass-sm flex items-center gap-4 px-4 py-3 text-sm"
                  >
                    <span className="w-20 truncate font-semibold">
                      {m.name}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      运力 {m.capacity} 天
                    </span>
                    <span
                      className={`flex-1 text-xs ${overloaded ? "font-bold text-red-500" : "text-muted-foreground"}`}
                    >
                      已装 {m.assigned} 天 · {m.taskCount} 件 · 送达 {m.done} ·
                      滞留 {m.carriedIn}
                      {overloaded && "（超载！）"}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "warn";
}) {
  return (
    <div>
      <div className="label-caps">{label}</div>
      <div
        className={`text-base font-bold ${tone === "warn" ? "text-amber-500" : ""}`}
      >
        {value}
      </div>
    </div>
  );
}
