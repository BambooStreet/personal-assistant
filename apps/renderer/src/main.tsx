import React from "react";
import ReactDOM from "react-dom/client";

// 제목·라벨용 고운돋움. 패키징본은 file://로 뜨므로 CDN(Google Fonts)을 쓰면 오프라인에서
// 폰트가 통째로 안 나온다 — 반드시 번들해야 한다. 한글+라틴 서브셋만 가져온다(~410KB).
import "@fontsource/gowun-dodum/korean-400.css";
import "@fontsource/gowun-dodum/latin-400.css";

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
