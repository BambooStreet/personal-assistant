use serde_json::json;

use super::ToolDef;

pub fn create_todo() -> ToolDef {
    ToolDef {
        name: "create_todo".into(),
        description:
            "사용자가 요청한 새 할 일을 생성합니다. 반드시 사용자의 한국어 표현을 자연스럽게 \
             보존한 짧은 제목을 사용하세요. 마감(due_at)은 사용자가 명시한 경우에만 ISO 8601 \
             (예: 2026-05-02T15:00:00+09:00) 형식으로 채우세요. 시간이 모호하면 비워두세요."
                .into(),
        parameters: json!({
            "type": "object",
            "properties": {
                "title": { "type": "string", "description": "할 일 제목 (간결, 30자 이내 권장)" },
                "notes": { "type": "string", "description": "추가 설명. 없으면 생략" },
                "due_at": {
                    "type": "string",
                    "description": "마감 일시 (ISO 8601 with timezone). 명시 안 됐으면 생략."
                },
                "priority": {
                    "type": "integer",
                    "minimum": 0,
                    "maximum": 3,
                    "description": "0=보통, 1=낮음, 2=높음, 3=긴급"
                },
                "estimated_minutes": {
                    "type": "integer",
                    "minimum": 1,
                    "description": "예상 소요시간(분). 일과 자동 배치에 쓰임. 사용자가 \
                                    언급했거나 합리적으로 추정 가능하면 채우고, 모르면 생략."
                }
            },
            "required": ["title"],
            "additionalProperties": false
        }),
    }
}

pub fn complete_todo() -> ToolDef {
    ToolDef {
        name: "complete_todo".into(),
        description: "지정한 id의 할 일을 완료 처리합니다. 사용자가 \"~ 다 했어\", \"끝냈어\" \
                      같이 말할 때 사용. 가능한 id를 모르면 먼저 list_todos를 호출해 확인하세요."
            .into(),
        parameters: json!({
            "type": "object",
            "properties": {
                "id": { "type": "integer", "description": "todos.id 값" }
            },
            "required": ["id"],
            "additionalProperties": false
        }),
    }
}

pub fn list_todos() -> ToolDef {
    ToolDef {
        name: "list_todos".into(),
        description: "사용자가 todo 앱에 등록해 둔 \"할 일(todo/task)\" 목록을 가져옵니다. \
                      \"오늘 할 일 뭐야?\", \"할 일 뭐 있지?\", \"todo 보여줘\" 같이 \
                      체크리스트성 작업을 물어볼 때 사용하세요. \
                      캘린더 일정(미팅·약속)은 list_today_events / list_upcoming_events를 \
                      쓰고, 이 도구는 사용하지 마세요."
            .into(),
        parameters: json!({
            "type": "object",
            "properties": {
                "include_done": {
                    "type": "boolean",
                    "description": "완료된 항목도 포함할지 여부. 기본 false"
                }
            },
            "additionalProperties": false
        }),
    }
}

pub fn create_event() -> ToolDef {
    ToolDef {
        name: "create_event".into(),
        description: "사용자가 요청한 새 캘린더 이벤트를 Google Calendar에 생성합니다. \
                      시간이 명확할 때만 호출하고, 모호하면 임의로 정하지 말고 사용자에게 \
                      한 번 더 짧게 묻습니다. \
                      ★호출 전 필수: 이 도구를 부르기 전에 반드시 list_today_events 또는 \
                      list_upcoming_events로 같은 시간대의 기존 일정을 먼저 조회해, 시작~종료가 \
                      겹치는 일정이 있는지 확인하세요. 겹치는 일정이 있으면 곧바로 만들지 말고 \
                      무엇과 겹치는지 사용자에게 알린 뒤 \"그래도 추가할까요?\"라고 물어보세요. \
                      사용자가 괜찮다고 하면 그대로 생성하고, 겹쳐도 안 된다고 하면 다른 시간을 \
                      다시 물어보세요. 겹치는 일정이 없으면 바로 생성해도 됩니다. \
                      시간은 사용자의 타임존 오프셋이 포함된 ISO 8601 형식 \
                      (예: 2026-05-02T15:00:00+09:00). 종료 시각이 명시되지 않으면 시작에서 \
                      1시간 뒤로 설정. 종일 이벤트인 경우 all_day=true이며 start_at/end_at은 \
                      YYYY-MM-DD 날짜만 사용 (end는 종료 다음날의 0시 자정).".into(),
        parameters: json!({
            "type": "object",
            "properties": {
                "summary": {
                    "type": "string",
                    "description": "이벤트 제목 (간결)"
                },
                "start_at": {
                    "type": "string",
                    "description": "시작 시각 (ISO 8601 with offset). 종일이면 YYYY-MM-DD."
                },
                "end_at": {
                    "type": "string",
                    "description": "종료 시각 (ISO 8601 with offset). 종일이면 YYYY-MM-DD (다음날)."
                },
                "description": { "type": "string" },
                "location": { "type": "string" },
                "all_day": {
                    "type": "boolean",
                    "description": "종일 이벤트 여부. 기본 false."
                }
            },
            "required": ["summary", "start_at", "end_at"],
            "additionalProperties": false
        }),
    }
}

pub fn delete_todo() -> ToolDef {
    ToolDef {
        name: "delete_todo".into(),
        description: "지정한 id의 할 일을 삭제합니다. 사용자가 \"~ 지워줘\", \"취소\" 같이 말할 때 사용. \
                      가능한 id를 모르면 먼저 list_todos를 호출해 확인하세요. 완료가 아니라 \
                      잘못 만든 항목을 없앨 때 적합."
            .into(),
        parameters: json!({
            "type": "object",
            "properties": {
                "id": { "type": "integer", "description": "todos.id 값" }
            },
            "required": ["id"],
            "additionalProperties": false
        }),
    }
}

pub fn list_today_overview() -> ToolDef {
    ToolDef {
        name: "list_today_overview".into(),
        description: "오늘의 \"할 일(todos)\"과 \"캘린더 일정(events)\"을 한 번에 묶어서 반환합니다. \
                      사용자가 \"오늘 할 일 뭐야?\", \"오늘 뭐 해야 해?\", \"오늘 하루 어때?\" 같이 \
                      종합적으로 물어볼 때 우선 사용하세요 (list_todos + list_today_events 두 번 호출 대신). \
                      events에는 제목·시작/종료 시각·장소가 포함됩니다. 표시 형식은 결과에 동봉된 지침을 따르세요."
            .into(),
        parameters: json!({
            "type": "object",
            "properties": {},
            "additionalProperties": false
        }),
    }
}

pub fn list_today_events() -> ToolDef {
    ToolDef {
        name: "list_today_events".into(),
        description: "Google Calendar에 등록된 오늘 \"일정(event)\" — 미팅/회의/약속 — 을 가져옵니다. \
                      \"오늘 일정 뭐야?\", \"오늘 미팅 있어?\", \"오늘 캘린더\" 같은 질문에 사용. \
                      todo 앱의 할 일이 아니라 캘린더 이벤트만 다룹니다 \
                      (할 일은 list_todos)."
            .into(),
        parameters: json!({
            "type": "object",
            "properties": {},
            "additionalProperties": false
        }),
    }
}

pub fn list_upcoming_events() -> ToolDef {
    ToolDef {
        name: "list_upcoming_events".into(),
        description: "다가오는 N일 이내의 캘린더 \"일정(event)\"을 가져옵니다. \
                      \"이번 주 일정\", \"내일 미팅\", \"다음 약속\" 류에 사용. days 미지정 시 7일. \
                      todo 앱의 할 일이 아니라 캘린더 이벤트만 다룹니다 (할 일은 list_todos)."
            .into(),
        parameters: json!({
            "type": "object",
            "properties": {
                "days": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": 60,
                    "description": "조회할 일수 (1~60). 기본 7."
                }
            },
            "additionalProperties": false
        }),
    }
}

pub fn update_event() -> ToolDef {
    ToolDef {
        name: "update_event".into(),
        description: "기존 캘린더 이벤트를 수정합니다. 사용자가 \"~ 시간 바꿔줘\", \"제목 고쳐줘\", \
                      \"장소 옮겨줘\" 같이 말할 때 사용. 먼저 list_today_events 또는 \
                      list_upcoming_events로 대상 이벤트의 google_event_id를 확인하세요. \
                      변경할 필드만 채워서 보내세요(주지 않은 필드는 그대로 유지됨). \
                      ★시간(start_at/end_at)을 바꿀 때 필수: 새 시간대의 기존 일정을 \
                      list_today_events 또는 list_upcoming_events로 먼저 조회해, 수정 대상 \
                      자기 자신(google_event_id)을 제외하고 겹치는 일정이 있는지 확인하세요. \
                      겹치는 일정이 있으면 곧바로 수정하지 말고 무엇과 겹치는지 알린 뒤 \
                      \"그래도 옮길까요?\"라고 물어보세요. 괜찮다고 하면 진행하고, 안 된다고 \
                      하면 다른 시간을 다시 물어보세요. (시간을 안 바꾸면 이 확인은 생략) \
                      시간은 사용자 타임존 오프셋이 포함된 ISO 8601 형식 \
                      (예: 2026-05-02T15:00:00+09:00). 종일 여부가 바뀌면 all_day도 함께 보내세요. \
                      삭제가 아니라 일부만 바꿀 때 사용(완전 삭제는 delete_event).".into(),
        parameters: json!({
            "type": "object",
            "properties": {
                "google_event_id": {
                    "type": "string",
                    "description": "events.google_event_id 값 (수정 대상)"
                },
                "summary": { "type": "string", "description": "새 제목. 안 바꾸면 생략." },
                "start_at": {
                    "type": "string",
                    "description": "새 시작 시각 (ISO 8601 with offset). 종일이면 YYYY-MM-DD. 안 바꾸면 생략."
                },
                "end_at": {
                    "type": "string",
                    "description": "새 종료 시각 (ISO 8601 with offset). 종일이면 YYYY-MM-DD(다음날). 안 바꾸면 생략."
                },
                "description": { "type": "string", "description": "새 설명. 안 바꾸면 생략." },
                "location": { "type": "string", "description": "새 장소. 안 바꾸면 생략." },
                "all_day": {
                    "type": "boolean",
                    "description": "종일 이벤트 여부. 시간 형식이 바뀔 때만 명시."
                }
            },
            "required": ["google_event_id"],
            "additionalProperties": false
        }),
    }
}

pub fn delete_event() -> ToolDef {
    ToolDef {
        name: "delete_event".into(),
        description: "지정한 google_event_id의 캘린더 이벤트를 삭제합니다. 사용자가 \"~ 취소됐어\", \
                      \"일정 빼줘\" 같이 말할 때 사용. 먼저 list_today_events 또는 list_upcoming_events로 \
                      대상 이벤트의 google_event_id를 확인하세요."
            .into(),
        parameters: json!({
            "type": "object",
            "properties": {
                "google_event_id": {
                    "type": "string",
                    "description": "events.google_event_id 값"
                }
            },
            "required": ["google_event_id"],
            "additionalProperties": false
        }),
    }
}

pub fn suggest_schedule() -> ToolDef {
    ToolDef {
        name: "suggest_schedule".into(),
        description: "오늘(또는 지정 날짜)의 빈 시간에 할 일을 중요도·마감을 고려해 배치 추천합니다. \
                      사용자가 \"오늘 일정 좀 짜줘\", \"하루 계획 세워줘\", \"빈 시간에 할 일 넣어줘\" 같이 \
                      물어볼 때 사용. 생활 프로필(기상/취침·식사·반복블록)과 캘린더 이벤트로 계산한 \
                      free_slots/proposed/unplaced를 바탕으로 일과표를 제시하세요. 실제 캘린더 생성은 \
                      사용자가 수락하면 schedule_commit으로 진행합니다(이 도구 자체는 아무것도 생성하지 않음).".into(),
        parameters: json!({
            "type": "object",
            "properties": {
                "date": {
                    "type": "string",
                    "description": "YYYY-MM-DD (로컬). 생략 시 오늘."
                }
            },
            "additionalProperties": false
        }),
    }
}

pub fn schedule_commit() -> ToolDef {
    ToolDef {
        name: "schedule_commit".into(),
        description: "suggest_schedule 추천을 사용자가 명시적으로 수락했을 때, 그 배치를 실제 캘린더 \
                      이벤트로 만듭니다. items에 각 할 일의 todo_id와 start_at/end_at(ISO 8601 with offset)을 \
                      넣으세요. 시각은 반드시 suggest_schedule가 준 free_slots 안이어야 하고 서로 겹치면 안 되며, \
                      길이는 그 할 일의 예상 소요시간과 같아야 합니다. 서버가 생성 직전 다시 검증하며 하나라도 \
                      어긋나면 전체가 거부됩니다. 사용자 수락 없이 호출하지 마세요.".into(),
        parameters: json!({
            "type": "object",
            "properties": {
                "items": {
                    "type": "array",
                    "description": "캘린더에 만들 배치 목록",
                    "items": {
                        "type": "object",
                        "properties": {
                            "todo_id": { "type": "integer", "description": "todos.id" },
                            "start_at": { "type": "string", "description": "시작 (ISO 8601 with offset)" },
                            "end_at": { "type": "string", "description": "종료 (ISO 8601 with offset)" }
                        },
                        "required": ["todo_id", "start_at", "end_at"],
                        "additionalProperties": false
                    }
                }
            },
            "required": ["items"],
            "additionalProperties": false
        }),
    }
}

pub fn list_today_travel() -> ToolDef {
    ToolDef {
        name: "list_today_travel".into(),
        description: "오늘 일정들 사이의 대중교통 이동(출발 시각·소요시간·환승 횟수)을 계산해 반환합니다. \
                      \"오늘 이동 어떻게 돼?\", \"몇 시에 나가야 해?\", \"다음 일정까지 얼마나 걸려?\" 같은 \
                      질문에 사용. 장소가 있는 연속 일정 쌍만 계산되며, 출발지는 직전 일정 장소(없으면 집)입니다. \
                      각 항목(leg)에는 from/to/start_at/depart_by(출발 시각)/duration_min/transfers가 들어 있습니다. \
                      표시 형식은 결과에 동봉된 지침을 따르세요."
            .into(),
        parameters: json!({
            "type": "object",
            "properties": {},
            "additionalProperties": false
        }),
    }
}

pub fn remember_fact() -> ToolDef {
    ToolDef {
        name: "remember_fact".into(),
        description: "사용자에 관한 안정적인 사실(선호/일상/관계/배경)을 장기 메모리에 저장합니다. \
                      예: \"커피 안 마심, 차 좋아함\", \"아내 이름은 ○○\". \
                      사용자가 \"기억해줘\" 류로 명시 요청했거나, 대화 중 자연스럽게 드러난 \
                      재사용 가치 있는 사실일 때만 호출. 일회성 정보(오늘 점심 메뉴 등)는 저장 X. \
                      content는 한 문장으로 간결하게, tags는 검색 키워드 (예: [\"음료\", \"선호\"])."
            .into(),
        parameters: json!({
            "type": "object",
            "properties": {
                "content": {
                    "type": "string",
                    "description": "저장할 사실. 한 문장. 미래의 자기 자신이 검색할 때 이해 가능한 형태."
                },
                "tags": {
                    "type": "array",
                    "items": { "type": "string" },
                    "description": "검색용 키워드 배열. 0~5개."
                }
            },
            "required": ["content"],
            "additionalProperties": false
        }),
    }
}

pub fn search_memory() -> ToolDef {
    ToolDef {
        name: "search_memory".into(),
        description: "장기 메모리에서 키워드로 사용자 관련 사실을 찾습니다. \
                      사용자가 \"이전에 말한 거 있을 텐데\"라거나, 답변에 사용자의 \
                      취향/배경이 도움될 것 같을 때 호출. 일상 대화엔 호출하지 마세요 \
                      (불필요한 호출은 비용 부담). 결과 없으면 빈 배열."
            .into(),
        parameters: json!({
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "검색어. 한국어 키워드 1~3개 권장 (예: \"커피 차 음료\")."
                },
                "limit": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": 10,
                    "description": "최대 결과 수. 기본 3."
                }
            },
            "required": ["query"],
            "additionalProperties": false
        }),
    }
}

pub fn default_toolset() -> Vec<ToolDef> {
    vec![
        create_todo(),
        complete_todo(),
        delete_todo(),
        list_todos(),
        create_event(),
        update_event(),
        delete_event(),
        list_today_events(),
        list_upcoming_events(),
        list_today_overview(),
        list_today_travel(),
        suggest_schedule(),
        schedule_commit(),
        remember_fact(),
        search_memory(),
    ]
}
