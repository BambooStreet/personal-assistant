import React from "react";
import ReactDOM from "react-dom/client";

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
