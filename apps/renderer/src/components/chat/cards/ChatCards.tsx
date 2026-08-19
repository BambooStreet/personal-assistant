// assistant 버블에 딸린 카드들을 순서대로 렌더. 카드 종류 추가는 여기 case 한 줄 + 컴포넌트.

import type { ChatCard } from "../../../lib/chatCards";

import { EventListCard } from "./EventListCard";
import { TodoListCard } from "./TodoListCard";

export function ChatCards({ cards }: { cards: ChatCard[] }) {
  if (cards.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5">
      {cards.map((card) => {
        switch (card.kind) {
          case "todos":
            return <TodoListCard key={card.key} todos={card.todos} />;
          case "events":
            return <EventListCard key={card.key} scope={card.scope} events={card.events} />;
          default:
            return null;
        }
      })}
    </div>
  );
}
