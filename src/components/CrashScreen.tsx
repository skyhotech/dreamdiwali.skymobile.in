import { Component, type ReactNode } from "react";
import { reportError } from "../lib/errors";
// If anything breaks while drawing a screen, the customer sees this instead of
// a blank page, and SKY is told what happened on which phone.
export class CrashScreen extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error) {
    reportError(error, "render");
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="crash-screen" role="alert">
        <b>Something went wrong</b>
        <p>Please reload the page. Your gift and photos are safe.</p>
        <button className="spin-button" onClick={() => location.reload()}>
          Reload
        </button>
      </div>
    );
  }
}
