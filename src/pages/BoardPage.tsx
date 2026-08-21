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

type UnifiedRowColDef = ColDef<UnifiedRow> & { editField?: string };
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { nextVanCode } from "@contracts/vans";
import type { PoolItem } from "@db/schema";
import type { TaskWithOwners } from "../../api/queries/van";
import MultiSelectCellEditor from "@/components/MultiSelectCellEditor";

ModuleRegistry.registerModules([AllCommunityModule]);

/* ── 稀有度配置 ── */
const RARITIES = [
  "common",
  "uncommon",
  "rare",
  "epic",
  "legendary",
  "mythic",
] as const;
type Rarity = (typeof RARITIES)[number];
const RARITY_LABEL: Record<Rarity, string> = {
  common: "普通",
  uncommon: "优秀",
  rare: "稀有",
  epic: "史诗",
  legendary: "传说",
  mythic: "神话",
};
const RARITY_CLASS: Record<Rarity, string> = {
  common: "",
  uncommon: "text-emerald-600",
  rare: "text-sky-600",
  epic: "text-violet-600",
  legendary: "text-amber-500",
  mythic: "rarity-mythic-text",
};

/** 统一表格行类型：任务 or 委托 */
type UnifiedRow =
  | { kind: "task"; data: TaskWithOwners }
  | { kind: "pool"; data: PoolItem & { postedRounds: number } };

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
  const poolQ = trpc.van.pool.list.useQuery();
  const membersQ = trpc.van.members.list.useQuery();

  const tasks = useMemo(() => tasksQ.data ?? [], [tasksQ.data]);
  const pool = useMemo(() => poolQ.data ?? [], [poolQ.data]);
  const members = useMemo(() => membersQ.data ?? [], [membersQ.data]);
  const stats = statsQ.data;

  const vanIdx = curVan === null ? -1 : vans.indexOf(curVan);
  const refresh = () => utils.invalidate();
  const onError = (e: { message: string }) => toast.error(e.message);

  const failedQ = [tasksQ, statsQ, poolQ, membersQ, vansQ].find(
    (q) => q.isError,
  );
  const refetchAll = () => {
    tasksQ.refetch();
    statsQ.refetch();
    poolQ.refetch();
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

  const addPoolM = trpc.van.pool.add.useMutation({
    onSuccess: () => {
      toast.success("委托已录入");
      refresh();
    },
    onError,
  });

  const updatePoolM = trpc.van.pool.update.useMutation({
    onSuccess: refresh,
    onError: (e) => {
      toast.error(e.message);
      utils.invalidate();
    },
  });

  const takeM = trpc.van.tasks.add.useMutation({
    onSuccess: () => {
      toast.success("已接取");
      refresh();
    },
    onError,
  });

  const removePoolM = trpc.van.pool.remove.useMutation({
    onSuccess: refresh,
    onError,
  });

  const { mutate: removeTask } = removeTaskM;

  /* ── 合并表格数据：委托（open）在前，任务在后 ── */
  const unifiedData = useMemo<UnifiedRow[]>(() => {
    const openPool = pool
      .filter((p) => p.status === "open")
      .map((p): UnifiedRow => ({ kind: "pool", data: p }));
    const taskRows = tasks.map((t): UnifiedRow => ({ kind: "task", data: t }));
    return [...openPool, ...taskRows];
  }, [pool, tasks]);

  /* ── 列定义 ── */
  const memberNames = useMemo(() => members.map((m) => m.name), [members]);

  const columnDefs = useMemo<UnifiedRowColDef[]>(
    () => [
      {
        field: "kind",
        headerName: "标题",
        flex: 2,
        editable: () => true,
        editField: "title",
        cellRenderer: (p: ICellRendererParams<UnifiedRow>) => {
          const d = p.data;
          if (!d) return null;
          if (d.kind === "pool") {
            return (
              <span className={RARITY_CLASS[d.data.rarity]}>
                {d.data.title}
              </span>
            );
          }
          return <span>{d.data.title}</span>;
        },
      },
      // 委托专用列
      {
        colId: "_rarity",
        headerName: "稀有度",
        width: 80,
        editable: (p) => p.data?.kind === "pool",
        editField: "rarity",
        cellEditor: "agSelectCellEditor",
        cellEditorParams: {
          values: RARITIES as unknown as string[],
        },
        valueGetter: (p) => (p.data?.kind === "pool" ? p.data.data.rarity : ""),
        valueSetter: (p) => {
          if (p.data?.kind === "pool") {
            p.data.data.rarity = p.newValue as Rarity;
            return true;
          }
          return false;
        },
        cellRenderer: (p: ICellRendererParams<UnifiedRow>) => {
          const d = p.data;
          if (d?.kind !== "pool") return null;
          return (
            <span className={RARITY_CLASS[d.data.rarity]}>
              {RARITY_LABEL[d.data.rarity]}
            </span>
          );
        },
      },
      {
        colId: "_targetVan",
        headerName: "目标班次",
        width: 100,
        editable: (p) => p.data?.kind === "pool",
        editField: "targetVan",
        valueGetter: (p) =>
          p.data?.kind === "pool" ? (p.data.data.targetVan ?? "") : "",
        valueSetter: (p) => {
          if (p.data?.kind === "pool") {
            p.data.data.targetVan =
              p.newValue === "" ? null : (p.newValue as string);
            return true;
          }
          return false;
        },
      },
      {
        colId: "_postedRounds",
        headerName: "挂账",
        width: 60,
        editable: false,
        valueGetter: (p) =>
          p.data?.kind === "pool" && p.data.data.postedRounds > 0
            ? `${p.data.data.postedRounds}轮`
            : "",
      },

      // 负责人列（多选下拉）
      {
        colId: "_owners",
        headerName: "负责人",
        width: 200,
        editable: (p) => p.data?.kind === "task",
        editField: "owners",
        cellEditor: MultiSelectCellEditor,
        cellEditorParams: {
          members: memberNames,
          onAddMember: (name: string) => addMemberM.mutate({ name }),
        },
        cellRenderer: (p: ICellRendererParams<UnifiedRow>) => {
          const d = p.data;
          if (d?.kind !== "task") return null;
          const owners: string[] = p.value ?? d.data.owners ?? [];
          if (owners.length === 0)
            return (
              <span className="text-xs text-muted-foreground/50">
                点击选择…
              </span>
            );
          return (
            <span className="flex flex-wrap gap-1">
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
        valueGetter: (p) => (p.data?.kind === "task" ? p.data.data.owners : []),
        valueSetter: (p) => {
          if (p.data?.kind === "task") {
            p.data.data.owners = p.newValue as string[];
            return true;
          }
          return false;
        },
      },
      {
        colId: "_size",
        headerName: "档位",
        width: 86,
        editable: (p) => p.data?.kind === "task",
        editField: "size",
        cellEditor: "agSelectCellEditor",
        cellEditorParams: { values: ["1", "3", "5"] },
        valueGetter: (p) =>
          p.data?.kind === "task" ? String(p.data.data.size ?? "") : "",
        valueSetter: (p) => {
          if (p.data?.kind === "task") {
            const v = p.newValue === "" ? null : Number(p.newValue);
            p.data.data.size = v as 1 | 3 | 5 | null;
            return true;
          }
          return false;
        },
        cellRenderer: (p: ICellRendererParams<UnifiedRow>) => {
          const d = p.data;
          if (d?.kind !== "task" || !d.data.size) return null;
          return (
            <span className={`size-badge size-${d.data.size}`}>
              {d.data.size} 天
            </span>
          );
        },
      },
      {
        colId: "_status",
        headerName: "状态",
        width: 100,
        editable: (p) => p.data?.kind === "task",
        editField: "status",
        cellEditor: "agSelectCellEditor",
        cellEditorParams: { values: ["todo", "doing", "done"] },
        valueGetter: (p) =>
          p.data?.kind === "task" ? (p.data.data.status ?? "") : "",
        valueSetter: (p) => {
          if (p.data?.kind === "task") {
            p.data.data.status = p.newValue as typeof p.data.data.status;
            return true;
          }
          return false;
        },
        cellRenderer: (p: ICellRendererParams<UnifiedRow>) => {
          const d = p.data;
          if (d?.kind !== "task" || !d.data.status) return null;
          return (
            <span className={`status-badge status-${d.data.status}`}>
              {d.data.status}
            </span>
          );
        },
      },
      {
        colId: "_doneAt",
        headerName: "送达日期",
        width: 130,
        editable: (p) => p.data?.kind === "task",
        editField: "doneAt",
        cellEditor: "agDateCellEditor",
        cellEditorParams: {
          min: "2020-01-01",
          max: "2030-12-31",
        },
        valueGetter: (p) =>
          p.data?.kind === "task" ? (p.data.data.doneAt ?? "") : "",
        valueSetter: (p) => {
          if (p.data?.kind === "task") {
            const val = p.newValue;
            if (val === "" || val == null) {
              p.data.data.doneAt = null;
            } else if (val instanceof Date) {
              // YYYY-MM-DD
              p.data.data.doneAt = val.toISOString().slice(0, 10);
            } else {
              p.data.data.doneAt = String(val) || null;
            }
            return true;
          }
          return false;
        },
        cellRenderer: (p: ICellRendererParams<UnifiedRow>) => {
          const d = p.data;
          if (d?.kind !== "task" || !d.data.doneAt) return null;
          return <span className="text-sm">📅 {d.data.doneAt}</span>;
        },
      },
      {
        colId: "_acceptance",
        headerName: "验收标准",
        flex: 1.4,
        editable: (p) => p.data?.kind === "task",
        editField: "acceptance",
        valueGetter: (p) =>
          p.data?.kind === "task" ? (p.data.data.acceptance ?? "") : "",
        valueSetter: (p) => {
          if (p.data?.kind === "task") {
            p.data.data.acceptance = p.newValue as string | null;
            return true;
          }
          return false;
        },
      },
      {
        colId: "_note",
        headerName: "备注",
        flex: 1,
        editable: (p) => p.data?.kind === "task",
        editField: "note",
        valueGetter: (p) =>
          p.data?.kind === "task" ? (p.data.data.note ?? "") : "",
        valueSetter: (p) => {
          if (p.data?.kind === "task") {
            p.data.data.note = p.newValue as string | null;
            return true;
          }
          return false;
        },
      },
      // 结转记录列
      {
        headerName: "结转记录",
        width: 120,
        editable: false,
        valueGetter: (p) => {
          if (p.data?.kind !== "task") return "";
          const t = p.data.data;
          if (!t.carriedFrom) return "";
          return `${t.carriedFrom} →`;
        },
        cellRenderer: (p: ICellRendererParams<UnifiedRow>) => {
          const d = p.data;
          if (d?.kind !== "task" || !d.data.carriedFrom) return null;
          const t = d.data;
          return (
            <span className="flex items-center gap-1 text-xs">
              <span className="carry-badge" title={`滞留自 ${t.carriedFrom}`}>
                📦 {t.carriedFrom}
              </span>
              {t.carryCount >= 2 && (
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
        width: 100,
        cellRenderer: (p: ICellRendererParams<UnifiedRow>) => {
          const d = p.data;
          if (!d) return null;
          if (d.kind === "pool") {
            return (
              <div className="flex gap-1">
                <button
                  className="btn btn-ghost text-xs"
                  disabled={curVan === null}
                  title={curVan === null ? "请先发新车" : `接取到 ${curVan}`}
                  onClick={() =>
                    curVan !== null &&
                    takeM.mutate({
                      van: curVan,
                      title: d.data.title,
                      poolItemId: d.data.id,
                    })
                  }
                >
                  接取
                </button>
                <button
                  className="btn btn-danger text-xs"
                  onClick={() =>
                    window.confirm(`删除委托「${d.data.title}」？`) &&
                    removePoolM.mutate({ id: d.data.id })
                  }
                >
                  删除
                </button>
              </div>
            );
          }
          return (
            <button
              className="btn btn-danger text-xs"
              onClick={() => {
                if (d.data && window.confirm(`删除快件「${d.data.title}」？`)) {
                  removeTask({ id: d.data.id });
                }
              }}
            >
              删除
            </button>
          );
        },
      },
    ],
    [memberNames, curVan, takeM, removePoolM, removeTask, addMemberM],
  );

  /* ── 单元格编辑回调 ── */
  const onCellValueChanged = (e: CellValueChangedEvent<UnifiedRow>) => {
    const d = e.data;
    if (!d) return;

    // 委托行：更新 pool_items
    if (d.kind === "pool") {
      const key = (e.colDef as UnifiedRowColDef).editField;
      if (!key) return;
      let value: unknown = e.newValue;
      if (value === "" || value === undefined) value = null;
      updatePoolM.mutate({ id: d.data.id, [key]: value } as Parameters<
        typeof updatePoolM.mutate
      >[0]);
      return;
    }

    // 快件行：更新 tasks
    const task = d.data;
    const key = (e.colDef as UnifiedRowColDef).editField;
    if (!key) return;
    let value: unknown = e.newValue;

    if (key === "size") {
      value = value === "" || value == null ? null : Number(value);
    }
    if (key === "doneAt") {
      // agDateCellEditor 可能返回 Date 对象，需统一转为 YYYY-MM-DD 字符串
      if (value instanceof Date) {
        value = value.toISOString().slice(0, 10);
      }
      if (value === "" || value == null) {
        value = null;
      } else if (!DATE_RE.test(String(value))) {
        toast.error("送达日期格式应为 YYYY-MM-DD");
        utils.invalidate();
        return;
      }
    }
    if (key === "acceptance" || key === "note") {
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
                      {RARITY_LABEL[r.rarity as Rarity] ?? r.rarity} {r.done}/
                      {r.total}
                    </span>
                  ))
                : "–"}
            </div>
          </div>
          {/* 快捷操作 */}
          <div className="ml-auto flex items-center gap-2">
            <button
              className="btn btn-glass px-4 py-2 text-sm"
              disabled={curVan === null}
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

        {/* ── 表格 ── */}

        {/* ── 主表格：委托 + 快件统一展示 ── */}
        <div className="glass-card mb-6 p-2">
          <div style={{ height: 520 }}>
            <AgGridReact<UnifiedRow>
              theme={themeQuartz}
              rowData={unifiedData}
              columnDefs={columnDefs}
              defaultColDef={{ sortable: true, resizable: true }}
              loading={tasksQ.isLoading || poolQ.isLoading}
              onCellValueChanged={onCellValueChanged}
              getRowClass={(p) => {
                if (p.data?.kind === "task" && p.data.data.carryCount >= 2)
                  return "bg-amber-50/60";
                if (p.data?.kind === "pool") return "bg-orange-50/40";
                return "";
              }}
              getRowId={(p) =>
                p.data.kind === "task"
                  ? `task-${p.data.data.id}`
                  : `pool-${p.data.data.id}`
              }
              localeText={{
                noRowsToShow: "还没有委托或快件，点右下角 + 添加",
              }}
            />
          </div>
          {/* 表格底部新建栏 */}
          <div className="flex items-center gap-2 border-t border-white/30 px-3 py-2">
            <button
              className="btn btn-ghost flex items-center gap-1 px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground"
              disabled={curVan === null || addTaskM.isPending}
              title="在表格末尾新增一行快件"
              onClick={() => {
                if (!curVan) return;
                addTaskM.mutate(
                  { van: curVan, title: "新快件" },
                  {
                    onSuccess: () => {
                      // 刷新后自动进入最后一行的标题编辑
                      toast.success("已添加，点击标题可编辑");
                    },
                  },
                );
              }}
            >
              + 快件
            </button>
            <button
              className="btn btn-ghost flex items-center gap-1 px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground"
              disabled={addPoolM.isPending}
              title="在表格末尾新增一行委托"
              onClick={() => {
                addPoolM.mutate(
                  { title: "新委托", rarity: "common", targetVan: curVan },
                  {
                    onSuccess: () => {
                      toast.success("已添加，点击标题可编辑");
                    },
                  },
                );
              }}
            >
              + 委托
            </button>
          </div>
        </div>

        {/* ── 成员运力统计（从标签自动聚合） ── */}
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
