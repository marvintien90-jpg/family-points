import { Component, ReactNode } from "react";

// 任何畫面出錯時顯示可以恢復的訊息，而不是一片白
export class ErrorBoundary extends Component<{ children: ReactNode; small?: boolean }, { err: Error | null }> {
  state = { err: null as Error | null };
  static getDerivedStateFromError(err: Error) { return { err }; }
  componentDidCatch(err: Error) { console.error("畫面錯誤", err); }
  render() {
    const { err } = this.state;
    if (!err) return this.props.children;
    if (this.props.small) return <div className="crash small"><b>這裡出了點問題</b><p>{err.message}</p><button className="btn line" onClick={() => this.setState({ err: null })}>再試一次</button></div>;
    return <div className="center-page crash"><h1>畫面出了點問題</h1><p>{err.message}</p><button className="btn" onClick={() => location.reload()}>重新整理</button></div>;
  }
}
