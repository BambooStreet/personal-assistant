import { Bot, InlineKeyboard, type Context } from "grammy";
import { CoreSupervisor } from "@pa/core-rpc";
import { Methods } from "@pa/ipc-types";

import type { BotConfig } from "./config";
import { formatAssistantText, toolConfirmPrompt } from "./format";
import type { ChatTurn } from "./types";

// 승인 대기 중인 쓰기 도구. tool_call_id → 재개에 필요한 컨텍스트.
// (단일 프로세스 in-memory. 봇 측 1차 중복탭 가드 + Core의 tool_call_already_closed = 이중 방어.)
interface Pending {
  toolName: string;
  conversationId: string;
}

const CB_APPROVE = "y";
const CB_REJECT = "n";

function conversationIdFor(chatId: number): string {
  // user_id=1(공유) + 채팅 스레드만 분리 (D-013/Phase5 결정).
  return `tg:${chatId}`;
}

/** ChatTurn을 텔레그램에 표시. 쓰기 도구 1건이 pending이면 Yes/No 인라인 버튼으로 confirm. */
async function sendTurn(
  ctx: Context,
  turn: ChatTurn,
  conversationId: string,
  pending: Map<string, Pending>,
): Promise<void> {
  // 쓰기 도구는 Core가 첫 1건에서 멈춰 pending으로 반환(4b). read-only는 이미 자동 실행됨.
  const writeCall = turn.tool_calls[0];
  if (!writeCall) {
    await ctx.reply(formatAssistantText(turn));
    return;
  }

  pending.set(writeCall.id, { toolName: writeCall.name, conversationId });
  const lead = (turn.assistant_text ?? "").trim();
  const body = lead.length > 0 ? `${lead}\n\n${toolConfirmPrompt(writeCall)}` : toolConfirmPrompt(writeCall);
  const keyboard = new InlineKeyboard()
    .text("✅ 예", `${CB_APPROVE}:${writeCall.id}`)
    .text("❌ 아니요", `${CB_REJECT}:${writeCall.id}`);
  await ctx.reply(body, { reply_markup: keyboard });
}

export function registerHandlers(
  bot: Bot,
  core: CoreSupervisor,
  config: BotConfig,
): void {
  const pending = new Map<string, Pending>();

  bot.on("message:text", async (ctx) => {
    const chatId = ctx.chat.id;
    if (!config.allowedChatIds.has(chatId)) {
      await ctx.reply("이 비서는 허가된 사용자만 쓸 수 있어요.");
      return;
    }
    const conversationId = conversationIdFor(chatId);
    try {
      await ctx.replyWithChatAction("typing").catch(() => {});
      const turn = await core.request<ChatTurn>(Methods.ChatSend, {
        user_message: ctx.message.text,
        conversation_id: conversationId,
      });
      await sendTurn(ctx, turn, conversationId, pending);
    } catch (e) {
      await ctx.reply(`처리 중 오류가 났어요: ${errMsg(e)}`);
    }
  });

  bot.on("callback_query:data", async (ctx) => {
    const chatId = ctx.chat?.id;
    const data = ctx.callbackQuery.data;
    const sep = data.indexOf(":");
    const verb = sep >= 0 ? data.slice(0, sep) : "";
    const toolCallId = sep >= 0 ? data.slice(sep + 1) : "";

    await ctx.answerCallbackQuery().catch(() => {});

    if (chatId == null || !config.allowedChatIds.has(chatId)) {
      return;
    }
    const pend = pending.get(toolCallId);
    if (!pend) {
      // 이미 처리됐거나(중복 탭) 만료. 버튼만 제거.
      await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});
      return;
    }
    pending.delete(toolCallId); // 중복 탭 1차 가드
    await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});

    const approved = verb === CB_APPROVE;
    try {
      const turn = await core.request<ChatTurn>(Methods.ChatContinue, {
        conversation_id: pend.conversationId,
        tool_call_id: toolCallId,
        tool_name: pend.toolName,
        approved,
      });
      // 재개 결과가 또 다른 쓰기 도구를 요청할 수 있으므로 동일 경로로 처리.
      await sendTurn(ctx, turn, pend.conversationId, pending);
    } catch (e) {
      await ctx.reply(`처리 중 오류가 났어요: ${errMsg(e)}`);
    }
  });
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
