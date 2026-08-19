# 앱 아이콘 리소스

| 파일 | 쓰임 |
|---|---|
| `icon.ico` | 앱/설치본 아이콘(`build.win.icon`). 16·24·32·48은 머리 크롭, 64·128·256은 전신 |
| `icon.png` | 창(작업표시줄) 아이콘 512px. dev에서도 캐릭터가 보이도록 `windows.ts`가 지정 |
| `tray.ico` | Windows 트레이(16·24·32). 어두운 작업표시줄에서 묻히지 않게 밝은 배경판 위에 얹음 |
| `tray.png` | macOS 트레이. `setTemplateImage(true)`라 **투명 배경 실루엣**이어야 함(배경판 금지) |

원본은 `apps/renderer/public/avatar/idle.png`(고양이 캐릭터). 아트를 바꾸면 위 4개를 다시 만들 것 —
작은 크기는 전신을 넣으면 뭉개져서 머리만 크롭해 쓴다.

`build.files`에 `apps/main/resources/**`가 있어야 트레이 아이콘이 설치본에 들어간다
(빠지면 트레이가 빈 아이콘으로 뜬다 — 실제로 v0.1.1까지 그랬음).
