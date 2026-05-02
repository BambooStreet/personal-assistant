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
        description: "현재 열려있는 할 일 목록을 가져옵니다.".into(),
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

pub fn default_toolset() -> Vec<ToolDef> {
    vec![create_todo(), complete_todo(), list_todos(), create_event()]
}
