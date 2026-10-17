import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";
import "./layout.css";
import "./lunar.css";
import "./standalone.css";

createRoot(document.getElementById("root")!).render(<App />);
