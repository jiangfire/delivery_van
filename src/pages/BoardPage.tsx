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
import TagCellEditor from "@/components/TagCellEditor";

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
  uncommon: "text-green-600",
  rare: "text-blue-600",
  epic: "text-purple-600",
  legendary: "text-orange-500",
  mythic: "rarity-mythic-text",
};

/** 统一表格行类型：任务 or 委托 */
type UnifiedRow =
  | { kind: "task"; data: TaskWithOwners }
  | { kind: "pool"; data: PoolItem & { postedRounds: number } };

const POOL_STATUS_LABEL: Record<PoolItem["status"], string> = {
  open: "待切片",
  scheduled: "已排期",
  done: "已完成",
};

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

  /* ── 新建表单状态 ── */
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newPoolTitle, setNewPoolTitle] = useState("");
  const [newPoolRarity, setNewPoolRarity] = useState<Rarity>("common");

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
        headerName: "类型",
        width: 70,
        cellRenderer: (q: ICellRendererParams<UnifiedRow>) =>
          q.data?.kind === "pool" ? (
            <span className="text-xs font-bold text-amber-600">委托</span>
          ) : (
            <span className="text-xs text-muted-foreground">快件</span>
          ),
        sortable: false,
        editable: false,
      },
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
          return (
            <span className="inline-flex items-center gap-2">
              <span>{d.data.title}</span>
              {d.data.carriedFrom && (
                <span
                  className="carry-badge"
                  title={`滞留自 ${d.data.carriedFrom}`}
                >
                  📦 滞留
                  {d.data.carryCount >= 2
                    ? ` ×${d.data.carryCount} 需复盘`
                    : ""}
                </span>
              )}
            </span>
          );
        },
      },
      // 委托专用列
      {
        headerName: "稀有度",
        width: 80,
        editable: false,
        valueGetter: (p) =>
          p.data?.kind === "pool" ? RARITY_LABEL[p.data.data.rarity] : "",
        cellRenderer: (p: ICellRendererParams<UnifiedRow>) => {
          const d = p.data;
          if (d?.kind !== "pool") return null;
          return <span className={RARITY_CLASS[d.data.rarity]}>{p.value}</span>;
        },
      },
      {
        headerName: "目标班次",
        width: 100,
        editable: false,
        valueGetter: (p) =>
          p.data?.kind === "pool" ? (p.data.data.targetVan ?? "") : "",
      },
      {
        headerName: "挂账",
        width: 60,
        editable: false,
        valueGetter: (p) =>
          p.data?.kind === "pool" && p.data.data.postedRounds > 0
            ? `${p.data.data.postedRounds}轮`
            : "",
      },
      {
        headerName: "大厅状态",
        width: 80,
        editable: false,
        valueGetter: (p) =>
          p.data?.kind === "pool" ? POOL_STATUS_LABEL[p.data.data.status] : "",
      },
      // 任务专用列
      {
        field: "kind",
        headerName: "负责人",
        width: 200,
        editable: (p) => p.data?.kind === "task",
        editField: "owners",
        cellEditor: TagCellEditor,
        cellEditorParams: { members: memberNames },
        cellRenderer: (p: ICellRendererParams<UnifiedRow>) => {
          const d = p.data;
          if (d?.kind !== "task") return null;
          const owners: string[] = p.value ?? d.data.owners ?? [];
          return (
            <span className="flex flex-wrap gap-1">
              {owners.map((o) => (
                <span
                  key={o}
                  className="inline-block rounded bg-blue-100 px-1.5 py-0.5 text-xs text-blue-700"
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
        field: "kind",
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
        field: "kind",
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
        field: "kind",
        headerName: "送达日期",
        width: 104,
        editable: (p) => p.data?.kind === "task",
        editField: "doneAt",
        valueGetter: (p) =>
          p.data?.kind === "task" ? (p.data.data.doneAt ?? "") : "",
        valueSetter: (p) => {
          if (p.data?.kind === "task") {
            p.data.data.doneAt = p.newValue as string | null;
            return true;
          }
          return false;
        },
      },
      {
        field: "kind",
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
        field: "kind",
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
                  className="text-xs text-gray-400 hover:text-foreground disabled:opacity-40"
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
                  className="text-xs text-gray-400 hover:text-red-500"
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
              className="text-xs text-gray-400 hover:text-red-500"
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
    [memberNames, curVan, takeM, removePoolM, removeTask],
  );

  /* ── 单元格编辑回调 ── */
  const onCellValueChanged = (e: CellValueChangedEvent<UnifiedRow>) => {
    const d = e.data;
    if (!d || d.kind !== "task") return;
    const task = d.data;
    // 用列定义上的 editField 而非 headerName，避免中文标题变更导致映射失效
    const key = (e.colDef as UnifiedRowColDef).editField;
    if (!key) return;
    let value: unknown = e.newValue;

    if (key === "size") {
      value = value === "" || value == null ? null : Number(value);
    }
    if (key === "doneAt") {
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
    <div className="mx-auto max-w-[1400px] px-6 py-5">
      {/* ── 头部 ── */}
      <header className="mb-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="led led-blue" />
          <h1 className="text-lg font-bold tracking-wide">快递发车台</h1>
          {vansQ.data !== undefined && vans.length === 0 ? (
            <span className="text-sm text-muted-foreground">
              还没有班车，点右侧「发新车」
            </span>
          ) : (
            <div className="flex items-center gap-1 rounded-md border border-border bg-card px-1 py-0.5">
              <button
                className="px-2 text-gray-400 hover:text-foreground disabled:opacity-30"
                disabled={vanIdx < 0 || vanIdx >= vans.length - 1}
                onClick={() => setVan(vans[vanIdx + 1])}
              >
                ‹
              </button>
              <span className="px-1 font-mono text-sm font-bold">
                {curVan ?? "——"}
              </span>
              <button
                className="px-2 text-gray-400 hover:text-foreground disabled:opacity-30"
                disabled={vanIdx <= 0}
                onClick={() => setVan(vans[vanIdx - 1])}
              >
                ›
              </button>
              {curVan !== null && (
                <select
                  className="ml-1 rounded border border-border bg-background px-1 py-0.5 font-mono text-xs"
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
          className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:opacity-90 disabled:opacity-40"
          disabled={dispatchM.isPending}
          onClick={() => dispatchM.mutate({})}
        >
          发新车
        </button>
      </header>

      {failedQ && (
        <div className="mb-4 flex items-center justify-between gap-4 rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-600">
          <span>数据加载失败：{failedQ.error.message}</span>
          <button
            className="shrink-0 rounded border border-red-300 px-2 py-0.5 hover:bg-red-100"
            onClick={refetchAll}
          >
            重试
          </button>
        </div>
      )}

      {/* ── 统计条 ── */}
      <div className="mb-4 flex flex-wrap items-center gap-6 rounded-lg border border-border bg-card px-4 py-3">
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
            className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-40"
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

      {/* ── 新建行：录入委托 + 装车快件 ── */}
      <div className="mb-3 flex flex-wrap gap-2">
        <div className="flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1">
          <span className="text-xs text-amber-600 font-bold mr-1">委托</span>
          <input
            className="w-48 rounded border border-input bg-background px-2 py-1 text-sm"
            placeholder="委托名称"
            value={newPoolTitle}
            onChange={(e) => setNewPoolTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && newPoolTitle.trim()) {
                addPoolM.mutate({
                  title: newPoolTitle.trim(),
                  rarity: newPoolRarity,
                });
                setNewPoolTitle("");
              }
            }}
          />
          <select
            className="rounded border border-input bg-background px-1 py-1 text-xs"
            value={newPoolRarity}
            onChange={(e) => setNewPoolRarity(e.target.value as Rarity)}
          >
            {RARITIES.map((r) => (
              <option key={r} value={r}>
                {RARITY_LABEL[r]}
              </option>
            ))}
          </select>
          <button
            className="rounded bg-primary px-2 py-1 text-xs text-primary-foreground hover:opacity-90 disabled:opacity-40"
            disabled={!newPoolTitle.trim() || addPoolM.isPending}
            onClick={() => {
              addPoolM.mutate({
                title: newPoolTitle.trim(),
                rarity: newPoolRarity,
              });
              setNewPoolTitle("");
            }}
          >
            录入
          </button>
        </div>
        <div className="flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1">
          <span className="text-xs text-muted-foreground mr-1">快件</span>
          <input
            className="w-48 rounded border border-input bg-background px-2 py-1 text-sm"
            placeholder="快件标题"
            value={newTaskTitle}
            onChange={(e) => setNewTaskTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && newTaskTitle.trim() && curVan) {
                addTaskM.mutate({ van: curVan, title: newTaskTitle.trim() });
                setNewTaskTitle("");
              }
            }}
          />
          <button
            className="rounded bg-primary px-2 py-1 text-xs text-primary-foreground hover:opacity-90 disabled:opacity-40"
            disabled={!newTaskTitle.trim() || !curVan || addTaskM.isPending}
            onClick={() => {
              if (!curVan) return;
              addTaskM.mutate({ van: curVan, title: newTaskTitle.trim() });
              setNewTaskTitle("");
            }}
          >
            装车
          </button>
        </div>
      </div>

      {/* ── 主表格：委托 + 快件统一展示 ── */}
      <div style={{ height: 500 }} className="mb-6">
        <AgGridReact<UnifiedRow>
          theme={themeQuartz}
          rowData={unifiedData}
          columnDefs={columnDefs}
          defaultColDef={{ sortable: true, resizable: true }}
          loading={tasksQ.isLoading || poolQ.isLoading}
          onCellValueChanged={onCellValueChanged}
          getRowClass={(p) => {
            if (p.data?.kind === "task" && p.data.data.carryCount >= 2)
              return "bg-amber-50";
            if (p.data?.kind === "pool") return "bg-orange-50/50";
            return "";
          }}
          getRowId={(p) =>
            p.data.kind === "task"
              ? `task-${p.data.data.id}`
              : `pool-${p.data.data.id}`
          }
          localeText={{
            noRowsToShow: "还没有委托或快件，在上方录入开始",
          }}
        />
      </div>

      {/* ── 成员运力统计（从标签自动聚合） ── */}
      {stats && stats.members.length > 0 && (
        <section className="rounded-lg border border-border bg-card p-4">
          <h2 className="mb-3 text-sm font-bold">
            成员运力{" "}
            <span className="text-xs font-normal text-muted-foreground">
              （按标签自动统计）
            </span>
          </h2>
          <ul className="space-y-2">
            {stats.members.map((m) => {
              const overloaded = m.assigned > m.capacity;
              return (
                <li key={m.name} className="flex items-center gap-3 text-sm">
                  <span className="w-20 truncate font-medium">{m.name}</span>
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
        className={`text-base font-bold ${tone === "warn" ? "text-amber-600" : ""}`}
      >
        {value}
      </div>
    </div>
  );
}
