import { AppView } from "./app/AppView";
import { useAppController } from "./app/useAppController";

export function App() {
  return <AppView controller={useAppController()} />;
}
