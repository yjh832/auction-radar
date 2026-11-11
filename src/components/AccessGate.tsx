import { useEffect, useState } from "react";
import { KeyRound, LockKeyhole, ShieldCheck } from "lucide-react";
import {
  hasStoredOwnerAccess,
  PUBLIC_ACCESS_ENDS_AT,
  resolveCurrentAccessTime,
  unlockOwnerAccess,
  verifyOwnerCode
} from "../lib/accessControl";

type GateState = "checking" | "open" | "locked";

export function AccessGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<GateState>("checking");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [unlocking, setUnlocking] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([resolveCurrentAccessTime(), hasStoredOwnerAccess()])
      .then(([now, ownerAccess]) => {
        if (cancelled) return;
        setState(ownerAccess || now < PUBLIC_ACCESS_ENDS_AT ? "open" : "locked");
      })
      .catch(() => {
        if (!cancelled) setState("locked");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function unlock(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setUnlocking(true);
    try {
      if (!(await verifyOwnerCode(code))) {
        setError("管理员解锁码不正确");
        return;
      }
      await unlockOwnerAccess();
      setState("open");
    } finally {
      setUnlocking(false);
    }
  }

  if (state === "open") return children;
  if (state === "checking") {
    return (
      <div className="access-gate access-gate--checking">
        <div className="access-gate__orb" />
        <span>正在确认访问权限…</span>
      </div>
    );
  }

  const publicEnd = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date(PUBLIC_ACCESS_ENDS_AT));

  return (
    <main className="access-gate">
      <section className="access-gate__card">
        <div className="access-gate__icon">
          <LockKeyhole size={30} />
        </div>
        <span className="access-gate__eyebrow">PRIVATE ACCESS</span>
        <h1>公共体验期已结束</h1>
        <p>
          本页面的公共访问开放至 <strong>{publicEnd}</strong>。现在仅允许管理员解锁后的设备继续使用。
        </p>
        <form onSubmit={(event) => void unlock(event)}>
          <label htmlFor="owner-code">
            <KeyRound size={15} />
            管理员解锁码
          </label>
          <input
            id="owner-code"
            type="password"
            autoComplete="off"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            placeholder="输入你保存的管理员解锁码"
          />
          <button type="submit" disabled={unlocking || !code.trim()}>
            <ShieldCheck size={16} />
            {unlocking ? "正在验证" : "解锁本机长期访问"}
          </button>
        </form>
        {error && <div className="access-gate__error">{error}</div>}
        <small>
          解锁成功后，仅当前浏览器或已安装 PWA 保留授权；换设备时需要重新输入解锁码。
        </small>
      </section>
    </main>
  );
}
