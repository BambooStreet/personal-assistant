import React from "react";
import ReactDOM from "react-dom/client";

// UI 폰트. 패키징본은 file://로 뜨므로 CDN(Google Fonts)을 쓰면 오프라인에서 폰트가 통째로
// 안 나온다 — 반드시 번들한다.
//
// 둘 다 **variable**이라 400~700을 축 하나로 커버한다. 정적 굵기로 받으면 Noto Sans KR은
// 한글 서브셋이 굵기당 ~540KB라 4벌이면 2.2MB를 전부 로드하게 된다. variable은 유니코드
// 범위별로 쪼개져 있어 실제로 화면에 뜬 글자 범위만 받아온다.
import "@fontsource-variable/inter";
import "@fontsource-variable/noto-sans-kr";

import AvatarApp from "./AvatarApp";
import PanelApp from "./PanelApp";
import "./styles/globals.css";

const which = new URLSearchParams(window.location.search).get("w");
const Root = which === "panel" ? PanelApp : AvatarApp;

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
