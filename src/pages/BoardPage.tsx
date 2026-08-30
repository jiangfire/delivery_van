import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AgGridReact } from "ag-grid-react";
import {
  AllCommunityModule,
  ModuleRegistry,
  themeQuartz,
  type ColDef,
  type ICellRendererParams,
  type CellValueChangedEvent,
  type RowDragEndEvent,
} from "ag-grid-community";

type TaskColDef = ColDef<TaskRow> & { editField?: string };
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { carryTargetCode } from "@contracts/vans";
import {
  CARRY_REASONS,
  CARRY_REASON_LABELS,
  SOURCE_LABELS,
  type CarryReason,
  type Source,
} from "@contracts/enums";
import { getActor, saveActor } from "@/lib/actor";
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

/* ── 任务四态的中文标签（存储值仍是英文枚举） ── */
const STATUS_LABEL: Record<string, string> = {
  todo: "未开始",
  doing: "进行中",
  done: "完成",
  carried: "结转",
};
const STATUS_CODE: Record<string, TaskRow["status"]> = {
  未开始: "todo",
  进行中: "doing",
  完成: "done",
};

/* ── 快件来源（三方占比）：中文标签 ↔ 存储枚举 ── */
const SOURCE_CODE = Object.fromEntries(
  Object.entries(SOURCE_LABELS).map(([code, label]) => [label, code]),
) as Record<string, Source>;
/** 三方占比迷你条配色：客户天蓝 / 平台琥珀 / 探索紫 */
const SOURCE_COLOR: Record<Source, string> = {
  customer: "#0ea5e9",
  platform: "#d97706",
  exploration: "#8b5cf6",
};

type TaskRow = TaskWithOwners;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 档位徽标颜色分桶：≤2 点（≤1 天）蓝、≤6 点（≤3 天）橙、更大红 */
function sizeBucket(size: number): 1 | 3 | 5 {
  if (size <= 2) return 1;
  if (size <= 6) return 3;
  return 5;
}

/** 比率显示：null → “–” */
function fmtRate(x: number | null | undefined): string {
  return x == null ? "–" : `${Math.round(x * 100)}%`;
}

export default function BoardPage() {
  const [van, setVan] = useState<string | null>(null);
  /** 「我是谁」软身份：审计日志 actor 来源（localStorage 记住，未选择则 '(unknown)'） */
  const [actor, setActor] = useState<string | null>(() => getActor());
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
  /** mutation 通用附带：当前操作人（软身份） */
  const actorArg = actor ?? undefined;

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

  const reorderM = trpc.van.tasks.reorder.useMutation({
    onSuccess: refresh,
    onError: (e) => {
      toast.error(e.message);
      utils.invalidate();
    },
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

  const confirmM = trpc.van.tasks.confirm.useMutation({
    onSuccess: () => {
      toast.success("已签收");
      refresh();
    },
    onError,
  });

  const { mutate: removeTask } = removeTaskM;
  const { mutate: addMember } = addMemberM;
  const { mutate: confirmTask } = confirmM;

  /* ── 签收：done 且有提出人且未签收 → 待签收徽标，一次点击 ── */
  const onConfirm = useCallback(
    (d: TaskRow) => {
      if (!actor) {
        toast.error("请先在页头选择「我是谁」再签收");
        return;
      }
      confirmTask({ taskId: d.id, actor });
    },
    [actor, confirmTask],
  );

  /* ── 徽章轻提示：状态变化时 sonner 单次提示（首次加载不提示） ── */
  const badges = stats?.badges;
  const badgesSig = badges
    ? `${badges.teamPunctual ? 1 : 0}|${badges.streaks.join(",")}`
    : "";
  const prevBadgesSig = useRef<string | null>(null);
  useEffect(() => {
    const prev = prevBadgesSig.current;
    prevBadgesSig.current = badgesSig;
    if (prev === null || prev === badgesSig || !badges) return;
    if (badges.teamPunctual) toast.success("🚚 整班准点：本班快件全部送达");
    const prevStreaks = prev.split("|")[1]?.split(",").filter(Boolean) ?? [];
    for (const name of badges.streaks) {
      if (!prevStreaks.includes(name)) {
        toast.success(`📦 ${name} 送达连击点亮（连续 2 班零滞留）`);
      }
    }
  }, [badgesSig, badges]);

  /* ── 日志指纹复制（周五锚定仪式：抄进会议纪要） ── */
  const copyFingerprint = async (fp: string) => {
    try {
      await navigator.clipboard.writeText(fp);
      toast.success("日志指纹已复制");
    } catch {
      toast.error("复制失败，请手动选中复制");
    }
  };

  /* ── 结转确认弹层（含原因下拉，WP5）：替代原生 confirm ── */
  const [carryAsk, setCarryAsk] = useState<{
    fromVan: string;
    toVan: string;
  } | null>(null);
  const [carryReason, setCarryReason] = useState<string>("");

  const openCarryAsk = () => {
    if (curVan === null) return;
    // 与服务端同口径：已存在的最近一班优先，否则按日期推导下一班
    const toVan = carryTargetCode(curVan, vans, new Date());
    setCarryReason("");
    setCarryAsk({ fromVan: curVan, toVan });
  };

  /* ── 列定义 ── */
  const memberNames = useMemo(() => members.map((m) => m.name), [members]);

  // columnDefs 引用必须稳定：AG Grid 收到新数组会重建列并销毁正在编辑的编辑器。
  // react-query 的 structural sharing 保证数据不变时引用稳定；编辑参数延迟到编辑时求值。
  const columnDefs = useMemo<TaskColDef[]>(
    () => [
      // 拖拽排序手柄列（仅无列排序时可拖，managed 模式约束；归档班由 suppressRowDrag 禁用）
      {
        colId: "_drag",
        headerName: "",
        width: 40,
        rowDrag: true,
        sortable: false,
        resizable: false,
        editable: false,
        suppressHeaderMenuButton: true,
      },
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
      // 提出人列：done 未签收时带「待签收」徽标（签收制 WP3）
      {
        colId: "_requester",
        headerName: "提出人",
        width: 128,
        editable: !vanReadonly,
        editField: "requester",
        cellEditor: RequesterCellEditor,
        cellEditorParams: () => ({
          members: memberNames,
          onAddMember: (name: string) => addMember({ name, actor: actorArg }),
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
          if (!d) return null;
          const pending = d.status === "done" && d.requester && !d.confirmedAt;
          return (
            <span className="flex h-full items-center gap-1">
              {d.requester && <span className="text-sm">{d.requester}</span>}
              {d.confirmedAt && (
                <span title={`已签收：${d.confirmedBy}（${d.confirmedAt}）`}>
                  ✅
                </span>
              )}
              {pending && (
                <button
                  className="btn btn-glass px-1.5 py-0.5 text-[10px] leading-none"
                  disabled={vanReadonly || confirmM.isPending}
                  title={
                    vanArchived
                      ? "班次已结转归档，不可签收"
                      : "提出人签收（一次点击）"
                  }
                  onClick={() => onConfirm(d)}
                >
                  待签收
                </button>
              )}
            </span>
          );
        },
      },
      // 来源列（三方占比口径，v2.0 起采集）
      {
        colId: "_source",
        headerName: "来源",
        width: 84,
        editable: !vanReadonly,
        editField: "source",
        cellEditor: "agSelectCellEditor",
        cellEditorParams: {
          values: Object.values(SOURCE_LABELS),
        },
        valueGetter: (p) =>
          (p.data?.source && SOURCE_LABELS[p.data.source]) || "",
        valueSetter: (p) => {
          if (p.data) {
            const code = SOURCE_CODE[p.newValue as string];
            if (code) p.data.source = code;
            return true;
          }
          return false;
        },
        cellRenderer: (p: ICellRendererParams<TaskRow>) => {
          const d = p.data;
          if (!d) return null;
          return (
            <span
              className="flex h-full items-center gap-1.5 text-sm"
              title={
                d.source === "customer"
                  ? "客户件（默认；v2.0 前的历史快件统一记客户件）"
                  : undefined
              }
            >
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ background: SOURCE_COLOR[d.source] }}
              />
              {SOURCE_LABELS[d.source]}
            </span>
          );
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
          onAddMember: (name: string) => addMember({ name, actor: actorArg }),
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
        // 半天点数制：1 点 = 半天，1~10 整数
        cellEditorParams: {
          values: ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"],
        },
        valueGetter: (p) => String(p.data?.size ?? ""),
        valueSetter: (p) => {
          if (p.data) {
            const v = p.newValue === "" ? null : Number(p.newValue);
            p.data.size = v as number | null;
            return true;
          }
          return false;
        },
        cellRenderer: (p: ICellRendererParams<TaskRow>) => {
          const d = p.data;
          if (!d || !d.size) return null;
          return (
            <span className={`size-badge size-${sizeBucket(d.size)}`}>
              {d.size} 点
            </span>
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
        cellEditorParams: { values: ["未开始", "进行中", "完成"] },
        // 网格值用中文标签（编辑器直接以 values 展示），valueSetter 反查回枚举存储
        valueGetter: (p) => STATUS_LABEL[p.data?.status ?? ""] ?? "",
        valueSetter: (p) => {
          if (p.data) {
            const code = STATUS_CODE[p.newValue as string];
            if (code) p.data.status = code;
            return true;
          }
          return false;
        },
        cellRenderer: (p: ICellRendererParams<TaskRow>) => {
          const d = p.data;
          if (!d || !d.status) return null;
          return (
            <span className={`status-badge status-${d.status}`}>
              {d.status === "carried"
                ? "🔁 结转"
                : (STATUS_LABEL[d.status] ?? d.status)}
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
      // 结转记录列（附滞留原因，WP5）
      {
        colId: "_carry",
        headerName: "结转记录",
        width: 150,
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
              {d.carryReason && (
                <span
                  className="carry-badge"
                  title={`滞留原因：${CARRY_REASON_LABELS[d.carryReason as CarryReason]}`}
                >
                  {CARRY_REASON_LABELS[d.carryReason as CarryReason]}
                </span>
              )}
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
                  removeTask({ id: d.id, actor: actorArg });
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
      memberNames,
      removeTask,
      addMember,
      vanReadonly,
      vanArchived,
      actorArg,
      onConfirm,
      confirmM.isPending,
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
      _source: "source",
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

    if (key === "status") {
      // 编辑器以中文标签交互，落库前反查回英文枚举
      value = STATUS_CODE[value as string] ?? value;
    }
    if (key === "source") {
      value = SOURCE_CODE[value as string] ?? value;
    }
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

    updateTaskM.mutate({
      id: task.id,
      [key]: value,
      actor: actorArg,
    } as Parameters<typeof updateTaskM.mutate>[0]);
  };

  /* ── 行拖拽排序：拖完后把整班 id 顺序全量发给服务端重写 sort_order ── */
  const onRowDragEnd = (e: RowDragEndEvent<TaskRow>) => {
    if (!curVan) return;
    const ids: number[] = [];
    e.api.forEachNode((node) => {
      if (node.data) ids.push(node.data.id);
    });
    reorderM.mutate({ van: curVan, ids, actor: actorArg });
  };

  /* ── 统计条的三方占比数据 ── */
  const sourceTotal = stats?.source.reduce((s, x) => s + x.total, 0) ?? 0;

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
                    aria-label="班次"
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
          <div className="flex items-center gap-2">
            {/* 「我是谁」软身份：链式审计日志的 actor（一次选择，localStorage 记住） */}
            <div className="glass-sm flex items-center gap-1 px-2 py-1">
              <span className="text-xs text-muted-foreground">我是谁</span>
              <select
                aria-label="我是谁（当前操作人）"
                className="select-liquid bg-transparent px-1 py-0.5 text-xs"
                value={actor ?? ""}
                onChange={(e) => {
                  const next = e.target.value || null;
                  setActor(next);
                  saveActor(next);
                }}
              >
                <option value="">（未选择）</option>
                {members.map((m) => (
                  <option key={m.name} value={m.name}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>
            <button
              className="btn btn-primary px-4 py-2 text-sm"
              disabled={dispatchM.isPending}
              onClick={() => dispatchM.mutate({ actor: actorArg })}
            >
              发新车
            </button>
          </div>
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
          {/* 未签收提示（WP3）：周五验收会前看这里，是否结转仍由人决定 */}
          {stats && stats.unconfirmed > 0 && (
            <Stat
              label="未签收"
              value={`${stats.unconfirmed} 件`}
              tone="warn"
            />
          )}
          {/* 昨日天气（WP4）：建议装载上限 = 上一班实际送达点数，只提示不拦截 */}
          {stats?.suggestedLoad != null && (
            <Stat label="建议装载上限" value={`${stats.suggestedLoad} 点`} />
          )}
          {/* 三方占比迷你条（WP1）：一眼看快件结构 */}
          <div>
            <div className="label-caps">三方占比</div>
            {sourceTotal > 0 ? (
              <div className="mt-1.5">
                <div className="flex h-2 w-44 overflow-hidden rounded-full border border-white/60">
                  {stats!.source
                    .filter((s) => s.total > 0)
                    .map((s) => (
                      <span
                        key={s.source}
                        title={`${SOURCE_LABELS[s.source]} ${s.total} 件`}
                        style={{
                          width: `${(s.total / sourceTotal) * 100}%`,
                          background: SOURCE_COLOR[s.source],
                        }}
                      />
                    ))}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {stats!.source
                    .map(
                      (s) =>
                        `${SOURCE_LABELS[s.source]} ${Math.round((s.total / sourceTotal) * 100)}%`,
                    )
                    .join(" · ")}
                </div>
              </div>
            ) : (
              <div className="text-base font-bold">–</div>
            )}
          </div>
          {/* 徽章角标（WP6）：实时推导不落库 */}
          {badges && (badges.teamPunctual || badges.streaks.length > 0) && (
            <div className="flex items-center gap-1">
              {badges.teamPunctual && (
                <span
                  className="badge-chip badge-green"
                  title="整班准点：本班快件全部送达"
                >
                  🚚 整班准点
                </span>
              )}
              {badges.streaks.length > 0 && (
                <span
                  className="badge-chip"
                  title={`${badges.streaks.join("、")}：连续 2 个班次负责快件零滞留`}
                >
                  📦 送达连击 ×{badges.streaks.length}
                </span>
              )}
            </div>
          )}
          {/* 日志指纹（WP2）：链头 hash 前 8 位，周五锚定仪式抄进会议纪要 */}
          {stats?.auditFingerprint && (
            <button
              className="btn btn-ghost font-mono text-xs"
              title="链式审计日志指纹（点击复制，周五复盘会抄进纪要锚定）"
              onClick={() => copyFingerprint(stats.auditFingerprint!)}
            >
              日志指纹 {stats.auditFingerprint}
            </button>
          )}
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
                  { van: curVan, title: "新快件", actor: actorArg },
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
              onClick={openCarryAsk}
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
              rowDragManaged
              suppressRowDrag={vanReadonly}
              onRowDragEnd={onRowDragEnd}
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
                      运力 {m.capacity} 点
                    </span>
                    <span
                      className={`flex-1 text-xs ${overloaded ? "font-bold text-red-500" : "text-muted-foreground"}`}
                    >
                      已装 {m.assigned} 点 · {m.taskCount} 件 · 送达 {m.done} ·
                      滞留 {m.carriedIn}
                      {overloaded && "（超载！）"}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {/* ── 统计面板（默认折叠，v2.0 隐形预算：不占主界面） ── */}
        <details className="glass-card mt-6 p-5">
          <summary className="cursor-pointer text-sm font-bold select-none">
            统计面板（v2）
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              提出人记分卡 · 稀有度通胀 · 滞留原因瀑布
            </span>
          </summary>
          <div className="mt-4 grid gap-8 lg:grid-cols-2">
            {/* 提出人记分卡（WP1） */}
            <section>
              <h3 className="mb-2 text-xs font-bold text-muted-foreground">
                提出人记分卡（送达 = 签收口径）
              </h3>
              {stats && stats.requester.length > 0 ? (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[11px] text-muted-foreground">
                      <th className="py-1 pr-4 font-semibold">提出人</th>
                      <th className="py-1 pr-4 font-semibold">提出</th>
                      <th className="py-1 pr-4 font-semibold">送达</th>
                      <th className="py-1 pr-4 font-semibold">滞留</th>
                      <th className="py-1 pr-4 font-semibold">UR+SSR</th>
                      <th className="py-1 font-semibold">在车班数</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.requester.map((r) => (
                      <tr key={r.requester} className="border-t border-black/5">
                        <td className="py-1.5 pr-4 font-medium">
                          {r.requester}
                        </td>
                        <td className="py-1.5 pr-4">{r.total}</td>
                        <td className="py-1.5 pr-4">{r.delivered}</td>
                        <td className="py-1.5 pr-4">{r.stranded}</td>
                        <td className="py-1.5 pr-4">
                          {Math.round(r.urSsrRate * 100)}%
                        </td>
                        <td className="py-1.5">{r.avgVans}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="text-xs text-muted-foreground">本班暂无快件</p>
              )}
            </section>
            {/* 稀有度通胀报表（WP1） */}
            <section>
              <h3 className="mb-2 text-xs font-bold text-muted-foreground">
                稀有度通胀（done × 滞留交叉）
              </h3>
              {stats && stats.inflation.byRarity.length > 0 ? (
                <>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-[11px] text-muted-foreground">
                        <th className="py-1 pr-4 font-semibold">稀有度</th>
                        <th className="py-1 pr-4 font-semibold">总数</th>
                        <th className="py-1 pr-4 font-semibold">送达</th>
                        <th className="py-1 font-semibold">滞留</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stats.inflation.byRarity.map((r) => (
                        <tr key={r.rarity} className="border-t border-black/5">
                          <td
                            className={`py-1.5 pr-4 font-medium ${RARITY_CLASS[r.rarity as Rarity]}`}
                          >
                            {r.rarity.toUpperCase()}
                          </td>
                          <td className="py-1.5 pr-4">{r.total}</td>
                          <td className="py-1.5 pr-4">{r.done}</td>
                          <td className="py-1.5">{r.stranded}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="mt-2 text-xs text-muted-foreground">
                    UR 滞留率 {fmtRate(stats.inflation.urStrandRate)} vs N
                    滞留率 {fmtRate(stats.inflation.nStrandRate)}
                    （UR 显著更高 = 集体压级/定级通胀信号）
                  </p>
                </>
              ) : (
                <p className="text-xs text-muted-foreground">本班暂无快件</p>
              )}
            </section>
            {/* 滞留原因瀑布（WP5） */}
            <section className="lg:col-span-2">
              <h3 className="mb-2 text-xs font-bold text-muted-foreground">
                滞留原因瀑布（本班结转出去的件，无人名排序）
              </h3>
              {stats && stats.carryReasons.length > 0 ? (
                <ul className="max-w-xl space-y-1.5">
                  {stats.carryReasons.map((r) => {
                    const max = Math.max(
                      ...stats.carryReasons.map((x) => x.count),
                    );
                    return (
                      <li
                        key={r.reason ?? "unclassified"}
                        className="flex items-center gap-3 text-sm"
                      >
                        <span className="w-20 shrink-0 text-xs">
                          {r.reason
                            ? CARRY_REASON_LABELS[r.reason as CarryReason]
                            : "未分类"}
                        </span>
                        <span className="h-2 flex-1 overflow-hidden rounded-full bg-black/5">
                          <span
                            className="block h-full rounded-full bg-amber-500/60"
                            style={{ width: `${(r.count / max) * 100}%` }}
                          />
                        </span>
                        <span className="w-6 text-right text-xs text-muted-foreground">
                          {r.count}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="text-xs text-muted-foreground">
                  本班暂无结转出去的滞留件
                </p>
              )}
              <p className="mt-4 text-xs text-muted-foreground">
                口径说明：三方占比与来源自 v2.0 起采集，历史快件统一记为客户件；
                记分卡「送达」为签收口径，滞留率/完成率仍为 v1
                口径（基线连续）。
              </p>
            </section>
          </div>
        </details>

        {/* ── 结转确认弹层（WP5：原因下拉，默认未分类） ── */}
        {carryAsk && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 px-4"
            role="dialog"
            aria-label="结转确认"
          >
            <div className="glass-card w-full max-w-sm p-5">
              <h3 className="mb-1 text-sm font-bold">滞留件转下一班</h3>
              <p className="mb-3 text-xs text-muted-foreground">
                把 {carryAsk.fromVan} 的滞留件转到 {carryAsk.toVan}
                ？结转后本班归档只读。
              </p>
              <label className="label-caps" htmlFor="carry-reason">
                结转原因（可选，喂滞留瀑布与可控性分层）
              </label>
              <select
                id="carry-reason"
                className="select-liquid mt-1 w-full px-3 py-2 text-sm"
                value={carryReason}
                onChange={(e) => setCarryReason(e.target.value)}
              >
                <option value="">未分类</option>
                {CARRY_REASONS.map((r) => (
                  <option key={r} value={r}>
                    {CARRY_REASON_LABELS[r]}
                  </option>
                ))}
              </select>
              <div className="mt-4 flex justify-end gap-2">
                <button
                  className="btn btn-ghost px-3 py-1.5 text-sm"
                  onClick={() => setCarryAsk(null)}
                >
                  取消
                </button>
                <button
                  className="btn btn-primary px-4 py-1.5 text-sm"
                  disabled={carryM.isPending}
                  onClick={() => {
                    carryM.mutate(
                      {
                        fromVan: carryAsk.fromVan,
                        toVan: carryAsk.toVan,
                        carryReason: (carryReason || undefined) as
                          CarryReason | undefined,
                        actor: actorArg,
                      },
                      { onSuccess: () => setCarryAsk(null) },
                    );
                  }}
                >
                  确认结转
                </button>
              </div>
            </div>
          </div>
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
