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
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { isVanCode, nextVanCode } from "@contracts/vans";
import type { Member, PoolItem, Task } from "@db/schema";

ModuleRegistry.registerModules([AllCommunityModule]);

/** 委托稀有度（六级），颜色只是标记不做筛选 */
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
/** 稀有度文字着色；神话为彩虹渐变流动动画（见 index.css） */
const RARITY_CLASS: Record<Rarity, string> = {
  common: "",
  uncommon: "text-green-600",
  rare: "text-blue-600",
  epic: "text-purple-600",
  legendary: "text-orange-500",
  mythic: "rarity-mythic-text",
};
/** pool.list 返回的委托条目：postedRounds 是服务端推导的挂账轮数，不在表里 */
type PoolRow = PoolItem & {
  rarity: Rarity;
  postedVan: string | null;
  postedRounds: number;
};
const POOL_STATUS_LABEL: Record<PoolItem["status"], string> = {
  open: "待切片",
  scheduled: "已排期",
  done: "已完成",
};

/** 送达日期（doneAt）只允许 YYYY-MM-DD，可手动补录 */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export default function BoardPage() {
  // 班次由「发新车」创建；van 是用户显式选中的班次，null = 未手动选过
  const [van, setVan] = useState<string | null>(null);
  const utils = trpc.useUtils();

  const vansQ = trpc.van.vans.list.useQuery();

  const vans = useMemo(() => vansQ.data ?? [], [vansQ.data]);
  // 渲染期派生当前班次：显式选中失效（含初始 null）时回退到最新一班，
  // 不写回 state，避免 effect 内 setState 造成级联渲染
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

  // 班次列表最新在前：‹ 往旧（索引 +1），› 往新（索引 -1）
  const vanIdx = curVan === null ? -1 : vans.indexOf(curVan);

  const refresh = () => utils.invalidate();
  const onError = (e: { message: string }) => toast.error(e.message);

  // 任一查询失败时显示错误横幅，不再静默回退空数组（避免误导性空态）
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

  // 发新车：表空时创建当月首班，否则字母 +1；成功后选中新班次
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
    // 校验失败等服务端拒单时，除提示外还要 invalidate，让网格回滚到服务端数据
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

  // TanStack Query v5 的 mutate 引用稳定，解构出来避免 columnDefs 每渲染重建
  const { mutate: removeTask } = removeTaskM;

  const columnDefs = useMemo<ColDef<Task>[]>(
    () => [
      {
        field: "title",
        headerName: "快件（任务）",
        flex: 2,
        editable: true,
        cellRenderer: (p: ICellRendererParams<Task>) => (
          <span className="inline-flex items-center gap-2">
            <span>{p.value}</span>
            {p.data?.carriedFrom && (
              <span
                className="carry-badge"
                title={`滞留自 ${p.data.carriedFrom}`}
              >
                📦 滞留
                {p.data.carryCount >= 2 ? ` ×${p.data.carryCount} 需复盘` : ""}
              </span>
            )}
          </span>
        ),
      },
      {
        field: "poolItemId",
        headerName: "所属委托",
        width: 170,
        editable: true,
        cellEditor: "agSelectCellEditor",
        // 选项显示「id 标题」而非裸 id，选中后由 valueParser 解析回 id；「（无）」表示解除关联
        cellEditorParams: {
          values: ["（无）", ...pool.map((p) => `${p.id} ${p.title}`)],
        },
        valueParser: (p) => {
          if (p.newValue === "（无）") return null;
          const id = Number(String(p.newValue).split(" ")[0]);
          return Number.isInteger(id) && id > 0 ? id : null;
        },
        // 委托标题按稀有度着色（从大厅列表查 rarity）
        cellRenderer: (p: ICellRendererParams<Task>) => {
          const item = pool.find((x) => x.id === p.value);
          if (!item) return null;
          return (
            <span className={RARITY_CLASS[item.rarity]}>{item.title}</span>
          );
        },
      },
      {
        field: "ownerName",
        headerName: "快递员（负责人）",
        width: 130,
        editable: true,
        cellEditor: "agSelectCellEditor",
        cellEditorParams: { values: members.map((m) => m.name) },
      },
      {
        field: "size",
        headerName: "档位",
        width: 86,
        editable: true,
        cellEditor: "agSelectCellEditor",
        cellEditorParams: { values: [1, 3, 5] },
        cellRenderer: (p: ICellRendererParams<Task>) =>
          p.value ? (
            <span className={`size-badge size-${p.value}`}>{p.value} 天</span>
          ) : null,
      },
      {
        field: "status",
        headerName: "状态",
        width: 100,
        editable: true,
        cellEditor: "agSelectCellEditor",
        cellEditorParams: { values: ["todo", "doing", "done"] },
        cellRenderer: (p: ICellRendererParams<Task>) =>
          p.value ? (
            <span className={`status-badge status-${p.value}`}>{p.value}</span>
          ) : null,
      },
      { field: "doneAt", headerName: "送达日期", width: 104, editable: true },
      {
        field: "acceptance",
        headerName: "验收标准",
        flex: 1.4,
        editable: true,
      },
      { field: "note", headerName: "备注", flex: 1, editable: true },
      {
        headerName: "",
        width: 64,
        cellRenderer: (p: ICellRendererParams<Task>) => (
          <button
            className="text-xs text-gray-400 hover:text-red-500"
            onClick={() => {
              if (p.data && window.confirm(`删除快件「${p.data.title}」？`)) {
                removeTask({ id: p.data.id });
              }
            }}
          >
            删除
          </button>
        ),
      },
    ],
    [pool, members, removeTask],
  );

  const onCellValueChanged = (e: CellValueChangedEvent<Task>) => {
    const field = e.colDef.field as keyof Task;
    let value: unknown = e.newValue;
    if (field === "size")
      value =
        e.newValue === "" || e.newValue == null ? null : Number(e.newValue);
    if (field === "doneAt") {
      if (value === "" || value == null) {
        value = null; // 清空表示未送达
      } else if (!DATE_RE.test(String(value))) {
        toast.error("送达日期格式应为 YYYY-MM-DD");
        utils.invalidate(); // 回滚单元格到服务端数据
        return;
      }
    }
    if (
      ["poolItemId", "ownerName", "acceptance", "note"].includes(field) &&
      (value === "" || value === undefined)
    ) {
      value = null;
    }
    updateTaskM.mutate({ id: e.data.id, [field]: value } as Parameters<
      typeof updateTaskM.mutate
    >[0]);
  };

  return (
    <div className="mx-auto max-w-[1400px] px-6 py-5">
      {/* ── 头部：班次导航 + 发新车 ── */}
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
                  title="快速跳转到指定班次"
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
          title="发一班新车（当月字母序号 +1）"
          onClick={() => dispatchM.mutate({})}
        >
          发新车
        </button>
      </header>

      {/* ── 加载失败横幅（含重试） ── */}
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

      {/* ── 统计条：最后一公里只看送达（剩余 X / 共 Y）+ 三指标 ── */}
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
        {/* 稀有度构成：done/total，按稀有度色着色（无关联委托的任务不计入） */}
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
        <div className="ml-auto flex items-center gap-2">
          <button
            className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-40"
            disabled={curVan === null}
            onClick={() =>
              curVan !== null &&
              addTaskM.mutate({
                van: curVan,
                title: "新快件（双击单元格编辑）",
              })
            }
          >
            ＋ 装车
          </button>
          <button
            className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:opacity-90 disabled:opacity-40"
            disabled={curVan === null}
            onClick={() => {
              // 目标班次固定为编码 +1；若尚未发新车，服务端会顺带创建
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

      {/* ── 表 2：班次任务表（AG Grid，行内编辑即每日状态更新） ── */}
      <div style={{ height: 420 }} className="mb-6">
        <AgGridReact<Task>
          theme={themeQuartz}
          rowData={tasks}
          columnDefs={columnDefs}
          defaultColDef={{ sortable: true, resizable: true }}
          loading={tasksQ.isLoading}
          onCellValueChanged={onCellValueChanged}
          getRowClass={(p) =>
            p.data?.carryCount && p.data.carryCount >= 2 ? "bg-amber-50" : ""
          }
          localeText={{
            noRowsToShow: "本班次还没有快件，点右上角「装车」开始排活",
          }}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* ── 表 1：任务大厅 ── */}
        <PoolPanel pool={pool} van={curVan} onChanged={refresh} />
        {/* ── 表 3：成员运力速览 ── */}
        <MembersPanel
          members={members}
          stats={stats?.members ?? []}
          onChanged={refresh}
        />
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
        className={`text-base font-bold ${tone === "warn" ? "text-amber-600" : ""}`}
      >
        {value}
      </div>
    </div>
  );
}

/* ── 任务大厅面板（PM 维护委托，可接取到当前班次） ── */
function PoolPanel({
  pool,
  van,
  onChanged,
}: {
  pool: PoolRow[];
  van: string | null;
  onChanged: () => void;
}) {
  const [title, setTitle] = useState("");
  const [rarity, setRarity] = useState<Rarity>("common");
  const [targetVan, setTargetVan] = useState("");
  // 行内编辑中的委托草稿，null 表示没有行处于编辑态
  const [editing, setEditing] = useState<{
    id: number;
    title: string;
    rarity: Rarity;
    targetVan: string;
    status: PoolRow["status"];
    note: string;
  } | null>(null);
  const onError = (e: { message: string }) => toast.error(e.message);
  const addM = trpc.van.pool.add.useMutation({
    onSuccess: () => {
      setTitle("");
      setTargetVan("");
      onChanged();
    },
    onError,
  });
  const updateM = trpc.van.pool.update.useMutation({
    onSuccess: () => {
      setEditing(null);
      onChanged();
    },
    onError,
  });
  const removeM = trpc.van.pool.remove.useMutation({
    onSuccess: onChanged,
    onError,
  });
  // 接取：以委托标题 + poolItemId 在当前选中班次创建任务
  const takeM = trpc.van.tasks.add.useMutation({
    onSuccess: () => {
      toast.success("已接取，双击行内编辑指派负责人和档位");
      onChanged();
    },
    onError,
  });

  const targetVanInvalid = targetVan !== "" && !isVanCode(targetVan);
  const editingVanInvalid =
    editing !== null &&
    editing.targetVan !== "" &&
    !isVanCode(editing.targetVan);

  const saveEditing = () => {
    if (!editing) return;
    updateM.mutate({
      id: editing.id,
      title: editing.title.trim(),
      rarity: editing.rarity,
      status: editing.status,
      targetVan: editing.targetVan === "" ? null : editing.targetVan,
      note: editing.note === "" ? null : editing.note,
    });
  };

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <h2 className="mb-3 text-sm font-bold">
        任务大厅{" "}
        <span className="text-xs font-normal text-muted-foreground">
          （稀有度只是标记，凭直觉定级）
        </span>
      </h2>
      <div className="mb-3">
        <div className="flex gap-2">
          <input
            className="flex-1 rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            placeholder="委托名称（业务语言描述）"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <select
            className="rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            value={rarity}
            onChange={(e) => setRarity(e.target.value as Rarity)}
            title="委托稀有度"
          >
            {RARITIES.map((r) => (
              <option key={r} value={r}>
                {RARITY_LABEL[r]}
              </option>
            ))}
          </select>
          <input
            className="w-24 rounded-md border border-input bg-background px-2 py-1.5 font-mono text-sm"
            placeholder={van ?? "目标班次"}
            value={targetVan}
            onChange={(e) => setTargetVan(e.target.value.toUpperCase())}
          />
          <button
            className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:opacity-90 disabled:opacity-40"
            disabled={!title.trim() || targetVanInvalid}
            title={targetVanInvalid ? "班次编码格式：DV2607A" : undefined}
            onClick={() =>
              addM.mutate({
                title: title.trim(),
                rarity,
                targetVan: targetVan || undefined,
              })
            }
          >
            录入
          </button>
        </div>
        {targetVanInvalid && (
          <div className="mt-1 text-xs text-amber-600">
            班次编码格式：DV2607A（2 位年 + 2 位月 + 当月第几班字母）
          </div>
        )}
      </div>
      <ul className="space-y-1.5">
        {pool.map((p) =>
          editing && editing.id === p.id ? (
            <li
              key={p.id}
              className="rounded-md border border-border p-2 text-sm"
            >
              <div className="flex items-center gap-2">
                <input
                  className="flex-1 rounded-md border border-input bg-background px-2 py-1 text-sm"
                  value={editing.title}
                  onChange={(e) =>
                    setEditing({ ...editing, title: e.target.value })
                  }
                  placeholder="委托名称"
                />
                <select
                  className="rounded-md border border-input bg-background px-2 py-1 text-sm"
                  value={editing.rarity}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      rarity: e.target.value as Rarity,
                    })
                  }
                  title="委托稀有度"
                >
                  {RARITIES.map((r) => (
                    <option key={r} value={r}>
                      {RARITY_LABEL[r]}
                    </option>
                  ))}
                </select>
                <input
                  className="w-24 rounded-md border border-input bg-background px-2 py-1 font-mono text-sm"
                  value={editing.targetVan}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      targetVan: e.target.value.toUpperCase(),
                    })
                  }
                  placeholder={van ?? "目标班次"}
                />
                <select
                  className="rounded-md border border-input bg-background px-2 py-1 text-sm"
                  value={editing.status}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      status: e.target.value as PoolItem["status"],
                    })
                  }
                >
                  <option value="open">待切片</option>
                  <option value="scheduled">已排期</option>
                  <option value="done">已完成</option>
                </select>
                <input
                  className="flex-1 rounded-md border border-input bg-background px-2 py-1 text-sm"
                  value={editing.note}
                  onChange={(e) =>
                    setEditing({ ...editing, note: e.target.value })
                  }
                  placeholder="备注"
                />
                <button
                  className="text-xs text-gray-400 hover:text-foreground disabled:opacity-40"
                  disabled={!editing.title.trim() || editingVanInvalid}
                  title={
                    editingVanInvalid ? "班次编码格式：DV2607A" : undefined
                  }
                  onClick={saveEditing}
                >
                  保存
                </button>
                <button
                  className="text-xs text-gray-400 hover:text-foreground"
                  onClick={() => setEditing(null)}
                >
                  取消
                </button>
              </div>
              {editingVanInvalid && (
                <div className="mt-1 text-xs text-amber-600">
                  班次编码格式：DV2607A
                </div>
              )}
            </li>
          ) : (
            <li key={p.id} className="flex items-center gap-2 text-sm">
              <span className={`flex-1 truncate ${RARITY_CLASS[p.rarity]}`}>
                {p.title}
              </span>
              {p.status === "open" && p.postedRounds > 0 && (
                <span
                  className="text-xs text-amber-600"
                  title={`挂出于 ${p.postedVan ?? "未知班次"}`}
                >
                  挂 {p.postedRounds} 轮
                </span>
              )}
              {p.targetVan && (
                <span className="font-mono text-xs text-muted-foreground">
                  {p.targetVan}
                </span>
              )}
              <span className="text-xs text-muted-foreground">
                {POOL_STATUS_LABEL[p.status]}
              </span>
              <button
                className="text-xs text-gray-400 hover:text-foreground disabled:opacity-40"
                disabled={van === null}
                title={van === null ? "请先发新车" : `接取到 ${van}`}
                onClick={() =>
                  van !== null &&
                  takeM.mutate({ van, title: p.title, poolItemId: p.id })
                }
              >
                接取
              </button>
              <button
                className="text-xs text-gray-400 hover:text-foreground"
                onClick={() =>
                  setEditing({
                    id: p.id,
                    title: p.title,
                    rarity: p.rarity,
                    targetVan: p.targetVan ?? "",
                    status: p.status,
                    note: p.note ?? "",
                  })
                }
              >
                编辑
              </button>
              <button
                className="text-xs text-gray-400 hover:text-red-500"
                onClick={() =>
                  window.confirm(`删除委托「${p.title}」？`) &&
                  removeM.mutate({ id: p.id })
                }
              >
                删除
              </button>
            </li>
          ),
        )}
        {pool.length === 0 && (
          <li className="text-xs text-muted-foreground">
            大厅还没有委托——周四下班前 PM 把下周委托写进来
          </li>
        )}
      </ul>
    </section>
  );
}

/* ── 成员运力面板（表 3：自动汇总，请假扣减运力） ── */
function MembersPanel({
  members,
  stats,
  onChanged,
}: {
  members: Member[];
  stats: {
    name: string;
    capacity: number;
    assigned: number;
    taskCount: number;
    done: number;
    carriedIn: number;
  }[];
  onChanged: () => void;
}) {
  const [name, setName] = useState("");
  const onError = (e: { message: string }) => toast.error(e.message);
  const addM = trpc.van.members.add.useMutation({
    onSuccess: () => {
      setName("");
      onChanged();
    },
    onError,
  });
  const capM = trpc.van.members.setCapacity.useMutation({
    onSuccess: onChanged,
    onError,
  });

  const statOf = (n: string) => stats.find((s) => s.name === n);

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <h2 className="mb-3 text-sm font-bold">
        成员运力{" "}
        <span className="text-xs font-normal text-muted-foreground">
          （每人每班 ≤ 5 天，请假扣减）
        </span>
      </h2>
      <div className="mb-3 flex gap-2">
        <input
          className="flex-1 rounded-md border border-input bg-background px-2 py-1.5 text-sm"
          placeholder="快递员姓名"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button
          className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:opacity-90 disabled:opacity-40"
          disabled={!name.trim()}
          onClick={() => addM.mutate({ name: name.trim(), capacity: 5 })}
        >
          添加
        </button>
      </div>
      <ul className="space-y-2">
        {members.map((m) => {
          const s = statOf(m.name);
          const assigned = s?.assigned ?? 0;
          const overloaded = assigned > m.capacity;
          return (
            <li key={m.id} className="flex items-center gap-3 text-sm">
              <span className="w-20 truncate font-medium">{m.name}</span>
              <label className="flex items-center gap-1 text-xs text-muted-foreground">
                运力
                <input
                  key={m.capacity}
                  type="number"
                  min={0}
                  max={7}
                  className="w-14 rounded border border-input bg-background px-1 py-0.5 text-center"
                  defaultValue={m.capacity}
                  onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                  onBlur={(e) => {
                    // 失焦才提交：避免逐击键发请求、清空时被误写成 0
                    const raw = e.target.value.trim();
                    const v = Number(raw);
                    if (raw === "" || !Number.isFinite(v)) {
                      e.target.value = String(m.capacity); // 非法输入回退为当前值
                      return;
                    }
                    if (v !== m.capacity)
                      capM.mutate({ id: m.id, capacity: v });
                  }}
                />
                天
              </label>
              <span
                className={`flex-1 text-xs ${overloaded ? "font-bold text-red-500" : "text-muted-foreground"}`}
              >
                已装 {assigned} 天 · {s?.taskCount ?? 0} 件 · 送达{" "}
                {s?.done ?? 0} · 滞留 {s?.carriedIn ?? 0}
                {overloaded && "（超载！）"}
              </span>
            </li>
          );
        })}
        {members.length === 0 && (
          <li className="text-xs text-muted-foreground">
            还没有快递员——先把团队加进来
          </li>
        )}
      </ul>
    </section>
  );
}
