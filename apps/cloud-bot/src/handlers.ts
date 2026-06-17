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

  const allowed = (ctx: Context): boolean =>
    ctx.chat != null && config.allowedChatIds.has(ctx.chat.id);

  // --- 설정 명령 (Fly DB user_id=1에 직접 기록) ---
  // 텔레그램 명령은 ASCII만 허용 → 한글 대신 /home·/leave·/alias.
  bot.command("home", async (ctx) => {
    if (!allowed(ctx)) return;
    const addr = (ctx.match ?? "").trim();
    if (!addr) {
      await ctx.reply("사용법: /home <집 주소>\n예) /home 서울 강남구 테헤란로 …");
      return;
    }
    try {
      await core.request(Methods.SettingsSet, { key: "travel.home", value: addr });
      await ctx.reply(`집 주소를 저장했어요: ${addr}`);
    } catch (e) {
      await ctx.reply(`저장 실패: ${errMsg(e)}`);
    }
  });

  bot.command("leave", async (ctx) => {
    if (!allowed(ctx)) return;
    const arg = (ctx.match ?? "").trim().toLowerCase();
    if (arg !== "on" && arg !== "off") {
      await ctx.reply("사용법: /leave on | /leave off (출발 알림 켜고/끄기)");
      return;
    }
    try {
      await core.request(Methods.SettingsSet, {
        key: "notifications.leave_enabled",
        value: arg === "on" ? "true" : "false",
      });
      await ctx.reply(`출발 알림을 ${arg === "on" ? "켰어요" : "껐어요"}.`);
    } catch (e) {
      await ctx.reply(`저장 실패: ${errMsg(e)}`);
    }
  });

  bot.command("alias", async (ctx) => {
    if (!allowed(ctx)) return;
    const raw = (ctx.match ?? "").trim();
    const sp = raw.indexOf(" ");
    if (sp < 0) {
      await ctx.reply("사용법: /alias <별칭> <주소>\n예) /alias 회사 서울 중구 …");
      return;
    }
    const alias = raw.slice(0, sp).trim();
    const query = raw.slice(sp + 1).trim();
    if (!alias || !query) {
      await ctx.reply("사용법: /alias <별칭> <주소>");
      return;
    }
    try {
      await core.request(Methods.TravelAliasSet, { alias, query });
      await ctx.reply(`별칭 저장: ${alias} → ${query}`);
    } catch (e) {
      await ctx.reply(`저장 실패: ${errMsg(e)}`);
    }
  });

  bot.command("aliases", async (ctx) => {
    if (!allowed(ctx)) return;
    try {
      const list = await core.request<Array<{ alias: string; query: string }>>(
        Methods.TravelAliasList,
        null,
      );
      if (!list || list.length === 0) {
        await ctx.reply("등록된 별칭이 없어요. /alias <별칭> <주소>로 추가하세요.");
        return;
      }
      await ctx.reply(list.map((a) => `• ${a.alias} → ${a.query}`).join("\n"));
    } catch (e) {
      await ctx.reply(`조회 실패: ${errMsg(e)}`);
    }
  });

  bot.on("message:text", async (ctx) => {
    const chatId = ctx.chat.id;
    if (!config.allowedChatIds.has(chatId)) {
      await ctx.reply("이 비서는 허가된 사용자만 쓸 수 있어요.");
      return;
    }
    // 슬래시 명령은 위 command 핸들러가 처리 — 채팅으로 보내지 않는다.
    if (ctx.message.text.startsWith("/")) return;
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
