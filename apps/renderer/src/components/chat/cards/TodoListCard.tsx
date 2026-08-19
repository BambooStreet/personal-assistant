import { ListChecks } from "lucide-react";

import { cn } from "../../../lib/cn";
import type { ChatCardTodo } from "../../../lib/chatCards";

import { CardShell, MAX_CARD_ROWS, MoreRow, formatDueLabel, isOverdue } from "./shared";

interface Props {
  todos: ChatCardTodo[];
}

// 기한 있는 항목 먼저(빠른 순), 그다음 기한 없는 항목(우선순위 높은 순).
function sortTodos(todos: ChatCardTodo[]): ChatCardTodo[] {
  const withDue = todos
    .filter((t) => t.due_at)
    .sort((a, b) => Date.parse(a.due_at!) - Date.parse(b.due_at!));
  const withoutDue = todos
    .filter((t) => !t.due_at)
    .sort((a, b) => b.priority - a.priority);
  return [...withDue, ...withoutDue];
}

export function TodoListCard({ todos }: Props) {
  const sorted = sortTodos(todos);
  const shown = sorted.slice(0, MAX_CARD_ROWS);
  const hidden = sorted.length - shown.length;
  const firstNoDueIndex = shown.findIndex((t) => !t.due_at);
  // 두 그룹이 모두 있을 때만 구분선을 넣는다(한쪽만 있으면 헤더 없이 목록만).
  const showDivider = firstNoDueIndex > 0;

  return (
    <CardShell icon={<ListChecks size={13} />} title="할 일" count={todos.length}>
      <ul className="flex flex-col">
        {shown.map((t, i) => (
          <li key={t.id}>
            {showDivider && i === firstNoDueIndex && (
              <p className="px-0.5 pt-2 pb-1 text-xs text-fg-subtle">기한 없음</p>
            )}
            <TodoRow todo={t} />
          </li>
        ))}
      </ul>
      {hidden > 0 && <MoreRow count={hidden} />}
    </CardShell>
  );
}

function TodoRow({ todo }: { todo: ChatCardTodo }) {
  const due = todo.due_at ? formatDueLabel(todo.due_at) : null;
  const overdue = todo.due_at ? isOverdue(todo.due_at) : false;
  // priority 2~3 = 강조. 숫자 자체는 노출하지 않는다(표시 지침과 동일한 규칙).
  const starred = todo.priority >= 2;

  return (
    <div className="flex items-baseline gap-2 py-1">
      <span
        className={cn(
          "mt-px h-1.5 w-1.5 shrink-0 translate-y-[-1px] rounded-full",
          overdue ? "bg-red-400" : starred ? "bg-accent" : "bg-fg-subtle/50",
        )}
        aria-hidden
      />
      <span className={cn("min-w-0 flex-1 text-xs", todo.done && "line-through opacity-60")}>
        {starred && <span className="text-accent">★ </span>}
        <span className="break-words text-fg">{todo.title}</span>
        {todo.estimated_minutes != null && (
          <span className="text-fg-subtle"> · {todo.estimated_minutes}분</span>
        )}
        {todo.recur && <span className="text-fg-subtle"> · {recurLabel(todo.recur)}</span>}
      </span>
      {due && (
        <span
          className={cn(
            "shrink-0 rounded px-1.5 py-0.5 text-xs tabular-nums",
            overdue ? "bg-red-500/15 text-red-300" : "bg-bg/60 text-fg-muted",
          )}
        >
          {due}
        </span>
      )}
    </div>
  );
}

function recurLabel(recur: string): string {
  switch (recur) {
    case "daily":
      return "매일";
    case "weekly":
      return "매주";
    case "monthly":
      return "매월";
    default:
      return recur;
  }
}
