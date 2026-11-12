import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
// The app's one typeface, served from the app itself: Pretendard draws Latin as
// Inter does and Korean to match, in small pieces the browser loads only when
// a page uses their letters.
import "pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css";

import App from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
